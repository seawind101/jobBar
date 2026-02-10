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

router.get('/post', isAuthenticated, (req, res) => {
    // Only managers may access the company creation page
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies')
        return;
    }

    // provide default form/error values so template can render safely
    res.render('post', { title: 'Post your Company', fb_id: req.session.fb_id, form: {}, error: null });
});

// Post route to create a new company
router.post('/post', isAuthenticated, (req, res) => {
    // Only managers may create companies
    if (!res.locals || !res.locals.isManager) {
        res.redirect('/companies')
        return;
    }

    const body = req.body || {};
    const { name, description, link, owner_id, pColor, sColor, bpColor, bsColor } = body;
    if (!name || !description || !link || !owner_id || !pColor || !sColor || !bpColor || !bsColor) {
        return res.status(400).send('All fields are required.');
    }

    // Check if a company with the same name already exists (case-insensitive)
    db.get('SELECT id FROM companies WHERE name = ? COLLATE NOCASE', [name], (err, existing) => {
        if (err) {
            console.error('DB error checking company name:', err);
            return res.status(500).send('Internal Server Error');
        }
        if (existing) {
            // render the form again with an error message and preserve entered values
            return res.render('post', { title: 'Post your Company', fb_id: req.session.fb_id, error: 'Name taken — please choose a different company name.', form: { name, description, link } });
        }

        // determine owner from session (server-side) so clients can't spoof owner_id
        const ownerId = req.session && req.session.fb_id ? req.session.fb_id : null;

        db.run('INSERT INTO companies (name, description, link, owner_id, pColor, sColor, bpColor, bsColor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [name, description, link, ownerId, pColor, sColor, bpColor, bsColor], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/companies');
        });
    });
});
module.exports = router;