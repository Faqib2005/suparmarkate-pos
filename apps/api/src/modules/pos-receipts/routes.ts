import { Hono } from "hono";
import bwipjs from "bwip-js";
import { prisma } from "../../lib/prisma";
import { issueReceiptAccess, requireReceiptAccess } from "../../lib/receipt-access";
import { formatKabulDateTime } from "../../lib/kabul-date";

export const posReceiptsRoute = new Hono();

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function safeText(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getReceiptWidth(raw: string | null) {
  const width = Number(raw || 80);
  return width === 58 ? 58 : 80;
}

function getCustomerLabel(sale: any) {
  if (sale.customer?.name) {
    return sale.customer.name;
  }

  const customerLabel = getNotePart(sale.note, "Customer");
  if (customerLabel) return customerLabel;

  return "مشتری نقدی";
}

function getNotePart(note: unknown, marker: string) {
  const text = String(note || "");
  const prefix = `${marker}:`;
  const part = text
    .split(" | ")
    .find((item) => item.trim().startsWith(prefix));

  return part?.slice(prefix.length).trim() || null;
}

function getNoteNumber(note: unknown, marker: string) {
  const rawValue = getNotePart(note, marker);
  if (!rawValue) return null;

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function receiptItemGroupKey(item: any) {
  return [
    item.productId || item.product?.id || "",
    item.unitId || item.unit?.id || "",
    Number(item.unitPrice || 0).toFixed(4),
  ].join("::");
}

function groupReceiptItems(items: any[]) {
  const grouped = new Map<string, any>();

  for (const item of items) {
    const key = receiptItemGroupKey(item);
    const quantity = Number(item.quantity || 0);
    const discount = Number(item.discount || 0);
    const totalPrice = Number(
      item.totalPrice ?? Math.max(0, quantity * Number(item.unitPrice || 0) - discount),
    );
    const documentDiscountAllocated = Number(
      item.documentDiscountAllocated || 0,
    );
    const netTotalPrice = Number(
      item.netTotalPrice ?? totalPrice - documentDiscountAllocated,
    );
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...item,
        quantity,
        discount,
        totalPrice,
        documentDiscountAllocated,
        netTotalPrice,
      });
      continue;
    }

    existing.quantity += quantity;
    existing.discount += discount;
    existing.totalPrice += totalPrice;
    existing.documentDiscountAllocated += documentDiscountAllocated;
    existing.netTotalPrice += netTotalPrice;
  }

  return Array.from(grouped.values());
}

posReceiptsRoute.post("/sales/:id/token", (c) =>
  issueReceiptAccess(c, {
    resource: "pos-sale-receipt",
    id: c.req.param("id"),
    htmlPath: `/api/pos-receipts/sales/${encodeURIComponent(c.req.param("id"))}/html`
  })
);

posReceiptsRoute.get("/sales/:id/html", async (c) => {
  const id = c.req.param("id");
  const accessError = requireReceiptAccess(c, { resource: "pos-sale-receipt", id });
  if (accessError) return accessError;
  const widthMm = getReceiptWidth(c.req.query("width") || null);

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      currency: true,
      customer: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
        },
      },
      returns: {
        where: {
          cancelledAt: null,
        },
        orderBy: {
          createdAt: "asc",
        },
        include: {
          items: {
            include: {
              product: true,
              saleItem: {
                include: {
                  unit: true,
                },
              },
            },
          },
        },
      },
      exchangesAsSource: {
        orderBy: { createdAt: "asc" },
        include: {
          replacementSale: {
            include: {
              items: {
                include: {
                  product: true,
                  warehouse: true,
                  unit: true,
                },
              },
            },
          },
        },
      },
      exchangesAsReplacement: {
        include: {
          sourceSale: {
            select: { id: true, invoiceNo: true },
          },
          saleReturn: {
            select: { id: true, returnNo: true },
          },
        },
      },
    },
  });

  if (!sale) {
    return c.html("<h1>فروش مورد نظر پیدا نشد</h1>", 404);
  }

  const setting = await prisma.companySetting.findFirst().catch(() => null);

  const companyName = setting?.companyName || "Muhaseb POS";
  const phone = setting?.phone || "";
  const address = setting?.address || "";
  const logoImage = setting?.logoImage || "";
  const receiptItems = groupReceiptItems(sale.items);
  const receiptReturns = sale.returns.map((saleReturn) => ({
    ...saleReturn,
    receiptItems: groupReceiptItems(
      saleReturn.items.map((item) => ({
        ...item,
        unitId: item.saleItem.unitId,
        unit: item.saleItem.unit,
      })),
    ),
  }));
  const exchangeHistory = sale.exchangesAsSource.map((exchange) => ({
    ...exchange,
    receiptItems: groupReceiptItems(exchange.replacementSale.items),
  }));
  const replacementExchange = sale.exchangesAsReplacement[0] || null;

  const subtotal = receiptItems.reduce((sum, item) => {
    return sum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
  }, 0);

  const total = Number((sale as any).total || subtotal);
  const discount = Math.max(0, subtotal - total);
  const returnedTotal = receiptReturns.reduce(
    (sum, saleReturn) => sum + Number(saleReturn.subtotal || 0),
    0,
  );
  const refundedTotal = receiptReturns.reduce(
    (sum, saleReturn) => sum + Number(saleReturn.refundAmount || 0),
    0,
  );
  const receivableAdjustmentTotal = receiptReturns.reduce(
    (sum, saleReturn) => sum + Number(saleReturn.receivableAdjustment || 0),
    0,
  );
  const netSaleTotal = total - returnedTotal;
  const exchangeCashPaidAmount = replacementExchange
    ? Number(replacementExchange.cashPaidAmount || 0)
    : null;
  const exchangeCreditApplied = replacementExchange
    ? Number(replacementExchange.creditApplied || 0)
    : 0;
  const exchangeOutstandingAmount = replacementExchange
    ? Number(replacementExchange.outstandingAmount || 0)
    : 0;
  const customerDebtAmount = Math.max(
    0,
    replacementExchange ? exchangeOutstandingAmount : Number((sale as any).remainingAmount || 0),
  );
  const salePaidAmount = exchangeCashPaidAmount ?? Number((sale as any).paidAmount || total);
  const tenderedAmount = getNoteNumber((sale as any).note, "TenderedAmount") ?? salePaidAmount;
  const changeAmount =
    getNoteNumber((sale as any).note, "ChangeAmount") ??
    (replacementExchange ? 0 : Math.max(0, tenderedAmount - total));
  const receiptNote = getNotePart((sale as any).note, "Note");
  const receiptReference = String((sale as any).invoiceNo || sale.id);
  let receiptBarcodeSvg = "";

  try {
    receiptBarcodeSvg = bwipjs.toSVG({
      bcid: "code128",
      text: receiptReference,
      scale: widthMm === 58 ? 1 : 2,
      height: widthMm === 58 ? 7 : 9,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch {
    // A malformed legacy invoice number must never stop receipt printing.
  }

  const currencyLabel = sale.currency?.symbol || sale.currency?.code || "";
  const customerLabel = getCustomerLabel(sale);

  const html = `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>رسید فروش ${safeText((sale as any).invoiceNo || sale.id)}</title>
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

    @page {
      size: ${widthMm}mm auto;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    html,
    body {
      margin: 8px;
      padding: 0;
      background: white;
      color: #000;
      font-family: "Zain", Tahoma, Arial, sans-serif;
    }

    body {
      width: ${widthMm}mm;
      max-width: ${widthMm}mm;
      padding: ${widthMm === 58 ? "5px" : "8px"};
      font-size: ${widthMm === 58 ? "10px" : "12px"};
      line-height: 1.6;
    }

    .center {
      text-align: center;
    }

    .company {
      font-size: ${widthMm === 58 ? "14px" : "17px"};
      font-weight: 900;
      margin-bottom: 2px;
    }

    .company-logo {
      width: ${widthMm === 58 ? "44px" : "56px"};
      height: ${widthMm === 58 ? "44px" : "56px"};
      object-fit: contain;
      display: block;
      margin: 0 auto 5px;
    }

    .muted {
      color: #000;
      font-size: ${widthMm === 58 ? "9px" : "14px"};
    }

    .line {
      border-top: 1px dashed #000;
      margin: 7px 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 0;
    }

    .row strong {
      font-weight: 900;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    th,
    td {
      padding: 3px 1px;
      border-bottom: 1px dashed #bbb;
      vertical-align: top;
      text-align: right;
    }

    th {
      font-weight: 900;
      border-bottom: 1px solid #000;
    }

    .product-name {
      font-weight: 800;
    }

    .ltr {
      direction: ltr;
      text-align: left;
    }

    .total-box {
      margin-top: 6px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 5px 0;
    }

    .total-row {
      font-size: ${widthMm === 58 ? "12px" : "15px"};
      font-weight: 900;
    }

    .section-title {
      margin-top: 8px;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 4px 0;
      text-align: center;
      font-weight: 900;
    }

    .return-meta {
      margin-top: 5px;
      font-size: ${widthMm === 58 ? "9px" : "11px"};
      font-weight: 700;
    }

    .receipt-note {
      margin-top: 5px;
      border: 1px dashed #000;
      padding: 3px 4px;
      font-size: ${widthMm === 58 ? "8px" : "10px"};
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .receipt-note strong,
    .receipt-note div {
      display: inline;
    }

    .receipt-note div {
      white-space: pre-wrap;
    }

    .receipt-barcode {
      margin-top: 7px;
      border-top: 1px dashed #000;
      padding-top: 5px;
      text-align: center;
    }

    .receipt-barcode svg {
      display: block;
      width: 100%;
      height: ${widthMm === 58 ? "30px" : "38px"};
      margin: 0 auto;
    }

    .receipt-barcode-label {
      direction: ltr;
      margin-top: 1px;
      font-family: Tahoma, Arial, sans-serif;
      font-size: ${widthMm === 58 ? "7px" : "8px"};
      letter-spacing: 0;
    }

    .footer {
      margin-top: 8px;
      text-align: center;
      font-size: ${widthMm === 58 ? "14px" : "18px"};
    }
  </style>
</head>
<body>
  <div class="center">
    ${logoImage ? `<img class="company-logo" src="${safeText(logoImage)}" />` : ""}
    <div class="company">${safeText(companyName)}</div>
    ${phone ? `<div class="muted">شماره تماس: ${safeText(phone)}</div>` : ""}
    ${address ? `<div class="muted">${safeText(address)}</div>` : ""}
  </div>

  <div class="line"></div>

  <div class="row">
    <span>شماره فاکتور:</span>
    <strong>${safeText((sale as any).invoiceNo || sale.id)}</strong>
  </div>

  <div class="row">
    <span>تاریخ:</span>
    <strong>${formatKabulDateTime((sale as any).createdAt)}</strong>
  </div>

  <div class="row">
    <span>مشتری:</span>
    <strong>${safeText(customerLabel)}</strong>
  </div>

  <div class="line"></div>

  <table>
    <thead>
      <tr>
        <th>محصول</th>
        <th>تعداد</th>
        <th>قیمت</th>
        <th>جمع</th>
      </tr>
    </thead>
    <tbody>
      ${receiptItems
        .map((item) => {
          const qty = Number(item.quantity || 0);
          const price = Number(item.unitPrice || 0);
          const itemDiscount = Number((item as any).discount || 0);
          const lineTotal = Number(
            (item as any).netTotalPrice ??
              (item as any).totalPrice ??
              Math.max(0, qty * price - itemDiscount),
          );

          return `
            <tr>
              <td>
                <div class="product-name">${safeText(item.product?.name || "-")}</div>
            
              </td>
              <td>${money(qty)} ${safeText(item.unit?.shortName || item.unit?.name || "-")}</td>
              <td>${money(price)}</td>
              <td>${money(lineTotal)}</td>
            </tr>
          `;
        })
        .join("")}
    </tbody>
  </table>

  <div class="total-box">
    <div class="row">
      <span>جمع اجناس:</span>
      <strong>${money(subtotal)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>تخفیف:</span>
      <strong>${money(discount)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row total-row">
      <span>قابل پرداخت:</span>
      <strong>${money(total)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>دریافت‌شده:</span>
      <strong>${money(tenderedAmount)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>برگشت پول:</span>
      <strong>${money(changeAmount)} ${safeText(currencyLabel)}</strong>
    </div>

    ${
      customerDebtAmount > 0
        ? `
    <div class="row total-row">
      <span>مبلغ قرض مشتری:</span>
      <strong>${money(customerDebtAmount)} ${safeText(currencyLabel)}</strong>
    </div>
    `
        : ""
    }

    ${
      replacementExchange && exchangeCreditApplied > 0
        ? `
    <div class="row">
      <span>اعتبار برگشتی استفاده‌شده:</span>
      <strong>${money(exchangeCreditApplied)} ${safeText(currencyLabel)}</strong>
    </div>
    `
        : ""
    }

    ${
      replacementExchange
        ? `
    <div class="row total-row">
      <span>باقی پس از کسر اعتبار برگشتی:</span>
      <strong>${money(exchangeOutstandingAmount)} ${safeText(currencyLabel)}</strong>
    </div>
    `
        : ""
    }

    ${
      returnedTotal > 0
        ? `
    <div class="row">
      <span>مجموع برگشتی:</span>
      <strong>-${money(returnedTotal)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>پول مستردشده:</span>
      <strong>${money(refundedTotal)} ${safeText(currencyLabel)}</strong>
    </div>

    ${
      receivableAdjustmentTotal > 0
        ? `
    <div class="row">
      <span>کاهش طلب مشتری:</span>
      <strong>${money(receivableAdjustmentTotal)} ${safeText(currencyLabel)}</strong>
    </div>
    `
        : ""
    }

    <div class="row total-row">
      <span>فروش خالص پس از برگشت:</span>
      <strong>${money(netSaleTotal)} ${safeText(currencyLabel)}</strong>
    </div>
    `
        : ""
    }
  </div>

  ${
    receiptReturns.length > 0
      ? `
  <div class="section-title">اقلام برگشتی</div>
  ${receiptReturns
    .map(
      (saleReturn) => `
    <div class="return-meta">
     
      <span>${formatKabulDateTime(saleReturn.createdAt)}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>محصول</th>
          <th>تعداد</th>
          <th>قیمت</th>
          <th>جمع</th>
        </tr>
      </thead>
      <tbody>
        ${saleReturn.receiptItems
          .map((item) => {
            const qty = Number(item.quantity || 0);
            const price = Number(item.unitPrice || 0);
            const lineTotal = Number(item.totalPrice || 0);

            return `
              <tr>
                <td><div class="product-name">${safeText(item.product?.name || "-")}</div></td>
                <td>${money(qty)} ${safeText(item.unit?.shortName || item.unit?.name || "-")}</td>
                <td>${money(price)}</td>
                <td>-${money(lineTotal)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <div class="row">
      <span>جمع سند برگشتی:</span>
      <strong>-${money(saleReturn.subtotal)} ${safeText(currencyLabel)}</strong>
    </div>
  `,
    )
    .join("")}
  `
      : ""
  }

  ${
    exchangeHistory.length > 0
      ? `
  <div class="section-title">اقلام جدید در تعویض فروش</div>
  ${exchangeHistory
    .map(
      (exchange) => `
    <div class="return-meta ">
   
    <span> فاکتور جدید:</span>
    <span> ${safeText(exchange.replacementSale.invoiceNo || exchange.replacementSale.id)}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>محصول</th>
          <th>تعداد</th>
          <th>قیمت</th>
          <th>جمع</th>
        </tr>
      </thead>
      <tbody>
        ${exchange.receiptItems
          .map((item) => {
            const qty = Number(item.quantity || 0);
            const price = Number(item.unitPrice || 0);
            const lineTotal = Number(item.netTotalPrice ?? item.totalPrice ?? 0);
            return `
              <tr>
                <td><div class="product-name">${safeText(item.product?.name || "-")}</div></td>
                <td>${money(qty)} ${safeText(item.unit?.shortName || item.unit?.name || "-")}</td>
                <td>${money(price)}</td>
                <td>${money(lineTotal)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <div class="row">
      <span>جمع فروش جایگزین:</span>
      <strong>${money(exchange.replacementSale.total)} ${safeText(currencyLabel)}</strong>
    </div>
    <div class="row">
      <span>پرداخت نقدی/بانکی جدید:</span>
      <strong>${money(exchange.cashPaidAmount)} ${safeText(currencyLabel)}</strong>
    </div>
    <div class="row">
      <span>اعتبار برگشتی مصرف‌شده:</span>
      <strong>${money(exchange.creditApplied)} ${safeText(currencyLabel)}</strong>
    </div>
    <div class="row">
      <span>باقی پس از کسر اعتبار برگشتی:</span>
      <strong>${money(exchange.outstandingAmount)} ${safeText(currencyLabel)}</strong>
    </div>
  `,
    )
    .join("")}
  `
      : ""
  }

  ${
    replacementExchange
      ? `
  <div class="receipt-note">
    <strong>مرجع تعویض:</strong>
    <div>تعویض ${safeText(replacementExchange.exchangeNo)} از فاکتور ${safeText(replacementExchange.sourceSale.invoiceNo || replacementExchange.sourceSale.id)} / سند برگشت ${safeText(replacementExchange.saleReturn.returnNo || replacementExchange.saleReturn.id)}</div>
  </div>
  `
      : ""
  }

  ${
    receiptNote
      ? `
  <div class="receipt-note">
    <strong>یادداشت:</strong>
    <div>${safeText(receiptNote)}</div>
  </div>
  `
      : ""
  }

  ${
    receiptBarcodeSvg
      ? `
  <div class="receipt-barcode">
    ${receiptBarcodeSvg}
    <div class="receipt-barcode-label">${safeText(receiptReference)}</div>
  </div>
  `
      : ""
  }

  <div class="footer">
    <div>تشکر از خرید شما</div>
    <div class="">Powered by Muhaseb POS</div>
  </div>

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.focus(), 100);
    });
  </script>
</body>
</html>
`;

  return c.html(html);
});
