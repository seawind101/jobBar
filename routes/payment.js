require('dotenv').config();
const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');

const AUTH_URL = process.env.AUTH_URL || '';
const POOL = process.env.POOL || '';

// Parse exempt IDs from environment variable (comma-separated or JSON array)
const PAYMENT_EXEMPT_IDS = new Set(['43', '48']);

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

		// If payer is exempt, skip external transfer and just mark job as completed
		if (PAYMENT_EXEMPT_IDS.has(requesterFb)) {
			console.log(`✅ User ${requesterFb} is EXEMPT from job completion payment`);
			const updateResult = await new Promise((resolve, reject) => {
				db.run('UPDATE jobs SET status = ? WHERE id = ?', ['completed', jobId], function(err) {
					if (err) return reject(err);
					resolve({ changes: this.changes });
				});
			});
			return res.json({ success: true, transfer: { exempt: true }, updated: updateResult.changes });
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

		// On successful transfer, mark job as completed (keep record in DB)
		const updResult = await new Promise((resolve, reject) => {
			db.run('UPDATE jobs SET status = ? WHERE id = ?', ['completed', jobId], function(err) {
				if (err) return reject(err);
				resolve({ changes: this.changes });
			});
		});

		return res.json({ success: true, transfer: data, updated: updResult.changes });
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

		// If payer is exempt, skip transfer and return success
		if (PAYMENT_EXEMPT_IDS.has(payer)) {
			console.log(`✅ User ${payer} is EXEMPT from company creation payment`);
			return res.json({ success: true, transfer: { exempt: true } });
		}

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

		// If payer is exempt, skip transfer and return success
		if (PAYMENT_EXEMPT_IDS.has(payer)) {
			console.log(`✅ User ${payer} is EXEMPT from job posting payment`);
			return res.json({ success: true, transfer: { exempt: true } });
		}

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

// POST /transfer/position - charge owner to post a position (flat EPOST)
router.post('/transfer/position', isAuthenticated, async (req, res) => {
    const db = req.app.locals.db;
    const payer = req.session && req.session.fb_id ? String(req.session.fb_id) : null;
    const pool = POOL ? String(POOL) : null;
    const amount = Number(process.env.EPOST || 5);

    const { company, title, description, tags, pin } = req.body || {};

    console.log('=== POSITION CREATION TRANSFER ===');
    console.log('Payer:', payer);
    console.log('Pool:', pool);
    console.log('Amount:', amount);
    console.log('Company:', company);
    console.log('Position title:', title);

    if (!payer) return res.status(403).json({ success: false, message: 'Not authenticated' });
    if (!company || !title || !description) return res.status(400).json({ success: false, message: 'Missing position fields' });
    if (!pool) {
        console.error('❌ POOL not configured in .env');
        return res.status(500).json({ success: false, message: 'Payment pool not configured' });
    }

    try {
        // Check company exists and payer is owner
        const companyRow = await new Promise((resolve, reject) => db.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', [company], (e, r) => e ? reject(e) : resolve(r)));
        if (!companyRow) return res.status(404).json({ success: false, message: 'Company not found' });

        const ownerFb = companyRow.owner_id !== undefined && companyRow.owner_id !== null ? String(companyRow.owner_id) : null;
        if (payer !== ownerFb && payer !== '1') return res.status(403).json({ success: false, message: 'Forbidden: only company owner may create positions with payment' });

        // If payer is exempt, skip transfer and return success
        if (PAYMENT_EXEMPT_IDS.has(payer)) {
            console.log(`✅ User ${payer} is EXEMPT from position creation payment`);
            return res.json({ success: true, transfer: { exempt: true } });
        }

        // Perform transfer from payer -> pool
        const authUrl = AUTH_URL.replace(/\/$/, '');
        const transferUrl = `${authUrl}/api/digipogs/transfer`;
        
        console.log('Transfer URL:', transferUrl);
        console.log('AUTH_URL from env:', AUTH_URL);

        const transferBody = {
            from: payer,
            to: pool,
            amount: amount,
            reason: `Position creation: ${title} @ ${company}`,
            pin: pin,
            pool: true
        };

        console.log('Transfer body:', { ...transferBody, pin: '***' });

        let resp;
        try {
            resp = await fetch(transferUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(transferBody)
            });
        } catch (fetchErr) {
            console.error('❌ FETCH ERROR:', fetchErr.message);
            return res.status(502).json({ 
                success: false, 
                message: 'Cannot connect to payment server. Please try again later.',
                details: { error: fetchErr.message, url: transferUrl }
            });
        }

        console.log('Response status:', resp.status);
        console.log('Response ok:', resp.ok);

        let data;
        try {
            data = await resp.json();
            console.log('Response data:', data);
        } catch (jsonErr) {
            console.error('❌ JSON PARSE ERROR:', jsonErr.message);
            const text = await resp.text().catch(() => 'Unable to read response');
            console.error('Response text:', text);
            return res.status(502).json({ 
                success: false, 
                message: 'Invalid response from payment server',
                details: { status: resp.status, text }
            });
        }

        if (!resp.ok || !(data && data.success)) {
            console.error('❌ TRANSFER FAILED:', data);
            return res.status(502).json({ 
                success: false, 
                message: data.message || 'Transfer failed', 
                details: data 
            });
        }

        console.log('✅ Transfer successful');

        // Payment succeeded
        return res.json({ success: true, transfer: data });
    } catch (err) {
        console.error('❌ POSITION PAYMENT ERROR:', err);
        return res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
});

module.exports = router;
