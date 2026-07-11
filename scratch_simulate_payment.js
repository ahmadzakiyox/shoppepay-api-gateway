const Database = require('better-sqlite3');
const axios = require('axios');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

async function main() {
  console.log("Reading last pending payment...");
  const payment = db.prepare("SELECT * FROM payments WHERE status = 'pending' ORDER BY id DESC LIMIT 1").get();
  
  if (!payment) {
    console.error("No pending payment found in shoppepay-system database.");
    process.exit(1);
  }
  
  console.log("Found pending payment:", payment);
  
  // Update in DB
  const paidAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("UPDATE payments SET status = 'paid', paid_at = ? WHERE reference = ?").run(paidAt, payment.reference);
  console.log("Updated status to paid in SQLite.");
  
  // Trigger callback
  if (payment.callback_url) {
    console.log(`Sending callback to ${payment.callback_url}...`);
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
        status: 'paid',
        paid_at: paidAt
      };
      
      const response = await axios.post(payment.callback_url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log(`Callback response status: ${response.status}`, response.data);
    } catch (err) {
      console.error("Failed to send callback:", err.message);
    }
  } else {
    console.log("No callback URL set for this payment.");
  }
}

main();
