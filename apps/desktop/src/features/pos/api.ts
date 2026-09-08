import type {
  CashRegister,
  BankAccount,
  CartPayload,
  Currency,
  CustomerOption,
  HeldCart,
  PosDefaults,
  PosProductSearchResponse,
  PosSessionResponse,
  ProductSearchItem,
  Warehouse,
} from "./types";
import {
  formatPartyBalanceByCurrency,
  partyBalanceBase,
} from "@/lib/party-balance";

export class ApiRequestError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiRequestError(
      json?.message || json?.error?.message || "Request failed",
      res.status,
      json
    );
  }

  return json;
}

export async function createPosSession(baseUrl: string) {
  return fetchJson<PosSessionResponse>(`${baseUrl}/api/pos/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "صندوق فروش دسکتاپ",
    }),
  });
}

export async function getPosCart(baseUrl: string, sessionId: string) {
  return fetchJson<{
    data: CartPayload;
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/cart`);
}

export async function clearPosCart(baseUrl: string, sessionId: string) {
  return fetchJson<{
    data: CartPayload;
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/cart`, {
    method: "DELETE",
  });
}

export async function updateCartItem(
  baseUrl: string,
  sessionId: string,
  key: string,
  input: {
    quantity?: number;
    unitId?: string;
    unitPrice?: number;
    discount?: number;
  }
) {
  return fetchJson<{
    data: CartPayload;
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/cart/items/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function removeCartItem(baseUrl: string, sessionId: string, key: string) {
  return fetchJson<{
    data: CartPayload;
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/cart/items/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

export async function updatePosSessionSettings(
  baseUrl: string,
  sessionId: string,
  input: {
    warehouseId?: string | null;
    currencyId?: string | null;
    exchangeRate?: number;
  }
) {
  return fetchJson<{
    data: {
      settings: {
        warehouseId?: string | null;
        currencyId?: string | null;
        exchangeRate?: number;
      };
    };
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function getHeldCarts(baseUrl: string, sessionId: string) {
  return fetchJson<{
    data: {
      heldCarts: HeldCart[];
    };
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/held-carts`);
}

export async function holdCart(baseUrl: string, sessionId: string, name?: string) {
  return fetchJson<{
    data: {
      held: HeldCart | null;
      cart: CartPayload["cart"];
      summary: CartPayload["summary"];
    };
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/held-carts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: name || null,
    }),
  });
}

export async function restoreHeldCart(
  baseUrl: string,
  sessionId: string,
  heldCartId: string
) {
  return fetchJson<{
    data: {
      held: HeldCart;
      cart: CartPayload["cart"];
      summary: CartPayload["summary"];
    };
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/held-carts/${heldCartId}/restore`, {
    method: "POST",
  });
}

export async function deleteHeldCart(
  baseUrl: string,
  sessionId: string,
  heldCartId: string
) {
  return fetchJson<{
    data: {
      heldCarts: HeldCart[];
    };
  }>(`${baseUrl}/api/pos/sessions/${sessionId}/held-carts/${heldCartId}`, {
    method: "DELETE",
  });
}

export async function scanPosBarcode(input: {
  baseUrl: string;
  sessionId: string;
  barcode: string;
  productId?: string | null;
  warehouseId?: string | null;
}) {
  return fetchJson<{
    data: {
      cart?: CartPayload["cart"];
      cartSummary?: CartPayload["summary"];
    };
  }>(`${input.baseUrl}/api/pos/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      barcode: input.barcode,
      productId: input.productId || null,
      warehouseId: input.warehouseId || null,
    }),
  });
}

export async function loadProducts(
  baseUrl: string,
  input: {
    search?: string;
    categoryId?: string;
    warehouseId?: string | null;
    offset?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams({
    limit: String(input.limit || 60),
    offset: String(input.offset || 0),
  });

  if (input.search?.trim()) {
    params.set("search", input.search.trim());
  }

  if (input.categoryId && input.categoryId !== "all") {
    params.set("categoryId", input.categoryId);
  }

  if (input.warehouseId) {
    params.set("warehouseId", input.warehouseId);
  }

  return fetchJson<PosProductSearchResponse>(
    `${baseUrl}/api/products/pos-search?${params.toString()}`,
    { signal: input.signal },
  );
}

export async function increaseInventoryFromPos(input: {
  baseUrl: string;
  operationId: string;
  productId: string;
  warehouseId: string;
  unitId?: string | null;
  quantity: number;
  unitCost: number;
  currencyId?: string | null;
  expiryDate?: string | null;
  note?: string | null;
}) {
  return fetchJson<any>(`${input.baseUrl}/api/inventory/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.operationId,
    },
    body: JSON.stringify({
      type: "ADJUSTMENT_IN",
      productId: input.productId,
      warehouseId: input.warehouseId,
      unitId: input.unitId || null,
      quantity: input.quantity,
      unitCost: input.unitCost,
      currencyId: input.currencyId || null,
      expiryDate: input.expiryDate || null,
      note: input.note || null,
    }),
  });
}

function normalizeCustomer(item: any, source?: string): CustomerOption | null {
  const id = item?.id || item?.personId || item?.customerId;

  const name =
    item?.name ||
    item?.fullName ||
    item?.displayName ||
    item?.companyName ||
    item?.title;

  if (!id || !name) {
    return null;
  }

  return {
    id: String(id),
    code: item?.code || null,
    name: String(name),
    phone: item?.phone || item?.mobile || item?.phoneNumber || null,
    email: item?.email || null,
    type: item?.type || item?.personType || null,
    isActive: item?.isActive !== false,
    accountsCount: Array.isArray(item?.accounts) ? item.accounts.length : 0,
    balance: partyBalanceBase(item, "CUSTOMER"),
    balanceSummary: formatPartyBalanceByCurrency(item, "CUSTOMER", ""),
    source: source || null,
  };
}

export async function loadCustomers(baseUrl: string, search = "") {
  const params = new URLSearchParams({
    type: "CUSTOMER",
    limit: "50",
  });

  if (search.trim()) {
    params.set("search", search.trim());
  }

  const urls = [
    `/api/parties/lookup?${params.toString()}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchJson<any>(`${baseUrl}${url}`);
      const rawItems = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.items)
          ? res.data.items
          : Array.isArray(res?.data?.persons)
            ? res.data.persons
            : [];

      const customers = rawItems
        .map((item: any) => normalizeCustomer(item, url))
        .filter(Boolean)
        .filter((item: CustomerOption) => item.isActive !== false);

      if (customers.length) {
        return {
          data: customers as CustomerOption[],
        };
      }
    } catch {
      // Try next endpoint
    }
  }

  return {
    data: [] as CustomerOption[],
  };
}

export async function loadPosDefaults(baseUrl: string): Promise<PosDefaults> {
  const currencies = await fetchJson<{ data: Currency[] }>(`${baseUrl}/api/currencies`);
  const currency = currencies.data.find((item) => item.isBase) || currencies.data[0] || null;

  const warehouses = await fetchJson<{ data: Warehouse[] }>(`${baseUrl}/api/warehouses`);
  const warehouse = warehouses.data.find((item) => item.isDefault) || warehouses.data[0] || null;

  const cashRegisters = await fetchJson<{ data: CashRegister[] }>(
    `${baseUrl}/api/cash-registers`
  );
  const bankAccounts = await fetchJson<{ data: BankAccount[] }>(
    `${baseUrl}/api/bank-accounts`
  ).catch(() => ({ data: [] }));

  let cashAccountId = "";
  const firstRegister = cashRegisters.data[0];

  if (firstRegister && currency) {
    const account =
      firstRegister.accounts.find((item) => item.currencyId === currency.id) ||
      firstRegister.accounts[0];

    if (account) {
      cashAccountId = account.id;
    }
  }

  const bankAccountId =
    currency
      ? bankAccounts.data.find(
          (item) => item.isActive !== false && item.currencyId === currency.id,
        )?.id || ""
      : "";

  return {
    currencies: currencies.data,
    warehouses: warehouses.data,
    cashRegisters: cashRegisters.data,
    bankAccounts: bankAccounts.data,
    currency,
    warehouse,
    cashAccountId,
    bankAccountId,
  };
}

export async function submitPosSale(input: {
  baseUrl: string;
  clientRequestId: string;
  invoiceNo: string;
  currencyId: string;
  paymentAccountType: "CASH" | "BANK";
  paymentAccountId: string;
  paymentLines?: Array<{
    paymentAccountType: "CASH" | "BANK";
    paymentAccountId: string;
    amount: number;
  }>;
  subtotal: number;
  invoiceDiscount: number;
  paidAmount: number;
  tenderedAmount?: number;
  changeAmount?: number;
  customerId?: string | null;
  customerLabel?: string;
  saleNote?: string;
  paymentMethodLabel?: string;
  items: Array<{
    productId: string;
    warehouseId: string;
    unitId: string;
    quantity: number;
    unitPrice: number;
    discount: number;
  }>;
}) {
  const noteParts = ["POS desktop sale from synced cart"];

  if (input.customerLabel?.trim()) {
    noteParts.push(`Customer: ${input.customerLabel.trim()}`);
  }

  if (input.saleNote?.trim()) {
    noteParts.push(`Note: ${input.saleNote.trim()}`);
  }

  if (input.paymentMethodLabel?.trim()) {
    noteParts.push(`Payment: ${input.paymentMethodLabel.trim()}`);
  }

  if (input.tenderedAmount !== undefined) {
    noteParts.push(`TenderedAmount: ${Number(input.tenderedAmount || 0)}`);
  }

  if (input.changeAmount !== undefined) {
    noteParts.push(`ChangeAmount: ${Number(input.changeAmount || 0)}`);
  }

  return fetchJson<any>(`${input.baseUrl}/api/sales`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientRequestId: input.clientRequestId,
      invoiceNo: input.invoiceNo,
      currencyId: input.currencyId,
      discount: input.invoiceDiscount,
      paidAmount: input.paidAmount,
      customerId: input.customerId || null,
      paymentAccountType: input.paymentAccountType,
      paymentAccountId: input.paymentAccountId,
      paymentLines: input.paymentLines,
      note: noteParts.join(" | "),
      items: input.items,
    }),
  });
}

export async function postSaleJournal(input: {
  baseUrl: string;
  saleId: string;
  invoiceNo: string;
  subtotal: number;
  discount: number;
  paidAmount: number;
  partyId?: string | null;
}) {
  return fetchJson<any>(`${input.baseUrl}/api/accounting/post-sale`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      saleId: input.saleId,
      invoiceNo: input.invoiceNo,
      subtotal: input.subtotal,
      discount: input.discount,
      paidAmount: input.paidAmount,
      partyId: input.partyId || null,
    }),
  });
}

export async function postSaleCogsJournal(input: {
  baseUrl: string;
  saleId: string;
  invoiceNo: string;
  items: Array<{
    productId: string;
    warehouseId?: string | null;
    lotId?: string | null;
    quantity: number;
  }>;
}) {
  return fetchJson<{
    data: any | null;
    skipped?: boolean;
    message?: string;
    details?: Array<{
      productId: string;
      warehouseId?: string | null;
      lotId?: string | null;
      quantity: number;
      avgCost: number;
      lineCost: number;
      skipped?: boolean;
      reason?: string;
    }>;
    cogs?: {
      total: number;
      details: Array<{
        productId: string;
        warehouseId?: string | null;
        lotId?: string | null;
        quantity: number;
        avgCost: number;
        lineCost: number;
        skipped?: boolean;
        reason?: string;
      }>;
    };
  }>(`${input.baseUrl}/api/accounting/post-sale-cogs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      saleId: input.saleId,
      invoiceNo: input.invoiceNo,
      items: input.items,
    }),
  });
}
