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
const isAuthenticated = require('./middleware/isAuthenticated');
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

// Middleware to parse request bodies
app.use(express.json());
// Parse URL-encoded bodies (HTML form submissions)
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false
}));

// Routes
const indexRouter = require('./routes/index');
const loginRouter = require('./routes/login');
const companiesRouter = require('./routes/companies');
const postRouter = require('./routes/post');
const jobPostsRouter = require('./routes/jobPosts');
app.use('/', indexRouter);
app.use('/', loginRouter);
app.use('/', companiesRouter);
app.use('/', postRouter);
app.use('/', jobPostsRouter);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;