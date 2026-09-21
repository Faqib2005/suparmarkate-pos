import { useMemo, useState } from "react";
import { toast } from "sonner";

import { kabulDateString, kabulMonthStartString } from "@/lib/kabul-date";

import {
  createJournalEntry,
  createParty,
  loadAccountingOverview,
  loadAccountLedger,
  loadPartyLedger,
  loadAccountingReports,
  loadJournalEntries,
  postCustomerReceipt,
  postExpense,
  postSupplierPayment,
} from "../api";
import type {
  AccountBalance,
  AccountLedgerResponse,
  AccountingDashboardSummary,
  AccountingAccount,
  JournalEntry,
  ProfitLossReport,
  TrialBalanceReport,
  Party,
  PartyLedgerResponse,
  PartyBalance,
  PaginationMeta,
} from "../types";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useAccounting(baseUrl: string) {
  const [summaryRange, setSummaryRange] = useState({
    from: kabulMonthStartString(),
    to: kabulDateString(),
  });
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [customerBalances, setCustomerBalances] = useState<PartyBalance[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<PartyBalance[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [journalPagination, setJournalPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [dashboardSummary, setDashboardSummary] = useState<AccountingDashboardSummary | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAccountLedger, setSelectedAccountLedger] = useState<AccountLedgerResponse | null>(null);
  const [selectedPartyLedger, setSelectedPartyLedger] = useState<PartyLedgerResponse | null>(null);

  const customers = useMemo(() => {
    return parties.filter((party) => String(party.type).toUpperCase() === "CUSTOMER");
  }, [parties]);

  const suppliers = useMemo(() => {
    return parties.filter((party) => String(party.type).toUpperCase() === "SUPPLIER");
  }, [parties]);

  const totals = useMemo(() => {
    const cash = balances
      .filter((item) => item.code === "1000")
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);

    const inventory = balances
      .filter((item) => item.code === "1300")
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);

    const receivable = balances
      .filter((item) => item.code === "1200")
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);

    const payable = balances
      .filter((item) => item.code === "2000")
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);

    const sales = balances
      .filter((item) => item.code === "4000")
      .reduce((sum, item) => sum + Math.abs(Number(item.balance || 0)), 0);

    const expenses = balances
      .filter((item) => item.type === "EXPENSE")
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);

    return {
      cash,
      inventory,
      receivable,
      payable,
      sales,
      expenses,
      netProfit: sales - expenses,
    };
  }, [balances]);

  async function refresh() {
    if (!baseUrl) {
      toast.error("اتصال به سرور آماده نیست");
      return;
    }

    try {
      setIsLoading(true);

      const [data, reports, journalResult] = await Promise.all([
        loadAccountingOverview(baseUrl),
        loadAccountingReports(baseUrl, summaryRange),
        loadJournalEntries(baseUrl, journalPagination.page, journalPagination.limit, summaryRange),
      ]);

      setAccounts(data.accounts);
      setParties(data.parties);
      setBalances(data.balances);
      setCustomerBalances(data.customerBalances);
      setSupplierBalances(data.supplierBalances);
      setJournals(journalResult.data || []);
      setJournalPagination(journalResult.pagination);
      setDashboardSummary(reports.dashboardSummary);
      setTrialBalance(reports.trialBalance);
      setProfitLoss(reports.profitLoss);
    } catch (error: any) {
      toast.error(error?.message || "دریافت اطلاعات حسابداری ناکام شد");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadJournalPage(page: number) {
    try {
      const result = await loadJournalEntries(baseUrl, page, journalPagination.limit, summaryRange);
      setJournals(result.data || []);
      setJournalPagination(result.pagination);
    } catch (error: any) {
      toast.error(error?.message || "دریافت ژورنال‌ها ناکام شد");
    }
  }


  async function openAccountLedger(accountId: string) {
    if (!baseUrl || !accountId) {
      toast.error("حساب انتخاب نشده است");
      return;
    }

    try {
      const res = await loadAccountLedger(baseUrl, accountId);
      setSelectedAccountLedger(res.data);
      setSelectedPartyLedger(null);
    } catch (error: any) {
      toast.error(error?.message || "دفتر کل حساب دریافت نشد");
    }
  }

  async function openPartyLedger(partyId: string) {
    if (!baseUrl || !partyId) {
      toast.error("طرف حساب انتخاب نشده است");
      return;
    }

    try {
      const res = await loadPartyLedger(baseUrl, partyId);
      setSelectedPartyLedger(res.data);
      setSelectedAccountLedger(null);
    } catch (error: any) {
      toast.error(error?.message || "صورتحساب طرف حساب دریافت نشد");
    }
  }

  function clearLedger() {
    setSelectedAccountLedger(null);
    setSelectedPartyLedger(null);
  }

  async function addManualJournal(input: {
    description: string;
    lines: Array<{
      accountId: string;
      partyId?: string | null;
      debit: number;
      credit: number;
      note?: string | null;
    }>;
  }) {
    const validLines = input.lines.filter((line) => {
      return line.accountId && (Number(line.debit || 0) > 0 || Number(line.credit || 0) > 0);
    });

    const totalDebit = validLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = validLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);

    if (validLines.length < 2) {
      toast.error("حداقل دو خط حسابداری لازم است");
      return;
    }

    if (Math.round((totalDebit - totalCredit) * 10000) / 10000 !== 0) {
      toast.error("بدهکار و بستانکار برابر نیستند");
      return;
    }

    try {
      await createJournalEntry(baseUrl, {
        description: input.description || "سند حسابداری دستی",
        sourceType: "MANUAL",
        sourceId: `manual-${Date.now()}`,
        lines: validLines,
      });

      toast.success("سند دستی ثبت شد");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "ثبت سند دستی ناکام شد");
    }
  }
  async function addParty(input: {
    name: string;
    phone?: string;
    type: "CUSTOMER" | "SUPPLIER";
    openingBalance?: number;
    openingType?: "DEBIT" | "CREDIT";
  }) {
    if (!input.name.trim()) {
      toast.error("نام لازم است");
      return;
    }

    try {
      await createParty(baseUrl, input);
      toast.success(input.type === "CUSTOMER" ? "مشتری ساخته شد" : "فروشنده ساخته شد");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "ساخت طرف حساب ناکام شد");
    }
  }

  async function addExpense(input: { title: string; amount: number }) {
    if (!input.title.trim() || Number(input.amount || 0) <= 0) {
      toast.error("عنوان و مبلغ مصرف لازم است");
      return;
    }

    try {
      await postExpense(baseUrl, {
        expenseId: makeId("expense"),
        title: input.title,
        amount: Number(input.amount),
      });

      toast.success("مصرف ثبت شد");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "ثبت مصرف ناکام شد");
    }
  }

  async function receiveFromCustomer(input: {
    customerId: string;
    amount: number;
    note?: string;
  }) {
    if (!input.customerId || Number(input.amount || 0) <= 0) {
      toast.error("مشتری و مبلغ لازم است");
      return;
    }

    try {
      await postCustomerReceipt(baseUrl, {
        receiptId: makeId("receipt"),
        customerId: input.customerId,
        amount: Number(input.amount),
        note: input.note || "دریافت از مشتری",
      });

      toast.success("دریافت از مشتری ثبت شد");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "ثبت دریافت ناکام شد");
    }
  }

  async function paySupplier(input: {
    supplierId: string;
    amount: number;
    note?: string;
  }) {
    if (!input.supplierId || Number(input.amount || 0) <= 0) {
      toast.error("فروشنده و مبلغ لازم است");
      return;
    }

    try {
      await postSupplierPayment(baseUrl, {
        paymentId: makeId("supplier-payment"),
        supplierId: input.supplierId,
        amount: Number(input.amount),
        note: input.note || "پرداخت به فروشنده",
      });

      toast.success("پرداخت به فروشنده ثبت شد");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "ثبت پرداخت ناکام شد");
    }
  }

  return {
    accounts,
    parties,
    balances,
    customerBalances,
    supplierBalances,
    journals,
    journalPagination,
    summaryRange,
    setSummaryRange,
    customers,
    suppliers,
    totals,
    dashboardSummary,
    trialBalance,
    profitLoss,
    selectedAccountLedger,
    selectedPartyLedger,
    isLoading,
    refresh,
    loadJournalPage,
    openAccountLedger,
    openPartyLedger,
    clearLedger,
    addManualJournal,
    addParty,
    addExpense,
    receiveFromCustomer,
    paySupplier,
  };
}
