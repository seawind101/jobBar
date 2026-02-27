require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Render company-specific employment positions page (eJob.ejs)
router.get('/eJob/:companyName', isAuthenticated, (req, res) => {
    const db = req.app.locals.db;
    const companyName = req.params.companyName;

    db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, company) => {
        if (err) {
            console.error('DB error fetching company:', err);
            return res.status(500).send('Internal Server Error');
        }
        if (!company) return res.status(404).send('Company not found');

    // Show currently open positions (status = 'available' or 'applied') so multiple people can apply
    db.all('SELECT * FROM company_positions WHERE company_id = ? AND status IN (?,?) ORDER BY id DESC', [company.id, 'available', 'applied'], (err2, jobs) => {
            if (err2) {
                console.error('DB error fetching jobs:', err2);
                return res.status(500).send('Internal Server Error');
            }

            const jobIds = (jobs || []).map(j => j.id).filter(Boolean);
            if (jobIds.length === 0) {
                return res.render('eJob', { company, jobs: jobs || [], fb_id: req.session && req.session.fb_id ? req.session.fb_id : null });
            }

            const placeholders = jobIds.map(() => '?').join(',');
            db.all(`SELECT position_id AS job_id, fb_id FROM position_applications WHERE position_id IN (${placeholders})`, jobIds, (aErr, appRows) => {
                if (aErr) {
                    console.error('Error fetching applications:', aErr);
                    return res.render('eJob', { company, jobs: jobs || [], fb_id: req.session && req.session.fb_id ? req.session.fb_id : null });
                }

                const counts = {};
                const youAppliedSet = new Set();
                const yourFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
                (appRows || []).forEach(r => {
                    const jid = String(r.job_id);
                    counts[jid] = (counts[jid] || 0) + 1;
                    if (yourFb && String(r.fb_id) === yourFb) youAppliedSet.add(jid);
                });

                (jobs || []).forEach(j => {
                    const jid = String(j.id);
                    j.applicants_count = counts[jid] || 0;
                    j.you_applied = youAppliedSet.has(jid);
                });

                // Attach tags for these jobs (positions)
                const ph = placeholders; // reuse placeholders built above
                db.all(`SELECT pt.position_id, t.name FROM position_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.position_id IN (${ph})`, jobIds, (tErr, tRows) => {
                    const tagMap = {};
                    if (!tErr && Array.isArray(tRows)) {
                        tRows.forEach(r => {
                            if (!tagMap[r.position_id]) tagMap[r.position_id] = [];
                            tagMap[r.position_id].push(r.name);
                        });
                    }
                    (jobs || []).forEach(j => { j.tags = tagMap[j.id] || []; });
                    return res.render('eJob', { company, jobs: jobs || [], fb_id: req.session && req.session.fb_id ? req.session.fb_id : null });
                });
            });
        });
    });
});

module.exports = router;