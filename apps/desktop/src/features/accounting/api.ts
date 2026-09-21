import type {
  AccountBalance,
  AccountingDashboardSummary,
  AccountingAccount,
  AccountLedgerResponse,
  JournalEntry,
  ProfitLossReport,
  TrialBalanceReport,
  Party,
  PartyLedgerResponse,
  PartyBalance,
  PaginationMeta,
} from "./types";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.message || json?.error?.message || "درخواست انجام نشد. لطفاً دوباره کوشش کنید.");
  }

  return json;
}


export async function loadAccountingReports(baseUrl: string, range: { from: string; to: string }) {
  const query = new URLSearchParams(range).toString();
  const [dashboardSummary, trialBalance, profitLoss] = await Promise.all([
    fetchJson<{ data: AccountingDashboardSummary }>(
      `${baseUrl}/api/accounting/dashboard-summary?${query}`
    ),
    fetchJson<{ data: TrialBalanceReport }>(
      `${baseUrl}/api/accounting/trial-balance`
    ),
    fetchJson<{ data: ProfitLossReport }>(
      `${baseUrl}/api/accounting/profit-loss?${query}`
    ),
  ]);

  return {
    dashboardSummary: dashboardSummary.data,
    trialBalance: trialBalance.data,
    profitLoss: profitLoss.data,
  };
}

export async function loadAccountingOverview(baseUrl: string) {
  const [accounts, parties, balances, customerBalances, supplierBalances] =
    await Promise.all([
      fetchJson<{ data: AccountingAccount[] }>(`${baseUrl}/api/accounting/accounts`),
      fetchJson<{ data: Party[] }>(`${baseUrl}/api/accounting/parties`),
      fetchJson<{ data: AccountBalance[] }>(`${baseUrl}/api/accounting/balances`),
      fetchJson<{ data: PartyBalance[] }>(
        `${baseUrl}/api/accounting/party-balances?type=CUSTOMER`
      ),
      fetchJson<{ data: PartyBalance[] }>(
        `${baseUrl}/api/accounting/party-balances?type=SUPPLIER`
      ),
    ]);

  return {
    accounts: accounts.data || [],
    parties: parties.data || [],
    balances: balances.data || [],
    customerBalances: customerBalances.data || [],
    supplierBalances: supplierBalances.data || [],
  };
}

export async function loadJournalEntries(
  baseUrl: string,
  page = 1,
  limit = 20,
  range?: { from: string; to: string },
) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(range || {}),
  }).toString();

  return fetchJson<{ data: JournalEntry[]; pagination: PaginationMeta }>(
    `${baseUrl}/api/accounting/journal-entries?${query}`,
  );
}

export async function createParty(
  baseUrl: string,
  input: {
    name: string;
    phone?: string;
    type: "CUSTOMER" | "SUPPLIER";
    openingBalance?: number;
    openingType?: "DEBIT" | "CREDIT";
  }
) {
  return fetchJson<{ data: Party }>(`${baseUrl}/api/accounting/parties`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function postExpense(
  baseUrl: string,
  input: {
    expenseId: string;
    title: string;
    amount: number;
  }
) {
  return fetchJson<{ data: JournalEntry }>(`${baseUrl}/api/accounting/post-expense`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function postCustomerReceipt(
  baseUrl: string,
  input: {
    receiptId: string;
    customerId: string;
    amount: number;
    note?: string;
  }
) {
  return fetchJson<{ data: JournalEntry }>(
    `${baseUrl}/api/accounting/post-customer-receipt`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );
}

export async function postSupplierPayment(
  baseUrl: string,
  input: {
    paymentId: string;
    supplierId: string;
    amount: number;
    note?: string;
  }
) {
  return fetchJson<{ data: JournalEntry }>(
    `${baseUrl}/api/accounting/post-supplier-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );
}

export async function loadAccountLedger(baseUrl: string, accountId: string) {
  return fetchJson<{ data: AccountLedgerResponse }>(
    `${baseUrl}/api/accounting/account-ledger/${accountId}`
  );
}

export async function loadPartyLedger(baseUrl: string, partyId: string) {
  return fetchJson<{ data: PartyLedgerResponse }>(
    `${baseUrl}/api/accounting/party-ledger/${partyId}`
  );
}

export async function createJournalEntry(
  baseUrl: string,
  input: {
    entryNo?: string;
    date?: string;
    description?: string;
    sourceType?: string;
    sourceId?: string;
    lines: Array<{
      accountId: string;
      partyId?: string | null;
      debit: number;
      credit: number;
      note?: string | null;
    }>;
  }
) {
  return fetchJson<{ data: JournalEntry }>(`${baseUrl}/api/accounting/journal-entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}
