require('dotenv').config();
const router = require('express').Router();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const isAuthenticated = require('../middleware/isAuthenticated');

// Open a DB handle (avoid circular requires)
const dbFile = path.resolve(__dirname, '../database/database.sqlite');
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error('Failed to open database in home route:', err);
});

// Per-company home page: shows company info, owner, employees and counts for open jobs/positions
router.get('/home/:companyName', isAuthenticated, (req, res) => {
    const companyName = req.params.companyName; // express decodes URL parts

    // Fetch all companies for the header/listing (keeps parity with other pages)
    db.all('SELECT * FROM companies ORDER BY id DESC', [], (cErr, companies) => {
        if (cErr) {
            console.error('Error fetching companies for home:', cErr);
            return res.status(500).send('Internal Server Error');
        }

        // Find the requested company by name (case-insensitive)
        const selectedCompany = (companies || []).find(c => String(c.name).toLowerCase() === String(companyName).toLowerCase());
        if (!selectedCompany) {
            return res.status(404).send('Company not found');
        }

        // Owner info
        db.get('SELECT fb_id, username FROM users WHERE fb_id = ?', [selectedCompany.owner_id], (oErr, ownerRow) => {
            if (oErr) {
                console.error('Error fetching owner for company home:', oErr);
                return res.status(500).send('Internal Server Error');
            }

            // Employees list
            db.all('SELECT ce.fb_id as fb_id, u.username as username FROM company_employees ce LEFT JOIN users u ON u.fb_id = ce.fb_id WHERE ce.company_id = ?', [selectedCompany.id], (eErr, employees) => {
                if (eErr) {
                    console.error('Error fetching company employees:', eErr);
                    return res.status(500).send('Internal Server Error');
                }

                // Open jobs count: jobs for this company that are not assigned to an employee
                db.get('SELECT COUNT(*) AS openJobs FROM jobs WHERE company = ? AND (employee_id IS NULL OR employee_id = "")', [selectedCompany.name], (jErr, jobCountRow) => {
                    if (jErr) {
                        console.error('Error counting open jobs for company:', jErr);
                        return res.status(500).send('Internal Server Error');
                    }

                    // Open positions count: use the same status filter other routes use ('available','applied')
                    db.get('SELECT COUNT(*) AS openPositions FROM company_positions WHERE company_id = ? AND status IN (?, ?)', [selectedCompany.id, 'available', 'applied'], (pErr, posCountRow) => {
                        if (pErr) {
                            console.error('Error counting open positions for company:', pErr);
                            return res.status(500).send('Internal Server Error');
                        }

                        return res.render('home', {
                            user: req.user,
                            companies,
                            company: selectedCompany,
                            owner: ownerRow || null,
                            employees: employees || [],
                            openJobsCount: (jobCountRow && jobCountRow.openJobs) || 0,
                            openPositionsCount: (posCountRow && posCountRow.openPositions) || 0,
                            fb_id: req.session && req.session.fb_id
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;
