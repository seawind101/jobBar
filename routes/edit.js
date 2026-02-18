require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

router.get('/edit/company', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    if (!fb_id) {
        return res.status(403).send('Forbidden: You must be logged in to edit a company');
    }
    const query = `SELECT * FROM companies WHERE owner_id = ? COLLATE NOCASE`;
    db.get(query, [fb_id], (err, company) => {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }
        if (!company) {
            return res.status(404).send('Company not found');
        }
        // render shared edit page with company context
        res.render('edit', { type: 'company', company });
    });
});

router.post('/edit/company', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    if (!fb_id) {
        return res.status(403).send('Forbidden: You must be logged in to edit a company');
    }
    const { name, description, link, pColor, sColor } = req.body;
    if (!name || !description || !link || !pColor || !sColor) {
        return res.status(400).send('All fields are required.');
    }
    const query = `UPDATE companies SET name = ?, description = ?, link = ?, pColor = ?, sColor = ? WHERE owner_id = ? COLLATE NOCASE`;
    db.run(query, [name, description, link, pColor, sColor, fb_id], function(err) {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/jobManager/' + encodeURIComponent(name));
    });
});

router.get('/edit/job/:jobId', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    const jobId = req.params.jobId;
    if (!fb_id) {
        return res.status(403).send('Forbidden: You must be logged in to edit a job');
    }
    const query = `SELECT j.*, c.owner_id FROM jobs j LEFT JOIN companies c ON j.company = c.name WHERE j.id = ?`;
    db.get(query, [jobId], (err, job) => {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }
        if (!job) {
            return res.status(404).send('Job not found');
        }
        const ownerFb = job.owner_id !== undefined && job.owner_id !== null ? String(job.owner_id) : null;
        if (fb_id !== ownerFb && fb_id !== '1') {
            return res.status(403).send('Forbidden: You do not own this job');
        }
        // render shared edit page with job context
        res.render('edit', { type: 'job', job });
    });
});

router.post('/edit/job/:jobId', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    const jobId = req.params.jobId;
    if (!fb_id) {
        return res.status(403).send('Forbidden: You must be logged in to edit a job');
    }
    const { title, description, pay } = req.body;
    if (!title || !description || !pay) {
        return res.status(400).send('All fields are required.');
    }
    const query = `UPDATE jobs SET title = ?, description = ?, pay = ? WHERE id = ?`;
    db.run(query, [title, description, pay, jobId], function(err) {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/jobManager/' + encodeURIComponent(req.body.company));
    });
});

module.exports = router;
