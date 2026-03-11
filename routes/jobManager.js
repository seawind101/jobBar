require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Route: show a single company and its jobs by company name (same EJS page)
router.get('/jobManager/:companyName', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const companyName = req.params.companyName;

    // Get company details
    db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, company) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }

        if (!company) {
            return res.status(404).send('Company not found');
        }

        // Check if user is the owner
        if (company.owner_id !== req.session.fb_id) {
            return res.status(403).send('You do not have permission to manage jobs for this company');
        }

        // Get jobs with application data
        const jobsQuery = `
            SELECT 
                j.*,
                u.username as employee_name,
                COUNT(DISTINCT ja.fb_id) as applicants_count,
                GROUP_CONCAT(DISTINCT ja.fb_id) as applicant_ids
            FROM jobs j
            LEFT JOIN job_applications ja ON j.id = ja.job_id
            LEFT JOIN users u ON j.employee_id = u.fb_id
            WHERE j.company = ? COLLATE NOCASE
            GROUP BY j.id
            ORDER BY j.id DESC
        `;

        db.all(jobsQuery, [companyName], (err, jobs) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Internal Server Error');
            }

            // Fetch applicant details for each job
            const jobPromises = jobs.map(job => {
                return new Promise((resolve) => {
                    if (!job.applicant_ids) {
                        job.applicants = [];
                        job.has_applications = false;
                        return resolve(job);
                    }

                    const ids = job.applicant_ids.split(',');
                    const placeholders = ids.map(() => '?').join(',');
                    
                    db.all(
                        `SELECT fb_id, username FROM users WHERE fb_id IN (${placeholders})`,
                        ids,
                        (err, applicants) => {
                            if (err) {
                                console.error('Error fetching applicants:', err);
                                job.applicants = [];
                            } else {
                                job.applicants = applicants.map(a => ({
                                    fb_id: a.fb_id,
                                    name: a.username || 'Unknown User'
                                }));
                            }
                            job.has_applications = job.applicants.length > 0;
                            resolve(job);
                        }
                    );
                });
            });

            Promise.all(jobPromises).then(jobsWithApplicants => {
                // pass any query error message through to the template so it can be displayed
                const message = req.query && req.query.error ? String(req.query.error) : null;
                res.render('jobManager', { 
                    company, 
                    jobs: jobsWithApplicants, 
                    fb_id: req.session.fb_id,
                    message
                });
            });
        });
    });
});

// Accept an applicant and assign them to the job (no PIN required)
router.post('/jobManager/accept', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const { jobId, applicantId } = req.body;
    const ownerId = req.session.fb_id;

    if (!jobId || !applicantId) {
        return res.status(400).send('Missing required fields');
    }

    try {
        // Get job details to verify ownership
        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).send('Job not found');
        }

        // Verify company ownership
        const company = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [job.company], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!company || company.owner_id !== ownerId) {
            return res.status(403).send('You do not own this company');
        }

        // Assign the applicant to the job and change status to 'in_progress'
        // ensure the applicant is not employed at another company
        const companyRow = company; // fetched above
        const existingEmployment = await new Promise((resolve, reject) => db.get('SELECT company_id FROM company_employees WHERE fb_id = ?', [applicantId], (e, r) => e ? reject(e) : resolve(r)));


        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE jobs SET employee_id = ?, status = ? WHERE id = ?',
                [applicantId, 'in_progress', jobId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // add to company_employees (avoid duplicates)
        await new Promise((resolve, reject) => db.run('INSERT OR IGNORE INTO company_employees (company_id, fb_id) VALUES (?, ?)', [companyRow.id, applicantId], (e) => e ? reject(e) : resolve()));

        // Remove all applications for this job and any related files/details
        await new Promise((resolve, reject) => {
            db.all('SELECT id FROM job_applications WHERE job_id = ?', [jobId], (ea, rows) => {
                if (ea) return reject(ea);
                const appIds = (rows || []).map(r => r.id);
                if (appIds.length === 0) {
                    // nothing to remove
                    return db.run('DELETE FROM job_applications WHERE job_id = ?', [jobId], (err) => err ? reject(err) : resolve());
                }

                const ph = appIds.map(() => '?').join(',');

                // delete files attached to these applications
                db.run(`DELETE FROM job_application_files WHERE application_id IN (${ph})`, appIds, function(errf) {
                    if (errf) console.error('Error deleting job_application_files on accept:', errf);
                    // delete applicant details for these applications
                    db.run(`DELETE FROM job_applicant_details WHERE application_id IN (${ph})`, appIds, function(errd) {
                        if (errd) console.error('Error deleting job_applicant_details on accept:', errd);
                        // finally delete the application rows
                        db.run(`DELETE FROM job_applications WHERE job_id = ?`, [jobId], function(errja) {
                            if (errja) return reject(errja);
                            resolve();
                        });
                    });
                });
            });
        });

        // Redirect back to job manager page
        res.redirect('/jobManager/' + encodeURIComponent(company.name));
    } catch (error) {
        console.error('Error accepting applicant:', error);
        res.status(500).send('Internal server error');
    }
});

// Mark a job as complete (with PIN verification and money transfer)
router.post('/jobManager/complete', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const { jobId, employeeId, pay, title, pin } = req.body;
    const ownerId = req.session.fb_id;

    if (!jobId || !employeeId || !pay || !pin) {
        return res.status(400).send('Missing required fields');
    }

    try {
        // Verify PIN
        const owner = await new Promise((resolve, reject) => {
            db.get('SELECT pin, money FROM users WHERE fb_id = ?', [ownerId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!owner || owner.pin !== pin) {
            return res.status(401).send('Invalid PIN');
        }

        // Check if owner has enough money
        if (owner.money < pay) {
            return res.status(400).send('Insufficient funds');
        }

        // Get job details to verify ownership
        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).send('Job not found');
        }

        // Verify company ownership
        const company = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [job.company], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!company || company.owner_id !== ownerId) {
            return res.status(403).send('You do not own this company');
        }

        // Transfer money from owner to employee
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET money = money - ? WHERE fb_id = ?', [pay, ownerId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET money = money + ? WHERE fb_id = ?', [pay, employeeId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Mark the job as completed (keep record in DB)
        await new Promise((resolve, reject) => {
            db.run('UPDATE jobs SET status = ? WHERE id = ?', ['completed', jobId], function(err) {
                if (err) return reject(err);
                resolve(this.changes);
            });
        });

        // Redirect back to job manager page
        res.redirect('/jobManager/' + encodeURIComponent(company.name));
    } catch (error) {
        console.error('Error completing job:', error);
        res.status(500).send('Internal server error');
    }
});

router.post('/jobManager/fire/:jobId', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const { jobId } = req.params;
    const ownerId = req.session.fb_id;

    if (!jobId) {
        return res.status(400).send('Missing required fields');
    }

    try {
        // Get job details to verify ownership
        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).send('Job not found');
        }

        // Verify company ownership
        const company = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [job.company], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!company || company.owner_id !== ownerId) {
            return res.status(403).send('You do not own this company');
        }

        // Only allow firing if the job is currently in_progress
        if (job.status !== 'in_progress') {
            return res.status(400).send('Can only fire employees for in-progress jobs');
        }

        // Fire the employee: remove from company_employees, return the job to available state and clear employee assignment
        try {
            await new Promise((resolve, reject) => db.run('DELETE FROM company_employees WHERE company_id = ? AND fb_id = ?', [company.id, job.employee_id], (e) => e ? reject(e) : resolve()));
        } catch (e) {
            console.error('Error removing company_employee on job fire:', e);
        }

        await new Promise((resolve, reject) => {
            db.run('UPDATE jobs SET status = ?, employee_id = NULL WHERE id = ?', ['available', jobId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.redirect('/jobManager/' + encodeURIComponent(company.name));
    } catch (error) {
        console.error('Error firing employee:', error);
        res.status(500).send('Internal server error');
    }
});

// Delete a job (owner-only)
router.post('/jobManager/delete', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const { jobId } = req.body;
    const ownerId = req.session.fb_id;

    if (!jobId) return res.status(400).send('Missing job id');

    try {
        const job = await new Promise((resolve, reject) => db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (e, r) => e ? reject(e) : resolve(r)));
        if (!job) return res.status(404).send('Job not found');

        // Prevent deletion of in-progress or completed jobs
        if (job.status === 'in_progress' || job.status === 'completed') {
            return res.status(400).send('Cannot delete a job that is in progress or completed');
        }

        const company = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [job.company], (e, r) => e ? reject(e) : resolve(r)));
        if (!company || company.owner_id !== ownerId) return res.status(403).send('You do not own this company');

        // delete related job_application_files -> job_applications -> job row
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            // delete files for applications of this job
            db.all('SELECT id FROM job_applications WHERE job_id = ?', [jobId], (ea, rows) => {
                const appIds = (rows || []).map(r => r.id);
                if (appIds.length > 0) {
                    const ph = appIds.map(() => '?').join(',');
                    db.run(`DELETE FROM job_application_files WHERE application_id IN (${ph})`, appIds, function(errf) {
                        if (errf) console.error('Error deleting job_application_files', errf);
                    });
                }
                db.run('DELETE FROM job_applications WHERE job_id = ?', [jobId], function(erra) {
                    if (erra) console.error('Error deleting job_applications', erra);
                });
                db.run('DELETE FROM jobs WHERE id = ?', [jobId], function(errj) {
                    if (errj) console.error('Error deleting job', errj);
                });
                db.run('COMMIT');
                return res.redirect('/jobManager/' + encodeURIComponent(company.name));
            });
        });
    } catch (err) {
        console.error('Error deleting job:', err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;




