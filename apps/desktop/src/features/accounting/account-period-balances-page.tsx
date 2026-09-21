import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpenCheck,
  Printer,
  RefreshCcw,
  Search,
  Store,
  WalletCards,
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
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
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
import { API_BASE_URL } from "@/lib/api-config";
import { kabulDateString, kabulMonthStartString } from "@/lib/kabul-date";
import { formatMoney, useBaseCurrencyCode } from "@/lib/use-base-currency";

type ReportTab = "all" | "account" | "party";

type AccountingAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type Party = {
  id: string;
  code?: string | null;
  name: string;
  companyName?: string | null;
  phone?: string | null;
  type: string;
};

type CompanySetting = {
  companyName?: string | null;
  phone?: string | null;
  address?: string | null;
  logoImage?: string | null;
  receiptHeaderImage?: string | null;
};

type LedgerLine = {
  id: string;
  date: string;
  entryNo: string;
  description?: string | null;
  sourceType?: string | null;
  account: AccountingAccount;
  party?: Party | null;
  debit: number;
  credit: number;
  balance?: number | null;
  note?: string | null;
};

type PeriodLedgerReport = {
  from: string;
  to: string;
  account?: AccountingAccount | null;
  party?: Party | null;
  totals: {
    openingDebit: number;
    openingCredit: number;
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
    lineCount: number;
  };
  rows: LedgerLine[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const PAGE_SIZE = 15;

const number = (value: unknown) =>
  new Intl.NumberFormat("en-US").format(Number(value || 0));

function toDateInputValue(date: Date) {
  return kabulDateString(date);
}

function defaultDateRange() {
  return { from: kabulMonthStartString(), to: kabulDateString() };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fa-AF", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value = new Date()) {
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function balanceTone(value?: number | null) {
  if (!value) return "text-muted-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-300";
  return "text-destructive";
}

function accountTypeLabel(type: string) {
  const labels: Record<string, string> = {
    ASSET: "دارایی",
    LIABILITY: "بدهی",
    EQUITY: "سرمایه",
    INCOME: "عواید",
    EXPENSE: "مصارف",
  };
  return labels[type] || type;
}

function partyTypeLabel(type: string) {
  if (type === "CUSTOMER") return "مشتری";
  if (type === "SUPPLIER") return "تأمین‌کننده";
  if (type === "BOTH") return "مشتری/تأمین‌کننده";
  return type;
}

function emptyReport(): PeriodLedgerReport {
  const range = defaultDateRange();
  return {
    from: range.from,
    to: range.to,
    account: null,
    party: null,
    totals: {
      openingDebit: 0,
      openingCredit: 0,
      openingBalance: 0,
      totalDebit: 0,
      totalCredit: 0,
      closingBalance: 0,
      lineCount: 0,
    },
    rows: [],
    pagination: {
      page: 1,
      limit: PAGE_SIZE,
      total: 0,
      totalPages: 1,
    },
  };
}

export function AccountPeriodBalancesPage() {
  const baseCurrencyCode = useBaseCurrencyCode();
  const money = (value: unknown) => formatMoney(value, baseCurrencyCode);
  const initialRange = defaultDateRange();
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [activeTab, setActiveTab] = useState<ReportTab>("all");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [company, setCompany] = useState<CompanySetting | null>(null);
  const [report, setReport] = useState<PeriodLedgerReport>(emptyReport);
  const [printRows, setPrintRows] = useState<LedgerLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadCompany = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/company`);
      const json = await res.json().catch(() => null);
      if (res.ok) setCompany(json.data);
    } catch {
      setCompany(null);
    }
  };

  const loadLookups = async () => {
    try {
      const [accountsRes, partiesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/accounting/accounts`),
        fetch(`${API_BASE_URL}/api/accounting/parties`),
      ]);
      const accountsJson = await accountsRes.json().catch(() => null);
      const partiesJson = await partiesRes.json().catch(() => null);
      if (!accountsRes.ok) throw new Error("خواندن حساب‌ها ناکام شد");
      if (!partiesRes.ok) throw new Error("خواندن طرف حساب‌ها ناکام شد");
      setAccounts(accountsJson.data || []);
      setParties(partiesJson.data || []);
    } catch {
      toast.error("خواندن لیست حساب‌ها و طرف حساب‌ها ناکام شد");
    }
  };

  const loadReport = async (
    tab: ReportTab = activeTab,
    accountId = selectedAccountId,
    partyId = selectedPartyId,
    page = 1,
  ) => {
    if (tab === "account" && !accountId) {
      toast.warning("ابتدا یک حساب را انتخاب کنید");
      return;
    }
    if (tab === "party" && !partyId) {
      toast.warning("اول یک مشتری یا تأمین‌کننده را انتخاب کنید");
      return;
    }

    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        from,
        to,
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      const endpoint =
        tab === "party"
          ? `${API_BASE_URL}/api/accounting/party-period-ledger`
          : `${API_BASE_URL}/api/accounting/account-period-ledger`;

      if (tab === "account") params.set("accountId", accountId);
      if (tab === "party") params.set("partyId", partyId);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${endpoint}?${params}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || "خواندن دفتر کل ناکام شد");
      setReport(json.data);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "خواندن گزارش دیبیت و کریدیت ناکام شد",
      );
      setReport(emptyReport());
    } finally {
      setIsLoading(false);
    }
  };

  const printReport = async () => {
    setIsLoading(true);

    try {
      const endpoint =
        activeTab === "party"
          ? `${API_BASE_URL}/api/accounting/party-period-ledger`
          : `${API_BASE_URL}/api/accounting/account-period-ledger`;
      const rows: LedgerLine[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const params = new URLSearchParams({
          from,
          to,
          page: String(page),
          limit: "250",
        });
        if (activeTab === "account") params.set("accountId", selectedAccountId);
        if (activeTab === "party") params.set("partyId", selectedPartyId);
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`${endpoint}?${params}`);
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message || "آماده‌سازی چاپ ناکام شد");

        rows.push(...(json.data?.rows || []));
        totalPages = Number(json.data?.pagination?.totalPages || 1);
        page += 1;
      } while (page <= totalPages);

      setPrintRows(rows);
      window.setTimeout(() => window.print(), 50);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "آماده‌سازی چاپ ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCompany();
    loadLookups();
    loadReport("all", "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(activeTab, selectedAccountId, selectedPartyId, 1), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const changeTab = (value: string) => {
    const tab = value as ReportTab;
    setActiveTab(tab);
    setQuery("");

    if (tab === "all") {
      loadReport("all", "", "");
      return;
    }

    if (tab === "account") {
      const accountId = selectedAccountId || accounts[0]?.id || "";
      if (accountId && !selectedAccountId) setSelectedAccountId(accountId);
      loadReport("account", accountId, "");
      return;
    }

    const partyId = selectedPartyId || parties[0]?.id || "";
    if (partyId && !selectedPartyId) setSelectedPartyId(partyId);
    loadReport("party", "", partyId);
  };

  const totals = report.totals;
  const reportTitle =
    activeTab === "account" && report.account
      ? `دفتر حساب ${report.account.code} - ${report.account.name}`
      : activeTab === "party" && report.party
        ? `Party Statement - ${report.party.name}`
        : "گزارش دیبیت و کریدیت تمام معاملات";

  return (
    <div className="ledger-print-page space-y-4">
      <PrintHeader
        company={company}
        title={reportTitle}
        from={from}
        to={to}
        totals={totals}
        money={money}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 print:hidden">
        <MetricCard
          title="Opening Balance"
          value={money(totals.openingBalance)}
          icon={<WalletCards />}
          trend={`Dr ${money(totals.openingDebit)} / Cr ${money(totals.openingCredit)}`}
        />
        <MetricCard
          title="Total Debit"
          value={money(totals.totalDebit)}
          icon={<ArrowDownToLine />}
          trend={`${number(totals.lineCount)} سطر معامله`}
        />
        <MetricCard
          title="Total Credit"
          value={money(totals.totalCredit)}
          icon={<ArrowUpFromLine />}
          trend="در مدت انتخاب‌شده"
        />
        <MetricCard
          title="Closing Balance"
          value={money(totals.closingBalance)}
          icon={<BookOpenCheck />}
          trend={
            activeTab === "party" && report.party
              ? report.party.name
              : activeTab === "account" && report.account
                ? `${report.account.code} - ${report.account.name}`
                : "تمام معاملات"
          }
        />
      </div>

      <Card className="border-border bg-card print:border-none print:bg-white print:text-black print:shadow-none">
        <CardHeader className="gap-3 lg:grid lg:grid-cols-[1fr_auto] print:hidden">
          <div>
            <CardTitle>دیبیت، کریدیت و Party Statement</CardTitle>
            <CardDescription>
              تمام معاملات، دفتر یک account خاص، و statement مشتری/تأمین‌کننده در بازه انتخاب‌شده.
            </CardDescription>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[170px_170px_240px_auto_auto]">
            <DatePicker value={from} onChange={setFrom} />
            <DatePicker value={to} onChange={setTo} />
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی معامله..."
                className="ps-9"
              />
            </div>
            <Button onClick={() => loadReport()} disabled={isLoading}>
              <RefreshCcw className="size-4" />
              نمایش
            </Button>
            <Button variant="outline" onClick={printReport} disabled={isLoading}>
              <Printer className="size-4" />
              چاپ
            </Button>
          </div>
        </CardHeader>

        <CardContent className="print:p-0">
          <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-muted/50 p-1 print:hidden">
              <TabsTrigger value="all">تمام معاملات</TabsTrigger>
              <TabsTrigger value="account">اکونت خاص</TabsTrigger>
              <TabsTrigger value="party">Party Statement</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-0 space-y-3">
              <PaginatedLedgerTable
                rows={report.rows}
                printRows={printRows}
                pagination={report.pagination}
                onPageChange={(page) => loadReport("all", "", "", page)}
                isLoading={isLoading}
                showRunningBalance={false}
                money={money}
              />
            </TabsContent>

            <TabsContent value="account" className="mt-0 space-y-3">
              <div className="max-w-md print:hidden">
                <Combobox
                  value={selectedAccountId}
                  placeholder="انتخاب account"
                  onValueChange={(value) => {
                    setSelectedAccountId(value);
                    loadReport("account", value, "");
                  }}
                  options={accounts.map((account) => ({
                    value: account.id,
                    label: `${account.code} - ${account.name}`,
                    description: accountTypeLabel(account.type),
                  }))}
                />
              </div>
              <PaginatedLedgerTable
                rows={report.rows}
                printRows={printRows}
                pagination={report.pagination}
                onPageChange={(page) => loadReport("account", selectedAccountId, "", page)}
                isLoading={isLoading}
                showRunningBalance
                money={money}
              />
            </TabsContent>

            <TabsContent value="party" className="mt-0 space-y-3">
              <div className="max-w-md print:hidden">
                <Combobox
                  value={selectedPartyId}
                  placeholder="انتخاب مشتری یا تأمین‌کننده"
                  onValueChange={(value) => {
                    setSelectedPartyId(value);
                    loadReport("party", "", value);
                  }}
                  options={parties.map((party) => ({
                    value: party.id,
                    label: `${party.code ? `${party.code} - ` : ""}${party.name}`,
                    description: `${partyTypeLabel(party.type)}${party.phone ? ` / ${party.phone}` : ""}`,
                  }))}
                />
              </div>
              <PaginatedLedgerTable
                rows={report.rows}
                printRows={printRows}
                pagination={report.pagination}
                onPageChange={(page) => loadReport("party", "", selectedPartyId, page)}
                isLoading={isLoading}
                showRunningBalance
                money={money}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function PrintHeader({
  company,
  title,
  from,
  to,
  totals,
  money,
}: {
  company: CompanySetting | null;
  title: string;
  from: string;
  to: string;
  totals: PeriodLedgerReport["totals"];
  money: (value: unknown) => string;
}) {
  return (
    <div className="ledger-print-header hidden print:block">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-3">
          {company?.logoImage || company?.receiptHeaderImage ? (
            <img
              src={`${API_BASE_URL}${company.logoImage || company.receiptHeaderImage}`}
              alt="لوگو"
              className="size-16 object-contain"
            />
          ) : (
            <div className="grid size-16 place-items-center rounded-full border-2 border-black">
              <Store className="size-9" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold">
              {company?.companyName || "Muhaseb"}
            </h1>
            <p className="text-xs">{company?.phone || ""}</p>
            <p className="text-xs">{company?.address || ""}</p>
          </div>
        </div>
        <div className="text-left">
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-xs">
            از {formatDate(from)} تا {formatDate(to)}
          </p>
          <p className="text-xs">تاریخ چاپ: {formatDateTime()}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        <PrintStat label="Opening Balance" value={money(totals.openingBalance)} />
        <PrintStat label="Total Debit" value={money(totals.totalDebit)} />
        <PrintStat label="Total Credit" value={money(totals.totalCredit)} />
        <PrintStat label="Closing Balance" value={money(totals.closingBalance)} />
      </div>
    </div>
  );
}

function PrintStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black p-2">
      <div className="text-[10px] text-neutral-600">{label}</div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  );
}

function PaginatedLedgerTable({
  rows,
  printRows,
  pagination,
  onPageChange,
  isLoading,
  showRunningBalance,
  money,
}: {
  rows: LedgerLine[];
  printRows: LedgerLine[];
  pagination: PeriodLedgerReport["pagination"];
  onPageChange: (page: number) => void;
  isLoading: boolean;
  showRunningBalance: boolean;
  money: (value: unknown) => string;
}) {
  const safePage = Math.min(pagination.page, pagination.totalPages);

  return (
    <div className="space-y-3">
      <LedgerTable
        rows={rows}
        printRows={printRows.length ? printRows : rows}
        isLoading={isLoading}
        showRunningBalance={showRunningBalance}
        money={money}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground print:hidden">
        <span>
          نمایش {pagination.total === 0 ? 0 : (safePage - 1) * pagination.limit + 1} تا{" "}
          {Math.min(safePage * pagination.limit, pagination.total)} از {pagination.total}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={safePage <= 1}
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
          >
            قبلی
          </Button>
          <span>
            صفحه {safePage} / {pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={safePage >= pagination.totalPages}
            onClick={() => onPageChange(Math.min(pagination.totalPages, safePage + 1))}
          >
            بعدی
          </Button>
        </div>
      </div>
    </div>
  );
}

function LedgerTable({
  rows,
  printRows,
  isLoading,
  showRunningBalance,
  money,
}: {
  rows: LedgerLine[];
  printRows: LedgerLine[];
  isLoading: boolean;
  showRunningBalance: boolean;
  money: (value: unknown) => string;
}) {
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border print:hidden">
        <LedgerTableMarkup
        rows={rows}
        isLoading={isLoading}
        showRunningBalance={showRunningBalance}
        money={money}
      />
      </div>
      <div className="hidden print:block">
        <LedgerTableMarkup
        rows={printRows}
        isLoading={isLoading}
        showRunningBalance={showRunningBalance}
        printMode
        money={money}
      />
      </div>
    </>
  );
}

function LedgerTableMarkup({
  rows,
  isLoading,
  showRunningBalance,
  printMode = false,
  money,
}: {
  rows: LedgerLine[];
  isLoading: boolean;
  showRunningBalance: boolean;
  printMode?: boolean;
  money: (value: unknown) => string;
}) {
  return (
    <Table className={printMode ? "ledger-print-table text-[9px]" : "text-xs"}>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40 print:bg-white">
          <TableHead>تاریخ</TableHead>
          <TableHead>نمبر سند</TableHead>
          <TableHead>حساب</TableHead>
          <TableHead>طرف حساب</TableHead>
          <TableHead>نوع</TableHead>
          <TableHead>شرح</TableHead>
          <TableHead>بدهکار</TableHead>
          <TableHead>بستانکار</TableHead>
          {showRunningBalance && <TableHead>مانده</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell
              colSpan={showRunningBalance ? 9 : 8}
              className="py-10 text-center text-muted-foreground"
            >
              در حال خواندن معاملات...
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={showRunningBalance ? 9 : 8}
              className="py-10 text-center text-muted-foreground"
            >
              معامله‌ای برای نمایش وجود ندارد
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatDate(row.date)}</TableCell>
              <TableCell className="font-mono">{row.entryNo}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {row.account.code} - {row.account.name}
                  </span>
                  <span className="text-muted-foreground print:text-neutral-600">
                    {accountTypeLabel(row.account.type)}
                  </span>
                </div>
              </TableCell>
              <TableCell>{row.party?.name || "-"}</TableCell>
              <TableCell>
                <Badge variant="outline">{row.sourceType || "MANUAL"}</Badge>
              </TableCell>
              <TableCell className="max-w-72 whitespace-normal leading-6 print:max-w-none print:leading-5">
                {row.note || row.description || "-"}
              </TableCell>
              <TableCell className="font-medium text-emerald-600 print:text-black dark:text-emerald-300">
                {money(row.debit)}
              </TableCell>
              <TableCell className="font-medium text-destructive print:text-black">
                {money(row.credit)}
              </TableCell>
              {showRunningBalance && (
                <TableCell
                  className={`font-bold print:text-black ${balanceTone(row.balance)}`}
                >
                  {money(row.balance)}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
