"use strict";
const express = require("express");
const router = express.Router();

// POST /api/webhook/shoppepay — External webhook (for future use)
router.post("/shoppepay", (req, res) => {
  console.log("[WEBHOOK] Received:", JSON.stringify(req.body));
  res.status(200).json({ success: true, message: "OK" });
});

module.exports = router;
