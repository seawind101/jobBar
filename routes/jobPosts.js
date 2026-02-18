require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Avoid requiring the app (prevents circular require issues). Open the DB directly.
const dbFile = path.resolve(__dirname, '../database/database.sqlite');
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error('Failed to open database in free route:', err);
});
// Post route
router.get('/jobPosts/:companyName', isAuthenticated, (req, res) => {
    const { companyName } = req.params;

    // Lookup company and ensure the requester is the owner
    db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, companyRow) => {
        if (err) {
            console.error('DB error fetching company:', err);
            return res.status(500).send('Internal Server Error');
        }
        if (!companyRow) {
            return res.status(404).send('Company not found');
        }

        const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
        const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
        if (!requesterFb || requesterFb !== ownerFb) {
            // not the owner; redirect
            return res.redirect('/companies');
        }

        res.render('jobPosts', { title: 'Create a Job Post', company: companyRow });
    });
});

router.post('/jobPosts', isAuthenticated, (req, res) => {
    const body = req.body || {};
    const { company, title, description, link, pay } = body;
    if (!company || !title || !description || !link || !pay) {
        return res.status(400).send('All fields are required.');
    }

    // verify requester is the owner of the company before inserting the job
    db.get('SELECT owner_id FROM companies WHERE name = ? COLLATE NOCASE', [company], (err, companyRow) => {
        if (err) {
            console.error('DB error fetching company:', err);
            return res.status(500).send('Internal Server Error');
        }
        if (!companyRow) return res.status(404).send('Company not found');

        const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
        const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
        if (!requesterFb || requesterFb !== ownerFb) {
            return res.status(403).send('Forbidden: only the company owner may post jobs');
        }

        db.run('INSERT INTO jobs (company, title, description, link, pay) VALUES (?, ?, ?, ?, ?)', [company, title, description, link, pay], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect(`/job/${encodeURIComponent(company)}`); // Redirect to the job page for the specific company
        });
    });
});
module.exports = router;