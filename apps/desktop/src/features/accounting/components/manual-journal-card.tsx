import { useMemo, useState } from "react";
import { BookPlus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmButton } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";

import type { AccountingAccount, Party } from "../types";

type ManualJournalLine = {
  id: string;
  accountId: string;
  partyId: string;
  debit: number;
  credit: number;
  note: string;
};

type ManualJournalCardProps = {
  accounts: AccountingAccount[];
  parties: Party[];
  baseCurrencyCode: string;
  onSubmit: (input: {
    description: string;
    lines: Array<{
      accountId: string;
      partyId?: string | null;
      debit: number;
      credit: number;
      note?: string | null;
    }>;
  }) => void;
};

function makeLine(): ManualJournalLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    accountId: "",
    partyId: "",
    debit: 0,
    credit: 0,
    note: "",
  };
}

function money(value: number, currencyCode: string) {
  return `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ${currencyCode}`;
}

export function ManualJournalCard({
  accounts,
  parties,
  baseCurrencyCode,
  onSubmit,
}: ManualJournalCardProps) {
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<ManualJournalLine[]>([
    makeLine(),
    makeLine(),
  ]);

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = lines.reduce(
      (sum, line) => sum + Number(line.credit || 0),
      0,
    );

    return {
      debit,
      credit,
      difference: debit - credit,
      isBalanced: Math.round((debit - credit) * 10000) / 10000 === 0,
    };
  }, [lines]);

  function updateLine(id: string, patch: Partial<ManualJournalLine>) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;

        const next = { ...line, ...patch };
        if (patch.debit !== undefined && Number(patch.debit || 0) > 0) {
          next.credit = 0;
        }
        if (patch.credit !== undefined && Number(patch.credit || 0) > 0) {
          next.debit = 0;
        }
        return next;
      }),
    );
  }

  function removeLine(id: string) {
    setLines((current) => {
      if (current.length <= 2) return current;
      return current.filter((line) => line.id !== id);
    });
  }

  function submit() {
    onSubmit({
      description,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        partyId: line.partyId && line.partyId !== "none" ? line.partyId : null,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        note: line.note || null,
      })),
    });

    if (totals.isBalanced) {
      setDescription("");
      setLines([makeLine(), makeLine()]);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookPlus className="h-5 w-5" />
          سند دستی حسابداری
        </CardTitle>
        <CardDescription>
          برای اصلاح حساب، سرمایه اولیه، انتقالات خاص یا اسناد حسابداری غیرسیستمی.
        </CardDescription>
        <p className="text-xs text-muted-foreground">
          سند دستی فقط با حساب‌های کرنسی پایه ({baseCurrencyCode}) قابل ثبت است.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="شرح سند، مثال: سرمایه اولیه مالک"
        />

        <div className="space-y-2">
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="grid gap-2 rounded-xl border border-border bg-secondary p-3 xl:grid-cols-[1.5fr_1fr_100px_100px_1fr_40px]"
            >
              <Combobox
                value={line.accountId}
                placeholder={`حساب خط ${index + 1}`}
                onValueChange={(value) =>
                  updateLine(line.id, { accountId: value })
                }
                options={accounts.map((account) => ({
                  value: account.id,
                  label: `${account.code} - ${account.name}`,
                  meta: account.type,
                }))}
              />

              <Combobox
                value={line.partyId}
                placeholder="طرف حساب، اختیاری"
                onValueChange={(value) =>
                  updateLine(line.id, { partyId: value })
                }
                options={[
                  { value: "none", label: "بدون طرف حساب" },
                  ...parties.map((party) => ({
                    value: party.id,
                    label: party.name,
                    meta: party.type,
                  })),
                ]}
              />

              <Input
                type="number"
                min={0}
                value={line.debit}
                onChange={(event) =>
                  updateLine(line.id, { debit: Number(event.target.value) })
                }
                placeholder="Debit"
              />

              <Input
                type="number"
                min={0}
                value={line.credit}
                onChange={(event) =>
                  updateLine(line.id, { credit: Number(event.target.value) })
                }
                placeholder="Credit"
              />

              <textarea
                value={line.note}
                onChange={(event) =>
                  updateLine(line.id, { note: event.target.value })
                }
                placeholder="یادداشت خط"
                rows={2}
                className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />

              <ConfirmButton
                type="button"
                variant="destructive"
                size="icon"
                disabled={lines.length <= 2}
                title="تایید حذف خط ژورنال"
                description="آیا مطمئن هستید که این خط از سند ژورنال حذف شود؟"
                confirmLabel="حذف"
                onConfirm={() => removeLine(line.id)}
              >
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary p-3 text-sm">
          <div className="flex flex-wrap gap-4">
            <span>
              بدهکار: <strong>{money(totals.debit, baseCurrencyCode)}</strong>
            </span>
            <span>
              بستانکار: <strong>{money(totals.credit, baseCurrencyCode)}</strong>
            </span>
            <span>
              تفاوت:{" "}
              <strong
                className={
                  totals.isBalanced ? "text-emerald-500" : "text-destructive"
                }
              >
                {money(totals.difference, baseCurrencyCode)}
              </strong>
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLines([...lines, makeLine()])}
            >
              <Plus className="h-4 w-4" />
              خط جدید
            </Button>

            <Button
              type="button"
              onClick={submit}
              disabled={!totals.isBalanced || totals.debit <= 0}
            >
              ثبت سند
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
