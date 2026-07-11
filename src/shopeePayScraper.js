"use strict";
/**
 * ShopeePay Partner API Scraper
 * Mengambil data transaksi langsung dari ShopeePay Partner Portal API
 * menggunakan cookie authentication.
 */
const https = require("https");
const zlib = require("zlib");

const DEFAULT_HOSTNAME = "shopeepay.shopee.co.id";

class ShopeePayScraper {
  /**
   * @param {Object} opts
   * @param {string} opts.token - JWT token dari cookie __shopee_partner_website_x_token_live
   * @param {string} [opts.language] - Language code (default: "id")
   * @param {string} [opts.timezone] - Timezone (default: "Asia/Jakarta")
   */
  constructor({ token, language = "id", timezone = "Asia/Jakarta" } = {}) {
    this.jwtToken = token;
    this.language = language;
    this.timezone = timezone;

    // Decode inner token from JWT payload
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString()
      );
      this.innerToken = payload.token;
      this.userId = payload.userid;
      this.region = payload.region;
    } catch (e) {
      throw new Error("Invalid JWT token: " + e.message);
    }
  }

  /**
   * Internal HTTP request helper with gzip/br decompression
   */
  _request(method, hostname, path, body, extraHeaders) {
    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : "";
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-GB,en;q=0.7",
        Cookie: `__shopee_partner_website_x_token_live=${this.jwtToken}`,
        "X-Token": "",
        "X-Timestamp-Ms": String(Date.now()),
        Referer:
          "https://partner.shopee.co.id/shopeepay-portal/transactions",
        Origin: "https://partner.shopee.co.id",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        ...(body
          ? { "Content-Length": String(Buffer.byteLength(bodyStr)) }
          : {}),
        ...(extraHeaders || {}),
      };

      const req = https.request(
        { hostname, path, method, headers, timeout: 20000 },
        (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const raw = Buffer.concat(chunks);
            const enc = res.headers["content-encoding"];
            const decompress = (buf, cb) => {
              if (enc === "gzip")
                zlib.gunzip(buf, (e, r) =>
                  cb(e ? buf.toString() : r.toString())
                );
              else if (enc === "br")
                zlib.brotliDecompress(buf, (e, r) =>
                  cb(e ? buf.toString() : r.toString())
                );
              else if (enc === "deflate")
                zlib.inflate(buf, (e, r) =>
                  cb(e ? buf.toString() : r.toString())
                );
              else cb(buf.toString());
            };
            decompress(raw, (text) => {
              let json = null;
              try {
                json = JSON.parse(text);
              } catch (_) {}
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: text,
                json,
              });
            });
          });
        }
      );
      req.on("error", (e) =>
        resolve({ status: 0, error: e.message, body: "", json: null })
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: 0, error: "timeout", body: "", json: null });
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  /**
   * Ambil daftar transaksi dari ShopeePay Partner API
   * @param {Object} opts
   * @param {number} [opts.startTime] - Unix timestamp awal
   * @param {number} [opts.endTime] - Unix timestamp akhir
   * @param {number} [opts.pageSize] - Jumlah per halaman (default: 50)
   * @param {string} [opts.nextPosition] - Cursor untuk halaman berikutnya
   * @param {number[]} [opts.transactionStatusList] - Filter status [3=success]
   * @param {number[]} [opts.transactionTypeList] - Filter tipe [1=payment]
   * @param {number[]} [opts.paymentMethodList] - Filter metode pembayaran
   * @param {number[]} [opts.storeIdList] - Filter toko
   * @returns {Promise<Object>} Response dengan list transaksi
   */
  async getTransactionList({
    startTime,
    endTime,
    pageSize = 50,
    nextPosition = "",
    transactionStatusList,
    transactionTypeList,
    paymentMethodList,
    storeIdList,
    searchType,
    searchValue,
    sortType,
    sortOrder,
  } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    const body = {
      data: {
        metadata: {
          token: this.innerToken,
          language: this.language,
          timezone: this.timezone,
        },
        time_period: {
          start_time: startTime || thirtyDaysAgo,
          end_time: endTime || now,
        },
        page_size: pageSize,
        ...(nextPosition ? { next_position: nextPosition } : {}),
        ...(transactionStatusList
          ? { transaction_status_list: transactionStatusList }
          : {}),
        ...(transactionTypeList
          ? { transaction_type_list: transactionTypeList }
          : {}),
        ...(paymentMethodList
          ? { payment_method_list: paymentMethodList }
          : {}),
        ...(storeIdList ? { store_id_list: storeIdList } : {}),
        ...(searchType !== undefined ? { search_type: searchType } : {}),
        ...(searchValue ? { search_value: searchValue } : {}),
        ...(sortType !== undefined ? { sort_type: sortType } : {}),
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      },
    };

    const res = await this._request(
      "POST",
      DEFAULT_HOSTNAME,
      "/merchant/v1/partner-web/get-transaction-list",
      body
    );

    if (res.error) {
      return { success: false, error: res.error, data: null };
    }

    if (!res.json) {
      return {
        success: false,
        error: "Invalid JSON response",
        data: null,
        raw: res.body,
      };
    }

    if (res.json.code !== 0) {
      return {
        success: false,
        error: res.json.msg || `API error code ${res.json.code}`,
        code: res.json.code,
        data: null,
      };
    }

    const data = res.json.data || {};
    return {
      success: true,
      transactions: (data.list || []).map((tx) => ({
        transactionId: tx.transactionId || tx.displayTransactionId,
        externalTransactionId: tx.externalTransactionId || "",
        createTime: tx.createTime,
        createDate: tx.createTime
          ? new Date(tx.createTime * 1000).toISOString()
          : null,
        storeId: tx.storeId,
        storeName: (tx.storeName || "").trim(),
        merchantId: tx.merchantId,
        merchantName: (tx.merchantName || "").trim(),
        service: tx.service,
        amount: Number(String(tx.amount || 0).replace(/\./g, "")),
        status: tx.status,
        statusText: this._statusText(tx.status),
        transactionType: tx.transactionType,
        transactionTypeText: this._typeText(tx.transactionType),
        paymentMethod: tx.paymentMethod,
        storeExternalId: tx.storeExternalId || "",
        raw: tx,
      })),
      total: Number(data.total || 0),
      totalNetSales: Number(data.totalNetSales || 0),
      totalCompletedCount: Number(data.totalCompletedCount || 0),
      nextPosition: data.next_position || null,
    };
  }

  /**
   * Ambil SEMUA transaksi (auto-pagination)
   */
  async getAllTransactions(opts = {}) {
    const all = [];
    let nextPosition = "";
    let page = 0;
    const maxPages = opts.maxPages || 20;

    while (page < maxPages) {
      const res = await this.getTransactionList({
        ...opts,
        nextPosition,
      });

      if (!res.success) return res;

      all.push(...res.transactions);

      if (
        !res.nextPosition ||
        res.transactions.length === 0 ||
        all.length >= res.total
      ) {
        return {
          success: true,
          transactions: all,
          total: res.total,
          totalNetSales: res.totalNetSales,
          totalCompletedCount: res.totalCompletedCount,
        };
      }

      nextPosition = res.nextPosition;
      page++;

      // Rate limit: wait 500ms between pages
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      success: true,
      transactions: all,
      total: all.length,
      partial: true,
    };
  }

  /**
   * Cari transaksi berdasarkan nominal (untuk payment matching)
   * @param {number} amount - Nominal yang dicari
   * @param {number} [afterTimestamp] - Hanya transaksi setelah timestamp ini
   * @returns {Promise<Object>} Transaksi yang cocok atau null
   */
  async findTransactionByAmount(amount, afterTimestamp) {
    const res = await this.getTransactionList({
      pageSize: 50,
      transactionStatusList: [3], // 3 = success
      transactionTypeList: [1], // 1 = payment
    });

    if (!res.success) return { success: false, error: res.error, match: null };

    const match = res.transactions.find((tx) => {
      const amountOk = Math.abs(tx.amount - amount) < 1; // tolerance < Rp 1
      const timeOk = !afterTimestamp || tx.createTime >= afterTimestamp;
      return amountOk && timeOk;
    });

    return { success: true, match: match || null };
  }

  /**
   * Ambil detail satu transaksi
   */
  async getTransactionDetail(transactionId) {
    const body = {
      data: {
        metadata: {
          token: this.innerToken,
          language: this.language,
          timezone: this.timezone,
        },
        transaction_id: transactionId,
      },
    };

    const res = await this._request(
      "POST",
      DEFAULT_HOSTNAME,
      "/merchant/v1/partner-web/get-transaction-detail",
      body
    );

    if (res.error)
      return { success: false, error: res.error, data: null };
    if (!res.json || res.json.code !== 0)
      return {
        success: false,
        error: res.json?.msg || "API error",
        data: null,
      };

    return { success: true, data: res.json.data };
  }

  /**
   * Ambil daftar metode pembayaran
   */
  async getPaymentMethodList() {
    const body = {
      data: {
        metadata: {
          token: this.innerToken,
          language: this.language,
          timezone: this.timezone,
        },
      },
    };

    const res = await this._request(
      "POST",
      DEFAULT_HOSTNAME,
      "/merchant/v1/partner-web/get-payment-method-list",
      body
    );

    if (res.error) return { success: false, error: res.error, data: null };
    if (!res.json || res.json.code !== 0)
      return {
        success: false,
        error: res.json?.msg || "API error",
        data: null,
      };

    return { success: true, data: res.json.data };
  }

  /**
   * Ambil daftar toko
   */
  async getStoreList() {
    const body = {
      data: {
        metadata: {
          token: this.innerToken,
          language: this.language,
          timezone: this.timezone,
        },
      },
    };

    const res = await this._request(
      "POST",
      DEFAULT_HOSTNAME,
      "/merchant/v1/partner-web/get-store-list",
      body
    );

    if (res.error) return { success: false, error: res.error, data: null };
    if (!res.json || res.json.code !== 0)
      return {
        success: false,
        error: res.json?.msg || "API error",
        data: null,
      };

    return { success: true, data: res.json.data };
  }

  _statusText(code) {
    const map = {
      1: "Tertunda",
      2: "Diproses",
      3: "Berhasil",
      4: "Gagal",
      5: "Dikembalikan",
    };
    return map[code] || `Status_${code}`;
  }

  _typeText(code) {
    const map = {
      1: "Pembayaran",
      2: "Pengembalian Dana",
      3: "Top-Up",
      4: "Pencairan",
    };
    return map[code] || `Type_${code}`;
  }
}

module.exports = ShopeePayScraper;
