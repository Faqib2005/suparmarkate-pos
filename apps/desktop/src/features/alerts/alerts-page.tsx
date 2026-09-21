import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Boxes,
  CalendarClock,
  Gauge,
  PackageX,
  Printer,
  RefreshCcw,
  Search,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/features/admin/components/metric-card";
import { CompanyPrintHeader, type PrintCompany } from "@/features/printing/company-print-header";
import { API_BASE_URL } from "@/lib/api-config";

type AlertSeverity = "critical" | "warning" | "info";

type SystemAlert = {
  id: string;
  category: "stock" | "expiry" | "credit" | string;
  type: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  entityName: string;
  entityType: string;
  barcode?: string | null;
  warehouseName?: string | null;
  quantity?: number;
  amount?: number;
  threshold?: number;
  unitName?: string;
  currencyCode?: string;
  expiryDate?: string | null;
  createdAt?: string | null;
};

type AlertsResponse = {
  days: number;
  counts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    outOfStock: number;
    lowStock: number;
    highStock: number;
    expired: number;
    expiringSoon: number;
    creditLimit: number;
  };
  alerts: SystemAlert[];
};

type ProductCategory = {
  id: string;
  name: string;
};

const defaultCounts: AlertsResponse["counts"] = {
  total: 0,
  critical: 0,
  warning: 0,
  info: 0,
  outOfStock: 0,
  lowStock: 0,
  highStock: 0,
  expired: 0,
  expiringSoon: 0,
  creditLimit: 0,
};

const number = (value: unknown) =>
  new Intl.NumberFormat("en-US").format(Number(value || 0));

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
  }).format(date);
}

function severityLabel(severity: AlertSeverity) {
  if (severity === "critical") return "بحرانی";
  if (severity === "warning") return "هشدار";
  return "معلومات";
}

function severityClass(severity: AlertSeverity) {
  if (severity === "critical") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (severity === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }

  return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

function categoryLabel(category: string) {
  if (category === "stock") return "موجودی";
  if (category === "expiry") return "تاریخ انقضا";
  if (category === "credit") return "کریدیت";
  return "عمومی";
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    OUT_OF_STOCK: "ناموجودی",
    LOW_STOCK: "کمبود موجودی",
    HIGH_STOCK: "موجودی زیاد",
    EXPIRED: "تاریخ گذشته",
    EXPIRING_SOON: "نزدیک انقضا",
    CUSTOMER_CREDIT_LIMIT: "حد اعتبار مشتری",
    SUPPLIER_CREDIT_LIMIT: "حد اعتبار تأمین‌کننده",
  };

  return labels[type] || type;
}

function alertValue(alert: SystemAlert) {
  if (alert.category === "credit") {
    return `${number(alert.amount)} ${alert.currencyCode || ""}`;
  }

  if (typeof alert.quantity === "number") {
    return `${number(alert.quantity)} ${alert.unitName || ""}`;
  }

  return "-";
}

function alertThreshold(alert: SystemAlert) {
  if (typeof alert.threshold !== "number") return "-";
  if (alert.category === "credit") {
    return `${number(alert.threshold)} ${alert.currencyCode || ""}`;
  }

  return `${number(alert.threshold)} ${alert.unitName || ""}`;
}

function filterByTab(alert: SystemAlert, tab: string) {
  if (tab === "all") return true;
  if (tab === "critical") return alert.severity === "critical";
  return alert.category === tab;
}

export function AlertsPage() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<PrintCompany | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoryId, setCategoryId] = useState("all");

  const loadAlerts = async () => {
    setIsLoading(true);

    try {
      const params = new URLSearchParams({ days: "30" });
      if (categoryId !== "all") params.set("categoryId", categoryId);
      const res = await fetch(`${API_BASE_URL}/api/alerts?${params.toString()}`);
      if (!res.ok) throw new Error("خواندن هشدارها ناکام شد");

      const json = await res.json();
      setData(json.data);
    } catch {
      toast.error("خواندن هشدارهای سیستم ناکام شد");
      setData({
        days: 30,
        counts: defaultCounts,
        alerts: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [categoryId]);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/settings/company`).then((response) => response.json()),
      fetch(`${API_BASE_URL}/api/product-categories/lookup`).then((response) =>
        response.json(),
      ),
    ])
      .then(([companyJson, categoryJson]) => {
        setCompany(companyJson.data || null);
        setCategories(Array.isArray(categoryJson?.data) ? categoryJson.data : []);
      })
      .catch(() => {
        setCompany(null);
        setCategories([]);
      });
  }, []);

  const alerts = data?.alerts || [];
  const counts = data?.counts || defaultCounts;
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAlerts = useMemo(
    () =>
      alerts.filter((alert) => {
        const matchesTab = filterByTab(alert, tab);
        const haystack = [
          alert.title,
          alert.description,
          alert.entityName,
          alert.barcode,
          alert.warehouseName,
          typeLabel(alert.type),
          categoryLabel(alert.category),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return matchesTab && (!normalizedQuery || haystack.includes(normalizedQuery));
      }),
    [alerts, normalizedQuery, tab],
  );

  return (
    <div className="app-print-page space-y-4">
      <CompanyPrintHeader company={company} title="گزارش هشدارهای سیستم" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="کل هشدارها"
          value={number(counts.total)}
          icon={<Bell />}
          trend={`${number(counts.critical)} بحرانی`}
        />
        <MetricCard
          title="ناموجودی"
          value={number(counts.outOfStock)}
          icon={<PackageX />}
          trend="اجناس بدون موجودی"
        />
        <MetricCard
          title="کمبود موجودی"
          value={number(counts.lowStock)}
          icon={<Boxes />}
          trend="زیر حداقل تعریف‌شده"
        />
        <MetricCard
          title="تاریخ انقضا"
          value={number(counts.expired + counts.expiringSoon)}
          icon={<CalendarClock />}
          trend={`${number(counts.expired)} تاریخ گذشته`}
        />
        <MetricCard
          title="کریدیت لیمیت"
          value={number(counts.creditLimit)}
          icon={<UsersRound />}
          trend="مشتری و تأمین‌کننده"
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-primary" />
              مرکز هشدارهای سیستم
            </CardTitle>
            <CardDescription>
              ناموجودی، کمبود موجودی، موجودی زیاد، تاریخ انقضا و کریدیت لیمیت در یک صفحه.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative min-w-64">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجو در هشدارها..."
                className="ps-9"
              />
            </div>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-10 min-w-48 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="فیلتر کتگوری محصول"
            >
              <option value="all">همه کتگوری‌ها</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={loadAlerts} disabled={isLoading}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={isLoading}>
              <Printer className="size-4" />
              چاپ / PDF
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {selectedCategory && (
            <p className="mb-3 text-xs text-muted-foreground">
              کتگوری انتخاب‌شده: {selectedCategory.name}
            </p>
          )}
          <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-muted/50 p-1 print:hidden">
              <TabsTrigger value="all">همه ({number(counts.total)})</TabsTrigger>
              <TabsTrigger value="critical">
                بحرانی ({number(counts.critical)})
              </TabsTrigger>
              <TabsTrigger value="stock">
                موجودی ({number(counts.outOfStock + counts.lowStock + counts.highStock)})
              </TabsTrigger>
              <TabsTrigger value="expiry">
                انقضا ({number(counts.expired + counts.expiringSoon)})
              </TabsTrigger>
              <TabsTrigger value="credit">
                کریدیت ({number(counts.creditLimit)})
              </TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-0">
              <div className="overflow-hidden rounded-xl border border-border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>درجه</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>مورد</TableHead>
                      <TableHead>گدام/حساب</TableHead>
                      <TableHead>مقدار فعلی</TableHead>
                      <TableHead>حد مجاز</TableHead>
                      <TableHead>تاریخ انقضا</TableHead>
                      <TableHead>توضیح</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                          در حال خواندن هشدارها...
                        </TableCell>
                      </TableRow>
                    ) : filteredAlerts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                          هشداری برای نمایش وجود ندارد
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAlerts.map((alert) => (
                        <TableRow
                          key={alert.id}
                          className={
                            alert.severity === "critical"
                              ? "border-destructive/20 bg-destructive/5"
                              : undefined
                          }
                        >
                          <TableCell>
                            <Badge className={severityClass(alert.severity)}>
                              {severityLabel(alert.severity)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">{typeLabel(alert.type)}</span>
                              <span className="text-muted-foreground">
                                {categoryLabel(alert.category)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">{alert.entityName}</span>
                              {alert.barcode && (
                                <span className="text-muted-foreground">
                                  بارکد: {alert.barcode}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{alert.warehouseName || alert.currencyCode || "-"}</TableCell>
                          <TableCell>{alertValue(alert)}</TableCell>
                          <TableCell>{alertThreshold(alert)}</TableCell>
                          <TableCell>{formatDate(alert.expiryDate)}</TableCell>
                          <TableCell className="max-w-72 whitespace-normal leading-6">
                            {alert.description}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="grid gap-3 p-4 text-xs text-muted-foreground md:grid-cols-3">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3">
            <AlertTriangle className="mt-0.5 size-4 text-destructive" />
            <span>هشدار بحرانی یعنی نیاز به اقدام فوری، مثل ناموجودی یا جنس تاریخ‌گذشته.</span>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3">
            <CalendarClock className="mt-0.5 size-4 text-amber-500" />
            <span>تاریخ انقضا به صورت پیش‌فرض تا ۳۰ روز آینده بررسی می‌شود.</span>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3">
            <Gauge className="mt-0.5 size-4 text-sky-500" />
            <span>موجودی خیلی زیاد با مقایسه موجودی فعلی و حداقل موجودی محصول محاسبه می‌شود.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
