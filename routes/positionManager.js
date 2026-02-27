require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Manage company positions (employment)
router.get('/positionManager/:companyName', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const companyName = req.params.companyName;

  db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, company) => {
    if (err) { console.error('Database error:', err); return res.status(500).send('Internal Server Error'); }
    if (!company) return res.status(404).send('Company not found');

    // check ownership
    if (company.owner_id !== req.session.fb_id) {
      return res.status(403).send('You do not have permission to manage positions for this company');
    }

    // Fetch positions with application counts and applicant ids
    const q = `
      SELECT 
        p.*,
        COUNT(DISTINCT pa.fb_id) as applicants_count,
        GROUP_CONCAT(DISTINCT pa.fb_id) as applicant_ids,
        u.username as employee_name
      FROM company_positions p
      LEFT JOIN position_applications pa ON p.id = pa.position_id
      LEFT JOIN users u ON p.employee_id = u.fb_id
      WHERE p.company_id = ?
      GROUP BY p.id
      ORDER BY p.id DESC
    `;

    db.all(q, [company.id], (err2, positions) => {
      if (err2) { console.error('Database error:', err2); return res.status(500).send('Internal Server Error'); }

      const posPromises = (positions || []).map(pos => {
        return new Promise((resolve) => {
          if (!pos.applicant_ids) { pos.applicants = []; pos.has_applications = false; return resolve(pos); }

          const ids = pos.applicant_ids.split(',');
          const placeholders = ids.map(() => '?').join(',');
          db.all(`SELECT fb_id, username FROM users WHERE fb_id IN (${placeholders})`, ids, async (err3, applicants) => {
            if (err3) { console.error('Error fetching applicants:', err3); pos.applicants = []; pos.has_applications = false; return resolve(pos); }

            // For each applicant, fetch their application id and any uploaded files
            try {
              const detailed = await Promise.all((applicants || []).map(async (a) => {
                const fb = a.fb_id;
                // get the application id for this position and fb_id
                const appRow = await new Promise((resApp, rejApp) => {
                  db.get('SELECT id FROM position_applications WHERE position_id = ? AND fb_id = ?', [pos.id, fb], (ea, ra) => ea ? rejApp(ea) : resApp(ra));
                }).catch(() => null);

                let files = [];
                if (appRow && appRow.id) {
                  files = await new Promise((resFiles, rejFiles) => {
                    db.all('SELECT id, field, path, original_name FROM job_application_files WHERE application_id = ?', [appRow.id], (ef, rows) => ef ? rejFiles(ef) : resFiles(rows || []));
                  }).catch(() => []);
                }

                // also fetch applicant details (portfolio link) if present
                let portfolio_link = null;
                if (appRow && appRow.id) {
                  try {
                    const det = await new Promise((resDet, rejDet) => {
                      db.get('SELECT portfolio_link FROM job_applicant_details WHERE application_id = ?', [appRow.id], (ed, rowDet) => ed ? rejDet(ed) : resDet(rowDet));
                    });
                    if (det && det.portfolio_link) portfolio_link = det.portfolio_link;
                  } catch (e) {
                    // ignore
                  }
                }

                return {
                  fb_id: fb,
                  name: a.username || 'Unknown User',
                  application_id: appRow && appRow.id ? appRow.id : null,
                  files,
                  portfolio_link
                };
              }));

              pos.applicants = detailed;
              pos.has_applications = pos.applicants.length > 0;
              resolve(pos);
            } catch (fetchErr) {
              console.error('Error enriching applicants with files:', fetchErr);
              pos.applicants = applicants.map(a => ({ fb_id: a.fb_id, name: a.username || 'Unknown User', files: [] }));
              pos.has_applications = pos.applicants.length > 0;
              resolve(pos);
            }
          });
        });
      });

      Promise.all(posPromises).then(positionsWithApplicants => {
        // fetch tags for all positions at once and attach as positionsWithApplicants[i].tags
        const pIds = (positionsWithApplicants || []).map(p => p.id).filter(Boolean);
        if (pIds.length === 0) {
          (positionsWithApplicants || []).forEach(p => p.tags = []);
          const message = req.query && req.query.error ? String(req.query.error) : null;
          return res.render('positionManager', { company, positions: positionsWithApplicants, fb_id: req.session.fb_id, message });
        }
        const ph = pIds.map(() => '?').join(',');
        db.all(`SELECT pt.position_id, t.name FROM position_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.position_id IN (${ph})`, pIds, (tErr, tRows) => {
          const tagMap = {};
          if (!tErr && Array.isArray(tRows)) {
            tRows.forEach(r => { if (!tagMap[r.position_id]) tagMap[r.position_id] = []; tagMap[r.position_id].push(r.name); });
          }
          positionsWithApplicants.forEach(p => { p.tags = tagMap[p.id] || []; });
          const message = req.query && req.query.error ? String(req.query.error) : null;
          res.render('positionManager', { company, positions: positionsWithApplicants, fb_id: req.session.fb_id, message });
        });
      });
    });
  });
});

// Accept an applicant for a position
router.post('/positionManager/accept', isAuthenticated, async (req, res) => {
  const db = req.app.locals.db;
  const { positionId, applicantId } = req.body;
  const ownerId = req.session.fb_id;

  if (!positionId || !applicantId) return res.status(400).send('Missing required fields');

  try {
    const pos = await new Promise((resolve, reject) => db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (e, r) => e ? reject(e) : resolve(r)));
    if (!pos) return res.status(404).send('Position not found');

    const company = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE id = ?', [pos.company_id], (e, r) => e ? reject(e) : resolve(r)));
    if (!company || company.owner_id !== ownerId) return res.status(403).send('You do not own this company');

    await new Promise((resolve, reject) => db.run('UPDATE company_positions SET employee_id = ?, status = ? WHERE id = ?', [applicantId, 'in_progress', positionId], (e) => e ? reject(e) : resolve()));

    await new Promise((resolve, reject) => db.run('DELETE FROM position_applications WHERE position_id = ?', [positionId], (e) => e ? reject(e) : resolve()));

    res.redirect('/positionManager/' + encodeURIComponent(company.name));
  } catch (err) {
    console.error('Error accepting applicant for position:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Complete a position (payment flow)
router.post('/positionManager/complete', isAuthenticated, async (req, res) => {
  const db = req.app.locals.db;
  const { positionId, employeeId, pay, pin } = req.body;
  const ownerId = req.session.fb_id;

  if (!positionId || !employeeId || !pay || !pin) return res.status(400).send('Missing required fields');

  try {
    const owner = await new Promise((resolve, reject) => db.get('SELECT pin, money FROM users WHERE fb_id = ?', [ownerId], (e, r) => e ? reject(e) : resolve(r)));
    if (!owner || owner.pin !== pin) return res.status(401).send('Invalid PIN');
    if (owner.money < pay) return res.status(400).send('Insufficient funds');

    const pos = await new Promise((resolve, reject) => db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (e, r) => e ? reject(e) : resolve(r)));
    if (!pos) return res.status(404).send('Position not found');

    const company = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE id = ?', [pos.company_id], (e, r) => e ? reject(e) : resolve(r)));
    if (!company || company.owner_id !== ownerId) return res.status(403).send('You do not own this company');

    await new Promise((resolve, reject) => db.run('UPDATE users SET money = money - ? WHERE fb_id = ?', [pay, ownerId], (e) => e ? reject(e) : resolve()));
    await new Promise((resolve, reject) => db.run('UPDATE users SET money = money + ? WHERE fb_id = ?', [pay, employeeId], (e) => e ? reject(e) : resolve()));

    await new Promise((resolve, reject) => db.run('UPDATE company_positions SET status = ? WHERE id = ?', ['completed', positionId], (e) => e ? reject(e) : resolve()));

    res.redirect('/positionManager/' + encodeURIComponent(company.name));
  } catch (err) {
    console.error('Error completing position:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fire an employee from a position (return to available)
router.post('/positionManager/fire/:positionId', isAuthenticated, async (req, res) => {
  const db = req.app.locals.db;
  const { positionId } = req.params;
  const ownerId = req.session.fb_id;

  if (!positionId) return res.status(400).send('Missing required fields');

  try {
    const pos = await new Promise((resolve, reject) => db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (e, r) => e ? reject(e) : resolve(r)));
    if (!pos) return res.status(404).send('Position not found');

    const company = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE id = ?', [pos.company_id], (e, r) => e ? reject(e) : resolve(r)));
    if (!company || company.owner_id !== ownerId) return res.status(403).send('You do not own this company');

    if (pos.status !== 'in_progress') return res.status(400).send('Can only fire employees for in-progress positions');

    await new Promise((resolve, reject) => db.run('UPDATE company_positions SET status = ?, employee_id = NULL WHERE id = ?', ['available', positionId], (e) => e ? reject(e) : resolve()));

    res.redirect('/positionManager/' + encodeURIComponent(company.name));
  } catch (err) {
    console.error('Error firing employee from position:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
