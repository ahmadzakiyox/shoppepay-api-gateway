"use strict";
const express = require("express");
const router = express.Router();
const svc = require("../shopeePayService");

// POST /api/payment/create — Buat payment baru
router.post("/create", (req, res) => {
  try {
    const { orderId, customerName, customerId, amount, type, callbackUrl } = req.body;
    if (!amount || Number(amount) < 100) {
      return res.status(400).json({ success: false, message: "Minimal Rp 100" });
    }
    const result = svc.createPayment({
      orderId,
      customerName,
      customerId,
      baseAmount: Number(amount),
      type: type || "order",
      callbackUrl,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/payment/check/:reference — Cek status payment
router.get("/check/:reference", async (req, res) => {
  try {
    const result = await svc.checkPayment(req.params.reference);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/payment/cancel/:reference — Batalkan payment
router.post("/cancel/:reference", (req, res) => {
  try {
    const result = svc.cancelPayment(req.params.reference);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
