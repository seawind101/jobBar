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
const db = new sqlite3.Database('./database/database.sqlite', (error) => {
    if (error) {
        console.log(error);
    } else {
        console.log('Connected to database');
        // Create users table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            fb_id TEXT UNIQUE
        )`, (err) => {
            if (err) {
                console.error('Error creating users table:', err);
            } else {
                console.log('Users table ready');
            }
        });
    }
});

// Make database available to other modules
app.locals.db = db;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse JSON bodies
app.use(express.json());


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
const freeRouter = require('./routes/free');
const linksRouter = require('./routes/links');
app.use('/', indexRouter);
app.use('/', loginRouter);
app.use('/', freeRouter);
app.use('/', linksRouter);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

module.exports = app;