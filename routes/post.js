require('dotenv').config();
const router = require('express').Router();
const { Manager } = require('socket.io-client');
const isAuthenticated = require('../middleware/isAuthenticated');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
// Avoid requiring the app (prevents circular require issues). Open the DB directly.
const dbFile = path.resolve(__dirname, '../database/database.sqlite');
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error('Failed to open database in free route:', err);
});

router.get('/post', isAuthenticated, (req, res) => {
    // Only managers may access the company creation page
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies')
        return;
    }

    res.render('post', { title: 'Post your Company' });
});

// Post route to create a new company
router.post('/post', isAuthenticated, (req, res) => {
    // Only managers may create companies
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies')
        return;
    }

    const body = req.body || {};
    const { name, description, link } = body;
    if (!name || !description || !link) {
        return res.status(400).send('All fields are required.');
    }
    db.run('INSERT INTO companies (name, description, link) VALUES (?, ?, ?)', [name, description, link], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/companies');
    });
});
module.exports = router;