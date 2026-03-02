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

// POST /ePost - create a new employment position and attach tags (only after payment succeeds)
router.post('/ePost', isAuthenticated, async (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};

  // Manager check
  if (!res.locals || !res.locals.isManager) {
    return res.status(403).json({ success: false, message: 'Forbidden: not a manager' });
  }

  const { company, title, description, tags, paymentVerified } = body;

  // Validate required fields
  if (!company || !title || !description) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Security check: Only allow position creation if payment was verified
  // This token is only sent by the client after successful payment
  if (paymentVerified !== 'true') {
    return res.status(402).json({ 
      success: false, 
      message: 'Payment required. Position creation requires successful payment.' 
    });
  }

  try {
    // Verify company exists and user is owner
    const companyRow = await new Promise((resolve, reject) => {
      db.get('SELECT id, owner_id FROM companies WHERE name = ? COLLATE NOCASE', [company], (err, row) => {
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

    const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
    if (String(ownerId) !== ownerFb) {
      return res.status(403).json({ success: false, message: 'You do not own this company' });
    }

    const companyId = companyRow.id;

    // Insert the position
    const positionId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO company_positions (company_id, title, description, status) VALUES (?, ?, ?, ?)',
        [companyId, title, description, 'available'],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });

    // If tags provided, normalize and attach
    if (tags && String(tags).trim()) {
      const tagList = String(tags).split(',').map(t => t.trim()).filter(Boolean);

      for (const tagName of tagList) {
        try {
          // Insert tag if it doesn't exist
          await new Promise((resolve, reject) => {
            db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName], (e) => e ? reject(e) : resolve());
          });

          // Get tag ID
          const tagRow = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM tags WHERE name = ?', [tagName], (e, row) => e ? reject(e) : resolve(row));
          });

          // Link position to tag
          if (tagRow && tagRow.id) {
            await new Promise((resolve, reject) => {
              db.run('INSERT OR IGNORE INTO position_tags (position_id, tag_id) VALUES (?, ?)', [positionId, tagRow.id], (e) => e ? reject(e) : resolve());
            });
          }
        } catch (e) {
          console.error('Error attaching tag', tagName, e);
        }
      }
    }

    return res.json({ success: true, message: 'Position created successfully' });
  } catch (err) {
    console.error('Error creating position:', err);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
});

module.exports = router;
