import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, DatabaseBackup, Eye, MoreHorizontal, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api-config";

type BackupFile = {
  id: string;
  name: string;
  date: string;
  sizeBytes: number;
  size: string;
  status: string;
  path?: string;
};

type BackupPreview = {
  filename: string;
  version: number;
  createdAt: string;
  app: string;
  tableCounts: Record<string, number>;
  validation: {
    valid: boolean;
    legacy: boolean;
    restoreMode: "full" | "database-only";
    database: {
      sizeBytes: number;
      sha256: string;
      checksumMatches: boolean | null;
      archiveEntries: number;
    };
    uploads: {
      present: boolean;
      valid: boolean;
      files: number;
      totalBytes: number;
    };
    errors: string[];
    warnings: string[];
  };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tableLabel(key: string) {
  const labels: Record<string, string> = {
    companySettings: "تنظیمات شرکت",
    currencies: "کرنسی‌ها",
    warehouses: "گدام‌ها",
    units: "واحدات",
    productCategories: "کتگوری اجناس",
    products: "اجناس",
    productUnits: "واحدات اجناس",
    stockLots: "لات‌های موجودی",
    stockMovements: "حرکت‌های موجودی",
    parties: "مشتریان/فروشندگان",
    partyAccounts: "حساب‌های طرف‌ها",
    partyTransactions: "معاملات طرف‌ها",
    cashRegisters: "صندوق‌ها",
    cashRegisterAccounts: "حساب‌های صندوق",
    bankAccounts: "بانک‌ها",
    financialCategories: "کتگوری عواید/مصارف",
    posDevices: "دستگاه‌های POS",
    moneyTransactions: "تراکنش‌های پولی",
    purchases: "خریدها",
    purchaseItems: "آیتم‌های خرید",
    purchaseReturns: "برگشت‌های خرید",
    purchaseReturnItems: "آیتم‌های برگشت خرید",
    sales: "فروش‌ها",
    saleItems: "آیتم‌های فروش",
    saleReturns: "برگشت‌های فروش",
    saleReturnItems: "آیتم‌های برگشت فروش",
    accountingAccounts: "حساب‌های حسابداری",
    journalEntries: "ژورنال‌ها",
    journalLines: "لین‌های ژورنال",
  };

  return labels[key] || key;
}

export function BackupPage() {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);

  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0),
    [files],
  );

  async function loadFiles() {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/backups`);
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "لیست بکاپ‌ها خوانده نشد");
      }

      setFiles(json?.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "لیست بکاپ‌ها خوانده نشد");
    } finally {
      setIsLoading(false);
    }
  }

  async function createBackup() {
    setIsWorking(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/backups`, { method: "POST" });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "ساخت بکاپ ناکام شد");
      }

      const jobId = json?.data?.id;
      if (!jobId) throw new Error("کار بکاپ ساخته نشد");

      toast.success("ساخت بکاپ آغاز شد");
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`${API_BASE_URL}/api/backups/jobs/${encodeURIComponent(jobId)}`);
        const statusJson = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok) throw new Error(statusJson?.message || "خواندن وضعیت بکاپ ناکام شد");
        if (statusJson?.data?.status === "failed") {
          throw new Error(statusJson?.data?.error || "ساخت بکاپ ناکام شد");
        }
        if (statusJson?.data?.status === "completed") break;
      }

      toast.success("بکاپ تازه ساخته شد");
      await loadFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ساخت بکاپ ناکام شد");
    } finally {
      setIsWorking(false);
    }
  }

  async function openPreview(file: BackupFile) {
    setIsWorking(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/backups/${encodeURIComponent(file.name)}`);
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "جزئیات بکاپ خوانده نشد");
      }

      setPreview(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "جزئیات بکاپ خوانده نشد");
    } finally {
      setIsWorking(false);
    }
  }

  async function prepareRestore(file: BackupFile) {
    setIsWorking(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/backups/${encodeURIComponent(file.name)}`,
      );
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "جزئیات بکاپ خوانده نشد");
      }

      const nextPreview = json.data as BackupPreview;
      if (!nextPreview.validation.valid) {
        throw new Error(
          nextPreview.validation.errors.join("، ") || "این بکاپ برای بازیابی معتبر نیست",
        );
      }

      setRestorePreview(nextPreview);
      setRestoreTarget(file);
      setConfirmText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "اعتبارسنجی بکاپ ناکام شد");
    } finally {
      setIsWorking(false);
    }
  }

  async function restoreBackup() {
    if (!restoreTarget) return;

    setIsWorking(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/backups/${encodeURIComponent(restoreTarget.name)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "restore", confirm: "RESTORE" }),
        },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "بازگردانی بکاپ ناکام شد");
      }

      toast.success(`بازگردانی تکمیل شد. بکاپ ایمنی: ${json?.data?.safetyBackup || "-"}`);
      setRestoreTarget(null);
      setRestorePreview(null);
      setConfirmText("");
      localStorage.removeItem("belal_auth_token");
      localStorage.removeItem("belal_auth_user");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "بازگردانی بکاپ ناکام شد");
    } finally {
      setIsWorking(false);
    }
  }

  async function deleteBackup() {
    if (!deleteTarget) return;

    setIsWorking(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/backups/${encodeURIComponent(deleteTarget.name)}`, {
        method: "DELETE",
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || "حذف بکاپ ناکام شد");
      }

      toast.success("بکاپ حذف شد");
      setDeleteTarget(null);
      await loadFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف بکاپ ناکام شد");
    } finally {
      setIsWorking(false);
    }
  }

  useEffect(() => {
    void loadFiles();
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>آخرین بکاپ</CardDescription>
            <CardTitle className="text-base">
              {files[0] ? formatDate(files[0].date) : "-"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>تعداد نسخه‌ها</CardDescription>
            <CardTitle className="text-base">{files.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>حجم مجموعی</CardDescription>
            <CardTitle className="text-base">{(totalSize / 1024 / 1024).toFixed(2)}MB</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>وضعیت</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              محافظت شده
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DatabaseBackup className="size-5 text-primary" />
              نسخه پشتیبان و بازیابی
            </CardTitle>
            <CardDescription>
              بازگردانی قبل از جایگزینی اطلاعات، یک بکاپ فوری از وضعیت فعلی می‌سازد.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadFiles} disabled={isLoading || isWorking}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button onClick={createBackup} disabled={isWorking}>
              <DatabaseBackup className="size-4" />
              ساخت بکاپ
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                <TableHead>نام فایل</TableHead>
                <TableHead>تاریخ</TableHead>
                <TableHead>حجم</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="w-16 text-center">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    در حال خواندن بکاپ‌ها...
                  </TableCell>
                </TableRow>
              ) : files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    هنوز بکاپ ساخته نشده است.
                  </TableCell>
                </TableRow>
              ) : (
                files.map((file) => (
                  <TableRow key={file.id} className="border-border">
                    <TableCell className="font-mono text-[11px]">{file.name}</TableCell>
                    <TableCell>{formatDate(file.date)}</TableCell>
                    <TableCell>{file.size}</TableCell>
                    <TableCell>
                      <Badge className="bg-primary/15 text-primary">{file.status || "موفق"}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="outline" title="عملیات">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={6} className="w-44" dir="rtl">
                          <DropdownMenuLabel>عملیات</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openPreview(file)}>
                            <Eye className="size-4" />
                            <span>جزئیات</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void prepareRestore(file)}
                          >
                            <ArchiveRestore className="size-4" />
                            <span>بازگردانی</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(file)}>
                            <Trash2 className="size-4" />
                            <span>حذف</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>جزئیات بکاپ</DialogTitle>
            <DialogDescription>
              {preview ? `${preview.filename} - ${formatDate(preview.createdAt)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">اعتبار بکاپ</p>
                <Badge
                  className={
                    preview.validation.valid
                      ? "mt-1 bg-emerald-500/15 text-emerald-600"
                      : "mt-1 bg-destructive/15 text-destructive"
                  }
                >
                  {preview.validation.valid ? "معتبر" : "نامعتبر"}
                </Badge>
              </div>
              <div className="border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">نوع بازیابی</p>
                <p className="mt-1 text-sm font-medium">
                  {preview.validation.restoreMode === "full"
                    ? "دیتابیس و فایل‌ها"
                    : "فقط دیتابیس؛ فایل‌های فعلی حفظ می‌شوند"}
                </p>
              </div>
              <div className="border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">فایل‌های ضمیمه</p>
                <p className="mt-1 text-sm font-medium">
                  {preview.validation.uploads.present
                    ? `${preview.validation.uploads.files} فایل`
                    : "داخل بکاپ نیست"}
                </p>
              </div>
            </div>
          )}
          {preview?.validation.errors.map((message) => (
            <p
              key={message}
              className="border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
            >
              {message}
            </p>
          ))}
          {preview?.validation.warnings.map((message) => (
            <p
              key={message}
              className="border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300"
            >
              {message}
            </p>
          ))}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {preview &&
              Object.entries(preview.tableCounts).map(([key, count]) => (
                <div key={key} className="rounded-lg border border-border bg-background/40 p-3">
                  <p className="text-xs text-muted-foreground">{tableLabel(key)}</p>
                  <p className="mt-1 text-lg font-semibold">{count}</p>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            setRestorePreview(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>تایید بازگردانی</DialogTitle>
            <DialogDescription>
              این عملیات اطلاعات فعلی فروشگاه را با بکاپ انتخاب‌شده جایگزین می‌کند و قبل از شروع، بکاپ فوری می‌سازد.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
              <p className="text-muted-foreground">فایل انتخاب‌شده</p>
              <p className="mt-1 font-mono text-xs">{restoreTarget?.name}</p>
            </div>
            {restorePreview && (
              <div className="border border-primary/30 bg-primary/10 p-3 text-sm">
                {restorePreview.validation.restoreMode === "full"
                  ? "دیتابیس و فایل‌های ضمیمه بازیابی می‌شوند."
                  : "این بکاپ فقط دیتابیس است؛ فایل‌های فعلی حذف یا جایگزین نمی‌شوند."}
              </div>
            )}
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">برای تایید، RESTORE را بنویسید</span>
              <Input
                dir="ltr"
                className="font-mono"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRestoreTarget(null);
                setRestorePreview(null);
              }}
            >
              لغو
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "RESTORE" || isWorking}
              onClick={restoreBackup}
            >
              اجرای بازگردانی
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف بکاپ</AlertDialogTitle>
            <AlertDialogDescription>
              فایل {deleteTarget?.name} حذف می‌شود. این عمل برگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>لغو</AlertDialogCancel>
            <AlertDialogAction onClick={deleteBackup} disabled={isWorking}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
