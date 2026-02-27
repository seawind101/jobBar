require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// We store uploaded PDFs/PNGs in the database (BLOB) rather than writing to disk.
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Show the application form for a specific job (query ?jobId=...)
router.get('/eform', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const fb_id = req.session.fb_id;
  const jobId = req.query.jobId;
  const positionId = req.query.positionId;
  if (!fb_id) return res.status(403).send('Forbidden');

  if (positionId) {
    // Render application form for a position
    db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (err, position) => {
      if (err) { console.error(err); return res.status(500).send('Internal Server Error'); }
      if (!position) return res.status(404).send('Position not found');

      db.get('SELECT * FROM companies WHERE id = ?', [position.company_id], (err2, company) => {
        if (err2) { console.error(err2); return res.status(500).send('Internal Server Error'); }
        res.render('Eform', { position, company });
      });
    });
    return;
  }

  if (!jobId) return res.status(400).send('Missing jobId');

  db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, job) => {
    if (err) { console.error(err); return res.status(500).send('Internal Server Error'); }
    if (!job) return res.status(404).send('Job not found');

    db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [job.company], (err2, company) => {
      if (err2) { console.error(err2); return res.status(500).send('Internal Server Error'); }
      res.render('Eform', { job, company });
    });
  });
});

// Handle form submission with file uploads
router.post('/eform', isAuthenticated, upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'portfolio', maxCount: 10 },
  { name: 'cover_letter', maxCount: 1 }
]), async (req, res) => {
  const db = req.app.locals.db;
  const fb_id = req.session.fb_id ? String(req.session.fb_id) : null;
  const { jobId, positionId, first_name, last_name } = req.body;

  if (!fb_id) return res.status(403).send('Forbidden');
  if (!jobId && !positionId) return res.status(400).send('Missing jobId or positionId');

  try {
    // Ensure job_applicant_details has portfolio_link column (non-destructive)
    await new Promise((resolve, reject) => {
      db.all("PRAGMA table_info('job_applicant_details')", (err, cols) => {
        if (err) return reject(err);
        const hasPortfolio = Array.isArray(cols) && cols.some(c => String(c.name).toLowerCase() === 'portfolio_link');
        if (hasPortfolio) return resolve();
        db.run("ALTER TABLE job_applicant_details ADD COLUMN portfolio_link TEXT", (aErr) => aErr ? reject(aErr) : resolve());
      });
    }).catch((e) => {
      // Not fatal; log and continue
      if (e) console.warn('Could not ensure portfolio_link column:', e.message || e);
    });

    // Ensure job_application_files has data and mime columns (non-destructive)
    await new Promise((resolve, reject) => {
      db.all("PRAGMA table_info('job_application_files')", (err, cols) => {
        if (err) return reject(err);
        const hasData = Array.isArray(cols) && cols.some(c => String(c.name).toLowerCase() === 'data');
        const hasMime = Array.isArray(cols) && cols.some(c => String(c.name).toLowerCase() === 'mime');
        if (hasData && hasMime) return resolve();
        // Add missing columns (SQLite allows ADD COLUMN)
        const addOps = [];
        if (!hasData) addOps.push("ALTER TABLE job_application_files ADD COLUMN data BLOB");
        if (!hasMime) addOps.push("ALTER TABLE job_application_files ADD COLUMN mime TEXT");
        (function runNext(i){
          if (i >= addOps.length) return resolve();
          db.run(addOps[i], (aErr) => aErr ? reject(aErr) : runNext(i+1));
        })(0);
      });
    }).catch((e)=>{ if (e) console.warn('Could not ensure job_application_files data/mime columns:', e.message || e); });

    // helpers
    const files = req.files || {};
    const isPdfOrPng = (f) => {
      if (!f) return false;
      const mime = f.mimetype || '';
      const name = f.originalname || '';
      return mime === 'application/pdf' || mime === 'image/png' || /\.pdf$/i.test(name) || /\.png$/i.test(name);
    };
    const isPng = (f) => {
      if (!f) return false;
      const mime = f.mimetype || '';
      const name = f.originalname || '';
      return mime === 'image/png' || /\.png$/i.test(name);
    };

    const insertApplicantDetails = (applicationId) => new Promise((resolve, reject) => {
      const portfolioLinksValue = req.body && req.body.portfolio_links ? String(req.body.portfolio_links).trim() : null;
      db.run('INSERT INTO job_applicant_details (application_id, first_name, last_name, portfolio_link) VALUES (?, ?, ?, ?)', [applicationId, first_name || '', last_name || '', portfolioLinksValue], (err) => {
        if (err) {
          // fallback if column missing
          db.run('INSERT INTO job_applicant_details (application_id, first_name, last_name) VALUES (?, ?, ?)', [applicationId, first_name || '', last_name || ''], (err2) => err2 ? reject(err2) : resolve());
        } else resolve();
      });
    });

    const saveFileMetadata = async (applicationId) => {
      // resume
      if (files.resume && files.resume[0]) {
        const r = files.resume[0];
        if (!isPdfOrPng(r)) { return res.status(400).send('Resume must be a PDF or PNG file.'); }
        await new Promise((resolve, reject) => db.run('INSERT INTO job_application_files (application_id, field, path, original_name, data, mime) VALUES (?, ?, ?, ?, ?, ?)', [applicationId, 'resume', null, r.originalname, r.buffer, r.mimetype], (e) => e ? reject(e) : resolve()));
      }

      // cover letter
      if (files.cover_letter && files.cover_letter[0]) {
        const c = files.cover_letter[0];
        if (!isPdfOrPng(c)) { return res.status(400).send('Cover letter must be a PDF or PNG file.'); }
        await new Promise((resolve, reject) => db.run('INSERT INTO job_application_files (application_id, field, path, original_name, data, mime) VALUES (?, ?, ?, ?, ?, ?)', [applicationId, 'cover_letter', null, c.originalname, c.buffer, c.mimetype], (e) => e ? reject(e) : resolve()));
      }

      // portfolio files (PNG only)
      if (files.portfolio && files.portfolio.length > 0) {
        for (const pf of files.portfolio) {
          if (!isPng(pf)) { return res.status(400).send('Portfolio uploads must be PNG images only.'); }
          await new Promise((resolve, reject) => db.run('INSERT INTO job_application_files (application_id, field, path, original_name, data, mime) VALUES (?, ?, ?, ?, ?, ?)', [applicationId, 'portfolio', null, pf.originalname, pf.buffer, pf.mimetype], (e) => e ? reject(e) : resolve()));
        }
      }
    };

    // flow for position applications
    if (positionId) {
      await new Promise((resolve, reject) => db.run('INSERT OR IGNORE INTO position_applications (position_id, fb_id) VALUES (?, ?)', [positionId, fb_id], (e) => e ? reject(e) : resolve()));
      const appRow = await new Promise((resolve, reject) => db.get('SELECT id FROM position_applications WHERE position_id = ? AND fb_id = ?', [positionId, fb_id], (e, r) => e ? reject(e) : resolve(r)));
      const applicationId = appRow && appRow.id ? appRow.id : null;
      if (!applicationId) return res.status(500).send('Failed to create application');

      await insertApplicantDetails(applicationId);
      await saveFileMetadata(applicationId);

      // mark position as having applications (so managers see it in Applied column)
      try {
        await new Promise((resolve, reject) => db.run("UPDATE company_positions SET status = ? WHERE id = ? AND (status IS NULL OR status = '' OR status = 'available')", ['applied', positionId], (uErr) => uErr ? reject(uErr) : resolve()));
      } catch (uErr) {
        console.warn('Could not update position status to applied:', uErr && uErr.message);
      }

      const position = await new Promise((resolve, reject) => db.get('SELECT * FROM company_positions WHERE id = ?', [positionId], (e, r) => e ? reject(e) : resolve(r)));
      const companyRow = position ? await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE id = ?', [position.company_id], (e, r) => e ? reject(e) : resolve(r))) : null;
      const companyName = companyRow ? companyRow.name : '';
      return res.redirect('/eJob/' + encodeURIComponent(companyName));
    }

    // job flow
    await new Promise((resolve, reject) => db.run('INSERT OR IGNORE INTO job_applications (job_id, fb_id) VALUES (?, ?)', [jobId, fb_id], (e) => e ? reject(e) : resolve()));
    const jobAppRow = await new Promise((resolve, reject) => db.get('SELECT id FROM job_applications WHERE job_id = ? AND fb_id = ?', [jobId, fb_id], (e, r) => e ? reject(e) : resolve(r)));
    const applicationId = jobAppRow && jobAppRow.id ? jobAppRow.id : null;
    if (!applicationId) return res.status(500).send('Failed to create application');

    await insertApplicantDetails(applicationId);
    await saveFileMetadata(applicationId);

    const job = await new Promise((resolve, reject) => db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (e, r) => e ? reject(e) : resolve(r)));
    const companyName = job ? job.company : '';
    res.redirect('/job/' + encodeURIComponent(companyName));
  } catch (err) {
    console.error('Eform submission error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
