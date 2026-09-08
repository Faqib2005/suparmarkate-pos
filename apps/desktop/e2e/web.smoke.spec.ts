import { expect, test } from "@playwright/test";

test("web shell renders without a fatal runtime error", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");

  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("Internal server error");
  expect(runtimeErrors).toEqual([]);
});

test("Admin can preview and explicitly confirm a safe duplicate product merge", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  let mergePayload: unknown = null;
  let mergeOperationId = "";
  let merged = false;
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("belal_auth_token", "e2e-admin-token");
    window.localStorage.setItem(
      "belal_auth_user",
      JSON.stringify({
        id: "admin-e2e",
        username: "admin",
        displayName: "Admin",
        role: "Admin",
        permissions: [],
      }),
    );
    window.localStorage.setItem(
      "muhaseb_api_base_url",
      "http://127.0.0.1:4000",
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname === "/api/auth/me") {
      return json({
        data: {
          user: {
            id: "admin-e2e",
            username: "admin",
            displayName: "Admin",
            role: "Admin",
            permissions: [],
          },
        },
      });
    }
    if (url.pathname === "/api/products/barcode-duplicates") {
      return json({
        data: merged
          ? []
          : [
              {
                normalized: "6263981802863",
                count: 2,
                products: [
                  { id: "target-product", name: "محصول اصلی", barcode: "6263981802863" },
                  { id: "source-product", name: "محصول تکراری", barcode: "6263-981802863" },
                ],
              },
            ],
      });
    }
    if (url.pathname === "/api/products/merge-preview") {
      const counts = {
        stockBalances: 1,
        stockLots: 1,
        stockMovements: 2,
        purchaseItems: 1,
        purchaseReturnItems: 0,
        saleItems: 3,
        saleReturnItems: 0,
      };
      return json({
        data: {
          canMerge: true,
          normalizedBarcode: "6263981802863",
          blockers: [],
          warnings: ["قیمت واحدها متفاوت است؛ قیمت‌های محصول مقصد حفظ می‌شود"],
          source: {
            id: "source-product",
            name: "محصول تکراری",
            sku: "SOURCE",
            barcode: "6263-981802863",
            stock: [
              {
                warehouseId: "warehouse-1",
                warehouseName: "گدام اصلی",
                quantityBase: 3,
                valueBase: 15,
              },
            ],
            counts,
          },
          target: {
            id: "target-product",
            name: "محصول اصلی",
            sku: "TARGET",
            barcode: "6263981802863",
            stock: [
              {
                warehouseId: "warehouse-1",
                warehouseName: "گدام اصلی",
                quantityBase: 2,
                valueBase: 12,
              },
            ],
            counts,
          },
          combined: {
            quantityBase: 5,
            valueBase: 27,
            counts: {
              ...counts,
              stockBalances: 2,
              stockLots: 2,
              stockMovements: 4,
              purchaseItems: 2,
              saleItems: 6,
            },
          },
        },
      });
    }
    if (url.pathname === "/api/products/merge" && request.method() === "POST") {
      mergePayload = request.postDataJSON();
      mergeOperationId = request.headers()["idempotency-key"] || "";
      merged = true;
      return json({ message: "محصولات با موفقیت ادغام شدند" });
    }
    if (url.pathname === "/api/products") {
      return json({
        data: [],
        summary: { total: 0, active: 0, barcodeCount: 0 },
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
    }
    if (
      [
        "/api/product-categories",
        "/api/units",
        "/api/warehouses",
        "/api/currencies",
      ].includes(url.pathname)
    ) {
      return json({ data: [] });
    }
    return json({ data: [] });
  });

  await page.goto("/#/products");
  await page.getByRole("button", { name: "بارکدهای تکراری", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "مدیریت بارکدهای تکراری",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("آماده ادغام", { exact: true })).toBeVisible();
  await expect(
    page.getByText("قیمت واحدها متفاوت است؛ قیمت‌های محصول مقصد حفظ می‌شود"),
  ).toBeVisible();

  await page.getByRole("button", { name: "ادغام امن", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "تأیید ادغام محصولات", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ادغام نهایی", exact: true }).click();
  await expect.poll(() => mergePayload).toEqual({
    sourceId: "source-product",
    targetId: "target-product",
    confirm: true,
  });
  expect(mergeOperationId).toMatch(/^[0-9a-z-]{8,}$/i);
  await expect
    .poll(async () => {
      const persistedOperations = await page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem("muhaseb_recent_mutation_operations_v1") ||
            "[]",
        ),
      );
      return persistedOperations.some(
        ([, operation]: [string, { operationId: string }]) =>
          operation.operationId === mergeOperationId,
      );
    })
    .toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test("live product and inventory searches debounce and load only the active tab", async ({
  page,
}) => {
  const apiBaseUrl = process.env.PLAYWRIGHT_LIVE_API;
  test.skip(!apiBaseUrl, "Set PLAYWRIGHT_LIVE_API to run the isolated live search smoke test.");

  const runtimeErrors: string[] = [];
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(apiBaseUrl!)) apiRequests.push(url);
  });
  await page.addInitScript((url) => {
    window.localStorage.setItem("muhaseb_api_base_url", url);
  }, apiBaseUrl!);

  await page.goto("/");
  const passwordInput = page.getByLabel("رمز عبور", { exact: true });
  expect(await passwordInput.count()).toBe(1);
  await passwordInput.fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD || "admin12345");
  const loginButton = page.getByRole("button", { name: "ورود", exact: true });
  expect(await loginButton.count()).toBe(1);
  await loginButton.click();
  const dashboardLink = page.getByRole("link", {
    name: "داشبورد",
    exact: true,
  });
  await dashboardLink.waitFor({ state: "visible" });
  expect(await dashboardLink.count()).toBe(1);

  await page.goto("/#/products");
  const productSearch = page.getByPlaceholder("جستجوی کالا، بارکود، کتگوری...", {
    exact: true,
  });
  await expect(productSearch).toBeVisible();
  apiRequests.length = 0;
  await productSearch.fill("62");
  await productSearch.fill("626398");
  await productSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter((url) =>
      url.includes("/api/products?page=1&limit=20&search=6263981802863"),
    ),
  ).toHaveLength(1);

  apiRequests.length = 0;
  const duplicateBarcodeButton = page.getByRole("button", {
    name: "بارکدهای تکراری",
    exact: true,
  });
  await expect(duplicateBarcodeButton).toBeVisible();
  await duplicateBarcodeButton.click();
  await expect(
    page.getByRole("heading", {
      name: "مدیریت بارکدهای تکراری",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        apiRequests.filter((url) =>
          url.includes("/api/products/barcode-duplicates"),
        ).length,
    )
    .toBe(1);
  await page.keyboard.press("Escape");

  await page.goto("/#/inventory");
  const stockSearch = page.getByPlaceholder("جستجوی جنس، بارکود یا گدام...", {
    exact: true,
  });
  await expect(stockSearch).toBeVisible();
  await page.waitForTimeout(500);
  apiRequests.length = 0;
  await stockSearch.fill("62");
  await stockSearch.fill("626398");
  await stockSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter((url) => url.includes("/api/inventory/stock?") && url.includes("6263981802863")),
  ).toHaveLength(1);
  expect(apiRequests.some((url) => url.includes("/api/inventory/movements?"))).toBe(false);

  const increaseTab = page.getByRole("tab", {
    name: "افزایش موجودی",
    exact: true,
  });
  expect(await increaseTab.count()).toBe(1);
  await increaseTab.click();
  const movementSearch = page.getByPlaceholder(
    "جستجوی جنس، گدام، lot یا کاربر...",
    { exact: true },
  );
  await expect(movementSearch).toBeVisible();
  await page.waitForTimeout(500);
  apiRequests.length = 0;
  await movementSearch.fill("62");
  await movementSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter(
      (url) =>
        url.includes("/api/inventory/movements?") &&
        url.includes("type=ADJUSTMENT_IN") &&
        url.includes("search=6263981802863"),
    ),
  ).toHaveLength(1);
  expect(apiRequests.some((url) => url.includes("/api/inventory/stock?"))).toBe(false);
  expect(runtimeErrors).toEqual([]);
});
