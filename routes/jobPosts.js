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
    // Only managers may access the job post creation page
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies')
        return;
    }

    const { companyName } = req.params;
    res.render('jobPosts', { title: 'Create a Job Post', company: companyName });
});

router.post('/jobPosts', isAuthenticated, (req, res) => {
    // Only managers may create job posts
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies');
        return;
    }

    const body = req.body || {};
    const { company, title, description, pay } = body;
    if (!company || !title || !description || !pay) {
        return res.status(400).send('All fields are required.');
    }
    db.run('INSERT INTO jobs (company, title, description, pay) VALUES (?, ?, ?, ?)', [company, title, description, pay], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect(`/job/${company}`); // Redirect to the job page for the specific company
    });
});
module.exports = router;