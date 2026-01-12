require('dotenv').config();
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const isAuthenticated = require('../middleware/isAuthenticated');

// Free route
router.get('/free', isAuthenticated, (req, res) => {
    res.render('free', { title: 'Free Lance Page' });
});

module.exports = router;