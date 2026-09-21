import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ComboboxOption = {
  value: string;
  label: string;
  description?: string | null;
  meta?: string | null;
  searchText?: string | null;
  barcode?: string | null;
  sku?: string | null;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  emptyAction?: ReactNode;
  onSearchChange?: (value: string) => void;
  onValueChange: (value: string) => void;
  className?: string;
};

const digitMap: Record<string, string> = {
  "\u06f0": "0",
  "\u06f1": "1",
  "\u06f2": "2",
  "\u06f3": "3",
  "\u06f4": "4",
  "\u06f5": "5",
  "\u06f6": "6",
  "\u06f7": "7",
  "\u06f8": "8",
  "\u06f9": "9",
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9",
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u06f0-\u06f9\u0660-\u0669]/g, (digit) => digitMap[digit] || digit)
    .replace(/\u0643/g, "\u06a9")
    .replace(/[\u064a\u0649]/g, "\u06cc")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeBarcodeText(value: unknown) {
  return normalizeSearchText(value).replace(/[\s\u200b\u200c\u200d\u2060-]/g, "");
}

export function Combobox({
  options,
  value,
  placeholder = "انتخاب کنید",
  searchPlaceholder = "جستجو...",
  emptyText = "موردی پیدا نشد",
  emptyAction,
  onSearchChange,
  onValueChange,
  className,
}: ComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const remoteSearchTimerRef = useRef<number | null>(null);
  const [lastSelectedOption, setLastSelectedOption] =
    useState<ComboboxOption | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const selected =
    options.find((option) => option.value === value) ||
    (lastSelectedOption?.value === value ? lastSelectedOption : null);
  const normalizedQuery = normalizeSearchText(query);
  const normalizedBarcodeQuery = normalizeBarcodeText(query);
  const filteredOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) => {
            const haystack = [
              option.label,
              option.description,
              option.meta,
              option.searchText,
              option.barcode,
              option.sku,
            ]
              .filter(Boolean)
              .join(" ");
            const normalizedHaystack = normalizeSearchText(haystack);
            const normalizedBarcodeHaystack = normalizeBarcodeText(haystack);

            return (
              normalizedHaystack.includes(normalizedQuery) ||
              (!!normalizedBarcodeQuery &&
                normalizedBarcodeHaystack.includes(normalizedBarcodeQuery))
            );
          })
        : options,
    [normalizedBarcodeQuery, normalizedQuery, options],
  );
  const optionVirtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  const virtualOptions = optionVirtualizer.getVirtualItems();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (remoteSearchTimerRef.current !== null) {
        window.clearTimeout(remoteSearchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!value) {
      setLastSelectedOption(null);
      return;
    }

    const option = options.find((item) => item.value === value);
    if (option) {
      setLastSelectedOption((current) =>
        current?.value === option.value ? current : option,
      );
    }
  }, [options, value]);

  useEffect(() => {
    if (!open) return;

    function updatePanelPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        zIndex: 1000,
      });
    }

    updatePanelPosition();
    window.addEventListener("scroll", updatePanelPosition, true);
    window.addEventListener("resize", updatePanelPosition);

    return () => {
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionVirtualizer.scrollToIndex(0);
  }, [normalizedQuery, open, optionVirtualizer]);

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    if (!onSearchChange) return;

    if (remoteSearchTimerRef.current !== null) {
      window.clearTimeout(remoteSearchTimerRef.current);
    }
    remoteSearchTimerRef.current = window.setTimeout(() => {
      remoteSearchTimerRef.current = null;
      onSearchChange(nextQuery);
    }, 250);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="h-10 w-full justify-between"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label || placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </Button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              className="rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
              dir="rtl"
            >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 ps-9"
            />
          </div>

          <div ref={listRef} className="max-h-64 overflow-auto">
            {filteredOptions.length ? (
              <div
                className="relative"
                style={{ height: optionVirtualizer.getTotalSize() }}
              >
                {virtualOptions.map((virtualOption) => {
                  const option = filteredOptions[virtualOption.index];
                  if (!option) return null;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="absolute start-0 top-0 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-secondary"
                      style={{
                        minHeight: virtualOption.size,
                        transform: `translateY(${virtualOption.start}px)`,
                      }}
                      onClick={() => {
                        if (remoteSearchTimerRef.current !== null) {
                          window.clearTimeout(remoteSearchTimerRef.current);
                          remoteSearchTimerRef.current = null;
                        }
                        // Stop an in-flight remote search before it can replace the
                        // selected product with an older result set.
                        setLastSelectedOption(option);
                        onSearchChange?.("");
                        onValueChange(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>

                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {option.meta ? <span>{option.meta}</span> : null}
                        <Check
                          className={cn(
                            "h-4 w-4",
                            option.value === value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-5 text-center text-sm text-muted-foreground">
                <div>{emptyText}</div>
                {emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
              </div>
            )}
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
