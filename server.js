"use strict";
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const db = require("./src/db");
const shopeePayService = require("./src/shopeePayService");
const paymentRoutes = require("./src/routes/payment");
const adminRoutes = require("./src/routes/admin");
const webhookRoutes = require("./src/routes/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

// ──── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Static files (admin dashboard)
app.use(express.static(path.join(__dirname, "public")));

// ──── Routes ────────────────────────────────────────────────────
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhook", webhookRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ShopeePay Check System Running",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Serve admin dashboard for all unmatched routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ──── Background Cron: Check Pending Payments ────────────────────
// Jalan setiap 30 detik
cron.schedule("*/30 * * * * *", async () => {
  try {
    await shopeePayService.processPendingPayments();
  } catch (err) {
    console.error("[CRON] Error:", err.message);
  }
});

// ──── Start Server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   ShopeePay Payment Check System v2.0           ║");
  console.log(`║   Server     : http://localhost:${PORT}             ║`);
  console.log(`║   Dashboard  : http://localhost:${PORT}/             ║`);
  console.log("║   Cron       : setiap 30 detik                  ║");
  console.log("╚══════════════════════════════════════════════════╝");
});

module.exports = app;
