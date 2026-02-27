require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const path = require('path');
const fs = require('fs');

// Serve uploaded application files to authorized users (company owners or managers)
router.get('/files/:fileId', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const fileId = req.params.fileId;
  const fb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;

  if (!fileId) return res.status(400).send('Missing file id');

  // Resolve file and associated company owner.
  // Some databases may not have `data`/`mime` columns yet (old installs). Use PRAGMA to check
  // and select only the columns that exist to avoid SQLITE_ERROR on missing columns.
  db.all("PRAGMA table_info('job_application_files')", (pErr, cols) => {
    if (pErr) { console.error('PRAGMA failed for job_application_files:', pErr); return res.status(500).send('Internal Server Error'); }
    const hasData = Array.isArray(cols) && cols.some(c => String(c.name).toLowerCase() === 'data');
    const hasMime = Array.isArray(cols) && cols.some(c => String(c.name).toLowerCase() === 'mime');

    // Build select list depending on schema
    const selectCols = ['f.path', 'f.original_name'];
    if (hasData) selectCols.push('f.data AS data');
    if (hasMime) selectCols.push('f.mime AS mime');
    selectCols.push('COALESCE(p.company_id, c2.id) as company_id');
    selectCols.push('COALESCE(c.owner_id, c2.owner_id) as owner_id');

    const q = `
      SELECT ${selectCols.join(', ')}
      FROM job_application_files f
      LEFT JOIN position_applications pa ON f.application_id = pa.id
      LEFT JOIN company_positions p ON pa.position_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      LEFT JOIN job_applications ja ON f.application_id = ja.id
      LEFT JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN companies c2 ON j.company = c2.name COLLATE NOCASE
      WHERE f.id = ?
    `;

    db.get(q, [fileId], (err, row) => {
    if (err) { console.error('Error fetching file record:', err); return res.status(500).send('Internal Server Error'); }
    if (!row) return res.status(404).send('File not found');

    // Allow if requester is owner or super-admin (fb === '1')
    if (!fb || (String(row.owner_id) !== String(fb) && fb !== '1')) {
      return res.status(403).send('Forbidden');
    }

    const inline = req.query && req.query.inline === '1';

  // If file data exists in DB (selected only if column exists), serve from DB
  if (row.data) {
      const mime = row.mime || 'application/octet-stream';
      if (inline) {
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${(row.original_name||'file').replace(/\"/g, '')}"`);
        try {
          return res.send(row.data);
        } catch (sErr) {
          if (sErr && (sErr.code === 'ECONNABORTED' || sErr.code === 'ECONNRESET')) return;
          console.error('Error sending inline file from DB:', sErr);
          return res.status(500).send('Internal Server Error');
        }
      }
      // download
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${(row.original_name||'file').replace(/\"/g, '')}"`);
      try {
        return res.send(row.data);
      } catch (dErr) {
        if (dErr && (dErr.code === 'ECONNABORTED' || dErr.code === 'ECONNRESET')) return;
        console.error('Error sending file from DB:', dErr);
        return res.status(500).send('Internal Server Error');
      }
    }

    // Fallback: serve from filesystem path (only if file exists)
    const abs = row.path ? path.resolve(row.path) : null;
    if (!abs || !fs.existsSync(abs)) {
      // File not stored in DB and filesystem copy is missing
      return res.status(404).send('File not found');
    }
    const ext = String(path.extname(row.original_name || '')).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';

    if (inline) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${row.original_name.replace(/\"/g, '')}"`);
      return res.sendFile(abs, (sErr) => {
        if (!sErr) return;
        if (sErr && (sErr.code === 'ECONNABORTED' || sErr.code === 'ECONNRESET')) return;
        console.error('Error sending inline file:', sErr);
      });
    }

    return res.download(abs, row.original_name, (dErr) => {
      if (!dErr) return;
      if (dErr && (dErr.code === 'ECONNABORTED' || dErr.code === 'ECONNRESET')) return;
      console.error('Error sending file:', dErr);
    });
  });
  });
  // end PRAGMA/db.get
});

module.exports = router;
