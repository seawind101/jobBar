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
                res.render('jobManager', { 
                    company, 
                    jobs: jobsWithApplicants, 
                    fb_id: req.session.fb_id 
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

        // Remove all applications for this job
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM job_applications WHERE job_id = ?', [jobId], (err) => {
                if (err) reject(err);
                else resolve();
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

module.exports = router;




