import {
  AlertTriangle,
  Banknote,
  Check,
  CreditCard,
  ExternalLink,
  FilePlus2,
  Link2,
  MoreHorizontal,
  Minus,
  PackagePlus,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Settings,
  Shuffle,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type {
  Currency,
  HeldCart,
  PosSessionResponse,
  ServerCartItem,
} from "../types";
import type { CustomerOption } from "../types";
import { money } from "../utils";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { normalizePosQuantity, PosQuantityInput } from "./pos-quantity-input";

type PosCurrentInvoiceCardProps = {
  items: ServerCartItem[];
  highlightedItemKey?: string | null;
  itemsCount: number;
  currency: Currency | null;
  isBooting: boolean;
  subtotal: number;
  invoiceDiscount: number;
  payableTotal: number;
  paidAmount: number;
  splitCashAmount: number;
  splitCardAmount: number;
  remainingAmount: number;
  changeAmount: number;
  paymentMethod: "CASH" | "CARD" | "SPLIT";
  customerSearchTerm: string;
  customerLabel: string;
  filteredCustomers: CustomerOption[];
  selectedCustomer: CustomerOption | null;
  saleNote: string;
  lastReceiptUrl: string | null;
  session: PosSessionResponse["data"] | null;
  heldCarts: HeldCart[];
  canSubmitSale: boolean;
  disabledReason: string;
  onNewInvoice: () => void;
  onRefreshData: () => void;
  onResetSession: () => void;
  onPrintShiftReport: () => void;
  onStartNewShift: () => void;
  onOpenSettings: () => void;
  onOpenStockIncrease?: () => void;
  onHoldCart: () => void;
  onRestoreHeldCart: (heldCartId: string) => void;
  onClearCart: () => void;
  onUpdateItem: (
    key: string,
    input: {
      quantity?: number;
      unitId?: string;
      unitPrice?: number;
      discount?: number;
    },
  ) => void;
  onRemoveItem: (key: string) => void;
  onInvoiceDiscountChange: (value: number) => void;
  onPaidAmountChange: (value: number) => void;
  onSplitPaymentChange: (input: { cash?: number; card?: number }) => void;
  onPaymentMethodChange: (value: "CASH" | "CARD" | "SPLIT") => void;
  onCustomerSearchChange: (value: string) => void;
  onCustomerSelect: (customer: CustomerOption) => void;
  onCustomerClear: () => void;
  onSaleNoteChange: (value: string) => void;
  onSubmitSale: () => void;
  onPrintLastReceipt: () => void;
  onOpenLastReceipt: () => void;
};

function quickAmounts(payableTotal: number) {
  if (payableTotal <= 0) return [];

  return Array.from(
    new Set([
      payableTotal,
      Math.ceil(payableTotal / 50) * 50,
      Math.ceil(payableTotal / 100) * 100,
      500,
      1000,
    ]),
  )
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function stockTone(item: ServerCartItem) {
  const totalStock = Number(item.totalStock || 0);
  const requiredBaseQuantity =
    Number(item.quantity || 0) * Number(item.conversionRate || 1);

  if (totalStock <= 0 || requiredBaseQuantity > totalStock) {
    return {
      label: "کمبود موجودی",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    };
  }

  if (totalStock <= requiredBaseQuantity + 2) {
    return {
      label: `کم موجود: ${totalStock}`,
      className: "border-primary/30 bg-primary/10 text-primary",
    };
  }

  return {
    label: `موجودی: ${totalStock}`,
    className: "border-border bg-secondary text-secondary-foreground",
  };
}

function customerMeta(customer: CustomerOption) {
  if (customer.balanceSummary) {
    return customer.balanceSummary;
  }

  const balance = Number(customer.balance || 0);

  if (!Number.isFinite(balance) || balance === 0) {
    return "حساب فعال";
  }

  return `مانده: ${new Intl.NumberFormat("fa-AF").format(balance)}`;
}

export function PosCurrentInvoiceCard({
  items,
  highlightedItemKey,
  itemsCount,
  currency,
  isBooting,
  subtotal,
  invoiceDiscount,
  payableTotal,
  paidAmount,
  splitCashAmount,
  splitCardAmount,
  remainingAmount,
  changeAmount,
  paymentMethod,
  customerSearchTerm,
  customerLabel,
  filteredCustomers,
  selectedCustomer,
  saleNote,
  lastReceiptUrl,
  session,
  heldCarts,
  canSubmitSale,
  disabledReason,
  onNewInvoice,
  onRefreshData,
  onResetSession,
  onPrintShiftReport,
  onStartNewShift,
  onOpenSettings,
  onOpenStockIncrease,
  onHoldCart,
  onRestoreHeldCart,
  onClearCart,
  onUpdateItem,
  onRemoveItem,
  onInvoiceDiscountChange,
  onPaidAmountChange,
  onSplitPaymentChange,
  onPaymentMethodChange,
  onCustomerSearchChange,
  onCustomerSelect,
  onCustomerClear,
  onSaleNoteChange,
  onSubmitSale,
  onPrintLastReceipt,
  onOpenLastReceipt,
}: PosCurrentInvoiceCardProps) {
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false);
  const invoiceNo = `INV-${new Intl.DateTimeFormat("en-CA").format(new Date())}-${String(
    itemsCount + 17,
  ).padStart(4, "0")}`;
  const hasStockIssue = items.some(
    (item) =>
      Number(item.quantity || 0) * Number(item.conversionRate || 1) >
      Number(item.totalStock || 0),
  );

  return (
    <Card className="overflow-hidden border-border bg-card shadow-sm gap-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-0 ">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button size="icon-sm" variant="secondary">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64" dir="rtl">
            <DropdownMenuLabel>عملیات فاکتور</DropdownMenuLabel>
            <DropdownMenuItem onClick={onNewInvoice}>
              <FilePlus2 className="size-4" />
              فاکتور جدید
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!items.length} onClick={onHoldCart}>
              <ShoppingCart className="size-4" />
              معلق کردن سبد فعلی
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRefreshData}>
              <RefreshCcw className="size-4" />
              بروزرسانی دیتا
            </DropdownMenuItem>
            {onOpenStockIncrease ? (
              <DropdownMenuItem onClick={onOpenStockIncrease}>
                <PackagePlus className="size-4" />
                افزایش موجودی جنس
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => setMobileDialogOpen(true)}>
              <QrCode className="size-4" />
              اتصال موبایل
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings className="size-4" />
              تنظیمات صندوق
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onResetSession}>
              <Link2 className="size-4" />
              ساخت جلسه اتصال جدید
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>سبدهای معلق</DropdownMenuLabel>
            {heldCarts.length ? (
              heldCarts.slice(0, 6).map((held) => (
                <DropdownMenuItem
                  key={held.id}
                  onClick={() => onRestoreHeldCart(held.id)}
                >
                  <RotateCcw className="size-4" />
                  {held.name || "سبد معلق"}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>سبد معلق وجود ندارد</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!lastReceiptUrl}
              onClick={onPrintLastReceipt}
            >
              <Printer className="size-4" />
              چاپ آخرین رسید
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPrintShiftReport}>
              <ReceiptText className="size-4" />
              چاپ گزارش شیفت
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onStartNewShift}>
              <RotateCcw className="size-4" />
              شیفت جدید
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-3">
          <div className="text-end">
            <CardTitle className="text-base">فاکتور جاری</CardTitle>
            <p className="mt-0 text-xs text-muted-foreground" dir="ltr">
              {invoiceNo}
            </p>
          </div>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShoppingCart className="h-5 w-5" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {hasStockIssue ? (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-0 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            مقدار بعضی اقلام از موجودی قابل فروش بیشتر است.
          </div>
        ) : null}

        {isBooting ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <ScrollArea className="m-3 h-81.5 rounded-xl border border-border ">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42%] text-right">محصول</TableHead>
                  <TableHead className="text-right">قیمت</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">مجموع</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>

              <TableBody>
                {items.length ? (
                  items.map((item) => {
                    const stock = stockTone(item);

                    return (
                      <TableRow
                        key={item.key}
                        className={cn(
                          Number(item.quantity || 0) *
                            Number(item.conversionRate || 1) >
                            Number(item.totalStock || 0) && "bg-destructive/5",
                          item.key === highlightedItemKey &&
                            "bg-primary/15 ring-1 ring-inset ring-primary/30",
                        )}
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  className="h-10 w-10 shrink-0 rounded-lg text-primary"
                                  title="انتخاب واحد فروش"
                                  disabled={
                                    (item.unitOptions || []).length <= 1
                                  }
                                >
                                  <ShoppingCart className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-56"
                                dir="rtl"
                              >
                                <DropdownMenuLabel>واحد فروش</DropdownMenuLabel>
                                {(item.unitOptions || []).map((unit) => {
                                  const selected = unit.unitId === item.unitId;

                                  return (
                                    <DropdownMenuItem
                                      key={unit.unitId}
                                      onClick={() =>
                                        onUpdateItem(item.key, {
                                          unitId: unit.unitId,
                                        })
                                      }
                                    >
                                      <span className="flex-1">
                                        {unit.unitName}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {money(unit.salePrice, currency)}
                                      </span>
                                      {selected ? (
                                        <Check className="size-4 text-primary" />
                                      ) : null}
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <div className="min-w-0 w-58">
                              <p className="line-clamp-1 leading-6 font-medium">
                                {item.productName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                <span className="text-primary">
                                  {item.unitName}
                                </span>
                                <span>·</span>
                                <span>{item.barcode || "-"}</span>
                                <Badge
                                  variant="outline"
                                  className={`h-5 px-1.5 text-[10px] ${stock.className}`}
                                >
                                  {stock.label}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="py-2">
                          <Input
                            className="h-8 w-20"
                            type="number"
                            min={0}
                            value={item.unitPrice}
                            onChange={(event) =>
                              onUpdateItem(item.key, {
                                unitPrice: Number(event.target.value),
                              })
                            }
                          />
                        </TableCell>

                        <TableCell className="py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon-xs"
                              variant="secondary"
                              onClick={() =>
                                onUpdateItem(item.key, {
                                  quantity: normalizePosQuantity(
                                    item.quantity - 0.1,
                                  ),
                                })
                              }
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <PosQuantityInput
                              className="h-8 w-11 text-center"
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
                                  quantity: normalizePosQuantity(
                                    item.quantity + 1,
                                  ),
                                })
                              }
                            >
                              <Plus className="size-4" />
                            </Button>
                          </div>
                        </TableCell>

                        <TableCell className="py-2 font-medium">
                          {money(item.lineTotal, currency)}
                          {item.discount > 0 ? (
                            <div className="text-xs text-primary">
                              تخفیف: {money(item.discount, currency)}
                            </div>
                          ) : null}
                        </TableCell>

                        <TableCell className="py-2">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => onRemoveItem(item.key)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-64 text-center text-muted-foreground"
                    >
                      سبد فروش خالی است.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <div className="space-y-2  px-2 py-1">
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr] ">
            <div className=" p-2  pt-0">
              {/* <div className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border items-center bg-secondary/40 p-2"> */}
              <label className="p-2">تخفیف</label>
              <Input
                value={invoiceDiscount}
                type="number"
                min={0}
                max={subtotal}
                onChange={(event) =>
                  onInvoiceDiscountChange(Number(event.target.value))
                }
                placeholder="کد تخفیف یا مبلغ تخفیف"
                className="h-10 border-border bg-background w-full"
              />
              {/* </div> */}
            </div>
            <div className="flex flex-row gap-2  justify-center items-start ">
              <div className="w-full ">
                <label className="p-2">مشتری</label>
                <Combobox
                  value={selectedCustomer?.id || ""}
                  options={filteredCustomers.map((customer) => ({
                    value: customer.id,
                    label: customer.name,
                    description: [
                      customer.code ? `کد: ${customer.code}` : null,
                      customer.phone || null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    meta: customerMeta(customer),
                  }))}
                  placeholder="انتخاب مشتری نسیه از حساب‌های ثبت‌شده"
                  searchPlaceholder="جستجوی مشتری با نام، کد یا شماره..."
                  emptyText="مشتری دارای حساب پیدا نشد"
                  onSearchChange={onCustomerSearchChange}
                  onValueChange={(value) => {
                    const customer = filteredCustomers.find(
                      (item) => item.id === value,
                    );

                    if (customer) {
                      onCustomerSelect(customer);
                    }
                  }}
                />
              </div>

              {selectedCustomer ? (
                <Button
                  variant="secondary"
                  className={"mt-5 h-10"}
                  onClick={onCustomerClear}
                >
                  حذف مشتری
                </Button>
              ) : null}
            </div>
          </div>

          <textarea
            value={saleNote}
            onChange={(event) => onSaleNoteChange(event.target.value)}
            placeholder="یادداشت فاکتور، اختیاری"
            rows={3}
            className="h-10 w-full  rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>

        <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">جمع مبلغ</span>
            <span>{money(subtotal, currency)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">تخفیف</span>
            <span className="text-primary">
              ({money(invoiceDiscount, currency)})
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span>مجموع قابل پرداخت</span>
            <strong className="text-2xl text-primary">
              {money(payableTotal, currency)}
            </strong>
          </div>
        </div>

        <div className="space-y-2 border-t border-border px-4 py-3">
          <label className="text-sm text-muted-foreground">مبلغ پرداختی</label>
          {paymentMethod === "SPLIT" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">نقدی</span>
                <Input
                  type="number"
                  min={0}
                  value={splitCashAmount}
                  onChange={(event) =>
                    onSplitPaymentChange({ cash: Number(event.target.value) })
                  }
                  className="h-11 text-base font-bold"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">
                  کارت بانکی
                </span>
                <Input
                  type="number"
                  min={0}
                  value={splitCardAmount}
                  onChange={(event) =>
                    onSplitPaymentChange({ card: Number(event.target.value) })
                  }
                  className="h-11 text-base font-bold"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                type="number"
                min={0}
                value={paidAmount}
                onChange={(event) =>
                  onPaidAmountChange(Number(event.target.value))
                }
                className="h-11 text-base font-bold"
              />
              <Button size="icon-lg" variant="secondary">
                {paymentMethod === "CARD" ? (
                  <CreditCard className="h-4 w-4" />
                ) : (
                  <Banknote className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {quickAmounts(payableTotal).length ? (
            <div className="grid grid-cols-5 gap-1">
              {quickAmounts(payableTotal).map((amount) => (
                <Button
                  key={amount}
                  variant={paidAmount === amount ? "default" : "secondary"}
                  onClick={() => onPaidAmountChange(amount)}
                  className="h-8 px-1 text-[11px] leading-none"
                >
                  {money(amount, currency)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {remainingAmount > 0 ? "باقیمانده" : "برگشت پول"}
            </span>
            <strong
              className={
                remainingAmount > 0 ? "text-destructive" : "text-primary"
              }
            >
              {money(
                remainingAmount > 0 ? remainingAmount : changeAmount,
                currency,
              )}
            </strong>
          </div>
        </div>

        {disabledReason ? (
          <div className="mx-4 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {disabledReason}
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-2 px-4 py-3">
          <ConfirmActionDialog
            title="ثبت فروش"
            description="آیا مطمئن هستید که می‌خواهید این فروش ثبت شود؟ موجودی و پرداخت بعد از ثبت ذخیره می‌شود."
            confirmText="تکمیل فروش"
            onConfirm={onSubmitSale}
            trigger={
              <Button className="h-16 flex-col gap-1" disabled={!canSubmitSale}>
                <Check className="h-5 w-5" />
                تکمیل فروش
              </Button>
            }
          />

          <Button
            variant={paymentMethod === "SPLIT" ? "default" : "secondary"}
            className="h-16 flex-col gap-1"
            onClick={() => onPaymentMethodChange("SPLIT")}
          >
            <Shuffle className="h-5 w-5" />
            پرداخت ترکیبی
          </Button>

          <Button
            variant={paymentMethod === "CARD" ? "default" : "secondary"}
            className="h-16 flex-col gap-1"
            onClick={() => onPaymentMethodChange("CARD")}
          >
            <CreditCard className="h-5 w-5" />
            کارت بانکی
          </Button>

          <Button
            variant={paymentMethod === "CASH" ? "default" : "secondary"}
            className="h-16 flex-col gap-1"
            onClick={() => onPaymentMethodChange("CASH")}
          >
            <Banknote className="h-5 w-5" />
            نقدی
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border p-3">
          <ConfirmActionDialog
            title="پاک‌کردن سبد فروش"
            description="آیا مطمئن هستید که می‌خواهید تمام اقلام فاکتور جاری پاک شود؟"
            confirmText="پاک شود"
            destructive
            onConfirm={onClearCart}
            trigger={<Button variant="outline">پاک‌کردن</Button>}
          />
          <Button
            variant="outline"
            disabled={!lastReceiptUrl}
            onClick={onPrintLastReceipt}
          >
            <Printer className="h-4 w-4" />
            چاپ
          </Button>
          <Button
            variant="outline"
            disabled={!lastReceiptUrl}
            onClick={onOpenLastReceipt}
          >
            <ExternalLink className="h-4 w-4" />
            رسید
          </Button>
        </div>
      </CardContent>
      <Dialog open={mobileDialogOpen} onOpenChange={setMobileDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>اتصال موبایل به POS</DialogTitle>
            <DialogDescription>
              این QR را با اپ موبایل Muhaseb اسکن کنید تا بارکود محصولات به همین
              صندوق ارسال شود.
            </DialogDescription>
          </DialogHeader>
          {session ? (
            <div className="space-y-4">
              <div className="mx-auto w-full max-w-[260px] bg-white p-4">
                <img
                  src={session.connection.qrImageUrl}
                  alt="POS QR Code"
                  className="block w-full"
                />
              </div>
              <div className="border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Session ID</div>
                <code
                  className="block max-h-20 overflow-auto break-all text-left text-xs text-primary"
                  dir="ltr"
                >
                  {session.session.id}
                </code>
              </div>
              <Button className="w-full gap-2" onClick={onResetSession}>
                <RefreshCcw className="size-4" />
                ساخت QR جدید
              </Button>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال ساخت QR اتصال...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
