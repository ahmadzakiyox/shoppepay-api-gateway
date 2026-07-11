"use strict";
require("dotenv").config();

const fs = require("fs");
const path = require("path");

// Supabase sync configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.db");

async function downloadDbFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log("[SUPABASE] Kredensial tidak lengkap, menggunakan DB lokal.");
    return;
  }
  try {
    console.log("[SUPABASE] Mengunduh database SQLite dari Supabase...");
    const url = `${SUPABASE_URL}/rest/v1/system_config?key=eq.shoppepay_sqlite_db&select=value`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Accept': 'application/json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0 && data[0].value) {
        const dbBuffer = Buffer.from(data[0].value, 'base64');
        
        // Ensure the directory exists
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(DB_PATH, dbBuffer);
        console.log("[SUPABASE] Database berhasil sinkron dari cloud!");
      } else {
        console.log("[SUPABASE] Database kosong di cloud, memulai database baru.");
      }
    } else {
      console.log("[SUPABASE] Gagal mengunduh database dari cloud, status:", res.status);
    }
  } catch (err) {
    console.error("[SUPABASE] Error mengunduh database:", err.message);
  }
}

async function uploadDbToSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const dbBuffer = fs.readFileSync(DB_PATH);
    const base64 = dbBuffer.toString('base64');

    const url = `${SUPABASE_URL}/rest/v1/system_config`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        key: 'shoppepay_sqlite_db',
        value: base64
      })
    });
    if (!res.ok) {
      console.error("[SUPABASE] Gagal mencadangkan database ke cloud, status:", res.status);
    }
  } catch (err) {
    console.error("[SUPABASE] Error mencadangkan database:", err.message);
  }
}

// Throttle/debounce function for auto backup
let backupTimeout = null;
function triggerCloudBackup() {
  if (backupTimeout) clearTimeout(backupTimeout);
  backupTimeout = setTimeout(async () => {
    console.log("[SUPABASE] Mencadangkan database SQLite ke cloud...");
    await uploadDbToSupabase();
    console.log("[SUPABASE] Pencadangan database berhasil!");
  }, 3000); // Debounce 3 detik
}

// Export to global scope so db.js can trigger it
global.triggerCloudBackup = triggerCloudBackup;

async function start() {
  // 1. Download database from cloud at startup
  await downloadDbFromSupabase();

  // 2. Load the rest of the application
  const express = require("express");
  const cors = require("cors");
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
}

start();

module.exports = app;
