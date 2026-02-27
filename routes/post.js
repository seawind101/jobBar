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
    res.render('post', { 
        title: 'Post your Company', 
        fb_id: req.session.fb_id, 
        error: null, 
        form: {} 
    });
});

// create a company (only after payment succeeds)
router.post('/post', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const body = req.body || {};

    // Manager check
    if (!res.locals || !res.locals.isManager) {
        return res.status(403).json({ success: false, message: 'Forbidden: not a manager' });
    }

    const { name, description, link, pColor, sColor, bpColor, bsColor, paymentVerified } = body;
    
    // Validate required fields
    if (!name || !description || !link || !pColor || !sColor || !bpColor || !bsColor) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    // Security check: Only allow company creation if payment was verified
    // This token is only sent by the client after successful payment
    if (paymentVerified !== 'true') {
        return res.status(402).json({ 
            success: false, 
            message: 'Payment required. Company creation requires successful payment.' 
        });
    }

    try {
        // Check for duplicate company name (case-insensitive)
        const existing = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM companies WHERE name = ? COLLATE NOCASE', [name], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (existing) {
            return res.status(409).json({ 
                success: false, 
                message: 'Name taken — please choose a different company name.' 
            });
        }

        // determine owner from session (server-side) so clients can't spoof owner_id
        const ownerId = req.session && req.session.fb_id ? req.session.fb_id : null;
        if (!ownerId) {
            return res.status(403).json({ success: false, message: 'No owner ID in session' });
        }

        // Insert company into database
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO companies (name, description, link, owner_id, pColor, sColor, bpColor, bsColor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [name, description, link, ownerId, pColor, sColor, bpColor, bsColor],
                function(err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID });
                }
            );
        });

        return res.json({ success: true, message: 'Company created successfully' });
    } catch (err) {
        console.error('Error creating company:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;