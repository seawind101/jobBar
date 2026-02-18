require('dotenv').config();
const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');

const AUTH_URL = process.env.AUTH_URL || '';

// Route: perform a transfer and mark job complete (owner-only)
router.post('/transfer/complete', isAuthenticated, async (req, res) => {
	const db = req.app.locals.db;
	const requesterFb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;

	const { jobId, to, amount, reason, pin } = req.body || {};

	if (!requesterFb) return res.status(403).json({ success: false, message: 'Not authenticated' });
	if (!jobId || !to || !amount) return res.status(400).json({ success: false, message: 'Missing required fields' });

	try {
		// Verify requester is company owner (or root admin '1') for this job
		const row = await new Promise((resolve, reject) => {
			db.get('SELECT j.*, c.owner_id FROM jobs j LEFT JOIN companies c ON j.company = c.name WHERE j.id = ?', [jobId], (err, r) => {
				if (err) return reject(err);
				resolve(r);
			});
		});

		if (!row) return res.status(404).json({ success: false, message: 'Job not found' });

		const ownerFb = row.owner_id !== undefined && row.owner_id !== null ? String(row.owner_id) : null;
		if (requesterFb !== ownerFb && requesterFb !== '1') {
			return res.status(403).json({ success: false, message: 'Forbidden: only company owner may complete this job' });
		}

		// Perform transfer to AUTH_URL
		const authUrl = AUTH_URL.replace(/\/$/, '');
		const transferUrl = authUrl ? `${authUrl}/api/digipogs/transfer` : '/api/digipogs/transfer';

		const transferBody = { from: requesterFb,
                               to: to,
                               amount: amount,
                               reason: reason || `Completed ${row.title || row.id}`,
                               pin: pin
        };

		const resp = await fetch(transferUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(transferBody)
		});

		const data = await resp.json().catch(() => ({}));

		if (!resp.ok && !(data && data.success)) {
			return res.status(502).json({ success: false, message: 'Transfer failed', details: data });
		}

		// On successful transfer, mark job complete (delete the job)
		const delResult = await new Promise((resolve, reject) => {
			db.run('DELETE FROM jobs WHERE id = ?', [jobId], function(err) {
				if (err) return reject(err);
				resolve({ changes: this.changes });
			});
		});

		return res.json({ success: true, transfer: data, deleted: delResult.changes });
	} catch (err) {
		console.error('Payment/transfer error:', err);
		return res.status(500).json({ success: false, message: 'Server error' });
	}
});



// --- Paid actions ---------------------------------------------------------
// POST /transfer/company - charge user to create a company (flat CPOST)
router.post('/transfer/company', isAuthenticated, async (req, res) => {
	const db = req.app.locals.db;
	const payer = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
	const pool = process.env.POOL ? String(process.env.POOL) : null;
	const amount = Number(process.env.CPOST || 300);

	const { name, description, link, pin } = req.body || {};
	if (!payer) return res.status(403).json({ success: false, message: 'Not authenticated' });
	if (!name || !description || !link) return res.status(400).json({ success: false, message: 'Missing company fields' });
	if (!pool) return res.status(500).json({ success: false, message: 'Payment pool not configured' });

	try {
		// Prevent duplicate company name (case-insensitive)
		const existing = await new Promise((resolve, reject) => db.get('SELECT id FROM companies WHERE name = ? COLLATE NOCASE', [name], (e, r) => e ? reject(e) : resolve(r)));
		if (existing) return res.status(409).json({ success: false, message: 'Company name already taken' });

		// Perform transfer from payer -> pool (inline)
		try {
			const authUrl = AUTH_URL.replace(/\/$/, '');
			const transferUrl = authUrl ? `${authUrl}/api/digipogs/transfer` : '/api/digipogs/transfer';
			const resp = await fetch(transferUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: payer,
                                       to: pool,
                                       amount, 
                                       reason: `Company creation: ${name}`, 
                                       pin: pin,
                                       pool: true })
			});
			var data = await resp.json().catch(() => ({}));
			if (!resp.ok && !(data && data.success)) return res.status(502).json({ success: false, message: 'Transfer failed', details: data });
		} catch (err) {
			console.error('Transfer error:', err);
			return res.status(502).json({ success: false, message: 'Transfer failed', details: err.message || String(err) });
		}

		// Payment succeeded — return success to client so client can POST to /post to create the company
		return res.json({ success: true, transfer: data });
	} catch (err) {
		console.error('Company payment error:', err);
		return res.status(500).json({ success: false, message: 'Server error' });
	}
});

// POST /transfer/job - charge owner to post a job (flat JPOST)
router.post('/transfer/job', isAuthenticated, async (req, res) => {
	const db = req.app.locals.db;
	const payer = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
	const pool = process.env.POOL ? String(process.env.POOL) : null;
	const amount = Number(process.env.JPOST || 100);

	const { company, title, description, pay, pin } = req.body || {};
	if (!payer) return res.status(403).json({ success: false, message: 'Not authenticated' });
	if (!company || !title || !description || !pay) return res.status(400).json({ success: false, message: 'Missing job fields' });
	if (!pool) return res.status(500).json({ success: false, message: 'Payment pool not configured' });

	try {
		// Check company exists and payer is owner
		const companyRow = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [company], (e, r) => e ? reject(e) : resolve(r)));
		if (!companyRow) return res.status(404).json({ success: false, message: 'Company not found' });

		const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
		if (payer !== ownerFb && payer !== '1') return res.status(403).json({ success: false, message: 'Forbidden: only company owner may post jobs with payment' });

		// Perform transfer from payer -> pool (inline)
		try {
			const authUrl = AUTH_URL.replace(/\/$/, '');
			const transferUrl = authUrl ? `${authUrl}/api/digipogs/transfer` : '/api/digipogs/transfer';
			const resp = await fetch(transferUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: payer, 
                                       to: pool, 
                                       amount: amount, 
                                       reason: `Job post: ${title} @ ${company}`, 
                                       pin: pin,
                                       pool: true })
			});
			var data = await resp.json().catch(() => ({}));
			if (!resp.ok && !(data && data.success)) return res.status(502).json({ success: false, message: 'Transfer failed', details: data });
		} catch (err) {
			console.error('Transfer error:', err);
			return res.status(502).json({ success: false, message: 'Transfer failed', details: err.message || String(err) });
		}

		// Payment succeeded — return success to client so client can POST to /jobPosts to create the job
		return res.json({ success: true, transfer: data });
	} catch (err) {
		console.error('Job payment error:', err);
		return res.status(500).json({ success: false, message: 'Server error' });
	}
});

module.exports = router;
