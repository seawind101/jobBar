require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const path = require('path');
const fs = require('fs');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse JSON bodies
app.use(express.json());


// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

