'use strict';

const express = require('express');

const {
  proposeTimeChange,
  respondToTimeChange,
} = require('../controllers/bookingTimeChange.controller');

// Your existing auth middleware: must set req.user = { _id, role, salonId? }.
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Owner action. If you already have this route, do NOT add a second one —
 * instead call `proposeTimeChange` from the DELAY branch of your existing
 * handler:
 *
 *   if (action === 'DELAY') return proposeTimeChange(req, res);
 *
 * The dispatcher below is what that looks like written out, with ACCEPT and
 * REJECT delegated to whatever you already have.
 */
router.post('/owner-action/:bookingRequestId/', requireAuth, async (req, res, next) => {
  const action = String(req.body?.action || '').toUpperCase();

  if (action === 'DELAY') return proposeTimeChange(req, res);

  // Hand ACCEPT / REJECT to your existing controller.
  return next();
});

// The customer's answer to a proposed time.
router.post('/customer-delay-response/:bookingRequestId/', requireAuth, respondToTimeChange);

module.exports = router;
