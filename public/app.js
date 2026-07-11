/* ═══════════════════════════════════════════════════════════
   ShopeePay Dashboard — Frontend Application
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  let adminKey = localStorage.getItem("adminKey") || "";
  let autoRefreshTimer = null;

  // ──── Elements ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const loginScreen = $("#login-screen");
  const dashboard = $("#dashboard");
  const loginForm = $("#login-form");
  const loginError = $("#login-error");
  const loginPassword = $("#login-password");
  const logoutBtn = $("#logout-btn");
  const refreshBtn = $("#refresh-btn");
  const clockEl = $("#clock");
  const pageTitle = $("#page-title");

  // ──── API Helper ────────────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(`/api${path}`, opts);
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  // ──── Format Helpers ────────────────────────────────────
  function formatRp(amount) {
    return "Rp " + Number(amount || 0).toLocaleString("id-ID");
  }

  function formatTime(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatUnix(ts) {
    if (!ts) return "-";
    return formatTime(new Date(ts * 1000).toISOString());
  }

  function statusBadge(status) {
    const cls = {
      pending: "status-pending",
      paid: "status-paid",
      expired: "status-expired",
      canceled: "status-canceled",
    };
    const icons = {
      pending: "⏳",
      paid: "✅",
      expired: "⛔",
      canceled: "🚫",
    };
    return `<span class="status ${cls[status] || ""}">${icons[status] || ""} ${status}</span>`;
  }

  function txStatusBadge(code) {
    const map = { 1: "Tertunda", 2: "Diproses", 3: "Berhasil", 4: "Gagal", 5: "Dikembalikan" };
    const cls = { 1: "status-pending", 3: "status-success", 4: "status-expired" };
    return `<span class="status ${cls[code] || ""}">${map[code] || code}</span>`;
  }

  // ──── Login ─────────────────────────────────────────────
  async function doLogin(password) {
    const res = await api("POST", "/admin/login", { password });
    if (res.success) {
      adminKey = res.token;
      localStorage.setItem("adminKey", adminKey);
      showDashboard();
    } else {
      loginError.textContent = res.message || "Login gagal";
      loginError.style.display = "block";
    }
  }

  function doLogout() {
    adminKey = "";
    localStorage.removeItem("adminKey");
    dashboard.style.display = "none";
    loginScreen.style.display = "flex";
    loginPassword.value = "";
    loginError.style.display = "none";
    stopAutoRefresh();
  }

  // ──── Dashboard ─────────────────────────────────────────
  function showDashboard() {
    loginScreen.style.display = "none";
    dashboard.style.display = "flex";
    loadOverview();
    startAutoRefresh();
  }

  // ──── Tab Navigation ────────────────────────────────────
  const tabTitles = {
    overview: "Overview",
    payments: "Payments",
    live: "Live Transaksi",
    create: "Buat Payment",
    logs: "Logs",
  };

  $$(".nav-item").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = nav.dataset.tab;
      if (!tab) return;

      $$(".nav-item").forEach((n) => n.classList.remove("active"));
      nav.classList.add("active");

      $$(".tab-content").forEach((t) => t.classList.remove("active"));
      const tabEl = $(`#tab-${tab}`);
      if (tabEl) tabEl.classList.add("active");

      pageTitle.textContent = tabTitles[tab] || tab;

      // Load data per tab
      if (tab === "overview") loadOverview();
      else if (tab === "payments") loadPayments();
      else if (tab === "live") loadLive();
      else if (tab === "logs") loadLogs();
    });
  });

  // ──── Overview Tab ──────────────────────────────────────
  async function loadOverview() {
    const [statsRes, paymentsRes] = await Promise.all([
      api("GET", "/admin/stats"),
      api("GET", "/admin/payments"),
    ]);

    if (statsRes.success && statsRes.data) {
      const s = statsRes.data;
      $("#stat-total .stat-value").textContent = s.total || 0;
      $("#stat-pending .stat-value").textContent = s.pending || 0;
      $("#stat-paid .stat-value").textContent = s.paid || 0;
      $("#stat-revenue .stat-value").textContent = formatRp(s.total_revenue);
    }

    if (paymentsRes.success && paymentsRes.data) {
      renderOverviewTable(paymentsRes.data.slice(0, 15));
    }
  }

  function renderOverviewTable(payments) {
    const tbody = $("#overview-tbody");
    if (!payments.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">Belum ada pembayaran</td></tr>';
      return;
    }
    tbody.innerHTML = payments
      .map(
        (p) => `
      <tr>
        <td><code style="color:var(--primary)">${p.reference}</code></td>
        <td>${p.customer_name || '<span class="text-muted">-</span>'}</td>
        <td class="amount">${formatRp(p.base_amount)}</td>
        <td class="text-muted">+${p.fee}</td>
        <td class="amount" style="color:var(--primary)">${formatRp(p.total_pay)}</td>
        <td>${statusBadge(p.status)}</td>
        <td class="text-muted">${formatTime(p.created_at)}</td>
        <td>
          ${
            p.status === "pending"
              ? `<button class="btn-sm btn-check" onclick="window._checkPayment('${p.reference}')">Cek</button>`
              : ""
          }
        </td>
      </tr>`
      )
      .join("");
  }

  // ──── Payments Tab ──────────────────────────────────────
  async function loadPayments() {
    const res = await api("GET", "/admin/payments");
    const tbody = $("#payments-tbody");
    if (!res.success || !res.data || !res.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:32px">Belum ada data</td></tr>';
      return;
    }
    tbody.innerHTML = res.data
      .map(
        (p) => `
      <tr>
        <td><code style="color:var(--primary)">${p.reference}</code></td>
        <td>${p.order_id || "-"}</td>
        <td>${p.customer_name || "-"}</td>
        <td>${p.type}</td>
        <td class="amount">${formatRp(p.base_amount)}</td>
        <td class="text-muted">+${p.fee}</td>
        <td class="amount" style="color:var(--primary)">${formatRp(p.total_pay)}</td>
        <td>${statusBadge(p.status)}</td>
        <td class="text-muted">${formatTime(p.created_at)}</td>
        <td class="text-muted">${p.paid_at ? formatTime(p.paid_at) : "-"}</td>
      </tr>`
      )
      .join("");
  }

  // ──── Live Transactions Tab ─────────────────────────────
  async function loadLive() {
    const tbody = $("#live-tbody");
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Loading...</td></tr>';

    const res = await api("GET", "/admin/transactions");
    if (!res.success || !res.data || !res.data.transactions) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:32px">${res.message || res.data?.error || "Error"}</td></tr>`;
      return;
    }

    const txs = res.data.transactions;
    if (!txs.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Belum ada transaksi</td></tr>';
      return;
    }

    tbody.innerHTML = txs
      .map(
        (tx) => `
      <tr>
        <td><code style="font-size:11px">${tx.transactionId}</code></td>
        <td>${tx.storeName}</td>
        <td class="amount" style="color:var(--success)">${formatRp(tx.amount)}</td>
        <td>${txStatusBadge(tx.status)}</td>
        <td>${tx.transactionTypeText}</td>
        <td class="text-muted">${tx.createDate ? formatTime(tx.createDate) : formatUnix(tx.createTime)}</td>
      </tr>`
      )
      .join("");
  }

  // ──── Create Payment Tab ────────────────────────────────
  const createForm = $("#create-form");
  const createResult = $("#create-result");

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const orderId = $("#cp-order-id").value.trim();
    const name = $("#cp-name").value.trim();
    const amount = Number($("#cp-amount").value);
    const type = $("#cp-type").value;

    if (!amount || amount < 100) {
      alert("Minimal Rp 100");
      return;
    }

    const res = await api("POST", "/payment/create", {
      orderId,
      customerName: name,
      amount,
      type,
    });

    if (res.success && res.data) {
      const d = res.data;
      createResult.style.display = "block";
      createResult.innerHTML = `
        <p style="font-size:13px;color:var(--success);font-weight:600">✅ Payment berhasil dibuat!</p>
        <p class="ref-code">${d.reference}</p>
        <p class="pay-amount">${formatRp(d.totalPay)}</p>
        <p style="font-size:13px;color:var(--text-secondary)">
          Base: ${formatRp(d.baseAmount)} + Fee: Rp ${d.fee}<br/>
          Expired: ${formatTime(d.expiresAt)} (${Math.floor(d.timeoutMs / 60000)} menit)
        </p>
        ${d.qrisString ? `<p style="font-size:11px;margin-top:12px;word-break:break-all;color:var(--text-muted)"><b>QRIS:</b> ${d.qrisString}</p>` : ""}
      `;
      createForm.reset();
      loadOverview();
    } else {
      alert(res.message || "Gagal membuat payment");
    }
  });

  // ──── Logs Tab ──────────────────────────────────────────
  async function loadLogs() {
    const res = await api("GET", "/admin/logs");
    const tbody = $("#logs-tbody");
    if (!res.success || !res.data || !res.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">Belum ada log</td></tr>';
      return;
    }
    tbody.innerHTML = res.data
      .map(
        (l) => `
      <tr>
        <td class="text-muted">${formatTime(l.checked_at)}</td>
        <td>${l.pending_count}</td>
        <td style="color:var(--success)">${l.matched_count}</td>
        <td style="color:var(--warning)">${l.expired_count}</td>
        <td style="color:${l.error_msg ? "var(--danger)" : "var(--text-muted)"}">${l.error_msg || "-"}</td>
      </tr>`
      )
      .join("");
  }

  // ──── Check Payment (single) ────────────────────────────
  window._checkPayment = async function (ref) {
    const res = await api("GET", `/payment/check/${ref}`);
    if (res.paid) {
      alert(`✅ Payment ${ref} sudah DIBAYAR!`);
    } else {
      alert(
        `⏳ Payment ${ref}: ${res.reason || "Belum ditemukan pembayaran masuk"}`
      );
    }
    loadOverview();
  };

  // ──── Check Now Button ──────────────────────────────────
  const btnCheckNow = $("#btn-check-now");
  if (btnCheckNow) {
    btnCheckNow.addEventListener("click", async () => {
      btnCheckNow.disabled = true;
      btnCheckNow.textContent = "Checking...";
      const res = await api("POST", "/admin/check-now");
      if (res.success && res.data) {
        const d = res.data;
        alert(
          `Dicek: ${d.checked} pending\nMatched: ${d.matched}\nExpired: ${d.expired}`
        );
      }
      btnCheckNow.disabled = false;
      btnCheckNow.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23,4 23,10 17,10"/><path d="M20.49,15a9,9,0,1,1-2.12-9.36L23,10"/></svg> Cek Sekarang';
      loadOverview();
    });
  }

  // ──── Fetch Live Button ─────────────────────────────────
  const btnFetchLive = $("#btn-fetch-live");
  if (btnFetchLive) {
    btnFetchLive.addEventListener("click", () => loadLive());
  }

  // ──── Refresh Button ────────────────────────────────────
  refreshBtn.addEventListener("click", () => {
    const activeTab = $(".nav-item.active");
    if (activeTab) activeTab.click();
  });

  // ──── Logout ────────────────────────────────────────────
  logoutBtn.addEventListener("click", doLogout);

  // ──── Login Form ────────────────────────────────────────
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    doLogin(loginPassword.value);
  });

  // ──── Clock ─────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ──── Auto Refresh ──────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      const activeTab = $(".nav-item.active");
      const tab = activeTab?.dataset?.tab;
      if (tab === "overview") loadOverview();
    }, 15000); // every 15s
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  // ──── Init ──────────────────────────────────────────────
  if (adminKey) {
    // Auto-login if key exists
    api("GET", "/admin/stats").then((res) => {
      if (res.success) {
        showDashboard();
      } else {
        doLogout();
      }
    });
  }
})();
