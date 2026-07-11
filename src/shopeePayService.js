"use strict";
/**
 * ShopeePay Service Layer
 * Mengintegrasikan scraper dengan database untuk check payment otomatis
 */
const ShopeePayScraper = require("./shopeePayScraper");
const { db, stmt } = require("./db");

const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS || 300000);
const FEE_MIN = Number(process.env.FEE_MIN || 1);
const FEE_MAX = Number(process.env.FEE_MAX || 97);

let scraperInstance = null;

function getScraper() {
  const token = process.env.SHOPEEPAY_TOKEN;
  if (!token) throw new Error("SHOPEEPAY_TOKEN tidak diset di .env");
  if (!scraperInstance) {
    scraperInstance = new ShopeePayScraper({ token });
  }
  return scraperInstance;
}

function resetScraper() {
  scraperInstance = null;
}

// ──── Reference ID Generator ────────────────────────────────────
function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SPY${ts}${rand}`;
}

// ──── Unique Fee Generator ──────────────────────────────────────
function pickUniqueFee(min = FEE_MIN, max = FEE_MAX) {
  const pendingPayments = stmt.getPaymentsByStatus.all("pending");
  const usedFees = new Set(pendingPayments.map((p) => Number(p.fee)));

  for (let i = 0; i < 300; i++) {
    const fee = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!usedFees.has(fee)) return fee;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ──── QRIS Generator (Static → Dynamic) ────────────────────────
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseEmvTags(qris) {
  const tags = [];
  let i = 0;
  while (i + 4 <= qris.length) {
    const id = qris.slice(i, i + 2);
    const len = Number(qris.slice(i + 2, i + 4));
    const value = qris.slice(i + 4, i + 4 + len);
    if (!id || !Number.isFinite(len) || value.length !== len) break;
    tags.push({ id, len, value });
    i += 4 + len;
  }
  return tags;
}

function buildEmvTags(tags) {
  return tags
    .map(
      (t) =>
        t.id + String(t.value.length).padStart(2, "0") + t.value
    )
    .join("");
}

function injectQrisAmount(qris, amount) {
  let raw = String(qris || "").trim();
  raw = raw.replace(/6304[0-9A-Fa-f]{4}$/, "");
  const tags = parseEmvTags(raw).filter(
    (t) => t.id !== "54" && t.id !== "63"
  );
  const poi = tags.find((t) => t.id === "01");
  if (poi) poi.value = "12";
  const amountStr = Number(amount).toFixed(0);
  const idx58 = tags.findIndex((t) => t.id === "58");
  const amountTag = { id: "54", value: amountStr };
  if (idx58 >= 0) tags.splice(idx58, 0, amountTag);
  else tags.push(amountTag);
  const rebuilt = buildEmvTags(tags) + "6304";
  return rebuilt + crc16ccitt(rebuilt);
}

// ──── Create Payment ────────────────────────────────────────────
function createPayment({
  orderId,
  customerName,
  customerId,
  baseAmount,
  type = "order",
  callbackUrl = null,
}) {
  const fee = pickUniqueFee();
  const totalPay = Number(baseAmount) + fee;
  const reference = generateRef();
  const expiresAt = new Date(Date.now() + TIMEOUT_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  let qrisString = null;
  const staticQris = process.env.SHOPEEPAY_QRIS_STRING;
  if (staticQris) {
    try {
      qrisString = injectQrisAmount(staticQris, totalPay);
    } catch (e) {
      console.error("[QRIS] Inject error:", e.message);
    }
  }

  stmt.insertPayment.run({
    reference,
    order_id: orderId || null,
    customer_name: customerName || null,
    customer_id: customerId || null,
    type,
    base_amount: Number(baseAmount),
    fee,
    total_pay: totalPay,
    status: "pending",
    qris_string: qrisString,
    callback_url: callbackUrl || null,
    expires_at: expiresAt,
  });

  return {
    reference,
    baseAmount: Number(baseAmount),
    fee,
    totalPay,
    qrisString,
    callbackUrl,
    expiresAt,
    timeoutMs: TIMEOUT_MS,
  };
}

// ──── Webhook Callback Sender ──────────────────────────────────
async function triggerWebhook(payment) {
  if (!payment || !payment.callback_url) return;
  
  console.log(`[WEBHOOK] Sending callback for ${payment.reference} to ${payment.callback_url}`);
  try {
    const payload = {
      reference: payment.reference,
      order_id: payment.order_id,
      customer_name: payment.customer_name,
      customer_id: payment.customer_id,
      type: payment.type,
      base_amount: payment.base_amount,
      fee: payment.fee,
      total_pay: payment.total_pay,
      status: payment.status,
      paid_at: payment.paid_at,
    };

    const axios = require("axios");
    const response = await axios.post(payment.callback_url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log(`[WEBHOOK] Callback response for ${payment.reference}: ${response.status} ${JSON.stringify(response.data)}`);
  } catch (err) {
    console.error(`[WEBHOOK] Callback failed for ${payment.reference}:`, err.message);
  }
}

// ──── Check Single Payment ──────────────────────────────────────
async function checkPayment(reference) {
  const payment = stmt.getPaymentByRef.get(reference);
  if (!payment) return { success: false, reason: "NOT_FOUND" };
  if (payment.status === "paid")
    return { success: true, paid: true, payment };
  if (payment.status !== "pending")
    return { success: true, paid: false, reason: payment.status, payment };

  // Check expired
  const expiresMs = new Date(payment.expires_at + " UTC").getTime();
  if (Date.now() > expiresMs) {
    stmt.markExpired.run({ reference });
    const updated = stmt.getPaymentByRef.get(reference);
    return { success: true, paid: false, reason: "EXPIRED", payment: updated };
  }

  // Fetch dari ShopeePay API
  try {
    const scraper = getScraper();
    const createdMs = new Date(payment.created_at).getTime();
    const createdUnix = Math.floor(createdMs / 1000) - 120; // 2 min buffer

    const result = await scraper.getTransactionList({
      pageSize: 50,
      startTime: createdUnix,
      transactionStatusList: [3], // success only
      transactionTypeList: [1], // payment only
    });

    if (!result.success) {
      return { success: false, reason: result.error };
    }

    const expectedAmount = Number(payment.total_pay);
    const match = result.transactions.find((tx) => {
      const amountOk = Math.abs(tx.amount - expectedAmount) < 1;
      const timeOk = tx.createTime >= createdUnix;
      // Anti-double claim
      const key = mutationKey(tx);
      const used = stmt.isMutUsed.get(key);
      return amountOk && timeOk && !used;
    });

    if (!match) {
      return { success: true, paid: false, payment };
    }

    // MATCH FOUND — mark as paid
    const key = mutationKey(match);
    stmt.markPaid.run({
      reference,
      mutation_key: key,
      mutation_data: JSON.stringify(match),
    });
    stmt.insertUsedMut.run({
      mut_key: key,
      reference,
      amount: match.amount,
      issuer: match.storeName || "",
      mut_time: match.createDate || "",
    });

    const updated = stmt.getPaymentByRef.get(reference);
    
    // Trigger callback
    triggerWebhook(updated).catch(e => console.error("[Webhook Trigger Error]", e.message));

    return { success: true, paid: true, payment: updated, mutation: match };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// ──── Process All Pending Payments (Cron) ────────────────────────
async function processPendingPayments() {
  const pending = stmt.getPaymentsByStatus.all("pending");
  if (pending.length === 0) return { checked: 0, matched: 0, expired: 0 };

  let matched = 0;
  let expired = 0;
  let errorMsg = null;

  // Fetch latest transactions once
  let transactions = [];
  try {
    const scraper = getScraper();
    const oldestCreated = Math.min(
      ...pending.map((p) =>
        Math.floor(new Date(p.created_at).getTime() / 1000)
      )
    );
    const result = await scraper.getTransactionList({
      pageSize: 50,
      startTime: oldestCreated - 120,
      transactionStatusList: [3],
      transactionTypeList: [1],
    });

    if (result.success) {
      transactions = result.transactions;
    } else {
      errorMsg = result.error;
      console.error("[CRON] API error:", errorMsg);
    }
  } catch (e) {
    errorMsg = e.message;
    console.error("[CRON] Fetch error:", errorMsg);
  }

  // Match each pending payment
  for (const payment of pending) {
    const expiresMs = new Date(payment.expires_at + " UTC").getTime();

    // Check expired first
    if (Date.now() > expiresMs) {
      stmt.markExpired.run({ reference: payment.reference });
      expired++;
      console.log(`[CRON] Expired: ${payment.reference}`);
      continue;
    }

    if (transactions.length === 0) continue;

    const expectedAmount = Number(payment.total_pay);
    const createdUnix =
      Math.floor(new Date(payment.created_at).getTime() / 1000) - 120;

    const match = transactions.find((tx) => {
      const amountOk = Math.abs(tx.amount - expectedAmount) < 1;
      const timeOk = tx.createTime >= createdUnix;
      const key = mutationKey(tx);
      const used = stmt.isMutUsed.get(key);
      return amountOk && timeOk && !used;
    });

    if (match) {
      const key = mutationKey(match);
      stmt.markPaid.run({
        reference: payment.reference,
        mutation_key: key,
        mutation_data: JSON.stringify(match),
      });
      stmt.insertUsedMut.run({
        mut_key: key,
        reference: payment.reference,
        amount: match.amount,
        issuer: match.storeName || "",
        mut_time: match.createDate || "",
      });
      matched++;
      console.log(
        `[CRON] PAID: ${payment.reference} ← Rp ${match.amount} (${match.transactionId})`
      );

      // Trigger callback
      const updated = stmt.getPaymentByRef.get(payment.reference);
      triggerWebhook(updated).catch(e => console.error("[Webhook Trigger Error]", e.message));
    }
  }

  // Log
  stmt.insertCheckLog.run({
    pending_count: pending.length,
    matched_count: matched,
    expired_count: expired,
    error_msg: errorMsg,
  });

  return { checked: pending.length, matched, expired };
}

// ──── Cancel Payment ────────────────────────────────────────────
function cancelPayment(reference) {
  const payment = stmt.getPaymentByRef.get(reference);
  if (!payment) return { success: false, reason: "NOT_FOUND" };
  if (payment.status !== "pending")
    return { success: false, reason: "NOT_PENDING" };
  stmt.markCanceled.run({ reference });
  return { success: true };
}

// ──── Get Stats ─────────────────────────────────────────────────
function getStats() {
  return stmt.getPaymentStats.get();
}

function getAllPayments() {
  return stmt.getAllPayments.all();
}

function getRecentLogs() {
  return stmt.getRecentLogs.all();
}

// ──── Helpers ───────────────────────────────────────────────────
function mutationKey(tx) {
  return [
    tx.transactionId || "",
    tx.amount || "",
    tx.status || "",
    tx.createTime || "",
  ].join("|");
}

module.exports = {
  createPayment,
  checkPayment,
  cancelPayment,
  processPendingPayments,
  getStats,
  getAllPayments,
  getRecentLogs,
  getScraper,
  resetScraper,
};
