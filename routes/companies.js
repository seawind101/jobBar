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

// Companies route
router.get('/companies', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM companies ORDER BY id DESC', (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
            const currentFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;

            // compute manager list from environment as a fallback (keeps parity with app.js parsing)
            const rawManagers = process.env.managers || process.env.MANAGERS || '';
            let parsedManagers = [];
            try {
                const s = String(rawManagers).trim();
                if (!s) parsedManagers = [];
                else if (s.startsWith('[') && s.endsWith(']')) parsedManagers = JSON.parse(s).map(String);
                else if (s.indexOf(',') !== -1) parsedManagers = s.split(',').map(x => x.trim()).filter(Boolean).map(String);
                else parsedManagers = [s.replace(/\s+/g, '')].filter(Boolean).map(String);
            } catch (err) { parsedManagers = (String(rawManagers).match(/\d+/g) || []).map(String); }

            const isManager = currentFb ? parsedManagers.includes(String(currentFb)) : false;

            const normalized = (rows || []).map(r => ({
                ...r,
                verified: Number(r.verified) || 0,
                isOwner: currentFb && r.owner_id != null && String(r.owner_id) === currentFb
            }));
            res.render('companies', { companies: normalized, user: req.user, fb_id: currentFb, isManager });
    });
});
module.exports = router;