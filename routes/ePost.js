require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// GET /ePost/:companyName - render a form for company owners to create a new position
router.get('/ePost/:companyName', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const { companyName } = req.params;

  db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [companyName], (err, companyRow) => {
    if (err) {
      console.error('DB error fetching company:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (!companyRow) return res.status(404).send('Company not found');

    const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
    const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
    if (!requesterFb || requesterFb !== ownerFb) return res.redirect('/companies');

    res.render('ePost', { company: companyRow });
  });
});

// POST /ePost - create a new employment position and attach tags
router.post('/ePost', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};
  const { company, title, description, pay, tags } = body;

  if (!company || !title || !description) return res.status(400).send('Missing required fields');

  db.get('SELECT id, owner_id FROM companies WHERE name = ? COLLATE NOCASE', [company], (err, companyRow) => {
    if (err) {
      console.error('DB error fetching company:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (!companyRow) return res.status(404).send('Company not found');

    const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
    const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
    if (!requesterFb || requesterFb !== ownerFb) return res.status(403).send('Forbidden');

    // Insert the position using the company id from companyRow
    const companyId = companyRow.id;

    db.run('INSERT INTO company_positions (company_id, title, description, pay, status) VALUES (?, ?, ?, ?, ?)', [companyId, title, description, pay || 0, 'available'], function(err) {
      if (err) {
        console.error('Failed to insert position:', err);
        return res.status(500).send('Internal Server Error');
      }

      const positionId = this.lastID;

      // If tags provided, normalize and attach
      if (tags && String(tags).trim()) {
        const tagList = String(tags).split(',').map(t => t.trim()).filter(Boolean);

        (async function processTags() {
          for (const tagName of tagList) {
            try {
              await new Promise((resolve, reject) => {
                db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName], (e) => e ? reject(e) : resolve());
              });

              const tagRow = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM tags WHERE name = ?', [tagName], (e, row) => e ? reject(e) : resolve(row));
              });

              if (tagRow && tagRow.id) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO position_tags (position_id, tag_id) VALUES (?, ?)', [positionId, tagRow.id], (e) => e ? reject(e) : resolve());
                });
              }
            } catch (e) {
              console.error('Error attaching tag', tagName, e);
            }
          }
          return res.redirect(`/eJob/${encodeURIComponent(company)}`);
        })();
      } else {
        return res.redirect(`/eJob/${encodeURIComponent(company)}`);
      }
    });
  });
});

module.exports = router;
