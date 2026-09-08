import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFonts } from "expo-font";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const APP_LOGO = require("./assets/logo.png");
const FONT_REGULAR = "Zain-Regular";
const FONT_BOLD = "Zain-Bold";
const FONT_HEAVY = "Zain-ExtraBold";

type Screen = "login" | "connect" | "scanner" | "attendance" | "reports";
type CameraMode = "connect" | "product" | "attendance" | null;
type ToastType = "success" | "error" | "info";
type DashboardPeriod = "today" | "week" | "month" | "fourMonths";

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
};

type PosConnection = {
  sessionId: string;
  apiBaseUrl: string;
  webSocketUrl: string;
  scanHttpUrl: string;
};

type CartItem = {
  key: string;
  productId: string;
  productName: string;
  barcode: string;
  unitName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  expiryDate?: string | null;
};

type EmployeeUser = {
  id: string;
  username: string;
  displayName?: string | null;
  role?: string | null;
  mustChangePassword?: boolean;
  employee?: {
    id: string;
    code?: string | null;
    fullName: string;
    phone?: string | null;
    position?: string | null;
    monthlySalary?: number;
  } | null;
};

type EmployeeSummary = {
  employee: {
    id: string;
    code?: string | null;
    fullName: string;
    phone?: string | null;
    position?: string | null;
    monthlySalary?: number;
  };
  todayRecord?: {
    checkInAt?: string | null;
    checkOutAt?: string | null;
    status?: string | null;
  } | null;
  currentPeriod?: {
    year: number;
    month: number;
    name?: string | null;
  } | null;
  summary?: {
    presentDays?: number;
    halfDays?: number;
    absentDays?: number;
    overtimeHours?: number;
    monthlySalary?: number;
    latestPayroll?: {
      grossPay?: number;
      paidAmount?: number;
      remainingAmount?: number;
    } | null;
  };
};

type AttendanceIntent = "CHECK_IN" | "CHECK_OUT";

type DashboardSummary = {
  period?: {
    key: DashboardPeriod;
    start?: string;
    end?: string;
  };
  currency?: {
    displayCode?: string | null;
    baseCode?: string | null;
  };
  overview?: {
    sales?: number;
    purchases?: number;
    grossProfit?: number;
    netProfit?: number;
    income?: number;
    expenses?: number;
    treasury?: number;
    receivables?: number;
    payables?: number;
  };
};

const T = {
  connectTitle:
    "\u0627\u062a\u0635\u0627\u0644 \u0628\u0647 \u0635\u0646\u062f\u0648\u0642 \u0641\u0631\u0648\u0634",
  connectSub:
    "QR \u0645\u0648\u062c\u0648\u062f \u062f\u0631 \u0635\u0641\u062d\u0647 POS \u062f\u0633\u06a9\u062a\u0627\u067e \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f.",
  connectCardTitle: "\u0627\u062a\u0635\u0627\u0644 \u0628\u0627 QR Code",
  connectCardText:
    "\u0631\u0648\u0634 \u062f\u0633\u062a\u06cc \u062d\u0630\u0641 \u0634\u062f\u0647 \u0627\u0633\u062a. \u0627\u062a\u0635\u0627\u0644 \u0641\u0642\u0637 \u0628\u0627 QR \u0627\u0646\u062c\u0627\u0645 \u0645\u06cc\u200c\u0634\u0648\u062f.",
  scanQr: "\u0627\u0633\u06a9\u0646 QR \u0627\u062a\u0635\u0627\u0644",
  closeCamera: "\u0628\u0633\u062a\u0646 \u062f\u0648\u0631\u0628\u06cc\u0646",
  status: "\u0648\u0636\u0639\u06cc\u062a",
  ready:
    "\u0628\u0631\u0627\u06cc \u0627\u062a\u0635\u0627\u0644\u060c QR \u0635\u0646\u062f\u0648\u0642 \u0641\u0631\u0648\u0634 \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f",
  invalidQr:
    "QR \u0627\u062a\u0635\u0627\u0644 \u0645\u0639\u062a\u0628\u0631 \u0646\u06cc\u0633\u062a",
  qrRead:
    "QR \u0627\u062a\u0635\u0627\u0644 \u062e\u0648\u0627\u0646\u062f\u0647 \u0634\u062f",
  connecting:
    "\u062f\u0631 \u062d\u0627\u0644 \u0627\u062a\u0635\u0627\u0644 \u0628\u0647 \u0635\u0646\u062f\u0648\u0642 \u0641\u0631\u0648\u0634...",
  connected:
    "\u0648\u0635\u0644 \u0634\u062f\u061b \u062d\u0627\u0644\u0627 \u0628\u0627\u0631\u06a9\u0648\u062f \u0645\u062d\u0635\u0648\u0644 \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f",
  connectedToast:
    "\u0627\u062a\u0635\u0627\u0644 \u0645\u0648\u0641\u0642 \u0634\u062f",
  wsError:
    "\u062e\u0637\u0627 \u062f\u0631 \u0627\u062a\u0635\u0627\u0644 \u0628\u0647 \u0635\u0646\u062f\u0648\u0642 \u0641\u0631\u0648\u0634",
  lost: "\u0627\u0631\u062a\u0628\u0627\u0637 \u0642\u0637\u0639 \u0634\u062f\u061b \u062a\u0644\u0627\u0634 \u0628\u0631\u0627\u06cc \u0627\u062a\u0635\u0627\u0644 \u062f\u0648\u0628\u0627\u0631\u0647...",
  scanProductTitle:
    "\u0627\u0633\u06a9\u0646 \u0628\u0627\u0631\u06a9\u0648\u062f \u0645\u062d\u0635\u0648\u0644",
  productHint:
    "\u0628\u0627\u0631\u06a9\u0648\u062f \u0645\u062d\u0635\u0648\u0644 \u0631\u0627 \u062f\u0627\u062e\u0644 \u06a9\u0627\u062f\u0631 \u0646\u06af\u0647 \u062f\u0627\u0631\u06cc\u062f",
  cameraOffTitle:
    "\u062f\u0648\u0631\u0628\u06cc\u0646 \u0645\u062a\u0648\u0642\u0641 \u0627\u0633\u062a",
  cameraOffText:
    "\u0628\u0631\u0627\u06cc \u0627\u0633\u06a9\u0646 \u0645\u062d\u0635\u0648\u0644\u060c \u062f\u06a9\u0645\u0647 \u0634\u0631\u0648\u0639 \u0627\u0633\u06a9\u0646 \u0631\u0627 \u0628\u0632\u0646\u06cc\u062f.",
  startScan:
    "\u0634\u0631\u0648\u0639 \u0627\u0633\u06a9\u0646 \u0628\u0627\u0631\u06a9\u0648\u062f",
  stopScan: "\u062a\u0648\u0642\u0641 \u0627\u0633\u06a9\u0646",
  disconnect: "\u0642\u0637\u0639 \u0627\u062a\u0635\u0627\u0644",
  connectBack: "\u0627\u062a\u0635\u0627\u0644",
  on: "\u0648\u0635\u0644",
  off: "\u0642\u0637\u0639",
  cartTitle: "\u0633\u0628\u062f \u0645\u0648\u0628\u0627\u06cc\u0644",
  cartSub:
    "\u0645\u062d\u0635\u0648\u0644\u0627\u062a\u06cc \u06a9\u0647 \u0628\u0627 \u0647\u0645\u06cc\u0646 \u0645\u0648\u0628\u0627\u06cc\u0644 \u0627\u0633\u06a9\u0646 \u0634\u062f\u0647\u200c\u0627\u0646\u062f",
  clear: "\u067e\u0627\u06a9\u200c\u06a9\u0631\u062f\u0646",
  items: "\u062a\u0639\u062f\u0627\u062f",
  total: "\u0645\u062c\u0645\u0648\u0639",
  empty:
    "\u0647\u0646\u0648\u0632 \u0645\u062d\u0635\u0648\u0644\u06cc \u0627\u0633\u06a9\u0646 \u0646\u0634\u062f\u0647 \u0627\u0633\u062a",
  cartCleared:
    "\u0633\u0628\u062f \u0645\u0648\u0628\u0627\u06cc\u0644 \u067e\u0627\u06a9 \u0634\u062f",
  disconnectToast:
    "\u0627\u062a\u0635\u0627\u0644 \u0642\u0637\u0639 \u0634\u062f",
  needCameraTitle:
    "\u0627\u062c\u0627\u0632\u0647 \u0644\u0627\u0632\u0645 \u0627\u0633\u062a",
  needCamera:
    "\u0628\u0631\u0627\u06cc \u0627\u0633\u06a9\u0646\u060c \u0627\u062c\u0627\u0632\u0647 Camera \u0644\u0627\u0632\u0645 \u0627\u0633\u062a",
  needPos:
    "\u0627\u0648\u0644 \u0628\u0627\u06cc\u062f \u0628\u0647 \u0635\u0646\u062f\u0648\u0642 \u0641\u0631\u0648\u0634 \u0648\u0635\u0644 \u0634\u0648\u06cc\u062f",
  scanFail:
    "\u0627\u0633\u06a9\u0646 \u0646\u0627\u06a9\u0627\u0645 \u0634\u062f",
  sendError:
    "\u062e\u0637\u0627 \u062f\u0631 \u0627\u0631\u0633\u0627\u0644 \u0628\u0627\u0631\u06a9\u0648\u062f",
  outOfStockPrefix:
    "\u0645\u0648\u062c\u0648\u062f\u06cc \u0646\u062f\u0627\u0631\u062f: ",
  addedPrefix: "\u0627\u0636\u0627\u0641\u0647 \u0634\u062f: ",
  addedSuffix:
    " \u0628\u0647 \u0633\u0628\u062f \u0627\u0636\u0627\u0641\u0647 \u0634\u062f",
  qrHint:
    "QR \u0627\u062a\u0635\u0627\u0644 \u0631\u0627 \u062f\u0627\u062e\u0644 \u06a9\u0627\u062f\u0631 \u0642\u0631\u0627\u0631 \u062f\u0647\u06cc\u062f",
  qrReceived:
    "\u0627\u062a\u0635\u0627\u0644 \u062f\u0631\u06cc\u0627\u0641\u062a \u0634\u062f\u061b \u0648\u0631\u0648\u062f \u0628\u0647 \u0635\u0641\u062d\u0647 \u0627\u0633\u06a9\u0646 \u0645\u062d\u0635\u0648\u0644...",
  rtlIntro:
    "\u0641\u0642\u0637 QR \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f\u061b \u0628\u0639\u062f \u0627\u0632 \u0627\u062a\u0635\u0627\u0644\u060c \u0628\u0631\u0646\u0627\u0645\u0647 \u062e\u0648\u062f\u06a9\u0627\u0631 \u0648\u0627\u0631\u062f \u0635\u0641\u062d\u0647 \u0627\u0633\u06a9\u0646 \u0645\u062d\u0635\u0648\u0644 \u0645\u06cc\u200c\u0634\u0648\u062f.",
  manualRemoved:
    "\u0627\u062a\u0635\u0627\u0644 \u062f\u0633\u062a\u06cc \u062d\u0630\u0641 \u0634\u062f\u0647 \u0627\u0633\u062a",
  session: "\u062c\u0644\u0633\u0647",
  unit: "\u0648\u0627\u062d\u062f",
  attendance: "\u062d\u0627\u0636\u0631\u06cc",
  attendanceTitle:
    "\u0627\u0633\u06a9\u0646 \u062d\u0627\u0636\u0631\u06cc \u06a9\u0627\u0631\u0645\u0646\u062f",
  attendanceSub:
    "\u0628\u0627 \u06cc\u0648\u0632\u0631 \u06a9\u0627\u0631\u0645\u0646\u062f \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f \u0648 QR \u062d\u0627\u0636\u0631\u06cc \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f.",
  employeeLogin:
    "\u0648\u0631\u0648\u062f \u06a9\u0627\u0631\u0645\u0646\u062f",
  employeeLoginTitle:
    "\u0648\u0631\u0648\u062f \u06a9\u0627\u0631\u0645\u0646\u062f \u0628\u0647 \u0627\u067e",
  serverAddress: "\u0622\u062f\u0631\u0633 \u0633\u0631\u0648\u0631",
  serverAddressHint: "http://SERVER-IP:4000",
  serverDetected:
    "\u0633\u0631\u0648\u0631 \u0634\u0646\u0627\u0633\u0627\u06cc\u06cc \u0634\u062f",
  serverSettings: "تنظیم سرور",
  serverSettingsTitle: "آدرس سرور فروشگاه",
  serverSettingsSub:
    "آدرس API سرور داخل فروشگاه را وارد کنید. مثال: http://192.168.1.10:4000",
  save: "ذخیره",
  cancel: "انصراف",
  serverSaved: "آدرس سرور ذخیره شد",
  invalidServerAddress: "آدرس سرور معتبر نیست",
  username: "\u0646\u0627\u0645 \u06a9\u0627\u0631\u0628\u0631\u06cc",
  password: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631",
  currentPassword: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0641\u0639\u0644\u06cc",
  newPassword: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062c\u062f\u06cc\u062f",
  confirmPassword: "\u062a\u06a9\u0631\u0627\u0631 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062c\u062f\u06cc\u062f",
  changePassword: "\u062a\u063a\u06cc\u06cc\u0631 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631",
  changePasswordTitle: "\u0631\u0645\u0632 \u0627\u0648\u0644\u06cc\u0647 \u0631\u0627 \u062a\u063a\u06cc\u06cc\u0631 \u062f\u0647\u06cc\u062f",
  changePasswordHint:
    "\u0628\u0631\u0627\u06cc \u0627\u0645\u0646\u06cc\u062a \u062d\u0633\u0627\u0628\u060c \u067e\u06cc\u0634 \u0627\u0632 \u0627\u062f\u0627\u0645\u0647 \u0631\u0645\u0632 \u062c\u062f\u06cc\u062f \u062a\u0639\u06cc\u06cc\u0646 \u06a9\u0646\u06cc\u062f.",
  passwordMismatch: "\u062a\u06a9\u0631\u0627\u0631 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u06cc\u06a9\u0633\u0627\u0646 \u0646\u06cc\u0633\u062a",
  passwordTooShort: "\u0631\u0645\u0632 \u062c\u062f\u06cc\u062f \u0628\u0627\u06cc\u062f \u062d\u062f\u0627\u0642\u0644 \u06f8 \u062d\u0631\u0641 \u0628\u0627\u0634\u062f",
  deviceNotReady: "\u0634\u0646\u0627\u0633\u0647 \u0645\u0648\u0628\u0627\u06cc\u0644 \u0622\u0645\u0627\u062f\u0647 \u0646\u06cc\u0633\u062a\u061b \u0627\u067e \u0631\u0627 \u062f\u0648\u0628\u0627\u0631\u0647 \u0628\u0627\u0632 \u06a9\u0646\u06cc\u062f",
  deviceLoginRequired: "\u0627\u0639\u062a\u0628\u0627\u0631 \u0627\u06cc\u0646 \u0645\u0648\u0628\u0627\u06cc\u0644 \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a\u061b \u062e\u0627\u0631\u062c \u0634\u062f\u0647 \u0648 \u062f\u0648\u0628\u0627\u0631\u0647 \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f",
  login: "\u0648\u0631\u0648\u062f",
  logout: "\u062e\u0631\u0648\u062c",
  loggedInAs: "\u0648\u0627\u0631\u062f \u0634\u062f\u0647",
  scanAttendanceQr:
    "\u0627\u0633\u06a9\u0646 QR \u062d\u0627\u0636\u0631\u06cc",
  startWork: "\u0634\u0631\u0648\u0639 \u06a9\u0627\u0631",
  endWork: "\u067e\u0627\u06cc\u0627\u0646 \u06a9\u0627\u0631",
  alreadyStarted:
    "\u0634\u0631\u0648\u0639 \u06a9\u0627\u0631 \u0627\u0645\u0631\u0648\u0632 \u0642\u0628\u0644\u0627\u064b \u062b\u0628\u062a \u0634\u062f\u0647 \u0627\u0633\u062a",
  startFirst:
    "\u0627\u0648\u0644 \u0634\u0631\u0648\u0639 \u06a9\u0627\u0631 \u0631\u0627 \u062b\u0628\u062a \u06a9\u0646",
  workFinished:
    "\u06a9\u0627\u0631 \u0627\u0645\u0631\u0648\u0632 \u062e\u062a\u0645 \u0634\u062f\u0647 \u0627\u0633\u062a",
  chooseAttendanceAction:
    "\u0639\u0645\u0644\u06cc\u0627\u062a \u062d\u0627\u0636\u0631\u06cc \u0631\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646",
  scanAttendanceBeforeLogin:
    "\u0627\u0648\u0644 QR \u062d\u0627\u0636\u0631\u06cc \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646",
  attendanceQrReady:
    "\u0633\u0631\u0648\u0631 \u0634\u0646\u0627\u0633\u0627\u06cc\u06cc \u0634\u062f\u061b \u062d\u0627\u0644\u0627 \u0644\u0627\u06af\u06cc\u0646 \u06a9\u0646",
  attendanceQrHint:
    "QR \u062d\u0627\u0636\u0631\u06cc \u0631\u0627 \u062f\u0627\u062e\u0644 \u06a9\u0627\u062f\u0631 \u0646\u06af\u0647 \u062f\u0627\u0631\u06cc\u062f",
  needEmployeeLogin:
    "\u0627\u0648\u0644 \u0628\u0627 \u06cc\u0648\u0632\u0631 \u06a9\u0627\u0631\u0645\u0646\u062f \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f",
  needConnectionForLogin:
    "\u0627\u0648\u0644 QR \u062d\u0627\u0636\u0631\u06cc \u0631\u0627 \u0627\u0633\u06a9\u0646 \u06a9\u0646\u06cc\u062f",
  loginOk: "\u0648\u0631\u0648\u062f \u0645\u0648\u0641\u0642 \u0634\u062f",
  loginFail:
    "\u0648\u0631\u0648\u062f \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f",
  summary: "\u062e\u0644\u0627\u0635\u0647 \u062d\u0627\u0636\u0631\u06cc",
  present: "\u062d\u0627\u0636\u0631",
  halfPresent: "\u0646\u06cc\u0645\u200c\u062d\u0627\u0636\u0631",
  absent: "\u063a\u06cc\u0631\u062d\u0627\u0636\u0631",
  overtime: "\u0627\u0636\u0627\u0641\u0647\u200c\u06a9\u0627\u0631\u06cc",
  salary: "\u0645\u0639\u0627\u0634",
  paid: "\u067e\u0631\u062f\u0627\u062e\u062a\u200c\u0634\u062f\u0647",
  remaining: "\u0628\u0627\u0642\u06cc",
  checkInOk:
    "\u0634\u0631\u0648\u0639 \u06a9\u0627\u0631 \u062b\u0628\u062a \u0634\u062f",
  checkOutOk:
    "\u062e\u062a\u0645 \u06a9\u0627\u0631 \u062b\u0628\u062a \u0634\u062f",
  attendanceDone:
    "\u062d\u0627\u0636\u0631\u06cc \u0627\u0645\u0631\u0648\u0632 \u0642\u0628\u0644\u0627\u064b \u062a\u06a9\u0645\u06cc\u0644 \u0634\u062f\u0647 \u0627\u0633\u062a",
  invalidAttendanceQr:
    "QR \u062d\u0627\u0636\u0631\u06cc \u0645\u0639\u062a\u0628\u0631 \u0646\u06cc\u0633\u062a",
  productScanner: "\u0627\u0633\u06a9\u0646 \u0641\u0631\u0648\u0634",
  reports: "گزارش‌ها",
  reportsTitle: "خلاصه داشبورد",
  reportsSub: "۹ کارت مهم مدیریتی با فیلتر دوره زمانی",
  today: "امروز",
  week: "هفته",
  month: "ماه",
  fourMonths: "۴ ماه اخیر",
  refresh: "بروزرسانی",
  loadingReports: "در حال دریافت گزارش‌ها...",
  reportsError: "گزارش‌ها دریافت نشد",
  sales: "فروش",
  purchases: "خرید",
  grossProfit: "مفاد ناخالص",
  netProfit: "مفاد خالص",
  income: "عواید",
  expenses: "مصارف",
  treasury: "صندوق و بانک",
  receivables: "طلب مشتریان",
  payables: "بدهی فروشندگان",
};

const COLORS = {
  bg: "#050B10",
  bg2: "#071318",
  card: "#0B1B20",
  card2: "#102A2F",
  stroke: "#1A4A50",
  blue: "#25C5C3",
  purple: "#169A92",
  cyan: "#2DD4D0",
  text: "#F6F8FF",
  textSoft: "#A8B3CC",
  success: "#22C55E",
  error: "#EF4444",
  warning: "#F59E0B",
};

function trimEndSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function money(value: number, code?: string | null) {
  return new Intl.NumberFormat("fa-AF", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0)) + (code ? ` ${code}` : "");
}

const DASHBOARD_PERIODS: Array<{ key: DashboardPeriod; label: string }> = [
  { key: "today", label: T.today },
  { key: "week", label: T.week },
  { key: "month", label: T.month },
  { key: "fourMonths", label: T.fourMonths },
];

function isAdminUser(user: EmployeeUser | null) {
  return String(user?.role || "").toLowerCase() === "admin";
}

function getDashboardCards(summary: DashboardSummary | null) {
  const overview = summary?.overview || {};

  return [
    { key: "sales", label: T.sales, value: overview.sales || 0, tone: "blue" },
    {
      key: "purchases",
      label: T.purchases,
      value: overview.purchases || 0,
      tone: "purple",
    },
    {
      key: "grossProfit",
      label: T.grossProfit,
      value: overview.grossProfit || 0,
      tone: "success",
    },
    {
      key: "netProfit",
      label: T.netProfit,
      value: overview.netProfit || 0,
      tone: "success",
    },
    { key: "income", label: T.income, value: overview.income || 0, tone: "success" },
    { key: "expenses", label: T.expenses, value: overview.expenses || 0, tone: "error" },
    {
      key: "treasury",
      label: T.treasury,
      value: overview.treasury || 0,
      tone: "blue",
    },
    {
      key: "receivables",
      label: T.receivables,
      value: overview.receivables || 0,
      tone: "warning",
    },
    {
      key: "payables",
      label: T.payables,
      value: overview.payables || 0,
      tone: "error",
    },
  ];
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MOBILE_OPERATIONS_KEY = "muhaseb_recent_mobile_operations_v1";
const recentMobileOperations = new Map<
  string,
  { operationId: string; expiresAt: number }
>();
let mobileOperationsLoadPromise: Promise<void> | null = null;

function loadMobileOperations() {
  if (mobileOperationsLoadPromise) return mobileOperationsLoadPromise;
  mobileOperationsLoadPromise = (async () => {
    try {
      const parsed = JSON.parse(
        (await AsyncStorage.getItem(MOBILE_OPERATIONS_KEY)) || "[]",
      ) as Array<[string, { operationId: string; expiresAt: number }]>;
      const now = Date.now();
      for (const [signature, operation] of parsed) {
        if (
          signature &&
          operation?.operationId &&
          Number(operation.expiresAt) > now
        ) {
          recentMobileOperations.set(signature, operation);
        }
      }
    } catch {
      await AsyncStorage.removeItem(MOBILE_OPERATIONS_KEY).catch(() => undefined);
    }
  })();
  return mobileOperationsLoadPromise;
}

async function persistMobileOperations() {
  await AsyncStorage.setItem(
    MOBILE_OPERATIONS_KEY,
    JSON.stringify(Array.from(recentMobileOperations.entries())),
  ).catch(() => undefined);
}

function mobileStableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function operationFetch(input: string, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(method)) return fetch(input, init);

  let pathName = "";
  try {
    pathName = new URL(input).pathname;
  } catch {
    pathName = input;
  }
  if (pathName === "/api/pos/scan") return fetch(input, init);

  const headers = new Headers(init.headers || {});
  headers.set("x-client-channel", "MOBILE");
  headers.set("x-app-version", process.env.EXPO_PUBLIC_APP_VERSION || "mobile-dev");
  if (headers.has("Idempotency-Key")) {
    headers.set("x-correlation-id", headers.get("Idempotency-Key")!);
    return fetch(input, { ...init, method, headers });
  }

  await loadMobileOperations();

  const bodySignature =
    typeof init.body === "string"
      ? init.body
      : init.body == null
        ? "empty"
        : Object.prototype.toString.call(init.body);
  const payloadHash = mobileStableHash(bodySignature);
  const signature = mobileStableHash(`${method}:${input}:${payloadHash}`);
  const now = Date.now();
  let pruned = false;
  for (const [key, entry] of recentMobileOperations) {
    if (entry.expiresAt <= now) {
      recentMobileOperations.delete(key);
      pruned = true;
    }
  }
  if (pruned) await persistMobileOperations();

  const recent = recentMobileOperations.get(signature);
  const operationId = recent?.operationId || makeId();
  recentMobileOperations.set(signature, {
    operationId,
    expiresAt: now + 10 * 60_000,
  });
  await persistMobileOperations();

  headers.set("Idempotency-Key", operationId);
  headers.set("X-Idempotency-Payload-Hash", payloadHash);
  headers.set("x-correlation-id", operationId);

  try {
    const response = await fetch(input, { ...init, method, headers });
    const current = recentMobileOperations.get(signature);
    if (current) {
      if (response.ok) current.expiresAt = Date.now() + 3_000;
      else if (response.status >= 500 || response.status === 409) {
        current.expiresAt = Date.now() + 10 * 60_000;
      } else {
        recentMobileOperations.delete(signature);
      }
      await persistMobileOperations();
    }
    return response;
  } catch (error) {
    const current = recentMobileOperations.get(signature);
    if (current) {
      current.expiresAt = Date.now() + 10 * 60_000;
      await persistMobileOperations();
    }
    throw error;
  }
}

function vibrateSuccess() {
  if (Platform.OS === "android") {
    Vibration.vibrate(80);
    return;
  }

  Vibration.vibrate();
}

function getScanButtonTitle(cameraMode: CameraMode) {
  return cameraMode === "product" ? T.stopScan : T.startScan;
}

function getAttendanceScanButtonTitle(cameraMode: CameraMode) {
  return cameraMode === "attendance" ? T.closeCamera : T.scanAttendanceQr;
}

function parseAttendanceQrPayload(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.token) {
      return {
        token: String(parsed.token),
        apiBaseUrl: parsed?.apiBaseUrl
          ? trimEndSlash(String(parsed.apiBaseUrl))
          : null,
      };
    }
  } catch {
    // QR may be a URL or raw token.
  }

  try {
    const url = new URL(raw);
    return {
      token: url.searchParams.get("token") || raw,
      apiBaseUrl: url.searchParams.get("apiBaseUrl")
        ? trimEndSlash(String(url.searchParams.get("apiBaseUrl")))
        : null,
    };
  } catch {
    return {
      token: raw,
      apiBaseUrl: null,
    };
  }
}

const AUTH_TOKEN_KEY = "belal_mobile_employee_token";
const AUTH_USER_KEY = "belal_mobile_employee_user";
const API_BASE_URL_KEY = "belal_mobile_api_base_url";
const DEVICE_ID_KEY = "belal_mobile_device_id";
const DEVICE_CREDENTIAL_KEY = "belal_mobile_device_credential";
const DEFAULT_API_BASE_URL = trimEndSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL || "",
);

function makeDeviceId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `MOBILE-${random}`;
}

const memoryStore = new Map<string, string>();
const secureStorageKeys = new Set([AUTH_TOKEN_KEY, DEVICE_CREDENTIAL_KEY]);

async function canUseSecureStore() {
  if (Platform.OS === "web") return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readStoredValue(key: string) {
  try {
    const value =
      secureStorageKeys.has(key) && (await canUseSecureStore())
        ? await SecureStore.getItemAsync(key)
        : await AsyncStorage.getItem(key);
    if (value !== null) memoryStore.set(key, value);
    return value;
  } catch {
    return memoryStore.get(key) || null;
  }
}

async function writeStoredValue(key: string, value: string) {
  memoryStore.set(key, value);
  if (secureStorageKeys.has(key) && (await canUseSecureStore())) {
    await SecureStore.setItemAsync(key, value);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

async function deleteStoredValue(key: string) {
  memoryStore.delete(key);
  if (secureStorageKeys.has(key) && (await canUseSecureStore())) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({
    [FONT_REGULAR]: require("./assets/font/zain/Zain-Regular.ttf"),
    [FONT_BOLD]: require("./assets/font/zain/Zain-Bold.ttf"),
    [FONT_HEAVY]: require("./assets/font/zain/Zain-ExtraBold.ttf"),
  });
  const [permission, requestPermission] = useCameraPermissions();

  const [screen, setScreen] = useState<Screen>("login");
  const [cameraMode, setCameraMode] = useState<CameraMode>(null);

  const [connection, setConnection] = useState<PosConnection | null>(null);
  const connectionRef = useRef<PosConnection | null>(null);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [statusText, setStatusText] = useState(T.ready);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [serverApiBaseUrl, setServerApiBaseUrl] =
    useState(DEFAULT_API_BASE_URL);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsValue, setServerSettingsValue] =
    useState(DEFAULT_API_BASE_URL);
  const [pendingAttendanceToken, setPendingAttendanceToken] = useState("");
  const [attendanceIntent, setAttendanceIntent] =
    useState<AttendanceIntent>("CHECK_IN");
  const [deviceId, setDeviceId] = useState("");
  const [deviceCredential, setDeviceCredential] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<EmployeeUser | null>(null);
  const [employeeSummary, setEmployeeSummary] =
    useState<EmployeeSummary | null>(null);
  const [dashboardPeriod, setDashboardPeriod] =
    useState<DashboardPeriod>("today");
  const [dashboardSummary, setDashboardSummary] =
    useState<DashboardSummary | null>(null);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isAttendanceBusy, setIsAttendanceBusy] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrLockRef = useRef(false);
  const attendanceLockRef = useRef(false);
  const submitAttendanceQrRef = useRef<
    | ((
        raw: string,
        tokenOverride?: string,
        intentOverride?: AttendanceIntent,
      ) => Promise<void>)
    | null
  >(null);

  const activeVisibleCodesRef = useRef<Set<string>>(new Set());
  const lastSeenCodesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let mounted = true;

    async function restoreAuth() {
      const [
        savedToken,
        savedUser,
        savedApiBaseUrl,
        savedDeviceId,
        savedDeviceCredential,
      ] =
        await Promise.all([
          readStoredValue(AUTH_TOKEN_KEY),
          readStoredValue(AUTH_USER_KEY),
          readStoredValue(API_BASE_URL_KEY),
          readStoredValue(DEVICE_ID_KEY),
          readStoredValue(DEVICE_CREDENTIAL_KEY),
        ]);

      if (!mounted) return;

      if (savedToken) setAuthToken(savedToken);
      if (savedDeviceCredential) setDeviceCredential(savedDeviceCredential);
      if (savedApiBaseUrl) {
        setServerApiBaseUrl(savedApiBaseUrl);
        setServerSettingsValue(savedApiBaseUrl);
      }
      if (savedDeviceId) {
        setDeviceId(savedDeviceId);
      } else {
        const nextDeviceId = makeDeviceId();
        setDeviceId(nextDeviceId);
        await writeStoredValue(DEVICE_ID_KEY, nextDeviceId);
      }
      if (savedUser) {
        try {
          setAuthUser(JSON.parse(savedUser));
          if (savedToken) {
            setScreen("connect");
          }
        } catch {
          await deleteStoredValue(AUTH_USER_KEY);
        }
      }
    }

    restoreAuth();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = makeId();

    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2200);
  }, []);

  const getApiBaseUrl = useCallback(() => {
    const fromConnection =
      connectionRef.current?.apiBaseUrl || connection?.apiBaseUrl || "";
    const fromInput = serverApiBaseUrl.trim();
    const value = fromConnection || fromInput;
    return value ? trimEndSlash(value) : null;
  }, [connection?.apiBaseUrl, serverApiBaseUrl]);

  useEffect(() => {
    if (
      !authToken ||
      !authUser ||
      authUser.mustChangePassword ||
      !deviceId ||
      deviceCredential
    ) {
      return;
    }
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) return;

    let cancelled = false;
    async function registerExistingSessionDevice() {
      try {
        const response = await operationFetch(`${apiBaseUrl}/api/auth/register-device`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            deviceId,
            deviceName: `Muhaseb ${Platform.OS}`,
          }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.message || T.deviceLoginRequired);
        const credential = String(json?.data?.credential || "");
        if (!credential) throw new Error(T.deviceLoginRequired);
        if (cancelled) return;
        setDeviceCredential(credential);
        await writeStoredValue(DEVICE_CREDENTIAL_KEY, credential);
      } catch (error: any) {
        if (!cancelled) showToast(error?.message || T.deviceLoginRequired, "error");
      }
    }
    void registerExistingSessionDevice();
    return () => {
      cancelled = true;
    };
  }, [authToken, authUser, deviceCredential, deviceId, getApiBaseUrl, showToast]);

  const openServerSettings = useCallback(() => {
    setServerSettingsValue(serverApiBaseUrl || "");
    setServerSettingsOpen(true);
  }, [serverApiBaseUrl]);

  const saveServerSettings = useCallback(async () => {
    const rawValue = serverSettingsValue.trim();

    if (!rawValue) {
      showToast(T.invalidServerAddress, "error");
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawValue)
      ? rawValue
      : `http://${rawValue}`;
    const nextValue = trimEndSlash(withProtocol);

    try {
      const url = new URL(nextValue);

      if (!url.hostname || !url.port) {
        throw new Error(T.invalidServerAddress);
      }

      setServerApiBaseUrl(nextValue);
      await writeStoredValue(API_BASE_URL_KEY, nextValue);
      setServerSettingsOpen(false);
      showToast(T.serverSaved, "success");
    } catch (error: any) {
      showToast(error?.message || T.invalidServerAddress, "error");
    }
  }, [serverSettingsValue, showToast]);

  const loadEmployeeSummary = useCallback(
    async (tokenValue = authToken) => {
      const apiBaseUrl = getApiBaseUrl();

      if (!apiBaseUrl || !tokenValue) {
        return;
      }

      try {
        const response = await operationFetch(`${apiBaseUrl}/api/employees/me`, {
          headers: {
            Authorization: `Bearer ${tokenValue}`,
          },
        });
        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || T.loginFail);
        }

        setEmployeeSummary(json?.data || null);
      } catch (error: any) {
        showToast(error?.message || T.loginFail, "error");
      }
    },
    [authToken, getApiBaseUrl, showToast],
  );

  const loadDashboardSummary = useCallback(
    async (periodValue = dashboardPeriod, tokenValue = authToken) => {
      const apiBaseUrl = getApiBaseUrl();

      if (!apiBaseUrl || !tokenValue) {
        return;
      }

      setIsReportsLoading(true);

      try {
        const response = await operationFetch(
          `${apiBaseUrl}/api/dashboard/summary?period=${periodValue}`,
          {
            headers: {
              Authorization: `Bearer ${tokenValue}`,
            },
          },
        );
        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || T.reportsError);
        }

        setDashboardSummary(json?.data || null);
      } catch (error: any) {
        showToast(error?.message || T.reportsError, "error");
      } finally {
        setIsReportsLoading(false);
      }
    },
    [authToken, dashboardPeriod, getApiBaseUrl, showToast],
  );

  const loginEmployee = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl) {
      showToast(T.needConnectionForLogin, "error");
      return;
    }

    if (!loginUsername.trim() || !loginPassword) {
      showToast(T.needEmployeeLogin, "error");
      return;
    }

    if (!deviceId) {
      showToast(T.deviceNotReady, "error");
      return;
    }

    setIsAuthBusy(true);

    try {
      const response = await operationFetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          deviceId,
          deviceName: `Muhaseb ${Platform.OS}`,
          deviceType: "MOBILE",
        }),
      });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json?.message || T.loginFail);
      }

      const nextToken = String(json?.data?.token || "");
      const nextUser = json?.data?.user as EmployeeUser | undefined;
      const nextDeviceCredential = String(json?.data?.device?.credential || "");
      const nextIsAdmin = isAdminUser(nextUser || null);

      if (
        !nextToken ||
        !nextUser ||
        !nextDeviceCredential ||
        (!nextIsAdmin && !nextUser.employee)
      ) {
        throw new Error(T.needEmployeeLogin);
      }

      setAuthToken(nextToken);
      setAuthUser(nextUser);
      setDeviceCredential(nextDeviceCredential);
      setLoginPassword("");
      await writeStoredValue(API_BASE_URL_KEY, apiBaseUrl);
      await writeStoredValue(AUTH_TOKEN_KEY, nextToken);
      await writeStoredValue(AUTH_USER_KEY, JSON.stringify(nextUser));
      await writeStoredValue(DEVICE_CREDENTIAL_KEY, nextDeviceCredential);
      showToast(T.loginOk, "success");
      if (nextUser.employee && !nextUser.mustChangePassword) {
        await loadEmployeeSummary(nextToken);
      }

      if (nextUser.mustChangePassword) {
        setScreen("connect");
      } else if (pendingAttendanceToken && nextUser.employee) {
        await submitAttendanceQrRef.current?.(
          pendingAttendanceToken,
          nextToken,
        );
        setPendingAttendanceToken("");
        setScreen("attendance");
      } else {
        setScreen(nextIsAdmin ? "reports" : "connect");
      }
    } catch (error: any) {
      showToast(error?.message || T.loginFail, "error");
    } finally {
      setIsAuthBusy(false);
    }
  }, [
    getApiBaseUrl,
    deviceId,
    loadEmployeeSummary,
    loginPassword,
    loginUsername,
    pendingAttendanceToken,
    showToast,
  ]);

  const logoutEmployee = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();
    if (apiBaseUrl && authToken) {
      try {
        await operationFetch(`${apiBaseUrl}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // Local logout must still complete when the server is unreachable.
      }
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setAuthToken(null);
    setAuthUser(null);
    setDeviceCredential(null);
    setEmployeeSummary(null);
    setLoginPassword("");
    setConnection(null);
    setCart([]);
    setIsSocketConnected(false);
    setStatusText(T.ready);
    setScreen("login");
    await Promise.all([
      deleteStoredValue(AUTH_TOKEN_KEY),
      deleteStoredValue(AUTH_USER_KEY),
      deleteStoredValue(DEVICE_CREDENTIAL_KEY),
    ]);
    setCameraMode(null);
    showToast(T.logout, "info");
  }, [authToken, getApiBaseUrl, showToast]);

  const changeInitialPassword = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl || !authToken || !authUser) return;
    if (newPassword.length < 8) {
      showToast(T.passwordTooShort, "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast(T.passwordMismatch, "error");
      return;
    }

    setIsAuthBusy(true);
    try {
      const response = await operationFetch(`${apiBaseUrl}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.message || T.loginFail);
      const nextUser: EmployeeUser = {
        ...authUser,
        ...(json?.data?.user || {}),
        mustChangePassword: false,
      };
      setAuthUser(nextUser);
      await writeStoredValue(AUTH_USER_KEY, JSON.stringify(nextUser));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast(json?.message || T.changePassword, "success");
      if (nextUser.employee) await loadEmployeeSummary(authToken);
      setScreen(isAdminUser(nextUser) ? "reports" : "connect");
    } catch (error: any) {
      showToast(error?.message || T.loginFail, "error");
    } finally {
      setIsAuthBusy(false);
    }
  }, [
    authToken,
    authUser,
    confirmPassword,
    currentPassword,
    getApiBaseUrl,
    loadEmployeeSummary,
    newPassword,
    showToast,
  ]);

  const submitAttendanceQr = useCallback(
    async (
      raw: string,
      tokenOverride?: string,
      intentOverride?: AttendanceIntent,
    ) => {
      const tokenValue = tokenOverride || authToken;
      const payload = parseAttendanceQrPayload(raw);
      const attendanceToken = payload.token.trim();
      const apiBaseUrl = payload.apiBaseUrl || getApiBaseUrl();

      if (!apiBaseUrl) {
        showToast(T.needConnectionForLogin, "error");
        return;
      }

      if (!tokenValue) {
        showToast(T.needEmployeeLogin, "error");
        return;
      }

      if (!deviceId) {
        showToast(T.deviceNotReady, "error");
        return;
      }

      if (!deviceCredential) {
        showToast(T.deviceLoginRequired, "error");
        return;
      }

      if (payload.apiBaseUrl) {
        setServerApiBaseUrl(payload.apiBaseUrl);
        await writeStoredValue(API_BASE_URL_KEY, payload.apiBaseUrl);
      }

      if (!attendanceToken) {
        showToast(T.invalidAttendanceQr, "error");
        return;
      }

      if (attendanceLockRef.current) {
        return;
      }

      attendanceLockRef.current = true;
      setIsAttendanceBusy(true);

      try {
        const response = await operationFetch(`${apiBaseUrl}/api/attendance/scan-auth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenValue}`,
            "x-device-credential": deviceCredential,
          },
          body: JSON.stringify({
            token: attendanceToken,
            intent: intentOverride || attendanceIntent,
            deviceId,
          }),
        });
        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || T.invalidAttendanceQr);
        }

        const action = json?.data?.action;
        const message =
          action === "CHECK_IN"
            ? T.checkInOk
            : action === "CHECK_OUT"
              ? T.checkOutOk
              : action === "ALREADY_DONE"
                ? T.attendanceDone
                : json?.data?.message || T.attendance;

        setCameraMode(null);
        showToast(message, "success");
        vibrateSuccess();
        await loadEmployeeSummary(tokenValue);
      } catch (error: any) {
        showToast(error?.message || T.invalidAttendanceQr, "error");
      } finally {
        setIsAttendanceBusy(false);
        setTimeout(() => {
          attendanceLockRef.current = false;
        }, 1200);
      }
    },
    [
      attendanceIntent,
      authToken,
      deviceId,
      deviceCredential,
      getApiBaseUrl,
      loadEmployeeSummary,
      showToast,
    ],
  );

  submitAttendanceQrRef.current = submitAttendanceQr;

  const applyServerCart = useCallback((serverCart: any) => {
    const serverItems = Array.isArray(serverCart?.items)
      ? serverCart.items
      : [];

    const nextCart: CartItem[] = serverItems.map((item: any) => ({
      key: String(item.key || `${item.productId}:${item.unitId}`),
      productId: String(item.productId || ""),
      productName: String(item.productName || ""),
      barcode: String(item.barcode || ""),
      unitName: String(item.unitName || T.unit),
      unitPrice: Number(item.unitPrice || 0),
      quantity: Number(item.quantity || 0),
      lineTotal: Number(item.lineTotal || 0),
      expiryDate: item.expiryDate || null,
    }));

    setCart(nextCart);
  }, []);
  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setIsSocketConnected(false);
  }, []);

  const addScannedProductToCart = useCallback(
    (payload: any) => {
      if (!payload?.product) {
        return;
      }

      const product = payload.product;
      const totalStock = Number(payload.totalStock || 0);
      const recommendedLot = payload.recommendedLot || null;

      if (!recommendedLot || totalStock <= 0) {
        setStatusText(`${T.outOfStockPrefix}${product.name}`);
        showToast(`${T.outOfStockPrefix}${product.name}`, "error");
        return;
      }

      setStatusText(`${T.addedPrefix}${product.name}`);
      showToast(`${product.name}${T.addedSuffix}`, "success");
      vibrateSuccess();

      // Cart content is synced from the server via CART_UPDATED.
      return;

      const defaultSaleUnit =
        payload.defaultSaleUnit ||
        (product.units || []).find((item: any) => item.isDefaultSale) ||
        (product.units || [])[0] ||
        null;

      const unitId = defaultSaleUnit?.unitId || product.baseUnitId || "unit";
      const unitName =
        defaultSaleUnit?.unit?.shortName ||
        defaultSaleUnit?.unit?.name ||
        product.baseUnit?.shortName ||
        product.baseUnit?.name ||
        T.unit;

      const unitPrice = Number(defaultSaleUnit?.salePrice || 0);
      const key = `${product.id}:${unitId}`;

      setCart((prev) => {
        const exists = prev.find((item) => item.key === key);

        if (exists) {
          return prev.map((item) => {
            if (item.key !== key) {
              return item;
            }

            const quantity = item.quantity + 1;

            return {
              ...item,
              quantity,
              lineTotal: quantity * item.unitPrice,
            };
          });
        }

        return [
          {
            key,
            productId: product.id,
            productName: product.name,
            barcode: product.barcode || "",
            unitName,
            unitPrice,
            quantity: 1,
            lineTotal: unitPrice,
            expiryDate: recommendedLot?.expiryDate || null,
          },
          ...prev,
        ];
      });

      setStatusText(`${T.addedPrefix}${product.name}`);
      showToast(`${product.name}${T.addedSuffix}`, "success");
      vibrateSuccess();
    },
    [showToast],
  );

  const connectWebSocket = useCallback(
    (nextConnection: PosConnection) => {
      closeSocket();

      setStatusText(T.connecting);

      const ws = new WebSocket(nextConnection.webSocketUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsSocketConnected(true);
        setStatusText(T.connected);
        showToast(T.connectedToast, "success");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "CONNECTED") {
            setIsSocketConnected(true);
            return;
          }

          if (message.type === "CART_UPDATED") {
            applyServerCart(message.payload?.cart);
            return;
          }

          if (message.type === "BARCODE_SCANNED") {
            addScannedProductToCart(message.payload);
            return;
          }

          if (message.type === "SCAN_ERROR") {
            const msg = message.payload?.message || T.scanFail;
            setStatusText(msg);
            showToast(msg, "error");
          }
        } catch {
          // ignore invalid websocket payload
        }
      };

      ws.onerror = () => {
        setIsSocketConnected(false);
        setStatusText(T.wsError);
      };

      ws.onclose = () => {
        setIsSocketConnected(false);
        setStatusText(T.lost);

        if (connectionRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            if (connectionRef.current) {
              connectWebSocket(connectionRef.current);
            }
          }, 1800);
        }
      };
    },
    [addScannedProductToCart, closeSocket, showToast],
  );

  const disconnectSession = useCallback(() => {
    closeSocket();
    setConnection(null);
    setScreen("connect");
    setCameraMode(null);
    setCart([]);
    setStatusText(T.ready);
    qrLockRef.current = false;
    activeVisibleCodesRef.current.clear();
    lastSeenCodesRef.current.clear();
    showToast(T.disconnectToast, "info");
  }, [closeSocket, showToast]);

  const parseConnectionPayload = useCallback(
    (raw: string): PosConnection | null => {
      try {
        const parsed = JSON.parse(raw);

        if (!parsed?.sessionId || !parsed?.apiBaseUrl) {
          return null;
        }

        const apiBaseUrl = trimEndSlash(String(parsed.apiBaseUrl));
        const sessionId = String(parsed.sessionId);
        const url = new URL(apiBaseUrl);
        const wsProtocol = url.protocol === "https:" ? "wss" : "ws";

        return {
          sessionId,
          apiBaseUrl,
          webSocketUrl:
            parsed.webSocketUrl ||
            `${wsProtocol}://${url.hostname}:4001?sessionId=${encodeURIComponent(
              sessionId,
            )}&clientType=mobile`,
          scanHttpUrl: parsed.scanHttpUrl || `${apiBaseUrl}/api/pos/scan`,
        };
      } catch {
        return null;
      }
    },
    [],
  );

  const handleConnectionQr = useCallback(
    (raw: string) => {
      if (qrLockRef.current) {
        return;
      }

      const nextConnection = parseConnectionPayload(raw);

      if (!nextConnection) {
        showToast(T.invalidQr, "error");
        setStatusText(T.invalidQr);
        return;
      }

      qrLockRef.current = true;

      setConnection(nextConnection);
      setServerApiBaseUrl(nextConnection.apiBaseUrl);
      void writeStoredValue(API_BASE_URL_KEY, nextConnection.apiBaseUrl);
      setStatusText(T.qrReceived);
      setCameraMode("product");
      setScreen("scanner");
      connectWebSocket(nextConnection);
      showToast(T.qrRead, "success");
    },
    [connectWebSocket, parseConnectionPayload, showToast],
  );

  const sendProductBarcode = useCallback(
    async (barcode: string) => {
      const current = connectionRef.current;

      if (!current) {
        showToast(T.needPos, "error");
        return;
      }

      try {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "SCAN_BARCODE",
              barcode,
            }),
          );

          return;
        }

        const response = await operationFetch(current.scanHttpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: current.sessionId,
            barcode,
          }),
        });

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || json?.error?.message || T.scanFail);
        }

        if (json?.data?.cart) {
          applyServerCart(json.data.cart);
        }

        if (json?.data) {
          addScannedProductToCart(json.data);
        }
      } catch (error: any) {
        showToast(error?.message || T.sendError, "error");
        activeVisibleCodesRef.current.delete(barcode);
        lastSeenCodesRef.current.delete(barcode);
      }
    },
    [addScannedProductToCart, showToast],
  );

  const requestCameraAndToggle = useCallback(
    async (mode: "connect" | "product" | "attendance") => {
      if (!permission?.granted) {
        const res = await requestPermission();

        if (!res.granted) {
          Alert.alert(T.needCameraTitle, T.needCamera);
          return;
        }
      }

      setCameraMode((prev) => (prev === mode ? null : mode));
    },
    [permission?.granted, requestPermission],
  );

  const handleBarcodeScanned = useCallback(
    async (event: any) => {
      const raw = String(event?.data || "").trim();

      if (!raw) {
        return;
      }

      if (cameraMode === "connect") {
        handleConnectionQr(raw);
        return;
      }

      if (cameraMode === "attendance") {
        if (attendanceLockRef.current) {
          return;
        }

        if (!authToken) {
          const payload = parseAttendanceQrPayload(raw);
          attendanceLockRef.current = true;
          if (payload.apiBaseUrl) {
            setServerApiBaseUrl(payload.apiBaseUrl);
            await writeStoredValue(API_BASE_URL_KEY, payload.apiBaseUrl);
          }
          setPendingAttendanceToken(payload.token);
          setCameraMode(null);
          showToast(T.attendanceQrReady, "success");
          setTimeout(() => {
            attendanceLockRef.current = false;
          }, 1200);
          return;
        }

        await submitAttendanceQr(raw);
        return;
      }

      if (cameraMode !== "product") {
        return;
      }

      const now = Date.now();
      lastSeenCodesRef.current.set(raw, now);

      if (activeVisibleCodesRef.current.has(raw)) {
        return;
      }

      activeVisibleCodesRef.current.add(raw);
      await sendProductBarcode(raw);
    },
    [
      authToken,
      cameraMode,
      handleConnectionQr,
      sendProductBarcode,
      showToast,
      submitAttendanceQr,
    ],
  );

  useEffect(() => {
    if (
      authToken &&
      authUser?.employee &&
      (connection?.apiBaseUrl || serverApiBaseUrl.trim())
    ) {
      loadEmployeeSummary(authToken);
    }
  }, [
    authToken,
    authUser?.employee,
    connection?.apiBaseUrl,
    loadEmployeeSummary,
    serverApiBaseUrl,
  ]);

  useEffect(() => {
    if (screen === "reports" && authToken) {
      loadDashboardSummary(dashboardPeriod, authToken);
    }
  }, [authToken, dashboardPeriod, loadDashboardSummary, screen]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      for (const [code, lastSeen] of lastSeenCodesRef.current.entries()) {
        if (now - lastSeen > 1200) {
          lastSeenCodesRef.current.delete(code);
          activeVisibleCodesRef.current.delete(code);
        }
      }
    }, 400);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      closeSocket();
    };
  }, [closeSocket]);

  const itemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const totalPrice = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [cart]);

  const hasCheckedInToday = Boolean(employeeSummary?.todayRecord?.checkInAt);
  const hasCheckedOutToday = Boolean(employeeSummary?.todayRecord?.checkOutAt);
  const canStartWork = !hasCheckedInToday;
  const canEndWork = hasCheckedInToday && !hasCheckedOutToday;
  const canViewReports = isAdminUser(authUser);

  const recentItems = useMemo(() => cart.slice(0, 6), [cart]);

  const clearCart = useCallback(async () => {
    const current = connectionRef.current;

    try {
      if (current && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "CLEAR_CART" }));
        setCart([]);
        showToast(T.cartCleared, "info");
        return;
      }

      if (current) {
        const response = await operationFetch(
          `${current.apiBaseUrl}/api/pos/sessions/${current.sessionId}/cart`,
          {
            method: "DELETE",
          },
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || T.sendError);
        }

        applyServerCart(json?.data?.cart);
        showToast(T.cartCleared, "info");
        return;
      }

      setCart([]);
      showToast(T.cartCleared, "info");
    } catch (error: any) {
      setCart([]);
      showToast(error?.message || T.sendError, "error");
    }
  }, [applyServerCart, showToast]);

  const goToConnect = useCallback(() => {
    setScreen("connect");
    setCameraMode(null);
    qrLockRef.current = false;
  }, []);

  const goToScanner = useCallback(() => {
    setScreen("scanner");
    setCameraMode(null);
  }, []);

  const goToAttendance = useCallback(() => {
    setScreen("attendance");
    setCameraMode(null);
    if (authToken) {
      loadEmployeeSummary(authToken);
    }
  }, [authToken, loadEmployeeSummary]);

  const goToReports = useCallback(() => {
    if (!isAdminUser(authUser)) {
      showToast(T.reportsError, "error");
      return;
    }

    setScreen("reports");
    setCameraMode(null);
    if (authToken) {
      loadDashboardSummary(dashboardPeriod, authToken);
    }
  }, [authToken, authUser, dashboardPeriod, loadDashboardSummary, showToast]);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={styles.root} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        {authUser?.mustChangePassword ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.header}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.title}>{T.changePasswordTitle}</Text>
              <Text style={styles.subtitle}>{T.changePasswordHint}</Text>
            </View>

            <View style={styles.mainCard}>
              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder={T.currentPassword}
                placeholderTextColor={COLORS.textSoft}
                secureTextEntry
                style={styles.input}
                textAlign="right"
              />
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder={T.newPassword}
                placeholderTextColor={COLORS.textSoft}
                secureTextEntry
                style={styles.input}
                textAlign="right"
              />
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={T.confirmPassword}
                placeholderTextColor={COLORS.textSoft}
                secureTextEntry
                style={styles.input}
                textAlign="right"
              />
              <TouchableOpacity
                style={[styles.primaryButton, isAuthBusy && styles.disabledButton]}
                disabled={isAuthBusy}
                onPress={changeInitialPassword}
              >
                <Text style={styles.primaryButtonText}>
                  {isAuthBusy ? T.connecting : T.changePassword}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineButton} onPress={logoutEmployee}>
                <Text style={styles.ghostButtonText}>{T.logout}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : screen === "login" ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.header}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.eyebrow}>MUHASEB MOBILE</Text>
              <Text style={styles.title}>{T.employeeLoginTitle}</Text>
              <Text style={styles.subtitle}>{T.attendanceSub}</Text>
            </View>

            <View style={styles.mainCard}>
              {/* <View style={styles.logoTile}>
                <Image
                  source={APP_LOGO}
                  style={styles.cardLogo}
                  resizeMode="contain"
                />
              </View>

              <Text style={styles.cardTitle}>{T.employeeLogin}</Text>
              <Text style={styles.cardText}>{T.attendanceSub}</Text> */}

              {serverApiBaseUrl ? (
                <View style={styles.detectedBadge}>
                  <Text style={styles.detectedBadgeText}>
                    {T.serverDetected}
                  </Text>
                </View>
              ) : null}

              <TextInput
                value={loginUsername}
                onChangeText={setLoginUsername}
                placeholder={T.username}
                placeholderTextColor={COLORS.textSoft}
                autoCapitalize="none"
                style={styles.input}
                textAlign="right"
              />
              <TextInput
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder={T.password}
                placeholderTextColor={COLORS.textSoft}
                secureTextEntry
                style={styles.input}
                textAlign="right"
              />

              <TouchableOpacity
                style={styles.outlineButton}
                onPress={openServerSettings}
              >
                <Text style={styles.ghostButtonText}>{T.serverSettings}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.primaryButton}
                disabled={isAuthBusy}
                onPress={loginEmployee}
              >
                <Text style={styles.primaryButtonText}>
                  {isAuthBusy ? T.connecting : T.login}
                </Text>
              </TouchableOpacity>

              {/* <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>{T.status}</Text>
                <Text style={styles.statusValue}>
                  {serverApiBaseUrl
                    ? T.serverDetected
                    : T.needConnectionForLogin}
                </Text>
              </View> */}
            </View>
          </ScrollView>
        ) : screen === "connect" ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.topBar}>
              {authUser?.employee ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToAttendance}
                >
                  <Text style={styles.ghostButtonText}>{T.attendance}</Text>
                </TouchableOpacity>
              ) : null}

              {canViewReports ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToReports}
                >
                  <Text style={styles.ghostButtonText}>{T.reports}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={openServerSettings}
              >
                <Text style={styles.ghostButtonText}>{T.serverSettings}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={logoutEmployee}
              >
                <Text style={styles.ghostButtonText}>{T.logout}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.header}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.eyebrow}>MUHASEB POS</Text>
              {/* <Text style={styles.title}>{T.connectTitle}</Text> */}
              {/* <Text style={styles.subtitle}>{T.connectSub}</Text> */}
            </View>

            <View style={styles.mainCard}>
              {/* <View style={styles.logoTile}>
                <Image
                  source={APP_LOGO}
                  style={styles.cardLogo}
                  resizeMode="contain"
                />
              </View>

              <Text style={styles.cardTitle}>{T.connectCardTitle}</Text>
              <Text style={styles.cardText}>{T.rtlIntro}</Text>
              <Text style={styles.cardSmall}>{T.manualRemoved}</Text> */}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => requestCameraAndToggle("connect")}
              >
                <Text style={styles.primaryButtonText}>
                  {cameraMode === "connect" ? T.closeCamera : T.scanQr}
                </Text>
              </TouchableOpacity>

              {authUser?.employee ? (
                <TouchableOpacity
                  style={styles.outlineButton}
                  onPress={goToAttendance}
                >
                  <Text style={styles.ghostButtonText}>{T.attendance}</Text>
                </TouchableOpacity>
              ) : null}

              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>{T.status}</Text>
                <Text style={styles.statusValue}>{statusText}</Text>
              </View>
            </View>

            {cameraMode === "connect" ? (
              <View style={styles.cameraCard}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={handleBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: ["qr"],
                  }}
                />
                <View style={styles.cameraOverlay}>
                  <View style={styles.scanFrameSquare} />
                  <Text style={styles.cameraHint}>{T.qrHint}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : screen === "attendance" ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={goToScanner}
              >
                <Text style={styles.ghostButtonText}>{T.productScanner}</Text>
              </TouchableOpacity>

              {canViewReports ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToReports}
                >
                  <Text style={styles.ghostButtonText}>{T.reports}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={openServerSettings}
              >
                <Text style={styles.ghostButtonText}>{T.serverSettings}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={logoutEmployee}
              >
                <Text style={styles.ghostButtonText}>{T.logout}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerCompact}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogoSmall}
                resizeMode="contain"
              />
              <Text style={styles.eyebrow}>MUHASEB ATTENDANCE</Text>
              <Text style={styles.titleSmall}>{T.attendanceTitle}</Text>
              <Text style={styles.subtitle}>{T.attendanceSub}</Text>
            </View>

            <>
              {authUser?.employee ? (
                <View style={styles.profileCard}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {authUser.employee.fullName.slice(0, 1)}
                    </Text>
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={styles.statusLabel}>{T.loggedInAs}</Text>
                    <Text style={styles.cardTitle}>
                      {authUser.employee.fullName}
                    </Text>
                    <Text style={styles.cardText}>
                      {authUser.employee.position ||
                        authUser.role ||
                        authUser.username}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.cartCard}>
                <Text style={styles.cardTitle}>{T.summary}</Text>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryLabel}>{T.present}</Text>
                    <Text style={styles.summaryValue}>
                      {employeeSummary?.summary?.presentDays || 0}
                    </Text>
                  </View>
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryLabel}>{T.halfPresent}</Text>
                    <Text style={styles.summaryValue}>
                      {employeeSummary?.summary?.halfDays || 0}
                    </Text>
                  </View>
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryLabel}>{T.absent}</Text>
                    <Text style={styles.summaryValue}>
                      {employeeSummary?.summary?.absentDays || 0}
                    </Text>
                  </View>
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryLabel}>{T.overtime}</Text>
                    <Text style={styles.summaryValue}>
                      {money(employeeSummary?.summary?.overtimeHours || 0)}
                    </Text>
                  </View>
                </View>

                <View style={styles.payrollStrip}>
                  <View style={styles.payrollItem}>
                    <Text style={styles.summaryLabel}>{T.salary}</Text>
                    <Text style={styles.payrollValue}>
                      {money(
                        employeeSummary?.summary?.monthlySalary ||
                          authUser?.employee?.monthlySalary ||
                          0,
                      )}
                    </Text>
                  </View>
                  <View style={styles.payrollItem}>
                    <Text style={styles.summaryLabel}>{T.paid}</Text>
                    <Text style={styles.payrollValue}>
                      {money(
                        employeeSummary?.summary?.latestPayroll?.paidAmount ||
                          0,
                      )}
                    </Text>
                  </View>
                  <View style={styles.payrollItem}>
                    <Text style={styles.summaryLabel}>{T.remaining}</Text>
                    <Text style={styles.payrollValue}>
                      {money(
                        employeeSummary?.summary?.latestPayroll
                          ?.remainingAmount || 0,
                      )}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.attendanceActions}>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    !canStartWork ? styles.disabledButton : null,
                  ]}
                  disabled={!canStartWork || isAttendanceBusy}
                  onPress={() => {
                    setAttendanceIntent("CHECK_IN");
                    requestCameraAndToggle("attendance");
                  }}
                >
                  <Text style={styles.primaryButtonText}>
                    {canStartWork ? T.startWork : T.alreadyStarted}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.secondaryButtonFull,
                    !canEndWork ? styles.disabledButton : null,
                  ]}
                  disabled={!canEndWork || isAttendanceBusy}
                  onPress={() => {
                    setAttendanceIntent("CHECK_OUT");
                    requestCameraAndToggle("attendance");
                  }}
                >
                  <Text style={styles.buttonText}>
                    {hasCheckedOutToday
                      ? T.workFinished
                      : canEndWork
                        ? T.endWork
                        : T.startFirst}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cameraCardLarge}>
                {cameraMode === "attendance" ? (
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    onBarcodeScanned={handleBarcodeScanned}
                    barcodeScannerSettings={{
                      barcodeTypes: ["qr"],
                    }}
                  />
                ) : (
                  <View style={styles.cameraOff}>
                    <Text style={styles.cameraOffTitle}>
                      {T.chooseAttendanceAction}
                    </Text>
                    <Text style={styles.cameraOffText}>{T.attendanceSub}</Text>
                  </View>
                )}

                <View style={styles.cameraOverlay}>
                  <View style={styles.scanFrameSquare} />
                  <Text style={styles.cameraHint}>{T.attendanceQrHint}</Text>
                </View>
              </View>

              {cameraMode === "attendance" ? (
                <TouchableOpacity
                  style={styles.redButtonFull}
                  disabled={isAttendanceBusy}
                  onPress={() => setCameraMode(null)}
                >
                  <Text style={styles.buttonText}>
                    {isAttendanceBusy ? T.connecting : T.closeCamera}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          </ScrollView>
        ) : screen === "reports" && canViewReports ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={goToConnect}
              >
                <Text style={styles.ghostButtonText}>{T.connectBack}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={goToScanner}
              >
                <Text style={styles.ghostButtonText}>{T.productScanner}</Text>
              </TouchableOpacity>

              {authUser?.employee ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToAttendance}
                >
                  <Text style={styles.ghostButtonText}>{T.attendance}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={openServerSettings}
              >
                <Text style={styles.ghostButtonText}>{T.serverSettings}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerCompact}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogoSmall}
                resizeMode="contain"
              />
              <Text style={styles.eyebrow}>MUHASEB REPORTS</Text>
              <Text style={styles.titleSmall}>{T.reportsTitle}</Text>
              <Text style={styles.subtitle}>{T.reportsSub}</Text>
            </View>

            <View style={styles.periodTabs}>
              {DASHBOARD_PERIODS.map((period) => {
                const isActive = dashboardPeriod === period.key;

                return (
                  <TouchableOpacity
                    key={period.key}
                    style={[
                      styles.periodTab,
                      isActive ? styles.periodTabActive : null,
                    ]}
                    onPress={() => setDashboardPeriod(period.key)}
                  >
                    <Text
                      style={[
                        styles.periodTabText,
                        isActive ? styles.periodTabTextActive : null,
                      ]}
                    >
                      {period.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.reportHeaderCard}>
              <View style={styles.rtlFlex}>
                <Text style={styles.cardTitle}>{T.reportsTitle}</Text>
                <Text style={styles.cardText}>
                  {isReportsLoading
                    ? T.loadingReports
                    : `${dashboardSummary?.currency?.displayCode || "AFN"} · ${
                        DASHBOARD_PERIODS.find(
                          (item) => item.key === dashboardPeriod,
                        )?.label || T.today
                      }`}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.smallActionButton}
                disabled={isReportsLoading}
                onPress={() => loadDashboardSummary(dashboardPeriod)}
              >
                <Text style={styles.smallActionButtonText}>
                  {T.refresh}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.reportGrid}>
              {getDashboardCards(dashboardSummary).map((card) => (
                <View
                  key={card.key}
                  style={[
                    styles.reportMetricCard,
                    card.tone === "success"
                      ? styles.reportMetricSuccess
                      : card.tone === "error"
                        ? styles.reportMetricError
                        : card.tone === "warning"
                          ? styles.reportMetricWarning
                          : card.tone === "purple"
                            ? styles.reportMetricPurple
                            : styles.reportMetricBlue,
                  ]}
                >
                  <Text style={styles.reportMetricLabel}>{card.label}</Text>
                  <Text style={styles.reportMetricValue}>
                    {money(
                      card.value,
                      dashboardSummary?.currency?.displayCode || "AFN",
                    )}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={goToConnect}
              >
                <Text style={styles.ghostButtonText}>{T.connectBack}</Text>
              </TouchableOpacity>

              {authUser?.employee ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToAttendance}
                >
                  <Text style={styles.ghostButtonText}>{T.attendance}</Text>
                </TouchableOpacity>
              ) : null}

              {canViewReports ? (
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={goToReports}
                >
                  <Text style={styles.ghostButtonText}>{T.reports}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={openServerSettings}
              >
                <Text style={styles.ghostButtonText}>{T.serverSettings}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={logoutEmployee}
              >
                <Text style={styles.ghostButtonText}>{T.logout}</Text>
              </TouchableOpacity>

              <View
                style={[
                  styles.connectionPill,
                  {
                    borderColor: isSocketConnected
                      ? COLORS.success
                      : COLORS.warning,
                  },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: isSocketConnected
                        ? COLORS.success
                        : COLORS.warning,
                    },
                  ]}
                />
                <Text style={styles.connectionText}>
                  {isSocketConnected ? T.on : T.off}
                </Text>
              </View>
            </View>

            <View style={styles.headerCompact}>
              <Image
                source={APP_LOGO}
                style={styles.headerLogoSmall}
                resizeMode="contain"
              />
              <Text style={styles.eyebrow}>MUHASEB SCANNER</Text>
              <Text style={styles.titleSmall}>{T.scanProductTitle}</Text>
              <Text style={styles.subtitle}>{statusText}</Text>
            </View>

            <View style={styles.cameraCardLarge}>
              {cameraMode === "product" ? (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={handleBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      "ean13",
                      "ean8",
                      "upc_a",
                      "upc_e",
                      "code128",
                      "code39",
                      "code93",
                      "codabar",
                      "itf14",
                    ],
                  }}
                />
              ) : (
                <View style={styles.cameraOff}>
                  <Text style={styles.cameraOffTitle}>{T.cameraOffTitle}</Text>
                  <Text style={styles.cameraOffText}>{T.cameraOffText}</Text>
                </View>
              )}

              <View style={styles.cameraOverlay}>
                <View style={styles.scanFrameWide} />
                <Text style={styles.cameraHint}>{T.productHint}</Text>
              </View>
            </View>

            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => requestCameraAndToggle("product")}
              >
                <Text style={styles.buttonText}>
                  {getScanButtonTitle(cameraMode)}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.redButton}
                onPress={disconnectSession}
              >
                <Text style={styles.buttonText}>{T.disconnect}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cartCard}>
              <View style={styles.cartHeader}>
                <View style={styles.rtlFlex}>
                  <Text style={styles.cardTitle}>{T.cartTitle}</Text>
                  <Text style={styles.cardText}>{T.cartSub}</Text>
                </View>

                <TouchableOpacity onPress={clearCart}>
                  <Text style={styles.clearText}>{T.clear}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>{T.items}</Text>
                  <Text style={styles.summaryValue}>{itemsCount}</Text>
                </View>

                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>{T.total}</Text>
                  <Text style={styles.summaryValue}>{money(totalPrice)}</Text>
                </View>
              </View>

              {recentItems.length ? (
                <View style={styles.itemsList}>
                  {recentItems.map((item) => (
                    <View style={styles.itemRow} key={item.key}>
                      <View style={styles.itemPriceBox}>
                        <Text style={styles.itemPrice}>
                          {money(item.lineTotal)}
                        </Text>
                      </View>

                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.productName}</Text>
                        <Text style={styles.itemMeta}>
                          {item.unitName} {item.quantity}
                        </Text>
                      </View>

                      <View style={styles.itemIcon}>
                        <Text style={styles.itemIconText}></Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>{T.empty}</Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}

        <Modal
          animationType="fade"
          transparent
          visible={serverSettingsOpen}
          onRequestClose={() => setServerSettingsOpen(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalAvoider}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          >
            <View style={styles.modalBackdrop}>
            <View style={styles.serverModal}>
              <Text style={styles.cardTitle}>{T.serverSettingsTitle}</Text>
              <Text style={styles.cardText}>{T.serverSettingsSub}</Text>

              <TextInput
                value={serverSettingsValue}
                onChangeText={setServerSettingsValue}
                placeholder={T.serverAddressHint}
                placeholderTextColor={COLORS.textSoft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
                textAlign="left"
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setServerSettingsOpen(false)}
                >
                  <Text style={styles.buttonText}>{T.cancel}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.primaryButtonCompact}
                  onPress={saveServerSettings}
                >
                  <Text style={styles.primaryButtonText}>{T.save}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>

        <View style={styles.toastWrap}>
          {toasts.map((toast) => (
            <View
              key={toast.id}
              style={[
                styles.toast,
                toast.type === "success"
                  ? { borderColor: COLORS.success }
                  : toast.type === "error"
                    ? { borderColor: COLORS.error }
                    : { borderColor: COLORS.blue },
              ]}
            >
              <Text style={styles.toastText}>{toast.message}</Text>
            </View>
          ))}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
  },
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 140,
    display: "flex",
    justifyContent: "center",
    gap: 58,
  },
  rtlFlex: {
    flex: 1,
    alignItems: "flex-end",
  },
  header: {
    alignItems: "center",
    marginBottom: 18,
  },
  headerCompact: {
    alignItems: "center",
    marginBottom: 14,
  },
  headerLogo: {
    width: 88,
    height: 88,
    marginBottom: 10,
  },
  headerLogoSmall: {
    width: 56,
    height: 56,
    marginBottom: 8,
  },
  eyebrow: {
    fontFamily: FONT_BOLD,
    color: COLORS.cyan,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: "right",
    writingDirection: "rtl",
  },
  title: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 30,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8,
  },
  titleSmall: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 23,
    textAlign: "right",
    writingDirection: "rtl",
  },
  mainCard: {
    backgroundColor: COLORS.card,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 20,
    marginBottom: 18,
    alignItems: "center",
  },
  glowIcon: {
    width: 72,
    height: 72,
    borderRadius: 0,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.blue,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  glowIconText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.blue,
    fontSize: 20,
    fontWeight: "900",
  },
  logoTile: {
    width: 84,
    height: 84,
    borderRadius: 0,
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.blue,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  cardLogo: {
    width: 64,
    height: 64,
  },
  cardTitle: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8,
  },
  cardText: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 10,
  },
  cardSmall: {
    fontFamily: FONT_BOLD,
    color: COLORS.cyan,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 16,
  },
  input: {
    fontFamily: FONT_REGULAR,
    width: "100%",
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    color: COLORS.text,
    fontSize: 15,
    paddingHorizontal: 15,
    paddingVertical: 14,
    marginBottom: 12,
    writingDirection: "rtl",
  },
  primaryButton: {
    width: "100%",
    backgroundColor: COLORS.blue,
    borderRadius: 0,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  primaryButtonCompact: {
    flex: 1,
    backgroundColor: COLORS.blue,
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 7,
  },
  primaryButtonText: {
    fontFamily: FONT_HEAVY,
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.purple,
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 7,
  },
  secondaryButtonFull: {
    width: "100%",
    backgroundColor: COLORS.purple,
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  redButtonFull: {
    width: "100%",
    backgroundColor: "#2B1320",
    borderWidth: 1,
    borderColor: "#5F2338",
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  disabledButton: {
    opacity: 0.45,
  },
  attendanceActions: {
    width: "100%",
  },
  outlineButton: {
    width: "100%",
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  redButton: {
    flex: 1,
    backgroundColor: "#2B1320",
    borderWidth: 1,
    borderColor: "#5F2338",
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7,
  },
  buttonText: {
    fontFamily: FONT_HEAVY,
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  statusCard: {
    width: "100%",
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    padding: 14,
    alignItems: "flex-end",
  },
  statusLabel: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6,
  },
  statusValue: {
    fontFamily: FONT_BOLD,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  detectedBadge: {
    width: "100%",
    backgroundColor: "rgba(34,197,94,0.14)",
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    alignItems: "center",
  },
  detectedBadgeText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.success,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  profileCard: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
  },
  avatarCircle: {
    width: 62,
    height: 62,
    borderRadius: 0,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.blue,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  avatarText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.blue,
    fontSize: 24,
    fontWeight: "900",
  },
  profileInfo: {
    flex: 1,
    alignItems: "flex-end",
  },
  cameraCard: {
    height: 360,
    overflow: "hidden",
    borderRadius: 0,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: COLORS.stroke,
    marginBottom: 18,
  },
  cameraCardLarge: {
    height: 390,
    overflow: "hidden",
    borderRadius: 0,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: COLORS.stroke,
    marginBottom: 18,
  },
  inlineCameraCard: {
    width: "100%",
    height: 280,
    overflow: "hidden",
    borderRadius: 0,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: COLORS.stroke,
    marginBottom: 14,
  },
  camera: {
    flex: 1,
  },
  cameraOff: {
    flex: 1,
    backgroundColor: "#050816",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  cameraOffTitle: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 8,
  },
  cameraOffText: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 14,
    textAlign: "center",
    writingDirection: "rtl",
    lineHeight: 22,
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrameSquare: {
    width: 230,
    height: 230,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent",
  },
  scanFrameSquareSmall: {
    width: 190,
    height: 190,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent",
  },
  scanFrameWide: {
    width: 285,
    height: 145,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent",
  },
  cameraHint: {
    fontFamily: FONT_HEAVY,
    position: "absolute",
    bottom: 22,
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
    backgroundColor: "rgba(8,14,30,0.78)",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 0,
  },
  topBar: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  ghostButton: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  ghostButtonText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  connectionPill: {
    flexDirection: "row-reverse",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 0,
    marginLeft: 8,
  },
  connectionText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  controlsRow: {
    flexDirection: "row-reverse",
    marginBottom: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalAvoider: {
    flex: 1,
  },
  serverModal: {
    width: "100%",
    backgroundColor: COLORS.card,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18,
  },
  modalActions: {
    flexDirection: "row-reverse",
    gap: 10,
    marginTop: 4,
  },
  cartCard: {
    backgroundColor: COLORS.card,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18,
  },
  cartHeader: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  clearText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.blue,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryRow: {
    flexDirection: "row-reverse",
    marginTop: 14,
    marginBottom: 16,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: COLORS.card2,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 16,
    marginHorizontal: 5,
    alignItems: "flex-end",
  },
  summaryGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    marginHorizontal: -5,
    marginTop: 8,
  },
  summaryTile: {
    width: "50%",
    paddingHorizontal: 5,
    marginBottom: 10,
  },
  summaryLabel: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8,
  },
  summaryValue: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  periodTabs: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  periodTab: {
    flexGrow: 1,
    minWidth: "45%",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  periodTabActive: {
    backgroundColor: COLORS.blue,
    borderColor: COLORS.blue,
  },
  periodTabText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.textSoft,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  periodTabTextActive: {
    color: "#fff",
  },
  reportHeaderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  smallActionButton: {
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 12,
  },
  smallActionButtonText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.cyan,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  reportGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    marginHorizontal: -5,
  },
  reportMetricCard: {
    width: "50%",
    minHeight: 118,
    borderRadius: 0,
    borderWidth: 1,
    backgroundColor: COLORS.card,
    padding: 13,
    marginBottom: 10,
    alignItems: "flex-end",
    justifyContent: "space-between",
    transform: [{ scale: 0.97 }],
  },
  reportMetricBlue: {
    borderColor: COLORS.blue,
  },
  reportMetricPurple: {
    borderColor: COLORS.purple,
  },
  reportMetricSuccess: {
    borderColor: COLORS.success,
  },
  reportMetricError: {
    borderColor: COLORS.error,
  },
  reportMetricWarning: {
    borderColor: COLORS.warning,
  },
  reportMetricLabel: {
    fontFamily: FONT_BOLD,
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  reportMetricValue: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  payrollStrip: {
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    padding: 12,
    marginTop: 4,
  },
  payrollItem: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
  },
  payrollValue: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "left",
  },
  itemsList: {
    marginTop: 2,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    padding: 13,
    marginBottom: 10,
  },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 0,
    backgroundColor: COLORS.bg2,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  itemIconText: {
    fontFamily: FONT_BOLD,
    color: COLORS.blue,
    fontSize: 16,
  },
  itemInfo: {
    flex: 1,
    alignItems: "flex-end",
  },
  itemName: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 4,
  },
  itemMeta: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  itemPriceBox: {
    minWidth: 74,
    alignItems: "flex-start",
  },
  itemPrice: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
  },
  emptyCard: {
    marginTop: 8,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 0,
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: FONT_REGULAR,
    color: COLORS.textSoft,
    textAlign: "center",
    writingDirection: "rtl",
  },
  toastWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 14,
  },
  toast: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 0,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  toastText: {
    fontFamily: FONT_HEAVY,
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
});
