import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDropdownItem } from "@/components/ui/confirm-action";
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

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Role = {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  isActive: boolean;
  permissions: string[];
};

type Permission = {
  id: string;
  key: string;
  description?: string | null;
};

type User = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  roleId?: string | null;
  role?: Role | null;
  lastLoginAt?: string | null;
};

type MobileDevice = {
  id: string;
  code?: string | null;
  name: string;
  type: string;
  isActive: boolean;
  lastSeenAt?: string | null;
  credentialIssuedAt?: string | null;
  credentialRevokedAt?: string | null;
  user?: {
    id: string;
    username: string;
    displayName: string;
  } | null;
};

type UserForm = {
  id?: string;
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  isActive: boolean;
};

type RoleForm = {
  id?: string;
  name: string;
  description: string;
  isActive: boolean;
  permissions: string[];
};

const emptyUserForm: UserForm = {
  username: "",
  displayName: "",
  password: "",
  roleId: "",
  isActive: true,
};

const emptyRoleForm: RoleForm = {
  name: "",
  description: "",
  isActive: true,
  permissions: [],
};

function permissionLabel(key: string) {
  const labels: Record<string, string> = {
    "alerts.view": "دیدن هشدارها",
    "dashboard.view": "دیدن داشبورد",
    "pos.sell": "فروش در POS",
    "sales.view": "دیدن فروشات",
    "sales.manage": "مدیریت فروشات",
    "purchases.view": "دیدن خریداری",
    "purchases.manage": "مدیریت خریداری",
    "inventory.view": "دیدن موجودی",
    "inventory.manage": "مدیریت موجودی",
    "products.manage": "مدیریت اجناس",
    "parties.manage": "مدیریت مشتری/فروشنده",
    "cashbank.manage": "صندوق و بانک",
    "accounting.view": "دیدن حسابداری",
    "accounting.manage": "مدیریت حسابداری",
    "reports.view": "دیدن گزارشات",
    "users.manage": "کاربران و صلاحیت‌ها",
    "settings.manage": "تنظیمات",
    "backup.manage": "بکاپ و بازگردانی",
    "employees.view": "دیدن کارمندان",
    "employees.manage": "مدیریت کارمندان",
    "attendance.view": "دیدن حاضری",
    "attendance.manage": "مدیریت حاضری",
    "payroll.view": "دیدن معاشات",
    "payroll.manage": "مدیریت معاشات",
  };

  return labels[key] || key;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UsersRolesPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [mobileDevices, setMobileDevices] = useState<MobileDevice[]>([]);
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm);
  const [roleForm, setRoleForm] = useState<RoleForm>(emptyRoleForm);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const activeUsers = users.filter((user) => user.isActive).length;
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((user) =>
      [user.username, user.displayName, user.role?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [query, users]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [usersResponse, rolesResponse, permissionsResponse, devicesResponse] =
        await Promise.all([
          fetch(`${API_BASE_URL}/api/users`),
          fetch(`${API_BASE_URL}/api/users/roles`),
          fetch(`${API_BASE_URL}/api/users/permissions`),
          fetch(`${API_BASE_URL}/api/users/devices`),
        ]);
      const [usersJson, rolesJson, permissionsJson, devicesJson] = await Promise.all([
        usersResponse.json().catch(() => null),
        rolesResponse.json().catch(() => null),
        permissionsResponse.json().catch(() => null),
        devicesResponse.json().catch(() => null),
      ]);

      if (!usersResponse.ok)
        throw new Error(usersJson?.message || "کاربران خوانده نشد");
      if (!rolesResponse.ok)
        throw new Error(rolesJson?.message || "رول‌ها خوانده نشد");
      if (!permissionsResponse.ok)
        throw new Error(permissionsJson?.message || "صلاحیت‌ها خوانده نشد");
      if (!devicesResponse.ok)
        throw new Error(devicesJson?.message || "دستگاه‌های موبایل خوانده نشد");

      setUsers(usersJson?.data || []);
      setRoles(rolesJson?.data || []);
      setPermissions(permissionsJson?.data || []);
      setMobileDevices(devicesJson?.data || []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "داده‌های کاربران خوانده نشد",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function openCreateUser() {
    setUserForm({
      ...emptyUserForm,
      roleId:
        roles.find((role) => role.name === "Cashier")?.id || roles[0]?.id || "",
    });
    setUserDialogOpen(true);
  }

  function openEditUser(user: User) {
    setUserForm({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: "",
      roleId: user.role?.id || user.roleId || "",
      isActive: user.isActive,
    });
    setUserDialogOpen(true);
  }

  function openCreateRole() {
    setRoleForm(emptyRoleForm);
    setRoleDialogOpen(true);
  }

  function openEditRole(role: Role) {
    setRoleForm({
      id: role.id,
      name: role.name,
      description: role.description || "",
      isActive: role.isActive,
      permissions: role.permissions || [],
    });
    setRoleDialogOpen(true);
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        username: userForm.username.trim(),
        displayName: userForm.displayName.trim(),
        password: userForm.password || undefined,
        roleId: userForm.roleId || null,
        isActive: userForm.isActive,
      };
      const response = await fetch(
        `${API_BASE_URL}/api/users${userForm.id ? `/${userForm.id}` : ""}`,
        {
          method: userForm.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok)
        throw new Error(json?.message || "ذخیره کاربر ناکام شد");

      toast.success("کاربر ذخیره شد");
      setUserDialogOpen(false);
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره کاربر ناکام شد",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/users/roles${roleForm.id ? `/${roleForm.id}` : ""}`,
        {
          method: roleForm.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roleForm),
        },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "ذخیره رول ناکام شد");

      toast.success("رول ذخیره شد");
      setRoleDialogOpen(false);
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره رول ناکام شد",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function disableUser(user: User) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${user.id}`, {
        method: "DELETE",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(json?.message || "غیرفعال‌سازی ناکام شد");
      toast.success("کاربر غیرفعال شد");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "غیرفعال‌سازی ناکام شد",
      );
    }
  }

  async function disableRole(role: Role) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/users/roles/${role.id}`,
        { method: "DELETE" },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(json?.message || "غیرفعال‌سازی رول ناکام شد");
      toast.success("رول غیرفعال شد");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "غیرفعال‌سازی رول ناکام شد",
      );
    }
  }

  async function revokeMobileDevice(device: MobileDevice) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/users/devices/${device.id}/revoke`,
        { method: "POST" },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "لغو دسترسی موبایل ناکام شد");
      }
      toast.success("دسترسی موبایل لغو شد");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "لغو دسترسی موبایل ناکام شد",
      );
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>کاربران فعال</CardDescription>
            <CardTitle>{activeUsers}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>رول‌ها</CardDescription>
            <CardTitle>{roles.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>صلاحیت‌ها</CardDescription>
            <CardTitle>{permissions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>امنیت</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              JWT فعال
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="space-y-0 pb-2">
            <CardDescription>موبایل‌های ثبت‌شده</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4 text-primary" />
              {mobileDevices.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="user">
        <TabsList>
          <TabsTrigger value={"user"}> کاربران</TabsTrigger>
          <TabsTrigger value={"role"}> نقش ها</TabsTrigger>
          <TabsTrigger value={"devices"}> دستگاه‌های موبایل</TabsTrigger>
        </TabsList>
        <TabsContent value={"user"}>
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="size-5 text-primary" />
                  کاربران فروشگاه
                </CardTitle>
                <CardDescription>
                  هر فروشنده login جداگانه دارد و فروش/پرداخت با نام او ثبت
                  می‌شود.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="جستجو..."
                  className="w-64"
                />
                <Button
                  variant="outline"
                  onClick={loadData}
                  disabled={isLoading}
                >
                  <RefreshCcw className="size-4" />
                  تازه‌سازی
                </Button>
                <Button onClick={openCreateUser}>
                  <Plus className="size-4" />
                  کاربر جدید
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                    <TableHead>نام کاربری</TableHead>
                    <TableHead>نام کامل</TableHead>
                    <TableHead>رول</TableHead>
                    <TableHead>آخرین ورود</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-16 text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        در حال خواندن کاربران...
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        کاربری برای نمایش وجود ندارد.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id} className="border-border">
                        <TableCell>{user.username}</TableCell>
                        <TableCell>{user.displayName}</TableCell>
                        <TableCell>{user.role?.name || "-"}</TableCell>
                        <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                        <TableCell>
                          <Badge className="bg-primary/15 text-primary">
                            {user.isActive ? "فعال" : "غیرفعال"}
                          </Badge>
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
                              <DropdownMenuItem onClick={() => openEditUser(user)}>
                                <Settings className="size-4" />
                                <span>ویرایش</span>
                              </DropdownMenuItem>
                              <ConfirmDropdownItem
                                title="تایید غیرفعال‌سازی"
                                description="آیا مطمئن هستید که این کاربر غیرفعال شود؟"
                                confirmLabel="غیرفعال‌سازی"
                                onConfirm={() => disableUser(user)}
                              >
                                <Trash2 className="size-4" />
                                <span>غیرفعال‌سازی</span>
                              </ConfirmDropdownItem>
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
        </TabsContent>
        <TabsContent value={"role"}>
          {" "}
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-primary" />
                  رول‌ها و صلاحیت‌ها
                </CardTitle>
                <CardDescription>
                  Cashier فقط POS و فروش مجاز را می‌بیند؛ Manager/Admin دسترسی
                  گسترده‌تر دارند.
                </CardDescription>
              </div>
              <Button onClick={openCreateRole}>
                <Plus className="size-4" />
                رول جدید
              </Button>
            </CardHeader>
            <CardContent>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                    <TableHead>رول</TableHead>
                    <TableHead>توضیحات</TableHead>
                    <TableHead>صلاحیت‌ها</TableHead>
                    <TableHead>نوع</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-16 text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role.id} className="border-border">
                      <TableCell>{role.name}</TableCell>
                      <TableCell>{role.description || "-"}</TableCell>
                      <TableCell>{role.permissions.length}</TableCell>
                      <TableCell>
                        {role.isSystem ? "سیستمی" : "اختصاصی"}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-primary/15 text-primary">
                          {role.isActive ? "فعال" : "غیرفعال"}
                        </Badge>
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
                            <DropdownMenuItem onClick={() => openEditRole(role)}>
                              <ShieldCheck className="size-4" />
                              <span>صلاحیت‌ها</span>
                            </DropdownMenuItem>
                            {!role.isSystem && (
                              <ConfirmDropdownItem
                                title="تایید غیرفعال‌سازی"
                                description="آیا مطمئن هستید که این رول غیرفعال شود؟"
                                confirmLabel="غیرفعال‌سازی"
                                onConfirm={() => disableRole(role)}
                              >
                                <Trash2 className="size-4" />
                                <span>غیرفعال‌سازی</span>
                              </ConfirmDropdownItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value={"devices"}>
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="size-5 text-primary" />
                  دستگاه‌های موبایل
                </CardTitle>
                <CardDescription>
                  موبایل‌های متصل به حساب کاربران را ببینید و دسترسی دستگاه گم‌شده یا نامعتبر را لغو کنید.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={loadData} disabled={isLoading}>
                <RefreshCcw className="size-4" />
                تازه‌سازی
              </Button>
            </CardHeader>
            <CardContent>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                    <TableHead>دستگاه</TableHead>
                    <TableHead>کاربر</TableHead>
                    <TableHead>آخرین استفاده</TableHead>
                    <TableHead>تاریخ صدور</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="w-16 text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        در حال خواندن دستگاه‌ها...
                      </TableCell>
                    </TableRow>
                  ) : mobileDevices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        هنوز موبایلی ثبت نشده است.
                      </TableCell>
                    </TableRow>
                  ) : (
                    mobileDevices.map((device) => {
                      const revoked = Boolean(device.credentialRevokedAt || !device.isActive);
                      return (
                        <TableRow key={device.id} className="border-border">
                          <TableCell>
                            <div className="font-medium">{device.name || "Muhaseb Mobile"}</div>
                            <div className="max-w-64 break-all text-muted-foreground">
                              {device.code || "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{device.user?.displayName || "-"}</div>
                            <div className="text-muted-foreground">
                              {device.user?.username || "-"}
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(device.lastSeenAt)}</TableCell>
                          <TableCell>{formatDate(device.credentialIssuedAt)}</TableCell>
                          <TableCell>
                            <Badge
                              className={
                                revoked
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              }
                            >
                              {revoked ? "لغو شده" : "فعال"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {revoked ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon-sm" variant="outline" title="عملیات">
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" sideOffset={6} className="w-48" dir="rtl">
                                  <DropdownMenuLabel>عملیات دستگاه</DropdownMenuLabel>
                                  <ConfirmDropdownItem
                                    title="لغو دسترسی موبایل"
                                    description="این موبایل فوراً دیگر نمی‌تواند حاضری ثبت کند. برای فعال‌سازی دوباره، کاربر باید مجدداً وارد شود."
                                    confirmLabel="لغو دسترسی"
                                    onConfirm={() => revokeMobileDevice(device)}
                                  >
                                    <Trash2 className="size-4" />
                                    <span>لغو دسترسی</span>
                                  </ConfirmDropdownItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {userForm.id ? "ویرایش کاربر" : "کاربر جدید"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={saveUser} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">نام کاربری</span>
                <Input
                  value={userForm.username}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">نام کامل</span>
                <Input
                  value={userForm.displayName}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">
                  رمز عبور {userForm.id ? "(برای عدم تغییر خالی بماند)" : ""}
                </span>
                <Input
                  type="password"
                  value={userForm.password}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">رول</span>
                <Combobox
                  value={userForm.roleId}
                  placeholder="بدون رول"
                  onValueChange={(value) =>
                    setUserForm((current) => ({
                      ...current,
                      roleId: value,
                    }))
                  }
                  options={[
                    { value: "", label: "بدون رول" },
                    ...roles.map((role) => ({
                      value: role.id,
                      label: role.name,
                      description: role.description || null,
                    })),
                  ]}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={userForm.isActive}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                />
                فعال
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUserDialogOpen(false)}
              >
                لغو
              </Button>
              <Button type="submit" disabled={isSaving}>
                ذخیره
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{roleForm.id ? "ویرایش رول" : "رول جدید"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveRole} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">نام رول</span>
                <Input
                  value={roleForm.name}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">توضیحات</span>
                <Input
                  value={roleForm.description}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={roleForm.isActive}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                />
                فعال
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {permissions.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={roleForm.permissions.includes(permission.key)}
                    onChange={(event) =>
                      setRoleForm((current) => ({
                        ...current,
                        permissions: event.target.checked
                          ? [...current.permissions, permission.key]
                          : current.permissions.filter(
                              (key) => key !== permission.key,
                            ),
                      }))
                    }
                  />
                  <span>
                    <span className="block font-medium">
                      {permissionLabel(permission.key)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {permission.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoleDialogOpen(false)}
              >
                لغو
              </Button>
              <Button type="submit" disabled={isSaving}>
                ذخیره رول
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
