require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const AUTH_URL = process.env.AUTH_URL || 'localhost:4000/auth';
const THIS_URL = process.env.THIS_URL || 'http://localhost:3000/login';

const db = new sqlite3.Database('./database/database.sqlite', (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to database');
    }
});

// Make database available to other modules
app.locals.db = db;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));




app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false
}));

// Parse managers from environment
const rawManagers = process.env.managers || process.env.MANAGERS || '';
let parsedManagers = [];
try {
    const s = String(rawManagers).trim();
    if (!s) parsedManagers = [];
    else if (s.startsWith('[') && s.endsWith(']')) {
        // try JSON parse
        parsedManagers = JSON.parse(s).map(String);
    } else if (s.indexOf(',') !== -1) {
        parsedManagers = s.split(',').map(x => x.trim()).filter(Boolean).map(String);
    } else {
        parsedManagers = [s.replace(/\s+/g, '')].filter(Boolean).map(String);
    }
} catch (err) {
    // fallback: try to extract numbers
    parsedManagers = (String(rawManagers).match(/\d+/g) || []).map(String);
}

// expose manager list and current user's fb_id/isManager to all views
app.use((req, res, next) => {
    res.locals.managers = parsedManagers;
    const fb = req.session && req.session.fb_id;
    res.locals.fb_id = fb || null;
    res.locals.isManager = fb ? parsedManagers.includes(String(fb)) : false;
    // expose configured payment amounts to views
    res.locals.CPOST = Number(process.env.CPOST || 300);
    res.locals.JPOST = Number(process.env.JPOST || 100);
    next();
});
// expose helpers to check company ownership/permission
app.use((req, res, next) => {
    const fb = req.session && req.session.fb_id ? String(req.session.fb_id) : null;

    // Promise-based check: resolves true if fb is 1 (super user) or matches company owner_id
    req.canManageCompany = (companyId) => {
        return new Promise((resolve, reject) => {
            if (!fb) return resolve(false);
            if (fb === '1') return resolve(true);
            if (!companyId) return resolve(false);

            const id = String(companyId).replace(/^\/|\/$/g, ''); // normalize if a path slipped in
            db.get('SELECT owner_id FROM companies WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(false);
                resolve(String(row.owner_id) === fb);
            });
        });
    };

    // convenience middleware helper for routes/views (note: this is async and should be awaited in routes)
    req.ensureCanManageCompany = async (companyId) => {
        const ok = await req.canManageCompany(companyId).catch(() => false);
        if (!ok) {
            const err = new Error('Forbidden');
            err.status = 403;
            throw err;
        }
    };

    // expose a non-async hint to views (best-effort; actual checks should use req.canManageCompany in routes)
    res.locals.canManageCompanyHint = (companyId) => {
        if (!fb) return false;
        if (fb === '1') return true;
        // unknown until checked against DB, so return null to indicate "unknown"
        return null;
    };

    next();
});

// Routes
const indexRouter = require('./routes/index');
const loginRouter = require('./routes/login');
const companiesRouter = require('./routes/companies');
const postRouter = require('./routes/post');
const jobPostsRouter = require('./routes/jobPosts');
const jobRouter = require('./routes/job');
const payRouter = require('./routes/payment');
const jobManagerRouter = require('./routes/jobManager');
const allJobsRouter = require('./routes/allJobs');
const editRouter = require('./routes/edit');

// Register routes
app.use('/', editRouter);
app.use('/', indexRouter);
app.use('/', loginRouter);
app.use('/', companiesRouter);
app.use('/', postRouter);
app.use('/', jobPostsRouter);
app.use('/', allJobsRouter);
app.use('/', jobRouter);
app.use('/', payRouter);
app.use('/', jobManagerRouter);


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;