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

            // render job view — the template expects `company` (singular), so pass that
            // pass current session user info so template can show apply buttons
            res.render('job', { companies, company: selectedCompany, jobs, user: req.session.user, fb_id: req.session.fb_id });
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

    // Atomically set employee_id to the fb_id only if it's currently NULL (not taken)
    db.run(
        'UPDATE jobs SET employee_id = ?, status = ? WHERE id = ? AND (employee_id IS NULL OR employee_id = 0)',
        [fbId, 'taken', jobId],
        function (updateErr) {
            if (updateErr) {
                console.error('DB error updating job:', updateErr);
                return res.status(500).send('Internal Server Error'); // Added return
            }

            if (this.changes === 0) {
                // Job was already taken or doesn't exist
                return res.status(409).send('Job is no longer available'); // Added return
            }

            // Get the company name to decide fallback redirect
            db.get('SELECT company FROM jobs WHERE id = ?', [jobId], (err, job) => {
                if (err) {
                    console.error('Error fetching job:', err);
                    return res.redirect('/');
                }

                if (!job) {
                    return res.redirect('/');
                }

                // Prefer redirecting back to the referring page (so apply from /allJobs returns there).
                // Fall back to the company's job page if no referer is present.
                const referer = req.get('Referer') || req.get('referer') || null;
                if (referer) {
                    return res.redirect(referer);
                }

                return res.redirect(`/job/${encodeURIComponent(job.company)}`);
            });
        }
    );
});

module.exports = router;