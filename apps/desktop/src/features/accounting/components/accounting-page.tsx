import { useEffect } from "react";
import {
  Banknote,
  BookOpenCheck,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  FileText,
  HandCoins,
  Landmark,
  RefreshCcw,
  UsersRound,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatMoney, useBaseCurrencyCode } from "@/lib/use-base-currency";
import { DatePicker } from "@/components/ui/date-picker";

import { LedgerViewer } from "./ledger-viewer";
import { ManualJournalCard } from "./manual-journal-card";
import { useAccounting } from "../hooks/use-accounting";

type AccountingPageProps = {
  apiBaseUrl: string;
};

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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
  }).format(date);
}

export function AccountingPage({ apiBaseUrl }: AccountingPageProps) {
  const accounting = useAccounting(apiBaseUrl);
  const baseCurrencyCode = useBaseCurrencyCode(apiBaseUrl);
  const money = (value: unknown) => formatMoney(value, baseCurrencyCode);

  useEffect(() => {
    accounting.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl]);

  const trialBalance = accounting.trialBalance;
  const profitLoss = accounting.profitLoss;
  const dashboard = accounting.dashboardSummary;

  return (
    <section dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">حسابداری</h1>
          <p className="text-sm text-muted-foreground">
            داشبورد مالی، مانده حساب‌ها، طرف حساب‌ها، ژورنال و سند دستی.
          </p>
        </div>

        <Button
          onClick={accounting.refresh}
          disabled={accounting.isLoading}
          className="gap-2"
        >
          <RefreshCcw className="h-4 w-4" />
          تازه‌سازی
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="صندوق نقدی فعلی"
          value={money(dashboard?.assets.cash ?? accounting.totals.cash)}
          icon={<Banknote />}
        />
        <MetricCard
          title="بانک فعلی"
          value={money(dashboard?.assets.bank ?? 0)}
          icon={<Landmark />}
        />
        <MetricCard
          title="موجودی فعلی اجناس"
          value={money(dashboard?.assets.inventory ?? accounting.totals.inventory)}
          icon={<WalletCards />}
        />
        <MetricCard
          title="طلبات فعلی مشتریان"
          value={money(dashboard?.assets.receivable ?? accounting.totals.receivable)}
          icon={<UsersRound />}
        />
        <MetricCard
          title="بدهی فعلی فروشندگان"
          value={money(Math.abs(dashboard?.liabilities.payable ?? accounting.totals.payable))}
          icon={<CreditCard />}
        />
        <MetricCard
          title="مفاد خالص دوره"
          value={money(profitLoss?.netProfit ?? accounting.totals.netProfit)}
          icon={<BookOpenCheck />}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-muted/50 p-1">
          <TabsTrigger value="overview">خلاصه</TabsTrigger>
          <TabsTrigger value="accounts">حساب‌ها</TabsTrigger>
          <TabsTrigger value="parties">طرف حساب‌ها</TabsTrigger>
          <TabsTrigger value="journals">ژورنال‌ها</TabsTrigger>
          <TabsTrigger value="manual">سند دستی</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="border-border bg-card">
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <label className="grid min-w-52 gap-1.5 text-sm">
                <span className="text-muted-foreground">از تاریخ</span>
                <DatePicker
                  value={accounting.summaryRange.from}
                  onChange={(from) => accounting.setSummaryRange((current) => ({ ...current, from }))}
                />
              </label>
              <label className="grid min-w-52 gap-1.5 text-sm">
                <span className="text-muted-foreground">تا تاریخ</span>
                <DatePicker
                  value={accounting.summaryRange.to}
                  onChange={(to) => accounting.setSummaryRange((current) => ({ ...current, to }))}
                />
              </label>
              <Button type="button" variant="outline" onClick={accounting.refresh}>
                اعمال بازه
              </Button>
              <div className="me-auto flex flex-wrap gap-2">
                <Badge variant="outline">سود و جریان نقد: بازه انتخاب‌شده</Badge>
                <Badge variant="outline">مانده‌ها و تراز: تا همین لحظه</Badge>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-3">
            <SummaryCard
              title="سود و زیان"
              description="خلاصه عواید، تخفیف، مصارف و مفاد"
              rows={[
                ["عواید فروش", money(profitLoss?.salesRevenue || 0)],
                ["تخفیف فروش", money(profitLoss?.salesDiscount || 0)],
                ["مصارف عمومی", money(profitLoss?.generalExpenses || 0)],
                ["مفاد خالص", money(profitLoss?.netProfit || 0), true],
              ]}
            />
            <SummaryCard
              title="جریان نقد"
              description="ورود و خروج نقد از حساب‌های نقدی"
              rows={[
                ["ورود نقد", money(dashboard?.cashFlow.cashIn || 0)],
                ["خروج نقد", money(dashboard?.cashFlow.cashOut || 0)],
                ["جریان خالص", money(dashboard?.cashFlow.netCashFlow || 0), true],
              ]}
            />
            <SummaryCard
              title="تراز آزمایشی"
              description="کنترل برابری Debit و Credit"
              rows={[
                ["مجموع Debit", money(trialBalance?.totalDebit || 0)],
                ["مجموع Credit", money(trialBalance?.totalCredit || 0)],
                [
                  "وضعیت",
                  trialBalance?.isBalanced ? "متوازن" : "نامتوازن",
                  true,
                ],
              ]}
            />
          </div>
        </TabsContent>

        <TabsContent value="accounts">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>مانده حساب‌ها</CardTitle>
              <CardDescription>
                مانده تمام accountهای اصلی سیستم از ژورنال‌های ثبت‌شده.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>کد</TableHead>
                      <TableHead>حساب</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>بدهکار</TableHead>
                      <TableHead>بستانکار</TableHead>
                      <TableHead>مانده</TableHead>
                      <TableHead>عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounting.balances.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono">{item.code}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {accountTypeLabel(item.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>{money(item.debit)}</TableCell>
                        <TableCell>{money(item.credit)}</TableCell>
                        <TableCell className="font-bold">
                          {money(item.balance)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => accounting.openAccountLedger(item.id)}
                          >
                            دفتر
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!accounting.balances.length && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-8 text-center text-muted-foreground"
                        >
                          حسابی برای نمایش وجود ندارد
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parties">
          <div className="grid gap-4 xl:grid-cols-2">
            <PartyBalanceTable
              title="مانده مشتریان"
              rows={accounting.customerBalances}
              money={money}
              onLedger={accounting.openPartyLedger}
            />
            <PartyBalanceTable
              title="مانده تأمین‌کنندگان"
              rows={accounting.supplierBalances}
              money={money}
              onLedger={accounting.openPartyLedger}
            />
          </div>
        </TabsContent>

        <TabsContent value="journals">
          <Card className="border-border bg-card">
            <CardHeader className="gap-3 lg:flex lg:flex-row lg:items-end lg:justify-between">
              <div>
              <CardTitle>ژورنال‌های بازه انتخاب‌شده</CardTitle>
              <CardDescription>
                اسناد حسابداری ثبت‌شده از فروش، خرید، دریافت، پرداخت و سند دستی.
              </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <DatePicker
                  value={accounting.summaryRange.from}
                  onChange={(from) => accounting.setSummaryRange((current) => ({ ...current, from }))}
                  className="w-40"
                />
                <DatePicker
                  value={accounting.summaryRange.to}
                  onChange={(to) => accounting.setSummaryRange((current) => ({ ...current, to }))}
                  className="w-40"
                />
                <Button type="button" variant="outline" onClick={accounting.refresh}>
                  اعمال بازه
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>تاریخ</TableHead>
                      <TableHead>نمبر</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>شرح</TableHead>
                      <TableHead>خطوط سند</TableHead>
                      <TableHead>بدهکار</TableHead>
                      <TableHead>بستانکار</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounting.journals.map((entry) => {
                      const debit = entry.lines.reduce(
                        (sum, line) => sum + Number(line.baseDebit ?? line.debit ?? 0),
                        0,
                      );
                      const credit = entry.lines.reduce(
                        (sum, line) => sum + Number(line.baseCredit ?? line.credit ?? 0),
                        0,
                      );

                      return (
                        <TableRow key={entry.id}>
                          <TableCell>{formatDate(entry.date)}</TableCell>
                          <TableCell className="font-mono">
                            {entry.entryNo}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {entry.sourceType || "MANUAL"}
                            </Badge>
                          </TableCell>
                          <TableCell>{entry.description || "-"}</TableCell>
                          <TableCell>
                            {entry.lines.map((line) => (
                              <div key={line.id} className="leading-6">
                                {line.account?.name || "-"}
                              </div>
                            ))}
                          </TableCell>
                          <TableCell>{money(debit)}</TableCell>
                          <TableCell>{money(credit)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!accounting.journals.length && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-8 text-center text-muted-foreground"
                        >
                          هنوز ژورنالی ثبت نشده است
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  صفحه {accounting.journalPagination.page} از {accounting.journalPagination.totalPages}
                  {" "}({accounting.journalPagination.total} سند)
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={accounting.journalPagination.page <= 1}
                    onClick={() => accounting.loadJournalPage(accounting.journalPagination.page - 1)}
                  >
                    <ChevronRight className="size-4" />
                    قبلی
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={accounting.journalPagination.page >= accounting.journalPagination.totalPages}
                    onClick={() => accounting.loadJournalPage(accounting.journalPagination.page + 1)}
                  >
                    بعدی
                    <ChevronLeft className="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <ManualJournalCard
            accounts={accounting.accounts}
            parties={accounting.parties}
            baseCurrencyCode={baseCurrencyCode}
            onSubmit={accounting.addManualJournal}
          />
        </TabsContent>
      </Tabs>

      <LedgerViewer
        accountLedger={accounting.selectedAccountLedger}
        partyLedger={accounting.selectedPartyLedger}
        baseCurrencyCode={baseCurrencyCode}
        onClose={accounting.clearLedger}
      />
    </section>
  );
}

function SummaryCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<[string, string, boolean?]>;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map(([label, value, strong]) => (
          <div
            key={label}
            className={`flex justify-between rounded-lg p-3 ${
              strong ? "bg-primary/15" : "bg-secondary"
            }`}
          >
            <span className="text-muted-foreground">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PartyBalanceTable({
  title,
  rows,
  money,
  onLedger,
}: {
  title: string;
  rows: Array<{
    id: string;
    name: string;
    phone?: string | null;
    type: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  money: (value: unknown) => string;
  onLedger: (partyId: string) => void;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl border border-border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>نام</TableHead>
                <TableHead>شماره</TableHead>
                <TableHead>نوع</TableHead>
                <TableHead>بدهکار</TableHead>
                <TableHead>بستانکار</TableHead>
                <TableHead>مانده</TableHead>
                <TableHead>عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.phone || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{partyTypeLabel(item.type)}</Badge>
                  </TableCell>
                  <TableCell>{money(item.debit)}</TableCell>
                  <TableCell>{money(item.credit)}</TableCell>
                  <TableCell className="font-bold">
                    {money(item.balance)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onLedger(item.id)}
                    >
                      دفتر
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    موردی برای نمایش وجود ندارد
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
