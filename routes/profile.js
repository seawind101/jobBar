require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Show profile for the logged-in user
router.get('/profile', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const fbId = req.session.fb_id;

    try {
        const user = await new Promise((resolve, reject) => db.get('SELECT * FROM users WHERE fb_id = ?', [fbId], (e, row) => e ? reject(e) : resolve(row)));
        if (!user) return res.status(404).send('User not found');

        // Companies owned
        const companies = await new Promise((resolve, reject) => db.all('SELECT * FROM companies WHERE owner_id = ? ORDER BY id DESC', [fbId], (e, rows) => e ? reject(e) : resolve(rows || [])));

        // Jobs the user applied to
        const jobsApplied = await new Promise((resolve, reject) => db.all(
            `SELECT ja.id as application_id, j.* FROM job_applications ja JOIN jobs j ON ja.job_id = j.id WHERE ja.fb_id = ? ORDER BY ja.applied_at DESC`,
            [fbId], (e, rows) => e ? reject(e) : resolve(rows || [])
        ));

        // Positions the user applied to (include company name)
        const positionsApplied = await new Promise((resolve, reject) => db.all(
            `SELECT pa.id as application_id, p.*, c.name as company_name FROM position_applications pa JOIN company_positions p ON pa.position_id = p.id LEFT JOIN companies c ON p.company_id = c.id WHERE pa.fb_id = ? ORDER BY pa.applied_at DESC`,
            [fbId], (e, rows) => e ? reject(e) : resolve(rows || [])
        )).catch(() => []);

        // Jobs the user was accepted to (assigned employee)
        const jobsAccepted = await new Promise((resolve, reject) => db.all('SELECT * FROM jobs WHERE employee_id = ? ORDER BY id DESC', [fbId], (e, rows) => e ? reject(e) : resolve(rows || [])));

        // Jobs completed by this user
        const jobsCompleted = await new Promise((resolve, reject) => db.all('SELECT * FROM jobs WHERE employee_id = ? AND status = ? ORDER BY id DESC', [fbId, 'completed'], (e, rows) => e ? reject(e) : resolve(rows || [])));

        // Positions accepted / in progress
        const positionsAccepted = await new Promise((resolve, reject) => db.all('SELECT p.*, c.name as company_name FROM company_positions p LEFT JOIN companies c ON p.company_id = c.id WHERE p.employee_id = ? ORDER BY p.id DESC', [fbId], (e, rows) => e ? reject(e) : resolve(rows || [])));

        const positionsCompleted = await new Promise((resolve, reject) => db.all('SELECT p.*, c.name as company_name FROM company_positions p LEFT JOIN companies c ON p.company_id = c.id WHERE p.employee_id = ? AND p.status = ? ORDER BY p.id DESC', [fbId, 'completed'], (e, rows) => e ? reject(e) : resolve(rows || [])));

        res.render('profile', { user, companies, jobsApplied, positionsApplied, jobsAccepted, jobsCompleted, positionsAccepted, positionsCompleted, fb_id: fbId });
    } catch (err) {
        console.error('Error loading profile:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Quit a position (employee-initiated)
router.post('/profile/quit-position', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const fbId = req.session.fb_id;
    const { positionId } = req.body;

    if (!positionId) return res.status(400).send('Missing position id');

    try {
        const pos = await new Promise((resolve, reject) => db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (e, r) => e ? reject(e) : resolve(r)));
        if (!pos) return res.status(404).send('Position not found');

        // ensure the requester is the assigned employee
        if (!pos.employee_id || String(pos.employee_id) !== String(fbId)) {
            return res.status(403).send('You are not the employee for this position');
        }

        // remove from company_employees for this company
        await new Promise((resolve, reject) => db.run('DELETE FROM company_employees WHERE company_id = ? AND fb_id = ?', [pos.company_id, fbId], (e) => e ? reject(e) : resolve()));

        // set position back to available and clear employee assignment
        await new Promise((resolve, reject) => db.run('UPDATE company_positions SET status = ?, employee_id = NULL WHERE id = ?', ['available', positionId], (e) => e ? reject(e) : resolve()));

        return res.redirect('/profile');
    } catch (err) {
        console.error('Error quitting position:', err);
        return res.status(500).send('Internal Server Error');
    }
});

module.exports = router;

