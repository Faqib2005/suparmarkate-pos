export type PosSessionResponse = {
  data: {
    session: {
      id: string;
      name: string;
    };
    connection: {
      sessionId: string;
      apiBaseUrl: string;
      desktopWebSocketUrl: string;
      mobileWebSocketUrl: string;
      mobileScanHttpUrl: string;
      qrImageUrl: string;
      qrPageUrl: string;
      testPageUrl: string;
    };
  };
};

export type Currency = {
  id: string;
  code: string;
  name?: string;
  symbol?: string | null;
  isBase?: boolean;
  latestRate?: number | null;
};

export type Warehouse = {
  id: string;
  name: string;
  isDefault?: boolean;
};

export type CashRegister = {
  id: string;
  name: string;
  accounts: Array<{
    id: string;
    currencyId: string;
    balance: string | number;
  }>;
};

export type BankAccount = {
  id: string;
  name: string;
  bankName?: string | null;
  accountNumber?: string | null;
  currencyId: string;
  balance: string | number;
  isActive?: boolean;
  currency?: Currency | null;
};

export type CustomerOption = {
  id: string;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  type?: string | null;
  isActive?: boolean;
  balance?: number;
  balanceSummary?: string | null;
  accountsCount?: number;
  source?: string | null;
};

export type ProductSearchItem = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  hasExpiry?: boolean;
  minStock?: string | number | null;
  totalStock?: string | number | null;
  categoryId?: string | null;
  baseUnitId?: string | null;
  category?: {
    id: string;
    name: string;
  } | null;
  baseUnit?: {
    id: string;
    name: string;
    shortName?: string | null;
  } | null;
  units?: Array<{
    id: string;
    unitId: string;
    conversionRate?: string | number | null;
    purchasePrice?: string | number | null;
    salePrice?: string | number | null;
    isDefaultPurchase?: boolean;
    isDefaultSale?: boolean;
    unit?: {
      name: string;
      shortName?: string | null;
    } | null;
  }>;
};

export type ServerCartItem = {
  key: string;
  productId: string;
  productName: string;
  barcode?: string | null;
  warehouseId: string;
  warehouseName?: string | null;
  unitId: string;
  unitName: string;
  conversionRate?: number;
  unitOptions?: Array<{
    unitId: string;
    unitName: string;
    conversionRate: number;
    salePrice: number;
    isDefaultSale?: boolean;
  }>;
  quantity: number;
  quantityBase?: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  availableBaseQuantity?: number;
  lotCount?: number;
  nextExpiryDate?: string | null;
  // Compatibility fields for an older API during phased deployment.
  totalStock?: number;
  expiryDate?: string | null;
};

export type ServerCart = {
  sessionId: string;
  items: ServerCartItem[];
  revision?: number;
  updatedAt: string;
};

export type ServerCartSummary = {
  sessionId: string;
  revision?: number;
  itemsCount: number;
  total: number;
  updatedAt: string;
};

export type PosDefaults = {
  currencies: Currency[];
  warehouses: Warehouse[];
  cashRegisters: CashRegister[];
  bankAccounts: BankAccount[];
  currency: Currency | null;
  warehouse: Warehouse | null;
  cashAccountId: string;
  bankAccountId: string;
};

export type PosProductSearchResponse = {
  data: ProductSearchItem[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextOffset: number;
  };
  facets?: {
    categories?: Array<{ id: string; name: string; count: number }>;
  };
};

export type CartPayload = {
  cart: ServerCart;
  summary: ServerCartSummary;
};

export type HeldCart = {
  id: string;
  sessionId: string;
  name: string;
  cart: ServerCart;
  summary: ServerCartSummary;
  createdAt: string;
};

export type PosShiftSale = {
  id: string;
  invoiceNo: string;
  saleId: string;
  receiptUrl?: string | null;
  total: number;
  paidAmount: number;
  changeAmount: number;
  createdAt: string;
};

export type PosShiftSummary = {
  id: string;
  openedAt: string;
  closedAt?: string | null;
  sales: PosShiftSale[];
};
