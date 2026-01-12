require('dotenv').config();
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const isAuthenticated = require('../middleware/isAuthenticated');

// Links route
router.get('/links', isAuthenticated, (req, res) => {
    res.render('links', { title: 'Links Page' });
});
module.exports = router;