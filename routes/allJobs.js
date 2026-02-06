const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');

router.get('/allJobs', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;

    const jobsQuery = `
        SELECT j.*, c.name AS company_name, c.description AS company_description, c.link AS company_link, u.username AS employee_name
        FROM jobs j
        LEFT JOIN companies c ON j.company = c.name
        LEFT JOIN users u ON j.employee_id = u.fb_id
        ORDER BY j.id DESC
    `;

    db.all(jobsQuery, [], (err, jobs) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        // Attach applications info if the table exists (create if necessary)
        const jobIds = (jobs || []).map(j => j.id).filter(Boolean);
        if (jobIds.length === 0) {
            return res.render('allJobs', { title: 'All Jobs', jobs, fb_id: req.session && req.session.fb_id });
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
                return res.render('allJobs', { title: 'All Jobs', jobs, fb_id: req.session && req.session.fb_id });
            }

            const placeholders = jobIds.map(_ => '?').join(',');
            db.all(`SELECT job_id, fb_id FROM job_applications WHERE job_id IN (${placeholders})`, jobIds, (aErr, appRows) => {
                if (aErr) {
                    console.error('Error fetching applications:', aErr);
                    return res.render('allJobs', { title: 'All Jobs', jobs, fb_id: req.session && req.session.fb_id });
                }

                const counts = {};
                const youAppliedSet = new Set();
                const yourFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
                (appRows || []).forEach(r => {
                    const jid = String(r.job_id);
                    counts[jid] = (counts[jid] || 0) + 1;
                    if (yourFb && String(r.fb_id) === yourFb) youAppliedSet.add(jid);
                });

                jobs.forEach(j => {
                    const jid = String(j.id);
                    j.applicants_count = counts[jid] || 0;
                    j.you_applied = youAppliedSet.has(jid);
                });

                return res.render('allJobs', { title: 'All Jobs', jobs, fb_id: req.session && req.session.fb_id });
            });
        });
    });
});

module.exports = router;
