import { KeyboardEvent, forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Barcode, ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PosBarcodeInputCardRef = {
  focus: () => void;
  clear: () => void;
};

type PosBarcodeInputCardProps = {
  warehouseName?: string;
  isWsConnected: boolean;
  onScanBarcode: (barcode: string) => void;
};

export const PosBarcodeInputCard = forwardRef<
  PosBarcodeInputCardRef,
  PosBarcodeInputCardProps
>(function PosBarcodeInputCard(
  { warehouseName, isWsConnected, onScanBarcode },
  ref
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [barcode, setBarcode] = useState("");

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
    },
    clear() {
      setBarcode("");
      inputRef.current?.focus();
    },
  }));

  function submitBarcode() {
    const value = barcode.trim();

    if (!value) {
      inputRef.current?.focus();
      return;
    }

    onScanBarcode(value);
    setBarcode("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitBarcode();
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-3 p-3">
        <div className="grid gap-2 xl:grid-cols-[1fr_auto]">
          <div className="relative">
            <Barcode className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="بارکود را اسکن یا وارد کنید..."
            className="h-12 ps-11 text-lg font-bold"
            dir="ltr"
            autoFocus
          />
          </div>

          <Button className="h-12 gap-2 px-5" onClick={submitBarcode}>
            <ScanLine className="h-4 w-4" />
            اسکن بارکود
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={isWsConnected ? "default" : "secondary"}>
            {isWsConnected ? "همگام‌سازی فعال" : "اتصال جایگزین"}
          </Badge>
          <span>
            گدام فعال:{" "}
            <span className="font-bold text-foreground">{warehouseName || "-"}</span>
          </span>
          <span>F2 فوکس</span>
          <span>افزودن با Enter</span>
        </div>
      </CardContent>
    </Card>
  );
});
