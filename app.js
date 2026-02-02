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

// Parse managers from environment (accept formats like: [ 43, 48 ] or "43,48")
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
    next();
});

// Routes
const indexRouter = require('./routes/index');
const loginRouter = require('./routes/login');
const companiesRouter = require('./routes/companies');
const postRouter = require('./routes/post');
const jobPostsRouter = require('./routes/jobPosts');
const jobRouter = require('./routes/job');
const payRouter = require('./socket/pay');
app.use('/', indexRouter);
app.use('/', loginRouter);
app.use('/', companiesRouter);
app.use('/', postRouter);
app.use('/', jobPostsRouter);
app.use('/', jobRouter);
app.use('/', payRouter);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;