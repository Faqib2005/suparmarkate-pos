import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArchiveRestore,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Calculator,
  CalendarDays,
  Copy,
  CreditCard,
  DatabaseBackup,
  Eye,
  FileBarChart,
  FileText,
  Expand,
  History,
  Home,
  HeartPulse,
  Landmark,
  LogOut,
  Maximize2,
  Minimize2,
  Package,
  Paperclip,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Shrink,
  ShoppingBag,
  ShoppingCart,
  Store,
  Moon,
  MoreHorizontal,
  Square,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  UserRound,
  UsersRound,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmButton, ConfirmDropdownItem } from "@/components/ui/confirm-action";
import { DatePicker } from "@/components/ui/date-picker";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReturnDocumentsCard } from "@/features/returns/return-documents-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { AccountingPage } from "@/features/accounting/components/accounting-page";
import { PosPage } from "@/features/pos/components/pos-page";
import { ProductDuplicatesDialog } from "@/features/products/product-duplicates-dialog";
import {
  API_BASE_URL,
  getStoredApiBaseUrl,
  saveApiBaseUrl,
  testApiBaseUrl,
} from "@/lib/api-config";
import { formatPartyBalanceByCurrency, partyBalanceBase } from "@/lib/party-balance";
import {
  formatKabulDate,
  formatKabulDateTime,
  kabulDateString,
} from "@/lib/kabul-date";
import { dateRangeQuery, recentDateRange } from "@/lib/recent-date-filter";
import { allocateMoneyByWeight } from "@/lib/money-allocation";
import { refreshReceiptAccessUrl } from "@/lib/receipt-access";

const ReportsPageRoute = lazy(() =>
  import("@/features/reports/reports-page").then((module) => ({
    default: module.ReportsPage,
  })),
);
const IncomeExpensesPageRoute = lazy(() =>
  import("@/features/treasury/income-expenses-page").then((module) => ({
    default: module.IncomeExpensesPage,
  })),
);
const CustomersPageRoute = lazy(() =>
  import("@/features/parties/party-management-page").then((module) => ({
    default: module.CustomersPage,
  })),
);
const SuppliersPageRoute = lazy(() =>
  import("@/features/parties/party-management-page").then((module) => ({
    default: module.SuppliersPage,
  })),
);
const BackupPageRoute = lazy(() =>
  import("@/features/backups/backup-page").then((module) => ({
    default: module.BackupPage,
  })),
);
const SettingsPageRoute = lazy(() =>
  import("@/features/settings/settings-page").then((module) => ({
    default: module.SettingsPageRoute,
  })),
);
const DashboardPageRoute = lazy(() =>
  import("@/features/dashboard/dashboard-page").then((module) => ({
    default: module.DashboardPage,
  })),
);
const ProductHistoryPageRoute = lazy(() =>
  import("@/features/products/product-history-page").then((module) => ({
    default: module.ProductHistoryPage,
  })),
);
const CurrencyHistoryPageRoute = lazy(() =>
  import("@/features/settings/currency-history-page").then((module) => ({
    default: module.CurrencyHistoryPage,
  })),
);
const UsersRolesPageRoute = lazy(() =>
  import("@/features/users/users-roles-page").then((module) => ({
    default: module.UsersRolesPage,
  })),
);
const AlertsPageRoute = lazy(() =>
  import("@/features/alerts/alerts-page").then((module) => ({
    default: module.AlertsPage,
  })),
);
const SystemHealthPageRoute = lazy(() =>
  import("@/features/system-health/system-health-page").then((module) => ({
    default: module.SystemHealthPage,
  })),
);
const AccountPeriodBalancesPageRoute = lazy(() =>
  import("@/features/accounting/account-period-balances-page").then((module) => ({
    default: module.AccountPeriodBalancesPage,
  })),
);
const EmployeesPageRoute = lazy(() =>
  import("@/features/employees/employees-page").then((module) => ({
    default: module.EmployeesPage,
  })),
);
const AttendanceScanPageRoute = lazy(() =>
  import("@/features/employees/attendance-scan-page").then((module) => ({
    default: module.AttendanceScanPage,
  })),
);
const AUTH_TOKEN_KEY = "belal_auth_token";
const AUTH_USER_KEY = "belal_auth_user";
const POS_DEVICE_CODE_KEY = "belal_pos_device_code";
const THEME_KEY = "belal_theme";

function appAssetPath(path: string) {
  return `${import.meta.env.BASE_URL || "./"}${path.replace(/^\//, "")}`;
}

type ThemeMode = "light" | "dark";

type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string | null;
  permissions: string[];
  mustChangePassword?: boolean;
};

type AuthState = {
  token: string;
  user: AuthUser;
};

declare global {
  interface Window {
    __belalAuthFetchInstalled?: boolean;
  }
}

function createClientId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const IDEMPOTENT_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RECENT_MUTATION_OPERATIONS_KEY = "muhaseb_recent_mutation_operations_v1";
type RecentMutationOperation = { operationId: string; expiresAt: number };

function loadRecentMutationOperations() {
  const operations = new Map<string, RecentMutationOperation>();
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RECENT_MUTATION_OPERATIONS_KEY) || "[]",
    ) as Array<[string, RecentMutationOperation]>;
    const now = Date.now();
    for (const [signature, operation] of parsed) {
      if (signature && operation?.operationId && Number(operation.expiresAt) > now) {
        operations.set(signature, operation);
      }
    }
  } catch {
    localStorage.removeItem(RECENT_MUTATION_OPERATIONS_KEY);
  }
  return operations;
}

const recentMutationOperations: Map<string, RecentMutationOperation> =
  loadRecentMutationOperations();

function persistRecentMutationOperations() {
  try {
    localStorage.setItem(
      RECENT_MUTATION_OPERATIONS_KEY,
      JSON.stringify(Array.from(recentMutationOperations.entries())),
    );
  } catch {
    // Idempotency still works for the current process when storage is unavailable.
  }
}

function pruneRecentMutationOperations(now: number) {
  let changed = false;
  for (const [key, entry] of recentMutationOperations) {
    if (entry.expiresAt <= now) {
      recentMutationOperations.delete(key);
      changed = true;
    }
  }
  if (changed) persistRecentMutationOperations();
}

function shortStableHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function mutationBodySignature(body: BodyInit | null | undefined) {
  if (body == null) return "empty";
  if (typeof body === "string") return `text:${body}`;
  if (body instanceof URLSearchParams) return `params:${body.toString()}`;
  if (body instanceof FormData) {
    const entries: string[] = [];
    for (const [name, value] of body.entries()) {
      entries.push(
        typeof value === "string"
          ? `${name}=text:${value}`
          : `${name}=file:${value.name}:${value.type}:${value.size}:${value.lastModified}`,
      );
    }
    return `form:${entries.join("|")}`;
  }
  if (body instanceof Blob) return `blob:${body.type}:${body.size}`;
  if (body instanceof ArrayBuffer) return `buffer:${body.byteLength}`;
  if (ArrayBuffer.isView(body)) return `view:${body.byteLength}`;
  return `body:${Object.prototype.toString.call(body)}`;
}

function installAuthenticatedFetch() {
  if (window.__belalAuthFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const headers = new Headers(init.headers || {});
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (!headers.has("x-client-channel")) {
      headers.set(
        "x-client-channel",
        navigator.userAgent.includes("Electron") ? "ELECTRON" : "WEB",
      );
    }
    if (!headers.has("x-app-version")) {
      headers.set("x-app-version", import.meta.env.VITE_APP_VERSION || "desktop-dev");
    }

    let deviceCode = localStorage.getItem(POS_DEVICE_CODE_KEY);
    if (!deviceCode) {
      deviceCode = `POS-${createClientId()}`;
      localStorage.setItem(POS_DEVICE_CODE_KEY, deviceCode);
    }

    if (!headers.has("x-pos-device-code")) {
      headers.set("x-pos-device-code", deviceCode);
      headers.set(
        "x-pos-device-name",
        navigator.userAgent.includes("Mobile") ? "Mobile POS" : "Desktop POS",
      );
      headers.set(
        "x-pos-device-type",
        navigator.userAgent.includes("Mobile") ? "MOBILE" : "DESKTOP",
      );
    }

    if (IDEMPOTENT_WRITE_METHODS.has(method)) {
      const pathName = new URL(requestUrl, window.location.href).pathname;
      const payloadSignature = mutationBodySignature(init.body);
      const payloadHash = shortStableHash(payloadSignature);
      const mutationSignature = shortStableHash(
        `${method}:${requestUrl}:${payloadHash}:${shortStableHash(token || "anonymous")}`,
      );
      const now = Date.now();

      pruneRecentMutationOperations(now);

      if (!headers.has("Idempotency-Key") && pathName !== "/api/pos/scan") {
        const recent = recentMutationOperations.get(mutationSignature);
        const operationId = recent?.operationId || createClientId();
        recentMutationOperations.set(mutationSignature, {
          operationId,
          expiresAt: now + 10 * 60_000,
        });
        persistRecentMutationOperations();
        headers.set("Idempotency-Key", operationId);
        headers.set("X-Idempotency-Payload-Hash", payloadHash);
      }

      if (!headers.has("x-correlation-id") && headers.has("Idempotency-Key")) {
        headers.set("x-correlation-id", headers.get("Idempotency-Key")!);
      }

      const response = originalFetch(input, { ...init, method, headers });
      return response
        .then((result) => {
          const current = recentMutationOperations.get(mutationSignature);
          if (current) {
            if (result.ok) recentMutationOperations.delete(mutationSignature);
            else if (result.status >= 500 || result.status === 409) {
              current.expiresAt = Date.now() + 10 * 60_000;
            } else {
              recentMutationOperations.delete(mutationSignature);
            }
            persistRecentMutationOperations();
          }
          return result;
        })
        .catch((error) => {
          const current = recentMutationOperations.get(mutationSignature);
          if (current) {
            current.expiresAt = Date.now() + 10 * 60_000;
            persistRecentMutationOperations();
          }
          throw error;
        });
    }

    return originalFetch(input, {
      ...init,
      headers,
    });
  };

  window.__belalAuthFetchInstalled = true;
}

type DataRow = Record<string, any>;

type DocumentAttachment = {
  id: string;
  entityType: string;
  entityId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  note?: string | null;
  createdAt: string;
  createdByUser?: {
    displayName?: string | null;
    username?: string | null;
  } | null;
};

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email" | "tel" | "checkbox";
};

type AdminPageConfig = {
  title: string;
  description: string;
  endpoint?: string;
  apiCrud?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  createType?: "CUSTOMER" | "SUPPLIER";
  icon: ReactNode;
  stats: Array<{
    label: string;
    value: string;
    icon: ReactNode;
    trend?: string;
  }>;
  columns: Array<{ key: string; label: string }>;
  rows: DataRow[];
  fields: Field[];
  note: string;
};

type DashboardSummary = {
  sales: {
    today: number;
    month: number;
    todayPaid: number;
    todayRemaining: number;
    todayCount: number;
  };
  purchases: {
    today: number;
    month: number;
    todayPaid: number;
    todayRemaining: number;
    todayCount: number;
  };
  parties: {
    customers: number;
    suppliers: number;
    receivables: number;
    payables: number;
  };
  inventory: {
    products: number;
    value: number;
    outOfStock: number;
    lowStock: number;
    expired: number;
    expiringSoon: number;
  };
  finance: {
    grossProfitEstimate: number;
  };
};

type ProductFormState = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  description: string;
  imageUrl: string;
  categoryId: string;
  baseUnitId: string;
  defaultWarehouseId: string;
  hasExpiry: boolean;
  minStock: number;
  purchasePrice: number;
  salePrice: number;
  openingQuantity: number;
  openingUnitCost: number;
  openingCurrencyId: string;
  openingExpiryDate: string;
};

type ProductUnitForm = {
  id: string;
  unitId: string;
  conversionRate: number;
  purchasePrice: number;
  salePrice: number;
  isDefaultPurchase: boolean;
  isDefaultSale: boolean;
};

type LookupItem = {
  id: string;
  name: string;
  shortName?: string | null;
  code?: string;
  sku?: string | null;
  barcode?: string | null;
  isBase?: boolean;
  latestRate?: number | null;
  category?: { name?: string | null } | null;
  baseUnit?: { name?: string | null; shortName?: string | null } | null;
};

type InventoryActionForm = {
  type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DAMAGE" | "TRANSFER";
  productId: string;
  warehouseId: string;
  toWarehouseId: string;
  lotId: string;
  unitId: string;
  quantity: number;
  unitCost: number;
  currencyId: string;
  expiryDate: string;
  note: string;
};

type PaymentAccountOption = {
  id: string;
  name: string;
  type: "CASH" | "BANK";
  currencyId: string;
  balance?: number;
};

type PurchaseFormState = {
  invoiceNo: string;
  supplierId: string;
  currencyId: string;
  paymentAccountKey: string;
  discount: number;
  paidAmount: number;
  productId: string;
  warehouseId: string;
  unitId: string;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  note: string;
};

type PurchaseLineForm = {
  id: string;
  productId: string;
  warehouseId: string;
  unitId: string;
  quantity: number;
  unitCost: number;
  updateSalePrice: boolean;
  salePrice: number;
  expiryDate: string;
};

type SaleFormState = {
  invoiceNo: string;
  customerId: string;
  currencyId: string;
  paymentAccountKey: string;
  discount: number;
  paidAmount: number;
  note: string;
};

type SaleLineForm = {
  id: string;
  productId: string;
  warehouseId: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

type InvoiceItemRow = {
  id: string;
  product: string;
  warehouse: string;
  unit: string;
  quantity: number;
  unitAmount: number;
  discount?: number;
  generalDiscount?: number;
  netTotal?: number;
  baseQuantity?: number;
  baseUnit?: string;
  baseUnitAmount?: number;
  salePrice?: number;
  baseSalePrice?: number;
  salePriceUpdate?: boolean;
  expiryDate?: string;
  total: number;
};

type ReturnLineForm = {
  itemId: string;
  quantity: number;
};

type PartyPaymentForm = {
  partyId: string;
  currencyId: string;
  paymentAccountKey: string;
  amount: number;
  note: string;
};

type MoneyTransferForm = {
  fromAccountKey: string;
  toAccountKey: string;
  amount: number;
  note: string;
};

type CashBankAction = "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT" | "TRANSFER";

type TreasuryAccountForm = {
  kind: "CASH" | "BANK";
  name: string;
  code: string;
  location: string;
  bankName: string;
  accountNumber: string;
  currencyId: string;
  openingBalance: number;
  note: string;
};

type IncomeExpenseForm = {
  kind: "INCOME" | "EXPENSE";
  currencyId: string;
  accountKey: string;
  categoryId: string;
  amount: number;
  note: string;
};

type DailyReportRow = {
  id: string;
  name: string;
  saleCount: number;
  totalSales: number;
  paidSales: number;
  remainingSales: number;
  moneyIn: number;
  moneyOut: number;
  cashIn: number;
  bankIn: number;
  netCashFlow: number;
};

type DailyCashierReport = {
  date: string;
  summary: {
    saleCount: number;
    transactionCount: number;
    totalSales: number;
    paidSales: number;
    remainingSales: number;
    moneyIn: number;
    moneyOut: number;
    netCashFlow: number;
  };
  byCashier: DailyReportRow[];
  byDevice: DailyReportRow[];
  recentTransactions: Array<{
    id: string;
    createdAt: string;
    type: string;
    direction: string;
    amount: number;
    account: string;
    user: string;
    device: string;
    note?: string | null;
  }>;
};

const navItems = [
  { to: "/dashboard", label: "داشبورد", icon: Home, group: "اصلی" },
  { to: "/alerts", label: "هشدارها", icon: Bell, group: "اصلی" },
  { to: "/pos", label: "فروش سریع", icon: ShoppingCart, group: "عملیات" },
  { to: "/sales", label: "فروشات", icon: ShoppingBag, group: "عملیات" },
  { to: "/purchases", label: "خریداری", icon: Truck, group: "عملیات" },
  { to: "/inventory", label: "موجودی و گدام", icon: Boxes, group: "عملیات" },
  { to: "/products", label: "اجناس", icon: Package, group: "دیتا" },
  { to: "/settings", label: "دیتای پایه", icon: Settings, group: "دیتا" },
  {
    to: "/currency-history",
    label: "تاریخچه کرنسی",
    icon: Banknote,
    group: "دیتا",
  },
  { to: "/customers", label: "مشتریان", icon: UsersRound, group: "اشخاص" },
  { to: "/suppliers", label: "فروشندگان", icon: Building2, group: "اشخاص" },
  { to: "/employees", label: "کارمندان", icon: UserRound, group: "کارمندان" },
  { to: "/cash-bank", label: "صندوق و بانک", icon: Landmark, group: "مالی" },
  {
    to: "/income-expenses",
    label: "عواید و مصارف",
    icon: WalletCards,
    group: "مالی",
  },
  { to: "/accounting", label: "حسابداری", icon: Calculator, group: "مالی" },
  {
    to: "/account-period-balances",
    label: "دیبیت/کریدیت حساب‌ها",
    icon: BarChart3,
    group: "مالی",
  },
  { to: "/reports", label: "گزارشات", icon: FileBarChart, group: "مالی" },
  { to: "/users", label: "کاربران", icon: ShieldCheck, group: "سیستم" },
  { to: "/backup", label: "بکاپ", icon: DatabaseBackup, group: "سیستم" },
  {
    to: "/system-health",
    label: "سلامت سیستم",
    icon: HeartPulse,
    group: "سیستم",
  },
];

const money = (value: number | string, currencyCode = "AFN") =>
  `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ${currencyCode}`;

function currencyRate(currency?: LookupItem | null) {
  if (!currency || currency.isBase) return 1;
  const rate = Number(currency.latestRate || 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function basePriceInCurrency(value: number, currency?: LookupItem | null) {
  return Number(value || 0) / currencyRate(currency);
}

function convertCurrencyAmount(
  value: number,
  fromCurrency?: LookupItem | null,
  toCurrency?: LookupItem | null,
) {
  return (Number(value || 0) * currencyRate(fromCurrency)) / currencyRate(toCurrency);
}

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark",
  );
  const [auth, setAuth] = useState<AuthState | null>(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const rawUser = localStorage.getItem(AUTH_USER_KEY);

    if (!token || !rawUser) return null;

    try {
      return {
        token,
        user: JSON.parse(rawUser),
      };
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      return null;
    }
  });
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const isDark = theme === "dark";
  const themeClassName = `${isDark ? "dark " : ""}min-h-screen bg-background text-foreground`;

  useEffect(() => {
    installAuthenticatedFetch();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    localStorage.setItem(THEME_KEY, theme);
  }, [isDark, theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);

    if (!token) {
      setIsCheckingAuth(false);
      return;
    }

    fetch(`${API_BASE_URL}/api/auth/me`)
      .then((res) => {
        if (!res.ok) throw new Error("Session expired");
        return res.json();
      })
      .then((json) => {
        if (json?.data?.user) {
          const nextAuth = {
            token,
            user: json.data.user,
          };
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextAuth.user));
          setAuth(nextAuth);
        }
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        setAuth(null);
      })
      .finally(() => setIsCheckingAuth(false));
  }, []);

  if (window.location.pathname === "/attendance-scan") {
    return (
      <div className={themeClassName}>
        <Toaster richColors position="top-center" />
        <Suspense fallback={<PageLoading label="در حال آماده‌سازی حاضری..." />}>
          <AttendanceScanPageRoute />
        </Suspense>
      </div>
    );
  }

  const handleLogin = (nextAuth: AuthState) => {
    localStorage.setItem(AUTH_TOKEN_KEY, nextAuth.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextAuth.user));
    setAuth(nextAuth);
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST" });
    } catch {
      // Local logout still clears the workstation session.
    }

    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setAuth(null);
  };

  if (isCheckingAuth) {
    return (
      <div dir="rtl" className={`${themeClassName} grid place-items-center`}>
        <Card className="w-96 border-border bg-card">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            در حال بررسی ورود...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!auth) {
    return <LoginPage onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (auth.user.mustChangePassword) {
    return (
      <ChangePasswordPage
        user={auth.user}
        onChanged={(user) => {
          const nextAuth = { ...auth, user };
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
          setAuth(nextAuth);
        }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <HashRouter>
      <div dir="rtl" className={themeClassName}>
        <Toaster richColors position="top-center" />
        <AdminShell
          auth={auth.user}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={toggleTheme}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<PageLoading label="در حال محاسبه داشبورد..." />}>
                  <DashboardPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/alerts"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن هشدارها..." />}>
                  <AlertsPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/pos"
              element={
                <PosPage
                  canManageInventory={
                    auth.user.role === "Admin" ||
                    auth.user.permissions.includes("inventory.manage")
                  }
                />
              }
            />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/accounting" element={<AccountingPage apiBaseUrl={API_BASE_URL} />} />
            <Route
              path="/account-period-balances"
              element={
                <Suspense
                  fallback={<PageLoading label="در حال خواندن دیبیت و کریدیت حساب‌ها..." />}
                >
                  <AccountPeriodBalancesPageRoute />
                </Suspense>
              }
            />
            <Route path="/purchases" element={<PurchasesPage />} />
            <Route path="/cash-bank" element={<CashBankPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route
              path="/products/:productId/history"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن سابقه محصول..." />}>
                  <ProductHistoryPageRoute />
                </Suspense>
              }
            />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route
              path="/settings"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن تنظیمات..." />}>
                  <SettingsPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/currency-history"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن تاریخچه کرنسی..." />}>
                  <CurrencyHistoryPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/users"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن کاربران..." />}>
                  <UsersRolesPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/customers"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن مشتریان..." />}>
                  <CustomersPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/employees"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن کارمندان..." />}>
                  <EmployeesPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/suppliers"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن فروشندگان..." />}>
                  <SuppliersPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/reports"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن گزارشات..." />}>
                  <ReportsPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/income-expenses"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن عواید و مصارف..." />}>
                  <IncomeExpensesPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/backup"
              element={
                <Suspense fallback={<PageLoading label="در حال خواندن بکاپ..." />}>
                  <BackupPageRoute />
                </Suspense>
              }
            />
            <Route
              path="/system-health"
              element={
                <Suspense fallback={<PageLoading label="در حال بررسی سلامت سیستم..." />}>
                  <SystemHealthPageRoute />
                </Suspense>
              }
            />
            {pageConfigs
              .filter(
                (config) =>
                  ![
                    "/settings",
                    "/products",
                    "/inventory",
                    "/purchases",
                    "/sales",
                    "/customers",
                    "/suppliers",
                    "/cash-bank",
                    "/income-expenses",
                    "/reports",
                    "/backup",
                    "/users",
                  ].includes(configPath(config.title)),
              )
              .map((config) => (
                <Route
                  key={config.title}
                  path={configPath(config.title)}
                  element={<AdminDataPage config={config} />}
                />
              ))}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AdminShell>
      </div>
    </HashRouter>
  );
}

function ChangePasswordPage({
  user,
  onChanged,
  onLogout,
}: {
  user: AuthUser;
  onChanged: (user: AuthUser) => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("رمز جدید باید حداقل ۸ حرف باشد");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("تکرار رمز جدید یکسان نیست");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "تغییر رمز ناکام شد");
      onChanged(json.data.user);
      toast.success("رمز عبور تغییر کرد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تغییر رمز ناکام شد");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="grid min-h-screen place-items-center bg-background p-4 text-foreground"
    >
      <Toaster richColors position="top-center" />
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle>تغییر رمز عبور اولیه</CardTitle>
          <CardDescription>
            {user.displayName}، پیش از ورود به سیستم یک رمز شخصی تعیین کنید.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <Input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="رمز فعلی"
              autoFocus
            />
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="رمز جدید، حداقل ۸ حرف"
            />
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="تکرار رمز جدید"
            />
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "در حال ذخیره..." : "ذخیره رمز و ادامه"}
            </Button>
            <Button className="w-full" type="button" variant="outline" onClick={onLogout}>
              خروج
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}

function LoginPage({
  onLogin,
  theme,
  onToggleTheme,
}: {
  onLogin: (auth: AuthState) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isServerDialogOpen, setIsServerDialogOpen] = useState(() => !getStoredApiBaseUrl());
  const [serverUrl, setServerUrl] = useState(API_BASE_URL);
  const [isTestingServer, setIsTestingServer] = useState(false);

  const testServer = async () => {
    setIsTestingServer(true);
    try {
      const normalized = await testApiBaseUrl(serverUrl);
      setServerUrl(normalized);
      toast.success("سرور شناسایی شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "اتصال به سرور برقرار نشد");
    } finally {
      setIsTestingServer(false);
    }
  };

  const saveServer = async () => {
    setIsTestingServer(true);
    try {
      const normalized = await testApiBaseUrl(serverUrl);
      saveApiBaseUrl(normalized);
      toast.success("آدرس سرور ذخیره شد");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ذخیره آدرس سرور ناکام شد");
      setIsTestingServer(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ورود ناکام شد");
      }

      onLogin({
        token: json.data.token,
        user: json.data.user,
      });
      toast.success("ورود موفق بود");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ورود ناکام شد");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="grid min-h-screen place-items-center bg-background p-4 text-foreground"
    >
      <Toaster richColors position="top-center" />
      <Button
        type="button"
        variant="outline"
        className="absolute left-4 top-4"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {theme === "dark" ? "لایت" : "دارک"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="absolute right-4 top-4"
        onClick={() => setIsServerDialogOpen(true)}
      >
        <Settings className="size-4" />
        تنظیم سرور
      </Button>
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img src={appAssetPath("/logo.png")} alt="Muhaseb" className="size-8 object-contain" />
            ورود به سیستم Muhaseb
          </CardTitle>
          <CardDescription>برای فروش و مدیریت، با حساب فروشنده یا مدیر وارد شوید.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <label className="form-grid-field grid gap-1.5 text-sm">
              <span className="text-muted-foreground">نام کاربری</span>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">رمز عبور</span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            </label>
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "در حال ورود..." : "ورود"}
            </Button>
          </CardContent>
        </form>
      </Card>
      <Dialog open={isServerDialogOpen} onOpenChange={setIsServerDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>اتصال به سرور فروشگاه</DialogTitle>
            <DialogDescription>
              IP کمپیوتر سرور را یک‌بار وارد کنید. این مقدار روی همین دستگاه ذخیره می‌شود و بعد از
              نصب نیز قابل تغییر است.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">آدرس API سرور</span>
            <Input
              dir="ltr"
              placeholder="http://192.168.1.10:4000"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </label>
          <div className="border border-border bg-background/50 p-3 text-xs text-muted-foreground">
            نمونه:{" "}
            <span dir="ltr" className="font-mono">
              http://192.168.1.10:4000
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={testServer} disabled={isTestingServer}>
              <RefreshCcw className={isTestingServer ? "size-4 animate-spin" : "size-4"} />
              تست اتصال
            </Button>
            <Button type="button" onClick={saveServer} disabled={isTestingServer}>
              ذخیره و ورود
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function configPath(title: string) {
  const map: Record<string, string> = {
    فروشات: "/sales",
    خریداری: "/purchases",
    "موجودی و گدام": "/inventory",
    اجناس: "/products",
    مشتریان: "/customers",
    فروشندگان: "/suppliers",
    کارمندان: "/employees",
    "صندوق و بانک": "/cash-bank",
    "عواید و مصارف": "/income-expenses",
    گزارشات: "/reports",
    کاربران: "/users",
    تنظیمات: "/settings",
    بکاپ: "/backup",
  };

  return map[title] || "/dashboard";
}

function canAccessNav(user: AuthUser, path: string) {
  if (user.role === "Admin") return true;

  const permissions = new Set(user.permissions || []);

  if (path === "/dashboard") return permissions.has("dashboard.view");
  if (path === "/alerts")
    return (
      permissions.has("alerts.view") ||
      permissions.has("dashboard.view") ||
      permissions.has("inventory.view") ||
      permissions.has("reports.view")
    );
  if (path === "/pos") return permissions.has("pos.sell");
  if (path === "/sales") return permissions.has("sales.view");
  if (path === "/purchases") return permissions.has("purchases.view");
  if (path === "/inventory") return permissions.has("inventory.view");
  if (path === "/products") return permissions.has("products.manage");
  if (path === "/customers" || path === "/suppliers") return permissions.has("parties.manage");
  if (path === "/employees")
    return (
      permissions.has("users.manage") ||
      permissions.has("employees.view") ||
      permissions.has("employees.manage") ||
      permissions.has("attendance.view") ||
      permissions.has("attendance.manage") ||
      permissions.has("payroll.view") ||
      permissions.has("payroll.manage")
    );
  if (path === "/cash-bank" || path === "/income-expenses")
    return permissions.has("cashbank.manage");
  if (path === "/accounting") return permissions.has("accounting.view");
  if (path === "/account-period-balances")
    return permissions.has("accounting.view") || permissions.has("reports.view");
  if (path === "/reports") return permissions.has("reports.view");
  if (path === "/users") return permissions.has("users.manage");
  if (path === "/settings" || path === "/currency-history")
    return permissions.has("settings.manage");
  if (path === "/backup") return permissions.has("backup.manage");
  if (path === "/system-health") return permissions.has("backup.manage");

  return false;
}

function PageLoading({ label }: { label: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{label}</CardContent>
    </Card>
  );
}

function ShellHeader({
  auth,
  currentLabel,
  today,
  alertCount,
  theme,
  onToggleTheme,
  onLogout,
  isDesktop,
}: {
  auth: AuthUser;
  currentLabel: string;
  today: string;
  alertCount: number;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => void;
  isDesktop: boolean;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const windowControls =
    typeof window !== "undefined" ? window.desktopApp?.windowControls : undefined;

  useEffect(() => {
    if (!isDesktop) return;

    let mounted = true;

    const maximizedPromise =
      windowControls?.isMaximized() || window.electronAPI?.isWindowMaximized?.();
    const fullScreenPromise =
      windowControls?.isFullScreen() || window.electronAPI?.isWindowFullScreen?.();

    maximizedPromise?.then((value) => {
      if (mounted) setIsMaximized(Boolean(value));
    });
    fullScreenPromise?.then((value) => {
      if (mounted) setIsFullScreen(Boolean(value));
    });

    return () => {
      mounted = false;
    };
  }, [isDesktop, windowControls]);

  const runWindowAction = async <T,>(
    action: (() => Promise<T>) | undefined,
    onDone?: (value: T) => void,
  ) => {
    if (!action) {
      toast.error("کنترل پنجره فعال نیست؛ برنامه را کامل بسته و دوباره باز کنید");
      return;
    }

    const value = await action();
    onDone?.(value);
  };

  return (
    <header
      className={[
        "app-shell-header flex items-center border-border bg-card/95 shadow-sm backdrop-blur",
        isDesktop
          ? "desktop-titlebar sticky top-4 z-40 mb-4 min-h-[68px] rounded-xl border"
          : "sticky top-4 z-40 mb-4 min-h-[58px] rounded-xl border",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-full w-full min-w-0 items-center gap-5 flex-row px-4  justify-end",
          isDesktop ? "pl-[210px]" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-3">
          <NavLink to="/alerts" className="relative" title="هشدارهای سیستم">
            <div className="grid size-9 place-items-center rounded-xl border border-border bg-secondary">
              <Bell className="size-5 text-primary" />
            </div>
            {alertCount > 0 && (
              <span className="absolute -top-1 inset-e-0 grid h-3 min-w-3 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </NavLink>
          <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
            <UserRound className="size-5" />
          </div>
          <div>
            <CardTitle className="text-sm">{auth.displayName}</CardTitle>
            <CardDescription className="text-xs">{auth.role || "بدون رول"}</CardDescription>
          </div>
        </div>

        <div className="flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          <span>{today}</span>
        </div>

        <div className="me-auto flex items-center justify-end gap-3">
          <div className="text-end">
            <CardTitle className="text-sm">{currentLabel}</CardTitle>
            <CardDescription className="text-xs">Muhaseb / LAN Ready</CardDescription>
          </div>
          <Badge className="rounded-xl border-primary/30 bg-primary/10 px-3 py-2 text-primary">
            Offline
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleTheme}
            data-no-drag={isDesktop ? "true" : undefined}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onLogout}
            data-no-drag={isDesktop ? "true" : undefined}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>

      {isDesktop && (
        <div
          className="absolute left-3 top-1/2 z-[80] flex -translate-y-1/2 items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-sm"
          data-no-drag="true"
        >
          <WindowButton
            title="کوچک کردن"
            onClick={() =>
              void runWindowAction(
                windowControls?.minimize ||
                  window.electronAPI?.minimizeWindow?.bind(window.electronAPI),
              )
            }
          >
            <Minimize2 className="size-4" />
          </WindowButton>
          <WindowButton
            title={isMaximized ? "برگرداندن" : "بزرگ کردن"}
            onClick={async () => {
              await runWindowAction(
                windowControls?.toggleMaximize ||
                  window.electronAPI?.toggleMaximizeWindow?.bind(window.electronAPI),
                (value) => {
                  if (typeof value === "boolean") setIsMaximized(value);
                },
              );
            }}
          >
            {isMaximized ? <Square className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </WindowButton>
          <WindowButton
            title={isFullScreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه کردن"}
            onClick={async () => {
              await runWindowAction(
                windowControls?.toggleFullScreen ||
                  window.electronAPI?.toggleFullScreenWindow?.bind(window.electronAPI),
                (value) => {
                  if (typeof value === "boolean") setIsFullScreen(value);
                },
              );
            }}
          >
            {isFullScreen ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
          </WindowButton>
          <WindowButton
            title="بستن"
            danger
            onClick={() =>
              void runWindowAction(
                windowControls?.close || window.electronAPI?.closeWindow?.bind(window.electronAPI),
              )
            }
          >
            <X className="size-4" />
          </WindowButton>
        </div>
      )}
    </header>
  );
}

function WindowButton({
  children,
  title,
  danger = false,
  onClick,
}: {
  children: ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-no-drag="true"
      onClick={onClick}
      className={[
        "grid size-9 place-items-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
        danger
          ? "hover:border-destructive/30 hover:bg-destructive hover:text-destructive-foreground"
          : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function AdminShell({
  children,
  auth,
  onLogout,
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  auth: AuthUser;
  onLogout: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => canAccessNav(auth, item.to)),
    [auth],
  );
  const navGroups = useMemo(
    () =>
      ["اصلی", "عملیات", "دیتا", "اشخاص", "کارمندان", "مالی", "سیستم"]
        .map((group) => ({
          group,
          items: visibleNavItems.filter((item) => item.group === group),
        }))
        .filter((group) => group.items.length > 0),
    [visibleNavItems],
  );
  const current = visibleNavItems.find((item) => location.pathname.startsWith(item.to));
  const isDesktop =
    typeof window !== "undefined" &&
    (Boolean(window.electronAPI) || Boolean(window.desktopApp?.windowControls));
  const today = new Intl.DateTimeFormat("fa-AF", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  useEffect(() => {
    if (!canAccessNav(auth, "/alerts")) return;

    let ignore = false;

    const loadAlertCount = () => {
      const requests = [
        fetch(`${API_BASE_URL}/api/alerts?days=30`)
          .then((res) => res.json())
          .catch(() => null),
      ];
      if (canAccessNav(auth, "/system-health")) {
        requests.push(
          fetch(`${API_BASE_URL}/api/system-health`)
            .then((res) => res.json())
            .catch(() => null),
        );
      }

      void Promise.all(requests).then(([alertsJson, healthJson]) => {
        if (!ignore) {
          setAlertCount(
            Number(alertsJson?.data?.counts?.total || 0) +
              Number(healthJson?.data?.counts?.total || 0),
          );
        }
      });
    };

    loadAlertCount();
    const timer = window.setInterval(loadAlertCount, 60_000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [auth, location.pathname]);

  return (
    <div>
      <main className="grid min-h-screen grid-cols-[288px_1fr] gap-4 bg-background p-4 max-lg:grid-cols-1">
        <Sidebar className="sticky top-4 h-[calc(100vh-2rem)] max-lg:relative max-lg:top-0 max-lg:h-auto">
          <SidebarHeader>
            <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent p-4">
              <div className="flex size-12 items-center justify-center rounded-xl border border-primary/25 bg-background">
                <img
                  src={appAssetPath("/logo.png")}
                  alt="Muhaseb"
                  className="size-10 object-contain"
                />
              </div>
              <div>
                <h1 className="text-lg font-bold">Muhaseb</h1>
                <p className="text-xs text-muted-foreground">سیستم مدیریت سوپرمارکیت</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarMenu>
              {navGroups.map((group) => (
                <div key={group.group} className="space-y-1">
                  <p className="px-3 pt-3 text-[11px] font-medium text-sidebar-foreground/55">
                    {group.group}
                  </p>
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to} className="contents">
                      {({ isActive }) => (
                        <SidebarMenuButton isActive={isActive}>
                          <item.icon className="size-5" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                  ))}
                </div>
              ))}
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>

        <section className="min-w-0">
          <ShellHeader
            auth={auth}
            currentLabel={current?.label || "داشبورد"}
            today={today}
            alertCount={alertCount}
            theme={theme}
            onToggleTheme={onToggleTheme}
            onLogout={onLogout}
            isDesktop={isDesktop}
          />
          {children}
        </section>
      </main>
    </div>
  );
}

function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    let ignore = false;

    fetch(`${API_BASE_URL}/api/dashboard/summary`)
      .then((res) => res.json())
      .then((json) => {
        if (!ignore && json?.data) {
          setSummary(json.data);
        }
      })
      .catch(() => {
        if (!ignore) {
          toast.warning("داشبورد با داده نمونه نمایش داده شد؛ API در دسترس نیست");
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const alerts = [
    [
      "کمبود موجودی",
      `${new Intl.NumberFormat("en-US").format(summary?.inventory.lowStock ?? 23)} قلم به حداقل رسیده‌اند`,
      "destructive",
    ],
    [
      "نزدیک تاریخ انقضا",
      `${new Intl.NumberFormat("en-US").format(summary?.inventory.expiringSoon ?? 18)} قلم در ۳۰ روز آینده منقضی می‌شوند`,
      "warning",
    ],
    ["پرداخت‌های معلق", "۱۲ فاکتور در انتظار تسویه", "warning"],
    [
      "اقلام تاریخ‌گذشته",
      `${new Intl.NumberFormat("en-US").format(summary?.inventory.expired ?? 7)} lot نیاز به بررسی دارد`,
      "destructive",
    ],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="فروش امروز"
          value={money(summary?.sales.today ?? 4285750)}
          icon={<ShoppingBag />}
          trend={`${summary?.sales.todayCount ?? 0} فاکتور`}
        />
        <MetricCard
          title="خرید امروز"
          value={money(summary?.purchases.today ?? 2180320)}
          icon={<Truck />}
          trend={`${summary?.purchases.todayCount ?? 0} فاکتور`}
        />
        <MetricCard
          title="سود تخمینی ماه"
          value={money(summary?.finance.grossProfitEstimate ?? 2100430)}
          icon={<CreditCard />}
          trend="فروش - خرید"
        />
        <MetricCard
          title="طلب مشتریان"
          value={money(summary?.parties.receivables ?? 1270650)}
          icon={<UserRound />}
          trend={`${summary?.parties.customers ?? 0} مشتری`}
        />
        <MetricCard
          title="بدهی فروشندگان"
          value={money(summary?.parties.payables ?? 985400)}
          icon={<Banknote />}
          trend={`${summary?.parties.suppliers ?? 0} فروشنده`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>نمودار فروشات</CardTitle>
            <CardDescription>نمای ماهانه بر اساس رفرنس پروپوزل</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-72 items-end gap-3 border-b border-border pb-4">
              {[45, 58, 50, 64, 78, 70, 82].map((height, index) => (
                <div key={index} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-lg bg-primary"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {["قوس", "جدی", "دلو", "حوت", "حمل", "ثور", "جوزا"][index]}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>فروش بر اساس دسته‌بندی</CardTitle>
            <CardDescription>مواد خوراکه، نوشیدنی‌ها و سایر بخش‌ها</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["مواد خوراکه", 40],
              ["نوشیدنی‌ها", 20],
              ["مواد شوینده", 15],
              ["لبنیات", 10],
              ["متفرقه", 15],
            ].map(([label, value]) => (
              <div key={label} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span>{value}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>هشدارها و اطلاعیه‌ها</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map(([title, description, tone]) => (
              <div
                key={title}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3"
              >
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Badge
                  className={
                    tone === "destructive"
                      ? "bg-red-500/15 text-red-300"
                      : "bg-amber-500/15 text-amber-300"
                  }
                >
                  بررسی
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>فعالیت کاربران</CardTitle>
          </CardHeader>
          <CardContent>
            <DenseTable
              columns={[
                { key: "time", label: "زمان" },
                { key: "user", label: "کاربر" },
                { key: "activity", label: "فعالیت" },
                { key: "amount", label: "مبلغ" },
              ]}
              rows={[
                {
                  time: "امروز ۱۱:۴۵",
                  user: "احمد",
                  activity: "ثبت فروش",
                  amount: money(35000),
                },
                {
                  time: "امروز ۱۰:۳۰",
                  user: "سارا",
                  activity: "تایید خرید",
                  amount: money(42000),
                },
                {
                  time: "دیروز ۱۴:۴۰",
                  user: "فرید",
                  activity: "ورود موجودی",
                  amount: money(0),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AdminDataPage({ config }: { config: AdminPageConfig }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DataRow[]>(config.rows);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsRow, setDetailsRow] = useState<DataRow | null>(null);
  const [editingRow, setEditingRow] = useState<DataRow | null>(null);
  const [form, setForm] = useState<DataRow>({});

  useEffect(() => {
    let ignore = false;

    if (!config.endpoint) {
      setRows(config.rows);
      return;
    }

    fetch(`${API_BASE_URL}${config.endpoint}`)
      .then((res) => res.json())
      .then((json) => {
        if (!ignore && Array.isArray(json?.data)) {
          setRows(json.data.map((item: unknown) => normalizeRow(item, config.title)));
        }
      })
      .catch(() => {
        if (!ignore) {
          setRows(config.rows);
          toast.warning(`${config.title}: API در دسترس نیست، داده نمونه نمایش داده شد`);
        }
      });

    return () => {
      ignore = true;
    };
  }, [config]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [query, rows]);

  const openCreate = () => {
    setEditingRow(null);
    setForm({});
    setDialogOpen(true);
  };

  const openEdit = (row: DataRow) => {
    setEditingRow(row);
    setForm(row);
    setDialogOpen(true);
  };

  const saveRow = async () => {
    const payload = {
      ...form,
      ...(config.createType ? { type: config.createType } : {}),
    };

    try {
      if (config.endpoint && (config.createType || config.apiCrud)) {
        const baseEndpoint = config.createType ? "/api/parties" : config.endpoint;
        const target = editingRow?.id
          ? `${API_BASE_URL}${baseEndpoint}/${editingRow.id}`
          : `${API_BASE_URL}${baseEndpoint}`;
        const res = await fetch(target, {
          method: editingRow?.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);

        if (!res.ok) throw new Error(json?.message || "ثبت معلومات ناکام شد");

        const saved = normalizeRow(json.data, config.title);
        setRows((current) =>
          editingRow?.id
            ? current.map((row) => (row.id === editingRow.id ? saved : row))
            : [saved, ...current],
        );
      } else {
        const localRow = {
          id: editingRow?.id || createClientId(),
          ...payload,
          status: payload.status || "فعال",
        };
        setRows((current) =>
          editingRow?.id
            ? current.map((row) => (row.id === editingRow.id ? localRow : row))
            : [localRow, ...current],
        );
      }

      toast.success(editingRow ? "معلومات ویرایش شد" : "رکورد جدید ثبت شد");
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "عملیات ناکام شد");
    }
  };

  const removeRow = async (row: DataRow) => {
    try {
      if (config.endpoint && (config.createType || config.apiCrud) && row.id) {
        const baseEndpoint = config.createType ? "/api/parties" : config.endpoint;
        const res = await fetch(`${API_BASE_URL}${baseEndpoint}/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("حذف/غیرفعال‌سازی ناکام شد");
      }

      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.info("رکورد از لیست حذف شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "عملیات حذف ناکام شد");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {config.stats.map((stat) => (
          <MetricCard key={stat.label} {...stat} />
        ))}
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              {config.icon}
              {config.title}
            </CardTitle>
            <CardDescription>{config.description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجو در جدول..."
                className="w-72 ps-9"
              />
            </div>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              ثبت جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DenseTable
            columns={config.columns}
            rows={filteredRows}
            onDetails={setDetailsRow}
            onEdit={config.canEdit === false ? undefined : openEdit}
            onDelete={config.canDelete === false ? undefined : removeRow}
          />
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="text-sm text-muted-foreground">{config.note}</p>
          <Button
            variant="outline"
            onClick={() => toast.info("این workflow در فاز بعدی به API وصل می‌شود")}
          >
            <ArchiveRestore className="size-4" />
            اکشن‌های تکمیلی
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">گزارش ضایعات</CardTitle>
            <CardDescription>آخرین اجناس ضایع‌شده با گدام، lot و کاربر ثبت‌کننده.</CardDescription>
          </CardHeader>
          <CardContent>
            <DenseTable
              columns={[
                { key: "date", label: "تاریخ" },
                { key: "product", label: "جنس" },
                { key: "warehouse", label: "گدام" },
                { key: "lot", label: "Lot" },
                { key: "quantity", label: "مقدار" },
                { key: "user", label: "کاربر" },
              ]}
              rows={damageRows}
            />
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">گزارش انتقالات گدام</CardTitle>
            <CardDescription>حرکت‌های خروج و ورود انتقالی بین گدام‌ها.</CardDescription>
          </CardHeader>
          <CardContent>
            <DenseTable
              columns={[
                { key: "date", label: "تاریخ" },
                { key: "type", label: "نوع" },
                { key: "product", label: "جنس" },
                { key: "warehouse", label: "گدام" },
                { key: "quantity", label: "مقدار" },
                { key: "note", label: "مرجع" },
              ]}
              rows={transferRows}
            />
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRow ? "ویرایش معلومات" : "ثبت معلومات جدید"}</DialogTitle>
            <DialogDescription>
              معلومات مهم این بخش را وارد کنید. پیام نتیجه با toast نمایش داده می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            {config.fields.map((field) => (
              <label key={field.key} className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">{field.label}</span>
                {field.type === "checkbox" ? (
                  <button
                    type="button"
                    className="flex h-9 items-center justify-between rounded-lg border border-border bg-background px-3 text-start"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        [field.key]: !Boolean(current[field.key]),
                      }))
                    }
                  >
                    <span>{Boolean(form[field.key]) ? "بلی" : "نخیر"}</span>
                    <Badge
                      className={
                        Boolean(form[field.key])
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {Boolean(form[field.key]) ? "فعال" : "غیرفعال"}
                    </Badge>
                  </button>
                ) : /note|description/i.test(field.key) || /یادداشت|شرح|توضیح/.test(field.label) ? (
                  <textarea
                    value={String(form[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    rows={4}
                    className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  />
                ) : (
                  <Input
                    type={field.type || "text"}
                    value={String(form[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [field.key]:
                          field.type === "number"
                            ? Number(event.target.value || 0)
                            : event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={saveRow}>ذخیره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecordDetailsDialog
        open={Boolean(detailsRow)}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null);
        }}
        title={`${config.title} / جزئیات`}
        record={detailsRow}
      />
    </div>
  );
}

function DenseTable({
  columns,
  rows,
  onDetails,
  onEdit,
  onSecondary,
  onDelete,
  extraActions,
  editLabel = "ویرایش",
  secondaryLabel = "عملیات",
  deleteLabel = "حذف / ابطال",
  deleteTitle = "تایید حذف / ابطال",
  deleteDescription = "آیا مطمئن هستید که این مورد حذف یا ابطال شود؟",
  pagination,
  onPageChange,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: DataRow[];
  onDetails?: (row: DataRow) => void;
  onEdit?: (row: DataRow) => void;
  onSecondary?: (row: DataRow) => void;
  onDelete?: (row: DataRow) => void;
  extraActions?: Array<{
    label: string;
    onClick: (row: DataRow) => void;
    icon?: ReactNode;
    isVisible?: (row: DataRow) => boolean;
  }>;
  editLabel?: string;
  secondaryLabel?: string;
  deleteLabel?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const [internalDetailsRow, setInternalDetailsRow] = useState<DataRow | null>(null);
  const isServerPaginated = Boolean(pagination && onPageChange);
  const totalPages = isServerPaginated
    ? pagination!.totalPages
    : Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const activePage = isServerPaginated ? pagination!.page : safePage;
  const activeLimit = isServerPaginated ? pagination!.limit : pageSize;
  const totalRows = isServerPaginated ? pagination!.total : rows.length;
  const pageRows = isServerPaginated
    ? rows
    : rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasAuditMeta = false;
  const hasActions = true;
  const canEditRow = (row: DataRow) => row.__canEdit !== false;
  const canSecondaryRow = (row: DataRow) => row.__canSecondary !== false;
  const canDeleteRow = (row: DataRow) => row.__canDelete !== false;

  const badgeClassFor = (value: unknown) => {
    const text = String(value || "").toLowerCase();
    if (
      text.includes("ابطال") ||
      text.includes("cancel") ||
      text.includes("مصرف") ||
      text.includes("expense") ||
      text.includes("غیرفعال") ||
      text.includes("ناموجود") ||
      text.includes("خطا") ||
      text.includes("overdue")
    ) {
      return "bg-red-500/15 text-red-600 dark:text-red-400";
    }
    if (
      text.includes("عواید") ||
      text.includes("income") ||
      text.includes("فعال") ||
      text.includes("paid") ||
      text.includes("تکمیل") ||
      text.includes("موفق")
    ) {
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    }
    if (
      text.includes("pending") ||
      text.includes("معلق") ||
      text.includes("نیم") ||
      text.includes("هشدار") ||
      text.includes("کم")
    ) {
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    }
    if (text.includes("draft") || text.includes("پیشنویس")) {
      return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
    }
    return "bg-primary/15 text-primary";
  };

  useEffect(() => {
    setPage(1);
  }, [rows]);

  return (
    <div className="space-y-3">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead key={column.key}>{column.label}</TableHead>
            ))}
            {hasAuditMeta && <TableHead>ثبت / ویرایش</TableHead>}
            {hasActions && <TableHead className="w-16 text-center">عملیات</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (hasAuditMeta ? 1 : 0) + (hasActions ? 1 : 0)}
                className="py-8 text-center text-muted-foreground"
              >
                موردی برای نمایش وجود ندارد
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row, index) => (
              <TableRow key={String(row.id || index)} className="border-border">
                {columns.map((column) => (
                  <TableCell key={column.key}>
                    {column.key === "imageUrl" ? (
                      row[column.key] ? (
                        <img
                          src={attachmentUrl(String(row[column.key]))}
                          alt={String(row.name || "محصول")}
                          className="size-12 border border-border object-cover"
                        />
                      ) : (
                        <div className="grid size-12 place-items-center border border-border bg-muted text-muted-foreground">
                          <Package className="size-5" />
                        </div>
                      )
                    ) : column.key === "status" ||
                      column.key === "type" ||
                      column.key === "cogsStatus" ? (
                      <Badge className={badgeClassFor(row[column.key])}>
                        {String(row[column.key] ?? "فعال")}
                      </Badge>
                    ) : typeof row[column.key] === "boolean" ? (
                      row[column.key] ? (
                        "بلی"
                      ) : (
                        "نخیر"
                      )
                    ) : (
                      String(row[column.key] ?? "-")
                    )}
                  </TableCell>
                ))}
                {hasAuditMeta && (
                  <TableCell className="min-w-48 text-xs text-muted-foreground">
                    <div>ثبت: {String(row.createdBy || "-")}</div>
                    <div>{formatDateTime(row.createdAt)}</div>
                    <div className="mt-1">ویرایش: {String(row.updatedBy || "-")}</div>
                    <div>{formatDateTime(row.updatedAt)}</div>
                  </TableCell>
                )}
                {hasActions && (
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="outline" title="عملیات" aria-label="عملیات">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={6} className="w-44" dir="rtl">
                        <DropdownMenuLabel>عملیات</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => (onDetails ? onDetails(row) : setInternalDetailsRow(row))}
                        >
                          <Eye className="size-4" />
                          <span>جزئیات</span>
                        </DropdownMenuItem>
                        {onEdit && canEditRow(row) && (
                          <DropdownMenuItem onClick={() => onEdit(row)}>
                            <Settings className="size-4" />
                            <span>{editLabel}</span>
                          </DropdownMenuItem>
                        )}
                        {onSecondary && canSecondaryRow(row) && (
                          <DropdownMenuItem onClick={() => onSecondary(row)}>
                            <RefreshCcw className="size-4" />
                            <span>{secondaryLabel}</span>
                          </DropdownMenuItem>
                        )}
                        {extraActions
                          ?.filter((action) => action.isVisible?.(row) ?? true)
                          .map((action) => (
                            <DropdownMenuItem
                              key={action.label}
                              onClick={() => action.onClick(row)}
                            >
                              {action.icon || <FileText className="size-4" />}
                              <span>{action.label}</span>
                            </DropdownMenuItem>
                          ))}
                        {onDelete && canDeleteRow(row) && (
                          <ConfirmDropdownItem
                            title={deleteTitle}
                            description={deleteDescription}
                            confirmLabel="تایید"
                            onConfirm={() => onDelete(row)}
                          >
                            <Trash2 className="size-4" />
                            <span>{deleteLabel}</span>
                          </ConfirmDropdownItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          نمایش {totalRows === 0 ? 0 : (activePage - 1) * activeLimit + 1} تا{" "}
          {Math.min(activePage * activeLimit, totalRows)} از {totalRows}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={activePage <= 1}
            onClick={() =>
              isServerPaginated
                ? onPageChange!(activePage - 1)
                : setPage((current) => Math.max(1, current - 1))
            }
          >
            قبلی
          </Button>
          <span>
            صفحه {activePage} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={activePage >= totalPages}
            onClick={() =>
              isServerPaginated
                ? onPageChange!(activePage + 1)
                : setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            بعدی
          </Button>
        </div>
      </div>

      <RecordDetailsDialog
        open={Boolean(internalDetailsRow)}
        onOpenChange={(open) => {
          if (!open) setInternalDetailsRow(null);
        }}
        title="جزئیات رکورد"
        record={internalDetailsRow}
      />
    </div>
  );
}

function detailValue(value: any): string {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === "boolean") return value ? "بلی" : "نخیر";
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  if (typeof value === "string") {
    const parsedDate = Date.parse(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(parsedDate)) {
      return formatDateTime(value);
    }
    return value;
  }
  if (Array.isArray(value)) return `${value.length} مورد`;
  if (typeof value === "object") {
    return value.name || value.displayName || value.username || value.code || value.id || "-";
  }
  return String(value);
}

const detailLabelMap: Record<string, string> = {
  invoiceNo: "شماره فاکتور",
  code: "کد",
  name: "نام",
  displayName: "نام نمایشی",
  username: "نام کاربری",
  phone: "شماره تماس",
  secondaryPhone: "شماره دوم",
  email: "ایمیل",
  address: "آدرس",
  note: "یادداشت",
  status: "وضعیت",
  paymentStatus: "وضعیت پرداخت",
  type: "نوع",
  direction: "جهت",
  amount: "مبلغ",
  total: "مجموع",
  subtotal: "جمع جزئی",
  discount: "تخفیف",
  paidAmount: "مبلغ پرداخت/دریافت",
  remainingAmount: "باقیات",
  balanceAfter: "مانده بعد",
  exchangeRate: "نرخ تبدیل به کرنسی پایه",
  baseSubtotal: "جمع جزئی به کرنسی پایه",
  baseTotal: "مجموع به کرنسی پایه",
  basePaidAmount: "پرداخت/دریافت به کرنسی پایه",
  baseRemainingAmount: "باقیات به کرنسی پایه",
  baseAmount: "مبلغ به کرنسی پایه",
  baseBalanceAfter: "مانده بعد به کرنسی پایه",
  baseDebit: "دیبیت به کرنسی پایه",
  baseCredit: "کریدیت به کرنسی پایه",
  quantity: "مقدار",
  unitCost: "قیمت تمام‌شده",
  unitPrice: "قیمت واحد",
  expiryDate: "تاریخ انقضا",
  createdAt: "زمان ثبت",
  updatedAt: "زمان ویرایش",
  deletedAt: "زمان حذف",
  product: "محصول",
  productName: "محصول",
  warehouse: "گدام",
  warehouseName: "گدام",
  fromWarehouse: "گدام مبدا",
  toWarehouse: "گدام مقصد",
  lot: "لات/انقضا",
  unit: "واحد",
  baseUnit: "واحد پایه",
  currency: "کرنسی",
  category: "کتگوری",
  supplier: "فروشنده",
  customer: "مشتری",
  party: "طرف حساب",
  cashRegister: "صندوق",
  cashRegisterAccount: "حساب صندوق",
  bankAccount: "حساب بانکی",
  user: "کاربر",
  cashier: "فروشنده/کاربر",
  posDevice: "دستگاه",
  referenceType: "نوع مرجع",
  sourceType: "نوع منبع",
  cancellationReason: "دلیل ابطال",
  cancelReason: "دلیل ابطال",
  reason: "دلیل",
  metadata: "جزئیات سیستمی",
};

function detailLabel(key: string) {
  return (
    detailLabelMap[key] ||
    key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase())
  );
}

function shouldHideDetailKey(key: string) {
  return (
    key === "id" ||
    key === "__raw" ||
    key === "passwordHash" ||
    key.endsWith("Id") ||
    key.endsWith("Ids")
  );
}

function extractCancellationReason(record: any): string {
  if (!record || typeof record !== "object") return "";

  const raw = record.__raw && typeof record.__raw === "object" ? record.__raw : record;
  const candidates = [
    record.cancellationReason,
    record.cancelReason,
    record.cancellationNote,
    record.metadata?.reason,
    record.metadata?.cancelReason,
    raw.cancellationReason,
    raw.cancelReason,
    raw.cancellationNote,
    raw.metadata?.reason,
    raw.metadata?.cancelReason,
  ];
  const direct = candidates.find((value) => typeof value === "string" && value.trim().length > 0);

  if (direct) return String(direct).trim();

  const note = String(raw.note || record.note || "");
  const cancelledMatch = note.match(/Cancelled:\s*(.+)$/i);
  if (cancelledMatch?.[1]) return cancelledMatch[1].trim();

  const localMatch = note.match(/(?:ابطال|لغو)[:：]\s*(.+)$/);
  if (localMatch?.[1]) return localMatch[1].trim();

  return "";
}

function detailRelationValue(key: string, value: any): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return detailValue(value);
  }

  if (key === "lot") {
    return value.expiryDate
      ? formatDateTime(value.expiryDate)
      : value.note || value.sourceType || "-";
  }

  if (key === "currency") {
    return value.code || value.name || value.symbol || "-";
  }

  if (key === "unit" || key === "baseUnit") {
    return value.shortName || value.name || "-";
  }

  if (key === "cashRegisterAccount") {
    return (
      [value.cashRegister?.name, value.currency?.code].filter(Boolean).join(" / ") ||
      detailValue(value)
    );
  }

  return value.name || value.displayName || value.username || value.code || value.invoiceNo || "-";
}

function RecordDetailsDialog({
  open,
  onOpenChange,
  title,
  record,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  record: DataRow | null;
}) {
  const raw = (record?.__raw && typeof record.__raw === "object" ? record.__raw : record) || {};
  const auditRows = [
    [
      "ثبت کننده",
      raw.createdByUser?.displayName || raw.createdByUser?.username || record?.createdBy,
    ],
    ["زمان ثبت", raw.createdAt || record?.createdAt],
    [
      "ویرایش کننده",
      raw.updatedByUser?.displayName || raw.updatedByUser?.username || record?.updatedBy,
    ],
    ["زمان ویرایش", raw.updatedAt || record?.updatedAt],
    [
      "حذف کننده",
      raw.deletedByUser?.displayName || raw.deletedByUser?.username || record?.deletedBy,
    ],
    ["زمان حذف", raw.deletedAt || record?.deletedAt],
  ].filter(([, value]) => value);
  const entries = Object.entries(raw).filter(([key, value]) => {
    if (shouldHideDetailKey(key)) return false;
    if (["createdByUser", "updatedByUser", "deletedByUser"].includes(key)) {
      return false;
    }
    if (Array.isArray(value)) return false;
    return true;
  });
  const itemRows = Array.isArray(raw.items) ? raw.items : [];
  const cancellationReason = extractCancellationReason(record || raw);
  const attachmentEntityType = attachmentTypeFor(title, raw);
  const attachmentEntityId =
    typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-[min(96vw,1120px)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            جزئیات کامل رکورد، اقلام و معلومات ثبت/ویرایش در همین مودال نمایش داده می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto pe-1">
          {cancellationReason ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              <p className="text-xs">دلیل ابطال</p>
              <strong className="mt-1 block text-sm">{cancellationReason}</strong>
            </div>
          ) : null}

          {auditRows.length > 0 && (
            <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 md:grid-cols-2 xl:grid-cols-3">
              {auditRows.map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <strong className="text-sm">{detailValue(value)}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs text-muted-foreground">{detailLabel(key)}</p>
                <div className="mt-1 break-words text-sm">{detailRelationValue(key, value)}</div>
              </div>
            ))}
          </div>

          {itemRows.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <strong className="mb-3 block text-sm">اقلام سند</strong>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                    <TableHead>جنس</TableHead>
                    <TableHead>گدام</TableHead>
                    <TableHead>واحد</TableHead>
                    <TableHead>مقدار</TableHead>
                    <TableHead>قیمت</TableHead>
                    <TableHead>تخفیف/انقضا</TableHead>
                    <TableHead>جمع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemRows.map((item: any, index: number) => (
                    <TableRow key={item.id || index} className="border-border">
                      <TableCell>{item.product?.name || item.productName || "-"}</TableCell>
                      <TableCell>{item.warehouse?.name || item.warehouseName || "-"}</TableCell>
                      <TableCell>{item.unit?.shortName || item.unit?.name || "-"}</TableCell>
                      <TableCell>{detailValue(item.quantity)}</TableCell>
                      <TableCell>{money(item.unitPrice || item.unitCost || 0)}</TableCell>
                      <TableCell>
                        {item.expiryDate
                          ? formatDateTime(item.expiryDate)
                          : money(item.discount || 0)}
                      </TableCell>
                      <TableCell>{money(item.totalPrice || item.totalCost || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {attachmentEntityId && (
            <TransactionAttachments
              entityType={attachmentEntityType}
              entityId={attachmentEntityId}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function attachmentTypeFor(title: string, raw: Record<string, any>) {
  const text = `${title} ${raw.referenceType || ""} ${raw.type || ""}`.toLowerCase();

  if (text.includes("برگشت فروش")) return "SALE_RETURN";
  if (text.includes("برگشت خرید")) return "PURCHASE_RETURN";
  if (text.includes("فروش") || raw.saleDate) return "SALE";
  if (text.includes("خرید") || raw.purchaseDate) return "PURCHASE";
  if (text.includes("عواید") || text.includes("مصارف")) return "INCOME_EXPENSE";
  if (text.includes("صندوق") || text.includes("بانک") || text.includes("transfer"))
    return "MONEY_TRANSACTION";
  if (text.includes("موجودی") || text.includes("گدام") || raw.movementType)
    return "INVENTORY_MOVEMENT";
  if (text.includes("معاش") || raw.employeeId) return "PAYROLL";
  return "TRANSACTION";
}

function formatFileSize(bytes: number) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE_URL}${url}`;
}

function TransactionAttachments({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const [items, setItems] = useState<DocumentAttachment[]>([]);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function loadAttachments() {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ entityType, entityId });
      const response = await fetch(`${API_BASE_URL}/api/attachments?${params}`);
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "خواندن ضمیمه‌ها ناکام شد");
      }
      setItems(json?.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن ضمیمه‌ها ناکام شد");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAttachments();
  }, [entityType, entityId]);

  async function uploadAttachment(file?: File | null) {
    if (!file) return;

    const form = new FormData();
    form.append("entityType", entityType);
    form.append("entityId", entityId);
    form.append("note", note);
    form.append("file", file);

    setIsUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/attachments`, {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "آپلود سند ناکام شد");
      }
      toast.success("سند ضمیمه شد");
      setNote("");
      await loadAttachments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "آپلود سند ناکام شد");
    } finally {
      setIsUploading(false);
    }
  }

  async function deleteAttachment(item: DocumentAttachment) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/attachments/${item.id}`, {
        method: "DELETE",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "حذف ضمیمه ناکام شد");
      }
      toast.success("ضمیمه حذف شد");
      await loadAttachments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف ضمیمه ناکام شد");
    }
  }

  async function openAttachment(item: DocumentAttachment) {
    const popup = window.open("about:blank", "_blank");
    try {
      const response = await fetch(`${API_BASE_URL}/api/attachments/${item.id}/download`);
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message || "بازکردن سند ناکام شد");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      if (popup) popup.location.href = objectUrl;
      else window.open(objectUrl, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      popup?.close();
      toast.error(error instanceof Error ? error.message : "بازکردن سند ناکام شد");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong className="flex items-center gap-2 text-sm">
            <Paperclip className="size-4 text-primary" />
            ضمیمه‌های سند
          </strong>
          <p className="mt-1 text-xs text-muted-foreground">
            عکس رسید، بل فروشنده، PDF قرارداد یا هر سند مربوط به همین معامله.
          </p>
        </div>
        <Badge className="bg-primary/15 text-primary">{items.length} فایل</Badge>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="یادداشت سند، مثلا رسید فروشنده یا بل بانک"
        />
        <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent">
          <Upload className="size-4" />
          {isUploading ? "در حال آپلود..." : "آپلود عکس/PDF"}
          <input
            type="file"
            className="hidden"
            accept="image/*,.pdf,application/pdf"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void uploadAttachment(file);
            }}
          />
        </label>
      </div>

      <div className="overflow-hidden border border-border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
              <TableHead>فایل</TableHead>
              <TableHead>نوع</TableHead>
              <TableHead>حجم</TableHead>
              <TableHead>آپلود کننده</TableHead>
              <TableHead>یادداشت</TableHead>
              <TableHead>عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  در حال خواندن ضمیمه‌ها...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  هنوز سندی ضمیمه نشده است
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} className="border-border">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-primary" />
                      <span className="max-w-56 truncate">{item.originalName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {item.mimeType === "application/pdf" ? "PDF" : "عکس"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatFileSize(item.sizeBytes)}</TableCell>
                  <TableCell>
                    {item.createdByUser?.displayName || item.createdByUser?.username || "-"}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{item.note || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void openAttachment(item)}
                      >
                        باز کردن
                      </Button>
                      <ConfirmButton
                        size="icon-sm"
                        variant="destructive"
                        title="تایید حذف سند"
                        description="آیا مطمئن هستید که این سند حذف شود؟"
                        confirmLabel="حذف"
                        onConfirm={() => void deleteAttachment(item)}
                      >
                        <Trash2 className="size-4" />
                      </ConfirmButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [active, setActive] = useState(settingsConfigs[0].title);
  const current = settingsConfigs.find((config) => config.title === active) || settingsConfigs[0];

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>تنظیمات اولیه سیستم</CardTitle>
          <CardDescription>
            گدام، واحدات، کرنسی و کتگوری‌ها پایه‌ی خرید، فروش، موجودی و گزارشات‌اند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {settingsConfigs.map((config) => (
              <Button
                key={config.title}
                variant={active === config.title ? "default" : "outline"}
                onClick={() => setActive(config.title)}
              >
                {config.icon}
                {config.title}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <AdminDataPage config={current} />
    </div>
  );
}

const emptyProductForm: ProductFormState = {
  name: "",
  sku: "",
  barcode: "",
  description: "",
  imageUrl: "",
  categoryId: "",
  baseUnitId: "",
  defaultWarehouseId: "",
  hasExpiry: false,
  minStock: 0,
  purchasePrice: 0,
  salePrice: 0,
  openingQuantity: 0,
  openingUnitCost: 0,
  openingCurrencyId: "",
  openingExpiryDate: "",
};

function makeProductUnitLine(
  units: LookupItem[],
  patch: Partial<ProductUnitForm> = {},
): ProductUnitForm {
  return {
    id: createClientId(),
    unitId: units[0]?.id || "",
    conversionRate: 1,
    purchasePrice: 0,
    salePrice: 0,
    isDefaultPurchase: false,
    isDefaultSale: false,
    ...patch,
  };
}

const emptyPurchaseForm: PurchaseFormState = {
  invoiceNo: "",
  supplierId: "",
  currencyId: "",
  paymentAccountKey: "",
  discount: 0,
  paidAmount: 0,
  productId: "",
  warehouseId: "",
  unitId: "",
  quantity: 1,
  unitCost: 0,
  expiryDate: "",
  note: "",
};

const emptySaleForm: SaleFormState = {
  invoiceNo: "",
  customerId: "",
  currencyId: "",
  paymentAccountKey: "",
  discount: 0,
  paidAmount: 0,
  note: "",
};

function makeSaleLine(
  products: any[],
  warehouses: LookupItem[],
  currency?: LookupItem | null,
): SaleLineForm {
  const product = products[0];
  const saleUnit = product?.units?.find((unit: any) => unit.isDefaultSale) || product?.units?.[0];

  return {
    id: createClientId(),
    productId: product?.id || "",
    warehouseId: product?.defaultWarehouseId || warehouses[0]?.id || "",
    unitId: saleUnit?.unitId || product?.baseUnitId || "",
    quantity: 1,
    unitPrice: basePriceInCurrency(Number(saleUnit?.salePrice || 0), currency),
    discount: 0,
  };
}

function makePurchaseLine(
  products: any[],
  warehouses: LookupItem[],
  currency?: LookupItem | null,
): PurchaseLineForm {
  const product = products[0];
  const purchaseUnit =
    product?.units?.find((unit: any) => unit.isDefaultPurchase) || product?.units?.[0];

  return {
    id: createClientId(),
    productId: product?.id || "",
    warehouseId: warehouses[0]?.id || "",
    unitId: purchaseUnit?.unitId || product?.baseUnitId || "",
    quantity: 1,
    unitCost: basePriceInCurrency(Number(purchaseUnit?.purchasePrice || 0), currency),
    updateSalePrice: false,
    salePrice: basePriceInCurrency(Number(purchaseUnit?.salePrice || 0), currency),
    expiryDate: "",
  };
}

const emptySaleLineDraft: SaleLineForm = {
  id: "",
  productId: "",
  warehouseId: "",
  unitId: "",
  quantity: 1,
  unitPrice: 0,
  discount: 0,
};

const emptyPurchaseLineDraft: PurchaseLineForm = {
  id: "",
  productId: "",
  warehouseId: "",
  unitId: "",
  quantity: 1,
  unitCost: 0,
  updateSalePrice: false,
  salePrice: 0,
  expiryDate: "",
};

function lookupLabel(items: LookupItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id);
  return item?.code || item?.shortName || item?.name || "-";
}

function productLabel(products: any[], id: string) {
  return products.find((product) => product.id === id)?.name || "-";
}

function productHasExpiry(products: any[], id: string) {
  return Boolean(products.find((product) => product.id === id)?.hasExpiry);
}

function productUnitInfo(products: any[], productId: string, unitId: string) {
  const product = products.find((item) => item.id === productId);
  const productUnit = product?.units?.find((unit: any) => unit.unitId === unitId);

  return {
    product,
    productUnit,
    conversionRate:
      productUnit?.conversionRate !== undefined
        ? Number(productUnit.conversionRate || 1)
        : product?.baseUnitId === unitId
          ? 1
          : 1,
    baseUnitName: product?.baseUnit?.shortName || product?.baseUnit?.name || "واحد پایه",
  };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const rows = new Map<string, T>();
  current.forEach((item) => rows.set(item.id, item));
  incoming.forEach((item) => {
    if (item?.id) rows.set(item.id, item);
  });
  return Array.from(rows.values());
}

async function searchProductLookupOptions(query: string, signal?: AbortSignal) {
  const normalized = query.trim();

  const params = new URLSearchParams({ limit: "30" });
  if (normalized.length >= 2) params.set("search", normalized);

  const response = await fetch(`${API_BASE_URL}/api/products/lookup?${params.toString()}`, {
    signal,
  });
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(json?.message || "جستجوی جنس ناکام شد");
  }

  return Array.isArray(json?.data) ? json.data : [];
}

function replaceLookupOptionsKeepingSelected<T extends { id: string }>(
  current: T[],
  incoming: T[],
  selectedIds: string[],
) {
  const selectedIdSet = new Set(selectedIds.filter(Boolean));
  return mergeById(
    current.filter((item) => selectedIdSet.has(item.id)),
    incoming,
  );
}

function invoiceLineTotal(quantity: number, unitAmount: number, discount = 0) {
  return Math.max(0, quantity * unitAmount - discount);
}

function SalesPage() {
  const initialSalesRange = recentDateRange();
  const isAdmin = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "null");
      return user?.role === "Admin";
    } catch {
      return false;
    }
  }, []);
  const [sales, setSales] = useState<DataRow[]>([]);
  const [salesSummary, setSalesSummary] = useState({
    count: 0,
    total: 0,
    paid: 0,
    remaining: 0,
  });
  const [salesPagination, setSalesPagination] = useState<any>(null);
  const [saleReturns, setSaleReturns] = useState<DataRow[]>([]);
  const [saleReturnsPagination, setSaleReturnsPagination] = useState<any>(null);
  const [customers, setCustomers] = useState<LookupItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<LookupItem[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(initialSalesRange.from);
  const [to, setTo] = useState(initialSalesRange.to);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SaleFormState>(emptySaleForm);
  const [saleLines, setSaleLines] = useState<SaleLineForm[]>([]);
  const [saleItemDialogOpen, setSaleItemDialogOpen] = useState(false);
  const [editingSaleLineId, setEditingSaleLineId] = useState<string | null>(null);
  const [saleLineDraft, setSaleLineDraft] = useState<SaleLineForm>(emptySaleLineDraft);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnSale, setReturnSale] = useState<any | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineForm[]>([]);
  const [refundAccountKey, setRefundAccountKey] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [returnNote, setReturnNote] = useState("");
  const [detailsSale, setDetailsSale] = useState<any | null>(null);
  const [cancelSale, setCancelSale] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [duplicateSale, setDuplicateSale] = useState<DataRow | null>(null);
  const [isDuplicatingSale, setIsDuplicatingSale] = useState(false);
  const [detailsSaleReturn, setDetailsSaleReturn] = useState<any | null>(null);
  const [cancelSaleReturn, setCancelSaleReturn] = useState<any | null>(null);
  const [cancelSaleReturnReason, setCancelSaleReturnReason] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentSale, setPaymentSale] = useState<any | null>(null);
  const [invoicePaymentAmount, setInvoicePaymentAmount] = useState(0);
  const [invoicePaymentAccountKey, setInvoicePaymentAccountKey] = useState("");
  const [invoicePaymentNote, setInvoicePaymentNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [cogsQualityOpen, setCogsQualityOpen] = useState(false);
  const [cogsQualityRows, setCogsQualityRows] = useState<DataRow[]>([]);
  const [cogsQualityPagination, setCogsQualityPagination] = useState<any>(null);
  const [cogsQualitySummary, setCogsQualitySummary] = useState({
    missingCount: 0,
    baseSalesTotal: 0,
  });
  const [isLoadingCogsQuality, setIsLoadingCogsQuality] = useState(false);
  const [cogsRepairSale, setCogsRepairSale] = useState<DataRow | null>(null);
  const [isRepairingCogs, setIsRepairingCogs] = useState(false);
  const [returnQualityOpen, setReturnQualityOpen] = useState(false);
  const [returnQualityRows, setReturnQualityRows] = useState<DataRow[]>([]);
  const [returnQualityPagination, setReturnQualityPagination] = useState<any>(null);
  const [returnQualitySummary, setReturnQualitySummary] = useState({
    suspiciousCount: 0,
    discrepancyTotal: 0,
  });
  const [isLoadingReturnQuality, setIsLoadingReturnQuality] = useState(false);
  const saleProductSearchSeqRef = useRef(0);
  const saleProductSearchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => saleProductSearchAbortRef.current?.abort(), []);

  const loadSalesData = async (
    page = salesPagination?.page || 1,
    returnsPage = saleReturnsPagination?.page || 1,
  ) => {
    setIsLoading(true);
    try {
      const salesParams = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      const returnsParams = new URLSearchParams({
        page: String(returnsPage),
        limit: "20",
      });
      for (const [key, value] of new URLSearchParams(dateRangeQuery(from, to))) {
        salesParams.set(key, value);
        returnsParams.set(key, value);
      }
      if (query.trim()) {
        salesParams.set("search", query.trim());
        returnsParams.set("search", query.trim());
      }
      const [
        salesRes,
        saleReturnsRes,
        customersRes,
        productsRes,
        warehousesRes,
        currenciesRes,
        cashRes,
        bankRes,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/api/sales?${salesParams.toString()}`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/sale-returns?${returnsParams.toString()}`).then((res) =>
          res.json(),
        ),
        fetch(`${API_BASE_URL}/api/parties?type=CUSTOMER`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/products/lookup?limit=50`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/warehouses`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/currencies`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/cash-registers`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/bank-accounts`).then((res) => res.json()),
      ]);

      setSales(
        Array.isArray(salesRes?.data)
          ? salesRes.data.map((item: unknown) => normalizeRow(item, "فروشات"))
          : [],
      );
      setSalesSummary(salesRes?.summary || { count: 0, total: 0, paid: 0, remaining: 0 });
      setSalesPagination(salesRes?.pagination || null);
      setSaleReturns(
        Array.isArray(saleReturnsRes?.data)
          ? saleReturnsRes.data.map((item: any) => ({
              ...item,
              number: item.returnNo,
              invoice: item.sale?.invoiceNo,
              party: item.customer?.name,
              total: money(item.subtotal, item.currency),
              settled: money(item.refundAmount, item.currency),
            }))
          : [],
      );
      setSaleReturnsPagination(saleReturnsRes?.pagination || null);
      setCustomers(Array.isArray(customersRes?.data) ? customersRes.data : []);
      setProducts(Array.isArray(productsRes?.data) ? productsRes.data : []);
      setWarehouses(Array.isArray(warehousesRes?.data) ? warehousesRes.data : []);
      setCurrencies(Array.isArray(currenciesRes?.data) ? currenciesRes.data : []);

      const cashAccounts: PaymentAccountOption[] = Array.isArray(cashRes?.data)
        ? cashRes.data.flatMap((register: any) =>
            Array.isArray(register.accounts)
              ? register.accounts.map((account: any) => ({
                  id: account.id,
                  type: "CASH" as const,
                  currencyId: account.currencyId,
                  name: `${register.name} / ${account.currency?.code || ""}`,
                }))
              : [],
          )
        : [];
      const bankAccounts: PaymentAccountOption[] = Array.isArray(bankRes?.data)
        ? bankRes.data.map((account: any) => ({
            id: account.id,
            type: "BANK" as const,
            currencyId: account.currencyId,
            name: `${account.name} / ${account.currency?.code || ""}`,
          }))
        : [];

      setPaymentAccounts([...cashAccounts, ...bankAccounts]);
    } catch {
      toast.error("خواندن فروشات ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  const loadCogsQuality = async (page = cogsQualityPagination?.page || 1) => {
    if (!isAdmin) return;

    setIsLoadingCogsQuality(true);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });

      for (const [key, value] of new URLSearchParams(dateRangeQuery(from, to))) {
        params.set(key, value);
      }

      const response = await fetch(`${API_BASE_URL}/api/sales/cogs-quality?${params.toString()}`);
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "خواندن گزارش کیفیت COGS ناکام شد");
      }

      setCogsQualityRows(
        Array.isArray(json?.data)
          ? json.data.map((item: any) => ({
              id: item.id,
              name: item.invoiceNo || item.id,
              party: item.customerName || "مشتری نقدی",
              date: formatDateTime(item.saleDate),
              total: money(item.total || 0, item.currencyCode || "AFN"),
              cogsTotal: money(item.cogsTotal || 0),
              __raw: item,
            }))
          : [],
      );
      setCogsQualityPagination(json?.pagination || null);
      setCogsQualitySummary(json?.summary || { missingCount: 0, baseSalesTotal: 0 });
    } catch (error: any) {
      toast.error(error?.message || "خواندن گزارش کیفیت COGS ناکام شد");
    } finally {
      setIsLoadingCogsQuality(false);
    }
  };

  const confirmCogsRepair = async () => {
    if (!cogsRepairSale || !isAdmin || isRepairingCogs) return;

    setIsRepairingCogs(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/sales/${cogsRepairSale.id}/repair-cogs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "اصلاح COGS فروش ناکام شد");
      }

      if (json?.zeroCost) {
        toast.warning("سند بررسی شد؛ قیمت تمام‌شده ثبت‌شده این فروش صفر است");
      } else if (json?.idempotentReplay) {
        toast.info("سند COGS این فروش قبلاً ثبت شده بود");
      } else {
        toast.success("سند COGS فروش با موفقیت ثبت شد");
      }

      setCogsRepairSale(null);
      await loadSalesData(salesPagination?.page || 1, saleReturnsPagination?.page || 1);

      if (cogsQualityOpen) {
        await loadCogsQuality(cogsQualityPagination?.page || 1);
      }
    } catch (error: any) {
      toast.error(error?.message || "اصلاح COGS فروش ناکام شد");
    } finally {
      setIsRepairingCogs(false);
    }
  };

  const loadReturnQuality = async (page = returnQualityPagination?.page || 1) => {
    if (!isAdmin) return;

    setIsLoadingReturnQuality(true);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });

      for (const [key, value] of new URLSearchParams(dateRangeQuery(from, to))) {
        params.set(key, value);
      }

      const response = await fetch(`${API_BASE_URL}/api/sale-returns/quality?${params.toString()}`);
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "خواندن گزارش کیفیت برگشتی‌ها ناکام شد");
      }

      setReturnQualityRows(
        Array.isArray(json?.data)
          ? json.data.map((item: any) => ({
              id: item.returnItemId,
              name: item.returnNo || item.returnId,
              invoice: item.invoiceNo || item.saleId,
              product: item.productName || "-",
              date: formatDateTime(item.createdAt),
              actual: money(item.actualTotal || 0),
              expected: money(item.expectedNetTotal || 0),
              difference: money(item.discrepancy || 0),
              __raw: item,
            }))
          : [],
      );
      setReturnQualityPagination(json?.pagination || null);
      setReturnQualitySummary(json?.summary || { suspiciousCount: 0, discrepancyTotal: 0 });
    } catch (error: any) {
      toast.error(error?.message || "خواندن گزارش کیفیت برگشتی‌ها ناکام شد");
    } finally {
      setIsLoadingReturnQuality(false);
    }
  };

  useEffect(() => {
    void loadSalesData();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSalesData(1, 1), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const searchSaleProducts = async (value: string) => {
    const query = value.trim();
    const requestSeq = saleProductSearchSeqRef.current + 1;
    saleProductSearchSeqRef.current = requestSeq;
    saleProductSearchAbortRef.current?.abort();

    const abortController = new AbortController();
    saleProductSearchAbortRef.current = abortController;

    try {
      const rows = await searchProductLookupOptions(query, abortController.signal);
      if (requestSeq !== saleProductSearchSeqRef.current) return;
      setProducts((current) =>
        replaceLookupOptionsKeepingSelected(
          current,
          rows,
          saleLines.map((line) => line.productId),
        ),
      );
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      // Product lookup search is best-effort; form submission still validates.
    } finally {
      if (saleProductSearchAbortRef.current === abortController) {
        saleProductSearchAbortRef.current = null;
      }
    }
  };

  const subtotal = saleLines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity * line.unitPrice - line.discount),
    0,
  );
  const total = Math.max(0, subtotal - form.discount);
  const remaining = Math.max(0, total - form.paidAmount);
  const selectedCurrency = currencies.find((currency) => currency.id === form.currencyId);

  const openCreate = () => {
    const baseCurrency = currencies.find((item) => item.isBase) || currencies[0];
    const account = paymentAccounts.find(
      (item) => !baseCurrency || item.currencyId === baseCurrency.id,
    );

    setForm({
      ...emptySaleForm,
      invoiceNo: `INV-${Date.now()}`,
      customerId: customers[0]?.id || "",
      currencyId: baseCurrency?.id || "",
      paymentAccountKey: account ? `${account.type}:${account.id}` : "",
    });
    setSaleLines([]);
    setEditingSaleLineId(null);
    setSaleLineDraft(emptySaleLineDraft);
    setSaleItemDialogOpen(false);
    setDialogOpen(true);
  };

  const saleUnitPrice = (productId: string, unitId: string) => {
    const product = products.find((item) => item.id === productId);
    const unit = product?.units?.find((item: any) => item.unitId === unitId);
    return basePriceInCurrency(Number(unit?.salePrice || 0), selectedCurrency);
  };

  const changeSaleCurrency = (currencyId: string) => {
    const nextCurrency = currencies.find((item) => item.id === currencyId);
    const convert = (value: number) => convertCurrencyAmount(value, selectedCurrency, nextCurrency);

    setForm((current) => ({
      ...current,
      currencyId,
      paymentAccountKey: "",
      discount: convert(current.discount),
      paidAmount: convert(current.paidAmount),
    }));
    setSaleLines((current) =>
      current.map((line) => ({
        ...line,
        unitPrice: convert(line.unitPrice),
        discount: convert(line.discount),
      })),
    );
    setSaleLineDraft((current) => ({
      ...current,
      unitPrice: convert(current.unitPrice),
      discount: convert(current.discount),
    }));
  };

  const updateSaleLine = (lineId: string, patch: Partial<SaleLineForm>) => {
    setSaleLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, ...patch };
        if (patch.unitId && patch.unitId !== line.unitId && patch.unitPrice === undefined) {
          next.unitPrice = saleUnitPrice(next.productId, patch.unitId);
        }
        return next;
      }),
    );
  };

  const saleUnitOptions = (productId: string) => {
    const product = products.find((item) => item.id === productId);

    if (!product) return [];

    return [
      ...(product.baseUnit
        ? [
            {
              id: product.baseUnitId,
              name: product.baseUnit.name,
              shortName: product.baseUnit.shortName,
            },
          ]
        : []),
      ...(Array.isArray(product.units)
        ? product.units.map((unit: any) => ({
            id: unit.unitId,
            name: unit.unit?.name || unit.unitId,
            shortName: unit.unit?.shortName,
          }))
        : []),
    ].filter(
      (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
    );
  };

  const setSaleLineProduct = (lineId: string, productId: string) => {
    const product = products.find((item) => item.id === productId);
    const saleUnit = product?.units?.find((unit: any) => unit.isDefaultSale) || product?.units?.[0];

    updateSaleLine(lineId, {
      productId,
      warehouseId: product?.defaultWarehouseId || warehouses[0]?.id || "",
      unitId: saleUnit?.unitId || product?.baseUnitId || "",
      unitPrice: basePriceInCurrency(Number(saleUnit?.salePrice || 0), selectedCurrency),
    });
  };

  const openSaleItemDialog = (line?: SaleLineForm) => {
    setEditingSaleLineId(line?.id || null);
    setSaleLineDraft(line || makeSaleLine(products, warehouses, selectedCurrency));
    setSaleItemDialogOpen(true);
  };

  const setSaleDraftProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    const saleUnit = product?.units?.find((unit: any) => unit.isDefaultSale) || product?.units?.[0];

    setSaleLineDraft((current) => ({
      ...current,
      productId,
      warehouseId: product?.defaultWarehouseId || warehouses[0]?.id || "",
      unitId: saleUnit?.unitId || product?.baseUnitId || "",
      unitPrice: basePriceInCurrency(Number(saleUnit?.salePrice || 0), selectedCurrency),
    }));
  };

  const saveSaleItem = () => {
    if (
      !saleLineDraft.productId ||
      !saleLineDraft.warehouseId ||
      !saleLineDraft.unitId ||
      saleLineDraft.quantity <= 0 ||
      saleLineDraft.unitPrice < 0 ||
      saleLineDraft.discount < 0
    ) {
      toast.error("همه معلومات قلم فروش را درست وارد کنید");
      return;
    }

    setSaleLines((current) =>
      editingSaleLineId
        ? current.map((line) => (line.id === editingSaleLineId ? saleLineDraft : line))
        : [...current, { ...saleLineDraft, id: createClientId() }],
    );
    setSaleItemDialogOpen(false);
  };

  const saleLineNetTotals = saleLines.map((line) =>
    invoiceLineTotal(line.quantity, line.unitPrice, line.discount),
  );
  const saleDiscountAllocations = allocateMoneyByWeight(form.discount, saleLineNetTotals);
  const saleItemRows: InvoiceItemRow[] = saleLines.map((line, index) => {
    const lineNetBeforeGeneral = saleLineNetTotals[index] ?? 0;
    const generalDiscount = saleDiscountAllocations[index] ?? 0;
    const unitInfo = productUnitInfo(products, line.productId, line.unitId);
    const baseQuantity = line.quantity * unitInfo.conversionRate;
    const baseSalePrice =
      unitInfo.conversionRate > 0 ? line.unitPrice / unitInfo.conversionRate : line.unitPrice;

    return {
      id: line.id,
      product: productLabel(products, line.productId),
      warehouse: lookupLabel(warehouses, line.warehouseId),
      unit: lookupLabel(saleUnitOptions(line.productId), line.unitId),
      quantity: line.quantity,
      unitAmount: line.unitPrice,
      discount: line.discount,
      generalDiscount,
      netTotal: Math.max(0, lineNetBeforeGeneral - generalDiscount),
      baseQuantity,
      baseUnit: unitInfo.baseUnitName,
      baseUnitAmount: baseSalePrice,
      salePrice: line.unitPrice,
      baseSalePrice,
      total: lineNetBeforeGeneral,
    };
  });

  const submitSale = async () => {
    if (!form.currencyId || saleLines.length === 0) {
      toast.error("کرنسی و حداقل یک قلم فروش ضروری است");
      return;
    }

    const invalidLine = saleLines.find(
      (line) =>
        !line.productId ||
        !line.warehouseId ||
        !line.unitId ||
        line.quantity <= 0 ||
        line.unitPrice < 0 ||
        line.discount < 0,
    );

    if (invalidLine) {
      toast.error("همه اقلام باید جنس، گدام، واحد، مقدار و قیمت معتبر داشته باشند");
      return;
    }

    if (remaining > 0 && !form.customerId) {
      toast.error("برای فروش قرض، مشتری ضروری است");
      return;
    }

    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === form.paymentAccountKey,
    );

    if (form.paidAmount > 0 && !paymentAccount) {
      toast.error("برای پرداخت، حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo: form.invoiceNo || null,
          customerId: form.customerId || null,
          currencyId: form.currencyId,
          discount: form.discount,
          paidAmount: form.paidAmount,
          paymentAccountType: paymentAccount?.type || null,
          paymentAccountId: paymentAccount?.id || null,
          note: form.note || null,
          items: saleLines.map((line) => ({
            productId: line.productId,
            warehouseId: line.warehouseId,
            unitId: line.unitId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
          })),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت فروش ناکام شد");
      }

      toast.success("فاکتور فروش ثبت شد");
      setDialogOpen(false);
      await loadSalesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت فروش ناکام شد");
    }
  };

  const openSaleDetails = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن جزئیات فروش ناکام شد");
      }

      setDetailsSale(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن جزئیات فروش ناکام شد");
    }
  };

  const openSaleReturn = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور فروش ناکام شد");
      }

      const sale = json.data;
      const account = paymentAccounts.find((item) => item.currencyId === sale.currencyId);

      setReturnSale(sale);
      setReturnLines(
        Array.isArray(sale.items)
          ? sale.items.map((item: any) => ({ itemId: item.id, quantity: 0 }))
          : [],
      );
      setRefundAccountKey(account ? `${account.type}:${account.id}` : "");
      setRefundAmount(0);
      setReturnNote("");
      setReturnDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور فروش ناکام شد");
    }
  };

  const openSalePayment = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور فروش ناکام شد");
      }

      const sale = json.data;
      const account = paymentAccounts.find((item) => item.currencyId === sale.currencyId);

      setPaymentSale(sale);
      setInvoicePaymentAmount(Number(sale.remainingAmount || 0));
      setInvoicePaymentAccountKey(account ? `${account.type}:${account.id}` : "");
      setInvoicePaymentNote("");
      setPaymentDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور فروش ناکام شد");
    }
  };

  const openSaleCancel = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور فروش ناکام شد");
      }

      setCancelSale(json.data);
      setCancelReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور فروش ناکام شد");
    }
  };

  const openSaleDuplicate = (row: DataRow) => {
    setDuplicateSale(row);
  };

  const submitSaleDuplicate = async () => {
    if (!duplicateSale) return;

    setIsDuplicatingSale(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${duplicateSale.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور فروش ناکام شد");
      }

      const sale = json.data;

      if (sale?.status === "CANCELLED") {
        throw new Error("فروش ابطال‌شده قابل دوپلیکیت نیست");
      }

      const sourceItems = Array.isArray(sale?.items) ? sale.items : [];

      if (sourceItems.length === 0) {
        throw new Error("این فاکتور قلمی برای دوپلیکیت ندارد");
      }

      const productOptions = await Promise.all(
        sourceItems.map(async (item: any) => {
          const currentProduct = products.find((product) => product.id === item.productId);

          if (currentProduct?.units?.length) return currentProduct;

          const searchText =
            item.product?.barcode ||
            item.product?.barcodeNormalized ||
            item.product?.sku ||
            item.product?.name ||
            "";

          if (String(searchText).trim().length >= 2) {
            try {
              const options = await searchProductLookupOptions(String(searchText));
              const matched = options.find((product: any) => product.id === item.productId);
              if (matched) return matched;
            } catch {
              // A minimal product option below keeps the duplicate draft usable.
            }
          }

          return item.product
            ? {
                ...item.product,
                baseUnit:
                  item.product.baseUnitId === item.unitId
                    ? item.unit || null
                    : item.product.baseUnit || null,
                units: [
                  {
                    unitId: item.unitId,
                    unit: item.unit,
                    conversionRate: item.conversionRate || 1,
                    salePrice: item.unitPrice || 0,
                    isDefaultSale: true,
                  },
                ],
              }
            : null;
        }),
      );

      setProducts((current) =>
        mergeById(current, productOptions.filter(Boolean) as Array<{ id: string }>),
      );

      const groupedLines = new Map<string, SaleLineForm>();

      for (const item of sourceItems) {
        const key = [
          item.productId,
          item.warehouseId,
          item.unitId,
          Number(item.unitPrice || 0).toFixed(4),
        ].join("|");
        const existing = groupedLines.get(key);

        if (existing) {
          groupedLines.set(key, {
            ...existing,
            quantity: Number((existing.quantity + Number(item.quantity || 0)).toFixed(4)),
            discount: Number((existing.discount + Number(item.discount || 0)).toFixed(4)),
          });
        } else {
          groupedLines.set(key, {
            id: createClientId(),
            productId: item.productId,
            warehouseId: item.warehouseId,
            unitId: item.unitId,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            discount: Number(item.discount || 0),
          });
        }
      }

      const paidAmount = Number(sale.paidAmount || 0);
      const account = paymentAccounts.find((item) => item.currencyId === sale.currencyId);

      setForm({
        ...emptySaleForm,
        invoiceNo: `INV-${Date.now()}`,
        customerId: sale.customerId || "",
        currencyId: sale.currencyId || "",
        paymentAccountKey: paidAmount > 0 && account ? `${account.type}:${account.id}` : "",
        discount: Number(sale.discount || 0),
        paidAmount,
        note: sale.invoiceNo ? `دوپلیکیت از فاکتور ${sale.invoiceNo}` : "دوپلیکیت از فاکتور فروش",
      });
      setSaleLines(Array.from(groupedLines.values()));
      setEditingSaleLineId(null);
      setSaleLineDraft(emptySaleLineDraft);
      setSaleItemDialogOpen(false);
      setDialogOpen(true);
      setDuplicateSale(null);

      if (paidAmount > 0 && !account) {
        toast.warning("برای ثبت نسخه دوپلیکیت، حساب دریافت را انتخاب کنید");
      } else {
        toast.success("نسخه دوپلیکیت فروش آماده ثبت شد");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "دوپلیکیت فروش ناکام شد");
    } finally {
      setIsDuplicatingSale(false);
    }
  };

  const submitSaleCancel = async () => {
    if (!cancelSale) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${cancelSale.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason || null }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال فروش ناکام شد");
      }

      toast.success("فاکتور فروش با اثر معکوس باطل شد");
      setCancelSale(null);
      await loadSalesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال فروش ناکام شد");
    }
  };

  const printSaleReceipt = async (row: DataRow) => {
    const receiptWidthMm = Number(localStorage.getItem("muhaseb_receipt_width_mm") || 80);
    const safeReceiptWidthMm = receiptWidthMm === 58 ? 58 : 80;
    const url = await refreshReceiptAccessUrl(
      `${API_BASE_URL}/api/pos-receipts/sales/${row.id}/html?width=${safeReceiptWidthMm}`,
    );
    try {
      if (window.electronAPI?.printReceipt) {
        await window.electronAPI.printReceipt(url, {
          widthMm: safeReceiptWidthMm,
          marginLeftMm: Number(localStorage.getItem("muhaseb_receipt_margin_left_mm") || 1.5),
          marginRightMm: Number(localStorage.getItem("muhaseb_receipt_margin_right_mm") || 1.5),
          silent: localStorage.getItem("muhaseb_receipt_silent_print") === "true",
          deviceName: localStorage.getItem("muhaseb_receipt_printer_name") || "",
        });
        toast.success("رسید برای چاپ آماده شد");
        return;
      }
      window.open(url, "_blank");
    } catch {
      window.open(url, "_blank");
      toast.error("چاپ مستقیم ناکام شد؛ رسید در مرورگر باز شد");
    }
  };

  const submitSaleReturnCancel = async () => {
    if (!cancelSaleReturn || !cancelSaleReturnReason.trim()) {
      toast.error("دلیل ابطال ضروری است");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/sale-returns/${cancelSaleReturn.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelSaleReturnReason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || "ابطال برگشت فروش ناکام شد");
      toast.success("برگشت فروش با سند معکوس باطل شد");
      setCancelSaleReturn(null);
      await loadSalesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال برگشت فروش ناکام شد");
    }
  };

  const submitSalePayment = async () => {
    if (!paymentSale) return;

    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === invoicePaymentAccountKey,
    );

    if (invoicePaymentAmount <= 0) {
      toast.error("مبلغ پرداخت باید بیشتر از صفر باشد");
      return;
    }

    if (!paymentAccount) {
      toast.error("حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${paymentSale.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: invoicePaymentAmount,
          paymentAccountType: paymentAccount.type,
          paymentAccountId: paymentAccount.id,
          note: invoicePaymentNote || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت پرداخت فروش ناکام شد");
      }

      toast.success("پرداخت فاکتور فروش ثبت شد");
      setPaymentDialogOpen(false);
      await loadSalesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت پرداخت فروش ناکام شد");
    }
  };

  const saleReturnSubtotal = returnLines.reduce((sum, line) => {
    const item = returnSale?.items?.find((candidate: any) => candidate.id === line.itemId);
    if (!item || Number(item.quantity || 0) <= 0) return sum;
    const soldQuantity = Number(item.quantity || 0);
    const returnableQuantity = Number(item.returnableQuantity ?? soldQuantity);
    const returnableNetTotal = Number(
      item.returnableNetTotal ??
        item.effectiveNetTotalPrice ??
        item.netTotalPrice ??
        item.totalPrice ??
        0,
    );
    const fullNetTotal = Number(
      item.effectiveNetTotalPrice ?? item.netTotalPrice ?? item.totalPrice ?? 0,
    );
    const quantity = Math.min(line.quantity, returnableQuantity);
    const lineTotal =
      Math.abs(quantity - returnableQuantity) <= 0.0001
        ? returnableNetTotal
        : (fullNetTotal / Math.max(soldQuantity, 1)) * quantity;

    return sum + lineTotal;
  }, 0);
  const roundedSaleReturnSubtotal = Number(saleReturnSubtotal.toFixed(4));

  const submitSaleReturn = async () => {
    if (!returnSale) return;

    const selectedItems = returnLines.filter((line) => line.quantity > 0);
    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === refundAccountKey,
    );

    if (selectedItems.length === 0) {
      toast.error("حداقل یک قلم برای برگشت انتخاب کنید");
      return;
    }

    const effectiveRefundAmount = returnSale.customerId ? refundAmount : roundedSaleReturnSubtotal;

    if (effectiveRefundAmount > 0 && !paymentAccount) {
      toast.error("برای برگشت نقدی، حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/sale-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: returnSale.id,
          refundAccountType: paymentAccount?.type || null,
          refundAccountId: paymentAccount?.id || null,
          refundAmount: effectiveRefundAmount,
          note: returnNote || null,
          items: selectedItems.map((line) => ({
            saleItemId: line.itemId,
            quantity: line.quantity,
          })),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت برگشت فروش ناکام شد");
      }

      toast.success("برگشت فروش ثبت شد");
      setReturnDialogOpen(false);
      await loadSalesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت برگشت فروش ناکام شد");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="فاکتورهای فروش"
          value={new Intl.NumberFormat("en-US").format(salesSummary.count)}
          icon={<ShoppingBag />}
        />
        <MetricCard
          label="مجموع فروش دوره"
          value={money(salesSummary.total)}
          icon={<CreditCard />}
        />
        <MetricCard
          label="دریافت‌شده دوره"
          value={money(salesSummary.paid)}
          icon={<CreditCard />}
        />
        <MetricCard
          label="باقیات فروش دوره"
          value={money(salesSummary.remaining)}
          icon={<CreditCard />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="size-5 text-primary" />
              فروشات
            </CardTitle>
            <CardDescription>
              ثبت فروش عادی و قرض با چندین قلم، پرداخت نقد/بانک و باقیات مشتری.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} className="w-40" />
            <DatePicker value={to} onChange={setTo} className="w-40" />
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی فاکتور یا مشتری..."
                className="w-72 ps-9"
              />
            </div>
            <Button variant="outline" onClick={() => void loadSalesData(1, 1)}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCogsQualityOpen(true);
                    void loadCogsQuality(1);
                  }}
                >
                  <ShieldCheck className="size-4" />
                  کیفیت COGS
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReturnQualityOpen(true);
                    void loadReturnQuality(1);
                  }}
                >
                  <TrendingDown className="size-4" />
                  کیفیت برگشتی
                </Button>
              </>
            )}
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              فروش جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن فروشات...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "فاکتور" },
                { key: "party", label: "مشتری" },
                { key: "total", label: "مجموع" },
                { key: "paid", label: "پرداخت" },
                { key: "status", label: "وضعیت" },
                { key: "cogsStatus", label: "COGS" },
              ]}
              rows={sales}
              pagination={salesPagination}
              onPageChange={(page) => void loadSalesData(page)}
              onDetails={openSaleDetails}
              onEdit={openSaleReturn}
              editLabel="برگشت"
              onSecondary={openSalePayment}
              onDelete={openSaleCancel}
              secondaryLabel="پرداخت"
              extraActions={[
                {
                  label: "اصلاح COGS",
                  icon: <ShieldCheck className="size-4" />,
                  onClick: setCogsRepairSale,
                  isVisible: (row) =>
                    isAdmin && row.__canDelete !== false && row.__raw?.cogsStatus === "MISSING",
                },
                {
                  label: "دوپلیکیت فروش",
                  icon: <Copy className="size-4" />,
                  onClick: openSaleDuplicate,
                  isVisible: (row) => row.__canDelete !== false,
                },
                {
                  label: "چاپ دوباره رسید",
                  icon: <FileText className="size-4" />,
                  onClick: printSaleReceipt,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
      <ReturnDocumentsCard
        title="اسناد برگشت فروش"
        description="برگشت‌های ثبت‌شده با جزئیات و امکان ابطال امن توسط سند معکوس."
        rows={saleReturns}
        onRefresh={() => void loadSalesData()}
        pagination={saleReturnsPagination}
        onPageChange={(page) => void loadSalesData(salesPagination?.page || 1, page)}
        onDetails={setDetailsSaleReturn}
        onCancel={(row) => {
          setCancelSaleReturn(row);
          setCancelSaleReturnReason("");
        }}
      />

      <Dialog open={cogsQualityOpen} onOpenChange={setCogsQualityOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[min(94vw,1050px)]">
          <DialogHeader>
            <DialogTitle>گزارش فروش‌های بدون COGS</DialogTitle>
            <DialogDescription>
              فقط فروش‌های بازه انتخاب‌شده که سند بهای تمام‌شده ندارند نمایش داده می‌شوند.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 border-y border-border py-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">تعداد اسناد ناقص</span>
              <strong>{cogsQualitySummary.missingCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">مجموع فروش پایه</span>
              <strong>{money(cogsQualitySummary.baseSalesTotal)}</strong>
            </div>
          </div>

          {isLoadingCogsQuality ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال بررسی اسناد فروش...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "فاکتور" },
                { key: "date", label: "تاریخ" },
                { key: "party", label: "مشتری" },
                { key: "total", label: "فروش" },
                { key: "cogsTotal", label: "COGS قابل ثبت" },
              ]}
              rows={cogsQualityRows}
              pagination={cogsQualityPagination}
              onPageChange={(page) => void loadCogsQuality(page)}
              extraActions={[
                {
                  label: "اصلاح همین سند",
                  icon: <ShieldCheck className="size-4" />,
                  onClick: (row) => {
                    setCogsQualityOpen(false);
                    setCogsRepairSale(row);
                  },
                },
              ]}
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCogsQualityOpen(false)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnQualityOpen} onOpenChange={setReturnQualityOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[min(94vw,1100px)]">
          <DialogHeader>
            <DialogTitle>گزارش برگشتی‌های قدیمی مشکوک</DialogTitle>
            <DialogDescription>
              این گزارش فقط برگشتی‌های legacy را نشان می‌دهد که احتمالاً تخفیف عمومی فروش در
              مبلغ‌شان لحاظ نشده است. اصلاح خودکار انجام نمی‌شود؛ هر سند باید جداگانه بررسی و در
              صورت نیاز ابطال و دوباره ثبت شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 border-y border-border py-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">اقلام مشکوک</span>
              <strong>{returnQualitySummary.suspiciousCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">مجموع اختلاف تخمینی</span>
              <strong>{money(returnQualitySummary.discrepancyTotal)}</strong>
            </div>
          </div>

          {isLoadingReturnQuality ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال بررسی برگشتی‌های قدیمی...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "سند برگشت" },
                { key: "invoice", label: "فاکتور فروش" },
                { key: "product", label: "محصول" },
                { key: "date", label: "تاریخ" },
                { key: "actual", label: "مبلغ ثبت‌شده" },
                { key: "expected", label: "مبلغ خالص مورد انتظار" },
                { key: "difference", label: "اختلاف" },
              ]}
              rows={returnQualityRows}
              pagination={returnQualityPagination}
              onPageChange={(page) => void loadReturnQuality(page)}
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnQualityOpen(false)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cogsRepairSale)}
        onOpenChange={(open) => {
          if (!open && !isRepairingCogs) setCogsRepairSale(null);
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تایید اصلاح COGS</DialogTitle>
            <DialogDescription>
              برای فاکتور {String(cogsRepairSale?.name || "-")} سند COGS از قیمت‌های ذخیره‌شده اقلام
              ساخته می‌شود. خود فروش و موجودی تغییر نمی‌کنند.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isRepairingCogs}
              onClick={() => setCogsRepairSale(null)}
            >
              انصراف
            </Button>
            <Button disabled={isRepairingCogs} onClick={() => void confirmCogsRepair()}>
              <ShieldCheck className="size-4" />
              {isRepairingCogs ? "در حال اصلاح..." : "تایید و ثبت سند"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[min(96vw,1280px)]">
          <DialogHeader>
            <DialogTitle>ثبت فروش جدید</DialogTitle>
            <DialogDescription>
              فاکتور فروش چندقلمی با پرداخت نقد/بانک، تخفیف و باقیات مشتری.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="شماره فاکتور"
                value={form.invoiceNo}
                onChange={(value) => setForm((current) => ({ ...current, invoiceNo: value }))}
              />
              <LookupSelect
                label="مشتری"
                value={form.customerId}
                options={customers}
                emptyLabel="مشتری نقدی"
                onChange={(value) => setForm((current) => ({ ...current, customerId: value }))}
              />
              <LookupSelect
                label="کرنسی"
                value={form.currencyId}
                options={currencies.map((item) => ({
                  ...item,
                  name: item.code || item.name,
                }))}
                onChange={changeSaleCurrency}
              />
              <NumberField
                label="تخفیف فاکتور"
                value={form.discount}
                onChange={(value) => setForm((current) => ({ ...current, discount: value }))}
              />
              <NumberField
                label="پرداخت شده"
                value={form.paidAmount}
                onChange={(value) => setForm((current) => ({ ...current, paidAmount: value }))}
              />
              <LookupSelect
                label="حساب دریافت"
                value={form.paymentAccountKey}
                options={paymentAccounts
                  .filter((account) => !form.currencyId || account.currencyId === form.currencyId)
                  .map((account) => ({
                    id: `${account.type}:${account.id}`,
                    name: account.name,
                  }))}
                emptyLabel="بدون پرداخت"
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    paymentAccountKey: value,
                  }))
                }
              />
            </div>

            <InvoiceItemsPanel
              title="اقلام فروش"
              addLabel="افزودن قلم"
              emptyLabel="هنوز قلمی به فاکتور فروش اضافه نشده است"
              unitAmountLabel="قیمت"
              currencyCode={selectedCurrency?.code}
              rows={saleItemRows}
              onAdd={() => openSaleItemDialog()}
              onEdit={(id) => {
                const line = saleLines.find((item) => item.id === id);
                if (line) openSaleItemDialog(line);
              }}
              onDelete={(id) => setSaleLines((current) => current.filter((item) => item.id !== id))}
            />
            {/* Legacy inline item editor is replaced by the table above. */}
            <div className="hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <strong className="text-sm">اقلام فروش</strong>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSaleLines((current) => [
                      ...current,
                      makeSaleLine(products, warehouses, selectedCurrency),
                    ])
                  }
                >
                  <Plus className="size-4" />
                  افزودن قلم
                </Button>
              </div>
              <div className="space-y-3">
                {saleLines.map((line, index) => (
                  <div
                    key={line.id}
                    className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 lg:grid-cols-[1.5fr_1fr_1fr_0.7fr_0.9fr_0.8fr_auto]"
                  >
                    <LookupSelect
                      label={`جنس ${index + 1}`}
                      value={line.productId}
                      options={products}
                      onSearchChange={searchSaleProducts}
                      onChange={(value) => setSaleLineProduct(line.id, value)}
                    />
                    <LookupSelect
                      label="گدام"
                      value={line.warehouseId}
                      options={warehouses}
                      onChange={(value) => updateSaleLine(line.id, { warehouseId: value })}
                    />
                    <LookupSelect
                      label="واحد"
                      value={line.unitId}
                      options={saleUnitOptions(line.productId)}
                      onChange={(value) => updateSaleLine(line.id, { unitId: value })}
                    />
                    <NumberField
                      label="مقدار"
                      value={line.quantity}
                      onChange={(value) => updateSaleLine(line.id, { quantity: value })}
                    />
                    <NumberField
                      label="قیمت"
                      value={line.unitPrice}
                      onChange={(value) => updateSaleLine(line.id, { unitPrice: value })}
                    />
                    <NumberField
                      label="تخفیف قلم"
                      value={line.discount}
                      onChange={(value) => updateSaleLine(line.id, { discount: value })}
                    />
                    <div className="flex items-end">
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        disabled={saleLines.length <= 1}
                        onClick={() =>
                          setSaleLines((current) => current.filter((item) => item.id !== line.id))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <TextField
              label="یادداشت"
              value={form.note}
              onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            />

            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">جمع خام</p>
                <strong>{money(subtotal, selectedCurrency?.code)}</strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قابل پرداخت</p>
                <strong>{money(total, selectedCurrency?.code)}</strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">باقی</p>
                <strong className={remaining > 0 ? "text-amber-300" : "text-emerald-300"}>
                  {money(remaining, selectedCurrency?.code)}
                </strong>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitSale}>ثبت فاکتور فروش</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordDetailsDialog
        open={Boolean(detailsSale)}
        onOpenChange={(open) => {
          if (!open) setDetailsSale(null);
        }}
        title="جزئیات فاکتور فروش"
        record={detailsSale}
      />
      <RecordDetailsDialog
        open={Boolean(detailsSaleReturn)}
        onOpenChange={(open) => {
          if (!open) setDetailsSaleReturn(null);
        }}
        title="جزئیات برگشت فروش"
        record={detailsSaleReturn}
      />
      <Dialog
        open={Boolean(cancelSaleReturn)}
        onOpenChange={(open) => {
          if (!open) setCancelSaleReturn(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال برگشت فروش</DialogTitle>
            <DialogDescription>
              موجودی، صندوق یا بانک، حساب مشتری و ژورنال با سند معکوس اصلاح می‌شود.
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="دلیل ابطال"
            value={cancelSaleReturnReason}
            onChange={setCancelSaleReturnReason}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSaleReturn(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitSaleReturnCancel}>
              ابطال برگشت
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saleItemDialogOpen} onOpenChange={setSaleItemDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[min(196vw,1280px)]">
          <DialogHeader>
            <DialogTitle>{editingSaleLineId ? "ویرایش قلم فروش" : "افزودن قلم فروش"}</DialogTitle>
            <DialogDescription>
              جنس، گدام، واحد، مقدار و قیمت این قلم را جداگانه ثبت کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-3">
            <LookupSelect
              label="جنس"
              value={saleLineDraft.productId}
              options={products}
              onSearchChange={searchSaleProducts}
              onChange={setSaleDraftProduct}
            />
            <LookupSelect
              label="گدام"
              value={saleLineDraft.warehouseId}
              options={warehouses}
              onChange={(value) =>
                setSaleLineDraft((current) => ({
                  ...current,
                  warehouseId: value,
                }))
              }
            />
            <LookupSelect
              label="واحد"
              value={saleLineDraft.unitId}
              options={saleUnitOptions(saleLineDraft.productId)}
              onChange={(value) =>
                setSaleLineDraft((current) => ({
                  ...current,
                  unitId: value,
                  unitPrice: saleUnitPrice(current.productId, value),
                }))
              }
            />
            <NumberField
              label="مقدار"
              value={saleLineDraft.quantity}
              onChange={(value) =>
                setSaleLineDraft((current) => ({
                  ...current,
                  quantity: value,
                }))
              }
            />
            <NumberField
              label="قیمت"
              value={saleLineDraft.unitPrice}
              onChange={(value) =>
                setSaleLineDraft((current) => ({
                  ...current,
                  unitPrice: value,
                }))
              }
            />
            <NumberField
              label="تخفیف قلم"
              value={saleLineDraft.discount}
              onChange={(value) =>
                setSaleLineDraft((current) => ({
                  ...current,
                  discount: value,
                }))
              }
            />
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">جمع قلم</p>
            <strong>
              {money(
                invoiceLineTotal(
                  saleLineDraft.quantity,
                  saleLineDraft.unitPrice,
                  saleLineDraft.discount,
                ),
                selectedCurrency?.code,
              )}
            </strong>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaleItemDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={saveSaleItem}>
              {editingSaleLineId ? "ذخیره تغییرات" : "افزودن به فاکتور"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[max(96vw,1280px)]">
          <DialogHeader>
            <DialogTitle>برگشت فروش</DialogTitle>
            <DialogDescription>
              اقلام برگشتی را وارد کنید؛ سیستم موجودی، صندوق/بانک، حساب مشتری و سند حسابداری را ثبت
              می‌کند.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="فاکتور"
                value={returnSale?.invoiceNo || returnSale?.id || ""}
                onChange={() => undefined}
              />
              <NumberField label="مبلغ برگشت پول" value={refundAmount} onChange={setRefundAmount} />
              <LookupSelect
                label="حساب برگشت پول"
                value={refundAccountKey}
                options={paymentAccounts
                  .filter(
                    (account) =>
                      !returnSale?.currencyId || account.currencyId === returnSale.currencyId,
                  )
                  .map((account) => ({
                    id: `${account.type}:${account.id}`,
                    name: account.name,
                  }))}
                emptyLabel="بدون پرداخت نقدی"
                onChange={setRefundAccountKey}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              {returnSale?.items?.map((item: any) => {
                const line = returnLines.find((candidate) => candidate.itemId === item.id);
                return (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 md:grid-cols-[2fr_1fr_1fr_1fr]"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.product?.name || "-"}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.warehouse?.name || "-"} /{" "}
                        {item.unit?.shortName || item.unit?.name || "-"}
                      </p>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">فروخته شده</span>
                      <strong className="block">{Number(item.quantity || 0)}</strong>
                      {Number(item.returnedQuantity || 0) > 0 && (
                        <span className="text-xs text-muted-foreground">
                          قابل برگشت: {Number(item.returnableQuantity || 0)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">قیمت قلم</span>
                      <strong className="block">{money(item.totalPrice || 0)}</strong>
                    </div>
                    <NumberField
                      label="مقدار برگشت"
                      value={line?.quantity || 0}
                      onChange={(value) =>
                        setReturnLines((current) =>
                          current.map((candidate) =>
                            candidate.itemId === item.id
                              ? {
                                  ...candidate,
                                  quantity: Math.min(
                                    Math.max(0, value),
                                    Number(item.returnableQuantity ?? item.quantity ?? 0),
                                  ),
                                }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>

            <TextField label="یادداشت" value={returnNote} onChange={setReturnNote} />
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">جمع تخمینی برگشت</p>
              <strong>{money(roundedSaleReturnSubtotal)}</strong>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitSaleReturn}>ثبت برگشت فروش</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>پرداخت فاکتور فروش</DialogTitle>
            <DialogDescription>
              پرداخت مرحله‌ای روی فاکتور ثبت می‌شود و طلب مشتری، صندوق/بانک و سند حسابداری همزمان
              اصلاح می‌گردد.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="فاکتور"
              value={paymentSale?.invoiceNo || paymentSale?.id || ""}
              onChange={() => undefined}
            />
            <TextField
              label="مشتری"
              value={paymentSale?.customer?.name || "-"}
              onChange={() => undefined}
            />
            <NumberField
              label="باقی فاکتور"
              value={Number(paymentSale?.remainingAmount || 0)}
              onChange={() => undefined}
            />
            <NumberField
              label="مبلغ پرداخت"
              value={invoicePaymentAmount}
              onChange={setInvoicePaymentAmount}
            />
            <LookupSelect
              label="حساب دریافت"
              value={invoicePaymentAccountKey}
              options={paymentAccounts
                .filter(
                  (account) =>
                    !paymentSale?.currencyId || account.currencyId === paymentSale.currencyId,
                )
                .map((account) => ({
                  id: `${account.type}:${account.id}`,
                  name: account.name,
                }))}
              onChange={setInvoicePaymentAccountKey}
            />
            <TextField
              label="یادداشت"
              value={invoicePaymentNote}
              onChange={setInvoicePaymentNote}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitSalePayment}>ثبت پرداخت</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(duplicateSale)}
        onOpenChange={(open) => {
          if (!open && !isDuplicatingSale) setDuplicateSale(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>دوپلیکیت فاکتور فروش</DialogTitle>
            <DialogDescription>
              یک نسخه جدید از این فروش در مودال ثبت فروش آماده می‌شود. تا وقتی ثبت فاکتور را نزنید،
              موجودی، صندوق/بانک و حسابداری تغییر نمی‌کند.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <TextField
              label="فاکتور مبدا"
              value={String(duplicateSale?.name || "")}
              onChange={() => undefined}
            />
            <TextField
              label="مشتری"
              value={String(duplicateSale?.party || "")}
              onChange={() => undefined}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDuplicateSale(null)}
              disabled={isDuplicatingSale}
            >
              لغو
            </Button>
            <Button onClick={submitSaleDuplicate} disabled={isDuplicatingSale}>
              {isDuplicatingSale ? "در حال آماده‌سازی..." : "آماده‌سازی نسخه جدید"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelSale)}
        onOpenChange={(open) => {
          if (!open) setCancelSale(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال فاکتور فروش</DialogTitle>
            <DialogDescription>
              با ابطال، موجودی برگشت می‌خورد، دریافت‌های صندوق/بانک معکوس می‌شود و حساب مشتری/ژورنال
              اثر معکوس می‌گیرد. این عملیات حذف ساده نیست.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <TextField
              label="فاکتور"
              value={cancelSale?.invoiceNo || cancelSale?.id || ""}
              onChange={() => undefined}
            />
            <TextField label="دلیل ابطال" value={cancelReason} onChange={setCancelReason} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSale(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitSaleCancel}>
              ابطال فروش
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PurchasesPage() {
  const initialPurchasesRange = recentDateRange();
  const [purchases, setPurchases] = useState<DataRow[]>([]);
  const [purchasesSummary, setPurchasesSummary] = useState({
    count: 0,
    total: 0,
    paid: 0,
    remaining: 0,
  });
  const [purchasesPagination, setPurchasesPagination] = useState<any>(null);
  const [purchaseReturns, setPurchaseReturns] = useState<DataRow[]>([]);
  const [purchaseReturnsPagination, setPurchaseReturnsPagination] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<LookupItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productCategories, setProductCategories] = useState<LookupItem[]>([]);
  const [productUnits, setProductUnits] = useState<LookupItem[]>([]);
  const [warehouses, setWarehouses] = useState<LookupItem[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(initialPurchasesRange.from);
  const [to, setTo] = useState(initialPurchasesRange.to);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PurchaseFormState>(emptyPurchaseForm);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLineForm[]>([]);
  const [purchaseItemDialogOpen, setPurchaseItemDialogOpen] = useState(false);
  const [editingPurchaseLineId, setEditingPurchaseLineId] = useState<string | null>(null);
  const [purchaseLineDraft, setPurchaseLineDraft] =
    useState<PurchaseLineForm>(emptyPurchaseLineDraft);
  const [purchaseProductSearchText, setPurchaseProductSearchText] = useState("");
  const [quickProductDialogOpen, setQuickProductDialogOpen] = useState(false);
  const [quickProductForm, setQuickProductForm] = useState<ProductFormState>(emptyProductForm);
  const [quickProductUnitLines, setQuickProductUnitLines] = useState<ProductUnitForm[]>([]);
  const [isSavingQuickProduct, setIsSavingQuickProduct] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnPurchase, setReturnPurchase] = useState<any | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineForm[]>([]);
  const [receiveAccountKey, setReceiveAccountKey] = useState("");
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [returnNote, setReturnNote] = useState("");
  const [detailsPurchase, setDetailsPurchase] = useState<any | null>(null);
  const [cancelPurchase, setCancelPurchase] = useState<any | null>(null);
  const [cancelPurchaseReason, setCancelPurchaseReason] = useState("");
  const [detailsPurchaseReturn, setDetailsPurchaseReturn] = useState<any | null>(null);
  const [cancelPurchaseReturn, setCancelPurchaseReturn] = useState<any | null>(null);
  const [cancelPurchaseReturnReason, setCancelPurchaseReturnReason] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentPurchase, setPaymentPurchase] = useState<any | null>(null);
  const [invoicePaymentAmount, setInvoicePaymentAmount] = useState(0);
  const [invoicePaymentAccountKey, setInvoicePaymentAccountKey] = useState("");
  const [invoicePaymentNote, setInvoicePaymentNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const purchaseProductSearchSeqRef = useRef(0);
  const purchaseProductSearchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => purchaseProductSearchAbortRef.current?.abort(), []);

  const loadPurchasesData = async (
    page = purchasesPagination?.page || 1,
    returnsPage = purchaseReturnsPagination?.page || 1,
  ) => {
    setIsLoading(true);
    try {
      const purchasesParams = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      const returnsParams = new URLSearchParams({
        page: String(returnsPage),
        limit: "20",
      });
      for (const [key, value] of new URLSearchParams(dateRangeQuery(from, to))) {
        purchasesParams.set(key, value);
        returnsParams.set(key, value);
      }
      if (query.trim()) {
        purchasesParams.set("search", query.trim());
        returnsParams.set("search", query.trim());
      }
      const [
        purchasesRes,
        purchaseReturnsRes,
        suppliersRes,
        productsRes,
        categoryRes,
        unitRes,
        warehousesRes,
        currenciesRes,
        cashRes,
        bankRes,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/api/purchases?${purchasesParams.toString()}`).then((res) =>
          res.json(),
        ),
        fetch(`${API_BASE_URL}/api/purchase-returns?${returnsParams.toString()}`).then((res) =>
          res.json(),
        ),
        fetch(`${API_BASE_URL}/api/parties?type=SUPPLIER`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/products/lookup?limit=50`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/product-categories`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/units`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/warehouses`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/currencies`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/cash-registers`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/bank-accounts`).then((res) => res.json()),
      ]);

      setPurchases(
        Array.isArray(purchasesRes?.data)
          ? purchasesRes.data.map((item: unknown) => normalizeRow(item, "خریداری"))
          : [],
      );
      setPurchasesSummary(purchasesRes?.summary || { count: 0, total: 0, paid: 0, remaining: 0 });
      setPurchasesPagination(purchasesRes?.pagination || null);
      setPurchaseReturns(
        Array.isArray(purchaseReturnsRes?.data)
          ? purchaseReturnsRes.data.map((item: any) => ({
              ...item,
              number: item.returnNo,
              invoice: item.purchase?.invoiceNo,
              party: item.supplier?.name,
              total: money(item.subtotal, item.currency),
              settled: money(item.receivedAmount, item.currency),
            }))
          : [],
      );
      setPurchaseReturnsPagination(purchaseReturnsRes?.pagination || null);
      setSuppliers(Array.isArray(suppliersRes?.data) ? suppliersRes.data : []);
      setProducts(Array.isArray(productsRes?.data) ? productsRes.data : []);
      setProductCategories(Array.isArray(categoryRes?.data) ? categoryRes.data : []);
      setProductUnits(Array.isArray(unitRes?.data) ? unitRes.data : []);
      setWarehouses(Array.isArray(warehousesRes?.data) ? warehousesRes.data : []);
      setCurrencies(Array.isArray(currenciesRes?.data) ? currenciesRes.data : []);

      const cashAccounts: PaymentAccountOption[] = Array.isArray(cashRes?.data)
        ? cashRes.data.flatMap((register: any) =>
            Array.isArray(register.accounts)
              ? register.accounts.map((account: any) => ({
                  id: account.id,
                  type: "CASH" as const,
                  currencyId: account.currencyId,
                  name: `${register.name} / ${account.currency?.code || ""}`,
                }))
              : [],
          )
        : [];
      const bankAccounts: PaymentAccountOption[] = Array.isArray(bankRes?.data)
        ? bankRes.data.map((account: any) => ({
            id: account.id,
            type: "BANK" as const,
            currencyId: account.currencyId,
            name: `${account.name} / ${account.currency?.code || ""}`,
          }))
        : [];

      setPaymentAccounts([...cashAccounts, ...bankAccounts]);
    } catch {
      toast.error("داده خریداری از API خوانده نشد");
      setPurchases([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPurchasesData();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPurchasesData(1, 1), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const searchPurchaseProducts = async (value: string) => {
    const query = value.trim();
    setPurchaseProductSearchText(query);
    const requestSeq = purchaseProductSearchSeqRef.current + 1;
    purchaseProductSearchSeqRef.current = requestSeq;
    purchaseProductSearchAbortRef.current?.abort();

    const abortController = new AbortController();
    purchaseProductSearchAbortRef.current = abortController;

    try {
      const rows = await searchProductLookupOptions(query, abortController.signal);
      if (requestSeq !== purchaseProductSearchSeqRef.current) return;
      setProducts((current) =>
        replaceLookupOptionsKeepingSelected(
          current,
          rows,
          purchaseLines.map((line) => line.productId),
        ),
      );
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      // Product lookup search is best-effort; form submission still validates.
    } finally {
      if (purchaseProductSearchAbortRef.current === abortController) {
        purchaseProductSearchAbortRef.current = null;
      }
    }
  };

  const openQuickProductDialog = () => {
    const searchText = purchaseProductSearchText.trim();
    const barcodeCandidate = searchText.replace(/[\s-]/g, "");
    const isBarcodeLike = barcodeCandidate.length >= 5 && /^[0-9]+$/.test(barcodeCandidate);
    const baseUnitId = productUnits[0]?.id || "";

    setQuickProductForm({
      ...emptyProductForm,
      name: isBarcodeLike ? "" : searchText,
      barcode: isBarcodeLike ? searchText : "",
      baseUnitId,
      defaultWarehouseId:
        warehouses.find((item: any) => item.isDefault)?.id || warehouses[0]?.id || "",
      purchasePrice: purchaseLineDraft.unitCost || 0,
      salePrice: purchaseLineDraft.salePrice || 0,
      openingCurrencyId: form.currencyId,
    });
    setQuickProductUnitLines([
      makeProductUnitLine(productUnits, {
        unitId: baseUnitId,
        conversionRate: 1,
        purchasePrice: purchaseLineDraft.unitCost || 0,
        salePrice: purchaseLineDraft.salePrice || 0,
        isDefaultPurchase: true,
        isDefaultSale: true,
      }),
    ]);
    setQuickProductDialogOpen(true);
  };

  const syncQuickProductUnitPrices = (
    lines: ProductUnitForm[],
    baseUnitId: string,
    patch: Partial<Pick<ProductUnitForm, "purchasePrice" | "salePrice">>,
  ) => {
    const currentBase = lines.find((line) => line.unitId === baseUnitId);
    const basePurchasePrice = patch.purchasePrice ?? currentBase?.purchasePrice ?? 0;
    const baseSalePrice = patch.salePrice ?? currentBase?.salePrice ?? 0;

    return lines.map((line) => {
      const conversionRate = line.unitId === baseUnitId ? 1 : line.conversionRate;

      return {
        ...line,
        conversionRate,
        purchasePrice:
          patch.purchasePrice !== undefined || line.unitId !== baseUnitId
            ? Number((basePurchasePrice * conversionRate).toFixed(4))
            : line.purchasePrice,
        salePrice:
          patch.salePrice !== undefined || line.unitId !== baseUnitId
            ? Number((baseSalePrice * conversionRate).toFixed(4))
            : line.salePrice,
      };
    });
  };

  const saveQuickPurchaseProduct = async () => {
    if (!quickProductForm.name.trim() || !quickProductForm.baseUnitId) {
      toast.error("نام کالا و واحد پایه ضروری است");
      return;
    }

    const validUnitLines = quickProductUnitLines.filter(
      (line) => line.unitId && line.conversionRate > 0,
    );
    const uniqueUnitIds = new Set(validUnitLines.map((line) => line.unitId));

    if (validUnitLines.length === 0) {
      toast.error("حداقل یک واحد خرید/فروش برای جنس ضروری است");
      return;
    }

    if (uniqueUnitIds.size !== validUnitLines.length) {
      toast.error("واحد تکراری برای یک جنس قابل ثبت نیست");
      return;
    }

    if (!validUnitLines.some((line) => line.unitId === quickProductForm.baseUnitId)) {
      toast.error("واحد پایه باید در لیست واحدات جنس هم ثبت شود");
      return;
    }

    const normalizedUnitLines = validUnitLines.map((line, index) => ({
      ...line,
      conversionRate: line.unitId === quickProductForm.baseUnitId ? 1 : line.conversionRate,
      isDefaultPurchase: validUnitLines.some((item) => item.isDefaultPurchase)
        ? line.isDefaultPurchase
        : index === 0,
      isDefaultSale: validUnitLines.some((item) => item.isDefaultSale)
        ? line.isDefaultSale
        : index === 0,
    }));

    setIsSavingQuickProduct(true);
    try {
      const payload = {
        name: quickProductForm.name.trim(),
        sku: quickProductForm.sku.trim() || null,
        barcode: quickProductForm.barcode.trim() || null,
        description: quickProductForm.description.trim() || null,
        imageUrl: quickProductForm.imageUrl || null,
        categoryId: quickProductForm.categoryId || null,
        baseUnitId: quickProductForm.baseUnitId,
        defaultWarehouseId: quickProductForm.defaultWarehouseId || null,
        hasExpiry: quickProductForm.hasExpiry,
        minStock: quickProductForm.minStock,
        units: normalizedUnitLines.map((line) => ({
          unitId: line.unitId,
          conversionRate: line.conversionRate,
          purchasePrice: line.purchasePrice || null,
          salePrice: line.salePrice || null,
          isDefaultPurchase: line.isDefaultPurchase,
          isDefaultSale: line.isDefaultSale,
        })),
      };

      const res = await fetch(`${API_BASE_URL}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت محصول ناکام شد");
      }

      const product = json?.data;
      if (!product?.id) {
        throw new Error("محصول ثبت شد، اما پاسخ API کامل نبود");
      }

      setProducts((current) => mergeById([product], current));
      setQuickProductDialogOpen(false);
      setPurchaseProductSearchText("");
      const purchaseUnit =
        product?.units?.find((unit: any) => unit.isDefaultPurchase) || product?.units?.[0];
      setPurchaseLineDraft((current) => ({
        ...current,
        productId: product.id,
        unitId: purchaseUnit?.unitId || product.baseUnitId || "",
        unitCost: selectedCurrency
          ? basePriceInCurrency(Number(purchaseUnit?.purchasePrice || 0), selectedCurrency)
          : Number(purchaseUnit?.purchasePrice || 0),
        salePrice: selectedCurrency
          ? basePriceInCurrency(Number(purchaseUnit?.salePrice || 0), selectedCurrency)
          : Number(purchaseUnit?.salePrice || 0),
        updateSalePrice: true,
        expiryDate: product.hasExpiry ? current.expiryDate : "",
      }));
      toast.success("محصول جدید ثبت و به لیست خرید اضافه شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت محصول جدید ناکام شد");
    } finally {
      setIsSavingQuickProduct(false);
    }
  };

  const selectedCurrency = currencies.find((currency) => currency.id === form.currencyId);
  const subtotal = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const total = Math.max(0, subtotal - form.discount);
  const remaining = Math.max(0, total - form.paidAmount);

  const openCreate = () => {
    const baseCurrency = currencies.find((item) => item.isBase) || currencies[0];
    const product = products[0];
    const unitId =
      product?.units?.find((unit: any) => unit.isDefaultPurchase)?.unitId ||
      product?.baseUnitId ||
      "";
    const defaultPayment = paymentAccounts.find(
      (account) => account.currencyId === baseCurrency?.id,
    );

    setForm({
      ...emptyPurchaseForm,
      invoiceNo: `PO-${Date.now()}`,
      supplierId: suppliers[0]?.id || "",
      currencyId: baseCurrency?.id || "",
      paymentAccountKey: defaultPayment ? `${defaultPayment.type}:${defaultPayment.id}` : "",
      productId: product?.id || "",
      warehouseId: warehouses[0]?.id || "",
      unitId,
    });
    setPurchaseLines([]);
    setEditingPurchaseLineId(null);
    setPurchaseLineDraft(emptyPurchaseLineDraft);
    setPurchaseItemDialogOpen(false);
    setDialogOpen(true);
  };

  const purchaseUnitCost = (productId: string, unitId: string) => {
    const product = products.find((item) => item.id === productId);
    const unit = product?.units?.find((item: any) => item.unitId === unitId);
    return basePriceInCurrency(Number(unit?.purchasePrice || 0), selectedCurrency);
  };

  const purchaseSalePrice = (productId: string, unitId: string) => {
    const product = products.find((item) => item.id === productId);
    const unit = product?.units?.find((item: any) => item.unitId === unitId);
    return basePriceInCurrency(Number(unit?.salePrice || 0), selectedCurrency);
  };

  const changePurchaseCurrency = (currencyId: string) => {
    const nextCurrency = currencies.find((item) => item.id === currencyId);
    const convert = (value: number) => convertCurrencyAmount(value, selectedCurrency, nextCurrency);

    setForm((current) => ({
      ...current,
      currencyId,
      paymentAccountKey: "",
      discount: convert(current.discount),
      paidAmount: convert(current.paidAmount),
    }));
    setPurchaseLines((current) =>
      current.map((line) => ({
        ...line,
        unitCost: convert(line.unitCost),
        salePrice: convert(line.salePrice),
      })),
    );
    setPurchaseLineDraft((current) => ({
      ...current,
      unitCost: convert(current.unitCost),
      salePrice: convert(current.salePrice),
    }));
  };

  const updatePurchaseLine = (lineId: string, patch: Partial<PurchaseLineForm>) => {
    setPurchaseLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, ...patch };
        if (patch.unitId && patch.unitId !== line.unitId && patch.unitCost === undefined) {
          next.unitCost = purchaseUnitCost(next.productId, patch.unitId);
          next.salePrice = purchaseSalePrice(next.productId, patch.unitId);
        }
        return next;
      }),
    );
  };

  const setPurchaseLineProduct = (lineId: string, productId: string) => {
    const product = products.find((item) => item.id === productId);
    const purchaseUnit =
      product?.units?.find((unit: any) => unit.isDefaultPurchase) || product?.units?.[0];

    updatePurchaseLine(lineId, {
      productId,
      unitId: purchaseUnit?.unitId || product?.baseUnitId || "",
      unitCost: basePriceInCurrency(Number(purchaseUnit?.purchasePrice || 0), selectedCurrency),
      salePrice: basePriceInCurrency(Number(purchaseUnit?.salePrice || 0), selectedCurrency),
    });
  };

  const openPurchaseItemDialog = (line?: PurchaseLineForm) => {
    setEditingPurchaseLineId(line?.id || null);
    setPurchaseLineDraft(line || makePurchaseLine(products, warehouses, selectedCurrency));
    setPurchaseItemDialogOpen(true);
  };

  const setPurchaseDraftProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    const purchaseUnit =
      product?.units?.find((unit: any) => unit.isDefaultPurchase) || product?.units?.[0];

    setPurchaseLineDraft((current) => ({
      ...current,
      productId,
      unitId: purchaseUnit?.unitId || product?.baseUnitId || "",
      unitCost: basePriceInCurrency(Number(purchaseUnit?.purchasePrice || 0), selectedCurrency),
      salePrice: basePriceInCurrency(Number(purchaseUnit?.salePrice || 0), selectedCurrency),
      updateSalePrice: false,
      expiryDate: product?.hasExpiry ? current.expiryDate : "",
    }));
  };

  const savePurchaseItem = () => {
    if (
      !purchaseLineDraft.productId ||
      !purchaseLineDraft.warehouseId ||
      !purchaseLineDraft.unitId ||
      purchaseLineDraft.quantity <= 0 ||
      purchaseLineDraft.unitCost < 0
    ) {
      toast.error("همه معلومات قلم خرید را درست وارد کنید");
      return;
    }

    setPurchaseLines((current) =>
      editingPurchaseLineId
        ? current.map((line) => (line.id === editingPurchaseLineId ? purchaseLineDraft : line))
        : [...current, { ...purchaseLineDraft, id: createClientId() }],
    );
    setPurchaseItemDialogOpen(false);
  };

  const productUnitOptions = (productId: string) => {
    const product = products.find((item) => item.id === productId);

    if (!product) return [];

    return [
      ...(product.baseUnit
        ? [
            {
              id: product.baseUnitId,
              name: product.baseUnit.name,
              shortName: product.baseUnit.shortName,
            },
          ]
        : []),
      ...(Array.isArray(product.units)
        ? product.units.map((unit: any) => ({
            id: unit.unitId,
            name: unit.unit?.name || unit.unitId,
            shortName: unit.unit?.shortName,
          }))
        : []),
    ].filter(
      (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
    );
  };

  let remainingPurchaseDiscount = form.discount;
  const purchaseItemRows: InvoiceItemRow[] = purchaseLines.map((line, index) => {
    const grossTotal = invoiceLineTotal(line.quantity, line.unitCost);
    const generalDiscount =
      index === purchaseLines.length - 1
        ? remainingPurchaseDiscount
        : subtotal > 0
          ? Number(((grossTotal / subtotal) * form.discount).toFixed(4))
          : 0;
    remainingPurchaseDiscount = Number((remainingPurchaseDiscount - generalDiscount).toFixed(4));
    const unitInfo = productUnitInfo(products, line.productId, line.unitId);

    return {
      id: line.id,
      product: productLabel(products, line.productId),
      warehouse: lookupLabel(warehouses, line.warehouseId),
      unit: lookupLabel(productUnitOptions(line.productId), line.unitId),
      quantity: line.quantity,
      unitAmount: line.unitCost,
      generalDiscount,
      netTotal: Math.max(0, grossTotal - generalDiscount),
      baseQuantity: line.quantity * unitInfo.conversionRate,
      baseUnit: unitInfo.baseUnitName,
      baseUnitAmount:
        line.quantity * unitInfo.conversionRate > 0
          ? Math.max(0, grossTotal - generalDiscount) / (line.quantity * unitInfo.conversionRate)
          : 0,
      salePrice: line.salePrice,
      baseSalePrice:
        unitInfo.conversionRate > 0 ? line.salePrice / unitInfo.conversionRate : line.salePrice,
      salePriceUpdate: line.updateSalePrice,
      expiryDate: line.expiryDate || "-",
      total: grossTotal,
    };
  });
  const purchaseDraftUnitInfo = productUnitInfo(
    products,
    purchaseLineDraft.productId,
    purchaseLineDraft.unitId,
  );
  const purchaseDraftBaseQuantity =
    purchaseLineDraft.quantity * purchaseDraftUnitInfo.conversionRate;
  const purchaseDraftGrossTotal = invoiceLineTotal(
    purchaseLineDraft.quantity,
    purchaseLineDraft.unitCost,
  );
  const purchaseDraftSubtotal = subtotal + purchaseDraftGrossTotal;
  const purchaseDraftGeneralDiscount =
    purchaseDraftSubtotal > 0
      ? Number(((purchaseDraftGrossTotal / purchaseDraftSubtotal) * form.discount).toFixed(4))
      : 0;
  const purchaseDraftBaseUnitCost =
    purchaseDraftUnitInfo.conversionRate > 0
      ? purchaseLineDraft.unitCost / purchaseDraftUnitInfo.conversionRate
      : purchaseLineDraft.unitCost;
  const purchaseDraftNetBaseUnitCost =
    purchaseDraftBaseQuantity > 0
      ? Math.max(0, purchaseDraftGrossTotal - purchaseDraftGeneralDiscount) /
        purchaseDraftBaseQuantity
      : 0;

  const submitPurchase = async () => {
    if (!form.currencyId || purchaseLines.length === 0) {
      toast.error("کرنسی و حداقل یک قلم خرید ضروری است");
      return;
    }

    const invalidLine = purchaseLines.find(
      (line) =>
        !line.productId ||
        !line.warehouseId ||
        !line.unitId ||
        line.quantity <= 0 ||
        line.unitCost < 0,
    );

    if (invalidLine) {
      toast.error("همه اقلام باید جنس، گدام، واحد، مقدار و قیمت معتبر داشته باشند");
      return;
    }

    if (remaining > 0 && !form.supplierId) {
      toast.error("برای خرید باقی‌دار، فروشنده ضروری است");
      return;
    }

    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === form.paymentAccountKey,
    );

    if (form.paidAmount > 0 && !paymentAccount) {
      toast.error("برای پرداخت، حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo: form.invoiceNo || null,
          supplierId: form.supplierId || null,
          currencyId: form.currencyId,
          discount: form.discount,
          paidAmount: form.paidAmount,
          paymentAccountType: paymentAccount?.type || null,
          paymentAccountId: paymentAccount?.id || null,
          note: form.note || null,
          items: purchaseLines.map((line) => ({
            productId: line.productId,
            warehouseId: line.warehouseId,
            unitId: line.unitId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            updateSalePrice: line.updateSalePrice,
            salePrice: line.updateSalePrice ? line.salePrice : null,
            expiryDate: productHasExpiry(products, line.productId) ? line.expiryDate || null : null,
          })),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت خرید ناکام شد");
      }

      toast.success("فاکتور خرید ثبت شد و موجودی وارد گدام شد");
      setDialogOpen(false);
      await loadPurchasesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت خرید ناکام شد");
    }
  };

  const openPurchaseDetails = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن جزئیات خرید ناکام شد");
      }

      setDetailsPurchase(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن جزئیات خرید ناکام شد");
    }
  };

  const openPurchaseReturn = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور خرید ناکام شد");
      }

      const purchase = json.data;
      const account = paymentAccounts.find((item) => item.currencyId === purchase.currencyId);

      setReturnPurchase(purchase);
      setReturnLines(
        Array.isArray(purchase.items)
          ? purchase.items.map((item: any) => ({
              itemId: item.id,
              quantity: 0,
            }))
          : [],
      );
      setReceiveAccountKey(account ? `${account.type}:${account.id}` : "");
      setReceivedAmount(0);
      setReturnNote("");
      setReturnDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور خرید ناکام شد");
    }
  };

  const openPurchasePayment = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور خرید ناکام شد");
      }

      const purchase = json.data;
      const account = paymentAccounts.find((item) => item.currencyId === purchase.currencyId);

      setPaymentPurchase(purchase);
      setInvoicePaymentAmount(Number(purchase.remainingAmount || 0));
      setInvoicePaymentAccountKey(account ? `${account.type}:${account.id}` : "");
      setInvoicePaymentNote("");
      setPaymentDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور خرید ناکام شد");
    }
  };

  const openPurchaseCancel = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${row.id}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن فاکتور خرید ناکام شد");
      }

      setCancelPurchase(json.data);
      setCancelPurchaseReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن فاکتور خرید ناکام شد");
    }
  };

  const submitPurchaseCancel = async () => {
    if (!cancelPurchase) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${cancelPurchase.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelPurchaseReason || null }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال خرید ناکام شد");
      }

      toast.success("فاکتور خرید با اثر معکوس باطل شد");
      setCancelPurchase(null);
      await loadPurchasesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال خرید ناکام شد");
    }
  };

  const submitPurchaseReturnCancel = async () => {
    if (!cancelPurchaseReturn || !cancelPurchaseReturnReason.trim()) {
      toast.error("دلیل ابطال ضروری است");
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/purchase-returns/${cancelPurchaseReturn.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: cancelPurchaseReturnReason }),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || "ابطال برگشت خرید ناکام شد");
      toast.success("برگشت خرید با سند معکوس باطل شد");
      setCancelPurchaseReturn(null);
      await loadPurchasesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال برگشت خرید ناکام شد");
    }
  };

  const submitPurchasePayment = async () => {
    if (!paymentPurchase) return;

    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === invoicePaymentAccountKey,
    );

    if (invoicePaymentAmount <= 0) {
      toast.error("مبلغ پرداخت باید بیشتر از صفر باشد");
      return;
    }

    if (!paymentAccount) {
      toast.error("حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/purchases/${paymentPurchase.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: invoicePaymentAmount,
          paymentAccountType: paymentAccount.type,
          paymentAccountId: paymentAccount.id,
          note: invoicePaymentNote || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت پرداخت خرید ناکام شد");
      }

      toast.success("پرداخت فاکتور خرید ثبت شد");
      setPaymentDialogOpen(false);
      await loadPurchasesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت پرداخت خرید ناکام شد");
    }
  };

  const purchaseReturnSubtotal = returnLines.reduce((sum, line) => {
    const item = returnPurchase?.items?.find((candidate: any) => candidate.id === line.itemId);
    if (!item || Number(item.quantity || 0) <= 0) return sum;
    return sum + (Number(item.totalCost || 0) / Number(item.quantity || 1)) * line.quantity;
  }, 0);

  const submitPurchaseReturn = async () => {
    if (!returnPurchase) return;

    const selectedItems = returnLines.filter((line) => line.quantity > 0);
    const paymentAccount = paymentAccounts.find(
      (account) => `${account.type}:${account.id}` === receiveAccountKey,
    );

    if (selectedItems.length === 0) {
      toast.error("حداقل یک قلم برای برگشت انتخاب کنید");
      return;
    }

    const effectiveReceivedAmount = returnPurchase.supplierId
      ? receivedAmount
      : purchaseReturnSubtotal;

    if (effectiveReceivedAmount > 0 && !paymentAccount) {
      toast.error("برای دریافت پول، حساب صندوق یا بانک را انتخاب کنید");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/purchase-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseId: returnPurchase.id,
          receiveAccountType: paymentAccount?.type || null,
          receiveAccountId: paymentAccount?.id || null,
          receivedAmount: effectiveReceivedAmount,
          note: returnNote || null,
          items: selectedItems.map((line) => ({
            purchaseItemId: line.itemId,
            quantity: line.quantity,
          })),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت برگشت خرید ناکام شد");
      }

      toast.success("برگشت خرید ثبت شد");
      setReturnDialogOpen(false);
      await loadPurchasesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت برگشت خرید ناکام شد");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="فاکتورهای خرید"
          value={new Intl.NumberFormat("en-US").format(purchasesSummary.count)}
          icon={<Truck />}
        />
        <MetricCard
          label="مجموع خرید دوره"
          value={money(purchasesSummary.total)}
          icon={<CreditCard />}
        />
        <MetricCard
          label="پرداخت‌شده دوره"
          value={money(purchasesSummary.paid)}
          icon={<CreditCard />}
        />
        <MetricCard
          label="باقیات خرید دوره"
          value={money(purchasesSummary.remaining)}
          icon={<CreditCard />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-5 text-primary" />
              خریداری
            </CardTitle>
            <CardDescription>
              ثبت فاکتور خرید، ورود خودکار موجودی، پرداخت نقد/بانک و باقیات فروشنده.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} className="w-40" />
            <DatePicker value={to} onChange={setTo} className="w-40" />
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی فاکتور یا فروشنده..."
                className="w-72 ps-9"
              />
            </div>
            <Button variant="outline" onClick={() => void loadPurchasesData(1, 1)}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              خرید جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن خریدها...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "فاکتور" },
                { key: "supplier", label: "فروشنده" },
                { key: "total", label: "مجموع" },
                { key: "paid", label: "پرداخت" },
                { key: "status", label: "وضعیت" },
              ]}
              rows={purchases}
              pagination={purchasesPagination}
              onPageChange={(page) => void loadPurchasesData(page)}
              onDetails={openPurchaseDetails}
              onEdit={openPurchaseReturn}
              editLabel="برگشت"
              onSecondary={openPurchasePayment}
              onDelete={openPurchaseCancel}
              secondaryLabel="پرداخت"
            />
          )}
        </CardContent>
      </Card>

      <ReturnDocumentsCard
        title="اسناد برگشت خرید"
        description="برگشت‌های ثبت‌شده به فروشنده با جزئیات و امکان ابطال امن."
        rows={purchaseReturns}
        onRefresh={() => void loadPurchasesData()}
        pagination={purchaseReturnsPagination}
        onPageChange={(page) => void loadPurchasesData(purchasesPagination?.page || 1, page)}
        onDetails={setDetailsPurchaseReturn}
        onCancel={(row) => {
          setCancelPurchaseReturn(row);
          setCancelPurchaseReturnReason("");
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} disablePointerDismissal>
        <DialogContent dir="rtl" className="sm:max-w-[min(196vw,1280px)]">
          <DialogHeader>
            <DialogTitle>ثبت خرید جدید</DialogTitle>
            <DialogDescription>
              فاکتور چندقلمی با ورود خودکار موجودی، پرداخت نقد/بانک و باقیات فروشنده.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="شماره فاکتور"
                value={form.invoiceNo}
                onChange={(value) => setForm((current) => ({ ...current, invoiceNo: value }))}
              />
              <LookupSelect
                label="فروشنده"
                value={form.supplierId}
                options={suppliers}
                emptyLabel="خرید نقدی / بدون فروشنده"
                onChange={(value) => setForm((current) => ({ ...current, supplierId: value }))}
              />
              <LookupSelect
                label="کرنسی"
                value={form.currencyId}
                options={currencies.map((item) => ({
                  ...item,
                  name: item.code || item.name,
                }))}
                onChange={changePurchaseCurrency}
              />
              <NumberField
                label="تخفیف فاکتور"
                value={form.discount}
                onChange={(value) => setForm((current) => ({ ...current, discount: value }))}
              />
              <NumberField
                label="پرداخت شده"
                value={form.paidAmount}
                onChange={(value) => setForm((current) => ({ ...current, paidAmount: value }))}
              />
              <LookupSelect
                label="حساب پرداخت"
                value={form.paymentAccountKey}
                options={paymentAccounts
                  .filter((account) => !form.currencyId || account.currencyId === form.currencyId)
                  .map((account) => ({
                    id: `${account.type}:${account.id}`,
                    name: account.name,
                  }))}
                emptyLabel="بدون پرداخت"
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    paymentAccountKey: value,
                  }))
                }
              />
            </div>

            <InvoiceItemsPanel
              title="اقلام خرید"
              addLabel="افزودن قلم"
              emptyLabel="هنوز قلمی به فاکتور خرید اضافه نشده است"
              unitAmountLabel="قیمت"
              currencyCode={selectedCurrency?.code}
              rows={purchaseItemRows}
              onAdd={() => openPurchaseItemDialog()}
              onEdit={(id) => {
                const line = purchaseLines.find((item) => item.id === id);
                if (line) openPurchaseItemDialog(line);
              }}
              onDelete={(id) =>
                setPurchaseLines((current) => current.filter((item) => item.id !== id))
              }
            />
            {/* Legacy inline item editor is replaced by the table above. */}
            <div className="hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <strong className="text-sm">اقلام خرید</strong>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPurchaseLines((current) => [
                      ...current,
                      makePurchaseLine(products, warehouses, selectedCurrency),
                    ])
                  }
                >
                  <Plus className="size-4" />
                  افزودن قلم
                </Button>
              </div>

              <div className="space-y-3">
                {purchaseLines.map((line, index) => (
                  <div
                    key={line.id}
                    className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 lg:grid-cols-[1.5fr_1fr_1fr_0.7fr_0.9fr_1fr_auto]"
                  >
                    <LookupSelect
                      label={`جنس ${index + 1}`}
                      value={line.productId}
                      options={products}
                      onSearchChange={searchPurchaseProducts}
                      onChange={(value) => setPurchaseLineProduct(line.id, value)}
                    />
                    <LookupSelect
                      label="گدام"
                      value={line.warehouseId}
                      options={warehouses}
                      onChange={(value) => updatePurchaseLine(line.id, { warehouseId: value })}
                    />
                    <LookupSelect
                      label="واحد"
                      value={line.unitId}
                      options={productUnitOptions(line.productId)}
                      onChange={(value) => updatePurchaseLine(line.id, { unitId: value })}
                    />
                    <NumberField
                      label="مقدار"
                      value={line.quantity}
                      onChange={(value) => updatePurchaseLine(line.id, { quantity: value })}
                    />
                    <NumberField
                      label="قیمت"
                      value={line.unitCost}
                      onChange={(value) => updatePurchaseLine(line.id, { unitCost: value })}
                    />
                    <TextField
                      label="انقضا"
                      type="date"
                      value={line.expiryDate}
                      onChange={(value) => updatePurchaseLine(line.id, { expiryDate: value })}
                    />
                    <div className="flex items-end">
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        disabled={purchaseLines.length <= 1}
                        onClick={() =>
                          setPurchaseLines((current) =>
                            current.filter((item) => item.id !== line.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <TextField
              label="یادداشت"
              value={form.note}
              onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            />

            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">جمع خام</p>
                <strong>{money(subtotal, selectedCurrency?.code)}</strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قابل پرداخت</p>
                <strong>{money(total, selectedCurrency?.code)}</strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">باقی</p>
                <strong className={remaining > 0 ? "text-amber-300" : "text-emerald-300"}>
                  {money(remaining, selectedCurrency?.code)}
                </strong>
              </div>
              <div className="text-xs text-muted-foreground md:col-span-3">
                {selectedCurrency
                  ? `کرنسی: ${selectedCurrency.code || selectedCurrency.name}`
                  : "کرنسی انتخاب نشده است"}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitPurchase}>ثبت فاکتور خرید</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordDetailsDialog
        open={Boolean(detailsPurchase)}
        onOpenChange={(open) => {
          if (!open) setDetailsPurchase(null);
        }}
        title="جزئیات فاکتور خرید"
        record={detailsPurchase}
      />
      <RecordDetailsDialog
        open={Boolean(detailsPurchaseReturn)}
        onOpenChange={(open) => {
          if (!open) setDetailsPurchaseReturn(null);
        }}
        title="جزئیات برگشت خرید"
        record={detailsPurchaseReturn}
      />
      <Dialog
        open={Boolean(cancelPurchaseReturn)}
        onOpenChange={(open) => {
          if (!open) setCancelPurchaseReturn(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال برگشت خرید</DialogTitle>
            <DialogDescription>
              موجودی، صندوق یا بانک، حساب فروشنده و ژورنال با سند معکوس اصلاح می‌شود.
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="دلیل ابطال"
            value={cancelPurchaseReturnReason}
            onChange={setCancelPurchaseReturnReason}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelPurchaseReturn(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitPurchaseReturnCancel}>
              ابطال برگشت
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseItemDialogOpen}
        onOpenChange={setPurchaseItemDialogOpen}
        disablePointerDismissal
      >
        <DialogContent dir="rtl" className="sm:max-w-[min(196vw,1280px)]">
          <DialogHeader>
            <DialogTitle>
              {editingPurchaseLineId ? "ویرایش قلم خرید" : "افزودن قلم خرید"}
            </DialogTitle>
            <DialogDescription>
              مشخصات جنس، گدام، واحد، مقدار، قیمت خرید و تاریخ انقضا را جداگانه ثبت کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-3">
            <LookupSelect
              label="جنس"
              value={purchaseLineDraft.productId}
              options={products}
              onSearchChange={searchPurchaseProducts}
              onChange={setPurchaseDraftProduct}
              emptyAction={
                <Button type="button" size="sm" className="w-full" onClick={openQuickProductDialog}>
                  <Plus className="size-4" />
                  افزودن جنس جدید
                </Button>
              }
            />
            <LookupSelect
              label="گدام"
              value={purchaseLineDraft.warehouseId}
              options={warehouses}
              onChange={(value) =>
                setPurchaseLineDraft((current) => ({
                  ...current,
                  warehouseId: value,
                }))
              }
            />
            <LookupSelect
              label="واحد"
              value={purchaseLineDraft.unitId}
              options={productUnitOptions(purchaseLineDraft.productId)}
              onChange={(value) =>
                setPurchaseLineDraft((current) => ({
                  ...current,
                  unitId: value,
                  unitCost: purchaseUnitCost(current.productId, value),
                  salePrice: purchaseSalePrice(current.productId, value),
                }))
              }
            />
            <NumberField
              label="مقدار"
              value={purchaseLineDraft.quantity}
              onChange={(value) =>
                setPurchaseLineDraft((current) => ({
                  ...current,
                  quantity: value,
                }))
              }
            />
            <NumberField
              label="قیمت خرید"
              value={purchaseLineDraft.unitCost}
              onChange={(value) =>
                setPurchaseLineDraft((current) => ({
                  ...current,
                  unitCost: value,
                }))
              }
            />
            <NumberField
              label="قیمت فروش همین واحد"
              value={purchaseLineDraft.salePrice}
              onChange={(value) =>
                setPurchaseLineDraft((current) => ({
                  ...current,
                  salePrice: value,
                  updateSalePrice: true,
                }))
              }
            />
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">آپدیت قیمت فروش</span>
              <button
                type="button"
                className="flex h-9 items-center justify-between border border-border bg-background px-3 text-start"
                onClick={() =>
                  setPurchaseLineDraft((current) => ({
                    ...current,
                    updateSalePrice: !current.updateSalePrice,
                  }))
                }
              >
                <span>
                  {purchaseLineDraft.updateSalePrice
                    ? "قیمت محصول آپدیت می‌شود"
                    : "فقط برای این خرید"}
                </span>
                <Badge
                  className={
                    purchaseLineDraft.updateSalePrice
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {purchaseLineDraft.updateSalePrice ? "فعال" : "غیرفعال"}
                </Badge>
              </button>
            </label>
            {productHasExpiry(products, purchaseLineDraft.productId) ? (
              <TextField
                label="تاریخ انقضا"
                type="date"
                value={purchaseLineDraft.expiryDate}
                onChange={(value) =>
                  setPurchaseLineDraft((current) => ({
                    ...current,
                    expiryDate: value,
                  }))
                }
              />
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">جمع قلم</p>
                <strong>
                  {money(
                    invoiceLineTotal(purchaseLineDraft.quantity, purchaseLineDraft.unitCost),
                    selectedCurrency?.code,
                  )}
                </strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مقدار واحد پایه</p>
                <strong>
                  {new Intl.NumberFormat("en-US").format(purchaseDraftBaseQuantity)}{" "}
                  {purchaseDraftUnitInfo.baseUnitName}
                </strong>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قیمت خرید واحد پایه</p>
                <strong>{money(purchaseDraftBaseUnitCost, selectedCurrency?.code)}</strong>
                {purchaseDraftGeneralDiscount > 0 ? (
                  <div className="text-[11px] text-muted-foreground">
                    بعد تخفیف: {money(purchaseDraftNetBaseUnitCost, selectedCurrency?.code)}
                  </div>
                ) : null}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قیمت فروش پیشنهادی</p>
                <strong>{money(purchaseLineDraft.salePrice, selectedCurrency?.code)}</strong>
                <div className="text-[11px] text-muted-foreground">
                  واحد پایه:{" "}
                  {money(
                    purchaseDraftUnitInfo.conversionRate > 0
                      ? purchaseLineDraft.salePrice / purchaseDraftUnitInfo.conversionRate
                      : purchaseLineDraft.salePrice,
                    selectedCurrency?.code,
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseItemDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={savePurchaseItem}>
              {editingPurchaseLineId ? "ذخیره تغییرات" : "افزودن به فاکتور"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={quickProductDialogOpen}
        onOpenChange={setQuickProductDialogOpen}
        disablePointerDismissal
      >
        <DialogContent dir="rtl" className="max-w-[min(96vw,1120px)]">
          <DialogHeader>
            <DialogTitle>ثبت سریع جنس جدید</DialogTitle>
            <DialogDescription>
              اگر جنس در جستجوی خرید پیدا نشد، همین‌جا کالا را ثبت کنید و سپس به قلم خرید اضافه
              کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="نام جنس"
                value={quickProductForm.name}
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    name: value,
                  }))
                }
              />
              <TextField
                label="SKU"
                value={quickProductForm.sku}
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    sku: value,
                  }))
                }
              />
              <TextField
                label="بارکود (اختیاری)"
                value={quickProductForm.barcode}
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    barcode: value,
                  }))
                }
              />
              <LookupSelect
                label="کتگوری"
                value={quickProductForm.categoryId}
                options={productCategories}
                emptyLabel="بدون کتگوری"
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    categoryId: value,
                  }))
                }
              />
              <LookupSelect
                label="واحد پایه"
                value={quickProductForm.baseUnitId}
                options={productUnits}
                onChange={(value) => {
                  setQuickProductForm((current) => ({
                    ...current,
                    baseUnitId: value,
                  }));
                  setQuickProductUnitLines((current) => {
                    const nextLines = current.some((line) => line.unitId === value)
                      ? current.map((line) =>
                          line.unitId === value ? { ...line, conversionRate: 1 } : line,
                        )
                      : [
                          makeProductUnitLine(productUnits, {
                            unitId: value,
                            conversionRate: 1,
                            isDefaultPurchase: current.length === 0,
                            isDefaultSale: current.length === 0,
                          }),
                          ...current,
                        ];

                    return syncQuickProductUnitPrices(nextLines, value, {});
                  });
                }}
              />
              <LookupSelect
                label="گدام پیش‌فرض"
                value={quickProductForm.defaultWarehouseId}
                options={warehouses}
                emptyLabel="بدون گدام"
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    defaultWarehouseId: value,
                  }))
                }
              />
              <NumberField
                label="حد هشدار کمبود موجودی"
                value={quickProductForm.minStock}
                onChange={(value) =>
                  setQuickProductForm((current) => ({
                    ...current,
                    minStock: value,
                  }))
                }
              />
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">تاریخ انقضا دارد؟</span>
                <button
                  type="button"
                  className="flex h-10 items-center justify-between border border-border bg-background px-3 text-start"
                  onClick={() =>
                    setQuickProductForm((current) => ({
                      ...current,
                      hasExpiry: !current.hasExpiry,
                    }))
                  }
                >
                  <span>
                    {quickProductForm.hasExpiry
                      ? "برای خرید تاریخ انقضا نمایش داده می‌شود"
                      : "بدون تاریخ انقضا"}
                  </span>
                  <Badge
                    className={
                      quickProductForm.hasExpiry
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {quickProductForm.hasExpiry ? "بلی" : "نخیر"}
                  </Badge>
                </button>
              </label>
              <div className="md:col-span-full">
                <TextField
                  label="توضیحات"
                  value={quickProductForm.description}
                  onChange={(value) =>
                    setQuickProductForm((current) => ({
                      ...current,
                      description: value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-3 border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold">واحدها و قیمت‌ها</h4>
                  <p className="text-xs text-muted-foreground">
                    قیمت واحدهای دیگر بر اساس نرخ تبدیل واحد پایه محاسبه می‌شود.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setQuickProductUnitLines((current) => [
                      ...current,
                      makeProductUnitLine(productUnits),
                    ])
                  }
                >
                  <Plus className="size-4" />
                  افزودن واحد
                </Button>
              </div>

              {quickProductUnitLines.map((line) => (
                <div
                  key={line.id}
                  className="grid gap-2 border border-border bg-background p-3 md:grid-cols-[1.5fr_repeat(3,1fr)_auto]"
                >
                  <LookupSelect
                    label="واحد"
                    value={line.unitId}
                    options={productUnits}
                    onChange={(value) =>
                      setQuickProductUnitLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                unitId: value,
                                conversionRate:
                                  value === quickProductForm.baseUnitId ? 1 : item.conversionRate,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <NumberField
                    label="نرخ تبدیل"
                    value={line.conversionRate}
                    disabled={line.unitId === quickProductForm.baseUnitId}
                    onChange={(value) =>
                      setQuickProductUnitLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                conversionRate:
                                  item.unitId === quickProductForm.baseUnitId ? 1 : value,
                                purchasePrice:
                                  item.unitId === quickProductForm.baseUnitId
                                    ? item.purchasePrice
                                    : Number(
                                        (
                                          (current.find(
                                            (base) => base.unitId === quickProductForm.baseUnitId,
                                          )?.purchasePrice || 0) * value
                                        ).toFixed(4),
                                      ),
                                salePrice:
                                  item.unitId === quickProductForm.baseUnitId
                                    ? item.salePrice
                                    : Number(
                                        (
                                          (current.find(
                                            (base) => base.unitId === quickProductForm.baseUnitId,
                                          )?.salePrice || 0) * value
                                        ).toFixed(4),
                                      ),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <NumberField
                    label="قیمت خرید"
                    value={line.purchasePrice}
                    onChange={(value) =>
                      setQuickProductUnitLines((current) => {
                        const next = current.map((item) =>
                          item.id === line.id ? { ...item, purchasePrice: value } : item,
                        );

                        return line.unitId === quickProductForm.baseUnitId
                          ? syncQuickProductUnitPrices(next, line.unitId, {
                              purchasePrice: value,
                            })
                          : next;
                      })
                    }
                  />
                  <NumberField
                    label="قیمت فروش"
                    value={line.salePrice}
                    onChange={(value) =>
                      setQuickProductUnitLines((current) => {
                        const next = current.map((item) =>
                          item.id === line.id ? { ...item, salePrice: value } : item,
                        );

                        return line.unitId === quickProductForm.baseUnitId
                          ? syncQuickProductUnitPrices(next, line.unitId, {
                              salePrice: value,
                            })
                          : next;
                      })
                    }
                  />
                  <div className="flex items-end gap-1">
                    <Button
                      type="button"
                      variant={line.isDefaultPurchase ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setQuickProductUnitLines((current) =>
                          current.map((item) => ({
                            ...item,
                            isDefaultPurchase: item.id === line.id,
                          })),
                        )
                      }
                    >
                      خرید
                    </Button>
                    <Button
                      type="button"
                      variant={line.isDefaultSale ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setQuickProductUnitLines((current) =>
                          current.map((item) => ({
                            ...item,
                            isDefaultSale: item.id === line.id,
                          })),
                        )
                      }
                    >
                      فروش
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      disabled={quickProductUnitLines.length <= 1}
                      onClick={() =>
                        setQuickProductUnitLines((current) =>
                          current.filter((item) => item.id !== line.id),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuickProductDialogOpen(false)}
              disabled={isSavingQuickProduct}
            >
              لغو
            </Button>
            <Button
              type="button"
              onClick={saveQuickPurchaseProduct}
              disabled={isSavingQuickProduct}
            >
              {isSavingQuickProduct ? "در حال ثبت..." : "ثبت و انتخاب جنس"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent dir="rtl" className="max-w-[min(96vw,1280px)]">
          <DialogHeader>
            <DialogTitle>برگشت خرید</DialogTitle>
            <DialogDescription>
              اقلام برگشتی به فروشنده را وارد کنید؛ سیستم موجودی، صندوق/بانک، حساب فروشنده و سند
              حسابداری را ثبت می‌کند.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="فاکتور"
                value={returnPurchase?.invoiceNo || returnPurchase?.id || ""}
                onChange={() => undefined}
              />
              <NumberField
                label="مبلغ دریافت‌شده"
                value={receivedAmount}
                onChange={setReceivedAmount}
              />
              <LookupSelect
                label="حساب دریافت"
                value={receiveAccountKey}
                options={paymentAccounts
                  .filter(
                    (account) =>
                      !returnPurchase?.currencyId ||
                      account.currencyId === returnPurchase.currencyId,
                  )
                  .map((account) => ({
                    id: `${account.type}:${account.id}`,
                    name: account.name,
                  }))}
                emptyLabel="بدون دریافت نقدی"
                onChange={setReceiveAccountKey}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              {returnPurchase?.items?.map((item: any) => {
                const line = returnLines.find((candidate) => candidate.itemId === item.id);
                return (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 md:grid-cols-[2fr_1fr_1fr_1fr]"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.product?.name || "-"}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.warehouse?.name || "-"} /{" "}
                        {item.unit?.shortName || item.unit?.name || "-"}
                      </p>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">خرید شده</span>
                      <strong className="block">{Number(item.quantity || 0)}</strong>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">قیمت قلم</span>
                      <strong className="block">{money(item.totalCost || 0)}</strong>
                    </div>
                    <NumberField
                      label="مقدار برگشت"
                      value={line?.quantity || 0}
                      onChange={(value) =>
                        setReturnLines((current) =>
                          current.map((candidate) =>
                            candidate.itemId === item.id
                              ? { ...candidate, quantity: value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>

            <TextField label="یادداشت" value={returnNote} onChange={setReturnNote} />
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">جمع تخمینی برگشت</p>
              <strong>{money(purchaseReturnSubtotal)}</strong>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitPurchaseReturn}>ثبت برگشت خرید</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>پرداخت فاکتور خرید</DialogTitle>
            <DialogDescription>
              پرداخت مرحله‌ای روی فاکتور خرید ثبت می‌شود و بدهی فروشنده، صندوق/بانک و سند حسابداری
              همزمان اصلاح می‌گردد.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="فاکتور"
              value={paymentPurchase?.invoiceNo || paymentPurchase?.id || ""}
              onChange={() => undefined}
            />
            <TextField
              label="فروشنده"
              value={paymentPurchase?.supplier?.name || "-"}
              onChange={() => undefined}
            />
            <NumberField
              label="باقی فاکتور"
              value={Number(paymentPurchase?.remainingAmount || 0)}
              onChange={() => undefined}
              disabled
            />
            <NumberField
              label="مبلغ پرداخت"
              value={invoicePaymentAmount}
              onChange={setInvoicePaymentAmount}
            />
            <LookupSelect
              label="حساب پرداخت"
              value={invoicePaymentAccountKey}
              options={paymentAccounts
                .filter(
                  (account) =>
                    !paymentPurchase?.currencyId ||
                    account.currencyId === paymentPurchase.currencyId,
                )
                .map((account) => ({
                  id: `${account.type}:${account.id}`,
                  name: account.name,
                }))}
              onChange={setInvoicePaymentAccountKey}
            />
            <TextField
              label="یادداشت"
              value={invoicePaymentNote}
              onChange={setInvoicePaymentNote}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitPurchasePayment}>ثبت پرداخت</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelPurchase)}
        onOpenChange={(open) => {
          if (!open) setCancelPurchase(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال فاکتور خرید</DialogTitle>
            <DialogDescription>
              با ابطال، موجودی خرید خارج می‌شود، پرداخت‌های صندوق/بانک معکوس می‌شود و حساب
              فروشنده/ژورنال اثر معکوس می‌گیرد. اگر جنس این خرید مصرف یا منتقل شده باشد، API ابطال
              را رد می‌کند.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <TextField
              label="فاکتور"
              value={cancelPurchase?.invoiceNo || cancelPurchase?.id || ""}
              onChange={() => undefined}
            />
            <TextField
              label="دلیل ابطال"
              value={cancelPurchaseReason}
              onChange={setCancelPurchaseReason}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelPurchase(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitPurchaseCancel}>
              ابطال خرید
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const emptyPartyPaymentForm: PartyPaymentForm = {
  partyId: "",
  currencyId: "",
  paymentAccountKey: "",
  amount: 0,
  note: "",
};

const emptyMoneyTransferForm: MoneyTransferForm = {
  fromAccountKey: "",
  toAccountKey: "",
  amount: 0,
  note: "",
};

const emptyTreasuryAccountForm: TreasuryAccountForm = {
  kind: "CASH",
  name: "",
  code: "",
  location: "",
  bankName: "",
  accountNumber: "",
  currencyId: "",
  openingBalance: 0,
  note: "",
};

function showReverseRequiredToast() {
  toast.info(
    "ویرایش/ابطال این سند باید با سند معکوس انجام شود؛ حذف ساده برای سندهای مالی و موجودی مجاز نیست.",
  );
}

function accountKey(account: Pick<PaymentAccountOption, "type" | "id">) {
  return `${account.type}:${account.id}`;
}

function parseAccountKey(value: string) {
  const [type, id] = value.split(":");

  if ((type === "CASH" || type === "BANK") && id) {
    return { type, id } as const;
  }

  return null;
}

function partyBalance(party: any, kind: "CUSTOMER" | "SUPPLIER") {
  return partyBalanceBase(party, kind);
}

function buildPaymentAccounts(cashData: any, bankData: any) {
  const cashAccounts: PaymentAccountOption[] = Array.isArray(cashData)
    ? cashData.flatMap((register: any) =>
        Array.isArray(register.accounts)
          ? register.accounts.map((account: any) => ({
              id: account.id,
              type: "CASH" as const,
              currencyId: account.currencyId,
              balance: Number(account.balance || 0),
              name: `${register.name} / ${account.currency?.code || ""}`,
            }))
          : [],
      )
    : [];
  const bankAccounts: PaymentAccountOption[] = Array.isArray(bankData)
    ? bankData.map((account: any) => ({
        id: account.id,
        type: "BANK" as const,
        currencyId: account.currencyId,
        balance: Number(account.balance || 0),
        name: `${account.name} / ${account.currency?.code || ""}`,
      }))
    : [];

  return [...cashAccounts, ...bankAccounts];
}

function normalizeMoneyTransaction(item: any, cancelledKeys = new Set<string>()): DataRow {
  const accountName = item.cashRegisterAccount?.cashRegister?.name || item.bankAccount?.name || "-";
  const accountType = item.cashRegisterAccountId ? "صندوق" : "بانک";
  const rowKey =
    item.type === "TRANSFER" && item.transferGroupId
      ? `TRANSFER:${item.transferGroupId}`
      : `TX:${item.id}`;
  const isCancelRow = String(item.referenceType || "").endsWith("_CANCEL");
  const isCancelled =
    isCancelRow ||
    cancelledKeys.has(rowKey) ||
    (item.referenceId && cancelledKeys.has(`REF:${item.referenceId}`));
  const currencyCode = item.currency?.code || "AFN";
  const partyTransaction = item.partyTransaction;
  const party = partyTransaction?.party;
  const partyAccount = party?.accounts?.find(
    (account: any) => account.currencyId === item.currencyId,
  );
  const isCustomerPartyTransaction =
    item.type === "CUSTOMER_PAYMENT" ||
    item.referenceType === "CUSTOMER_PAYMENT" ||
    item.referenceType === "CUSTOMER_PAYMENT_CANCEL";
  const isSupplierPartyTransaction =
    item.type === "SUPPLIER_PAYMENT" ||
    item.referenceType === "SUPPLIER_PAYMENT" ||
    item.referenceType === "SUPPLIER_PAYMENT_CANCEL";
  const partyBalance = isCustomerPartyTransaction
    ? Number(partyAccount?.debitBalance || 0) - Number(partyAccount?.creditBalance || 0)
    : isSupplierPartyTransaction
      ? Number(partyAccount?.creditBalance || 0) - Number(partyAccount?.debitBalance || 0)
      : null;

  return {
    id: item.id,
    referenceId: item.referenceId,
    referenceType: item.referenceType,
    transferGroupId: item.transferGroupId,
    typeRaw: item.type,
    directionRaw: item.direction,
    __raw: item,
    date: item.createdAt ? formatKabulDateTime(item.createdAt) : "-",
    account: `${accountType} / ${accountName}`,
    party: party?.name || "-",
    partyType: isCustomerPartyTransaction ? "مشتری" : isSupplierPartyTransaction ? "فروشنده" : "-",
    partyBalance: partyBalance === null ? "-" : money(Math.max(0, partyBalance), currencyCode),
    type: item.type || "-",
    direction: item.direction === "IN" ? "ورودی" : "خروجی",
    amount: money(item.amount || 0, currencyCode),
    balanceAfter: money(item.balanceAfter || 0, currencyCode),
    status: isCancelled ? "ابطال" : "فعال",
    __canDelete: !isCancelled && item.type !== "ADJUSTMENT",
    user: item.createdByUser?.displayName || item.createdByUser?.username || "-",
    note: item.note || item.referenceType || "-",
  };
}

function CashBankPage() {
  const initialTreasuryRange = recentDateRange();
  const [transactions, setTransactions] = useState<DataRow[]>([]);
  const [transactionsPagination, setTransactionsPagination] = useState<any>(null);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(initialTreasuryRange.from);
  const [to, setTo] = useState(initialTreasuryRange.to);
  const [accountQuery, setAccountQuery] = useState("");
  const [transactionFilter, setTransactionFilter] = useState<
    "ALL" | "RECEIPT" | "PAYMENT" | "TRANSFER"
  >("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<CashBankAction | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountForm, setAccountForm] = useState<TreasuryAccountForm>(emptyTreasuryAccountForm);
  const [partyForm, setPartyForm] = useState<PartyPaymentForm>(emptyPartyPaymentForm);
  const [transferForm, setTransferForm] = useState<MoneyTransferForm>(emptyMoneyTransferForm);
  const [cancelRow, setCancelRow] = useState<DataRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [partyEditing, setPartyEditing] = useState<{
    row: DataRow;
    reversed: boolean;
  } | null>(null);

  const loadCashBankData = async (page = transactionsPagination?.page || 1) => {
    setIsLoading(true);
    try {
      const transferParams = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      for (const [key, value] of new URLSearchParams(dateRangeQuery(from, to))) {
        transferParams.set(key, value);
      }
      if (query.trim()) transferParams.set("search", query.trim());
      if (transactionFilter !== "ALL") transferParams.set("kind", transactionFilter);
      const [cashRes, bankRes, transfersRes, customersRes, suppliersRes, currenciesRes] =
        await Promise.all([
          fetch(`${API_BASE_URL}/api/cash-registers`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/bank-accounts`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/money-transfers?${transferParams.toString()}`).then((res) =>
            res.json(),
          ),
          fetch(`${API_BASE_URL}/api/parties?type=CUSTOMER`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/parties?type=SUPPLIER`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/currencies`).then((res) => res.json()),
        ]);

      setPaymentAccounts(buildPaymentAccounts(cashRes?.data, bankRes?.data));
      const cancelledTransactionKeys = new Set<string>();
      if (Array.isArray(transfersRes?.data)) {
        transfersRes.data.forEach((item: any) => {
          if (!String(item.referenceType || "").endsWith("_CANCEL")) return;
          if (item.referenceType === "MONEY_TRANSFER_CANCEL" && item.referenceId) {
            cancelledTransactionKeys.add(`TRANSFER:${item.referenceId}`);
          }
          if (item.referenceId) {
            cancelledTransactionKeys.add(`TX:${item.referenceId}`);
            cancelledTransactionKeys.add(`REF:${item.referenceId}`);
          }
        });
      }
      setTransactions(
        Array.isArray(transfersRes?.data)
          ? transfersRes.data.map((item: any) =>
              normalizeMoneyTransaction(item, cancelledTransactionKeys),
            )
          : [],
      );
      setTransactionsPagination(transfersRes?.pagination || null);
      setCustomers(Array.isArray(customersRes?.data) ? customersRes.data : []);
      setSuppliers(Array.isArray(suppliersRes?.data) ? suppliersRes.data : []);
      setCurrencies(Array.isArray(currenciesRes?.data) ? currenciesRes.data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن اطلاعات صندوق و بانک ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCashBankData();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCashBankData(1), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, transactionFilter]);

  const cashTotal = paymentAccounts
    .filter((account) => account.type === "CASH")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const bankTotal = paymentAccounts
    .filter((account) => account.type === "BANK")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const receivables = customers.reduce(
    (sum, customer) => sum + partyBalance(customer, "CUSTOMER"),
    0,
  );
  const payables = suppliers.reduce((sum, supplier) => sum + partyBalance(supplier, "SUPPLIER"), 0);

  const treasuryAccountRows = useMemo(() => {
    const rows = paymentAccounts.map((account) => ({
      id: accountKey(account),
      name: account.name,
      type: account.type === "CASH" ? "صندوق نقدی" : "حساب بانکی",
      balance: money(account.balance || 0),
      status: "فعال",
      __canEdit: false,
      __canDelete: false,
    }));

    return filterDataRows(rows, accountQuery);
  }, [accountQuery, paymentAccounts]);

  const accountOptions = paymentAccounts.map((account) => ({
    id: accountKey(account),
    name: `${account.name} - ${money(account.balance || 0)}`,
  }));

  const setDefaultPartyForm = (nextAction: "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT") => {
    const baseCurrency = currencies.find((currency) => currency.isBase) || currencies[0];
    const account = paymentAccounts.find(
      (item) => !baseCurrency || item.currencyId === baseCurrency.id,
    );
    const party = nextAction === "CUSTOMER_RECEIPT" ? customers[0] : suppliers[0];

    setPartyForm({
      ...emptyPartyPaymentForm,
      partyId: party?.id || "",
      currencyId: baseCurrency?.id || "",
      paymentAccountKey: account ? accountKey(account) : "",
    });
    setPartyEditing(null);
    setAction(nextAction);
  };

  const openTransfer = () => {
    setTransferForm({
      ...emptyMoneyTransferForm,
      fromAccountKey: paymentAccounts[0] ? accountKey(paymentAccounts[0]) : "",
      toAccountKey: paymentAccounts[1] ? accountKey(paymentAccounts[1]) : "",
    });
    setAction("TRANSFER");
  };

  const openTreasuryAccount = (kind: "CASH" | "BANK") => {
    const baseCurrency = currencies.find((currency) => currency.isBase) || currencies[0];
    setAccountForm({
      ...emptyTreasuryAccountForm,
      kind,
      currencyId: baseCurrency?.id || "",
    });
    setAccountDialogOpen(true);
  };

  const submitTreasuryAccount = async () => {
    if (!accountForm.name.trim() || !accountForm.currencyId) {
      toast.error("نام حساب و کرنسی ضروری است");
      return;
    }

    try {
      if (accountForm.kind === "CASH") {
        const registerRes = await fetch(`${API_BASE_URL}/api/cash-registers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: accountForm.name,
            code: accountForm.code || null,
            location: accountForm.location || null,
            note: accountForm.note || null,
            isActive: true,
          }),
        });
        const registerJson = await registerRes.json().catch(() => null);

        if (!registerRes.ok) {
          throw new Error(registerJson?.message || "ساخت صندوق ناکام شد");
        }

        const accountRes = await fetch(
          `${API_BASE_URL}/api/cash-registers/${registerJson.data.id}/accounts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currencyId: accountForm.currencyId,
              openingBalance: accountForm.openingBalance,
              note: accountForm.note || null,
            }),
          },
        );
        const accountJson = await accountRes.json().catch(() => null);

        if (!accountRes.ok) {
          throw new Error(accountJson?.message || "ساخت حساب صندوق ناکام شد");
        }
      } else {
        const bankRes = await fetch(`${API_BASE_URL}/api/bank-accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: accountForm.name,
            bankName: accountForm.bankName || null,
            accountNumber: accountForm.accountNumber || null,
            currencyId: accountForm.currencyId,
            openingBalance: accountForm.openingBalance,
            note: accountForm.note || null,
            isActive: true,
          }),
        });
        const bankJson = await bankRes.json().catch(() => null);

        if (!bankRes.ok) {
          throw new Error(bankJson?.message || "ساخت حساب بانکی ناکام شد");
        }
      }

      toast.success(accountForm.kind === "CASH" ? "حساب صندوق ساخته شد" : "حساب بانکی ساخته شد");
      setAccountDialogOpen(false);
      await loadCashBankData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ساخت حساب خزانه ناکام شد");
    }
  };

  const submitPartyPayment = async () => {
    if (!action || action === "TRANSFER") return;

    const selectedAccount = parseAccountKey(partyForm.paymentAccountKey);
    let reversedExisting = partyEditing?.reversed ?? false;
    const endpoint =
      action === "CUSTOMER_RECEIPT"
        ? "/api/payments/customer-receipts"
        : "/api/payments/supplier-payments";
    const partyKey = action === "CUSTOMER_RECEIPT" ? "customerId" : "supplierId";

    if (!partyForm.partyId || !partyForm.currencyId || !selectedAccount || partyForm.amount <= 0) {
      toast.error("طرف حساب، کرنسی، حساب پرداخت و مبلغ معتبر ضروری است");
      return;
    }

    try {
      if (partyEditing && !partyEditing.reversed) {
        const cancelRes = await fetch(
          `${API_BASE_URL}/api/payments/party-transactions/${partyEditing.row.referenceId}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "اصلاح سند ثبت‌شده" }),
          },
        );
        const cancelJson = await cancelRes.json().catch(() => null);

        if (!cancelRes.ok) {
          throw new Error(cancelJson?.message || "ابطال نسخه قبلی سند ناکام شد");
        }

        setPartyEditing((current) => (current ? { ...current, reversed: true } : current));
        reversedExisting = true;
      }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [partyKey]: partyForm.partyId,
          currencyId: partyForm.currencyId,
          paymentAccountType: selectedAccount.type,
          paymentAccountId: selectedAccount.id,
          amount: partyForm.amount,
          note: partyForm.note || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت عملیات ناکام شد");
      }

      toast.success(
        partyEditing
          ? "سند قبلی ابطال و نسخه اصلاح‌شده ثبت شد"
          : action === "CUSTOMER_RECEIPT"
            ? "دریافت از مشتری ثبت شد"
            : "پرداخت به فروشنده ثبت شد",
      );
      const receiptId = json?.data?.partyTransaction?.id;
      if (receiptId) {
        const receiptUrl = await refreshReceiptAccessUrl(
          `${API_BASE_URL}/api/receipts/party-payments/${receiptId}/html`,
        );
        window.open(receiptUrl, "_blank");
      }
      setAction(null);
      setPartyEditing(null);
      await loadCashBankData();
    } catch (error) {
      toast.error(
        reversedExisting
          ? "نسخه قبلی ابطال شد، اما ثبت نسخه اصلاح‌شده ناکام شد. فورم را بررسی و دوباره ذخیره کنید."
          : error instanceof Error
            ? error.message
            : "ثبت عملیات ناکام شد",
      );
    }
  };

  const submitTransfer = async () => {
    const from = parseAccountKey(transferForm.fromAccountKey);
    const to = parseAccountKey(transferForm.toAccountKey);

    if (!from || !to || transferForm.amount <= 0) {
      toast.error("حساب مبدا، حساب مقصد و مبلغ معتبر ضروری است");
      return;
    }

    if (transferForm.fromAccountKey === transferForm.toAccountKey) {
      toast.error("حساب مبدا و مقصد نمی‌تواند یکی باشد");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/money-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromType: from.type,
          fromAccountId: from.id,
          toType: to.type,
          toAccountId: to.id,
          amount: transferForm.amount,
          note: transferForm.note || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "انتقال پول ناکام شد");
      }

      toast.success("انتقال صندوق/بانک ثبت شد");
      setAction(null);
      await loadCashBankData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "انتقال پول ناکام شد");
    }
  };

  const openCashBankCancel = (row: DataRow) => {
    if (row.referenceType?.endsWith?.("_CANCEL") || row.typeRaw === "ADJUSTMENT") {
      toast.info("این ردیف خودش سند اصلاحی/ابطال است و دوباره ابطال نمی‌شود.");
      return;
    }

    setPartyEditing(null);
    setCancelRow(row);
    setCancelReason("");
  };

  const openCashBankCorrection = async (row: DataRow) => {
    if (row.referenceType?.endsWith?.("_CANCEL") || row.typeRaw === "ADJUSTMENT") {
      toast.info("این ردیف خودش سند اصلاحی/ابطال است و دوباره اصلاح نمی‌شود.");
      return;
    }

    if (
      (row.typeRaw === "CUSTOMER_PAYMENT" || row.typeRaw === "SUPPLIER_PAYMENT") &&
      row.referenceId
    ) {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/payments/party-transactions/${row.referenceId}`,
        );
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(json?.message || "خواندن جزئیات سند ناکام شد");
        }

        const partyTransaction = json?.data?.partyTransaction;
        const moneyTransaction = json?.data?.moneyTransaction;
        const account = moneyTransaction?.cashRegisterAccountId
          ? `CASH:${moneyTransaction.cashRegisterAccountId}`
          : moneyTransaction?.bankAccountId
            ? `BANK:${moneyTransaction.bankAccountId}`
            : "";

        setPartyForm({
          partyId: partyTransaction?.partyId || "",
          currencyId: partyTransaction?.currencyId || "",
          paymentAccountKey: account,
          amount: Number(partyTransaction?.amount || 0),
          note: partyTransaction?.note || "",
        });
        setPartyEditing({ row, reversed: false });
        setAction(row.typeRaw === "CUSTOMER_PAYMENT" ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT");
        return;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "خواندن جزئیات سند ناکام شد");
        return;
      }
    }

    toast.info("برای اصلاح انتقال، سند فعلی را ابطال و انتقال درست را دوباره ثبت کنید.");
    openCashBankCancel(row);
  };

  const submitCashBankCancel = async () => {
    if (!cancelRow) return;

    let endpoint = "";
    if (cancelRow.typeRaw === "TRANSFER" && cancelRow.transferGroupId) {
      endpoint = `/api/money-transfers/${cancelRow.transferGroupId}/cancel`;
    } else if (
      (cancelRow.typeRaw === "CUSTOMER_PAYMENT" || cancelRow.typeRaw === "SUPPLIER_PAYMENT") &&
      cancelRow.referenceId
    ) {
      endpoint = `/api/payments/party-transactions/${cancelRow.referenceId}/cancel`;
    } else if (
      (cancelRow.typeRaw === "INCOME" || cancelRow.typeRaw === "EXPENSE") &&
      cancelRow.id
    ) {
      endpoint = `/api/income-expenses/${cancelRow.id}/cancel`;
    }

    if (!endpoint) {
      showReverseRequiredToast();
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason || null }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال سند ناکام شد");
      }

      toast.success("سند با سند معکوس ابطال شد");
      setCancelRow(null);
      setCancelReason("");
      await loadCashBankData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال سند ناکام شد");
    }
  };

  const partyOptions = action === "SUPPLIER_PAYMENT" ? suppliers : customers;
  const selectedCurrencyAccounts = paymentAccounts.filter(
    (account) => !partyForm.currencyId || account.currencyId === partyForm.currencyId,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="نقد فعلی صندوق" value={money(cashTotal)} icon={<Banknote />} />
        <MetricCard label="مانده فعلی بانک" value={money(bankTotal)} icon={<Landmark />} />
        <MetricCard label="طلب فعلی مشتریان" value={money(receivables)} icon={<UsersRound />} />
        <MetricCard label="بدهی فعلی فروشندگان" value={money(payables)} icon={<Building2 />} />
      </div>

      <Tabs>
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="accounts">حساب‌های صندوق و بانک</TabsTrigger>
            <TabsTrigger value="transactions">پرداخت و دریافت</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="accounts">
          <Card className="border-border bg-card">
            <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="size-5 text-primary" />
                  حساب‌های پول نقد و بانکی
                </CardTitle>
                <CardDescription>
                  ساخت و مشاهده صندوق‌های نقدی و حساب‌های بانکی فروشگاه.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={accountQuery}
                    onChange={(event) => setAccountQuery(event.target.value)}
                    placeholder="جستجوی نام حساب، نوع یا مانده..."
                    className="w-72 ps-9"
                  />
                </div>
                <Button variant="outline" onClick={() => void loadCashBankData(1)}>
                  <RefreshCcw className="size-4" />
                  تازه‌سازی
                </Button>
                <Button variant="outline" onClick={() => openTreasuryAccount("CASH")}>
                  <Banknote className="size-4" />
                  صندوق جدید
                </Button>
                <Button onClick={() => openTreasuryAccount("BANK")}>
                  <Landmark className="size-4" />
                  بانک جدید
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  در حال خواندن حساب‌ها...
                </div>
              ) : (
                <DenseTable
                  columns={[
                    { key: "name", label: "نام حساب" },
                    { key: "type", label: "نوع حساب" },
                    { key: "balance", label: "مانده" },
                    { key: "status", label: "وضعیت" },
                  ]}
                  rows={treasuryAccountRows}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card className="border-border bg-card">
            <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <WalletCards className="size-5 text-primary" />
                  پرداختی و دریافتی
                </CardTitle>
                <CardDescription>
                  دریافت از مشتری، پرداخت به فروشنده، انتقال بین صندوق و بانک و پیگیری کاربر
                  ثبت‌کننده.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={from} onChange={setFrom} className="w-40" />
                <DatePicker value={to} onChange={setTo} className="w-40" />
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="جستجوی تراکنش، حساب یا کاربر..."
                    className="w-72 ps-9"
                  />
                </div>
                <select
                  value={transactionFilter}
                  onChange={(event) =>
                    setTransactionFilter(
                      event.target.value as "ALL" | "RECEIPT" | "PAYMENT" | "TRANSFER",
                    )
                  }
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="ALL">همه</option>
                  <option value="RECEIPT">دریافتی</option>
                  <option value="PAYMENT">پرداختی</option>
                  <option value="TRANSFER">انتقال</option>
                </select>
                <Button variant="outline" onClick={() => void loadCashBankData(1)}>
                  <RefreshCcw className="size-4" />
                  تازه‌سازی
                </Button>
                <Button variant="outline" onClick={() => setDefaultPartyForm("CUSTOMER_RECEIPT")}>
                  <TrendingUp className="size-4" />
                  دریافت
                </Button>
                <Button variant="outline" onClick={() => setDefaultPartyForm("SUPPLIER_PAYMENT")}>
                  <TrendingDown className="size-4" />
                  پرداخت
                </Button>
                <Button onClick={openTransfer}>
                  <RefreshCcw className="size-4" />
                  انتقال
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  در حال خواندن تراکنش‌های خزانه...
                </div>
              ) : (
                <DenseTable
                  columns={[
                    { key: "date", label: "تاریخ" },
                    { key: "account", label: "حساب شرکت" },
                    { key: "party", label: "طرف حساب" },
                    { key: "partyBalance", label: "مانده طرف حساب" },
                    { key: "type", label: "نوع" },
                    { key: "direction", label: "جهت" },
                    { key: "amount", label: "مبلغ" },
                    { key: "balanceAfter", label: "مانده بعد" },
                    { key: "status", label: "وضعیت" },
                    { key: "user", label: "کاربر" },
                    { key: "note", label: "یادداشت" },
                  ]}
                  rows={transactions}
                  pagination={transactionsPagination}
                  onPageChange={(page) => void loadCashBankData(page)}
                  onEdit={openCashBankCorrection}
                  editLabel="ویرایش"
                  onDelete={openCashBankCancel}
                  deleteLabel="ابطال سند"
                  deleteTitle="تایید ابطال سند مالی"
                  deleteDescription="این سند حذف نمی‌شود؛ یک سند معکوس برای اصلاح صندوق/بانک و ژورنال حسابداری ساخته می‌شود."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {accountForm.kind === "CASH" ? "ساخت صندوق نقدی" : "ساخت حساب بانکی"}
            </DialogTitle>
            <DialogDescription>
              حساب‌های ساخته‌شده در همین بخش برای POS، خرید، فروش، دریافت، پرداخت و انتقال پول
              استفاده می‌شوند.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="نام حساب"
              value={accountForm.name}
              onChange={(value) => setAccountForm((current) => ({ ...current, name: value }))}
            />
            <LookupSelect
              label="کرنسی"
              value={accountForm.currencyId}
              options={currencies.map((item) => ({
                ...item,
                name: item.code || item.name,
              }))}
              onChange={(value) => setAccountForm((current) => ({ ...current, currencyId: value }))}
            />
            {accountForm.kind === "CASH" ? (
              <>
                <TextField
                  label="کد صندوق"
                  value={accountForm.code}
                  onChange={(value) => setAccountForm((current) => ({ ...current, code: value }))}
                />
                <TextField
                  label="موقعیت"
                  value={accountForm.location}
                  onChange={(value) =>
                    setAccountForm((current) => ({
                      ...current,
                      location: value,
                    }))
                  }
                />
              </>
            ) : (
              <>
                <TextField
                  label="نام بانک/صرافی"
                  value={accountForm.bankName}
                  onChange={(value) =>
                    setAccountForm((current) => ({
                      ...current,
                      bankName: value,
                    }))
                  }
                />
                <TextField
                  label="شماره حساب"
                  value={accountForm.accountNumber}
                  onChange={(value) =>
                    setAccountForm((current) => ({
                      ...current,
                      accountNumber: value,
                    }))
                  }
                />
              </>
            )}
            <NumberField
              label="مانده افتتاحیه"
              value={accountForm.openingBalance}
              onChange={(value) =>
                setAccountForm((current) => ({
                  ...current,
                  openingBalance: value,
                }))
              }
            />
            <TextField
              label="یادداشت"
              value={accountForm.note}
              onChange={(value) => setAccountForm((current) => ({ ...current, note: value }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitTreasuryAccount}>ذخیره حساب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setPartyEditing(null);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {partyEditing
                ? "ویرایش دریافت / پرداخت"
                : action === "CUSTOMER_RECEIPT"
                  ? "دریافت از مشتری"
                  : action === "SUPPLIER_PAYMENT"
                    ? "پرداخت به فروشنده"
                    : "انتقال صندوق/بانک"}
            </DialogTitle>
            <DialogDescription>
              عملیات خزانه بعد از ثبت، مانده صندوق/بانک و حساب طرف معامله را هم‌زمان به‌روز می‌کند.
            </DialogDescription>
          </DialogHeader>

          {action === "TRANSFER" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <LookupSelect
                label="حساب مبدا"
                value={transferForm.fromAccountKey}
                options={accountOptions}
                onChange={(value) =>
                  setTransferForm((current) => ({
                    ...current,
                    fromAccountKey: value,
                  }))
                }
              />
              <LookupSelect
                label="حساب مقصد"
                value={transferForm.toAccountKey}
                options={accountOptions}
                onChange={(value) =>
                  setTransferForm((current) => ({
                    ...current,
                    toAccountKey: value,
                  }))
                }
              />
              <NumberField
                label="مبلغ انتقال"
                value={transferForm.amount}
                onChange={(value) => setTransferForm((current) => ({ ...current, amount: value }))}
              />
              <TextField
                label="یادداشت"
                value={transferForm.note}
                onChange={(value) => setTransferForm((current) => ({ ...current, note: value }))}
              />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <LookupSelect
                label={action === "SUPPLIER_PAYMENT" ? "فروشنده" : "مشتری"}
                value={partyForm.partyId}
                options={partyOptions}
                onChange={(value) => setPartyForm((current) => ({ ...current, partyId: value }))}
              />
              <LookupSelect
                label="کرنسی"
                value={partyForm.currencyId}
                options={currencies.map((item) => ({
                  ...item,
                  name: item.code || item.name,
                }))}
                onChange={(value) =>
                  setPartyForm((current) => ({
                    ...current,
                    currencyId: value,
                    paymentAccountKey: "",
                  }))
                }
              />
              <LookupSelect
                label="حساب صندوق/بانک"
                value={partyForm.paymentAccountKey}
                options={selectedCurrencyAccounts.map((account) => ({
                  id: accountKey(account),
                  name: `${account.name} - ${money(account.balance || 0)}`,
                }))}
                onChange={(value) =>
                  setPartyForm((current) => ({
                    ...current,
                    paymentAccountKey: value,
                  }))
                }
              />
              <NumberField
                label="مبلغ"
                value={partyForm.amount}
                onChange={(value) => setPartyForm((current) => ({ ...current, amount: value }))}
              />
              <div className="md:col-span-2">
                <TextField
                  label="یادداشت"
                  value={partyForm.note}
                  onChange={(value) => setPartyForm((current) => ({ ...current, note: value }))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              لغو
            </Button>
            <Button onClick={action === "TRANSFER" ? submitTransfer : submitPartyPayment}>
              {partyEditing ? "ذخیره اصلاحات" : "ثبت عملیات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelRow)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelRow(null);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال سند مالی</DialogTitle>
            <DialogDescription>
              این عملیات ردیف را حذف نمی‌کند؛ یک سند معکوس می‌سازد تا مانده صندوق/بانک و ژورنال
              حسابداری اصلاح شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div>نوع: {String(cancelRow?.type || "-")}</div>
              <div>مبلغ: {String(cancelRow?.amount || "-")}</div>
              <div>حساب: {String(cancelRow?.account || "-")}</div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">دلیل ابطال</span>
              <Textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="مثلا ثبت اشتباه، حساب اشتباه، مبلغ اشتباه..."
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelRow(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitCashBankCancel}>
              ابطال با سند معکوس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const emptyIncomeExpenseForm: IncomeExpenseForm = {
  kind: "EXPENSE",
  currencyId: "",
  accountKey: "",
  categoryId: "",
  amount: 0,
  note: "",
};

function IncomeExpensesPage() {
  const [rows, setRows] = useState<DataRow[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<IncomeExpenseForm>(emptyIncomeExpenseForm);
  const [cancelRow, setCancelRow] = useState<DataRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const loadIncomeExpensesData = async () => {
    setIsLoading(true);
    try {
      const [itemsRes, cashRes, bankRes, currenciesRes, categoriesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/income-expenses`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/cash-registers`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/bank-accounts`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/currencies`).then((res) => res.json()),
        fetch(`${API_BASE_URL}/api/financial-categories`).then((res) => res.json()),
      ]);

      setRows(
        Array.isArray(itemsRes?.data)
          ? (() => {
              const cancelledIds = new Set<string>();
              itemsRes.data.forEach((item: any) => {
                if (String(item.referenceType || "").endsWith("_CANCEL") && item.referenceId) {
                  cancelledIds.add(item.referenceId);
                }
              });
              return itemsRes.data.map((item: any) => {
                const row = normalizeRow(item, "عواید و مصارف");
                const isCancelled =
                  cancelledIds.has(item.id) ||
                  String(item.referenceType || "").endsWith("_CANCEL") ||
                  item.type === "ADJUSTMENT";
                return {
                  ...row,
                  status: isCancelled ? "ابطال" : row.status,
                  __canDelete: !isCancelled,
                  __canEdit: !isCancelled,
                };
              });
            })()
          : [],
      );
      setPaymentAccounts(buildPaymentAccounts(cashRes?.data, bankRes?.data));
      setCurrencies(Array.isArray(currenciesRes?.data) ? currenciesRes.data : []);
      setCategories(Array.isArray(categoriesRes?.data) ? categoriesRes.data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن عواید و مصارف ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadIncomeExpensesData();
  }, []);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [query, rows]);

  const incomeTotal = rows
    .filter((row) => String(row.type).includes("عواید"))
    .reduce((sum, row) => sum + Number(String(row.amount).replace(/[^\d.-]/g, "")), 0);
  const expenseTotal = rows
    .filter((row) => String(row.type).includes("مصرف"))
    .reduce((sum, row) => sum + Number(String(row.amount).replace(/[^\d.-]/g, "")), 0);

  const openCreate = (kind: "INCOME" | "EXPENSE") => {
    const baseCurrency = currencies.find((currency) => currency.isBase) || currencies[0];
    const account = paymentAccounts.find(
      (item) => !baseCurrency || item.currencyId === baseCurrency.id,
    );
    const category = categories.find((item) => item.type === "BOTH" || item.type === kind);

    setForm({
      ...emptyIncomeExpenseForm,
      kind,
      currencyId: baseCurrency?.id || "",
      accountKey: account ? accountKey(account) : "",
      categoryId: category?.id || "",
    });
    setDialogOpen(true);
  };

  const submitIncomeExpense = async () => {
    const selectedAccount = parseAccountKey(form.accountKey);

    if (!form.currencyId || !selectedAccount || form.amount <= 0) {
      toast.error("کرنسی، حساب صندوق/بانک و مبلغ معتبر ضروری است");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/income-expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          currencyId: form.currencyId,
          accountType: selectedAccount.type,
          accountId: selectedAccount.id,
          categoryId: form.categoryId || null,
          amount: form.amount,
          note: form.note || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت عاید/مصرف ناکام شد");
      }

      toast.success(form.kind === "INCOME" ? "عاید ثبت شد" : "مصرف ثبت شد");
      setDialogOpen(false);
      await loadIncomeExpensesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت عاید/مصرف ناکام شد");
    }
  };

  const openIncomeExpenseCancel = (row: DataRow) => {
    if (row.referenceType?.endsWith?.("_CANCEL") || row.typeRaw === "ADJUSTMENT") {
      toast.info("این ردیف خودش سند اصلاحی/ابطال است و دوباره ابطال نمی‌شود.");
      return;
    }

    setCancelRow(row);
    setCancelReason("");
  };

  const submitIncomeExpenseCancel = async () => {
    if (!cancelRow) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/income-expenses/${cancelRow.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason || null }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال سند ناکام شد");
      }

      toast.success("سند عاید/مصرف با سند معکوس ابطال شد");
      setCancelRow(null);
      setCancelReason("");
      await loadIncomeExpensesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال سند ناکام شد");
    }
  };

  const categoryOptions = categories
    .filter((item) => item.type === "BOTH" || item.type === form.kind)
    .map((item) => ({
      id: item.id,
      name: item.name,
    }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="عواید ثبت‌شده" value={money(incomeTotal)} icon={<TrendingUp />} />
        <MetricCard label="مصارف ثبت‌شده" value={money(expenseTotal)} icon={<TrendingDown />} />
        <MetricCard
          label="کتگوری‌های مالی"
          value={new Intl.NumberFormat("en-US").format(categories.length)}
          icon={<Boxes />}
        />
        <MetricCard
          label="تراکنش‌ها"
          value={new Intl.NumberFormat("en-US").format(rows.length)}
          icon={<WalletCards />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="size-5 text-primary" />
              عواید و مصارف
            </CardTitle>
            <CardDescription>
              ثبت دخل و خرچ عمومی با اثر خودکار روی صندوق/بانک و ژورنال حسابداری.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی شرح، کتگوری یا حساب..."
                className="w-72 ps-9"
              />
            </div>
            <Button variant="outline" onClick={() => void loadIncomeExpensesData()}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button variant="outline" onClick={() => openCreate("INCOME")}>
              <TrendingUp className="size-4" />
              عاید جدید
            </Button>
            <Button onClick={() => openCreate("EXPENSE")}>
              <TrendingDown className="size-4" />
              مصرف جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن دخل و خرچ...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "شرح" },
                { key: "category", label: "کتگوری" },
                { key: "type", label: "نوع" },
                { key: "account", label: "حساب" },
                { key: "amount", label: "مبلغ" },
                { key: "status", label: "وضعیت" },
              ]}
              rows={filteredRows}
              onEdit={showReverseRequiredToast}
              editLabel="ویرایش"
              onDelete={openIncomeExpenseCancel}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.kind === "INCOME" ? "ثبت عاید جدید" : "ثبت مصرف جدید"}</DialogTitle>
            <DialogDescription>
              با ثبت این سند، مانده حساب و سند حسابداری هم‌زمان ساخته می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">نوع سند</span>
              <select
                value={form.kind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    kind: event.target.value as "INCOME" | "EXPENSE",
                    categoryId: "",
                  }))
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="EXPENSE">مصرف</option>
                <option value="INCOME">عاید</option>
              </select>
            </label>
            <LookupSelect
              label="کرنسی"
              value={form.currencyId}
              options={currencies.map((item) => ({
                ...item,
                name: item.code || item.name,
              }))}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  currencyId: value,
                  accountKey: "",
                }))
              }
            />
            <LookupSelect
              label="حساب صندوق/بانک"
              value={form.accountKey}
              options={paymentAccounts
                .filter((account) => !form.currencyId || account.currencyId === form.currencyId)
                .map((account) => ({
                  id: accountKey(account),
                  name: `${account.name} - ${money(account.balance || 0)}`,
                }))}
              onChange={(value) => setForm((current) => ({ ...current, accountKey: value }))}
            />
            <LookupSelect
              label="کتگوری"
              value={form.categoryId}
              options={categoryOptions}
              emptyLabel="بدون کتگوری"
              onChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}
            />
            <NumberField
              label="مبلغ"
              value={form.amount}
              fullWidth
              onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
            />
            <TextField
              label="شرح"
              value={form.note}
              onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitIncomeExpense}>ثبت سند</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelRow)}
        onOpenChange={(open) => {
          if (!open) setCancelRow(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال عاید/مصرف</DialogTitle>
            <DialogDescription>
              سند اصلی برای تاریخچه باقی می‌ماند و یک سند معکوس روی صندوق/بانک و ژورنال ثبت می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div>شرح: {String(cancelRow?.name || "-")}</div>
              <div>مبلغ: {String(cancelRow?.amount || "-")}</div>
              <div>حساب: {String(cancelRow?.account || "-")}</div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">دلیل ابطال</span>
              <Textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="دلیل ابطال سند را بنویسید..."
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelRow(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitIncomeExpenseCancel}>
              ابطال با سند معکوس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function reportRowsToDataRows(rows: DailyReportRow[]): DataRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    saleCount: row.saleCount,
    totalSales: money(row.totalSales),
    paidSales: money(row.paidSales),
    remainingSales: money(row.remainingSales),
    cashIn: money(row.cashIn),
    bankIn: money(row.bankIn),
    moneyOut: money(row.moneyOut),
    netCashFlow: money(row.netCashFlow),
  }));
}

function ReportsPage() {
  const today = kabulDateString();
  const [date, setDate] = useState(today);
  const [report, setReport] = useState<DailyCashierReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadReport = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/reports/daily-cashier?date=${date}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن گزارش ناکام شد");
      }

      setReport(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن گزارش ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, [date]);

  const recentRows: DataRow[] =
    report?.recentTransactions.map((item) => ({
      id: item.id,
      date: item.createdAt ? formatKabulDateTime(item.createdAt) : "-",
      type: item.type,
      direction: item.direction === "IN" ? "ورودی" : "خروجی",
      amount: money(item.amount),
      account: item.account,
      user: item.user,
      device: item.device,
      note: item.note || "-",
    })) || [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="فروش روز"
          value={money(report?.summary.totalSales || 0)}
          icon={<ShoppingBag />}
        />
        <MetricCard
          label="دریافت روز"
          value={money(report?.summary.moneyIn || 0)}
          icon={<TrendingUp />}
        />
        <MetricCard
          label="خروجی روز"
          value={money(report?.summary.moneyOut || 0)}
          icon={<TrendingDown />}
        />
        <MetricCard
          label="فاکتورها"
          value={new Intl.NumberFormat("en-US").format(report?.summary.saleCount || 0)}
          icon={<FileBarChart />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="size-5 text-primary" />
              گزارش روزانه فروشنده‌ها
            </CardTitle>
            <CardDescription>
              فروش، دریافت نقد/بانک، خروجی‌ها و جریان خالص بر اساس کاربر و دستگاه POS.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={date} onChange={setDate} className="w-52" />
            <Button variant="outline" onClick={() => void loadReport()}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            در حال آماده‌سازی گزارش...
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">بر اساس فروشنده</CardTitle>
            </CardHeader>
            <CardContent>
              <DenseTable
                columns={[
                  { key: "name", label: "فروشنده" },
                  { key: "saleCount", label: "فاکتور" },
                  { key: "totalSales", label: "فروش" },
                  { key: "paidSales", label: "پرداخت فروش" },
                  { key: "remainingSales", label: "باقی" },
                  { key: "cashIn", label: "نقد" },
                  { key: "bankIn", label: "بانک" },
                  { key: "moneyOut", label: "خروجی" },
                  { key: "netCashFlow", label: "خالص" },
                ]}
                rows={reportRowsToDataRows(report?.byCashier || [])}
              />
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">بر اساس دستگاه</CardTitle>
            </CardHeader>
            <CardContent>
              <DenseTable
                columns={[
                  { key: "name", label: "دستگاه" },
                  { key: "saleCount", label: "فاکتور" },
                  { key: "totalSales", label: "فروش" },
                  { key: "cashIn", label: "نقد" },
                  { key: "bankIn", label: "بانک" },
                  { key: "moneyOut", label: "خروجی" },
                  { key: "netCashFlow", label: "خالص" },
                ]}
                rows={reportRowsToDataRows(report?.byDevice || [])}
              />
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">تراکنش‌های اخیر روز</CardTitle>
            </CardHeader>
            <CardContent>
              <DenseTable
                columns={[
                  { key: "date", label: "زمان" },
                  { key: "type", label: "نوع" },
                  { key: "direction", label: "جهت" },
                  { key: "amount", label: "مبلغ" },
                  { key: "account", label: "حساب" },
                  { key: "user", label: "کاربر" },
                  { key: "device", label: "دستگاه" },
                  { key: "note", label: "یادداشت" },
                ]}
                rows={recentRows}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ProductsPage() {
  const navigate = useNavigate();
  const isAdmin = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "null");
      return user?.role === "Admin";
    } catch {
      return false;
    }
  }, []);
  const [products, setProducts] = useState<DataRow[]>([]);
  const [productsSummary, setProductsSummary] = useState({
    total: 0,
    active: 0,
    barcodeCount: 0,
  });
  const [productsPagination, setProductsPagination] = useState<any>(null);
  const [categories, setCategories] = useState<LookupItem[]>([]);
  const [units, setUnits] = useState<LookupItem[]>([]);
  const [warehouses, setWarehouses] = useState<LookupItem[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [barcodeFilter, setBarcodeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [duplicatesDialogOpen, setDuplicatesDialogOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState("");
  const [productUnitLines, setProductUnitLines] = useState<ProductUnitForm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const productsRequestSeqRef = useRef(0);
  const productsRequestAbortRef = useRef<AbortController | null>(null);
  const productLookupsLoadedRef = useRef(false);
  const didMountProductFiltersRef = useRef(false);

  const loadProductsData = async (page = productsPagination?.page || 1) => {
    const requestSeq = productsRequestSeqRef.current + 1;
    productsRequestSeqRef.current = requestSeq;
    productsRequestAbortRef.current?.abort();
    const abortController = new AbortController();
    productsRequestAbortRef.current = abortController;
    setIsLoading(true);
    try {
      const [productRes, lookupResults] = await Promise.all([
        fetch(
          `${API_BASE_URL}/api/products?${new URLSearchParams({
            page: String(page),
            limit: "20",
            search: query.trim(),
            barcodeFilter,
            ...(categoryFilter !== "all" ? { categoryId: categoryFilter } : {}),
          }).toString()}`,
          { signal: abortController.signal },
        ).then((res) => res.json()),
        productLookupsLoadedRef.current
          ? Promise.resolve(null)
          : Promise.all([
              fetch(`${API_BASE_URL}/api/product-categories`, {
                signal: abortController.signal,
              }).then((res) => res.json()),
              fetch(`${API_BASE_URL}/api/units`, {
                signal: abortController.signal,
              }).then((res) => res.json()),
              fetch(`${API_BASE_URL}/api/warehouses`, {
                signal: abortController.signal,
              }).then((res) => res.json()),
              fetch(`${API_BASE_URL}/api/currencies`, {
                signal: abortController.signal,
              }).then((res) => res.json()),
            ]),
      ]);

      const loadedProducts = Array.isArray(productRes?.data)
        ? productRes.data.map((item: unknown) => normalizeRow(item, "اجناس"))
        : [];

      if (requestSeq !== productsRequestSeqRef.current) return;

      setProducts(loadedProducts);
      setProductsSummary(productRes?.summary || { total: 0, active: 0, barcodeCount: 0 });
      setProductsPagination(productRes?.pagination || null);
      if (lookupResults) {
        const [categoryRes, unitRes, warehouseRes, currencyRes] = lookupResults;
        setCategories(Array.isArray(categoryRes?.data) ? categoryRes.data : []);
        setUnits(Array.isArray(unitRes?.data) ? unitRes.data : []);
        setWarehouses(Array.isArray(warehouseRes?.data) ? warehouseRes.data : []);
        setCurrencies(Array.isArray(currencyRes?.data) ? currencyRes.data : []);
        productLookupsLoadedRef.current = true;
      }
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      if (requestSeq !== productsRequestSeqRef.current) return;
      toast.error("داده‌های اجناس از API خوانده نشد");
      setProducts([]);
    } finally {
      if (requestSeq === productsRequestSeqRef.current) {
        setIsLoading(false);
      }
      if (productsRequestAbortRef.current === abortController) {
        productsRequestAbortRef.current = null;
      }
    }
  };

  useEffect(() => {
    void loadProductsData();

    return () => productsRequestAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!didMountProductFiltersRef.current) {
      didMountProductFiltersRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => void loadProductsData(1), 250);
    return () => window.clearTimeout(timer);
  }, [query, barcodeFilter, categoryFilter]);

  const filteredProducts = products;
  const printCurrentProductsPage = () => {
    if (filteredProducts.length === 0) {
      toast.warning("برای چاپ، محصولی در این صفحه وجود ندارد");
      return;
    }
    window.print();
  };

  const openCreate = () => {
    const baseCurrency = currencies.find((item) => item.isBase) || currencies[0];
    setForm({
      ...emptyProductForm,
      baseUnitId: units[0]?.id || "",
      defaultWarehouseId:
        warehouses.find((item: any) => item.isDefault)?.id || warehouses[0]?.id || "",
      openingCurrencyId: baseCurrency?.id || "",
    });
    setProductImageFile(null);
    setProductImagePreview("");
    setProductUnitLines([
      makeProductUnitLine(units, {
        unitId: units[0]?.id || "",
        conversionRate: 1,
        isDefaultPurchase: true,
        isDefaultSale: true,
      }),
    ]);
    setDialogOpen(true);
  };

  const openProductFormFromRecord = async (row: DataRow, mode: "edit" | "duplicate") => {
    try {
      const json = await fetch(`${API_BASE_URL}/api/products/${row.id}`).then((res) => res.json());
      const product = json?.data;
      const defaultSaleUnit =
        product?.units?.find((item: any) => item.isDefaultSale) || product?.units?.[0];
      const defaultPurchaseUnit =
        product?.units?.find((item: any) => item.isDefaultPurchase) || product?.units?.[0];

      setForm({
        id: mode === "edit" ? product.id : "",
        name: mode === "duplicate" ? `${product.name || ""} - کاپی` : product.name || "",
        sku: product.sku || "",
        barcode: mode === "duplicate" ? "" : product.barcode || "",
        description: product.description || "",
        imageUrl: product.imageUrl || "",
        categoryId: product.categoryId || "",
        baseUnitId: product.baseUnitId || "",
        defaultWarehouseId: product.defaultWarehouseId || "",
        hasExpiry: Boolean(product.hasExpiry),
        minStock: Number(product.minStock || 0),
        purchasePrice: Number(defaultPurchaseUnit?.purchasePrice || 0),
        salePrice: Number(defaultSaleUnit?.salePrice || 0),
        openingQuantity: 0,
        openingUnitCost: 0,
        openingCurrencyId: currencies.find((item) => item.isBase)?.id || currencies[0]?.id || "",
        openingExpiryDate: "",
      });
      setProductImageFile(null);
      setProductImagePreview(product.imageUrl ? attachmentUrl(product.imageUrl) : "");
      setProductUnitLines(
        Array.isArray(product.units) && product.units.length > 0
          ? product.units.map((item: any) =>
              makeProductUnitLine(units, {
                unitId: item.unitId,
                conversionRate: Number(item.conversionRate || 1),
                purchasePrice: Number(item.purchasePrice || 0),
                salePrice: Number(item.salePrice || 0),
                isDefaultPurchase: Boolean(item.isDefaultPurchase),
                isDefaultSale: Boolean(item.isDefaultSale),
              }),
            )
          : [
              makeProductUnitLine(units, {
                unitId: product.baseUnitId || units[0]?.id || "",
                conversionRate: 1,
                purchasePrice: Number(defaultPurchaseUnit?.purchasePrice || 0),
                salePrice: Number(defaultSaleUnit?.salePrice || 0),
                isDefaultPurchase: true,
                isDefaultSale: true,
              }),
            ],
      );
      setDialogOpen(true);
    } catch {
      toast.error("خواندن جزئیات محصول ناکام شد");
    }
  };

  const openEdit = (row: DataRow) => {
    void openProductFormFromRecord(row, "edit");
  };

  const openDuplicate = (row: DataRow) => {
    void openProductFormFromRecord(row, "duplicate");
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.baseUnitId) {
      toast.error("نام کالا و واحد پایه ضروری است");
      return;
    }

    const validUnitLines = productUnitLines.filter(
      (line) => line.unitId && line.conversionRate > 0,
    );
    const uniqueUnitIds = new Set(validUnitLines.map((line) => line.unitId));

    if (validUnitLines.length === 0) {
      toast.error("حداقل یک واحد خرید/فروش برای جنس ضروری است");
      return;
    }

    if (uniqueUnitIds.size !== validUnitLines.length) {
      toast.error("واحد تکراری برای یک جنس قابل ثبت نیست");
      return;
    }

    if (!validUnitLines.some((line) => line.unitId === form.baseUnitId)) {
      toast.error("واحد پایه باید در لیست واحدات جنس هم ثبت شود");
      return;
    }

    const normalizedUnitLines = validUnitLines.map((line, index) => ({
      ...line,
      conversionRate: line.unitId === form.baseUnitId ? 1 : line.conversionRate,
      isDefaultPurchase: validUnitLines.some((item) => item.isDefaultPurchase)
        ? line.isDefaultPurchase
        : index === 0,
      isDefaultSale: validUnitLines.some((item) => item.isDefaultSale)
        ? line.isDefaultSale
        : index === 0,
    }));

    if (form.openingQuantity > 0 && (!form.defaultWarehouseId || !form.openingCurrencyId)) {
      toast.error("برای موجودی اولیه، گدام و کرنسی ضروری است");
      return;
    }

    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        description: form.description.trim() || null,
        imageUrl: form.imageUrl || null,
        categoryId: form.categoryId || null,
        baseUnitId: form.baseUnitId,
        defaultWarehouseId: form.defaultWarehouseId || null,
        hasExpiry: form.hasExpiry,
        minStock: form.minStock,
        units: normalizedUnitLines.map((line) => ({
          unitId: line.unitId,
          conversionRate: line.conversionRate,
          purchasePrice: line.purchasePrice || null,
          salePrice: line.salePrice || null,
          isDefaultPurchase: line.isDefaultPurchase,
          isDefaultSale: line.isDefaultSale,
        })),
      };

      const productRes = await fetch(
        form.id ? `${API_BASE_URL}/api/products/${form.id}` : `${API_BASE_URL}/api/products`,
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const productJson = await productRes.json().catch(() => null);

      if (!productRes.ok) {
        throw new Error(productJson?.message || "ثبت محصول ناکام شد");
      }

      const productId = productJson?.data?.id || form.id;

      if (productImageFile && productId) {
        const imageForm = new FormData();
        imageForm.append("file", productImageFile);
        const imageRes = await fetch(`${API_BASE_URL}/api/products/${productId}/image`, {
          method: "POST",
          body: imageForm,
        });
        const imageJson = await imageRes.json().catch(() => null);
        if (!imageRes.ok) {
          throw new Error(imageJson?.message || "محصول ثبت شد، اما عکس آپلود نشد");
        }
      }

      if (!form.id && form.openingQuantity > 0) {
        const openingRes = await fetch(`${API_BASE_URL}/api/inventory/opening-stock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            warehouseId: form.defaultWarehouseId,
            quantity: form.openingQuantity,
            unitCost: openingUnitCost,
            currencyId: form.openingCurrencyId,
            expiryDate: form.hasExpiry ? form.openingExpiryDate || null : null,
            note: "موجودی اولیه از فرم محصول",
          }),
        });
        const openingJson = await openingRes.json().catch(() => null);

        if (!openingRes.ok) {
          throw new Error(openingJson?.message || "محصول ثبت شد، اما موجودی اولیه ثبت نشد");
        }
      }

      toast.success(form.id ? "محصول ویرایش شد" : "محصول جدید ثبت شد");
      setDialogOpen(false);
      await loadProductsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "عملیات محصول ناکام شد");
    }
  };

  const deleteProduct = async (row: DataRow) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/products/${row.id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "حذف محصول ناکام شد");
      }

      toast.info("محصول حذف شد");
      setProducts((current) => current.filter((item) => item.id !== row.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف محصول ناکام شد");
    }
  };

  const printProductBarcode = (row: DataRow) => {
    if (!row.id) {
      toast.error("شناسه محصول پیدا نشد");
      return;
    }

    window.open(
      `${API_BASE_URL}/api/barcodes/products/${row.id}/label?layout=roll&copies=1`,
      "_blank",
    );
  };

  const baseProductUnit = productUnitLines.find((line) => line.unitId === form.baseUnitId);
  const basePurchasePrice = baseProductUnit?.purchasePrice || 0;
  const openingCurrency = currencies.find((item) => item.id === form.openingCurrencyId);
  const openingUnitCost = basePriceInCurrency(basePurchasePrice, openingCurrency);
  const openingCurrencyCode = openingCurrency?.code || openingCurrency?.name || "AFN";
  const syncPricesFromBaseUnit = (
    lines: ProductUnitForm[],
    patch: Partial<Pick<ProductUnitForm, "purchasePrice" | "salePrice">>,
  ) => {
    const currentBase = lines.find((line) => line.unitId === form.baseUnitId);
    const basePurchasePrice = patch.purchasePrice ?? currentBase?.purchasePrice ?? 0;
    const baseSalePrice = patch.salePrice ?? currentBase?.salePrice ?? 0;

    return lines.map((line) => {
      const conversionRate = line.unitId === form.baseUnitId ? 1 : line.conversionRate;

      return {
        ...line,
        conversionRate,
        purchasePrice:
          patch.purchasePrice !== undefined || line.unitId !== form.baseUnitId
            ? Number((basePurchasePrice * conversionRate).toFixed(4))
            : line.purchasePrice,
        salePrice:
          patch.salePrice !== undefined || line.unitId !== form.baseUnitId
            ? Number((baseSalePrice * conversionRate).toFixed(4))
            : line.salePrice,
      };
    });
  };

  return (
    <div className="app-print-page space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="کل اجناس"
          value={new Intl.NumberFormat("en-US").format(productsSummary.total)}
          icon={<Package />}
        />
        <MetricCard
          label="بارکوددار"
          value={new Intl.NumberFormat("en-US").format(productsSummary.barcodeCount)}
          icon={<BarChart3 />}
        />
        <MetricCard
          label="واحدات آماده"
          value={new Intl.NumberFormat("en-US").format(units.length)}
          icon={<Boxes />}
        />
        <MetricCard
          label="کتگوری‌ها"
          value={new Intl.NumberFormat("en-US").format(categories.length)}
          icon={<FileBarChart />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-5 text-primary" />
              اجناس
            </CardTitle>
            <CardDescription>
              تعریف کالا، بارکود، قیمت خرید/فروش، واحد پایه و موجودی اولیه.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی کالا، بارکود، کتگوری..."
                className="w-72 ps-9"
              />
            </div>
            <div className="w-48">
              <Combobox
                value={barcodeFilter}
                onValueChange={setBarcodeFilter}
                placeholder="فیلتر بارکود"
                searchPlaceholder="نوع بارکود..."
                options={[
                  { value: "all", label: "همه اجناس" },
                  { value: "has", label: "بارکوددار" },
                  { value: "missing", label: "بی‌بارکود" },
                  { value: "system", label: "بارکود سیستمی" },
                  { value: "manual", label: "بارکود دستی" },
                ]}
              />
            </div>
            <div className="w-52">
              <Combobox
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                placeholder="فیلتر کتگوری"
                searchPlaceholder="جستجوی کتگوری..."
                options={[
                  { value: "all", label: "همه کتگوری‌ها" },
                  ...categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
              />
            </div>
            <Button variant="outline" onClick={printCurrentProductsPage}>
              <Printer className="size-4" />
              چاپ این صفحه
            </Button>
            <Button variant="outline" onClick={() => void loadProductsData(1)}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            {isAdmin ? (
              <Button variant="outline" onClick={() => setDuplicatesDialogOpen(true)}>
                <ShieldCheck className="size-4" />
                بارکدهای تکراری
              </Button>
            ) : null}
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              ثبت کالا
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن اجناس...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "imageUrl", label: "عکس" },
                { key: "name", label: "نام کالا" },
                { key: "barcode", label: "بارکود/SKU" },
                { key: "category", label: "کتگوری" },
                { key: "unit", label: "واحد پایه" },
                { key: "salePrice", label: "قیمت فروش" },
                { key: "status", label: "وضعیت" },
              ]}
              rows={filteredProducts}
              pagination={productsPagination}
              onPageChange={(page) => void loadProductsData(page)}
              onEdit={openEdit}
              onSecondary={printProductBarcode}
              secondaryLabel="چاپ بارکود"
              extraActions={[
                {
                  label: "سابقه محصول",
                  icon: <History className="size-4" />,
                  onClick: (row) => navigate(`/products/${row.id}/history`),
                },
                {
                  label: "دوپلیکیت",
                  icon: <Copy className="size-4" />,
                  onClick: openDuplicate,
                },
              ]}
              onDelete={deleteProduct}
            />
          )}
        </CardContent>
      </Card>

      <ProductDuplicatesDialog
        open={duplicatesDialogOpen}
        onOpenChange={setDuplicatesDialogOpen}
        onEditProduct={(productId) => openEdit({ id: productId })}
        onMerged={() => loadProductsData(1)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "ویرایش کالا" : "ثبت کالای جدید"}</DialogTitle>
            <DialogDescription>
              اطلاعات اصلی کالا، قیمت‌ها و موجودی اولیه را وارد کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="نام کالا"
                value={form.name}
                onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              />
              <TextField
                label="SKU"
                value={form.sku}
                onChange={(value) => setForm((current) => ({ ...current, sku: value }))}
              />
              <TextField
                label="بارکود (اختیاری)"
                value={form.barcode}
                onChange={(value) => setForm((current) => ({ ...current, barcode: value }))}
              />
              <LookupSelect
                label="کتگوری"
                value={form.categoryId}
                options={categories}
                onChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}
                emptyLabel="بدون کتگوری"
              />
              <LookupSelect
                label="واحد پایه"
                value={form.baseUnitId}
                options={units}
                onChange={(value) => {
                  setForm((current) => ({ ...current, baseUnitId: value }));
                  setProductUnitLines((current) => {
                    if (current.some((line) => line.unitId === value)) {
                      const nextLines = current.map((line) =>
                        line.unitId === value ? { ...line, conversionRate: 1 } : line,
                      );
                      const nextBase = nextLines.find((line) => line.unitId === value);
                      const basePurchasePrice = nextBase?.purchasePrice || 0;
                      const baseSalePrice = nextBase?.salePrice || 0;

                      return nextLines.map((line) => ({
                        ...line,
                        purchasePrice: Number(
                          (
                            basePurchasePrice * (line.unitId === value ? 1 : line.conversionRate)
                          ).toFixed(4),
                        ),
                        salePrice: Number(
                          (
                            baseSalePrice * (line.unitId === value ? 1 : line.conversionRate)
                          ).toFixed(4),
                        ),
                      }));
                    }

                    return [
                      makeProductUnitLine(units, {
                        unitId: value,
                        conversionRate: 1,
                        isDefaultPurchase: current.length === 0,
                        isDefaultSale: current.length === 0,
                      }),
                      ...current,
                    ];
                  });
                }}
              />
              <LookupSelect
                label="گدام پیش‌فرض"
                value={form.defaultWarehouseId}
                options={warehouses}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    defaultWarehouseId: value,
                  }))
                }
                emptyLabel="بدون گدام"
              />
              <NumberField
                label="حد هشدار کمبود موجودی"
                value={form.minStock}
                onChange={(value) => setForm((current) => ({ ...current, minStock: value }))}
              />
              <p className="md:col-span-3 text-xs leading-6 text-muted-foreground">
                این مقدار فقط برای هشدار کمبود موجودی استفاده می‌شود و فروش را متوقف نمی‌کند؛ فروش
                فقط وقتی متوقف می‌شود که موجودی واقعی کافی نباشد.
              </p>
              <NumberField
                label="قیمت خرید عمومی (واحد پایه / AFN)"
                value={baseProductUnit?.purchasePrice || 0}
                onChange={() => undefined}
                disabled
              />
              <NumberField
                label="قیمت فروش عمومی (واحد پایه / AFN)"
                value={baseProductUnit?.salePrice || 0}
                onChange={() => undefined}
                disabled
              />
              <p className="md:col-span-3 text-xs leading-6 text-muted-foreground">
                قیمت عمومی فقط نمایشی است و به صورت خودکار از قیمت واحد پایه خوانده می‌شود. قیمت
                تمام واحدات با کرنسی پایه AFN ثبت می‌شود.
              </p>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 md:grid-cols-[180px_1fr]">
              <div className="grid h-44 place-items-center overflow-hidden border border-border bg-background">
                {productImagePreview ? (
                  <img
                    src={productImagePreview}
                    alt={form.name || "عکس محصول"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid gap-2 text-center text-muted-foreground">
                    <Package className="mx-auto size-10 text-primary" />
                    <span className="text-xs">عکس محصول</span>
                  </div>
                )}
              </div>
              <div className="grid content-center gap-3">
                <div>
                  <strong className="text-sm">عکس برای POS</strong>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    این عکس در کارت محصول صفحه فروش سریع نمایش داده می‌شود. بهتر است عکس واضح، مربع
                    و کمتر از ۵MB باشد.
                  </p>
                </div>
                <label className="inline-flex h-9 w-fit cursor-pointer items-center justify-center gap-2 border border-input bg-background px-3 text-sm font-medium hover:bg-accent">
                  <Upload className="size-4" />
                  انتخاب عکس محصول
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setProductImageFile(file);
                      setProductImagePreview(
                        file
                          ? URL.createObjectURL(file)
                          : form.imageUrl
                            ? attachmentUrl(form.imageUrl)
                            : "",
                      );
                    }}
                  />
                </label>
                {productImageFile || form.imageUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => {
                      setProductImageFile(null);
                      setProductImagePreview("");
                      setForm((current) => ({ ...current, imageUrl: "" }));
                    }}
                  >
                    حذف عکس
                  </Button>
                ) : null}
              </div>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">توضیحات</span>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="توضیح کوتاه درباره کالا"
                rows={4}
                className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </label>

            <button
              type="button"
              className={`${form.hasExpiry ? "border-primary/15 text-primary border-2n" : "border-muted text-muted-foreground"} flex h-10 items-center justify-between rounded-lg border border-border bg-background px-3 text-sm `}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  hasExpiry: !current.hasExpiry,
                  openingExpiryDate: current.hasExpiry ? "" : current.openingExpiryDate,
                }))
              }
            >
              <span>این کالا تاریخ انقضا دارد؟</span>
              <Badge
                className={
                  form.hasExpiry ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }
              >
                {form.hasExpiry ? "بلی" : "نخیر"}
              </Badge>
            </button>

            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">واحدات خرید و فروش</h3>
                  <p className="text-xs text-muted-foreground">
                    نسبت تبدیل یعنی هر واحد انتخاب‌شده چند واحد پایه می‌شود؛ برای واحد پایه همیشه 1
                    ثبت می‌شود.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setProductUnitLines((current) => [...current, makeProductUnitLine(units)])
                  }
                >
                  <Plus className="size-4" />
                  افزودن واحد
                </Button>
              </div>
              <div className="space-y-3">
                {productUnitLines.map((line) => (
                  <div
                    key={line.id}
                    className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 lg:grid-cols-[1.3fr_0.8fr_0.9fr_0.9fr_0.8fr_0.8fr_auto]"
                  >
                    <LookupSelect
                      label="واحد"
                      value={line.unitId}
                      options={units}
                      onChange={(value) =>
                        setProductUnitLines((current) =>
                          syncPricesFromBaseUnit(
                            current.map((item) =>
                              item.id === line.id
                                ? {
                                    ...item,
                                    unitId: value,
                                    conversionRate:
                                      value === form.baseUnitId ? 1 : item.conversionRate,
                                  }
                                : item,
                            ),
                            {},
                          ),
                        )
                      }
                    />
                    <NumberField
                      label="نسبت"
                      value={line.unitId === form.baseUnitId ? 1 : line.conversionRate}
                      onChange={(value) =>
                        setProductUnitLines((current) =>
                          syncPricesFromBaseUnit(
                            current.map((item) =>
                              item.id === line.id
                                ? {
                                    ...item,
                                    conversionRate: line.unitId === form.baseUnitId ? 1 : value,
                                  }
                                : item,
                            ),
                            {},
                          ),
                        )
                      }
                    />
                    <NumberField
                      label="قیمت خرید (AFN)"
                      value={line.purchasePrice}
                      onChange={(value) =>
                        setProductUnitLines((current) =>
                          line.unitId === form.baseUnitId
                            ? syncPricesFromBaseUnit(current, {
                                purchasePrice: value,
                              })
                            : current.map((item) =>
                                item.id === line.id ? { ...item, purchasePrice: value } : item,
                              ),
                        )
                      }
                    />
                    <NumberField
                      label="قیمت فروش (AFN)"
                      value={line.salePrice}
                      onChange={(value) =>
                        setProductUnitLines((current) =>
                          line.unitId === form.baseUnitId
                            ? syncPricesFromBaseUnit(current, {
                                salePrice: value,
                              })
                            : current.map((item) =>
                                item.id === line.id ? { ...item, salePrice: value } : item,
                              ),
                        )
                      }
                    />
                    <label className="flex items-end gap-2 pb-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={line.isDefaultPurchase}
                        onChange={() =>
                          setProductUnitLines((current) =>
                            current.map((item) => ({
                              ...item,
                              isDefaultPurchase: item.id === line.id,
                            })),
                          )
                        }
                      />
                      پیش‌فرض خرید
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={line.isDefaultSale}
                        onChange={() =>
                          setProductUnitLines((current) =>
                            current.map((item) => ({
                              ...item,
                              isDefaultSale: item.id === line.id,
                            })),
                          )
                        }
                      />
                      پیش‌فرض فروش
                    </label>
                    <div className="flex items-end">
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        disabled={productUnitLines.length <= 1}
                        onClick={() =>
                          setProductUnitLines((current) =>
                            current.filter((item) => item.id !== line.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!form.id && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">موجودی اولیه</h3>
                    <p className="text-xs text-muted-foreground">
                      اختیاری است؛ اگر مقدار وارد شود، lot و stock movement افتتاحیه ثبت می‌شود.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <NumberField
                    label="مقدار"
                    value={form.openingQuantity}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        openingQuantity: value,
                      }))
                    }
                  />
                  <NumberField
                    label={`قیمت تمام‌شده واحد (${openingCurrencyCode})`}
                    value={openingUnitCost}
                    onChange={() => undefined}
                    disabled
                  />
                  <LookupSelect
                    label="کرنسی"
                    value={form.openingCurrencyId}
                    options={currencies.map((item) => ({
                      ...item,
                      name: item.code || item.name,
                    }))}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        openingCurrencyId: value,
                      }))
                    }
                  />
                  {form.hasExpiry ? (
                    <TextField
                      label="تاریخ انقضا"
                      value={form.openingExpiryDate}
                      type="date"
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          openingExpiryDate: value,
                        }))
                      }
                    />
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  قیمت تمام‌شده موجودی اولیه از قیمت خرید واحد پایه محصول گرفته می‌شود و براساس
                  کرنسی انتخاب‌شده تبدیل می‌گردد. معادل پایه: {money(basePurchasePrice)}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={saveProduct}>ذخیره کالا</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const emptyInventoryActionForm: InventoryActionForm = {
  type: "ADJUSTMENT_IN",
  productId: "",
  warehouseId: "",
  toWarehouseId: "",
  lotId: "",
  unitId: "",
  quantity: 0,
  unitCost: 0,
  currencyId: "",
  expiryDate: "",
  note: "",
};

const inventoryMovementColumns = [
  { key: "date", label: "تاریخ" },
  { key: "product", label: "جنس" },
  { key: "warehouse", label: "گدام" },
  { key: "lot", label: "Lot" },
  { key: "quantity", label: "مقدار" },
  { key: "status", label: "وضعیت" },
  { key: "user", label: "کاربر" },
  { key: "note", label: "یادداشت/مرجع" },
];

const inventoryTransferColumns = [
  { key: "date", label: "تاریخ" },
  { key: "type", label: "نوع" },
  { key: "product", label: "جنس" },
  { key: "warehouse", label: "گدام" },
  { key: "lot", label: "Lot" },
  { key: "quantity", label: "مقدار" },
  { key: "status", label: "وضعیت" },
  { key: "note", label: "مرجع" },
];

function filterDataRows(rows: DataRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    Object.values(row).some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(normalized),
    ),
  );
}

function InventoryMovementSection({
  title,
  description,
  rows,
  query,
  onQueryChange,
  onRefresh,
  onCreate,
  createLabel,
  columns = inventoryMovementColumns,
  onEdit,
  onCancel,
  from,
  to,
  onFromChange,
  onToChange,
  pagination,
  onPageChange,
}: {
  title: string;
  description: string;
  rows: DataRow[];
  query: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onCreate?: () => void;
  createLabel?: string;
  columns?: Array<{ key: string; label: string }>;
  onEdit?: (row: DataRow) => void;
  onCancel: (row: DataRow) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}) {
  const filteredRows = pagination ? rows : filterDataRows(rows, query);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={from} onChange={onFromChange} className="w-40" />
          <DatePicker value={to} onChange={onToChange} className="w-40" />
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="جستجوی جنس، گدام، lot یا کاربر..."
              className="w-72 ps-9"
            />
          </div>
          <Button variant="outline" onClick={onRefresh}>
            <RefreshCcw className="size-4" />
            تازه‌سازی
          </Button>
          {onCreate ? (
            <Button onClick={onCreate}>
              <Plus className="size-4" />
              {createLabel || "ثبت جدید"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <DenseTable
          columns={columns}
          rows={filteredRows}
          onEdit={onEdit || showReverseRequiredToast}
          editLabel="ویرایش"
          onDelete={onCancel}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      </CardContent>
    </Card>
  );
}

function InventoryPage() {
  type InventoryTabKey = "stock" | "opening" | "increase" | "decrease" | "damage" | "transfer";

  const initialMovementRange = recentDateRange();
  const [stockRows, setStockRows] = useState<DataRow[]>([]);
  const [openingRows, setOpeningRows] = useState<DataRow[]>([]);
  const [increaseRows, setIncreaseRows] = useState<DataRow[]>([]);
  const [decreaseRows, setDecreaseRows] = useState<DataRow[]>([]);
  const [damageRows, setDamageRows] = useState<DataRow[]>([]);
  const [transferRows, setTransferRows] = useState<DataRow[]>([]);
  const [movementFrom, setMovementFrom] = useState(initialMovementRange.from);
  const [movementTo, setMovementTo] = useState(initialMovementRange.to);
  const [movementPages, setMovementPages] = useState({
    stock: 1,
    opening: 1,
    increase: 1,
    decrease: 1,
    damage: 1,
    transfer: 1,
  });
  const [movementPagination, setMovementPagination] = useState<Record<string, any>>({});
  const [lotOptions, setLotOptions] = useState<LookupItem[]>([]);
  const [products, setProducts] = useState<LookupItem[]>([]);
  const [inventoryCategories, setInventoryCategories] = useState<LookupItem[]>([]);
  const [warehouses, setWarehouses] = useState<LookupItem[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeInventoryTab, setActiveInventoryTab] = useState<InventoryTabKey>("stock");
  const [stockSortBy, setStockSortBy] = useState("");
  const [stockSortOrder, setStockSortOrder] = useState<"asc" | "desc">("desc");
  const [stockCostFilter, setStockCostFilter] = useState("");
  const [stockCategoryId, setStockCategoryId] = useState("all");
  const [movementQueries, setMovementQueries] = useState({
    opening: "",
    increase: "",
    decrease: "",
    damage: "",
    transfer: "",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<InventoryActionForm>(emptyInventoryActionForm);
  const [inventoryActionSubmitting, setInventoryActionSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const inventoryLoadSeqRef = useRef(0);
  const inventoryLoadAbortRef = useRef<AbortController | null>(null);
  const inventoryLookupsLoadedRef = useRef(false);
  const inventoryProductSearchSeqRef = useRef(0);
  const inventoryProductSearchAbortRef = useRef<AbortController | null>(null);
  const didMountStockQueryRef = useRef(false);
  const didMountMovementQueryRef = useRef(false);
  const didMountMovementDateRef = useRef(false);
  const [openingEdit, setOpeningEdit] = useState<DataRow | null>(null);
  const [openingEditForm, setOpeningEditForm] = useState({
    quantity: 0,
    unitCost: 0,
    currencyId: "",
    expiryDate: "",
    note: "",
  });
  const [cancelMovement, setCancelMovement] = useState<DataRow | null>(null);
  const [cancelMovementReason, setCancelMovementReason] = useState("");

  useEffect(() => () => inventoryProductSearchAbortRef.current?.abort(), []);

  const normalizeMovementRow = (item: any, cancelledKeys = new Set<string>()): DataRow => {
    const movementKey =
      item.referenceType === "TRANSFER" && item.referenceId
        ? `TRANSFER:${item.referenceId}`
        : `MOVE:${item.id}`;
    const isCancelRow = String(item.referenceType || "").endsWith("_CANCEL");
    const isCancelled = Boolean(item.isCancelled) || isCancelRow || cancelledKeys.has(movementKey);

    return {
      id: item.id,
      referenceId: item.referenceId,
      referenceType: item.referenceType,
      typeRaw: item.type,
      __raw: item,
      date: item.createdAt ? formatKabulDateTime(item.createdAt) : "-",
      product: item.product?.name || "-",
      warehouse: item.warehouse?.name || "-",
      lot: item.lot?.expiryDate
        ? formatKabulDate(item.lot.expiryDate)
        : item.lotId || "-",
      type: inventoryMovementTypeLabel(item.type),
      quantity: `${Number(item.quantity || 0)} ${item.product?.baseUnit?.shortName || item.product?.baseUnit?.name || ""}`,
      status: isCancelled ? "ابطال" : inventoryMovementTypeLabel(item.type),
      __canDelete: !isCancelled,
      __canEdit: !isCancelled,
      user: item.createdByUser?.displayName || item.createdByUser?.username || "-",
      note: item.note || item.referenceId || "-",
    };
  };

  const movementRequestQuery = (page: number, search: string, type?: string) => {
    const params = new URLSearchParams({
      limit: "20",
      page: String(page),
      from: movementFrom,
      to: movementTo,
    });

    if (type) params.set("type", type);
    if (search.trim()) params.set("search", search.trim());

    return params.toString();
  };

  const loadInventoryData = async (
    pages = movementPages,
    queries = movementQueries,
    tab: InventoryTabKey = activeInventoryTab,
    options: { refreshLookups?: boolean } = {},
  ) => {
    const requestSeq = inventoryLoadSeqRef.current + 1;
    inventoryLoadSeqRef.current = requestSeq;
    inventoryLoadAbortRef.current?.abort();
    const abortController = new AbortController();
    inventoryLoadAbortRef.current = abortController;
    setIsLoading(true);

    const loadJson = async (url: string) => {
      const response = await fetch(url, { signal: abortController.signal });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || json?.error?.message || "خواندن اطلاعات ناکام شد");
      }

      return json;
    };

    try {
      let dataUrl = "";
      if (tab === "stock") {
        const stockParams = new URLSearchParams({
          page: String(pages.stock),
          limit: "20",
        });

        if (query.trim()) stockParams.set("search", query.trim());
        if (stockSortBy) {
          stockParams.set("sortBy", stockSortBy);
          stockParams.set("sortOrder", stockSortOrder);
        }
        if (stockCostFilter) {
          stockParams.set("costFilter", stockCostFilter);
        }
        if (stockCategoryId !== "all") {
          stockParams.set("categoryId", stockCategoryId);
        }
        dataUrl = `${API_BASE_URL}/api/inventory/stock?${stockParams.toString()}`;
      } else if (tab === "transfer") {
        dataUrl = `${API_BASE_URL}/api/inventory/transfer-reports?${movementRequestQuery(pages.transfer, queries.transfer)}`;
      } else {
        const movementTypeByTab = {
          opening: "OPENING_STOCK",
          increase: "ADJUSTMENT_IN",
          decrease: "ADJUSTMENT_OUT",
          damage: "DAMAGE",
        } as const;
        dataUrl = `${API_BASE_URL}/api/inventory/movements?${movementRequestQuery(pages[tab], queries[tab], movementTypeByTab[tab])}`;
      }

      const shouldLoadLookups = options.refreshLookups || !inventoryLookupsLoadedRef.current;
      const [dataRes, lookupResults] = await Promise.all([
        loadJson(dataUrl),
        shouldLoadLookups
          ? Promise.all([
              loadJson(`${API_BASE_URL}/api/products/lookup?limit=50`),
              loadJson(`${API_BASE_URL}/api/product-categories/lookup`),
              loadJson(`${API_BASE_URL}/api/warehouses`),
              loadJson(`${API_BASE_URL}/api/currencies`),
            ])
          : Promise.resolve(null),
      ]);

      if (requestSeq !== inventoryLoadSeqRef.current) return;

      if (lookupResults) {
        const [productRes, categoryRes, warehouseRes, currencyRes] = lookupResults;
        setProducts(Array.isArray(productRes?.data) ? productRes.data : []);
        setInventoryCategories(Array.isArray(categoryRes?.data) ? categoryRes.data : []);
        setWarehouses(Array.isArray(warehouseRes?.data) ? warehouseRes.data : []);
        setCurrencies(Array.isArray(currencyRes?.data) ? currencyRes.data : []);
        inventoryLookupsLoadedRef.current = true;
      }

      setMovementPagination((current) => ({
        ...current,
        [tab]: dataRes?.pagination,
      }));

      if (tab === "stock") {
        setStockRows(
          Array.isArray(dataRes?.data)
            ? dataRes.data.map((item: unknown) => normalizeRow(item, "موجودی و گدام"))
            : [],
        );
        return;
      }

      const movementRows = Array.isArray(dataRes?.data) ? dataRes.data : [];
      const movementCancelledKeys = new Set<string>();
      movementRows.forEach((item: any) => {
        if (!String(item.referenceType || "").endsWith("_CANCEL")) return;
        if (item.referenceType === "TRANSFER_CANCEL" && item.referenceId) {
          movementCancelledKeys.add(`TRANSFER:${item.referenceId}`);
        }
        if (item.referenceId) {
          movementCancelledKeys.add(`MOVE:${item.referenceId}`);
        }
      });
      const normalizedRows = movementRows.map((item: any) =>
        normalizeMovementRow(item, movementCancelledKeys),
      );
      const setRowsByTab = {
        opening: setOpeningRows,
        increase: setIncreaseRows,
        decrease: setDecreaseRows,
        damage: setDamageRows,
        transfer: setTransferRows,
      };
      setRowsByTab[tab](normalizedRows);
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      if (requestSeq !== inventoryLoadSeqRef.current) return;

      toast.error(error instanceof Error ? error.message : "داده موجودی از API خوانده نشد");
      const clearRowsByTab = {
        stock: setStockRows,
        opening: setOpeningRows,
        increase: setIncreaseRows,
        decrease: setDecreaseRows,
        damage: setDamageRows,
        transfer: setTransferRows,
      };
      clearRowsByTab[tab]([]);
      setMovementPagination((current) => ({ ...current, [tab]: null }));
    } finally {
      if (requestSeq === inventoryLoadSeqRef.current) {
        setIsLoading(false);
      }
      if (inventoryLoadAbortRef.current === abortController) {
        inventoryLoadAbortRef.current = null;
      }
    }
  };

  useEffect(() => {
    void loadInventoryData(movementPages, movementQueries, activeInventoryTab);

    return () => inventoryLoadAbortRef.current?.abort();
    // loadInventoryData intentionally stays local to keep this page compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInventoryTab]);

  useEffect(() => {
    if (!didMountStockQueryRef.current) {
      didMountStockQueryRef.current = true;
      return;
    }
    if (activeInventoryTab !== "stock") return;

    const timer = window.setTimeout(() => {
      const firstPages = { ...movementPages, stock: 1 };
      setMovementPages(firstPages);
      void loadInventoryData(firstPages, movementQueries, "stock");
    }, 250);

    return () => window.clearTimeout(timer);
    // loadInventoryData intentionally stays local to keep this page compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, stockSortBy, stockSortOrder, stockCostFilter, stockCategoryId]);

  useEffect(() => {
    if (!didMountMovementQueryRef.current) {
      didMountMovementQueryRef.current = true;
      return;
    }
    if (activeInventoryTab === "stock") return;

    const timer = window.setTimeout(() => {
      const firstPages = {
        ...movementPages,
        [activeInventoryTab]: 1,
      };
      setMovementPages(firstPages);
      void loadInventoryData(firstPages, movementQueries, activeInventoryTab);
    }, 250);

    return () => window.clearTimeout(timer);
    // loadInventoryData intentionally stays local to keep this page compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementQueries]);

  useEffect(() => {
    if (!didMountMovementDateRef.current) {
      didMountMovementDateRef.current = true;
      return;
    }
    if (activeInventoryTab === "stock") return;

    const timer = window.setTimeout(() => {
      const firstPages = {
        ...movementPages,
        [activeInventoryTab]: 1,
      };
      setMovementPages(firstPages);
      void loadInventoryData(firstPages, movementQueries, activeInventoryTab);
    }, 250);

    return () => window.clearTimeout(timer);
    // loadInventoryData intentionally stays local to keep this page compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementFrom, movementTo]);

  const searchInventoryProducts = async (value: string) => {
    const query = value.trim();
    const requestSeq = inventoryProductSearchSeqRef.current + 1;
    inventoryProductSearchSeqRef.current = requestSeq;
    inventoryProductSearchAbortRef.current?.abort();

    const abortController = new AbortController();
    inventoryProductSearchAbortRef.current = abortController;

    try {
      const rows = await searchProductLookupOptions(query, abortController.signal);
      if (requestSeq !== inventoryProductSearchSeqRef.current) return;
      setProducts((current) =>
        replaceLookupOptionsKeepingSelected(current, rows, form.productId ? [form.productId] : []),
      );
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      // Product lookup search is best-effort; form submission still validates.
    } finally {
      if (inventoryProductSearchAbortRef.current === abortController) {
        inventoryProductSearchAbortRef.current = null;
      }
    }
  };

  const changeMovementPage = (key: keyof typeof movementPages, page: number) => {
    const next = { ...movementPages, [key]: page };
    setMovementPages(next);
    void loadInventoryData(next, movementQueries, key);
  };

  const refreshInventoryFromFirstPage = () => {
    const firstPages = {
      stock: 1,
      opening: 1,
      increase: 1,
      decrease: 1,
      damage: 1,
      transfer: 1,
    };
    setMovementPages(firstPages);
    void loadInventoryData(firstPages, movementQueries, activeInventoryTab, {
      refreshLookups: true,
    });
  };

  useEffect(() => {
    const shouldLoadLots =
      dialogOpen && form.productId && form.warehouseId && form.type !== "ADJUSTMENT_IN";

    if (!shouldLoadLots) {
      setLotOptions([]);
      return;
    }

    let cancelled = false;

    fetch(
      `${API_BASE_URL}/api/inventory/lots?productId=${form.productId}&warehouseId=${form.warehouseId}`,
    )
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const options = Array.isArray(json?.data)
          ? json.data
              .filter((lot: any) => Number(lot.remainingQuantity || 0) > 0)
              .map((lot: any) => ({
                id: lot.id,
                name: `${Number(lot.remainingQuantity || 0)} ${lot.product?.baseUnit?.shortName || lot.product?.baseUnit?.name || ""} / ${lot.expiryDate ? formatKabulDate(lot.expiryDate) : "بدون انقضا"}`,
              }))
          : [];
        setLotOptions(options);
      })
      .catch(() => setLotOptions([]));

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, form.productId, form.warehouseId, form.type]);

  const setMovementQuery = (key: keyof typeof movementQueries, value: string) => {
    const nextQueries = { ...movementQueries, [key]: value };
    const nextPages = { ...movementPages, [key]: 1 };
    setMovementQueries(nextQueries);
    setMovementPages(nextPages);
  };

  const openOpeningEdit = (row: DataRow) => {
    const raw = row.__raw || {};
    setOpeningEdit(row);
    setOpeningEditForm({
      quantity: Number(raw.quantity || 0),
      unitCost: Number(raw.unitCost || 0),
      currencyId: raw.currencyId || raw.lot?.currencyId || "",
      expiryDate: raw.lot?.expiryDate ? kabulDateString(new Date(raw.lot.expiryDate)) : "",
      note: raw.note || "",
    });
  };

  const submitOpeningEdit = async () => {
    if (!openingEdit) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/inventory/opening-stock/${openingEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: openingEditForm.quantity,
          unitCost: openingEditForm.unitCost,
          currencyId: openingEditForm.currencyId || null,
          expiryDate: openingEditForm.expiryDate || null,
          note: openingEditForm.note || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ویرایش موجودی اولیه ناکام شد");
      }

      toast.success("موجودی اولیه ویرایش شد");
      setOpeningEdit(null);
      await loadInventoryData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ویرایش موجودی اولیه ناکام شد");
    }
  };

  const inventoryUnitOptions = (productId: string): LookupItem[] => {
    const product: any = products.find((item) => item.id === productId);
    const optionMap = new Map<string, LookupItem>();

    if (product?.baseUnitId) {
      optionMap.set(product.baseUnitId, {
        id: product.baseUnitId,
        name: product.baseUnit?.shortName || product.baseUnit?.name || "واحد پایه",
      });
    }

    (product?.units || []).forEach((item: any) => {
      if (!item.unitId) return;
      optionMap.set(item.unitId, {
        id: item.unitId,
        name: `${item.unit?.shortName || item.unit?.name || "واحد"}${
          Number(item.conversionRate || 1) !== 1
            ? ` (${Number(item.conversionRate || 1)} ${product?.baseUnit?.shortName || product?.baseUnit?.name || "پایه"})`
            : ""
        }`,
      });
    });

    return Array.from(optionMap.values());
  };

  const defaultInventoryUnitId = (productId: string) => {
    const product: any = products.find((item) => item.id === productId);
    return (
      product?.units?.find((unit: any) => unit.isDefaultPurchase)?.unitId ||
      product?.baseUnitId ||
      product?.units?.[0]?.unitId ||
      ""
    );
  };

  const inventoryUnitCost = (productId: string, unitId: string, currencyId = form.currencyId) => {
    const product: any = products.find((item) => item.id === productId);
    const unit =
      product?.units?.find((item: any) => item.unitId === unitId) ||
      product?.units?.find((item: any) => item.isDefaultPurchase) ||
      product?.units?.[0];
    const currency = currencies.find((item) => item.id === currencyId);

    return Number(basePriceInCurrency(Number(unit?.purchasePrice || 0), currency).toFixed(4));
  };

  const openAction = (type: InventoryActionForm["type"]) => {
    const baseCurrency = currencies.find((item) => item.isBase) || currencies[0];
    const firstProductId = products[0]?.id || "";
    const unitId = defaultInventoryUnitId(firstProductId);
    setForm({
      ...emptyInventoryActionForm,
      type,
      productId: firstProductId,
      warehouseId: warehouses[0]?.id || "",
      toWarehouseId: warehouses[1]?.id || "",
      lotId: "",
      unitId,
      unitCost:
        type === "ADJUSTMENT_IN"
          ? inventoryUnitCost(firstProductId, unitId, baseCurrency?.id || "")
          : 0,
      currencyId: baseCurrency?.id || "",
    });
    setLotOptions([]);
    setDialogOpen(true);
  };

  const submitInventoryAction = async () => {
    if (inventoryActionSubmitting) return;
    if (!form.productId || !form.warehouseId || form.quantity <= 0) {
      toast.error("جنس، گدام و مقدار معتبر ضروری است");
      return;
    }

    if (
      form.type === "TRANSFER" &&
      (!form.toWarehouseId || form.toWarehouseId === form.warehouseId)
    ) {
      toast.error("برای انتقال، گدام مقصد متفاوت ضروری است");
      return;
    }

    setInventoryActionSubmitting(true);
    try {
      const endpoint =
        form.type === "TRANSFER"
          ? `${API_BASE_URL}/api/inventory/transfers`
          : `${API_BASE_URL}/api/inventory/adjustments`;

      const payload =
        form.type === "TRANSFER"
          ? {
              productId: form.productId,
              fromWarehouseId: form.warehouseId,
              toWarehouseId: form.toWarehouseId,
              lotId: form.lotId || null,
              unitId: form.unitId || null,
              quantity: form.quantity,
              note: form.note || null,
            }
          : {
              productId: form.productId,
              warehouseId: form.warehouseId,
              lotId: form.lotId || null,
              unitId: form.unitId || null,
              type: form.type,
              quantity: form.quantity,
              unitCost: form.unitCost || null,
              currencyId: form.currencyId || null,
              expiryDate: productHasExpiry(products, form.productId)
                ? form.expiryDate || null
                : null,
              note: form.note || null,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "عملیات موجودی ناکام شد");
      }

      toast.success(
        form.type === "TRANSFER"
          ? "انتقال بین گدام‌ها ثبت شد"
          : form.type === "DAMAGE"
            ? "ضایعات ثبت شد"
            : "تعدیل موجودی ثبت شد",
      );
      setDialogOpen(false);
      await loadInventoryData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "عملیات موجودی ناکام شد");
    } finally {
      setInventoryActionSubmitting(false);
    }
  };

  const openInventoryCancel = (row: DataRow) => {
    if (row.referenceType?.endsWith?.("_CANCEL")) {
      toast.info("این حرکت خودش سند ابطال است و دوباره ابطال نمی‌شود.");
      return;
    }

    setCancelMovement(row);
    setCancelMovementReason("");
  };

  const submitInventoryCancel = async () => {
    if (!cancelMovement) return;

    const endpoint =
      cancelMovement.referenceType === "TRANSFER" && cancelMovement.referenceId
        ? `/api/inventory/transfers/${cancelMovement.referenceId}/cancel`
        : `/api/inventory/movements/${cancelMovement.id}/cancel`;

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelMovementReason || null }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال حرکت گدام ناکام شد");
      }

      toast.success("حرکت گدام با سند معکوس ابطال شد");
      setCancelMovement(null);
      setCancelMovementReason("");
      await loadInventoryData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ابطال حرکت گدام ناکام شد");
    }
  };

  return (
    <div className="app-print-page space-y-4">
      <div className="hidden print:block">
        <h1 className="text-lg font-bold">گزارش موجودی فعلی گدام</h1>
        <p className="mt-1 text-xs">
          کتگوری: {inventoryCategories.find((item) => item.id === stockCategoryId)?.name || "همه کتگوری‌ها"}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="ردیف‌های موجودی"
          value={new Intl.NumberFormat("en-US").format(
            movementPagination.stock?.total || stockRows.length,
          )}
          icon={<Boxes />}
        />
        <MetricCard
          label="اجناس آماده"
          value={new Intl.NumberFormat("en-US").format(products.length)}
          icon={<Package />}
        />
        <MetricCard
          label="گدام‌ها"
          value={new Intl.NumberFormat("en-US").format(warehouses.length)}
          icon={<Store />}
        />
        <MetricCard label="عملیات گدام" value="فعال" icon={<RefreshCcw />} />
      </div>

      <Tabs
        value={activeInventoryTab}
        onValueChange={(value) => setActiveInventoryTab(value as InventoryTabKey)}
      >
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="stock">موجودی فعلی</TabsTrigger>
            <TabsTrigger value="opening">موجودی اولیه</TabsTrigger>
            <TabsTrigger value="increase">افزایش موجودی</TabsTrigger>
            <TabsTrigger value="decrease">کاهش موجودی</TabsTrigger>
            <TabsTrigger value="damage">ضایعات</TabsTrigger>
            <TabsTrigger value="transfer">انتقالات</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="stock">
          <Card className="border-border bg-card">
            <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Boxes className="size-5 text-primary" />
                  موجودی فعلی گدام
                </CardTitle>
                <CardDescription>
                  موجودی قابل فروش هر جنس در هر گدام، با نزدیک‌ترین تاریخ انقضا.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="جستجوی جنس، بارکود یا گدام..."
                    className="w-72 ps-9"
                  />
                </div>
                <select
                  value={stockCategoryId}
                  onChange={(event) => {
                    setMovementPages((current) => ({ ...current, stock: 1 }));
                    setStockCategoryId(event.target.value);
                  }}
                  className="h-10 min-w-48 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="فیلتر کتگوری موجودی"
                >
                  <option value="all">همه کتگوری‌ها</option>
                  {inventoryCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <select
                  value={stockSortBy}
                  onChange={(event) => {
                    setMovementPages((current) => ({ ...current, stock: 1 }));
                    setStockSortBy(event.target.value);
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">مرتب‌سازی پیش‌فرض</option>
                  <option value="quantity">بر اساس مقدار</option>
                  <option value="value">بر اساس ارزش موجودی</option>
                </select>
                <select
                  value={stockCostFilter}
                  onChange={(event) => {
                    setMovementPages((current) => ({ ...current, stock: 1 }));
                    setStockCostFilter(event.target.value);
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">همه قیمت‌ها</option>
                  <option value="costAboveSale">آمد بالاتر از فروش</option>
                  <option value="costBelowHalfSale">آمد کمتر از نصف فروش</option>
                </select>
                <select
                  value={stockSortOrder}
                  onChange={(event) => {
                    setMovementPages((current) => ({ ...current, stock: 1 }));
                    setStockSortOrder(event.target.value === "asc" ? "asc" : "desc");
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="desc">زیاد به کم</option>
                  <option value="asc">کم به زیاد</option>
                </select>
                <Button variant="outline" onClick={refreshInventoryFromFirstPage}>
                  <RefreshCcw className="size-4" />
                  تازه‌سازی
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (stockRows.length === 0) {
                      toast.warning("برای چاپ، موجودی در این صفحه وجود ندارد");
                      return;
                    }
                    window.print();
                  }}
                >
                  <Printer className="size-4" />
                  چاپ / PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DenseTable
                columns={[
                  { key: "name", label: "جنس" },
                  { key: "barcode", label: "بارکود" },
                  { key: "warehouse", label: "گدام" },
                  { key: "quantity", label: "مقدار" },
                  { key: "value", label: "ارزش موجودی" },
                  { key: "expiry", label: "نزدیک‌ترین انقضا" },
                  { key: "status", label: "وضعیت" },
                ]}
                rows={stockRows}
                pagination={movementPagination.stock}
                onPageChange={(page) => changeMovementPage("stock", page)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="opening">
          <InventoryMovementSection
            title="موجودی اولیه"
            description="تمام مقدارهایی که هنگام ساخت محصول به عنوان موجودی افتتاحیه ثبت شده‌اند."
            rows={openingRows}
            query={movementQueries.opening}
            onQueryChange={(value) => setMovementQuery("opening", value)}
            onRefresh={refreshInventoryFromFirstPage}
            onEdit={openOpeningEdit}
            onCancel={openInventoryCancel}
            from={movementFrom}
            to={movementTo}
            onFromChange={setMovementFrom}
            onToChange={setMovementTo}
            pagination={movementPagination.opening}
            onPageChange={(page) => changeMovementPage("opening", page)}
          />
        </TabsContent>

        <TabsContent value="increase">
          <InventoryMovementSection
            title="افزایش موجودی"
            description="تمام سندهای ورود/افزایش دستی موجودی در یک جدول مستقل."
            rows={increaseRows}
            query={movementQueries.increase}
            onQueryChange={(value) => setMovementQuery("increase", value)}
            onRefresh={refreshInventoryFromFirstPage}
            onCreate={() => openAction("ADJUSTMENT_IN")}
            createLabel="افزایش جدید"
            onCancel={openInventoryCancel}
            from={movementFrom}
            to={movementTo}
            onFromChange={setMovementFrom}
            onToChange={setMovementTo}
            pagination={movementPagination.increase}
            onPageChange={(page) => changeMovementPage("increase", page)}
          />
        </TabsContent>

        <TabsContent value="decrease">
          <InventoryMovementSection
            title="کاهش موجودی"
            description="تمام سندهای خروج/کاهش دستی موجودی، با امکان جزئیات و ابطال."
            rows={decreaseRows}
            query={movementQueries.decrease}
            onQueryChange={(value) => setMovementQuery("decrease", value)}
            onRefresh={refreshInventoryFromFirstPage}
            onCreate={() => openAction("ADJUSTMENT_OUT")}
            createLabel="کاهش جدید"
            onCancel={openInventoryCancel}
            from={movementFrom}
            to={movementTo}
            onFromChange={setMovementFrom}
            onToChange={setMovementTo}
            pagination={movementPagination.decrease}
            onPageChange={(page) => changeMovementPage("decrease", page)}
          />
        </TabsContent>

        <TabsContent value="damage">
          <InventoryMovementSection
            title="ضایعات"
            description="تمام اجناس ضایع‌شده با lot، گدام، کاربر ثبت‌کننده و ابطال امن."
            rows={damageRows}
            query={movementQueries.damage}
            onQueryChange={(value) => setMovementQuery("damage", value)}
            onRefresh={refreshInventoryFromFirstPage}
            onCreate={() => openAction("DAMAGE")}
            createLabel="ضایعات جدید"
            onCancel={openInventoryCancel}
            from={movementFrom}
            to={movementTo}
            onFromChange={setMovementFrom}
            onToChange={setMovementTo}
            pagination={movementPagination.damage}
            onPageChange={(page) => changeMovementPage("damage", page)}
          />
        </TabsContent>

        <TabsContent value="transfer">
          <InventoryMovementSection
            title="انتقالات گدام"
            description="حرکت‌های ورود و خروج انتقالی؛ ابطال، سند انتقال را به صورت جفت معکوس می‌کند."
            rows={transferRows}
            query={movementQueries.transfer}
            onQueryChange={(value) => setMovementQuery("transfer", value)}
            onRefresh={refreshInventoryFromFirstPage}
            onCreate={() => openAction("TRANSFER")}
            createLabel="انتقال جدید"
            columns={inventoryTransferColumns}
            onCancel={openInventoryCancel}
            from={movementFrom}
            to={movementTo}
            onFromChange={setMovementFrom}
            onToChange={setMovementTo}
            pagination={movementPagination.transfer}
            onPageChange={(page) => changeMovementPage("transfer", page)}
          />
        </TabsContent>
      </Tabs>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!inventoryActionSubmitting) setDialogOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {form.type === "TRANSFER"
                ? "انتقال بین گدام‌ها"
                : form.type === "DAMAGE"
                  ? "ثبت اجناس ضایع"
                  : form.type === "ADJUSTMENT_OUT"
                    ? "کاهش موجودی"
                    : "افزایش موجودی"}
            </DialogTitle>
            <DialogDescription>
              این عملیات stock movement ثبت می‌کند و بعد از ذخیره، جدول موجودی تازه می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <LookupSelect
              label="جنس"
              value={form.productId}
              options={products}
              onSearchChange={searchInventoryProducts}
              onChange={(value) =>
                setForm((current) => {
                  const unitId = defaultInventoryUnitId(value);

                  return {
                    ...current,
                    productId: value,
                    lotId: "",
                    unitId,
                    unitCost:
                      current.type === "ADJUSTMENT_IN"
                        ? inventoryUnitCost(value, unitId, current.currencyId)
                        : current.unitCost,
                    expiryDate: productHasExpiry(products, value) ? current.expiryDate : "",
                  };
                })
              }
            />
            <LookupSelect
              label={form.type === "TRANSFER" ? "گدام مبدا" : "گدام"}
              value={form.warehouseId}
              options={warehouses}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  warehouseId: value,
                  lotId: "",
                }))
              }
            />
            {form.type !== "ADJUSTMENT_IN" && (
              <LookupSelect
                label="Lot / تاریخ انقضا"
                value={form.lotId}
                options={lotOptions}
                emptyLabel="FIFO خودکار"
                onChange={(value) => setForm((current) => ({ ...current, lotId: value }))}
              />
            )}
            {form.type === "TRANSFER" && (
              <LookupSelect
                label="گدام مقصد"
                value={form.toWarehouseId}
                options={warehouses}
                onChange={(value) => setForm((current) => ({ ...current, toWarehouseId: value }))}
              />
            )}
            <LookupSelect
              label="واحد"
              value={form.unitId}
              options={inventoryUnitOptions(form.productId)}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  unitId: value,
                  unitCost:
                    current.type === "ADJUSTMENT_IN"
                      ? inventoryUnitCost(current.productId, value, current.currencyId)
                      : current.unitCost,
                }))
              }
            />
            <NumberField
              label="مقدار"
              value={form.quantity}
              onChange={(value) => setForm((current) => ({ ...current, quantity: value }))}
            />
            {form.productId ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                مقدار پایه:{" "}
                <strong className="text-foreground">
                  {new Intl.NumberFormat("en-US").format(
                    form.quantity *
                      productUnitInfo(products, form.productId, form.unitId).conversionRate,
                  )}{" "}
                  {productUnitInfo(products, form.productId, form.unitId).baseUnitName}
                </strong>
              </div>
            ) : null}
            {form.type === "ADJUSTMENT_IN" && (
              <>
                <NumberField
                  label="قیمت تمام‌شده واحد انتخاب‌شده"
                  value={form.unitCost}
                  onChange={(value) => setForm((current) => ({ ...current, unitCost: value }))}
                />
                <LookupSelect
                  label="کرنسی"
                  value={form.currencyId}
                  options={currencies.map((item) => ({
                    ...item,
                    name: item.code || item.name,
                  }))}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      currencyId: value,
                      unitCost: inventoryUnitCost(current.productId, current.unitId, value),
                    }))
                  }
                />
                {productHasExpiry(products, form.productId) ? (
                  <TextField
                    label="تاریخ انقضا"
                    type="date"
                    value={form.expiryDate}
                    onChange={(value) => setForm((current) => ({ ...current, expiryDate: value }))}
                  />
                ) : null}
              </>
            )}
            <TextField
              label="یادداشت"
              value={form.note}
              onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={inventoryActionSubmitting}
              onClick={() => setDialogOpen(false)}
            >
              لغو
            </Button>
            <Button disabled={inventoryActionSubmitting} onClick={submitInventoryAction}>
              {inventoryActionSubmitting ? "در حال ثبت..." : "ثبت عملیات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(openingEdit)}
        onOpenChange={(open) => {
          if (!open) setOpeningEdit(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ویرایش موجودی اولیه</DialogTitle>
            <DialogDescription>
              اگر از این lot مقداری مصرف شده باشد، مقدار افتتاحیه فقط تا حد مقدار مصرف‌شده قابل کاهش
              است.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div>جنس: {String(openingEdit?.product || "-")}</div>
              <div>گدام: {String(openingEdit?.warehouse || "-")}</div>
              <div>Lot: {String(openingEdit?.lot || "-")}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <NumberField
                label="مقدار افتتاحیه"
                value={openingEditForm.quantity}
                onChange={(value) =>
                  setOpeningEditForm((current) => ({
                    ...current,
                    quantity: value,
                  }))
                }
              />
              <NumberField
                label="قیمت تمام‌شده واحد"
                value={openingEditForm.unitCost}
                onChange={(value) =>
                  setOpeningEditForm((current) => ({
                    ...current,
                    unitCost: value,
                  }))
                }
              />
              <LookupSelect
                label="کرنسی"
                value={openingEditForm.currencyId}
                options={currencies.map((item) => ({
                  ...item,
                  name: item.code || item.name,
                }))}
                onChange={(value) =>
                  setOpeningEditForm((current) => {
                    const fromCurrency = currencies.find((item) => item.id === current.currencyId);
                    const toCurrency = currencies.find((item) => item.id === value);

                    return {
                      ...current,
                      currencyId: value,
                      unitCost: Number(
                        convertCurrencyAmount(current.unitCost, fromCurrency, toCurrency).toFixed(
                          4,
                        ),
                      ),
                    };
                  })
                }
              />
              {productHasExpiry(products, String(openingEdit?.__raw?.productId || "")) ? (
                <TextField
                  label="تاریخ انقضا"
                  type="date"
                  value={openingEditForm.expiryDate}
                  onChange={(value) =>
                    setOpeningEditForm((current) => ({
                      ...current,
                      expiryDate: value,
                    }))
                  }
                />
              ) : null}
              <TextField
                label="یادداشت"
                value={openingEditForm.note}
                onChange={(value) => setOpeningEditForm((current) => ({ ...current, note: value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningEdit(null)}>
              لغو
            </Button>
            <Button onClick={submitOpeningEdit}>ذخیره ویرایش</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelMovement)}
        onOpenChange={(open) => {
          if (!open) setCancelMovement(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال حرکت گدام</DialogTitle>
            <DialogDescription>
              این عملیات یک حرکت معکوس ثبت می‌کند. اگر موجودی بعد از این حرکت مصرف شده باشد، API
              ابطال را رد می‌کند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div>جنس: {String(cancelMovement?.product || "-")}</div>
              <div>گدام: {String(cancelMovement?.warehouse || "-")}</div>
              <div>مقدار: {String(cancelMovement?.quantity || "-")}</div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">دلیل ابطال</span>
              <textarea
                value={cancelMovementReason}
                onChange={(event) => setCancelMovementReason(event.target.value)}
                placeholder="دلیل ابطال حرکت گدام را بنویسید..."
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelMovement(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitInventoryCancel}>
              ابطال با حرکت معکوس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TextField({
  label,
  value,
  type = "text",
  onChange,
  fullWidth = false,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
  fullWidth?: boolean;
}) {
  const isLongText = type === "textarea" || /یادداشت|شرح|توضیح/.test(label);

  return (
    <label
      className={`form-grid-field grid gap-1.5 text-sm ${isLongText || fullWidth ? "form-grid-field-full md:col-span-full" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      {isLongText ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      ) : type === "date" ? (
        <ManualDateInput value={value} onChange={onChange} />
      ) : (
        <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function inventoryMovementTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    OPENING_STOCK: "موجودی اولیه",
    ADJUSTMENT_IN: "افزایش",
    ADJUSTMENT_OUT: "کاهش",
    DAMAGE: "ضایعات",
    TRANSFER_IN: "انتقال ورودی",
    TRANSFER_OUT: "انتقال خروجی",
    PURCHASE: "خرید",
    SALE: "فروش",
    SALE_RETURN: "برگشت فروش",
    PURCHASE_RETURN: "برگشت خرید",
  };

  return labels[String(type || "")] || String(type || "-");
}

function Textarea({
  className = "",
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={`min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 ${className}`}
      {...props}
    />
  );
}

function InvoiceItemsPanel({
  title,
  addLabel,
  emptyLabel,
  unitAmountLabel,
  currencyCode,
  rows,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  addLabel: string;
  emptyLabel: string;
  unitAmountLabel: string;
  currencyCode?: string;
  rows: InvoiceItemRow[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-4" />
          {addLabel}
        </Button>
      </div>

      <Table className="text-xs">
        <TableHeader>
          <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
            <TableHead>جنس</TableHead>
            <TableHead>گدام</TableHead>
            <TableHead>واحد</TableHead>
            <TableHead>مقدار</TableHead>
            <TableHead>واحد پایه</TableHead>
            <TableHead>{unitAmountLabel}</TableHead>
            <TableHead>تخفیف قلم/انقضا</TableHead>
            <TableHead>تخفیف عمومی</TableHead>
            <TableHead>جمع خام</TableHead>
            <TableHead>جمع خالص</TableHead>
            <TableHead>قیمت فروش</TableHead>
            <TableHead>عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="border-border">
                <TableCell className="font-medium">{row.product}</TableCell>
                <TableCell>{row.warehouse}</TableCell>
                <TableCell>{row.unit}</TableCell>
                <TableCell>{row.quantity}</TableCell>
                <TableCell>
                  {row.baseQuantity
                    ? `${new Intl.NumberFormat("en-US").format(row.baseQuantity)} ${row.baseUnit || ""}`
                    : "-"}
                  {row.baseUnitAmount ? (
                    <div className="text-[11px] text-muted-foreground">
                      {money(row.baseUnitAmount, currencyCode)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{money(row.unitAmount, currencyCode)}</TableCell>
                <TableCell>
                  {row.expiryDate || money(Number(row.discount || 0), currencyCode)}
                </TableCell>
                <TableCell>{money(Number(row.generalDiscount || 0), currencyCode)}</TableCell>
                <TableCell>{money(row.total, currencyCode)}</TableCell>
                <TableCell>{money(row.netTotal ?? row.total, currencyCode)}</TableCell>
                <TableCell>
                  {row.salePrice !== undefined ? (
                    <>
                      <div>{money(row.salePrice, currencyCode)}</div>
                      {row.baseSalePrice !== undefined ? (
                        <div className="text-[11px] text-muted-foreground">
                          پایه: {money(row.baseSalePrice, currencyCode)}
                        </div>
                      ) : null}
                      {row.salePriceUpdate ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          آپدیت
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => onEdit(row.id)}>
                      ویرایش
                    </Button>
                    <ConfirmButton
                      size="icon-sm"
                      variant="destructive"
                      title="تایید حذف قلم"
                      description="آیا مطمئن هستید که این قلم از سند حذف شود؟"
                      confirmLabel="حذف"
                      onConfirm={() => onDelete(row.id)}
                    >
                      <Trash2 className="size-4" />
                    </ConfirmButton>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  fullWidth = false,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`form-grid-field grid gap-1.5 text-sm ${fullWidth ? "form-grid-field-full md:col-span-full" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
    </label>
  );
}

function LookupSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange,
  onSearchChange,
  emptyAction,
  fullWidth = false,
}: {
  label: string;
  value: string;
  options: LookupItem[];
  emptyLabel?: string;
  onChange: (value: string) => void;
  onSearchChange?: (value: string) => void;
  emptyAction?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <label
      className={`form-grid-field grid gap-1.5 text-sm ${fullWidth ? "form-grid-field-full md:col-span-full" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <Combobox
        value={value}
        placeholder={emptyLabel || "انتخاب کنید"}
        onValueChange={onChange}
        onSearchChange={onSearchChange}
        emptyAction={emptyAction}
        options={[
          ...(emptyLabel ? [{ value: "", label: emptyLabel }] : []),
          ...options.map((option) => ({
            value: option.id,
            label: option.code || option.shortName || option.name,
            description:
              option.barcode || option.sku
                ? [option.name, option.barcode, option.sku].filter(Boolean).join(" / ")
                : option.code || option.shortName
                  ? option.name
                  : option.shortName || option.code,
            meta:
              option.barcode || option.sku || option.baseUnit?.shortName || option.baseUnit?.name,
            barcode: option.barcode,
            sku: option.sku,
            searchText: [
              option.name,
              option.code,
              option.shortName,
              option.barcode,
              option.sku,
              option.category?.name,
              option.baseUnit?.name,
              option.baseUnit?.shortName,
            ]
              .filter(Boolean)
              .join(" "),
          })),
        ]}
      />
    </label>
  );
}

function MetricCard({
  title,
  label,
  value,
  icon,
  trend,
}: {
  title?: string;
  label?: string;
  value: string;
  icon: ReactNode;
  trend?: string;
}) {
  return (
    <Card className="group overflow-hidden border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <CardContent className="relative flex min-h-28 items-center justify-between gap-3 p-4">
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/70" />
        <div className="absolute -end-8 -top-8 size-24 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/20" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase text-muted-foreground">
            {title || label}
          </p>
          <strong className="mt-2 block truncate font-heading text-2xl font-semibold tracking-normal">
            {value}
          </strong>
          {trend && <span className="mt-1 block truncate text-xs text-primary">{trend}</span>}
        </div>
        <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
          <div className="[&_svg]:size-6">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function normalizeRow(item: any, pageTitle = ""): DataRow {
  const auditMeta = {
    __raw: item,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy:
      item.createdByUser?.displayName ||
      item.createdByUser?.username ||
      item.cashier?.displayName ||
      item.cashier?.username ||
      item.createdByUserId ||
      "-",
    updatedBy:
      item.updatedByUser?.displayName ||
      item.updatedByUser?.username ||
      item.updatedByUserId ||
      "-",
  };

  if (pageTitle === "فروشات") {
    const isCancelled = item.status === "CANCELLED";
    const isPaid = item.paymentStatus === "PAID" || Number(item.remainingAmount || 0) <= 0;
    return {
      id: item.id,
      name: item.invoiceNo || item.id || "-",
      party: item.customer?.name || "مشتری نقدی",
      total: money(item.total || 0, item.currency?.code || "AFN"),
      paid: money(item.paidAmount || 0, item.currency?.code || "AFN"),
      status: isCancelled ? "ابطال" : item.paymentStatus || item.status || "-",
      cogsStatus:
        item.cogsStatus === "POSTED"
          ? "تکمیل"
          : item.cogsStatus === "ZERO_COST"
            ? "هشدار: قیمت صفر"
            : "هشدار: ثبت نشده",
      __canEdit: !isCancelled,
      __canSecondary: !isCancelled && !isPaid,
      __canDelete: !isCancelled,
      ...auditMeta,
    };
  }

  if (pageTitle === "خریداری") {
    const isCancelled = item.status === "CANCELLED";
    const isPaid = item.paymentStatus === "PAID" || Number(item.remainingAmount || 0) <= 0;
    return {
      id: item.id,
      name: item.invoiceNo || item.id || "-",
      supplier: item.supplier?.name || "بدون فروشنده",
      total: money(item.total || 0, item.currency?.code || "AFN"),
      paid: money(item.paidAmount || 0, item.currency?.code || "AFN"),
      status: isCancelled ? "ابطال" : item.paymentStatus || item.status || "-",
      __canEdit: !isCancelled,
      __canSecondary: !isCancelled && !isPaid,
      __canDelete: !isCancelled,
      ...auditMeta,
    };
  }

  if (pageTitle === "اجناس") {
    const baseSaleUnit =
      Array.isArray(item.units) && item.units.length > 0
        ? item.units.find((unit: any) => unit.unitId === item.baseUnitId) || item.units[0]
        : null;

    return {
      id: item.id,
      imageUrl: item.imageUrl || "",
      name: item.name || "-",
      barcode: item.barcode || item.sku || "-",
      category: item.category?.name || "-",
      unit: item.baseUnit?.shortName || item.baseUnit?.name || "-",
      salePrice: baseSaleUnit?.salePrice ? money(baseSaleUnit.salePrice) : "-",
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  if (pageTitle === "موجودی و گدام") {
    const baseUnitName = item.baseUnitName || "";
    const baseUnitCost = Number(item.baseUnitCost || 0);
    const baseSalePrice = Number(item.baseSalePrice || 0);
    const basePurchasePrice = Number(item.basePurchasePrice || 0);
    const isCostAboveSale = Boolean(item.isCostAboveSale);
    const isCostBelowHalfSale = Boolean(item.isCostBelowHalfSale);

    return {
      id: `${item.productId}-${item.warehouseId}`,
      name: item.productName || "-",
      barcode: item.barcode || "-",
      warehouse: item.warehouseName || "-",
      quantity: `${new Intl.NumberFormat("en-US").format(Number(item.totalQuantity || 0))} ${baseUnitName}`,
      value: money(Number(item.valueBase || 0)),
      expiry:
        Array.isArray(item.lots) && item.lots[0]?.expiryDate
          ? formatKabulDate(item.lots[0].expiryDate)
          : "-",
      status: isCostAboveSale
        ? "آمد بالاتر از فروش"
        : isCostBelowHalfSale
          ? "آمد کمتر از نصف فروش"
          : Number(item.totalQuantity || 0) > 0
            ? "موجود"
            : "تمام شده",
      "واحد پایه": baseUnitName || "-",
      "قیمت آمد واحد پایه": `${money(baseUnitCost)} / ${baseUnitName || "واحد"}`,
      "قیمت فروش واحد پایه": `${money(baseSalePrice)} / ${baseUnitName || "واحد"}`,
      "قیمت خرید ثبت‌شده واحد پایه": `${money(basePurchasePrice)} / ${baseUnitName || "واحد"}`,
      "تفاوت آمد و فروش": `${money(baseSalePrice - baseUnitCost)} / ${baseUnitName || "واحد"}`,
      ...auditMeta,
    };
  }

  if (pageTitle === "گدام‌ها") {
    return {
      id: item.id,
      name: item.name || "-",
      location: item.location || "-",
      isDefault: Boolean(item.isDefault),
      isActive: item.isActive !== false,
      status: item.isActive === false ? "غیرفعال" : "فعال",
    };
  }

  if (pageTitle === "واحدات") {
    return {
      id: item.id,
      name: item.name || "-",
      shortName: item.shortName || "-",
      isActive: item.isActive !== false,
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  if (pageTitle === "کتگوری اجناس") {
    return {
      id: item.id,
      name: item.name || "-",
      parentId: item.parentId || "-",
      isActive: item.isActive !== false,
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  if (pageTitle === "کرنسی") {
    return {
      id: item.id,
      code: item.code || "-",
      name: item.name || "-",
      symbol: item.symbol || "-",
      latestRate: item.isBase
        ? "1"
        : item.latestRate
          ? new Intl.NumberFormat("en-US", {
              maximumFractionDigits: 8,
            }).format(Number(item.latestRate))
          : "بدون نرخ",
      latestRateAt: item.latestRateAt
        ? formatKabulDate(item.latestRateAt)
        : "-",
      isBase: Boolean(item.isBase),
      isActive: item.isActive !== false,
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  if (pageTitle === "کتگوری مالی") {
    return {
      id: item.id,
      name: item.name || "-",
      type: item.type || "BOTH",
      description: item.description || "-",
      isActive: item.isActive !== false,
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  if (pageTitle === "عواید و مصارف") {
    const accountName =
      item.cashRegisterAccount?.cashRegister?.name || item.bankAccount?.name || "-";

    return {
      id: item.id,
      referenceId: item.referenceId,
      referenceType: item.referenceType,
      typeRaw: item.type,
      directionRaw: item.direction,
      __raw: item,
      name: item.note || item.referenceType || item.type || "-",
      category: item.category?.name || "-",
      type: item.type === "INCOME" ? "عواید" : "مصرف",
      account: accountName,
      amount: money(item.amount || 0, item.currency?.code || "AFN"),
      status: item.direction === "IN" ? "وارد شده" : "خارج شده",
      ...auditMeta,
    };
  }

  if (pageTitle === "بکاپ") {
    return {
      id: item.id || item.name,
      name: item.name || "-",
      date: item.date ? formatKabulDateTime(item.date) : "-",
      size: item.size || "-",
      status: item.status || "موفق",
    };
  }

  if (pageTitle === "کاربران") {
    return {
      id: item.id,
      username: item.username || "-",
      name: item.displayName || item.name || "-",
      displayName: item.displayName || item.name || "",
      role: item.role?.name || item.roleName || "-",
      roleName: item.role?.name || item.roleName || "",
      status: item.isActive === false ? "غیرفعال" : "فعال",
      ...auditMeta,
    };
  }

  const partyKind: "CUSTOMER" | "SUPPLIER" = item.type === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";

  return {
    id: item.id,
    code: item.code || "-",
    name: item.name || item.invoiceNo || item.title || "-",
    companyName: item.companyName || "-",
    contactPerson: item.contactPerson || "-",
    phone: item.phone || item.secondaryPhone || "-",
    city: item.city || "-",
    creditLimit: item.creditLimit ? money(item.creditLimit) : "-",
    balance: formatPartyBalanceByCurrency(item, partyKind),
    status: item.isActive === false ? "غیرفعال" : "فعال",
    ...auditMeta,
  };
}

const partyFields: Field[] = [
  { key: "code", label: "کد", placeholder: "CUST-001" },
  { key: "name", label: "نام", placeholder: "نام شخص یا دکان" },
  { key: "companyName", label: "نام شرکت" },
  { key: "contactPerson", label: "شخص تماس" },
  { key: "phone", label: "شماره تماس", type: "tel" },
  { key: "secondaryPhone", label: "شماره دوم", type: "tel" },
  { key: "email", label: "ایمیل", type: "email" },
  { key: "taxNumber", label: "شماره مالیاتی" },
  { key: "licenseNumber", label: "شماره جواز" },
  { key: "province", label: "ولایت" },
  { key: "city", label: "شهر" },
  { key: "address", label: "آدرس دقیق" },
  { key: "creditLimit", label: "سقف اعتبار", type: "number" },
  { key: "paymentTermsDays", label: "مهلت پرداخت / روز", type: "number" },
  { key: "note", label: "یادداشت" },
];

const settingsConfigs: AdminPageConfig[] = [
  {
    title: "گدام‌ها",
    description: "تعریف گدام مرکزی، شعبات، موقعیت و گدام پیش‌فرض.",
    endpoint: "/api/warehouses",
    apiCrud: true,
    icon: <Store className="size-4" />,
    stats: [
      { label: "گدام مرکزی", value: "۱", icon: <Store /> },
      { label: "گدام‌های فعال", value: "۶", icon: <Boxes /> },
      { label: "انتقالات", value: "آماده", icon: <RefreshCcw /> },
      { label: "وضعیت", value: "فعال", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "name", label: "نام گدام" },
      { key: "location", label: "موقعیت" },
      { key: "isDefault", label: "پیش‌فرض" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "wh1",
        name: "گدام مرکزی",
        location: "کابل",
        isDefault: "بلی",
        status: "فعال",
      },
    ],
    fields: [
      { key: "name", label: "نام گدام" },
      { key: "location", label: "موقعیت" },
      { key: "isDefault", label: "گدام پیش‌فرض", type: "checkbox" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    note: "گدام پیش‌فرض هنگام ثبت محصول و POS استفاده می‌شود.",
  },
  {
    title: "واحدات",
    description: "تعریف دانه، کارتن، بسته، کیلو، لیتر و واحدات فروش چندواحدی.",
    endpoint: "/api/units",
    apiCrud: true,
    icon: <Boxes className="size-4" />,
    stats: [
      { label: "واحدات", value: "۱۸", icon: <Boxes /> },
      { label: "فروش چندواحدی", value: "فعال", icon: <Package /> },
      { label: "قیمت خودکار", value: "آماده", icon: <Calculator /> },
      { label: "وضعیت", value: "فعال", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "name", label: "نام واحد" },
      { key: "shortName", label: "مخفف" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      { id: "u1", name: "دانه", shortName: "دانه", status: "فعال" },
      { id: "u2", name: "کارتن", shortName: "ctn", status: "فعال" },
    ],
    fields: [
      { key: "name", label: "نام واحد" },
      { key: "shortName", label: "مخفف" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    note: "نسبت بین واحدها در فرم محصول تعریف می‌شود.",
  },
  {
    title: "کتگوری اجناس",
    description: "دسته‌بندی کالاها برای فروش، گزارش، بارکود و موجودی.",
    endpoint: "/api/product-categories",
    apiCrud: true,
    icon: <Package className="size-4" />,
    stats: [
      { label: "کتگوری‌ها", value: "۲۴", icon: <Package /> },
      { label: "مواد خوراکه", value: "فعال", icon: <ShoppingBag /> },
      { label: "گزارش دسته‌بندی", value: "آماده", icon: <FileBarChart /> },
      { label: "وضعیت", value: "فعال", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "name", label: "نام کتگوری" },
      { key: "parentId", label: "والد" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      { id: "cat1", name: "مواد خوراکه", parentId: "-", status: "فعال" },
      { id: "cat2", name: "نوشیدنی‌ها", parentId: "-", status: "فعال" },
    ],
    fields: [
      { key: "name", label: "نام کتگوری" },
      { key: "parentId", label: "شناسه والد" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    note: "برای جلوگیری از خطا، والد فعلا با شناسه ثبت می‌شود؛ انتخاب درختی فاز بعدی است.",
  },
  {
    title: "کرنسی",
    description: "تعریف افغانی، دالر و کرنسی پایه برای محاسبات مالی.",
    endpoint: "/api/currencies",
    apiCrud: true,
    icon: <Banknote className="size-4" />,
    stats: [
      { label: "کرنسی پایه", value: "AFN", icon: <Banknote /> },
      { label: "چند کرنسی", value: "فعال", icon: <CreditCard /> },
      { label: "حساب‌ها", value: "هماهنگ", icon: <Calculator /> },
      { label: "وضعیت", value: "فعال", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "code", label: "کد" },
      { key: "name", label: "نام" },
      { key: "symbol", label: "سمبول" },
      { key: "latestRate", label: "آخرین نرخ" },
      { key: "latestRateAt", label: "تاریخ نرخ" },
      { key: "isBase", label: "پایه" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "cur1",
        code: "AFN",
        name: "افغانی",
        symbol: "AFN",
        isBase: "بلی",
        status: "فعال",
      },
    ],
    fields: [
      { key: "code", label: "کد", placeholder: "AFN" },
      { key: "name", label: "نام", placeholder: "افغانی" },
      { key: "symbol", label: "سمبول", placeholder: "AFN" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    note: "کرنسی پایه سیستم AFN است و برای حفاظت از گزارش‌های تاریخی قابل تغییر نیست.",
  },
  {
    title: "کتگوری مالی",
    description: "تعریف کتگوری عواید و مصارف برای گزارش دخل و خرچ.",
    endpoint: "/api/financial-categories",
    apiCrud: true,
    icon: <WalletCards className="size-4" />,
    stats: [
      { label: "کتگوری عواید", value: "فعال", icon: <TrendingUp /> },
      { label: "کتگوری مصارف", value: "فعال", icon: <TrendingDown /> },
      { label: "گزارش مالی", value: "آماده", icon: <FileBarChart /> },
      { label: "وضعیت", value: "فعال", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "name", label: "نام کتگوری" },
      { key: "type", label: "نوع" },
      { key: "description", label: "توضیح" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "fc1",
        name: "کرایه",
        type: "EXPENSE",
        description: "مصارف کرایه و ترانسپورت",
        status: "فعال",
      },
      {
        id: "fc2",
        name: "خدمات",
        type: "INCOME",
        description: "عواید خدمات اضافی",
        status: "فعال",
      },
    ],
    fields: [
      { key: "name", label: "نام کتگوری" },
      { key: "type", label: "نوع", placeholder: "INCOME / EXPENSE / BOTH" },
      { key: "description", label: "توضیح" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    note: "نوع کتگوری باید INCOME، EXPENSE یا BOTH باشد.",
  },
];

const pageConfigs: AdminPageConfig[] = [
  {
    title: "فروشات",
    description: "فروش عادی، قرض، تخفیف، باقیات، برگشت و چاپ فاکتور.",
    endpoint: "/api/sales",
    icon: <ShoppingBag className="size-5 text-primary" />,
    stats: [
      { label: "فروش امروز", value: money(25480750), icon: <TrendingUp /> },
      { label: "فاکتور فعال", value: "۲۱۸", icon: <ShoppingCart /> },
      { label: "فروش قرض", value: money(6480000), icon: <CreditCard /> },
      { label: "برگشت فروش", value: money(84000), icon: <ArchiveRestore /> },
    ],
    columns: [
      { key: "name", label: "فاکتور" },
      { key: "party", label: "مشتری" },
      { key: "total", label: "مجموع" },
      { key: "paid", label: "پرداخت" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "s1",
        name: "INV-1403-05-25-0017",
        party: "احمد رضایی",
        total: money(1579),
        paid: money(1600),
        status: "تکمیل",
      },
      {
        id: "s2",
        name: "INV-1403-05-25-0018",
        party: "مشتری نقدی",
        total: money(3480),
        paid: money(3480),
        status: "تکمیل",
      },
    ],
    fields: [
      { key: "name", label: "شماره فاکتور" },
      { key: "party", label: "مشتری" },
      { key: "total", label: "مجموع", type: "number" },
      { key: "paid", label: "پرداخت", type: "number" },
    ],
    note: "برگشت فروش و posting مالی در فاز API عمیق‌تر تکمیل می‌شود.",
  },
  {
    title: "خریداری",
    description: "ثبت خرید، خرید امانتی، پرداخت و باقیات فروشندگان.",
    endpoint: "/api/purchases",
    icon: <Truck className="size-5 text-primary" />,
    stats: [
      { label: "خرید ماه", value: money(2180320), icon: <Truck /> },
      { label: "باقیات", value: money(985400), icon: <CreditCard /> },
      { label: "خرید امانتی", value: "۶ فاکتور", icon: <Package /> },
      { label: "برگشت خرید", value: money(32000), icon: <ArchiveRestore /> },
    ],
    columns: [
      { key: "name", label: "فاکتور" },
      { key: "supplier", label: "فروشنده" },
      { key: "total", label: "مجموع" },
      { key: "paid", label: "پرداخت" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "p1",
        name: "PO-1403-089",
        supplier: "شرکت آریانا",
        total: money(42000),
        paid: money(30000),
        status: "باقی‌دار",
      },
      {
        id: "p2",
        name: "PO-1403-090",
        supplier: "مواد غذایی کابل",
        total: money(76000),
        paid: money(76000),
        status: "تکمیل",
      },
    ],
    fields: [
      { key: "name", label: "شماره خرید" },
      { key: "supplier", label: "فروشنده" },
      { key: "total", label: "مجموع", type: "number" },
      { key: "paid", label: "پرداخت", type: "number" },
    ],
    note: "ورود خودکار موجودی و برگشت خرید باید با API مالی/گدامداری کامل وصل شود.",
  },
  {
    title: "موجودی و گدام",
    description: "کنترول موجودی، کمبود، انقضا، انتقال بین گدام‌ها و ضایعات.",
    endpoint: "/api/inventory/stock",
    icon: <Boxes className="size-5 text-primary" />,
    stats: [
      { label: "ارزش موجودی", value: money(4285750), icon: <Boxes /> },
      { label: "اقلام کمبود", value: "۱۶۳", icon: <TrendingDown /> },
      { label: "نزدیک انقضا", value: "۲۷۸", icon: <ArchiveRestore /> },
      { label: "تعداد گدام‌ها", value: "۶", icon: <Store /> },
    ],
    columns: [
      { key: "name", label: "جنس" },
      { key: "barcode", label: "بارکود" },
      { key: "warehouse", label: "گدام" },
      { key: "quantity", label: "مقدار" },
      { key: "expiry", label: "انقضا" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "i1",
        name: "روغن آفتابگردان ۱.۵ لیتر",
        warehouse: "گدام مرکزی",
        quantity: 73,
        expiry: "۱۴۰۴/۰۶/۱۰",
        status: "موجود",
      },
      {
        id: "i2",
        name: "چای سبز ۵۰۰ گرام",
        warehouse: "گدام مرکزی",
        quantity: 6,
        expiry: "۱۴۰۴/۰۵/۲۵",
        status: "نزدیک انقضا",
      },
    ],
    fields: [
      { key: "name", label: "نام جنس" },
      { key: "warehouse", label: "گدام" },
      { key: "quantity", label: "مقدار", type: "number" },
      { key: "expiry", label: "تاریخ انقضا" },
    ],
    note: "انتقال، تعدیل و ضایعات فعلا UI آماده دارد و در فاز API تکمیل می‌شود.",
  },
  {
    title: "اجناس",
    description: "تعریف کالا، بارکود، واحدات چندگانه، قیمت خرید و فروش.",
    endpoint: "/api/products",
    icon: <Package className="size-5 text-primary" />,
    stats: [
      { label: "کل اجناس", value: "۳,۴۵۷", icon: <Package /> },
      { label: "بارکوددار", value: "۲,۹۸۰", icon: <BarChart3 /> },
      { label: "چندواحدی", value: "۶۴۰", icon: <Boxes /> },
      { label: "غیرفعال", value: "۴۸", icon: <TrendingDown /> },
    ],
    columns: [
      { key: "name", label: "نام کالا" },
      { key: "barcode", label: "بارکود" },
      { key: "category", label: "کتگوری" },
      { key: "unit", label: "واحد پایه" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "pr1",
        name: "برنج باسمتی ۵ کیلو",
        barcode: "6281001234567",
        category: "مواد خوراکه",
        unit: "بسته",
        status: "فعال",
      },
      {
        id: "pr2",
        name: "نوشابه کولا ۱.۵ لیتر",
        barcode: "6267005678903",
        category: "نوشیدنی‌ها",
        unit: "بطری",
        status: "فعال",
      },
    ],
    fields: [
      { key: "name", label: "نام کالا" },
      { key: "barcode", label: "بارکود" },
      { key: "category", label: "کتگوری" },
      { key: "unit", label: "واحد پایه" },
    ],
    note: "ثبت واقعی محصول نیاز به انتخاب واحد پایه و کتگوری از API دارد؛ این صفحه فعلا لیست و قالب CRUD را آماده می‌کند.",
  },
  {
    title: "مشتریان",
    description: "پروفایل کامل مشتری، اعتبار، مانده حساب، معاملات و ledger.",
    endpoint: "/api/parties?type=CUSTOMER",
    createType: "CUSTOMER",
    icon: <UsersRound className="size-5 text-primary" />,
    stats: [
      { label: "مشتریان فعال", value: "۱,۲۴۰", icon: <UsersRound /> },
      { label: "طلب کل", value: money(1270650), icon: <CreditCard /> },
      { label: "اعتبار عبور کرده", value: "۱۸ مشتری", icon: <TrendingDown /> },
      { label: "پرداخت امروز", value: money(156000), icon: <Banknote /> },
    ],
    columns: [
      { key: "code", label: "کد" },
      { key: "name", label: "نام" },
      { key: "companyName", label: "شرکت" },
      { key: "phone", label: "تماس" },
      { key: "city", label: "شهر" },
      { key: "creditLimit", label: "سقف اعتبار" },
      { key: "balance", label: "مانده" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "c1",
        code: "C-001",
        name: "احمد رضایی",
        companyName: "مارکیت رضایی",
        phone: "0770000000",
        city: "کابل",
        creditLimit: money(80000),
        balance: money(48560),
        status: "فعال",
      },
    ],
    fields: partyFields,
    note: "این صفحه به API واقعی Party وصل است و فیلدهای جدید بعد از migration ذخیره می‌شوند.",
  },
  {
    title: "فروشندگان",
    description: "پروفایل فروشنده، شرایط پرداخت، بدهی‌ها و خریدهای اخیر.",
    endpoint: "/api/parties?type=SUPPLIER",
    createType: "SUPPLIER",
    icon: <Building2 className="size-5 text-primary" />,
    stats: [
      { label: "فروشندگان فعال", value: "۳۲۰", icon: <Building2 /> },
      { label: "بدهی کل", value: money(985400), icon: <CreditCard /> },
      { label: "پرداخت هفته", value: money(220000), icon: <Banknote /> },
      { label: "خریدهای باز", value: "۶ فاکتور", icon: <Truck /> },
    ],
    columns: [
      { key: "code", label: "کد" },
      { key: "name", label: "نام" },
      { key: "companyName", label: "شرکت" },
      { key: "contactPerson", label: "شخص تماس" },
      { key: "phone", label: "تماس" },
      { key: "balance", label: "مانده" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "v1",
        code: "S-001",
        name: "شرکت آریانا تامین",
        companyName: "آریانا",
        contactPerson: "ناصر احمدی",
        phone: "0790000000",
        balance: money(985400),
        status: "فعال",
      },
    ],
    fields: partyFields,
    note: "این صفحه به API واقعی Party وصل است و فروشنده‌ها با type=SUPPLIER ذخیره می‌شوند.",
  },
  {
    title: "صندوق و بانک",
    description: "حساب خزانه، صندوق‌ها، بانک/صرافی و انتقالات مالی.",
    icon: <Landmark className="size-5 text-primary" />,
    stats: [
      { label: "نقد صندوق", value: money(1230400), icon: <Banknote /> },
      { label: "بانک", value: money(860000), icon: <Landmark /> },
      { label: "انتقالات امروز", value: "۹", icon: <RefreshCcw /> },
      { label: "اختلاف", value: money(0), icon: <Calculator /> },
    ],
    columns: [
      { key: "name", label: "حساب" },
      { key: "type", label: "نوع" },
      { key: "currency", label: "کرنسی" },
      { key: "balance", label: "مانده" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "cb1",
        name: "صندوق مرکزی",
        type: "Cash",
        currency: "AFN",
        balance: money(1230400),
        status: "فعال",
      },
      {
        id: "cb2",
        name: "حساب عزیزی بانک",
        type: "Bank",
        currency: "AFN",
        balance: money(860000),
        status: "فعال",
      },
    ],
    fields: [
      { key: "name", label: "نام حساب" },
      { key: "type", label: "نوع حساب" },
      { key: "currency", label: "کرنسی" },
      { key: "balance", label: "مانده", type: "number" },
    ],
    note: "انتقال بین صندوق/بانک باید balanced journal بسازد؛ فعلا UI و جدول آماده است.",
  },
  {
    title: "عواید و مصارف",
    description: "مصارف عمومی، عواید اضافی، کتگوری‌ها و گزارش دخل و خرچ.",
    endpoint: "/api/income-expenses",
    apiCrud: true,
    canEdit: false,
    canDelete: false,
    icon: <WalletCards className="size-5 text-primary" />,
    stats: [
      { label: "عواید امروز", value: money(346250), icon: <TrendingUp /> },
      { label: "مصارف امروز", value: money(218490), icon: <TrendingDown /> },
      { label: "کتگوری‌ها", value: "۲۴", icon: <Boxes /> },
      { label: "سندهای باز", value: "۴", icon: <FileBarChart /> },
    ],
    columns: [
      { key: "name", label: "شرح" },
      { key: "category", label: "کتگوری" },
      { key: "type", label: "نوع" },
      { key: "account", label: "حساب" },
      { key: "amount", label: "مبلغ" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "e1",
        name: "کرایه انتقال کالا",
        category: "ترانسپورت",
        type: "مصرف",
        amount: money(21500),
        status: "ثبت شده",
      },
      {
        id: "e2",
        name: "عواید خدمات بسته‌بندی",
        category: "خدمات",
        type: "عواید",
        amount: money(8600),
        status: "ثبت شده",
      },
    ],
    fields: [
      { key: "kind", label: "نوع", placeholder: "INCOME یا EXPENSE" },
      { key: "currencyId", label: "شناسه کرنسی" },
      { key: "accountType", label: "نوع حساب", placeholder: "CASH یا BANK" },
      { key: "accountId", label: "شناسه حساب" },
      { key: "categoryId", label: "شناسه کتگوری مالی" },
      { key: "amount", label: "مبلغ", type: "number" },
      { key: "note", label: "شرح" },
    ],
    note: "ویرایش/حذف مستقیم تراکنش مالی بسته است؛ اصلاحات باید در آینده با سند reversal انجام شود.",
  },
  {
    title: "گزارشات",
    description: "گزارش فروش، خرید، مفاد/ضرر، سرمایه، موجودی و کاربران.",
    icon: <FileBarChart className="size-5 text-primary" />,
    stats: [
      { label: "گزارشات آماده", value: "۱۴", icon: <FileBarChart /> },
      { label: "چاپ امروز", value: "۲۶", icon: <BarChart3 /> },
      { label: "فیلترهای فعال", value: "۸", icon: <Search /> },
      { label: "خروجی‌ها", value: "PDF / Print", icon: <DatabaseBackup /> },
    ],
    columns: [
      { key: "name", label: "گزارش" },
      { key: "scope", label: "بخش" },
      { key: "period", label: "دوره" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "r1",
        name: "Profit & Loss",
        scope: "مالی",
        period: "ماهانه",
        status: "آماده",
      },
      {
        id: "r2",
        name: "پرفروش‌ترین اجناس",
        scope: "فروش",
        period: "روزانه/ماهانه",
        status: "آماده",
      },
    ],
    fields: [
      { key: "name", label: "نام گزارش" },
      { key: "scope", label: "بخش" },
      { key: "period", label: "دوره" },
    ],
    note: "گزارش‌ها باید به endpointهای aggregation واقعی وصل شوند.",
  },
  {
    title: "کاربران",
    description: "تعریف کاربران، رول‌ها، صلاحیت‌ها و فروش هر کارمند.",
    endpoint: "/api/users",
    apiCrud: true,
    icon: <ShieldCheck className="size-5 text-primary" />,
    stats: [
      { label: "کاربران فعال", value: "۱۲", icon: <UsersRound /> },
      { label: "رول‌ها", value: "۵", icon: <ShieldCheck /> },
      { label: "فروش کارمندان", value: money(640000), icon: <TrendingUp /> },
      { label: "عملیات حساس", value: "۳۴", icon: <Settings /> },
    ],
    columns: [
      { key: "username", label: "نام کاربری" },
      { key: "name", label: "کاربر" },
      { key: "role", label: "رول" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "u1",
        name: "احمد شایان",
        role: "صندوق‌دار",
        branch: "مرکزی",
        status: "فعال",
      },
      {
        id: "u2",
        name: "مدیر سیستم",
        role: "Admin",
        branch: "مرکزی",
        status: "فعال",
      },
    ],
    fields: [
      { key: "username", label: "نام کاربری" },
      { key: "displayName", label: "نام کامل" },
      { key: "password", label: "رمز عبور" },
      {
        key: "roleName",
        label: "رول",
        placeholder: "Admin / Manager / Cashier / Inventory / Accountant",
      },
    ],
    note: "این صفحه به API واقعی کاربران وصل است؛ برای ویرایش بدون تغییر رمز، فیلد رمز را خالی بگذارید.",
  },
  {
    title: "تنظیمات",
    description: "گدام، واحدات، کرنسی، کتگوری‌ها، شرکت، فاکتور، بارکود و زبان.",
    icon: <Settings className="size-5 text-primary" />,
    stats: [
      { label: "گدام‌ها", value: "۶", icon: <Store /> },
      { label: "واحدات", value: "۱۸", icon: <Boxes /> },
      { label: "کرنسی", value: "AFN", icon: <Banknote /> },
      { label: "زبان", value: "دری", icon: <Settings /> },
    ],
    columns: [
      { key: "name", label: "تنظیم" },
      { key: "group", label: "گروپ" },
      { key: "value", label: "مقدار" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "set1",
        name: "قالب فاکتور",
        group: "چاپ",
        value: "۸۰mm",
        status: "فعال",
      },
      {
        id: "set2",
        name: "زبان سیستم",
        group: "عمومی",
        value: "دری",
        status: "فعال",
      },
    ],
    fields: [
      { key: "name", label: "نام تنظیم" },
      { key: "group", label: "گروپ" },
      { key: "value", label: "مقدار" },
    ],
    note: "تنظیمات موجود API دارد، اما صفحه‌ی unified settings هنوز باید به endpointها وصل شود.",
  },
  {
    title: "بکاپ",
    description: "بکاپ منظم، Restore، حذف نسخه‌های اضافی و مسیر ذخیره.",
    endpoint: "/api/backups",
    apiCrud: true,
    canEdit: false,
    icon: <DatabaseBackup className="size-5 text-primary" />,
    stats: [
      { label: "آخرین بکاپ", value: "امروز", icon: <DatabaseBackup /> },
      { label: "نسخه‌ها", value: "۷", icon: <ArchiveRestore /> },
      { label: "حجم", value: "۲.۴GB", icon: <Boxes /> },
      { label: "وضعیت", value: "امن", icon: <ShieldCheck /> },
    ],
    columns: [
      { key: "name", label: "نسخه" },
      { key: "date", label: "تاریخ" },
      { key: "size", label: "حجم" },
      { key: "status", label: "وضعیت" },
    ],
    rows: [
      {
        id: "b1",
        name: "backup-1405-02-09",
        date: "۱۴۰۵/۰۲/۰۹",
        size: "340MB",
        status: "موفق",
      },
      {
        id: "b2",
        name: "backup-1405-02-08",
        date: "۱۴۰۵/۰۲/۰۸",
        size: "338MB",
        status: "موفق",
      },
    ],
    fields: [
      { key: "name", label: "نام بکاپ" },
      { key: "date", label: "تاریخ" },
      { key: "size", label: "حجم" },
    ],
    note: "بکاپ واقعی به endpoint محلی وصل است؛ Restore فعلا فایل را validate و preview می‌کند تا قبل از workflow کامل دیتابیس، داده‌ها overwrite نشوند.",
  },
];

export default App;
