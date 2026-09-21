import { AlertTriangle, Pencil, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { API_BASE_URL } from "@/lib/api-config";

type PosDataQualityIssue = {
  id: string;
  name: string;
  barcode: string | null;
  reason: string;
  fallbackToBaseUnitIsSafe: boolean;
  baseUnit: { unitId: string; unitName: string; salePrice: number } | null;
};

type PosDataQualityDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditProduct: (productId: string) => void;
};

export function PosDataQualityDialog({
  open,
  onOpenChange,
  onEditProduct,
}: PosDataQualityDialogProps) {
  const [items, setItems] = useState<PosDataQualityIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/products/pos-data-quality`, {
        signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "خواندن گزارش POS ناکام شد");
      setItems(Array.isArray(json?.data) ? json.data : []);
      setTotal(Number(json?.summary?.saleUnitIssues || 0));
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error(error instanceof Error ? error.message : "خواندن گزارش صندوق فروش ناکام شد");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      requestRef.current?.abort();
      return;
    }
    void load();
    return () => requestRef.current?.abort();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-600" />
            آمادگی واحد فروش POS
          </DialogTitle>
          <DialogDescription>
            این گزارش فقط داده‌های ناقص قدیمی را نشان می‌دهد و چیزی را خودکار تغییر نمی‌دهد.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Badge variant={total ? "secondary" : "outline"}>
            {total ? `${total} مورد نیازمند بررسی` : "همه واحدهای فروش آماده‌اند"}
          </Badge>
          <Button type="button" size="icon-sm" variant="outline" title="تازه‌سازی" onClick={() => void load()} disabled={isLoading}>
            <RefreshCcw className={isLoading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pe-1">
          {!isLoading && items.length === 0 ? (
            <div className="border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              موردی پیدا نشد.
            </div>
          ) : null}
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border border-border p-3">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.reason} · {item.barcode || "بدون بارکود"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.fallbackToBaseUnitIsSafe && item.baseUnit
                    ? `fallback امن: ${item.baseUnit.unitName} با قیمت ${item.baseUnit.salePrice}`
                    : "fallback امن برای واحد پایه موجود نیست؛ فروش POS مسدود می‌ماند"}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onEditProduct(item.id);
                }}
              >
                <Pencil />
                اصلاح
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
