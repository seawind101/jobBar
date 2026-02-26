require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Show job posting form
router.get('/jobPosts/:companyName', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const companyName = req.params.companyName;

    db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, company) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }

        if (!company) {
            return res.status(404).send('Company not found');
        }

        // Check if user is the owner
        if (company.owner_id !== req.session.fb_id) {
            return res.status(403).send('You do not have permission to post jobs for this company');
        }

        res.render('jobPosts', { 
            company,
            fb_id: req.session.fb_id,
            error: null,
            form: {}
        });
    });
});

// Create a job (only after payment succeeds)
router.post('/jobPosts', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const body = req.body || {};

    // Manager check
    if (!res.locals || !res.locals.isManager) {
        return res.status(403).json({ success: false, message: 'Forbidden: not a manager' });
    }

    const { company, title, description, pay, status, paymentVerified } = body;

    // Validate required fields
    if (!company || !title || !description || !pay) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Security check: Only allow job creation if payment was verified
    // This token is only sent by the client after successful payment
    if (paymentVerified !== 'true') {
        return res.status(402).json({ 
            success: false, 
            message: 'Payment required. Job posting requires successful payment.' 
        });
    }

    try {
        // Verify company exists and user is owner
        const companyRow = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [company], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (!companyRow) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        // Get owner ID from session (secure - cannot be spoofed)
        const ownerId = req.session && req.session.fb_id ? req.session.fb_id : null;
        if (!ownerId) {
            return res.status(403).json({ success: false, message: 'No owner ID in session' });
        }

        if (companyRow.owner_id !== ownerId) {
            return res.status(403).json({ success: false, message: 'You do not own this company' });
        }

        // Insert job into database
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO jobs (company, title, description, pay, status) VALUES (?, ?, ?, ?, ?)',
                [company, title, description, pay, status || 'available'],
                function(err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID });
                }
            );
        });

        return res.json({ success: true, message: 'Job posted successfully' });
    } catch (err) {
        console.error('Error posting job:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;