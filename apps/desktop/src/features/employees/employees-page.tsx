import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Eye,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDropdownItem } from "@/components/ui/confirm-action";
import { DatePicker } from "@/components/ui/date-picker";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { kabulDateString } from "@/lib/kabul-date";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, apiSend } from "@/features/employees/hr-api";
import { CompanyPrintHeader, type PrintCompany } from "@/features/printing/company-print-header";

type Role = { id: string; name: string };
type Currency = { id: string; code: string; name: string; isBase?: boolean };
type CashRegister = {
  id: string;
  name: string;
  accounts?: Array<{ id: string; balance: number; currencyId: string; currency?: Currency }>;
};
type BankAccount = {
  id: string;
  name: string;
  balance: number;
  currencyId: string;
  currency?: Currency;
};
type Employee = {
  id: string;
  code: string;
  fullName: string;
  phone?: string | null;
  position?: string | null;
  monthlySalary: number;
  allowOvertime: boolean;
  overtimeHourlyRate: number;
  overtimeMaxHours?: number | null;
  isActive: boolean;
  userId?: string | null;
  user?: { id: string; username: string; displayName: string; role?: Role | null } | null;
  shifts?: Shift[];
  createdAt?: string;
  updatedAt?: string;
  createdByUser?: { displayName: string } | null;
  updatedByUser?: { displayName: string } | null;
};
type Shift = {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  graceMinutes?: number;
  isDefault?: boolean;
};
type Period = {
  id: string;
  year: number;
  month: number;
  name: string;
  isClosed?: boolean;
  workdays: Workday[];
};
type Workday = {
  id?: string;
  date: string;
  isWorkday: boolean;
  isHalfDay: boolean;
  description?: string | null;
  note?: string | null;
};
type AttendanceRecord = {
  id: string;
  employee: Employee;
  date: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  status: string;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
};
type PayrollRun = {
  id: string;
  status: string;
  period: Period;
  totalEarned: number;
  totalPaid: number;
  totalRemaining: number;
  lines: PayrollLine[];
  payments?: PayrollPayment[];
};
type PayrollLine = {
  id: string;
  employeeId: string;
  employee: Employee;
  workingDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  overtimeHours: number;
  baseSalary: number;
  overtimeAmount: number;
  grossPay: number;
  paidAmount: number;
  remainingAmount: number;
};
type PayrollPayment = {
  id: string;
  employee: Employee;
  payrollRun?: PayrollRun | null;
  amount: number;
  paidAt: string;
  currency?: Currency;
};
type HrReport = {
  period: Period;
  summary: {
    employeeCount: number;
    workdayCount: number;
    presentDays: number;
    halfDays: number;
    absentDays: number;
    overtimeHours: number;
    lateHours: number;
  };
  rows: Array<{
    employee: Employee;
    presentDays: number;
    halfDays: number;
    absentDays: number;
    lateMinutes: number;
    overtimeMinutes: number;
    workedMinutes: number;
  }>;
};

const attendanceStatusOptions = [
  { value: "PRESENT", label: "حاضر" },
  { value: "HALF_PRESENT", label: "نیم‌حاضر" },
  { value: "ABSENT", label: "غیرحاضر" },
  { value: "LATE", label: "دیرکرد" },
  { value: "OVERTIME", label: "اضافه‌کاری" },
  { value: "MISSING_CHECKOUT", label: "ختم ثبت نشده" },
  { value: "MANUAL_ADJUSTED", label: "اصلاح دستی" },
];

const statusLabels: Record<string, string> = {
  PRESENT: "حاضر",
  HALF_PRESENT: "نیم‌حاضر",
  ABSENT: "غیرحاضر",
  LATE: "دیرکرد",
  OVERTIME: "اضافه‌کاری",
  MISSING_CHECKOUT: "ختم ثبت نشده",
  MANUAL_ADJUSTED: "اصلاح دستی",
  DRAFT: "پیشنویس",
  REVIEWED: "بررسی شده",
  PAID: "پرداخت کامل",
  CANCELLED: "باطل",
};

function localDateInput(date = new Date()) {
  return kabulDateString(date);
}

const employeeInitial = {
  code: "",
  fullName: "",
  phone: "",
  email: "",
  address: "",
  jobTitle: "",
  hireDate: localDateInput(),
  monthlySalary: "",
  overtimeEnabled: false,
  overtimeHourlyRate: "",
  overtimeMaxMinutesPerDay: "120",
  shiftName: "شیفت اصلی",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: "0",
  graceMinutes: "10",
  createUser: false,
  username: "",
  password: "",
  roleId: "",
  note: "",
};

function money(value: number | string) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", { dateStyle: "medium" }).format(new Date(value));
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function inputTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function metric(title: string, value: string, icon: ReactNode) {
  return (
    <Card className="overflow-hidden border-border bg-card">
      <CardContent className="flex min-h-24 items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <strong className="mt-2 block font-heading text-2xl tracking-normal">{value}</strong>
        </div>
        <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function useHrData() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [payments, setPayments] = useState<PayrollPayment[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [company, setCompany] = useState<PrintCompany | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [
        employeesData,
        periodsData,
        recordsData,
        runsData,
        paymentsData,
        currenciesData,
        cashData,
        bankData,
        companyData,
      ] = await Promise.all([
        apiGet<Employee[]>("/api/employees"),
        apiGet<Period[]>("/api/attendance/periods"),
        apiGet<AttendanceRecord[]>(`/api/attendance/records?date=${localDateInput()}`),
        apiGet<PayrollRun[]>("/api/payroll/runs"),
        apiGet<PayrollPayment[]>("/api/payroll/payments"),
        apiGet<Currency[]>("/api/currencies"),
        apiGet<CashRegister[]>("/api/cash-registers"),
        apiGet<BankAccount[]>("/api/bank-accounts"),
        apiGet<PrintCompany>("/api/settings/company"),
      ]);
      setEmployees(employeesData);
      setPeriods(periodsData);
      setRecords(recordsData);
      setRuns(runsData);
      setPayments(paymentsData);
      setCurrencies(currenciesData);
      setCashRegisters(cashData);
      setBankAccounts(bankData);
      setCompany(companyData);
      try {
        setRoles(await apiGet<Role[]>("/api/users/roles"));
      } catch {
        setRoles([]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خواندن اطلاعات کارمندان ناکام شد");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return {
    employees,
    roles,
    periods,
    records,
    runs,
    payments,
    currencies,
    cashRegisters,
    bankAccounts,
    company,
    loading,
    reload: load,
  };
}

export function EmployeesPage() {
  const data = useHrData();
  const baseCurrencyCode =
    data.currencies.find((currency) => currency.isBase)?.code || "AFN";
  const [employeeDialog, setEmployeeDialog] = useState<{ mode: "create" | "edit"; row?: Employee } | null>(null);
  const [details, setDetails] = useState<Employee | null>(null);
  const [employeeForm, setEmployeeForm] = useState(employeeInitial);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [workDate, setWorkDate] = useState(localDateInput());
  const [qr, setQr] = useState<{ qrDataUrl: string; url: string; expiresAt: string } | null>(null);
  const [attendanceDialog, setAttendanceDialog] = useState<{ record?: AttendanceRecord } | null>(null);
  const [attendanceForm, setAttendanceForm] = useState({
    employeeId: "",
    date: localDateInput(),
    checkInAt: "",
    checkOutAt: "",
    status: "PRESENT",
    overtimeMinutes: "",
    lateMinutes: "",
    note: "",
  });
  const [calendarDetails, setCalendarDetails] = useState<Period | null>(null);
  const [payrollDetails, setPayrollDetails] = useState<PayrollRun | null>(null);
  const [hrReport, setHrReport] = useState<HrReport | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<PayrollLine | null>(null);
  const [paymentForm, setPaymentForm] = useState({ currencyId: "", accountType: "CASH", accountId: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return data.employees;
    return data.employees.filter((employee) =>
      [employee.code, employee.fullName, employee.phone, employee.position, employee.user?.username]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [data.employees, employeeSearch]);

  const activeEmployees = data.employees.filter((employee) => employee.isActive).length;
  const todayPresent = data.records.filter((record) => record.checkInAt).length;
  const payrollRemaining = data.runs.reduce((sum, run) => sum + Number(run.totalRemaining || 0), 0);
  const periodOptions = data.periods.map((period) => ({
    value: period.id,
    label: period.name,
    meta: `${period.year}/${period.month}`,
  }));
  const roleOptions = data.roles.map((role) => ({ value: role.id, label: role.name }));
  const employeeOptions = data.employees.map((employee) => ({
    value: employee.id,
    label: employee.fullName,
    description: employee.code || employee.phone || "",
  }));

  useEffect(() => {
    if (!calendarDetails?.id) return;

    const refreshed = data.periods.find(
      (period) => period.id === calendarDetails.id,
    );

    if (refreshed && refreshed !== calendarDetails) {
      setCalendarDetails(refreshed);
    }
  }, [data.periods, calendarDetails?.id]);

  const currencyOptions = data.currencies.map((currency) => ({
    value: currency.id,
    label: `${currency.code} - ${currency.name}`,
  }));
  const accountOptions = useMemo(() => {
    if (paymentForm.accountType === "BANK") {
      return data.bankAccounts.map((account) => ({
        value: account.id,
        label: account.name,
        description: account.currency?.code,
        meta: money(account.balance),
      }));
    }

    return data.cashRegisters.flatMap((register) =>
      (register.accounts || []).map((account) => ({
        value: account.id,
        label: `${register.name} - ${account.currency?.code || ""}`,
        description: account.currency?.name,
        meta: money(account.balance),
      })),
    );
  }, [data.bankAccounts, data.cashRegisters, paymentForm.accountType]);

  function openCreateEmployee() {
    setEmployeeForm(employeeInitial);
    setEmployeeDialog({ mode: "create" });
  }

  function openEditEmployee(row: Employee) {
    const shift = row.shifts?.find((item) => item.isDefault) || row.shifts?.[0];
    setEmployeeForm({
      ...employeeInitial,
      code: row.code || "",
      fullName: row.fullName || "",
      phone: row.phone || "",
      jobTitle: row.position || "",
      monthlySalary: String(row.monthlySalary || ""),
      overtimeEnabled: row.allowOvertime,
      overtimeHourlyRate: String(row.overtimeHourlyRate || ""),
      overtimeMaxMinutesPerDay: String((Number(row.overtimeMaxHours || 0) || 2) * 60),
      shiftName: shift?.name || "شیفت اصلی",
      startTime: shift?.startTime || "08:00",
      endTime: shift?.endTime || "16:00",
      breakMinutes: String(shift?.breakMinutes || 0),
      graceMinutes: String(shift?.graceMinutes || 10),
      createUser: Boolean(row.userId),
      username: row.user?.username || "",
      roleId: row.user?.role?.id || "",
    });
    setEmployeeDialog({ mode: "edit", row });
  }

  async function saveEmployee() {
    setBusy(true);
    try {
      const payload = {
        code: employeeForm.code,
        fullName: employeeForm.fullName,
        phone: employeeForm.phone || null,
        address: employeeForm.address || null,
        position: employeeForm.jobTitle || null,
        hireDate: employeeForm.hireDate || null,
        monthlySalary: Number(employeeForm.monthlySalary || 0),
        allowOvertime: employeeForm.overtimeEnabled,
        overtimeHourlyRate: Number(employeeForm.overtimeHourlyRate || 0),
        overtimeMaxHours: Number(employeeForm.overtimeMaxMinutesPerDay || 0) / 60,
        note: employeeForm.note || null,
        shiftStart: employeeForm.startTime,
        shiftEnd: employeeForm.endTime,
        createUser: employeeForm.createUser,
        username: employeeForm.createUser ? employeeForm.username : undefined,
        password: employeeForm.createUser && employeeDialog?.mode === "create" ? employeeForm.password : undefined,
        roleId: employeeForm.createUser ? employeeForm.roleId || null : undefined,
      };

      if (employeeDialog?.mode === "edit" && employeeDialog.row) {
        await apiSend(`/api/employees/${employeeDialog.row.id}`, "PATCH", payload);
        toast.success("کارمند ویرایش شد");
      } else {
        await apiSend("/api/employees", "POST", payload);
        toast.success("کارمند ثبت شد");
      }
      setEmployeeDialog(null);
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ثبت کارمند ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEmployee(row: Employee) {
    if (!confirm(`کارمند «${row.fullName}» حذف نرم شود؟`)) return;
    try {
      await apiSend(`/api/employees/${row.id}`, "DELETE");
      toast.success("کارمند حذف نرم شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حذف انجام نشد");
    }
  }

  async function createPeriod() {
    setBusy(true);
    try {
      const date = new Date(workDate);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const days = new Date(year, month, 0).getDate();
      const workdays = Array.from({ length: days }, (_, index) => {
        const day = new Date(year, month - 1, index + 1);
        const iso = localDateInput(day);
        const isFriday = day.getDay() === 5;
        return {
          date: iso,
          isWorkday: !isFriday,
          isHalfDay: false,
          note: isFriday ? "رخصتی جمعه" : null,
        };
      });

      await apiSend("/api/attendance/periods", "POST", {
        year,
        month,
        name: `حاضری ${year}/${month}`,
        workdays,
      });
      toast.success("تقویم کاری ساخته شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ساخت تقویم کاری ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function generateQr() {
    setBusy(true);
    try {
      const result = await apiSend<{ qrDataUrl: string; url: string; expiresAt: string }>(
        "/api/attendance/qr-token",
        "POST",
        {},
      );
      setQr(result);
      toast.success("QR جدید ساخته شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ساخت QR ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  function openAttendance(record?: AttendanceRecord) {
    setAttendanceForm({
      employeeId: record?.employee?.id || "",
      date: record?.date ? localDateInput(new Date(record.date)) : localDateInput(),
      checkInAt: inputTime(record?.checkInAt),
      checkOutAt: inputTime(record?.checkOutAt),
      status: record?.status || "PRESENT",
      overtimeMinutes: String(record?.overtimeMinutes || ""),
      lateMinutes: String(record?.lateMinutes || ""),
      note: "",
    });
    setAttendanceDialog(record ? { record } : {});
  }

  async function saveAttendance() {
    if (!attendanceForm.employeeId) {
      toast.error("کارمند را انتخاب کنید");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        employeeId: attendanceForm.employeeId,
        date: attendanceForm.date,
        checkInAt: attendanceForm.checkInAt || null,
        checkOutAt: attendanceForm.checkOutAt || null,
        status: attendanceForm.status,
        overtimeMinutes: Number(attendanceForm.overtimeMinutes || 0),
        lateMinutes: Number(attendanceForm.lateMinutes || 0),
        note: attendanceForm.note || null,
      };
      if (attendanceDialog?.record) {
        await apiSend(`/api/attendance/records/${attendanceDialog.record.id}`, "PATCH", payload);
        toast.success("حاضری اصلاح شد");
      } else {
        await apiSend("/api/attendance/records", "POST", payload);
        toast.success("حاضری دستی ثبت شد");
      }
      setAttendanceDialog(null);
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ثبت حاضری ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function updateWorkday(day: Workday, patch: Partial<Workday>) {
    if (!day.id) return;
    setBusy(true);
    try {
      const nextDay: Workday = {
        ...day,
        isWorkday: patch.isWorkday ?? day.isWorkday,
        isHalfDay: patch.isHalfDay ?? day.isHalfDay,
        description: patch.description ?? day.description ?? day.note ?? null,
      };

      await apiSend(`/api/attendance/workdays/${day.id}`, "PATCH", {
        isWorkday: nextDay.isWorkday,
        isHalfDay: nextDay.isHalfDay,
        description: nextDay.description,
      });
      setCalendarDetails((current) =>
        current
          ? {
              ...current,
              workdays: current.workdays.map((item) =>
                item.id === day.id ? nextDay : item,
              ),
            }
          : current,
      );
      toast.success("روز کاری ویرایش شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ویرایش روز کاری ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function closePeriod(period: Period, isClosed: boolean) {
    setBusy(true);
    try {
      await apiSend(`/api/attendance/periods/${period.id}/close`, "PATCH", { isClosed });
      toast.success(isClosed ? "دوره حاضری بسته شد" : "دوره حاضری دوباره باز شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تغییر وضعیت دوره ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function calculatePayroll(periodId = selectedPeriodId) {
    if (!periodId) {
      toast.error("اول یک دوره حاضری را انتخاب کنید");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/payroll/runs", "POST", { periodId });
      toast.success("محاسبه معاش با آخرین حاضری‌ها به‌روزرسانی شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "محاسبه معاش ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function updatePayrollStatus(run: PayrollRun, status: "DRAFT" | "REVIEWED" | "PAID" | "CANCELLED") {
    setBusy(true);
    try {
      await apiSend(`/api/payroll/runs/${run.id}/status`, "PATCH", { status });
      toast.success("وضعیت معاش تغییر کرد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تغییر وضعیت معاش ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function loadHrReport() {
    if (!selectedPeriodId) {
      toast.error("اول یک دوره حاضری را انتخاب کنید");
      return;
    }
    setBusy(true);
    try {
      setHrReport(await apiGet<HrReport>(`/api/attendance/reports/monthly?periodId=${selectedPeriodId}`));
      toast.success("گزارش حاضری آماده شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "گزارش حاضری خوانده نشد");
    } finally {
      setBusy(false);
    }
  }

  function openPayment(line: PayrollLine) {
    const baseCurrency = data.currencies.find((currency) => currency.isBase) || data.currencies[0];
    setPaymentDialog(line);
    setPaymentForm({
      currencyId: baseCurrency?.id || "",
      accountType: "CASH",
      accountId: "",
      amount: String(line.remainingAmount || ""),
      note: "",
    });
  }

  async function savePayment() {
    if (!paymentDialog) return;
    setBusy(true);
    try {
      await apiSend("/api/payroll/payments", "POST", {
        employeeId: paymentDialog.employeeId,
        payrollRunId: data.runs.find((run) => run.lines.some((line) => line.id === paymentDialog.id))?.id,
        payrollLineId: paymentDialog.id,
        currencyId: paymentForm.currencyId,
        accountType: paymentForm.accountType,
        accountId: paymentForm.accountId,
        amount: Number(paymentForm.amount || 0),
        note: paymentForm.note || null,
      });
      toast.success("پرداخت معاش ثبت شد و سند مالی ساخته شد");
      setPaymentDialog(null);
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "پرداخت معاش ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPayment(payment: PayrollPayment) {
    if (!confirm(`پرداخت معاش ${payment.employee.fullName} باطل شود؟`)) return;
    setBusy(true);
    try {
      await apiSend(`/api/payroll/payments/${payment.id}`, "DELETE");
      toast.success("پرداخت معاش با سند معکوس باطل شد");
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ابطال پرداخت معاش ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  function printPayroll(run?: PayrollRun | null) {
    if (run) setPayrollDetails(run);
    window.setTimeout(() => window.print(), 100);
  }

  return (
    <div className="app-print-page space-y-6">
      <CompanyPrintHeader company={data.company} title="گزارش کارمندان و معاشات" />
      <div className="grid gap-3 md:grid-cols-4">
        {metric("کارمندان فعال", String(activeEmployees), <UserRound className="size-6" />)}
        {metric("حاضری امروز", String(todayPresent), <CheckCircle2 className="size-6" />)}
        {metric("باقی معاشات", `${money(payrollRemaining)} ${baseCurrencyCode}`, <WalletCards className="size-6" />)}
        {metric("دوره‌های کاری", String(data.periods.length), <CalendarDays className="size-6" />)}
      </div>

      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="employees">کارمندان</TabsTrigger>
          <TabsTrigger value="attendance">حاضری QR</TabsTrigger>
          <TabsTrigger value="calendar">تقویم کاری</TabsTrigger>
          <TabsTrigger value="payroll">معاشات</TabsTrigger>
          <TabsTrigger value="reports">گزارش HR</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>کارمندان</CardTitle>
                <CardDescription>ثبت، ویرایش، حذف نرم و اتصال اختیاری به User/Role سیستم.</CardDescription>
              </div>
              <Button onClick={openCreateEmployee} className="gap-2">
                <Plus className="size-4" />
                کارمند جدید
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} className="ps-9" placeholder="جستجوی کارمند..." />
              </div>
              <DataTable
                loading={data.loading}
                columns={["کد", "نام", "وظیفه", "معاش", "شیفت", "وضعیت", "حساب سیستم", "عملیات"]}
                empty="کارمندی ثبت نشده است"
                rows={filteredEmployees.map((employee) => {
                  const shift = employee.shifts?.find((item) => item.isDefault) || employee.shifts?.[0];
                  return [
                    employee.code,
                    employee.fullName,
                    employee.position || "-",
                    `${money(employee.monthlySalary)} ${baseCurrencyCode}`,
                    shift ? `${shift.startTime} - ${shift.endTime}` : "-",
                    <Badge key="status" className={employee.isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}>
                      {employee.isActive ? "فعال" : "غیرفعال"}
                    </Badge>,
                    employee.user ? employee.user.username : "-",
                    <RowActions key="actions" onDetails={() => setDetails(employee)} onEdit={() => openEditEmployee(employee)} onDelete={() => deleteEmployee(employee)} />,
                  ];
                })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>QR حاضری امروز</CardTitle>
              <CardDescription>
                QR موقتی است؛ کارمند در اپ موبایل POS لاگین می‌کند و از بخش حاضری همین QR را اسکن می‌کند.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={generateQr} disabled={busy} className="w-full gap-2">
                <QrCode className="size-4" />
                ساخت QR جدید
              </Button>
              {qr ? (
                <div className="space-y-3 rounded-2xl border border-border bg-background p-4 text-center">
                  <img src={qr.qrDataUrl} alt="Attendance QR" className="mx-auto size-56 rounded-xl bg-white p-2" />
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-right text-xs leading-6 text-muted-foreground">
                    <p>۱. کارمند اپ موبایل POS را باز کند.</p>
                    <p>۲. وارد بخش «حاضری» شود و با یوزر خودش لاگین کند.</p>
                    <p>۳. همین QR را اسکن کند تا شروع یا ختم کار ثبت شود.</p>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{qr.url}</p>
                  <Badge className="bg-primary/15 text-primary">اعتبار تا {formatTime(qr.expiresAt)}</Badge>
                </div>
              ) : (
                <div className="grid h-72 place-items-center rounded-2xl border border-dashed border-border text-center text-sm text-muted-foreground">
                  QR هنوز ساخته نشده است
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>حاضری امروز</CardTitle>
                <CardDescription>شروع، ختم، دیرکرد و اضافه‌کاری کارمندان.</CardDescription>
              </div>
              <Button onClick={() => openAttendance()} className="gap-2">
                <Plus className="size-4" />
                ثبت/اصلاح دستی
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={data.loading}
                columns={["کارمند", "شروع", "ختم", "وضعیت", "کارکرد", "اضافه‌کاری", "عملیات"]}
                empty="برای امروز حاضری ثبت نشده است"
                rows={data.records.map((record) => [
                  record.employee.fullName,
                  formatTime(record.checkInAt),
                  formatTime(record.checkOutAt),
                  <Badge key="status" className="bg-primary/15 text-primary">{statusLabels[record.status] || record.status}</Badge>,
                  `${Math.round((record.workedMinutes || 0) / 60)} ساعت`,
                  `${Math.round((record.overtimeMinutes || 0) / 60)} ساعت`,
                  <Button key="edit" size="sm" variant="outline" onClick={() => openAttendance(record)}>ویرایش</Button>,
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>تقویم کاری ماه</CardTitle>
                <CardDescription>برای هر ماه روزهای کاری ساخته می‌شود؛ جمعه‌ها پیش‌فرض رخصتی است.</CardDescription>
              </div>
              <div className="flex min-w-80 items-center gap-2">
                <DatePicker value={workDate} onChange={setWorkDate} />
                <Button onClick={createPeriod} disabled={busy}>ساخت ماه</Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={data.loading}
                columns={["نام دوره", "سال", "ماه", "وضعیت", "روز کاری", "نیم‌روزی", "روز رخصتی", "عملیات"]}
                empty="دوره کاری ساخته نشده است"
                rows={data.periods.map((period) => [
                  period.name,
                  period.year,
                  period.month,
                  <Badge key="closed" className={period.isClosed ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}>
                    {period.isClosed ? "بسته" : "باز"}
                  </Badge>,
                  period.workdays.filter((day) => day.isWorkday).length,
                  period.workdays.filter((day) => day.isHalfDay).length,
                  period.workdays.filter((day) => !day.isWorkday).length,
                  <div key="actions" className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setCalendarDetails(period)}>روزها</Button>
                    <Button size="sm" variant="outline" onClick={() => closePeriod(period, !period.isClosed)}>
                      {period.isClosed ? "بازکردن" : "بستن"}
                    </Button>
                  </div>,
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>محاسبه معاش</CardTitle>
                <CardDescription>معاش ماه باز موقت است و با ثبت حاضری‌های جدید دوباره محاسبه می‌شود؛ پرداخت‌های قبلی از بین نمی‌روند.</CardDescription>
              </div>
              <div className="flex min-w-[420px] items-center gap-2">
                <Combobox options={periodOptions} value={selectedPeriodId} onValueChange={setSelectedPeriodId} placeholder="دوره حاضری" />
                <Button onClick={() => calculatePayroll()} disabled={busy}>محاسبه / به‌روزرسانی</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {data.runs.map((run) => (
                <div key={run.id} className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-lg font-semibold">{run.period?.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        مجموع: {money(run.totalEarned)} {baseCurrencyCode}، پرداخت: {money(run.totalPaid)} {baseCurrencyCode}، باقی: {money(run.totalRemaining)} {baseCurrencyCode}
                      </p>
                    </div>
                    <Badge className={run.status === "PAID" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}>
                      {statusLabels[run.status] || run.status}
                    </Badge>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => calculatePayroll(run.period.id)} disabled={busy} className="gap-2">
                        <RefreshCw className="size-4" />
                        تازه‌سازی
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPayrollDetails(run)}>جزئیات</Button>
                      <Button size="sm" variant="outline" onClick={() => printPayroll(run)}>چاپ</Button>
                      {run.status === "DRAFT" ? (
                        <Button size="sm" variant="outline" onClick={() => updatePayrollStatus(run, "REVIEWED")}>قفل/بررسی</Button>
                      ) : null}
                      {run.status !== "PAID" ? (
                        <Button size="sm" variant="destructive" onClick={() => updatePayrollStatus(run, "CANCELLED")}>ابطال</Button>
                      ) : null}
                    </div>
                  </div>
                  {!run.period?.isClosed ? (
                    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      این دوره هنوز باز است؛ مبلغ مستحق فعلی تا امروز محاسبه شده و با حاضری روزهای بعد افزایش می‌یابد.
                    </div>
                  ) : null}
                  <DataTable
                    columns={["کارمند", "حاضر", "نیم‌حاضر", "غیرحاضر", "اضافه‌کاری", "مستحق", "پرداخت", "باقی", "عملیات"]}
                    empty="جزئیات معاش وجود ندارد"
                    rows={run.lines.map((line) => [
                      line.employee.fullName,
                      line.presentDays,
                      line.halfDays,
                      line.absentDays,
                      `${line.overtimeHours} ساعت`,
                      `${money(line.grossPay)} ${baseCurrencyCode}`,
                      `${money(line.paidAmount)} ${baseCurrencyCode}`,
                      `${money(line.remainingAmount)} ${baseCurrencyCode}`,
                      line.remainingAmount > 0 ? (
                        <Button key="pay" size="sm" onClick={() => openPayment(line)} className="gap-2">
                          <Banknote className="size-4" />
                          پرداخت
                        </Button>
                      ) : (
                        <Badge key="paid" className="bg-primary/15 text-primary">کامل</Badge>
                      ),
                    ])}
                  />
                </div>
              ))}
              {data.runs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  هنوز PayrollRun ساخته نشده است.
                </div>
              ) : null}
              <div className="rounded-2xl border border-border bg-background/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-heading text-lg font-semibold">پرداخت‌های معاش</h3>
                    <p className="text-sm text-muted-foreground">لیست پرداخت‌های ثبت‌شده با امکان ابطال سند.</p>
                  </div>
                </div>
                <DataTable
                  columns={["کارمند", "دوره", "مبلغ", "تاریخ", "عملیات"]}
                  empty="پرداخت معاش ثبت نشده است"
                  rows={data.payments.map((payment) => [
                    payment.employee.fullName,
                    payment.payrollRun?.period?.name || "-",
                    `${money(payment.amount)} ${payment.currency?.code || ""}`,
                    formatDate(payment.paidAt),
                    <Button key="cancel" size="sm" variant="destructive" onClick={() => cancelPayment(payment)}>
                      ابطال
                    </Button>,
                  ])}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>گزارش ماهانه کارمندان</CardTitle>
                <CardDescription>حاضری، غیبت، دیرکرد و اضافه‌کاری هر کارمند در دوره انتخاب‌شده.</CardDescription>
              </div>
              <div className="flex min-w-[420px] items-center gap-2">
                <Combobox options={periodOptions} value={selectedPeriodId} onValueChange={setSelectedPeriodId} placeholder="دوره حاضری" />
                <Button onClick={loadHrReport} disabled={busy}>خواندن گزارش</Button>
                <Button variant="outline" onClick={() => window.print()} disabled={!hrReport}>چاپ</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {hrReport ? (
                <>
                  <div className="grid gap-3 md:grid-cols-6">
                    {metric("کارمندان", String(hrReport.summary.employeeCount), <UserRound className="size-6" />)}
                    {metric("روز کاری", String(hrReport.summary.workdayCount), <CalendarDays className="size-6" />)}
                    {metric("حاضر", String(hrReport.summary.presentDays), <CheckCircle2 className="size-6" />)}
                    {metric("نیم‌حاضر", String(hrReport.summary.halfDays), <CalendarDays className="size-6" />)}
                    {metric("غیرحاضر", String(hrReport.summary.absentDays), <Trash2 className="size-6" />)}
                    {metric("اضافه‌کاری", `${hrReport.summary.overtimeHours} ساعت`, <WalletCards className="size-6" />)}
                  </div>
                  <DataTable
                    columns={["کارمند", "حاضر", "نیم‌حاضر", "غیرحاضر", "دیرکرد", "اضافه‌کاری", "کارکرد"]}
                    empty="گزارشی برای نمایش وجود ندارد"
                    rows={hrReport.rows.map((row) => [
                      row.employee.fullName,
                      row.presentDays,
                      row.halfDays,
                      row.absentDays,
                      `${Math.round(row.lateMinutes / 60)} ساعت`,
                      `${Math.round(row.overtimeMinutes / 60)} ساعت`,
                      `${Math.round(row.workedMinutes / 60)} ساعت`,
                    ])}
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  یک دوره حاضری را انتخاب کنید و گزارش را بخوانید.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EmployeeDialog
        open={Boolean(employeeDialog)}
        mode={employeeDialog?.mode || "create"}
        form={employeeForm}
        roles={roleOptions}
        busy={busy}
        onChange={(key, value) => setEmployeeForm((current) => ({ ...current, [key]: value }))}
        onClose={() => setEmployeeDialog(null)}
        onSave={saveEmployee}
      />

      <DetailsDialog employee={details} onClose={() => setDetails(null)} />

      <Dialog open={Boolean(attendanceDialog)} onOpenChange={(open) => !open && setAttendanceDialog(null)}>
        <DialogContent dir="rtl" className="max-w-[min(96vw,820px)]">
          <DialogHeader>
            <DialogTitle>ثبت/اصلاح دستی حاضری</DialogTitle>
            <DialogDescription>
              برای روزهایی که QR ثبت نشده یا نیاز به اصلاح مدیریتی دارد، حاضری را دستی تنظیم کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">کارمند</span>
              <Combobox
                options={employeeOptions}
                value={attendanceForm.employeeId}
                onValueChange={(value) => setAttendanceForm((current) => ({ ...current, employeeId: value }))}
                placeholder="انتخاب کارمند"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">تاریخ</span>
              <ManualDateInput
                value={attendanceForm.date}
                onChange={(value) => setAttendanceForm((current) => ({ ...current, date: value }))}
              />
            </label>
            <Field label="41H9" value={attendanceForm.checkInAt} type="time" onChange={(value) => setAttendanceForm((current) => ({ ...current, checkInAt: value }))} />
            <Field label=".*E" value={attendanceForm.checkOutAt} type="time" onChange={(value) => setAttendanceForm((current) => ({ ...current, checkOutAt: value }))} />
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">وضعیت</span>
              <Combobox
                options={attendanceStatusOptions}
                value={attendanceForm.status}
                onValueChange={(value) => setAttendanceForm((current) => ({ ...current, status: value }))}
                placeholder="وضعیت حاضری"
              />
            </label>
            <Field label="اضافه‌کاری به دقیقه" value={attendanceForm.overtimeMinutes} type="number" onChange={(value) => setAttendanceForm((current) => ({ ...current, overtimeMinutes: value }))} />
            <Field label="دیرکرد به دقیقه" value={attendanceForm.lateMinutes} type="number" onChange={(value) => setAttendanceForm((current) => ({ ...current, lateMinutes: value }))} />
            <Field label="یادداشت" value={attendanceForm.note} textarea full onChange={(value) => setAttendanceForm((current) => ({ ...current, note: value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttendanceDialog(null)}>لغو</Button>
            <Button onClick={saveAttendance} disabled={busy}>ذخیره حاضری</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(calendarDetails)} onOpenChange={(open) => !open && setCalendarDetails(null)}>
        <DialogContent dir="rtl" className="max-w-[min(96vw,980px)]">
          <DialogHeader>
            <DialogTitle>روزهای کاری {calendarDetails?.name}</DialogTitle>
            <DialogDescription>
              روزهای کاری، رخصتی و نیم‌روزی همین دوره را مدیریت کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>یادداشت</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(calendarDetails?.workdays || []).map((day) => (
                  <TableRow key={day.id || day.date}>
                    <TableCell>{formatDate(day.date)}</TableCell>
                    <TableCell>
                      <Badge className={day.isWorkday ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}>
                        {day.isWorkday ? (day.isHalfDay ? "نیم‌روزی" : "کاری") : "رخصتی"}
                      </Badge>
                    </TableCell>
                    <TableCell>{day.description || day.note || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => updateWorkday(day, { isWorkday: !day.isWorkday, isHalfDay: false })}>
                          {day.isWorkday ? "رخصتی" : "کاری"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={!day.isWorkday} onClick={() => updateWorkday(day, { isHalfDay: !day.isHalfDay })}>
                          نیم‌روزی
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCalendarDetails(null)}>بستن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payrollDetails)} onOpenChange={(open) => !open && setPayrollDetails(null)}>
        <DialogContent dir="rtl" className="max-w-[min(96vw,1100px)] print:max-w-none print:border-0 print:shadow-none">
          <DialogHeader>
            <DialogTitle>جزئیات معاش {payrollDetails?.period?.name}</DialogTitle>
            <DialogDescription>
              خلاصه مستحق، پرداخت‌شده، باقیات و جزئیات هر کارمند.
            </DialogDescription>
          </DialogHeader>
          {payrollDetails ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Info label="مجموع مستحق" value={`${money(payrollDetails.totalEarned)} ${baseCurrencyCode}`} />
                <Info label="پرداخت‌شده" value={`${money(payrollDetails.totalPaid)} ${baseCurrencyCode}`} />
                <Info label="باقیات" value={`${money(payrollDetails.totalRemaining)} ${baseCurrencyCode}`} />
              </div>
              <div className="max-h-[55vh] overflow-y-auto print:max-h-none print:overflow-visible">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>کارمند</TableHead>
                      <TableHead>حاضر</TableHead>
                      <TableHead>نیم‌حاضر</TableHead>
                      <TableHead>غیرحاضر</TableHead>
                      <TableHead>اضافه‌کاری</TableHead>
                      <TableHead>مستحق</TableHead>
                      <TableHead>پرداخت</TableHead>
                      <TableHead>باقی</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollDetails.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.employee.fullName}</TableCell>
                        <TableCell>{line.presentDays}</TableCell>
                        <TableCell>{line.halfDays}</TableCell>
                        <TableCell>{line.absentDays}</TableCell>
                        <TableCell>{line.overtimeHours}</TableCell>
                        <TableCell>{money(line.grossPay)}</TableCell>
                        <TableCell>{money(line.paidAmount)}</TableCell>
                        <TableCell>{money(line.remainingAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setPayrollDetails(null)}>بستن</Button>
            <Button onClick={() => window.print()}>چاپ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentDialog)} onOpenChange={(open) => !open && setPaymentDialog(null)}>
        <DialogContent dir="rtl" className="max-w-[min(96vw,760px)]">
          <DialogHeader>
            <DialogTitle>پرداخت معاش</DialogTitle>
            <DialogDescription>
              پرداخت از صندوق یا بانک ثبت می‌شود و سند مالی متوازن به صورت خودکار ساخته می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Combobox options={currencyOptions} value={paymentForm.currencyId} onValueChange={(value) => setPaymentForm((current) => ({ ...current, currencyId: value }))} placeholder="کرنسی" />
            <Combobox
              options={[
                { value: "CASH", label: "صندوق نقد" },
                { value: "BANK", label: "حساب بانکی" },
              ]}
              value={paymentForm.accountType}
              onValueChange={(value) => setPaymentForm((current) => ({ ...current, accountType: value, accountId: "" }))}
              placeholder="نوع حساب"
            />
            <Combobox options={accountOptions} value={paymentForm.accountId} onValueChange={(value) => setPaymentForm((current) => ({ ...current, accountId: value }))} placeholder="حساب پرداخت" />
            <Input value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} type="number" placeholder="مبلغ" />
            <textarea
              value={paymentForm.note}
              onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))}
              rows={4}
              className="md:col-span-full min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              placeholder="یادداشت"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>لغو</Button>
            <Button onClick={savePayment} disabled={busy}>ثبت پرداخت</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeDialog({
  open,
  mode,
  form,
  roles,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: typeof employeeInitial;
  roles: Array<{ value: string; label: string }>;
  busy: boolean;
  onChange: (key: keyof typeof employeeInitial, value: any) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent dir="rtl" className="max-w-[min(96vw,1120px)]">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "ویرایش کارمند" : "ثبت کارمند جدید"}</DialogTitle>
          <DialogDescription>
            اطلاعات کارمند، شیفت، معاش و در صورت نیاز حساب ورود سیستم را ثبت کنید.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pe-1">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="کد کارمند" value={form.code} onChange={(value) => onChange("code", value)} />
            <Field label="نام کامل" value={form.fullName} onChange={(value) => onChange("fullName", value)} />
            <Field label="شماره موبایل" value={form.phone} onChange={(value) => onChange("phone", value)} />
            <Field label="ایمیل" value={form.email} onChange={(value) => onChange("email", value)} />
            <Field label="وظیفه" value={form.jobTitle} onChange={(value) => onChange("jobTitle", value)} />
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">تاریخ استخدام</span>
              <ManualDateInput value={form.hireDate} onChange={(value) => onChange("hireDate", value)} />
            </label>
            <Field label="آدرس" value={form.address} onChange={(value) => onChange("address", value)} full />
          </div>

          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <h3 className="mb-3 font-semibold">شیفت و معاش</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="معاش ماهانه" value={form.monthlySalary} type="number" onChange={(value) => onChange("monthlySalary", value)} />
              <Field label="نام شیفت" value={form.shiftName} onChange={(value) => onChange("shiftName", value)} />
              <Field label="شروع شیفت" value={form.startTime} type="time" onChange={(value) => onChange("startTime", value)} />
              <Field label="ختم شیفت" value={form.endTime} type="time" onChange={(value) => onChange("endTime", value)} />
              <Field label="وقفه به دقیقه" value={form.breakMinutes} type="number" onChange={(value) => onChange("breakMinutes", value)} />
              <Field label="مهلت دیرکرد به دقیقه" value={form.graceMinutes} type="number" onChange={(value) => onChange("graceMinutes", value)} />
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                <input type="checkbox" checked={form.overtimeEnabled} onChange={(event) => onChange("overtimeEnabled", event.target.checked)} />
                اضافه‌کاری فعال است
              </label>
              <Field label="نرخ اضافه‌کاری فی ساعت" value={form.overtimeHourlyRate} type="number" onChange={(value) => onChange("overtimeHourlyRate", value)} />
              <Field label="سقف اضافه‌کاری روزانه به دقیقه" value={form.overtimeMaxMinutesPerDay} type="number" onChange={(value) => onChange("overtimeMaxMinutesPerDay", value)} />
              <Field label="یادداشت" value={form.note} onChange={(value) => onChange("note", value)} textarea full />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.createUser} onChange={(event) => onChange("createUser", event.target.checked)} />
              این کارمند حساب ورود به سیستم دارد
            </label>
            {form.createUser ? (
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="نام کاربری" value={form.username} onChange={(value) => onChange("username", value)} />
                {mode === "create" ? (
                  <Field label="رمز اولیه" value={form.password} type="password" onChange={(value) => onChange("password", value)} />
                ) : null}
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">نقش کاربری</span>
                  <Combobox options={roles} value={form.roleId} onValueChange={(value) => onChange("roleId", value)} placeholder="انتخاب صلاحیت" />
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>لغو</Button>
          <Button onClick={onSave} disabled={busy}>{mode === "edit" ? "ذخیره تغییرات" : "ثبت کارمند"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea = false,
  full = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  textarea?: boolean;
  full?: boolean;
}) {
  return (
    <label className={`grid gap-1.5 text-sm ${full || textarea ? "md:col-span-full" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      ) : (
        <Input value={value} type={type} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function DataTable({
  columns,
  rows,
  empty,
  loading = false,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
  loading?: boolean;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => setPage(1), [rows.length]);

  return (
    <div className="space-y-3">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                در حال خواندن...
              </TableCell>
            </TableRow>
          ) : pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex}>{cell}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          نمایش {rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} تا {Math.min(safePage * pageSize, rows.length)} از {rows.length}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            قبلی
          </Button>
          <span>{safePage} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
            بعدی
          </Button>
        </div>
      </div>
    </div>
  );
}

function RowActions({
  onDetails,
  onEdit,
  onDelete,
}: {
  onDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" title="عملیات">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44" dir="rtl">
        <DropdownMenuLabel>عملیات</DropdownMenuLabel>
        <DropdownMenuItem onClick={onDetails}>
          <Eye className="size-4" />
          <span>جزئیات</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Settings className="size-4" />
          <span>ویرایش</span>
        </DropdownMenuItem>
        <ConfirmDropdownItem
          title="تایید حذف کارمند"
          description="آیا مطمئن هستید که این کارمند حذف شود؟"
          confirmLabel="حذف"
          onConfirm={onDelete}
        >
          <Trash2 className="size-4" />
          <span>حذف</span>
        </ConfirmDropdownItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailsDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const shift = employee?.shifts?.find((item) => item.isDefault) || employee?.shifts?.[0];

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-w-[min(96vw,900px)]">
        <DialogHeader>
          <DialogTitle>جزئیات کارمند</DialogTitle>
          <DialogDescription>اطلاعات ثبت، ویرایش، حساب سیستم، شیفت و معاش کارمند.</DialogDescription>
        </DialogHeader>
        {employee ? (
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto md:grid-cols-2">
            <Info label="کد" value={employee.code} />
            <Info label="نام" value={employee.fullName} />
            <Info label="موبایل" value={employee.phone || "-"} />
            <Info label="وظیفه" value={employee.position || "-"} />
            <Info label="معاش ماهانه" value={`${money(employee.monthlySalary)} ${baseCurrencyCode}`} />
            <Info label="شیفت" value={shift ? `${shift.startTime} - ${shift.endTime}` : "-"} />
            <Info label="اضافه‌کاری" value={employee.allowOvertime ? "فعال" : "غیرفعال"} />
            <Info label="حساب سیستم" value={employee.user ? `${employee.user.username} (${employee.user.role?.name || "-"})` : "ندارد"} />
            <Info label="ثبت‌کننده" value={employee.createdByUser?.displayName || "-"} />
            <Info label="زمان ثبت" value={formatDate(employee.createdAt)} />
            <Info label="ویرایش‌کننده" value={employee.updatedByUser?.displayName || "-"} />
            <Info label="زمان ویرایش" value={formatDate(employee.updatedAt)} />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>بستن</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}
