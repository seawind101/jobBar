const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');

router.get('/allJobs', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;

    const jobsQuery = `
        SELECT j.*, c.name AS company_name, c.description AS company_description, c.link AS company_link, u.username AS employee_name
        FROM jobs j
        LEFT JOIN companies c ON j.company = c.name
        LEFT JOIN users u ON j.employee_id = u.fb_id
        ORDER BY j.id DESC
    `;

    db.all(jobsQuery, [], (err, jobs) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.render('allJobs', { title: 'All Jobs', jobs, fb_id: req.session && req.session.fb_id });
    });
});

module.exports = router;
