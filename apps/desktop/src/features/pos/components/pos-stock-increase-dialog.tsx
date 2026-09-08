import { PackagePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { cn } from "@/lib/utils";

import { ApiRequestError, increaseInventoryFromPos, loadProducts } from "../api";
import type { Currency, ProductSearchItem, Warehouse } from "../types";
import { money } from "../utils";

type ProductUnitOption = {
  unitId: string;
  unitName: string;
  conversionRate: number;
  purchasePrice: number;
  salePrice: number;
  isDefaultPurchase?: boolean;
};

type ProductUnitSearchItem = NonNullable<ProductSearchItem["units"]>[number];

type PosStockIncreaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiBaseUrl: string;
  warehouse: Warehouse | null;
  currency: Currency | null;
  initialProducts: ProductSearchItem[];
  onStockIncreased: () => Promise<void> | void;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createInventoryOperationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `pos-stock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function priceInCurrency(basePrice: number, currency: Currency | null) {
  if (!currency || currency.isBase) return numberValue(basePrice);
  const rate = numberValue(currency.latestRate);
  return rate > 0 ? numberValue(basePrice) / rate : numberValue(basePrice);
}

function unitName(unit: ProductUnitSearchItem["unit"]) {
  return unit?.shortName || unit?.name || "واحد";
}

function buildUnitOptions(product: ProductSearchItem | null): ProductUnitOption[] {
  if (!product) return [];

  const options =
    product.units?.map((item) => ({
      unitId: item.unitId,
      unitName: unitName(item.unit),
      conversionRate: numberValue(item.conversionRate || 1) || 1,
      purchasePrice: numberValue(item.purchasePrice),
      salePrice: numberValue(item.salePrice),
      isDefaultPurchase: item.isDefaultPurchase,
    })) || [];

  const baseUnitId = product.baseUnitId || product.baseUnit?.id || "";
  const hasBaseUnit = options.some((item) => item.unitId === baseUnitId);

  if (baseUnitId && !hasBaseUnit) {
    const sourceUnit = options.find((item) => item.isDefaultPurchase) || options[0] || null;
    const sourceRate = numberValue(sourceUnit?.conversionRate || 1) || 1;
    options.unshift({
      unitId: baseUnitId,
      unitName: product.baseUnit?.shortName || product.baseUnit?.name || "واحد پایه",
      conversionRate: 1,
      purchasePrice: numberValue(sourceUnit?.purchasePrice) / sourceRate,
      salePrice: numberValue(sourceUnit?.salePrice) / sourceRate,
      isDefaultPurchase: true,
    });
  }

  return options;
}

function defaultUnitForProduct(product: ProductSearchItem | null) {
  const options = buildUnitOptions(product);
  const baseUnitId = product?.baseUnitId || product?.baseUnit?.id || "";

  return (
    options.find((item) => item.isDefaultPurchase) ||
    options.find((item) => item.unitId === baseUnitId) ||
    options[0] ||
    null
  );
}

export function PosStockIncreaseDialog({
  open,
  onOpenChange,
  apiBaseUrl,
  warehouse,
  currency,
  initialProducts,
  onStockIncreased,
}: PosStockIncreaseDialogProps) {
  const [products, setProducts] = useState<ProductSearchItem[]>(initialProducts);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] =
    useState<ProductSearchItem | null>(null);
  const [unitId, setUnitId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const productRequestAbortRef = useRef<AbortController | null>(null);
  const operationRef = useRef<{ signature: string; id: string } | null>(null);

  const unitOptions = useMemo(
    () => buildUnitOptions(selectedProduct),
    [selectedProduct],
  );
  const selectedUnit = unitOptions.find((item) => item.unitId === unitId) || null;
  const baseQuantity =
    numberValue(quantity) * numberValue(selectedUnit?.conversionRate || 1);
  const baseUnitCost =
    selectedUnit && selectedUnit.conversionRate > 0
      ? numberValue(unitCost) / selectedUnit.conversionRate
      : numberValue(unitCost);

  useEffect(() => {
    if (!open) return;

    setProducts((current) => {
      const selected = current.find((item) => item.id === selectedProduct?.id);
      return selected
        ? [selected, ...initialProducts.filter((item) => item.id !== selected.id)]
        : initialProducts;
    });
  }, [initialProducts, open]);

  useEffect(() => {
    if (!open) return;

    productRequestAbortRef.current?.abort();
    const abortController = new AbortController();
    productRequestAbortRef.current = abortController;

    const timer = window.setTimeout(() => void (async () => {
      const search = productSearch.trim();
      if (!search) {
        setProducts((current) => {
          const selected = current.find((item) => item.id === selectedProduct?.id);
          return selected
            ? [selected, ...initialProducts.filter((item) => item.id !== selected.id)]
            : initialProducts;
        });
        setLoadingProducts(false);
        if (productRequestAbortRef.current === abortController) {
          productRequestAbortRef.current = null;
        }
        return;
      }

      setLoadingProducts(true);
      try {
        const response = await loadProducts(apiBaseUrl, {
          search,
          warehouseId: warehouse?.id || null,
          limit: 80,
          signal: abortController.signal,
        });
        setProducts((current) => {
          const selected = current.find((item) => item.id === selectedProduct?.id);
          return selected
            ? [selected, ...response.data.filter((item) => item.id !== selected.id)]
            : response.data;
        });
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        toast.error(
          error instanceof Error ? error.message : "جستجوی محصول ناکام شد",
        );
      } finally {
        if (productRequestAbortRef.current === abortController) {
          productRequestAbortRef.current = null;
          setLoadingProducts(false);
        }
      }
    })(), 250);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [apiBaseUrl, initialProducts, open, productSearch, warehouse?.id]);

  useEffect(() => {
    if (!selectedProduct) return;

    const defaultUnit = defaultUnitForProduct(selectedProduct);
    setUnitId(defaultUnit?.unitId || "");
    setUnitCost(priceInCurrency(defaultUnit?.purchasePrice || 0, currency));
    setExpiryDate("");
    operationRef.current = null;
  }, [selectedProduct, currency]);

  function selectUnit(nextUnitId: string) {
    const unit = unitOptions.find((item) => item.unitId === nextUnitId) || null;
    setUnitId(nextUnitId);
    setUnitCost(priceInCurrency(unit?.purchasePrice || 0, currency));
    operationRef.current = null;
  }

  function resetForm() {
    setSelectedProduct(null);
    setUnitId("");
    setQuantity(1);
    setUnitCost(0);
    setExpiryDate("");
    setNote("");
    setProductSearch("");
    operationRef.current = null;
  }

  function closeDialog() {
    resetForm();
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }

    if (!warehouse?.id) {
      toast.error("گدام فعال برای POS تنظیم نشده است");
      return;
    }

    if (!selectedProduct?.id || !unitId) {
      toast.error("محصول و واحد را انتخاب کنید");
      return;
    }

    if (numberValue(quantity) <= 0) {
      toast.error("مقدار باید بیشتر از صفر باشد");
      return;
    }

    if (numberValue(unitCost) < 0) {
      toast.error("قیمت تمام‌شده معتبر نیست");
      return;
    }

    if (selectedProduct.hasExpiry && !expiryDate) {
      toast.error("برای این محصول تاریخ انقضا ضروری است");
      return;
    }

    const request = {
      productId: selectedProduct.id,
      warehouseId: warehouse.id,
      unitId,
      quantity: numberValue(quantity),
      unitCost: numberValue(unitCost),
      currencyId: currency?.id || null,
      expiryDate: selectedProduct.hasExpiry ? expiryDate || null : null,
      note: note.trim() || "افزایش موجودی از صفحه فروش سریع",
    };
    const signature = JSON.stringify(request);
    if (operationRef.current?.signature !== signature) {
      operationRef.current = { signature, id: createInventoryOperationId() };
    }

    const operationId = operationRef.current.id;
    setSaving(true);
    try {
      await increaseInventoryFromPos({
        baseUrl: apiBaseUrl,
        operationId,
        ...request,
      });

      toast.success("موجودی محصول افزایش یافت");
      operationRef.current = null;
      closeDialog();
      try {
        await onStockIncreased();
      } catch (refreshError) {
        toast.warning(
          refreshError instanceof Error
            ? `موجودی ثبت شد، اما تازه‌سازی لیست ناکام شد: ${refreshError.message}`
            : "موجودی ثبت شد، اما تازه‌سازی لیست ناکام شد",
        );
      }
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        operationRef.current = null;
      }
      toast.error(
        error instanceof Error ? error.message : "ثبت افزایش موجودی ناکام شد",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && saving) return;
        onOpenChange(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-[min(96vw,840px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <PackagePlus className="size-5" />
            </span>
            افزایش موجودی از POS
          </DialogTitle>
          <DialogDescription>
            محصول را انتخاب کنید؛ قیمت تمام‌شده از واحد انتخابی خوانده می‌شود و
            ورود موجودی در گدام فعال ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">محصول</span>
              <Combobox
                value={selectedProduct?.id || ""}
                options={products.map((product) => ({
                  value: product.id,
                  label: product.name,
                  description: [
                    product.barcode ? `بارکود: ${product.barcode}` : null,
                    product.sku ? `کد: ${product.sku}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  meta: `موجودی: ${numberValue(product.totalStock)}`,
                  barcode: product.barcode,
                  sku: product.sku,
                  searchText: product.name,
                }))}
                placeholder="انتخاب محصول"
                searchPlaceholder="جستجو با نام، کد یا بارکود..."
                emptyText={loadingProducts ? "در حال جستجو..." : "محصولی پیدا نشد"}
                onSearchChange={setProductSearch}
                onValueChange={(value) => {
                  const product = products.find((item) => item.id === value) || null;
                  setSelectedProduct(product);
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">واحد</span>
              <Combobox
                value={unitId}
                options={unitOptions.map((unit) => ({
                  value: unit.unitId,
                  label: unit.unitName,
                  description: `ریت تبدیل: ${unit.conversionRate}`,
                  meta: money(unit.purchasePrice, currency),
                }))}
                placeholder="انتخاب واحد"
                emptyText="برای این محصول واحدی تعریف نشده است"
                onValueChange={selectUnit}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">مقدار</span>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={quantity}
                onChange={(event) => setQuantity(numberValue(event.target.value))}
                required
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                قیمت تمام‌شده واحد انتخابی
              </span>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={unitCost}
                onChange={(event) => setUnitCost(numberValue(event.target.value))}
                required
              />
            </label>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">خلاصه واحد پایه</span>
              <div className="grid min-h-10 content-center rounded-lg border border-border bg-muted/40 px-3 text-xs text-muted-foreground">
                <span>
                  مقدار پایه:{" "}
                  <strong className="text-foreground">
                    {new Intl.NumberFormat("en-US", {
                      maximumFractionDigits: 3,
                    }).format(baseQuantity)}
                  </strong>
                </span>
                <span>
                  قیمت هر واحد پایه:{" "}
                  <strong className="text-foreground">
                    {money(baseUnitCost, currency)}
                  </strong>
                </span>
              </div>
            </div>

            {selectedProduct?.hasExpiry ? (
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs text-muted-foreground">تاریخ انقضا</span>
                <ManualDateInput value={expiryDate} onChange={setExpiryDate} />
              </label>
            ) : null}

            <label
              className={cn(
                "space-y-1 md:col-span-2",
                !selectedProduct?.hasExpiry && "md:col-span-2",
              )}
            >
              <span className="text-xs text-muted-foreground">یادداشت</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                placeholder="اختیاری"
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={saving}
            >
              لغو
            </Button>
            <Button type="submit" disabled={saving || !selectedProduct}>
              {saving ? "در حال ثبت..." : "ثبت افزایش موجودی"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
