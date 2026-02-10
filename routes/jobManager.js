require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Route: show a single company and its jobs by company name (same EJS page)
router.get('/jobManager/:companyName', isAuthenticated, (req, res) => {

    const db = req.app.locals.db;
    const companyName = req.params.companyName; // express already decodes URL components

    // get all companies (for navigation/listing)
    const companiesQuery = `SELECT * FROM companies`;

    // The `jobs` table stores the company as a text column named `company` (not company_id).
    // Query jobs by company name (case-insensitive) and order newest first.
    const jobsQuery = `
        SELECT j.*, 
            u.username as employee_name,
            CASE 
                WHEN j.status IS NOT NULL AND j.status != '' THEN j.status
                WHEN j.employee_id IS NOT NULL AND j.employee_id != 0 THEN 'taken'
                ELSE 'available'
            END as status
        FROM jobs j
        LEFT JOIN users u ON j.employee_id = u.fb_id
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

            if (!selectedCompany) {
                return res.status(404).send('Company not found');
            }

            // enforce owner-only access to the job manager page
            const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
            const ownerFb = selectedCompany.owner_id !== undefined && selectedCompany.owner_id !== null ? String(selectedCompany.owner_id) : null;
            if (requesterFb !== ownerFb) {
                res.redirect('/companies');
                return 
            }

            // render job view — the template expects `company` (singular), so pass that
            // pass current session user info so template can show apply buttons
            res.render('jobManager', {
                companies,
                company: selectedCompany,
                jobs,
                user: req.session.user,
                fb_id: req.session.fb_id
            });
        });
    });
});

// Route to mark a job as complete
router.post('/job/:jobId/complete', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const jobId = req.params.jobId;
    const { pin } = req.body;
    const userId = req.session.fb_id;

    // TODO: Verify the PIN matches the user's PIN
    // For now, we'll just update the status

    // Verify the job is taken by this user
    db.get('SELECT * FROM jobs WHERE id = ? AND employee_id = ?', [jobId, userId], (err, job) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (!job) {
            return res.status(403).json({ success: false, message: 'Job not found or not assigned to you' });
        }

        // Update job status to completed
        db.run('UPDATE jobs SET status = ? WHERE id = ?', ['completed', jobId], function (updateErr) {
            if (updateErr) {
                console.error('Error updating job:', updateErr);
                return res.status(500).json({ success: false, message: 'Error updating job' });
            }

            res.json({ success: true });
        });
    });
});
// Mark a job as complete (called after successful transfer)
router.post('/job/:id/complete', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const jobId = req.params.id;
    const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;

    if (!requesterFb) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Find the job and its company, then verify requester is the company owner or root admin (fb_id === '1')
    db.get('SELECT j.*, c.owner_id FROM jobs j LEFT JOIN companies c ON j.company = c.name WHERE j.id = ?', [jobId], (err, row) => {
        if (err) {
            console.error('DB error fetching job:', err);
            return res.status(500).json({ success: false, message: 'DB error' });
        }
        if (!row) return res.status(404).json({ success: false, message: 'Job not found' });

        const ownerFb = row.owner_id !== undefined && row.owner_id !== null ? String(row.owner_id) : null;
        if (requesterFb !== ownerFb && requesterFb !== '1') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        db.run('DELETE FROM jobs WHERE id = ?', [jobId], function(delErr) {
            if (delErr) {
                console.error('Failed to mark job complete:', delErr);
                return res.status(500).json({ success: false, message: 'DB error' });
            }
            return res.json({ success: true });
        });
    });
});

module.exports = router;




