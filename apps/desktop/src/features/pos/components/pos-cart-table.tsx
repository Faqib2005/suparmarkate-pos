import { AlertTriangle, Minus, MoreHorizontal, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { kabulDateString } from "@/lib/kabul-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Currency, ServerCartItem } from "../types";
import { money } from "../utils";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { normalizePosQuantity, PosQuantityInput } from "./pos-quantity-input";

type PosCartTableProps = {
  items: ServerCartItem[];
  itemsCount: number;
  currency: Currency | null;
  isBooting: boolean;
  onClearCart: () => void;
  onUpdateItem: (
    key: string,
    input: {
      quantity?: number;
      unitPrice?: number;
      discount?: number;
    }
  ) => void;
  onRemoveItem: (key: string) => void;
};

function getDaysUntilExpiry(expiryDate?: string | null) {
  if (!expiryDate) return null;
  const toUtcDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round(
    (toUtcDay(kabulDateString(new Date(expiryDate))) -
      toUtcDay(kabulDateString())) /
      86400000
  );
}

function StockBadge({ item }: { item: ServerCartItem }) {
  const totalStock = Number(item.availableBaseQuantity ?? item.totalStock ?? 0);
  const requiredBaseQuantity = Number(
    item.quantityBase ?? Number(item.quantity || 0) * Number(item.conversionRate || 1),
  );
  const maxInSelectedUnit =
    Math.round((totalStock / Math.max(Number(item.conversionRate || 1), 0.0001)) * 10000) /
    10000;
  const lotSuffix = Number(item.lotCount || 0) > 1 ? ` · ${item.lotCount} لات` : "";

  if (totalStock <= 0) {
    return <Badge variant="destructive">بدون موجودی</Badge>;
  }

  if (requiredBaseQuantity > totalStock) {
    return <Badge variant="destructive">کمبود موجودی</Badge>;
  }

  if (totalStock <= requiredBaseQuantity + 2) {
    return <Badge variant="secondary">موجودی کم: {totalStock} پایه ({maxInSelectedUnit} {item.unitName}){lotSuffix}</Badge>;
  }

  return <Badge variant="outline">موجودی: {totalStock} پایه ({maxInSelectedUnit} {item.unitName}){lotSuffix}</Badge>;
}

function ExpiryBadge({ expiryDate }: { expiryDate?: string | null }) {
  const days = getDaysUntilExpiry(expiryDate);

  if (days === null) {
    return <Badge variant="outline">بدون انقضا</Badge>;
  }

  if (days < 0) {
    return <Badge variant="destructive">تاریخ گذشته</Badge>;
  }

  if (days === 0) {
    return <Badge variant="destructive">امروز منقضی می‌شود</Badge>;
  }

  if (days <= 7) {
    return <Badge variant="destructive">انقضا نزدیک: {days} روز</Badge>;
  }

  if (days <= 30) {
    return <Badge variant="secondary">انقضا تا {days} روز</Badge>;
  }

  return <Badge variant="outline">انقضا: {days} روز</Badge>;
}

export function PosCartTable({
  items,
  itemsCount,
  currency,
  isBooting,
  onClearCart,
  onUpdateItem,
  onRemoveItem,
}: PosCartTableProps) {
  const hasStockIssue = items.some(
    (item) =>
      Number(item.quantityBase ?? Number(item.quantity || 0) * Number(item.conversionRate || 1)) >
      Number(item.availableBaseQuantity ?? item.totalStock ?? 0),
  );

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <Button size="icon-sm" variant="secondary">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              فاکتور جاری
              <ShoppingCart className="h-5 w-5 text-primary" />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              INV-{new Date().getFullYear()}-{String(itemsCount).padStart(4, "0")}
            </p>
          </div>
        </div>

        <ConfirmActionDialog
          title="پاک‌کردن سبد فروش"
          description="آیا مطمئن هستید که می‌خواهید تمام محصولات داخل سبد فروش را پاک کنید؟ این کار برگشت‌پذیر نیست."
          confirmText="پاک شود"
          destructive
          onConfirm={onClearCart}
          trigger={
            <Button size="sm" variant="secondary" className="gap-2">
              <Trash2 className="h-4 w-4" />
              پاک
            </Button>
          }
        />
      </CardHeader>

      <CardContent>
        {hasStockIssue ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            تعداد بعضی محصولات بیشتر از موجودی قابل فروش است.
          </div>
        ) : null}

        {isBooting ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length ? (
          <ScrollArea className="h-[360px] rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">قیمت</TableHead>
                  <TableHead className="text-right">جمع</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>

              <TableBody>
                {items.map((item) => {
                  const stockIssue =
                    Number(item.quantityBase ?? Number(item.quantity || 0) * Number(item.conversionRate || 1)) >
                    Number(item.availableBaseQuantity ?? item.totalStock ?? 0);

                  return (
                    <TableRow
                      key={item.key}
                      className={stockIssue ? "bg-destructive/10" : ""}
                    >
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-primary">
                              <ShoppingCart className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="line-clamp-2 font-bold">
                                {item.productName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {item.unitName} · {item.barcode || "-"}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <StockBadge item={item} />
                            <ExpiryBadge expiryDate={item.nextExpiryDate ?? item.expiryDate} />
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="secondary"
                            onClick={() =>
                              onUpdateItem(item.key, {
                                quantity: normalizePosQuantity(Number(item.quantity) - 0.1),
                              })
                            }
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <PosQuantityInput
                            className={
                              stockIssue
                                ? "h-8 w-14 border-destructive text-center"
                                : "h-8 w-14 text-center"
                            }
                            value={item.quantity}
                            onCommit={(quantity) =>
                              onUpdateItem(item.key, {
                                quantity,
                              })
                            }
                          />
                          <Button
                            size="icon-xs"
                            variant="secondary"
                            onClick={() =>
                              onUpdateItem(item.key, {
                                quantity: normalizePosQuantity(Number(item.quantity) + 1),
                              })
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Input
                          className="h-8 w-24"
                          type="number"
                          min={0}
                          value={item.unitPrice}
                          onChange={(event) =>
                            onUpdateItem(item.key, { unitPrice: Number(event.target.value) })
                          }
                        />
                      </TableCell>

                      <TableCell className="font-bold">
                        {money(item.lineTotal, currency)}
                      </TableCell>

                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="destructive"
                          onClick={() => onRemoveItem(item.key)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        ) : (
          <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-border text-center">
            <div className="space-y-3 text-muted-foreground">
              <ShoppingCart className="mx-auto h-12 w-12" />
              <h3 className="text-lg font-bold text-foreground">سبد فروش خالی است</h3>
              <p>با اپ موبایل، اسکنر دسکتاپ یا جستجوی محصول، کالا اضافه کنید.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
