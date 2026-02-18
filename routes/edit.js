require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

router.get('/edit/company', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    const userFb = fb_id ? String(fb_id) : null;
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
    const userFb = fb_id ? String(fb_id) : null;
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
        // ensure the session user is the owner of the company that the job belongs to (or admin '1')
        const companyOwnerFb = job.owner_id != null ? String(job.owner_id) : null;
        // if the job isn't associated with any company, only allow admin (fb '1') to proceed
        if (!companyOwnerFb && userFb !== '1') {
            return res.status(403).send('Forbidden: Job is not associated with a company you own');
        }
        // require that the current user matches the company owner (unless admin)
        if (userFb !== '1' && companyOwnerFb !== userFb) {
            return res.status(403).send("Forbidden: You do not own this job's company");
        }
        // fetch company details for styling/hidden fields on the job edit page
        const compQuery = `SELECT * FROM companies WHERE name = ?`;
        db.get(compQuery, [job.company], (err2, company) => {
            if (err2) {
                return res.status(500).send('Internal Server Error');
            }
            // render shared edit page with job + company context
            res.render('edit', { type: 'job', job, company: company || null });
        });
    });
});

router.post('/edit/job/:jobId', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const fb_id = req.session.fb_id;
    const jobId = req.params.jobId;
    if (!fb_id) {
        return res.status(403).send('Forbidden: You must be logged in to edit a job');
    }
    const { title, description, pay, link } = req.body;
    if (!title || !description || !pay) {
        return res.status(400).send('Title, description, and pay are required.');
    }
    // accept link as optional (store empty string if missing)
    const safeLink = typeof link !== 'undefined' && link !== null ? String(link) : '';
    const query = `UPDATE jobs SET title = ?, description = ?, pay = ?, link = ? WHERE id = ?`;
    db.run(query, [title, description, pay, safeLink, jobId], function(err) {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/jobManager/' + encodeURIComponent(req.body.company));
    });
});

module.exports = router;
