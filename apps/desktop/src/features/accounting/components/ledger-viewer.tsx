import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AccountLedgerResponse, PartyLedgerResponse } from "../types";

type LedgerViewerProps = {
  accountLedger: AccountLedgerResponse | null;
  partyLedger: PartyLedgerResponse | null;
  baseCurrencyCode: string;
  onClose: () => void;
};

function money(value: number, currencyCode: string) {
  return `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ${currencyCode}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fa-AF", { dateStyle: "medium" }).format(date);
}

export function LedgerViewer({
  accountLedger,
  partyLedger,
  baseCurrencyCode,
  onClose,
}: LedgerViewerProps) {
  const title = accountLedger
    ? `دفتر کل: ${accountLedger.account.code} - ${accountLedger.account.name}`
    : partyLedger
      ? `صورتحساب: ${partyLedger.party.name}`
      : "";

  const description = accountLedger
    ? `Debit: ${money(accountLedger.totalDebit, baseCurrencyCode)} | Credit: ${money(accountLedger.totalCredit, baseCurrencyCode)} | Balance: ${money(accountLedger.balance, baseCurrencyCode)}`
    : partyLedger
      ? `Debit: ${money(partyLedger.totalDebit, baseCurrencyCode)} | Credit: ${money(partyLedger.totalCredit, baseCurrencyCode)} | Balance: ${money(partyLedger.balance, baseCurrencyCode)}`
      : "";

  const rows = accountLedger?.rows || partyLedger?.rows || [];

  if (!accountLedger && !partyLedger) return null;

  return (
    <Card className="border-primary/30 bg-card/95">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>

          <Button type="button" size="icon" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>تاریخ</TableHead>
                <TableHead>شماره</TableHead>
                <TableHead>شرح</TableHead>
                <TableHead>حساب/طرف</TableHead>
                <TableHead>بدهکار</TableHead>
                <TableHead>بستانکار</TableHead>
                <TableHead>مانده</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.date)}</TableCell>
                  <TableCell className="font-mono">{row.entryNo}</TableCell>
                  <TableCell>{row.description || row.note || "-"}</TableCell>
                  <TableCell>{row.account?.name || row.party?.name || "-"}</TableCell>
                  <TableCell>{money(row.debit, baseCurrencyCode)}</TableCell>
                  <TableCell>{money(row.credit, baseCurrencyCode)}</TableCell>
                  <TableCell className="font-bold">{money(row.balance, baseCurrencyCode)}</TableCell>
                </TableRow>
              ))}

              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    حرکتی ثبت نشده است
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
