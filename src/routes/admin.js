"use strict";
const express = require("express");
const router = express.Router();
const svc = require("../shopeePayService");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Simple auth middleware for admin routes
function authAdmin(req, res, next) {
  const pass = req.headers["x-admin-key"] || req.query.key;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

// GET /api/admin/stats — Dashboard stats
router.get("/stats", authAdmin, (req, res) => {
  try {
    const stats = svc.getStats();
    res.json({ success: true, data: stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/payments — Semua payment
router.get("/payments", authAdmin, (req, res) => {
  try {
    const payments = svc.getAllPayments();
    res.json({ success: true, data: payments });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/logs — Cron check logs
router.get("/logs", authAdmin, (req, res) => {
  try {
    const logs = svc.getRecentLogs();
    res.json({ success: true, data: logs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/check-now — Manual trigger cek
router.post("/check-now", authAdmin, async (req, res) => {
  try {
    const result = await svc.processPendingPayments();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/transactions — Live scrape dari ShopeePay
router.get("/transactions", authAdmin, async (req, res) => {
  try {
    const scraper = svc.getScraper();
    const now = Math.floor(Date.now() / 1000);
    const startTime = req.query.start
      ? Number(req.query.start)
      : now - 30 * 24 * 60 * 60;
    const endTime = req.query.end ? Number(req.query.end) : now;

    const result = await scraper.getTransactionList({
      pageSize: Number(req.query.limit || 50),
      startTime,
      endTime,
    });

    res.json({ success: result.success, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/login — Login admin
router.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ success: false, message: "Password salah" });
  }
});

module.exports = router;
