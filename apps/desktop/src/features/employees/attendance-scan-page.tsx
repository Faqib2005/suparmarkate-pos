import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, LogIn, QrCode, UserRound, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiGet, apiSend } from "@/features/employees/hr-api";
import { API_BASE_URL } from "@/lib/api-config";
import { useBaseCurrencyCode } from "@/lib/use-base-currency";

const AUTH_TOKEN_KEY = "belal_auth_token";
const AUTH_USER_KEY = "belal_auth_user";

type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string | null;
  permissions: string[];
  employee?: {
    id: string;
    code?: string | null;
    fullName: string;
    position?: string | null;
    monthlySalary: number;
  } | null;
};

type ScanResult = {
  action: "CHECK_IN" | "CHECK_OUT" | "ALREADY_DONE";
  message: string;
  record?: {
    checkInAt?: string | null;
    checkOutAt?: string | null;
    status?: string;
    workedMinutes?: number;
    overtimeMinutes?: number;
  };
};

type EmployeeMe = {
  employee: {
    id: string;
    code?: string | null;
    fullName: string;
    position?: string | null;
    monthlySalary: number;
  };
  summary: {
    presentDays: number;
    halfDays: number;
    absentDays: number;
    overtimeHours: number;
    monthlySalary: number;
    latestPayroll?: {
      grossPay: number;
      paidAmount: number;
      remainingAmount: number;
      period?: { name: string } | null;
    } | null;
  };
};

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function money(value: number | string) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

export function AttendanceScanPage() {
  const baseCurrencyCode = useBaseCurrencyCode();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "",
    [],
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [employeeMe, setEmployeeMe] = useState<EmployeeMe | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  async function loadEmployeeMe() {
    const me = await apiGet<EmployeeMe>("/api/employees/me");
    setEmployeeMe(me);
  }

  async function loadSession() {
    const saved = localStorage.getItem(AUTH_USER_KEY);
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        localStorage.removeItem(AUTH_USER_KEY);
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`);
      if (!response.ok) throw new Error("نشست فعال پیدا نشد");
      const json = await response.json();
      setUser(json.data.user);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(json.data.user));
      await loadEmployeeMe();
    } catch {
      setUser(null);
      setEmployeeMe(null);
    }
  }

  useEffect(() => {
    loadSession();
  }, []);

  async function login() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.message || "ورود انجام نشد");
      if (!json?.data?.user?.employee) {
        throw new Error("این کاربر به کارمند فعال وصل نیست");
      }

      localStorage.setItem(AUTH_TOKEN_KEY, json.data.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(json.data.user));
      setUser(json.data.user);
      setPassword("");
      await loadEmployeeMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ورود انجام نشد");
    } finally {
      setLoading(false);
    }
  }

  async function submitAttendance() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = await apiSend<ScanResult>("/api/attendance/scan-auth", "POST", {
        token,
      });
      setResult(data);
      await loadEmployeeMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت حاضری انجام نشد");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setUser(null);
    setEmployeeMe(null);
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-lg items-center">
        <Card className="w-full border-border bg-card shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <QrCode className="size-8" />
            </div>
            <CardTitle className="font-heading text-2xl">حاضری کارمند</CardTitle>
            <CardDescription>
              روش اصلی حاضری، اسکن همین QR با اپ موبایل POS است. این صفحه فقط برای حالت
              fallback در Browser/PWA نگه داشته شده است.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!user ? (
              <div className="space-y-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">نام کاربری</span>
                  <Input value={username} onChange={(event) => setUsername(event.target.value)} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">رمز عبور</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <Button className="h-12 w-full gap-2" disabled={loading} onClick={login}>
                  <LogIn className="size-5" />
                  {loading ? "در حال ورود..." : "ورود کارمند"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                        <UserRound className="size-6" />
                      </div>
                      <div>
                        <strong>{employeeMe?.employee.fullName || user.displayName}</strong>
                        <p className="text-xs text-muted-foreground">
                          {employeeMe?.employee.position || user.role || "کارمند"}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={logout}>
                      خروج
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Badge className="justify-center bg-background py-2 text-foreground">
                    حاضر: {employeeMe?.summary.presentDays || 0} روز
                  </Badge>
                  <Badge className="justify-center bg-background py-2 text-foreground">
                    نیم‌حاضر: {employeeMe?.summary.halfDays || 0} روز
                  </Badge>
                  <Badge className="justify-center bg-background py-2 text-foreground">
                    غیبت: {employeeMe?.summary.absentDays || 0} روز
                  </Badge>
                  <Badge className="justify-center bg-background py-2 text-foreground">
                    اضافه‌کاری: {employeeMe?.summary.overtimeHours || 0} ساعت
                  </Badge>
                </div>

                <div className="rounded-xl border border-border bg-background/70 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">معاش ماهانه</span>
                    <strong>{money(employeeMe?.summary.monthlySalary || 0)} {baseCurrencyCode}</strong>
                  </div>
                  {employeeMe?.summary.latestPayroll ? (
                    <div className="mt-3 grid gap-2 border-t border-border pt-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">مستحق آخرین معاش</span>
                        <strong>{money(employeeMe.summary.latestPayroll.grossPay)} {baseCurrencyCode}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">باقی</span>
                        <strong>{money(employeeMe.summary.latestPayroll.remainingAmount)} {baseCurrencyCode}</strong>
                      </div>
                    </div>
                  ) : null}
                </div>

                {!token ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    QR در لینک موجود نیست. از داخل فروشگاه QR حاضری را دوباره اسکن کنید.
                  </div>
                ) : null}

                <Button className="h-12 w-full gap-2" disabled={!token || loading} onClick={submitAttendance}>
                  <Clock3 className="size-5" />
                  {loading ? "در حال ثبت..." : "ثبت حاضری من"}
                </Button>
              </div>
            )}

            {error ? (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <XCircle className="size-4" />
                {error}
              </div>
            ) : null}

            {result ? (
              <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="size-5" />
                  <strong>{result.message}</strong>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Badge className="justify-center bg-background text-foreground">
                    شروع: {formatTime(result.record?.checkInAt)}
                  </Badge>
                  <Badge className="justify-center bg-background text-foreground">
                    ختم: {formatTime(result.record?.checkOutAt)}
                  </Badge>
                  <Badge className="justify-center bg-background text-foreground">
                    کارکرد: {Math.round((result.record?.workedMinutes || 0) / 60)} ساعت
                  </Badge>
                  <Badge className="justify-center bg-background text-foreground">
                    اضافه‌کاری: {Math.round((result.record?.overtimeMinutes || 0) / 60)} ساعت
                  </Badge>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
