"use strict";
/**
 * Database SQLite — ShopeePay Payment Check System
 * Menggunakan better-sqlite3 (synchronous, zero-config)
 */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(process.cwd(), "data.db");

const db = new Database(DB_PATH);

// Enable WAL mode untuk performa lebih baik
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ──── Schema ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reference     TEXT    NOT NULL UNIQUE,
    order_id      TEXT,
    customer_name TEXT,
    customer_id   TEXT,
    type          TEXT    NOT NULL DEFAULT 'order',   -- 'order' | 'deposit'
    base_amount   REAL    NOT NULL,
    fee           REAL    NOT NULL DEFAULT 0,
    total_pay     REAL    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'expired' | 'canceled'
    qris_string   TEXT,
    callback_url  TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at    TEXT    NOT NULL,
    paid_at       TEXT,
    expired_at    TEXT,
    canceled_at   TEXT,
    mutation_key  TEXT,
    mutation_data TEXT    -- JSON
  );

  CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
  CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference);
  CREATE INDEX IF NOT EXISTS idx_payments_total_pay ON payments(total_pay);

  CREATE TABLE IF NOT EXISTS used_mutations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mut_key    TEXT NOT NULL UNIQUE,
    reference  TEXT NOT NULL,
    amount     REAL,
    issuer     TEXT,
    mut_time   TEXT,
    used_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS check_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    pending_count INTEGER DEFAULT 0,
    matched_count INTEGER DEFAULT 0,
    expired_count INTEGER DEFAULT 0,
    error_msg  TEXT
  );
`);

try {
  db.exec("ALTER TABLE payments ADD COLUMN callback_url TEXT;");
} catch (e) {
  // column already exists
}

// ──── Helpers ──────────────────────────────────────────────────────
const stmt = {
  // Payments
  insertPayment: db.prepare(`
    INSERT INTO payments
      (reference, order_id, customer_name, customer_id, type,
       base_amount, fee, total_pay, status, qris_string, callback_url, expires_at)
    VALUES
      (@reference, @order_id, @customer_name, @customer_id, @type,
       @base_amount, @fee, @total_pay, @status, @qris_string, @callback_url, @expires_at)
  `),

  getPaymentByRef: db.prepare(`SELECT * FROM payments WHERE reference = ?`),
  getPaymentsByStatus: db.prepare(`SELECT * FROM payments WHERE status = ? ORDER BY created_at DESC`),
  getAllPayments: db.prepare(`
    SELECT * FROM payments ORDER BY created_at DESC LIMIT 200
  `),
  getPaymentStats: db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'paid'     THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
      SUM(CASE WHEN status = 'paid' THEN total_pay ELSE 0 END) AS total_revenue
    FROM payments
  `),

  markPaid: db.prepare(`
    UPDATE payments
    SET status = 'paid', paid_at = datetime('now','localtime'),
        mutation_key = @mutation_key, mutation_data = @mutation_data
    WHERE reference = @reference
  `),
  markExpired: db.prepare(`
    UPDATE payments
    SET status = 'expired', expired_at = datetime('now','localtime')
    WHERE reference = @reference
  `),
  markCanceled: db.prepare(`
    UPDATE payments
    SET status = 'canceled', canceled_at = datetime('now','localtime')
    WHERE reference = @reference
  `),

  // Used mutations (anti double-claim)
  isMutUsed: db.prepare(`SELECT 1 FROM used_mutations WHERE mut_key = ?`),
  insertUsedMut: db.prepare(`
    INSERT OR IGNORE INTO used_mutations (mut_key, reference, amount, issuer, mut_time)
    VALUES (@mut_key, @reference, @amount, @issuer, @mut_time)
  `),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),

  // Logs
  insertCheckLog: db.prepare(`
    INSERT INTO check_logs (pending_count, matched_count, expired_count, error_msg)
    VALUES (@pending_count, @matched_count, @expired_count, @error_msg)
  `),
  getRecentLogs: db.prepare(`SELECT * FROM check_logs ORDER BY checked_at DESC LIMIT 20`),
};

module.exports = { db, stmt };
