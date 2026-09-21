import { Hono } from "hono";

export const posCartRoute = new Hono();
const posWebSocketPort = process.env.POS_WS_PORT || "4001";
const publicPosWebSocketPort = process.env.PUBLIC_POS_WS_PORT || posWebSocketPort;

function getConfiguredPublicBaseUrl() {
  const configured = process.env.PUBLIC_API_BASE_URL || process.env.LAN_API_BASE_URL;
  if (!configured) return null;

  try {
    return new URL(configured);
  } catch {
    return null;
  }
}

function getUrls(c: any, sessionId: string) {
  const url = new URL(c.req.url);
  const publicUrl = getConfiguredPublicBaseUrl() || url;
  const apiBaseUrl = `${publicUrl.protocol}//${publicUrl.host}`;
  const hostname = publicUrl.hostname;
  const wsProtocol = publicUrl.protocol === "https:" ? "wss" : "ws";

  return {
    apiBaseUrl,
    desktopWebSocketUrl: `${wsProtocol}://${hostname}:${publicPosWebSocketPort}?sessionId=${sessionId}&clientType=desktop`,
    mobileConnectPageUrl: `${apiBaseUrl}/api/pos/sessions/${sessionId}/connect`,
    mobileScanHttpUrl: `${apiBaseUrl}/api/pos/scan`
  };
}

posCartRoute.get("/sessions/:id", (c) => {
  const sessionId = c.req.param("id");
  const urls = getUrls(c, sessionId);

  return c.html(`
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>POS Cart</title>
  <style>
    @font-face {
      font-family: "Zain";
      src: url("/font/zain/Zain-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }

    @font-face {
      font-family: "Zain";
      src: url("/font/zain/Zain-Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Zain", Tahoma, Arial, sans-serif;
      background: #020617;
      color: #f8fafc;
      direction: rtl;
    }

    .page {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 1fr 420px;
      gap: 16px;
      padding: 16px;
    }

    .panel {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 22px;
      padding: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }

    h1, h2, h3 {
      margin: 0;
    }

    .muted {
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.8;
    }

    .status {
      background: #020617;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 10px 12px;
      color: #5eead4;
      font-size: 13px;
      direction: ltr;
      text-align: left;
    }

    .grid {
      display: grid;
      gap: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 1.5fr .7fr .7fr .7fr .7fr 80px;
      gap: 8px;
      align-items: center;
      padding: 10px;
      border-bottom: 1px solid #1e293b;
    }

    .row.header-row {
      color: #94a3b8;
      font-size: 12px;
      font-weight: 700;
      border-bottom: 1px solid #334155;
    }

    input, select {
      width: 100%;
      background: #020617;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 10px;
      outline: none;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
      color: white;
      font-weight: 700;
    }

    .btn-primary {
      background: #14b8a6;
    }

    .btn-blue {
      background: #2563eb;
    }

    .btn-red {
      background: #ef4444;
    }

    .btn-dark {
      background: #334155;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .total-box {
      background: #020617;
      border: 1px dashed #14b8a6;
      border-radius: 18px;
      padding: 16px;
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }

    .grand {
      font-size: 24px;
      font-weight: 900;
      color: #5eead4;
    }

    .qr {
      width: 220px;
      max-width: 100%;
      background: white;
      padding: 10px;
      border-radius: 16px;
      display: block;
      margin: 12px auto;
    }

    .log {
      height: 260px;
      overflow: auto;
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 10px;
      direction: ltr;
      text-align: left;
      font-size: 12px;
      color: #cbd5e1;
      white-space: pre-wrap;
    }

    .empty {
      border: 1px dashed #334155;
      border-radius: 18px;
      padding: 32px;
      text-align: center;
      color: #94a3b8;
    }

    a {
      color: #5eead4;
    }

    @media (max-width: 1000px) {
      .page {
        grid-template-columns: 1fr;
      }

      .row {
        grid-template-columns: 1fr;
      }

      .row.header-row {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <main class="panel">
      <div class="header">
        <div>
          <h1>سبد فروش POS</h1>
          <div class="muted">هر بارکود که از موبایل اسکن شود، اینجا به سبد اضافه می‌شود.</div>
        </div>
        <div class="status" id="status">در حال اتصال...</div>
      </div>

      <div class="panel" style="margin-bottom: 16px;">
        <h3>تست دستی بارکود</h3>
        <div class="muted">برای تست بدون موبایل، بارکود را اینجا وارد کن.</div>
        <div class="actions" style="margin-top: 10px;">
          <input id="manualBarcode" value="123456789" style="max-width: 280px;" />
          <button class="btn-blue" onclick="sendManualBarcode()">ارسال بارکود</button>
          <button class="btn-dark" onclick="clearCart()">خالی‌کردن سبد</button>
        </div>
      </div>

      <div id="cartArea"></div>
    </main>

    <aside class="panel">
      <h2>اتصال موبایل</h2>
      <p class="muted">
        اپ موبایل را باز کن، گزینه <b>اسکن QR اتصال</b> را بزن و این QR را اسکن کن.
      </p>

      <img class="qr" src="/api/pos/sessions/${sessionId}/qr.svg" />

      <div class="grid">
        <div>
          <div class="muted">Session ID</div>
          <input id="sessionIdInput" value="${sessionId}" readonly />
        </div>

        <div>
          <div class="muted">Currency ID</div>
          <input id="currencyIdInput" placeholder="در حال دریافت..." />
        </div>

        <div>
          <div class="muted">Cash Account ID</div>
          <input id="cashAccountIdInput" placeholder="در حال دریافت..." />
        </div>

        <div>
          <div class="muted">Default Warehouse ID</div>
          <input id="warehouseIdInput" placeholder="در حال دریافت..." />
        </div>
      </div>

      <div class="total-box">
        <div class="total-row">
          <span>تعداد اقلام</span>
          <b id="itemsCount">0</b>
        </div>
        <div class="total-row">
          <span>جمع کل</span>
          <b id="subtotal">0</b>
        </div>
        <div class="total-row grand">
          <span>قابل پرداخت</span>
          <span id="grandTotal">0</span>
        </div>

        <button id="submitSaleButton" class="btn-primary" onclick="submitSale()">ثبت فروش و چاپ رسید</button>
      </div>

      <p class="muted">
        <a href="${urls.mobileConnectPageUrl}" target="_blank">باز کردن صفحه QR</a>
      </p>

      <h3 style="margin-top: 18px;">Log</h3>
      <div class="log" id="log"></div>
    </aside>
  </div>

  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const apiBaseUrl = ${JSON.stringify(urls.apiBaseUrl)};
    const wsUrl = ${JSON.stringify(urls.desktopWebSocketUrl)};
    const scanHttpUrl = ${JSON.stringify(urls.mobileScanHttpUrl)};

    let socket = null;
    let cart = [];
    let currencyLabel = "";
    let lastSaleId = null;
    let saleSubmitting = false;
    let pendingSaleOperation = null;

    function createBrowserOperationId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }

      return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    }

    function el(id) {
      return document.getElementById(id);
    }

    function log(data) {
      const logEl = el("log");
      const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      logEl.textContent = text + "\\n\\n" + logEl.textContent;
    }

    function setStatus(text) {
      el("status").textContent = text;
    }

    function money(value) {
      const number = Number(value || 0);
      return new Intl.NumberFormat("fa-AF", {
        maximumFractionDigits: 2
      }).format(number) + (currencyLabel ? " " + currencyLabel : "");
    }

    async function fetchJson(url, options) {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || "درخواست انجام نشد. لطفاً دوباره کوشش کنید.");
      }

      return data;
    }

    async function loadDefaults() {
      try {
        const currencies = await fetchJson(apiBaseUrl + "/api/currencies");
        const currency = (currencies.data || []).find(function (item) {
          return item.isBase;
        }) || (currencies.data || [])[0];

        if (currency) {
          el("currencyIdInput").value = currency.id;
          currencyLabel = currency.symbol || currency.code;
        }

        const warehouses = await fetchJson(apiBaseUrl + "/api/warehouses");
        const warehouse = (warehouses.data || []).find(function (item) {
          return item.isDefault;
        }) || (warehouses.data || [])[0];

        if (warehouse) {
          el("warehouseIdInput").value = warehouse.id;
        }

        const registers = await fetchJson(apiBaseUrl + "/api/cash-registers");
        const firstRegister = (registers.data || [])[0];

        if (firstRegister && firstRegister.accounts && firstRegister.accounts.length) {
          const account = firstRegister.accounts.find(function (item) {
            return currency && item.currencyId === currency.id;
          }) || firstRegister.accounts[0];

          if (account) {
            el("cashAccountIdInput").value = account.id;
          }
        }

        log({
          type: "DEFAULTS_LOADED",
          currencyId: el("currencyIdInput").value,
          cashAccountId: el("cashAccountIdInput").value,
          warehouseId: el("warehouseIdInput").value
        });
      } catch (error) {
        log({
          type: "DEFAULTS_ERROR",
          message: error.message
        });
      }
    }

    function connectWebSocket() {
      socket = new WebSocket(wsUrl);

      socket.addEventListener("open", function () {
        setStatus("وصل شد به WebSocket");
        log({
          type: "WS_OPEN",
          wsUrl
        });
      });

      socket.addEventListener("message", function (event) {
        let message = event.data;

        try {
          message = JSON.parse(event.data);
        } catch {}

        log(message);

        if (message.type === "BARCODE_SCANNED") {
          addScannedProductToCart(message.payload);
        }

        if (message.type === "SCAN_ERROR") {
          setStatus("خطا: " + (message.payload?.message || "اسکن بارکود ناکام شد"));
        }
      });

      socket.addEventListener("close", function () {
        setStatus("WebSocket قطع شد، تلاش برای اتصال دوباره...");
        setTimeout(connectWebSocket, 1500);
      });

      socket.addEventListener("error", function () {
        setStatus("خطا در WebSocket");
      });
    }

    function addScannedProductToCart(payload) {
      if (!payload || !payload.product) {
        return;
      }

      if (!payload.recommendedLot || Number(payload.totalStock || 0) <= 0) {
        setStatus("این محصول موجودی ندارد: " + payload.product.name);
        return;
      }

      const product = payload.product;
      const defaultSaleUnit =
        payload.defaultSaleUnit ||
        (product.units || []).find(function (item) {
          return item.isDefaultSale;
        }) ||
        (product.units || [])[0] ||
        null;

      const unitId = defaultSaleUnit?.unitId || product.baseUnitId;
      const unitName =
        defaultSaleUnit?.unit?.shortName ||
        defaultSaleUnit?.unit?.name ||
        product.baseUnit?.shortName ||
        product.baseUnit?.name ||
        "واحد";

      const unitPrice = Number(defaultSaleUnit?.salePrice || 0);
      const warehouseId = payload.recommendedLot?.warehouseId || el("warehouseIdInput").value;

      const key = product.id + ":" + unitId + ":" + warehouseId;

      const existing = cart.find(function (item) {
        return item.key === key;
      });

      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({
          key,
          productId: product.id,
          productName: product.name,
          barcode: product.barcode,
          warehouseId,
          unitId,
          unitName,
          quantity: 1,
          unitPrice,
          discount: 0,
          totalStock: Number(payload.totalStock || 0),
          expiryDate: payload.recommendedLot?.expiryDate || null
        });
      }

      setStatus("اضافه شد به سبد: " + product.name);
      renderCart();
    }

    function cartSubtotal() {
      return cart.reduce(function (sum, item) {
        return sum + Math.max(0, item.quantity * item.unitPrice - item.discount);
      }, 0);
    }

    function updateQty(key, value) {
      const item = cart.find(function (row) {
        return row.key === key;
      });

      if (!item) return;

      item.quantity = Math.max(1, Number(value || 1));
      renderCart();
    }

    function updatePrice(key, value) {
      const item = cart.find(function (row) {
        return row.key === key;
      });

      if (!item) return;

      item.unitPrice = Math.max(0, Number(value || 0));
      renderCart();
    }

    function updateDiscount(key, value) {
      const item = cart.find(function (row) {
        return row.key === key;
      });

      if (!item) return;

      item.discount = Math.max(0, Number(value || 0));
      renderCart();
    }

    function removeItem(key) {
      cart = cart.filter(function (item) {
        return item.key !== key;
      });
      renderCart();
    }

    function clearCart() {
      cart = [];
      pendingSaleOperation = null;
      renderCart();
    }

    function renderCart() {
      const area = el("cartArea");

      el("itemsCount").textContent = String(cart.length);
      el("subtotal").textContent = money(cartSubtotal());
      el("grandTotal").textContent = money(cartSubtotal());

      if (!cart.length) {
        area.innerHTML = '<div class="empty">هنوز محصولی اسکن نشده است.</div>';
        return;
      }

      const rows = cart.map(function (item) {
        const lineTotal = Math.max(0, item.quantity * item.unitPrice - item.discount);

        return (
          '<div class="row">' +
            '<div>' +
              '<b>' + item.productName + '</b>' +
              '<div class="muted">بارکود: ' + (item.barcode || "-") + '</div>' +
              '<div class="muted">انقضا: ' + (item.expiryDate ? new Date(item.expiryDate).toLocaleDateString("fa-AF-u-ca-persian", { timeZone: "Asia/Kabul" }) : "-") + '</div>' +
            '</div>' +
            '<div><input type="number" min="1" value="' + item.quantity + '" onchange="updateQty(' + JSON.stringify(item.key) + ', this.value)" /></div>' +
            '<div>' + item.unitName + '</div>' +
            '<div><input type="number" min="0" value="' + item.unitPrice + '" onchange="updatePrice(' + JSON.stringify(item.key) + ', this.value)" /></div>' +
            '<div><input type="number" min="0" value="' + item.discount + '" onchange="updateDiscount(' + JSON.stringify(item.key) + ', this.value)" /></div>' +
            '<div>' +
              '<b>' + money(lineTotal) + '</b>' +
              '<br />' +
              '<button class="btn-red" onclick="removeItem(' + JSON.stringify(item.key) + ')">حذف</button>' +
            '</div>' +
          '</div>'
        );
      }).join("");

      area.innerHTML =
        '<div class="row header-row">' +
          '<div>محصول</div>' +
          '<div>تعداد</div>' +
          '<div>واحد</div>' +
          '<div>قیمت</div>' +
          '<div>تخفیف</div>' +
          '<div>جمع</div>' +
        '</div>' +
        rows;
    }

    async function sendManualBarcode() {
      const barcode = el("manualBarcode").value.trim();

      if (!barcode) {
        alert("بارکود را وارد کن");
        return;
      }

      try {
        await fetchJson(scanHttpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sessionId,
            barcode,
            warehouseId: el("warehouseIdInput").value || undefined
          })
        });
      } catch (error) {
        alert(error.message);
      }
    }

    async function submitSale() {
      if (saleSubmitting) return;
      if (!cart.length) {
        alert("سبد خالی است");
        return;
      }

      const currencyId = el("currencyIdInput").value.trim();
      const cashAccountId = el("cashAccountIdInput").value.trim();

      if (!currencyId) {
        alert("Currency ID موجود نیست");
        return;
      }

      if (!cashAccountId) {
        alert("Cash Account ID موجود نیست");
        return;
      }

      const total = cartSubtotal();
      const operationPayload = {
        currencyId,
        discount: 0,
        paidAmount: total,
        paymentAccountType: "CASH",
        paymentAccountId: cashAccountId,
        note: "POS sale from scanner cart",
        items: cart.map(function (item) {
          return {
            productId: item.productId,
            warehouseId: item.warehouseId,
            unitId: item.unitId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount
          };
        })
      };
      const operationSignature = JSON.stringify(operationPayload);
      if (!pendingSaleOperation || pendingSaleOperation.signature !== operationSignature) {
        pendingSaleOperation = {
          signature: operationSignature,
          id: createBrowserOperationId()
        };
      }
      const operationId = pendingSaleOperation.id;
      const body = {
        ...operationPayload,
        clientRequestId: operationId,
        invoiceNo: "POS-" + operationId
      };

      saleSubmitting = true;
      el("submitSaleButton").disabled = true;
      try {
        const res = await fetchJson(apiBaseUrl + "/api/sales", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationId
          },
          body: JSON.stringify(body)
        });

        const saleId = res.data?.sale?.id || res.data?.sale?.id;
        lastSaleId = saleId;

        log({
          type: "SALE_CREATED",
          saleId,
          response: res
        });

        pendingSaleOperation = null;
        clearCart();

        if (saleId) {
          window.open(apiBaseUrl + "/api/receipts/sales/" + saleId + "/html", "_blank");
        }

        alert("فروش ثبت شد");
      } catch (error) {
        alert(error.message);
        log({
          type: "SALE_ERROR",
          message: error.message
        });
      } finally {
        saleSubmitting = false;
        el("submitSaleButton").disabled = false;
      }
    }

    window.updateQty = updateQty;
    window.updatePrice = updatePrice;
    window.updateDiscount = updateDiscount;
    window.removeItem = removeItem;
    window.clearCart = clearCart;
    window.submitSale = submitSale;
    window.sendManualBarcode = sendManualBarcode;

    renderCart();
    loadDefaults();
    connectWebSocket();
  </script>
</body>
</html>
  `);
});
