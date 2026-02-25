require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Show the application form for a specific job (query ?jobId=...)
router.get('/eform', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const fb_id = req.session.fb_id;
  const jobId = req.query.jobId;
  if (!fb_id) return res.status(403).send('Forbidden');
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
  { name: 'portfolio', maxCount: 1 },
  { name: 'cover_letter', maxCount: 1 }
]), async (req, res) => {
  const db = req.app.locals.db;
  const fb_id = req.session.fb_id ? String(req.session.fb_id) : null;
  const { jobId, first_name, last_name } = req.body;

  if (!fb_id) return res.status(403).send('Forbidden');
  if (!jobId) return res.status(400).send('Missing jobId');

  try {
    // make necessary tables for storing application metadata (if they don't exist)
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS job_application_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        field TEXT,
        path TEXT,
        original_name TEXT
      )`, (err) => err ? reject(err) : resolve());
    });

    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS job_applicant_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        first_name TEXT,
        last_name TEXT
      )`, (err) => err ? reject(err) : resolve());
    });

    // Insert or ignore application row
    await new Promise((resolve, reject) => {
      db.run('INSERT OR IGNORE INTO job_applications (job_id, fb_id) VALUES (?, ?)', [jobId, fb_id], function(err) {
        if (err) reject(err); else resolve();
      });
    });

    // get application id
    const appRow = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM job_applications WHERE job_id = ? AND fb_id = ?', [jobId, fb_id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    const applicationId = appRow && appRow.id ? appRow.id : null;

    if (!applicationId) {
      return res.status(500).send('Failed to create application');
    }

    // store applicant name details
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO job_applicant_details (application_id, first_name, last_name) VALUES (?, ?, ?)', [applicationId, first_name || '', last_name || ''], (err) => {
        if (err) reject(err); else resolve();
      });
    });

    // store uploaded files metadata
    const files = req.files || {};
    const fileEntries = [];
    ['resume','portfolio','cover_letter'].forEach(field => {
      if (files[field] && files[field][0]) {
        const f = files[field][0];
        fileEntries.push({ field, path: f.path, original_name: f.originalname });
      }
    });

    for (const fe of fileEntries) {
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO job_application_files (application_id, field, path, original_name) VALUES (?, ?, ?, ?)', [applicationId, fe.field, fe.path, fe.original_name], (err) => {
          if (err) reject(err); else resolve();
        });
      });
    }

    // fetch job to get company name for redirect
    const job = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    const companyName = job ? job.company : '';
    res.redirect('/job/' + encodeURIComponent(companyName));
  } catch (err) {
    console.error('Eform submission error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
