require('dotenv').config();
const router = require('express').Router();
const isAuthenticated = require('../middleware/isAuthenticated');

// Apply to a position
router.post('/position/:positionId/apply', isAuthenticated, (req, res) => {
  const db = req.app.locals.db;
  const positionId = req.params.positionId;
  const fbId = req.session.fb_id;

  if (!fbId) return res.status(400).send('User not identified');

  // Redirect applicant to the application form so they can upload files
  // The eform POST handler will create the application row and save files.
  return res.redirect(`/eform?positionId=${encodeURIComponent(positionId)}`);
});

module.exports = router;
