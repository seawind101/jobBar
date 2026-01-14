require('dotenv').config();
const router = require('express').Router();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const isAuthenticated = require('../middleware/isAuthenticated');

// Avoid requiring the app (prevents circular require issues). Open the DB directly.
const dbFile = path.resolve(__dirname, '../database/database.sqlite');
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error('Failed to open database in free route:', err);
});

// Free route
router.get('/free', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM companies ORDER BY id DESC', (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        const normalized = (rows || []).map(r => ({
            ...r,
            verified : Number(r.verified) || 0
        }));
        res.render('free', { companies: normalized, user: req.user });
    });
    
});

module.exports = router;