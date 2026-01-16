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
router.get('/jobPosts', isAuthenticated, (req, res) => {
    res.render('jobPosts', { title: 'Create a Job Post' });
});

router.post('/jobPosts', isAuthenticated, (req, res) => {
    const body = req.body || {};
    const { company, title, description } = body;
    if (!company || !title || !description) {
        return res.status(400).send('All fields are required.');
    }
    db.run('INSERT INTO jobs (company, title, description) VALUES (?, ?, ?)', [company, title, description], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/');
    });
});
module.exports = router;