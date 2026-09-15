import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "./prisma";
import { normalizeBarcodeText } from "./barcode";
import { findProductIdsByBarcode } from "./product-barcode-lookup";

const MIN_CART_QUANTITY = 0.0001;

function normalizeCartQuantity(value: number, fallback: number) {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return Math.max(MIN_CART_QUANTITY, fallback);
  }

  return Math.max(MIN_CART_QUANTITY, Math.round(quantity * 10000) / 10000);
}

type PosClientType = "desktop" | "mobile" | "unknown";

type PosClient = {
  id: string;
  sessionId: string;
  clientType: PosClientType;
  socket: WebSocket;
  connectedAt: Date;
};

type PosSession = {
  id: string;
  name: string;
  createdAt: Date;
  lastActivityAt: Date;
};

type PosSessionSettings = {
  warehouseId?: string | null;
  currencyId?: string | null;
  exchangeRate?: number;
};

type PosCartItem = {
  key: string;
  productId: string;
  productName: string;
  barcode: string | null;
  warehouseId: string;
  warehouseName: string | null;
  unitId: string;
  unitName: string;
  conversionRate: number;
  unitOptions: Array<{
    unitId: string;
    unitName: string;
    conversionRate: number;
    salePrice: number;
    isDefaultSale: boolean;
  }>;
  quantity: number;
  quantityBase: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  availableBaseQuantity: number;
  lotCount: number;
  nextExpiryDate: Date | null;
  // Kept for older Desktop/Mobile clients during the rolling update.
  totalStock: number;
  expiryDate: Date | null;
};

type PosCart = {
  sessionId: string;
  items: PosCartItem[];
  revision: number;
  updatedAt: Date;
};

const sessions = new Map<string, PosSession>();
const clientsBySession = new Map<string, Map<string, PosClient>>();
const cartsBySession = new Map<string, PosCart>();
const cartRevisionBySession = new Map<string, number>();
const settingsBySession = new Map<string, PosSessionSettings>();

type HeldPosCart = {
  id: string;
  sessionId: string;
  name: string;
  cart: PosCart;
  summary: {
    sessionId: string;
    itemsCount: number;
    total: number;
    updatedAt: Date;
  };
  createdAt: Date;
};

const heldCartsBySession = new Map<string, HeldPosCart[]>();

let wsServerStarted = false;
let posWebSocketServer: WebSocketServer | null = null;

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, data) => {
    if (typeof data === "bigint") return data.toString();
    return data;
  });
}

function sendToClient(client: PosClient, type: string, payload: unknown) {
  if (client.socket.readyState !== WebSocket.OPEN) return;

  client.socket.send(
    safeJson({
      type,
      payload,
      time: new Date().toISOString()
    })
  );
}

function touchSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivityAt = new Date();
}

function roundCartBaseQuantity(value: number) {
  return Math.max(MIN_CART_QUANTITY, Math.round(Number(value || 0) * 10000) / 10000);
}

function nextCartRevision(sessionId: string) {
  const next = (cartRevisionBySession.get(sessionId) || 0) + 1;
  cartRevisionBySession.set(sessionId, next);
  return next;
}

function touchCart(sessionId: string, cart: PosCart) {
  cart.revision = nextCartRevision(sessionId);
  cart.updatedAt = new Date();
  cartsBySession.set(sessionId, cart);
  touchSession(sessionId);
  return cart;
}

function cartItemBaseQuantity(item: Pick<PosCartItem, "quantity" | "conversionRate"> & { quantityBase?: number }) {
  const stored = Number(item.quantityBase);
  if (Number.isFinite(stored) && stored > 0) return roundCartBaseQuantity(stored);
  return roundCartBaseQuantity(Number(item.quantity || 0) * Number(item.conversionRate || 1));
}

function quantityForUnit(quantityBase: number, conversionRate: number) {
  if (Number(quantityBase || 0) <= 0) return 0;
  return normalizeCartQuantity(
    roundCartBaseQuantity(quantityBase) / Math.max(Number(conversionRate || 1), MIN_CART_QUANTITY),
    MIN_CART_QUANTITY,
  );
}

class PosCartValidationError extends Error {}

function resolvePosSaleUnit(product: any) {
  const units = (product.units || []).filter((unit: any) => Number(unit.conversionRate || 0) > 0);
  const defaults = units.filter((unit: any) => unit.isDefaultSale);
  const explicitDefault = defaults.length === 1 ? defaults[0] : null;

  if (explicitDefault && Number(explicitDefault.salePrice || 0) > 0) {
    return { unit: explicitDefault, warning: null as string | null };
  }

  const baseUnit = units.find((unit: any) => unit.unitId === product.baseUnitId) || null;
  if (baseUnit && Number(baseUnit.salePrice || 0) > 0) {
    const warning =
      defaults.length > 1
        ? "چند واحد فروش پیش‌فرض ثبت شده است؛ واحد پایه به‌طور موقت استفاده شد"
        : explicitDefault
          ? "قیمت واحد فروش پیش‌فرض معتبر نیست؛ واحد پایه به‌طور موقت استفاده شد"
          : "واحد فروش پیش‌فرض ثبت نشده است؛ واحد پایه به‌طور موقت استفاده شد";
    return { unit: baseUnit, warning };
  }

  return {
    unit: null,
    warning: null as string | null,
    error:
      "برای این محصول واحد فروش پیش‌فرض معتبر با قیمت فروش بیشتر از صفر ثبت نشده است؛ ابتدا واحد و قیمت فروش را اصلاح کنید",
  };
}

export function createPosSession(name?: string) {
  const id = randomUUID();

  const session: PosSession = {
    id,
    name: name || `POS Session ${new Date().toLocaleString()}`,
    createdAt: new Date(),
    lastActivityAt: new Date()
  };

  sessions.set(id, session);

  cartsBySession.set(id, {
    sessionId: id,
    items: [],
    revision: 0,
    updatedAt: new Date()
  });
  cartRevisionBySession.set(id, 0);

  settingsBySession.set(id, {
    warehouseId: null,
    currencyId: null,
    exchangeRate: 1
  });

  return session;
}

export function getPosSessions() {
  return Array.from(sessions.values()).map((session) => {
    const clients = clientsBySession.get(session.id);
    const cart = getPosCart(session.id);

    return {
      ...session,
      settings: getPosSessionSettings(session.id),
      clientsCount: clients?.size || 0,
      cartItemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      cartTotal: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
      clients: clients
        ? Array.from(clients.values()).map((client) => ({
            id: client.id,
            clientType: client.clientType,
            connectedAt: client.connectedAt
          }))
        : []
    };
  });
}

export function getPosSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const clients = clientsBySession.get(sessionId);
  const cart = getPosCart(sessionId);

  return {
    ...session,
    settings: getPosSessionSettings(sessionId),
    clientsCount: clients?.size || 0,
    cartItemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    cartTotal: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
    clients: clients
      ? Array.from(clients.values()).map((client) => ({
          id: client.id,
          clientType: client.clientType,
          connectedAt: client.connectedAt
        }))
      : []
  };
}

export function getPosSessionSettings(sessionId: string) {
  const existing = settingsBySession.get(sessionId);
  if (existing) return existing;

  const settings = {
    warehouseId: null,
    currencyId: null,
    exchangeRate: 1
  };

  settingsBySession.set(sessionId, settings);
  return settings;
}

export function updatePosSessionSettings(input: {
  sessionId: string;
  warehouseId?: string | null;
  currencyId?: string | null;
  exchangeRate?: number;
}) {
  const current = getPosSessionSettings(input.sessionId);
  const nextWarehouseId =
    input.warehouseId === undefined ? current.warehouseId : input.warehouseId;
  const cart = getPosCart(input.sessionId);

  if (
    input.warehouseId !== undefined &&
    nextWarehouseId !== current.warehouseId &&
    cart.items.length > 0
  ) {
    throw new PosCartValidationError(
      "تا زمانی که سبد فروش خالی، ثبت یا معلق نشده است، تغییر گدام مجاز نیست",
    );
  }

  const currentRate = Number(current.exchangeRate || 1);
  const nextRate =
    input.exchangeRate === undefined
      ? currentRate
      : Math.max(Number(input.exchangeRate || 1), 0.00000001);

  const next = {
    ...current,
    warehouseId: nextWarehouseId,
    currencyId: input.currencyId === undefined ? current.currencyId : input.currencyId,
    exchangeRate: nextRate
  };

  settingsBySession.set(input.sessionId, next);
  touchSession(input.sessionId);

  if (nextRate !== currentRate) {
    for (const item of cart.items) {
      item.unitPrice = (item.unitPrice * currentRate) / nextRate;
      item.unitOptions = (item.unitOptions || []).map((option) => ({
        ...option,
        salePrice: (option.salePrice * currentRate) / nextRate
      }));
      item.discount = (item.discount * currentRate) / nextRate;
      item.lineTotal = Math.max(0, item.quantity * item.unitPrice - item.discount);
    }
    touchCart(input.sessionId, cart);
    for (const heldCart of heldCartsBySession.get(input.sessionId) || []) {
      for (const item of heldCart.cart.items) {
        item.unitPrice = (item.unitPrice * currentRate) / nextRate;
        item.unitOptions = (item.unitOptions || []).map((option) => ({
          ...option,
          salePrice: (option.salePrice * currentRate) / nextRate
        }));
        item.discount = (item.discount * currentRate) / nextRate;
        item.lineTotal = Math.max(0, item.quantity * item.unitPrice - item.discount);
      }
      heldCart.cart.updatedAt = new Date();
      heldCart.summary.total = heldCart.cart.items.reduce(
        (sum, item) => sum + item.lineTotal,
        0
      );
      heldCart.summary.updatedAt = heldCart.cart.updatedAt;
    }
    broadcastCartUpdated(input.sessionId);
  }

  broadcastToPosSession(input.sessionId, "SESSION_SETTINGS_UPDATED", {
    settings: next
  });

  return next;
}

export function getPosCart(sessionId: string): PosCart {
  const existing = cartsBySession.get(sessionId);
  if (existing) {
    if (!Number.isSafeInteger(existing.revision)) {
      existing.revision = cartRevisionBySession.get(sessionId) || 0;
    }
    return existing;
  }

  const cart = {
    sessionId,
    items: [],
    revision: cartRevisionBySession.get(sessionId) || 0,
    updatedAt: new Date()
  };

  cartsBySession.set(sessionId, cart);
  return cart;
}

export function getPosCartSummary(sessionId: string) {
  const cart = getPosCart(sessionId);

  return {
    sessionId,
    revision: cart.revision,
    itemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    total: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
    updatedAt: cart.updatedAt
  };
}

export function clearPosCart(sessionId: string) {
  const cart = {
    sessionId,
    items: [],
    revision: cartRevisionBySession.get(sessionId) || 0,
    updatedAt: new Date()
  };

  touchCart(sessionId, cart);
  broadcastCartUpdated(sessionId);

  return cart;
}

export function updatePosCartItem(input: {
  sessionId: string;
  key: string;
  quantity?: number;
  unitId?: string;
  unitPrice?: number;
  discount?: number;
}) {
  const cart = getPosCart(input.sessionId);
  const index = cart.items.findIndex((item) => item.key === input.key);
  if (index < 0) return cart;

  const item = cart.items[index]!;
  const selectedUnit =
    input.unitId && input.unitId !== item.unitId
      ? item.unitOptions.find((option) => option.unitId === input.unitId)
      : null;
  if (
    input.unitId &&
    input.unitId !== item.unitId &&
    (!selectedUnit ||
      Number(selectedUnit.conversionRate || 0) <= 0 ||
      Number(selectedUnit.salePrice || 0) <= 0)
  ) {
    throw new PosCartValidationError(
      "واحد فروش انتخاب‌شده قیمت فروش معتبر یا نرخ تبدیل قابل استفاده ندارد",
    );
  }
  const unitId = selectedUnit?.unitId || item.unitId;
  const unitName = selectedUnit?.unitName || item.unitName;
  const conversionRate = Number(selectedUnit?.conversionRate || item.conversionRate || 1);
  // A unit switch represents the cashier choosing a new selling package. Keep the
  // entered count stable (for example, 2 stays 2) and recalculate its base quantity.
  const requestedQuantity = normalizeCartQuantity(input.quantity ?? item.quantity, item.quantity);
  const quantityBase =
    input.quantity === undefined && !selectedUnit
      ? cartItemBaseQuantity(item)
      : roundCartBaseQuantity(requestedQuantity * conversionRate);
  const quantity = requestedQuantity;
  const unitPrice =
    input.unitPrice !== undefined
      ? Math.max(0, Number(input.unitPrice || 0))
      : selectedUnit
        ? Math.max(0, Number(selectedUnit.salePrice || 0))
        : item.unitPrice;
  const discount =
    input.discount === undefined ? item.discount : Math.max(0, Number(input.discount || 0));

  // The row identity deliberately does not include the selected unit, so a product keeps one
  // cart row even when its selling unit changes.
  cart.items[index] = {
    ...item,
    key: `${item.productId}:${item.warehouseId}`,
    unitId,
    unitName,
    conversionRate,
    quantity,
    quantityBase,
    unitPrice,
    discount,
    lineTotal: Math.max(0, quantity * unitPrice - discount),
  };

  touchCart(input.sessionId, cart);
  broadcastCartUpdated(input.sessionId);

  return cart;
}

export function updatePosCartItemQuantity(input: {
  sessionId: string;
  key: string;
  quantity: number;
}) {
  return updatePosCartItem({
    sessionId: input.sessionId,
    key: input.key,
    quantity: input.quantity
  });
}

export function removePosCartItem(input: {
  sessionId: string;
  key: string;
}) {
  const cart = getPosCart(input.sessionId);

  cart.items = cart.items.filter((item) => item.key !== input.key);
  touchCart(input.sessionId, cart);
  broadcastCartUpdated(input.sessionId);

  return cart;
}

export function broadcastToPosSession(sessionId: string, type: string, payload: unknown) {
  const clients = clientsBySession.get(sessionId);
  if (!clients) return 0;

  let sent = 0;

  for (const client of clients.values()) {
    sendToClient(client, type, payload);
    sent += 1;
  }

  touchSession(sessionId);
  return sent;
}

export function broadcastCartUpdated(sessionId: string) {
  const cart = getPosCart(sessionId);

  return broadcastToPosSession(sessionId, "CART_UPDATED", {
    cart,
    summary: getPosCartSummary(sessionId)
  });
}

function addPayloadToCart(input: {
  sessionId: string;
  payload: {
    product: any;
    defaultSaleUnit: any;
    warehouse: { id: string; name: string };
    availableBaseQuantity: number;
    lotCount: number;
    nextExpiryDate: Date | null;
  };
}) {
  const cart = getPosCart(input.sessionId);
  const product = input.payload.product;

  const defaultSaleUnit = input.payload.defaultSaleUnit;

  const unitId = defaultSaleUnit?.unitId || product.baseUnitId;
  const unitName =
    defaultSaleUnit?.unit?.shortName ||
    defaultSaleUnit?.unit?.name ||
    product.baseUnit?.shortName ||
    product.baseUnit?.name ||
    "Unit";

  const exchangeRate = Number(getPosSessionSettings(input.sessionId).exchangeRate || 1);
  const unitPrice = Number(defaultSaleUnit?.salePrice || 0) / exchangeRate;
  const conversionRate = Number(defaultSaleUnit?.conversionRate || 1);
  const unitOptions = (product.units || [])
    .filter(
      (item: any) =>
        Number(item.conversionRate || 0) > 0 && Number(item.salePrice || 0) > 0,
    )
    .map((item: any) => ({
      unitId: item.unitId,
      unitName: item.unit?.shortName || item.unit?.name || "Unit",
      conversionRate: Number(item.conversionRate || 1),
      salePrice: Number(item.salePrice || 0) / exchangeRate,
      isDefaultSale: Boolean(item.isDefaultSale)
    }));
  const warehouseId = input.payload.warehouse.id;
  const warehouseName = input.payload.warehouse.name;
  const key = `${product.id}:${warehouseId}`;

  const existing = cart.items.find((item) => item.key === key);

  if (existing) {
    const quantityBase = roundCartBaseQuantity(
      cartItemBaseQuantity(existing) + Number(existing.conversionRate || 1),
    );
    existing.quantityBase = quantityBase;
    existing.quantity = quantityForUnit(quantityBase, Number(existing.conversionRate || 1));
    existing.availableBaseQuantity = Number(input.payload.availableBaseQuantity || 0);
    existing.totalStock = existing.availableBaseQuantity;
    existing.lotCount = input.payload.lotCount;
    existing.nextExpiryDate = input.payload.nextExpiryDate;
    existing.expiryDate = input.payload.nextExpiryDate;
    existing.unitOptions = unitOptions;
    existing.lineTotal = Math.max(0, existing.quantity * existing.unitPrice - existing.discount);
  } else {
    cart.items.unshift({
      key,
      productId: product.id,
      productName: product.name,
      barcode: product.barcode || null,
      warehouseId,
      warehouseName,
      unitId,
      unitName,
      conversionRate,
      unitOptions,
      quantity: 1,
      quantityBase: roundCartBaseQuantity(conversionRate),
      unitPrice,
      discount: 0,
      lineTotal: unitPrice,
      availableBaseQuantity: Number(input.payload.availableBaseQuantity || 0),
      lotCount: input.payload.lotCount,
      nextExpiryDate: input.payload.nextExpiryDate,
      totalStock: Number(input.payload.availableBaseQuantity || 0),
      expiryDate: input.payload.nextExpiryDate,
    });
  }

  touchCart(input.sessionId, cart);

  return cart;
}

type PosCartRevalidationIssue = {
  key: string;
  productId: string;
  productName: string;
  warehouseId: string;
  requiredBaseQuantity: number;
  availableBaseQuantity: number;
  maxSellableQuantity: number;
  lotCount: number;
};

export async function revalidatePosCart(sessionId: string) {
  const cart = getPosCart(sessionId);
  const targets = Array.from(
    new Map(
      cart.items.map((item) => [
        `${item.productId}:${item.warehouseId}`,
        { productId: item.productId, warehouseId: item.warehouseId },
      ]),
    ).values(),
  );

  const lots = targets.length
    ? await prisma.stockLot.findMany({
        where: {
          remainingQuantity: { gt: 0 },
          OR: targets,
        },
        select: {
          productId: true,
          warehouseId: true,
          remainingQuantity: true,
          expiryDate: true,
          createdAt: true,
        },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      })
    : [];

  const availability = new Map<
    string,
    { availableBaseQuantity: number; lotCount: number; nextExpiryDate: Date | null }
  >();
  for (const lot of lots) {
    const key = `${lot.productId}:${lot.warehouseId}`;
    const current = availability.get(key) || {
      availableBaseQuantity: 0,
      lotCount: 0,
      nextExpiryDate: null,
    };
    current.availableBaseQuantity += Number(lot.remainingQuantity);
    current.lotCount += 1;
    if (!current.nextExpiryDate && lot.expiryDate) current.nextExpiryDate = lot.expiryDate;
    availability.set(key, current);
  }

  const issues: PosCartRevalidationIssue[] = [];
  for (const item of cart.items) {
    const current = availability.get(`${item.productId}:${item.warehouseId}`) || {
      availableBaseQuantity: 0,
      lotCount: 0,
      nextExpiryDate: null,
    };
    const quantityBase = cartItemBaseQuantity(item);
    item.quantityBase = quantityBase;
    item.availableBaseQuantity = Math.round(current.availableBaseQuantity * 10000) / 10000;
    item.totalStock = item.availableBaseQuantity;
    item.lotCount = current.lotCount;
    item.nextExpiryDate = current.nextExpiryDate;
    item.expiryDate = current.nextExpiryDate;

    if (quantityBase > item.availableBaseQuantity) {
      issues.push({
        key: item.key,
        productId: item.productId,
        productName: item.productName,
        warehouseId: item.warehouseId,
        requiredBaseQuantity: quantityBase,
        availableBaseQuantity: item.availableBaseQuantity,
        maxSellableQuantity: quantityForUnit(item.availableBaseQuantity, item.conversionRate),
        lotCount: item.lotCount,
      });
    }
  }

  touchCart(sessionId, cart);
  broadcastCartUpdated(sessionId);
  return { cart, summary: getPosCartSummary(sessionId), issues };
}

export async function handlePosBarcodeScan(input: {
  sessionId: string;
  barcode: string;
  productId?: string | null;
  warehouseId?: string | null;
  source?: "http" | "websocket";
}) {
  const barcode = normalizeBarcodeText(input.barcode);

  if (!barcode && !input.productId) {
    const payload = {
      barcode,
      message: "بارکود لازم است"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, error: payload };
  }

  const sessionSettings = getPosSessionSettings(input.sessionId);
  const warehouseIdForScan = input.warehouseId || sessionSettings.warehouseId || null;

  if (!warehouseIdForScan) {
    const payload = {
      code: "WAREHOUSE_REQUIRED",
      message: "ابتدا گدام فعال را انتخاب کنید",
    };
    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, statusCode: 400 as const, error: payload };
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseIdForScan, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!warehouse) {
    const payload = {
      code: "WAREHOUSE_UNAVAILABLE",
      message: "گدام فعال انتخاب‌شده پیدا نشد یا غیرفعال است",
    };
    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, statusCode: 400 as const, error: payload };
  }

  const productIds = input.productId
    ? [input.productId]
    : await findProductIdsByBarcode(input.barcode);

  if (!input.productId && productIds.length > 1) {
    const candidateRows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        barcode: true,
        sku: true,
        isActive: true,
        deletedAt: true,
      },
    });
    const candidateById = new Map(candidateRows.map((candidate) => [candidate.id, candidate]));
    const candidates = productIds
      .map((id) => candidateById.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const payload = {
      code: "BARCODE_AMBIGUOUS",
      status: "AMBIGUOUS",
      barcode,
      candidates,
      message: "این بارکود به چند محصول مربوط است؛ محصول درست را از لیست انتخاب کنید",
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, statusCode: 409 as const, error: payload };
  }

  const product = productIds[0]
    ? await prisma.product.findUnique({
        where: { id: productIds[0] },
        include: {
          baseUnit: true,
          units: {
            include: {
              unit: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;

  if (!product) {
    const payload = {
      barcode,
      message: "محصولی با این بارکود ثبت نشده است"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, error: payload };
  }

  if (product.deletedAt || !product.isActive) {
    const payload = {
      barcode,
      product,
      message: product.deletedAt
        ? "این محصول حذف شده و قابل فروش نیست"
        : "این محصول غیرفعال است و قابل فروش نیست"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, error: payload };
  }

  const unitResolution = resolvePosSaleUnit(product);
  if (!unitResolution.unit) {
    const payload = {
      code: "POS_SALE_UNIT_INVALID",
      product: { id: product.id, name: product.name },
      message: unitResolution.error,
    };
    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, statusCode: 400 as const, error: payload };
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: product.id,
      remainingQuantity: {
        gt: 0
      },
      warehouseId: warehouseIdForScan,
    },
    include: {
      warehouse: true
    },
    orderBy: [
      {
        expiryDate: "asc"
      },
      {
        createdAt: "asc"
      }
    ]
  });

  const availableBaseQuantity = lots.reduce((sum, lot) => {
    return sum + Number(lot.remainingQuantity);
  }, 0);

  const payload = {
    sessionId: input.sessionId,
    source: input.source || "http",
    barcode,
    product,
    defaultSaleUnit: unitResolution.unit,
    unitResolutionWarning: unitResolution.warning,
    availableBaseQuantity,
    totalStock: availableBaseQuantity,
    lotCount: lots.length,
    nextExpiryDate: lots[0]?.expiryDate || null,
    activeWarehouseId: warehouseIdForScan,
    warehouse,
  };

  if (availableBaseQuantity <= 0) {
    const errorPayload = {
      barcode,
      product,
      availableBaseQuantity,
      activeWarehouseId: warehouseIdForScan,
      message: "این محصول در گدام انتخاب‌شده موجودی قابل فروش ندارد",
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", errorPayload);
    return { ok: false, error: errorPayload };
  }

  const cart = addPayloadToCart({
    sessionId: input.sessionId,
    payload
  });

  broadcastToPosSession(input.sessionId, "BARCODE_SCANNED", payload);
  broadcastCartUpdated(input.sessionId);

  return {
    ok: true,
    data: {
      ...payload,
      cart,
      cartSummary: getPosCartSummary(input.sessionId)
    }
  };
}


export function getHeldPosCarts(sessionId: string) {
  return heldCartsBySession.get(sessionId) || [];
}

export function holdPosCart(input: {
  sessionId: string;
  name?: string | null;
}) {
  const currentCart = getPosCart(input.sessionId);

  if (!currentCart.items.length) {
    return {
      held: null,
      cart: currentCart,
      summary: getPosCartSummary(input.sessionId)
    };
  }

  const held: HeldPosCart = {
    id: randomUUID(),
    sessionId: input.sessionId,
    name: input.name?.trim() || `Held sale ${new Date().toLocaleTimeString()}`,
    cart: {
      sessionId: currentCart.sessionId,
      items: currentCart.items.map((item) => ({ ...item })),
      revision: currentCart.revision,
      updatedAt: new Date(currentCart.updatedAt)
    },
    summary: {
      ...getPosCartSummary(input.sessionId)
    },
    createdAt: new Date()
  };

  const list = heldCartsBySession.get(input.sessionId) || [];
  heldCartsBySession.set(input.sessionId, [held, ...list]);

  clearPosCart(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return {
    held,
    cart: getPosCart(input.sessionId),
    summary: getPosCartSummary(input.sessionId)
  };
}

export function restoreHeldPosCart(input: {
  sessionId: string;
  heldCartId: string;
}) {
  const list = heldCartsBySession.get(input.sessionId) || [];
  const held = list.find((item) => item.id === input.heldCartId);

  if (!held) {
    return null;
  }

  const restoredCart: PosCart = {
    sessionId: input.sessionId,
    items: held.cart.items.map((item) => ({ ...item })),
    revision: cartRevisionBySession.get(input.sessionId) || 0,
    updatedAt: new Date()
  };

  touchCart(input.sessionId, restoredCart);

  heldCartsBySession.set(
    input.sessionId,
    list.filter((item) => item.id !== input.heldCartId)
  );

  touchSession(input.sessionId);
  broadcastCartUpdated(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return {
    held,
    cart: restoredCart,
    summary: getPosCartSummary(input.sessionId)
  };
}

export function deleteHeldPosCart(input: {
  sessionId: string;
  heldCartId: string;
}) {
  const list = heldCartsBySession.get(input.sessionId) || [];

  heldCartsBySession.set(
    input.sessionId,
    list.filter((item) => item.id !== input.heldCartId)
  );

  touchSession(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return getHeldPosCarts(input.sessionId);
}

export function startPosWebSocketServer(port = 4001) {
  if (wsServerStarted) return posWebSocketServer;

  wsServerStarted = true;

  const wss = new WebSocketServer({ port });
  posWebSocketServer = wss;

  wss.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const sessionId = requestUrl.searchParams.get("sessionId") || "";
    const clientTypeRaw = requestUrl.searchParams.get("clientType") || "unknown";

    const clientType: PosClientType =
      clientTypeRaw === "desktop" || clientTypeRaw === "mobile"
        ? clientTypeRaw
        : "unknown";

    if (!sessionId) {
      socket.send(
        safeJson({
          type: "CONNECTION_ERROR",
          payload: { message: "sessionId is required" }
        })
      );
      socket.close();
      return;
    }

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        id: sessionId,
        name: "External POS Session",
        createdAt: new Date(),
        lastActivityAt: new Date()
      });
    }

    getPosCart(sessionId);
    getPosSessionSettings(sessionId);

    const client: PosClient = {
      id: randomUUID(),
      sessionId,
      clientType,
      socket,
      connectedAt: new Date()
    };

    if (!clientsBySession.has(sessionId)) {
      clientsBySession.set(sessionId, new Map());
    }

    clientsBySession.get(sessionId)?.set(client.id, client);

    sendToClient(client, "CONNECTED", {
      clientId: client.id,
      sessionId,
      clientType,
      websocketPort: port
    });

    sendToClient(client, "CART_UPDATED", {
      cart: getPosCart(sessionId),
      summary: getPosCartSummary(sessionId)
    });

    sendToClient(client, "SESSION_SETTINGS_UPDATED", {
      settings: getPosSessionSettings(sessionId)
    });

    sendToClient(client, "HELD_CARTS_UPDATED", {
      heldCarts: getHeldPosCarts(sessionId)
    });

    broadcastToPosSession(sessionId, "CLIENT_CONNECTED", {
      clientId: client.id,
      clientType
    });

    socket.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(String(rawMessage));

        if (message.type === "PING") {
          sendToClient(client, "PONG", { clientId: client.id });
          return;
        }

        if (message.type === "SET_SESSION_SETTINGS" || message.type === "SET_ACTIVE_WAREHOUSE") {
          updatePosSessionSettings({
            sessionId,
            warehouseId:
              message.warehouseId === undefined
                ? undefined
                : message.warehouseId
                  ? String(message.warehouseId)
                  : null,
            currencyId:
              message.currencyId === undefined
                ? undefined
                : message.currencyId
                  ? String(message.currencyId)
                  : null,
            exchangeRate:
              message.exchangeRate === undefined ? undefined : Number(message.exchangeRate || 1)
          });
          return;
        }

        if (message.type === "SCAN_BARCODE") {
          await handlePosBarcodeScan({
            sessionId,
            barcode: String(message.barcode || ""),
            warehouseId: message.warehouseId ? String(message.warehouseId) : null,
            source: "websocket"
          });
          return;
        }

        if (message.type === "CLEAR_CART") {
          clearPosCart(sessionId);
          return;
        }

        if (message.type === "HOLD_CART") {
          holdPosCart({
            sessionId,
            name: message.name ? String(message.name) : null
          });
          return;
        }

        if (message.type === "RESTORE_HELD_CART") {
          restoreHeldPosCart({
            sessionId,
            heldCartId: String(message.heldCartId || "")
          });
          return;
        }

        if (message.type === "DELETE_HELD_CART") {
          deleteHeldPosCart({
            sessionId,
            heldCartId: String(message.heldCartId || "")
          });
          return;
        }

        if (message.type === "UPDATE_CART_ITEM_QTY") {
          updatePosCartItemQuantity({
            sessionId,
            key: String(message.key || ""),
            quantity: Number(message.quantity ?? 1)
          });
          return;
        }

        if (message.type === "UPDATE_CART_ITEM") {
          updatePosCartItem({
            sessionId,
            key: String(message.key || ""),
            quantity: message.quantity === undefined ? undefined : Number(message.quantity),
            unitId: message.unitId === undefined ? undefined : String(message.unitId),
            unitPrice: message.unitPrice === undefined ? undefined : Number(message.unitPrice),
            discount: message.discount === undefined ? undefined : Number(message.discount)
          });
          return;
        }

        if (message.type === "REMOVE_CART_ITEM") {
          removePosCartItem({
            sessionId,
            key: String(message.key || "")
          });
          return;
        }

        sendToClient(client, "UNKNOWN_MESSAGE", { message });
      } catch (error) {
        sendToClient(client, "MESSAGE_ERROR", {
          message: error instanceof Error ? error.message : "عملیات POS ناکام شد",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on("close", () => {
      clientsBySession.get(sessionId)?.delete(client.id);

      broadcastToPosSession(sessionId, "CLIENT_DISCONNECTED", {
        clientId: client.id,
        clientType
      });
    });
  });

  console.log(`POS WebSocket running on ws://localhost:${port}`);
  return wss;
}
