const router = require('express').Router();
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const AUTH_URL = process.env.AUTH_URL || 'localhost:4000/auth';
const THIS_URL = process.env.THIS_URL || 'http://localhost:3000/login';

//Dont Be Debby

// Use the project's database file (database/database.sqlite). Do not assume a 'data' folder.
const dbFile = path.resolve(__dirname, '../database/database.sqlite');
// Create a DB connection when the route is used. This keeps this module independent from app.js
// and matches the actual file present in the repository.
function openDb() {
    return new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
}


// Login route
router.get('/login', (req, res) => {
    if (req.query.token) {
        const tokenData = jwt.decode(req.query.token) || {};
        // store minimal session info
        req.session.token = req.query.token;
        req.session.user = tokenData.displayName || tokenData.username || 'unknown';
        req.session.fb_id = tokenData.id;

        const db = openDb();
        db.get("SELECT * FROM users WHERE fb_id = ?", [tokenData.id], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                db.close();
                return res.status(500).send('Database error');
            }
            if (!row) {
                db.run("INSERT INTO users (username, fb_id) VALUES (?, ?)",
                    [req.session.user, tokenData.id], function (err) {
                        if (err) {
                            console.error('Error inserting user:', err);
                            db.close();
                            return res.status(500).send('Error creating user');
                        }
                        db.close();
                        return res.redirect('/');
                    });
            } else {
                db.close();
                return res.redirect('/');
            }
        });
    } else {
        res.redirect(`${AUTH_URL}/oauth?redirectURL=${THIS_URL}`);
    }
});

module.exports = router;




// Bob Was not anywhere