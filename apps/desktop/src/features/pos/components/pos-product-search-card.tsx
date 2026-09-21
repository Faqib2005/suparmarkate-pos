import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Barcode,
  BottleWine,
  Grid2X2,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { ProductSearchItem } from "../types";

type PosProductSearchCardProps = {
  searchTerm: string;
  products: ProductSearchItem[];
  categories: Array<{ id: string; name: string; count: number }>;
  activeCategoryId: string;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  totalProducts?: number;
  warehouseName?: string;
  currencyCode?: string;
  currencyRate?: number;
  apiBaseUrl?: string;
  isWsConnected: boolean;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onLoadMore?: () => void;
  onAddProduct: (barcode: string, productId?: string) => void;
  onScanBarcode: (barcode: string) => void;
};

export type PosProductSearchCardRef = {
  focusBarcode: () => void;
  clearBarcode: () => void;
};

function getDefaultSalePrice(product: ProductSearchItem) {
  const unit =
    product.units?.find((item) => item.isDefaultSale) || product.units?.[0];

  return Number(unit?.salePrice || 0);
}

function getUnitName(product: ProductSearchItem) {
  const unit =
    product.units?.find((item) => item.isDefaultSale) || product.units?.[0];

  return (
    unit?.unit?.shortName ||
    unit?.unit?.name ||
    product.baseUnit?.shortName ||
    product.baseUnit?.name ||
    "واحد"
  );
}

function getProductVisual(
  product: ProductSearchItem,
  index: number,
  apiBaseUrl = "",
) {
  if (product.imageUrl) {
    const src = product.imageUrl.startsWith("http")
      ? product.imageUrl
      : `${apiBaseUrl}${product.imageUrl}`;

    return (
      <img
        src={src}
        alt={product.name}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }

  const name = product.name.toLowerCase();

  if (name.includes("شیر") || name.includes("کولا") || name.includes("نوش")) {
    return <BottleWine className="h-14 w-14" />;
  }

  if (index % 3 === 0) {
    return <Barcode className="h-14 w-14" />;
  }

  return <Package className="h-14 w-14" />;
}

function productAvailability(product: ProductSearchItem) {
  const totalStock = Number(product.totalStock || 0);
  const minStock = Number(product.minStock || 0);

  if (product.isActive === false) {
    return {
      label: "غیرفعال",
      className: "bg-muted text-muted-foreground",
    };
  }

  if (totalStock <= 0) {
    return {
      label: "ناموجود",
      className: "bg-destructive/15 text-destructive",
    };
  }

  if (minStock > 0 && totalStock <= minStock) {
    return {
      label: "موجودی کم",
      className: "bg-amber-500/15 text-amber-300",
    };
  }

  return {
    label: "موجود",
    className: "bg-emerald-500/15 text-emerald-400",
  };
}

export const PosProductSearchCard = forwardRef<
  PosProductSearchCardRef,
  PosProductSearchCardProps
>(function PosProductSearchCard(
  {
    searchTerm,
    products,
    categories,
    activeCategoryId,
    isLoading,
    isLoadingMore = false,
    hasMore = false,
    totalProducts = 0,
    warehouseName,
    currencyCode,
    currencyRate = 1,
    apiBaseUrl,
    isWsConnected,
    onSearchChange,
    onCategoryChange,
    onLoadMore,
    onAddProduct,
    onScanBarcode,
  },
  ref,
) {
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const productListRef = useRef<HTMLDivElement | null>(null);
  const [barcode, setBarcode] = useState("");
  const [listWidth, setListWidth] = useState(0);
  const columnCount = listWidth >= 1280 ? 4 : listWidth >= 640 ? 3 : 1;
  const rows = useMemo(() => {
    const nextRows: ProductSearchItem[][] = [];

    for (let index = 0; index < products.length; index += columnCount) {
      nextRows.push(products.slice(index, index + columnCount));
    }

    return nextRows;
  }, [columnCount, products]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => productListRef.current,
    estimateSize: () => 226,
    overscan: 5,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const element = productListRef.current;
    if (!element) return;

    const updateWidth = () => setListWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    rowVirtualizer.scrollToIndex(0);
  }, [activeCategoryId, rowVirtualizer, searchTerm]);

  useEffect(() => {
    const lastRow = virtualRows.at(-1);
    if (!lastRow || !hasMore || isLoading || isLoadingMore) return;

    if (lastRow.index >= rows.length - 3) {
      onLoadMore?.();
    }
  }, [hasMore, isLoading, isLoadingMore, onLoadMore, rows.length, virtualRows]);

  useImperativeHandle(ref, () => ({
    focusBarcode() {
      barcodeInputRef.current?.focus();
    },
    clearBarcode() {
      setBarcode("");
      barcodeInputRef.current?.focus();
    },
  }));

  function submitBarcode() {
    const value = barcode.trim();

    if (!value) {
      barcodeInputRef.current?.focus();
      return;
    }

    onScanBarcode(value);
    setBarcode("");
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  }

  function handleBarcodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitBarcode();
    }
  }

  return (
    <Card className="overflow-hidden border-border bg-card shadow-sm">
      <CardHeader className="gap-3">
        <div className="grid gap-3 xl:grid-cols-[260px_1fr_auto]">
          <div className="relative">
            <Barcode className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={barcodeInputRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              placeholder="اسکن بارکود"
              className="h-12 ps-11 font-bold"
              dir="ltr"
            />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="جستجوی محصول با نام، بارکود یا کد"
              className="h-12 ps-10"
            />
          </div>

          <Button className="h-12 gap-2 px-5" onClick={submitBarcode}>
            <Barcode className="h-5 w-5" />
            افزودن
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <Button
            size="sm"
            className="gap-2"
            variant={activeCategoryId === "all" ? "default" : "ghost"}
            onClick={() => onCategoryChange("all")}
          >
            <Grid2X2 className="h-4 w-4" />
            همه محصولات
          </Button>
          {categories.slice(0, 8).map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={activeCategoryId === item.id ? "default" : "ghost"}
              onClick={() => onCategoryChange(item.id)}
            >
              {item.name}
              <Badge
                variant="secondary"
                className="ms-1 h-5 px-1.5 text-[10px]"
              >
                {item.count}
              </Badge>
            </Button>
          ))}
          <Button size="icon-sm" variant="outline" className="me-auto">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Badge variant={isWsConnected ? "default" : "secondary"}>
            {isWsConnected ? "همگام‌سازی فعال" : "اتصال جایگزین"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            گدام فعال:{" "}
            <span className="font-medium text-foreground">
              {warehouseName || "-"}
            </span>
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div
          ref={productListRef}
          className="h-[70.5vh] overflow-auto rounded-xl"
        >
          {isLoading ? (
            <div className="rounded-xl border border-border bg-muted/20 py-12 text-center text-sm text-muted-foreground">
              در حال دریافت محصولات...
            </div>
          ) : products.length ? (
            <div
              className="relative p-1"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualRows.map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  className="absolute inset-s-0 top-0 grid w-full gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rows[virtualRow.index]?.map((product, columnIndex) => {
                    const productIndex =
                      virtualRow.index * columnCount + columnIndex;
                    const price = getDefaultSalePrice(product) / currencyRate;
                    const availability = productAvailability(product);

                    return (
                      <div
                        key={product.id}
                        className={`group relative grid min-h-52.5 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:${availability.className && "border-primary/45"} hover:shadow-lg`}
                      >
                        <div className="pointer-events-none absolute -inset-s-10 -top-10 size-28 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/20" />
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/30" />

                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="grid gap-5">
                            <Badge className={availability.className}>
                              {availability.label}
                            </Badge>
                            <div className="line-clamp-2 min-h-10 text-sm font-bold leading-6">
                              {product.name}
                            </div>
                          </div>
                          <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-xl border border-border/80 bg-background/75 text-primary shadow-inner transition group-hover:scale-[1.02]">
                            {getProductVisual(
                              product,
                              productIndex,
                              apiBaseUrl,
                            )}
                          </div>
                        </div>

                        <div className="grid gap-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>واحد: {getUnitName(product)}</span>
                            <span dir="ltr" className="font-mono">
                              {product.sku || product.barcode || "-"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-auto flex items-end justify-between gap-3">
                          <Button
                            size="icon"
                            variant="outline"
                            disabled={product.isActive === false}
                            onClick={() =>
                              onAddProduct(product.barcode || "", product.id)
                            }
                            className="size-9 rounded-xl border-primary/35 bg-primary/10 text-primary shadow-sm hover:bg-primary hover:text-primary-foreground"
                            title="افزودن به فاکتور"
                          >
                            <Plus className="h-5 w-5" />
                          </Button>

                          <div className="text-end">
                            <div className="text-lg font-black text-primary">
                              {new Intl.NumberFormat("en-US").format(price)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {currencyCode || "AFN"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {isLoadingMore ? (
                <div className="absolute inset-x-1 bottom-1 rounded-xl border border-border bg-card/95 py-3 text-center text-xs text-muted-foreground">
                  در حال دریافت بیشتر...
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/20 py-16 text-center text-sm text-muted-foreground">
              محصولی پیدا نشد.
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {products.length} / {totalProducts || products.length}
          </span>
          <span>
            {hasMore
              ? "برای دیدن بیشتر اسکرول کنید"
              : "همه نتایج نمایش داده شد"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
