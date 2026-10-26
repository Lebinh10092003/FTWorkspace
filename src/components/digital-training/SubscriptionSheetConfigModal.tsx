import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileCode,
  FileSpreadsheet,
  Key,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { appDialog } from "../AppDialog";

function buildAppsScriptCode(webhookUrl: string, webhookSecret: string): string {
  const syncUrl = webhookUrl.replace("/sheet-webhook", "/sheet-sync");
  return `/**
 * =======================================================================
 * FERMAT WORKSPACE - THEO DÕI DỊCH VỤ KHÁCH HÀNG & THỜI HẠN SỬ DỤNG
 * File Google Sheet: https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit
 *
 * TÍNH NĂNG CHÍNH:
 * 1. Khởi tạo khung bảng sạch 17 cột, đóng băng 2 hàng đầu, công thức STT tự động tại A3.
 * 2. Tự động gom nhóm các dịch vụ của cùng một khách hàng nằm sát cạnh nhau.
 * 3. Đồng bộ 2 chiều Web <-> Sheet qua Webhook & API (Bảo mật bằng WEBHOOK_SECRET).
 * 4. Menu "🚀 Fermat Workspace" trực tiếp trên giao diện Google Sheet.
 * =======================================================================
 */

var FIRST_DATA_ROW = 3;
var TAB_NAME = 'Dịch vụ khách hàng';
var WEBHOOK_URL_DEFAULT = '${webhookUrl}';
var SYNC_URL_DEFAULT = '${syncUrl}';
var WEBHOOK_SECRET_DEFAULT = '${webhookSecret}';

var HEADERS = [
  'STT',                       // A (1)
  'Mã ĐK',                     // B (2)
  'Mã KH',                     // C (3)
  'Tên trường / Đơn vị',       // D (4)
  'Tỉnh / Thành phố',          // E (5)
  'Đầu mối liên hệ',           // F (6)
  'Số điện thoại',             // G (7)
  'Dịch vụ / Sản phẩm',        // H (8)
  'Số lượng',                  // I (9)
  'Ngày bắt đầu',              // J (10)
  'Ngày hết hạn',              // K (11)
  'Còn lại (ngày)',            // L (12)
  'Tình trạng hạn',            // M (13)
  'Trạng thái',                // N (14)
  'Nhân sự phụ trách',         // O (15)
  'Tiến độ & Ghi chú gia hạn', // P (16)
  'Cập nhật web lúc',          // Q (17)
];

var COLUMN_WIDTHS = [
  55,   // A: STT
  70,   // B: Mã ĐK
  70,   // C: Mã KH
  280,  // D: Tên trường / Đơn vị
  120,  // E: Tỉnh / Thành phố
  160,  // F: Đầu mối liên hệ
  115,  // G: Số điện thoại
  180,  // H: Dịch vụ / Sản phẩm
  75,   // I: Số lượng
  105,  // J: Ngày bắt đầu
  105,  // K: Ngày hết hạn
  110,  // L: Còn lại (ngày)
  120,  // M: Tình trạng hạn
  125,  // N: Trạng thái
  140,  // O: Nhân sự phụ trách
  290,  // P: Tiến độ & Ghi chú gia hạn
  130,  // Q: Cập nhật web lúc
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 Fermat Workspace')
    .addItem('🧹 1. Khởi tạo khung bảng sạch (Xóa trắng & Setup)', 'initCleanSheetTemplate')
    .addItem('📥 2. Kéo dữ liệu từ Web về Sheet', 'pullDataFromWebAndSetupSheet')
    .addItem('📤 3. Đẩy tất cả dữ liệu Sheet lên Web', 'syncAllRowsToWeb')
    .addSeparator()
    .addItem('📊 4. Gom nhóm các dịch vụ cùng khách hàng', 'autoSortGroupPartners')
    .addItem('⚡ 5. Kích hoạt Trigger tự động (onEdit)', 'setupAutoTrigger')
    .addToUi();
}

function getWebhookUrl_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('WEBHOOK_URL') || WEBHOOK_URL_DEFAULT;
}

function getWebhookSecret_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('WEBHOOK_SECRET') || WEBHOOK_SECRET_DEFAULT || '';
}

function getSyncUrl_() {
  var webhook = getWebhookUrl_();
  return webhook.replace('/sheet-webhook', '/sheet-sync');
}

function initCleanSheetTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  
  if (sheet.getName() === 'Trang tính1' || sheet.getName() === 'Sheet1') {
    try { sheet.setName(TAB_NAME); } catch (e) {}
  }

  var numCols = HEADERS.length;

  sheet.clearContents();
  sheet.clearFormats();
  var existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  sheet.setFrozenColumns(0);
  sheet.setFrozenRows(2);

  sheet.setRowHeight(1, 38);
  sheet.setRowHeight(2, 34);
  for (var r = 3; r <= 30; r++) sheet.setRowHeight(r, 28);
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);

  var titleRow = ["FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG"];
  for (var i = 1; i < numCols; i++) titleRow.push("");
  sheet.getRange(1, 1, 1, numCols).setValues([titleRow]);
  
  var banner = sheet.getRange(1, 1, 1, numCols);
  banner.merge().setBackground('#1D4ED8').setFontColor('#FFFFFF').setFontSize(12).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  sheet.getRange(2, 1, 1, numCols).setValues([HEADERS]);
  sheet.getRange(2, 1, 1, numCols)
    .setBackground('#DBEAFE').setFontColor('#1E3A8A').setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true)
    .setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange('A3').setFormula('=ARRAYFORMULA(IF(D3:D=""; ""; COUNTIFS(D3:D; "<>"; ROW(D3:D); "<="&ROW(D3:D))))');

  var dataRange = sheet.getRange(3, 1, 500, numCols);
  dataRange.setFontSize(10).setVerticalAlignment('middle');

  sheet.getRange(3, 1, 500, 1).setHorizontalAlignment('center');
  sheet.getRange(3, 2, 500, 2).setHorizontalAlignment('center');
  sheet.getRange(3, 4, 500, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sheet.getRange(3, 5, 500, 2).setHorizontalAlignment('left');
  sheet.getRange(3, 7, 500, 1).setHorizontalAlignment('center');
  sheet.getRange(3, 8, 500, 1).setHorizontalAlignment('left');
  sheet.getRange(3, 9, 500, 1).setHorizontalAlignment('center');
  sheet.getRange(3, 10, 500, 2).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy');
  sheet.getRange(3, 12, 500, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange(3, 13, 500, 2).setHorizontalAlignment('center');
  sheet.getRange(3, 15, 500, 2).setHorizontalAlignment('left');
  sheet.getRange(3, 17, 500, 1).setHorizontalAlignment('center');

  sheet.getRange(3, 2, 500, 6).setBackground('#F8FAFC').setFontColor('#334155');

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Đang sử dụng', 'Tạm dừng', 'Đã hủy'], true)
    .setAllowInvalid(false).build();
  sheet.getRange(3, 14, 500, 1).setDataValidation(statusRule);

  var expiryStatusRange = sheet.getRange(3, 13, 500, 1);
  var daysLeftRange = sheet.getRange(3, 12, 500, 1);
  var statusRange = sheet.getRange(3, 14, 500, 1);

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Đã quá hạn').setBackground('#FEE2E2').setFontColor('#991B1B').setRanges([expiryStatusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Sắp hết hạn').setBackground('#FEF9C3').setFontColor('#854D0E').setRanges([expiryStatusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Đang sử dụng').setBackground('#DCFCE7').setFontColor('#166534').setRanges([expiryStatusRange, statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThanOrEqualTo(0).setFontColor('#DC2626').setRanges([daysLeftRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(1, 30).setFontColor('#D97706').setRanges([daysLeftRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Tạm dừng').setBackground('#F1F5F9').setFontColor('#475569').setRanges([statusRange]).build()
  ]);

  sheet.getRange(2, 1, 100, numCols).createFilter();
  ss.toast('✅ Đã tạo khung bảng trắng chuẩn 17 cột, sẵn sàng đồng bộ!', 'Hoàn tất', 5);
}

function autoSortGroupPartners() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  var numCols = HEADERS.length;
  var range = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, numCols);
  
  range.sort([
    { column: 4, ascending: true },
    { column: 8, ascending: true }
  ]);

  SpreadsheetApp.getActiveSpreadsheet().toast('✅ Đã tự động gom nhóm các dịch vụ cùng khách hàng liền kề nhau!', 'Sắp xếp');
}

function pullDataFromWebAndSetupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  
  if (sheet.getName() === 'Trang tính1' || sheet.getName() === 'Sheet1') {
    try { sheet.setName(TAB_NAME); } catch (e) {}
  }

  ss.toast('Đang kết nối đến Web Fermat...', 'Đồng bộ', 3);

  var payload = null;
  var secret = getWebhookSecret_();
  var headers = { 'Accept': 'application/json' };
  if (secret) headers['X-Sheet-Webhook-Secret'] = secret;

  try {
    var response = UrlFetchApp.fetch(getSyncUrl_(), {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      var data = JSON.parse(response.getContentText());
      if (data && data.success && data.data) payload = data.data;
    } else if (code === 401 || code === 403) {
      ss.toast('⚠️ WEBHOOK_SECRET không đúng hoặc chưa được cấu hình.', 'Lỗi xác thực', 8);
      return;
    }
  } catch (err) {
    Logger.log('Lỗi kết nối Web: ' + err);
  }

  if (!payload || !payload.rows || payload.rows.length <= 2) {
    ss.toast('ℹ️ Không có dòng dữ liệu nào trên Web hoặc chưa kết nối được.', 'Thông báo', 5);
    return;
  }

  initCleanSheetTemplate();

  var rows = payload.rows;
  var numCols = HEADERS.length;
  sheet.getRange(1, 1, rows.length, numCols).setValues(rows);

  sheet.getRange('A3').setFormula('=ARRAYFORMULA(IF(D3:D=""; ""; COUNTIFS(D3:D; "<>"; ROW(D3:D); "<="&ROW(D3:D))))');
  autoSortGroupPartners();

  ss.toast('✅ Đã kéo dữ liệu từ Web và gom nhóm dịch vụ thành công!', 'Hoàn tất', 5);
}

function syncAllRowsToWeb() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Bảng tính chưa có dòng dữ liệu nào.', 'Thông báo');
    return;
  }

  var sheetName = sheet.getName();
  var lastCol = Math.max(sheet.getLastColumn(), 17);
  var numRows = lastRow - FIRST_DATA_ROW + 1;
  var allValues = sheet.getRange(FIRST_DATA_ROW, 1, numRows, lastCol).getDisplayValues();

  var rowsPayload = [];
  for (var i = 0; i < allValues.length; i++) {
    var rowValues = allValues[i];
    var hasContent = rowValues.some(function(cell) { return String(cell || '').trim() !== ''; });
    if (hasContent) {
      rowsPayload.push({ row: FIRST_DATA_ROW + i, values: rowValues });
    }
  }

  if (rowsPayload.length === 0) return;

  var batchSize = 50;
  for (var b = 0; b < rowsPayload.length; b += batchSize) {
    var batch = rowsPayload.slice(b, b + batchSize);
    sendToWebhook_({ rows: batch, sheet_name: sheetName });
    Utilities.sleep(500);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Đã gửi ' + rowsPayload.length + ' dòng lên Web thành công.', 'Đồng bộ hoàn tất');
}

function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row < FIRST_DATA_ROW) return;
  var sheetName = sheet.getName();
  if (sheetName !== TAB_NAME && sheetName !== 'Trang tính1' && sheetName !== 'Theo dõi dịch vụ') return;

  if (col === 4) {
    autoSortGroupPartners();
  }

  var lastCol = Math.max(sheet.getLastColumn(), 17);
  var values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
  var hasContent = values.some(function(cell) { return String(cell || '').trim() !== ''; });
  if (!hasContent) return;

  sendToWebhook_({
    row: row,
    values: values,
    edited_at: new Date().toISOString(),
    sheet_name: sheetName,
  });
}

function sendToWebhook_(payload) {
  var url = getWebhookUrl_();
  var secret = getWebhookSecret_();
  var headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Sheet-Webhook-Secret'] = secret;

  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (error) {
    Logger.log('Lỗi webhook: ' + error);
  }
}

function setupAutoTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onEditInstallable') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ss.toast('⚡ Đã kích hoạt Trigger tự động onEdit!', 'Cài đặt Trigger', 5);
}`;
}

interface SubscriptionSheetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  idToken: string;
  onConfigSaved?: () => void;
}

export default function SubscriptionSheetConfigModal({
  isOpen,
  onClose,
  idToken,
  onConfigSaved,
}: SubscriptionSheetConfigModalProps) {
  const [activeTab, setActiveTab] = useState<"appsscript" | "serviceaccount">("appsscript");
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [tabTitle, setTabTitle] = useState("Trang tính1");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [hasServiceAccount, setHasServiceAccount] = useState(false);
  const [googleServiceAccountJson, setGoogleServiceAccountJson] = useState("");

  const [testResult, setTestResult] = useState<{
    tested: boolean;
    connected: boolean;
    message: string;
    sheetTitle?: string;
    tabs?: string[];
  }>({ tested: false, connected: false, message: "" });

  const [copiedType, setCopiedType] = useState<string | null>(null);

  const authHeader = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  // Fetch initial config
  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/digital-training/subscriptions/sheet-config", {
        headers: authHeader,
      });
      if (res.ok) {
        const data = await res.json();
        setSpreadsheetId(data.spreadsheetId || "");
        setSpreadsheetUrl(data.spreadsheetUrl || "");
        setTabTitle(data.tabTitle || "Trang tính1");
        setWebhookSecret(data.webhookSecret || "");
        setServiceAccountEmail(data.serviceAccountEmail || null);
        setHasServiceAccount(Boolean(data.hasServiceAccount));
      }
    } catch {
      // Ignore initial load error
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchConfig();
      setTestResult({ tested: false, connected: false, message: "" });
    }
  }, [isOpen]);

  const handleCopy = (text: string, type: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => {
      setCopiedType(null);
    }, 2500);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        spreadsheetId: spreadsheetId.trim(),
        tabTitle: tabTitle.trim(),
      };
      if (googleServiceAccountJson.trim()) {
        payload.googleServiceAccountJson = googleServiceAccountJson.trim();
      }

      const res = await fetch("/api/digital-training/subscriptions/sheet-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSpreadsheetId(data.config?.spreadsheetId || spreadsheetId);
        setSpreadsheetUrl(data.config?.spreadsheetUrl || spreadsheetUrl);
        if (data.config?.webhookSecret) {
          setWebhookSecret(data.config.webhookSecret);
        }
        setHasServiceAccount(Boolean(data.config?.hasServiceAccount));
        setServiceAccountEmail(data.config?.serviceAccountEmail || null);
        if (data.test) {
          setTestResult({
            tested: true,
            connected: Boolean(data.test.connected),
            message: data.test.message || "",
            sheetTitle: data.test.sheetTitle,
            tabs: data.test.tabs,
          });
        }
        if (onConfigSaved) onConfigSaved();
      } else {
        await appDialog.alert(data.error || "Không thể lưu cấu hình Google Sheet.", {
          title: "Lỗi lưu cấu hình",
          tone: "danger",
        });
      }
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi kết nối máy chủ.", {
        title: "Lỗi kết nối",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeader,
      };
      if (webhookSecret) {
        headers["X-Sheet-Webhook-Secret"] = webhookSecret;
      }
      const res = await fetch("/api/digital-training/subscriptions/sheet-webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({
          test: true,
          row: 3,
          values: [],
        }),
      });
      if (res.ok) {
        await appDialog.alert(
          "Cổng Webhook đang hoạt động tốt (sẵn sàng nhận dữ liệu tự động từ Apps Script)!",
          { title: "Kiểm tra Webhook thành công", tone: "success" }
        );
      } else {
        const data = await res.json().catch(() => ({}));
        await appDialog.alert(`Lỗi cổng Webhook: ${data.error || res.statusText}`, {
          title: "Webhook phản hồi lỗi",
          tone: "danger",
        });
      }
    } catch (err: any) {
      await appDialog.alert(err.message || "Không thể kết nối đến Webhook.", {
        title: "Lỗi kết nối",
        tone: "danger",
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  if (!isOpen) return null;

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://workspace.fermat.vn";
  const webhookUrl = `${currentOrigin}/api/digital-training/subscriptions/sheet-webhook`;
  const appsScriptCode = buildAppsScriptCode(webhookUrl, webhookSecret);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Cài đặt & Đồng bộ Google Sheet
              </h2>
              <p className="text-xs text-slate-500">
                Quản lý kết nối hai chiều với Google Sheet theo dõi thời hạn sử dụng BNDC
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-6 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setActiveTab("appsscript")}
            className={`flex items-center gap-2 border-b-2 py-3 text-xs font-semibold transition-colors cursor-pointer mr-6 ${
              activeTab === "appsscript"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Zap className="h-4 w-4 text-amber-500" />
            <span>Cách 1: Apps Script Webhook (Khuyên dùng)</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              ⚡ Tức thì & 0 cần Cloud
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("serviceaccount")}
            className={`flex items-center gap-2 border-b-2 py-3 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "serviceaccount"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Key className="h-4 w-4 text-purple-600" />
            <span>Cách 2: Tài khoản dịch vụ (Google Cloud API)</span>
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-slate-700 text-xs">
          {/* SPREADSHEET SHORTCUT BANNER */}
          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/70 p-3.5">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-4 w-4 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <span className="font-semibold text-slate-800">Google Sheet đang dùng: </span>
                <span className="font-mono text-slate-600 truncate block sm:inline">
                  {spreadsheetId || "1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"}
                </span>
              </div>
            </div>
            <a
              href={spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId || "1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"}/edit`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-50 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Mở Google Sheet</span>
            </a>
          </div>

          {/* TAB 1: APPS SCRIPT WEBHOOK */}
          {activeTab === "appsscript" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Đồng bộ thời gian thực qua Apps Script (Khuyên dùng)
                </h4>
                <p className="text-slate-600 leading-relaxed text-xs">
                  Không cần thiết lập tài khoản Google Cloud phức tạp. Bất kỳ khi nào bạn hoặc nhân viên sửa dữ liệu trên Google Sheet, Google Sheet sẽ tự động đẩy ngay dòng thay đổi về Web Fermat.
                </p>
              </div>

              {/* Webhook endpoint URL & Secret */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Đường dẫn Webhook nhận dữ liệu (Webhook URL)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={webhookUrl}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(webhookUrl, "webhook")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
                    >
                      {copiedType === "webhook" ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-semibold">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleTestWebhook}
                      disabled={testingWebhook}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 transition-colors disabled:opacity-50 cursor-pointer"
                      title="Kiểm tra xem webhook có sẵn sàng nhận tin nhắn không"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${testingWebhook ? "animate-spin" : ""}`} />
                      <span>Test Webhook</span>
                    </button>
                  </div>
                </div>

                {webhookSecret && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mã khóa bảo mật Webhook (<code>WEBHOOK_SECRET</code> — đã tích hợp sẵn vào mã Apps Script bên dưới)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={webhookSecret}
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(webhookSecret, "webhook_secret")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
                      >
                        {copiedType === "webhook_secret" ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-semibold">Đã chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Sao chép Secret</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step-by-step instructions */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h4 className="font-semibold text-slate-900 text-xs">
                  Các bước cài đặt & Khởi tạo bảng trên Google Sheet:
                </h4>
                <ol className="space-y-2.5 list-decimal list-inside text-slate-600 text-xs leading-relaxed">
                  <li>
                    Mở Google Sheet, vào menu: <strong>Tiện ích mở rộng (Extensions)</strong> &rarr;{" "}
                    <strong>Apps Script</strong>.
                  </li>
                  <li>
                    Xóa sạch nội dung cũ trong file <code>Code.gs</code>, sau đó bấm nút{" "}
                    <strong>Sao chép toàn bộ mã</strong> bên dưới và dán toàn bộ vào (mã đã kèm sẵn <code>WEBHOOK_SECRET</code> của hệ thống).
                  </li>
                  <li>
                    Nhấn <strong>Lưu (Ctrl + S)</strong>.
                  </li>
                  <li>
                    <em>(Tùy chọn)</em> Bạn cũng có thể vào <strong>Cài đặt dự án (Project Settings ⚙️)</strong> &rarr; <strong>Thuộc tính tập lệnh (Script Properties)</strong> &rarr; thêm thuộc tính <code>WEBHOOK_SECRET</code>.
                  </li>
                  <li className="bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-200 text-emerald-900 font-medium">
                    ⭐ <strong>Khởi tạo bảng & Kéo dữ liệu về Sheet:</strong> Trên thanh công cụ Apps Script, chọn hàm{" "}
                    <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono font-bold text-emerald-950">pullDataFromWebAndSetupSheet</code> rồi bấm nút <strong>Chạy (Run)</strong>.
                    <div className="text-[11px] font-normal text-emerald-800 mt-1">
                      &rarr; Google Sheet sẽ tự động tạo banner tiêu đề, hàng tiêu đề, độ rộng 17 cột chuẩn mực, đóng băng 2 hàng đầu, khóa màu xám các cột đối tác, công thức STT ARRAYFORMULA & ngày còn lại, gom nhóm theo khách hàng và kéo toàn bộ dữ liệu từ Web về ngay lập tức!
                    </div>
                  </li>
                  <li>
                    <strong>Kích hoạt Trigger tự động:</strong> Chọn hàm{" "}
                    <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">setupAutoTrigger</code> rồi bấm <strong>Chạy (Run)</strong> để tự động đăng ký trigger mà không cần thiết lập thủ công.
                  </li>
                  <li>
                    Khi mở lại Google Sheet, bạn sẽ thấy menu mới <strong>🚀 Fermat Workspace</strong> trên thanh menu để bấm 1-click bất cứ lúc nào!
                  </li>
                </ol>
              </div>

              {/* Code snippet display */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-xs text-slate-700 flex items-center gap-1.5">
                    <FileCode className="h-4 w-4 text-slate-500" />
                    Mã Google Apps Script (Code.gs)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(appsScriptCode, "code")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    {copiedType === "code" ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Đã sao chép mã!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Sao chép toàn bộ mã</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="relative rounded-xl border border-slate-200 bg-slate-900 p-3.5 text-slate-100 font-mono text-[11px] max-h-48 overflow-y-auto leading-relaxed select-all">
                  <pre>{appsScriptCode}</pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SERVICE ACCOUNT GOOGLE API */}
          {activeTab === "serviceaccount" && (
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5 mb-1.5">
                  <ShieldCheck className="h-4 w-4 text-purple-600" />
                  Đồng bộ trực tiếp qua Google Cloud Sheets API (v4)
                </h4>
                <p className="text-slate-600 leading-relaxed text-xs">
                  Cách này cho phép nút <strong>"Đồng bộ Sheet"</strong> trên thanh công cụ của Web kết nối thẳng đến Google API để vừa đọc dữ liệu mới về Web, vừa xuất danh sách gói và định dạng bảng màu sắc trực tiếp lên Sheet.
                </p>
              </div>

              {/* Connection Status Badge */}
              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                  hasServiceAccount
                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                    : "border-amber-200 bg-amber-50/70 text-amber-800"
                }`}
              >
                {hasServiceAccount ? (
                  <Check className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-semibold text-xs">
                    {hasServiceAccount
                      ? "Đã cấu hình tài khoản Google Service Account"
                      : "Chưa có Google Service Account JSON"}
                  </div>
                  <div className="text-[11px] mt-0.5 leading-relaxed">
                    {hasServiceAccount && serviceAccountEmail ? (
                      <div className="space-y-1.5 mt-1">
                        <div>
                          Email tài khoản dịch vụ:{" "}
                          <strong className="font-mono text-emerald-900 select-all">
                            {serviceAccountEmail}
                          </strong>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopy(serviceAccountEmail, "sa_email")}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                          >
                            {copiedType === "sa_email" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            <span>{copiedType === "sa_email" ? "Đã chép" : "Sao chép Email"}</span>
                          </button>
                          <span className="text-slate-500 text-[10px]">
                            &rarr; Nhớ bấm <strong>Chia sẻ (Share)</strong> trên Sheet và cấp quyền <strong>Editor</strong> cho email này.
                          </span>
                        </div>
                      </div>
                    ) : (
                      "Vui lòng dán nội dung file JSON của Service Account tạo từ Google Cloud Console vào ô bên dưới."
                    )}
                  </div>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Google Spreadsheet ID hoặc URL
                  </label>
                  <input
                    type="text"
                    value={spreadsheetId}
                    onChange={(e) => setSpreadsheetId(e.target.value)}
                    placeholder="1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên tab (Trang tính)
                  </label>
                  <input
                    type="text"
                    value={tabTitle}
                    onChange={(e) => setTabTitle(e.target.value)}
                    placeholder="Trang tính1"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nội dung Google Service Account JSON (Tùy chọn ghi đè)
                </label>
                <textarea
                  rows={4}
                  value={googleServiceAccountJson}
                  onChange={(e) => setGoogleServiceAccountJson(e.target.value)}
                  placeholder='Dán nội dung file service_account.json (bắt đầu bằng {"type": "service_account", ...})'
                  className="w-full rounded-lg border border-slate-200 font-mono text-[11px] p-2.5 text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {testResult.tested && (
                <div
                  className={`rounded-xl border p-3 text-xs leading-relaxed ${
                    testResult.connected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {testResult.connected ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-rose-600" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                  {testResult.tabs && testResult.tabs.length > 0 && (
                    <div className="mt-1 text-[11px] text-slate-600">
                      Các tab có trong Sheet: {testResult.tabs.join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Save className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} />
                  <span>{saving ? "Đang lưu & kiểm tra..." : "Lưu & Kiểm tra kết nối"}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200/80 px-6 py-3.5 bg-slate-50/80">
          <span className="text-[11px] text-slate-500">
            Khuyên dùng <strong>Apps Script Webhook</strong> để đồng bộ tức thì mà không cần cấp quyền tài khoản dịch vụ.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
