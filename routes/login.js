const router = require('express').Router();
const jwt = require('jsonwebtoken');
const AUTH_URL = process.env.AUTH_URL || 'localhost:4000/auth';
const THIS_URL = process.env.THIS_URL || 'http://localhost:3000/login';
const db = new sqlite3.Database('./database/database.sqlite', (error) => {
    if (error) {
        console.log(error);
    }
});

router.get('/login', (req, res) => {
    const db = req.app.locals.db; // Get shared database connection
    
    if (req.query.token) {
        let tokenData = jwt.decode(req.query.token);
        req.session.token = tokenData;
        req.session.user = tokenData.displayName;
        req.session.fb_id = tokenData.id;

        db.get("SELECT * FROM users WHERE fb_id = ?", [tokenData.id], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Database error');
            }
            if (!row) {
                db.run("INSERT INTO users (username, fb_id) VALUES (?, ?)",
                    [tokenData.displayName, tokenData.id], (err) => {
                        if (err) {
                            console.error('Error inserting user:', err);
                            return res.status(500).send('Error creating user');
                        }
                        res.redirect('/');
                    });
            } else {
                res.redirect('/');
            }
        });
    } else {
        res.redirect(`${AUTH_URL}/oauth?redirectURL=${THIS_URL}`);
    }
});

module.exports = router;