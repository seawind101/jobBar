require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Route: show a single company and its jobs by company name (same EJS page)
router.get('/job/:companyName', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const companyName = req.params.companyName; // express already decodes URL components

    // get all companies (for navigation/listing)
    const companiesQuery = `SELECT * FROM companies`;

    // The `jobs` table stores the company as a text column named `company` (not company_id).
    // Query jobs by company name (case-insensitive) and order newest first.
    const jobsQuery = `
        SELECT j.*
        FROM jobs j
        WHERE j.company = ? COLLATE NOCASE
        ORDER BY j.id DESC
    `;

    db.all(companiesQuery, [], (err, companies) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }

        db.all(jobsQuery, [companyName], (err2, jobs) => {
            if (err2) {
                console.error(err2);
                return res.status(500).send('Internal Server Error');
            }
            // find the selected company object by name (case-insensitive)
            const selectedCompany = companies.find(c => String(c.name).toLowerCase() === String(companyName).toLowerCase()) || null;

            // Ensure job_applications table exists, then fetch application info for these jobs
            const jobIds = (jobs || []).map(j => j.id).filter(Boolean);
            if (jobIds.length === 0) {
                // no jobs, render directly
                return res.render('job', { companies, company: selectedCompany, jobs, user: req.session.user, fb_id: req.session.fb_id });
            }

            db.run(`CREATE TABLE IF NOT EXISTS job_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                fb_id TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(job_id, fb_id)
            )`, (createErr) => {
                if (createErr) {
                    console.error('Failed to ensure job_applications table:', createErr);
                    // continue without application info
                    return res.render('job', { companies, company: selectedCompany, jobs, user: req.session.user, fb_id: req.session.fb_id });
                }

                const placeholders = jobIds.map(_ => '?').join(',');
                db.all(`SELECT job_id, fb_id FROM job_applications WHERE job_id IN (${placeholders})`, jobIds, (aErr, appRows) => {
                    if (aErr) {
                        console.error('Error fetching applications:', aErr);
                        return res.render('job', { companies, company: selectedCompany, jobs, user: req.session.user, fb_id: req.session.fb_id });
                    }

                    // build lookup maps
                    const counts = {};
                    const youAppliedSet = new Set();
                    const yourFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
                    (appRows || []).forEach(r => {
                        const jid = String(r.job_id);
                        counts[jid] = (counts[jid] || 0) + 1;
                        if (yourFb && String(r.fb_id) === yourFb) youAppliedSet.add(jid);
                    });

                    // attach meta to jobs
                    jobs.forEach(j => {
                        const jid = String(j.id);
                        j.applicants_count = counts[jid] || 0;
                        j.you_applied = youAppliedSet.has(jid);
                    });

                    return res.render('job', { companies, company: selectedCompany, jobs, user: req.session.user, fb_id: req.session.fb_id });
                });
            });
        });
    });
});

// Apply to a job: set jobs.employee_id to the current user's fb_id
router.post('/job/:jobId/apply', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const jobId = req.params.jobId;
    const fbId = req.session.fb_id;

    if (!fbId) {
        return res.status(400).send('User not identified'); // Added return
    }


    // Ensure the applications table exists and insert an application for this user/job.
    db.run(
        `CREATE TABLE IF NOT EXISTS job_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            fb_id TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(job_id, fb_id)
        )`
    , (createErr) => {
        if (createErr) {
            console.error('Failed to ensure job_applications table:', createErr);
            return res.status(500).send('Internal Server Error');
        }

        // Insert the application (or ignore if already exists)
        db.run('INSERT OR IGNORE INTO job_applications (job_id, fb_id) VALUES (?, ?)', [jobId, fbId], function(insertErr) {
            if (insertErr) {
                console.error('Failed to insert application:', insertErr);
                return res.status(500).send('Internal Server Error');
            }

            // Redirect back to referrer when possible, otherwise company job page
            db.get('SELECT company FROM jobs WHERE id = ?', [jobId], (err, job) => {
                if (err) {
                    console.error('Error fetching job:', err);
                    return res.redirect('/');
                }

                if (!job) {
                    return res.redirect('/');
                }

                const referer = req.get('Referer') || req.get('referer') || null;
                if (referer) return res.redirect(referer);
                return res.redirect(`/job/${encodeURIComponent(job.company)}`);
            });
        });
    });

});

module.exports = router;