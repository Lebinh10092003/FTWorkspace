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

const APPS_SCRIPT_CODE = `/**
 * Realtime Sheet <-> Web sync trigger cho "Theo dõi dịch vụ & Hạn dùng BNDC"
 * File Google Sheet: https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit
 *
 * TÍNH NĂNG CHÍNH:
 * 1. Tự động khởi tạo toàn bộ bảng, hàng, cột, độ rộng, kẻ viền, đóng băng, công thức STT & ngày còn lại khi trang tính trống.
 * 2. Menu "🚀 Fermat Workspace" trực tiếp trên Google Sheet:
 *    - 📥 Khởi tạo bảng & Kéo dữ liệu từ Web
 *    - 📤 Đẩy toàn bộ dữ liệu Sheet lên Web
 *    - ⚡ Kích hoạt Trigger tự động khi sửa (onEdit)
 * 3. Đồng bộ hai chiều thời gian thực mà KHÔNG CẦN tài khoản Google Cloud Service Account.
 */

var FIRST_DATA_ROW = 3;
var WEBHOOK_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-webhook';
var SYNC_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-sync';

var HEADERS = [
  'STT', 'Mã ĐT', 'Tên trường / Đơn vị', 'Tỉnh / Thành phố', 'Đầu mối liên hệ',
  'Số điện thoại', 'Dịch vụ / Sản phẩm', 'Số lượng', 'Ngày bắt đầu', 'Ngày hết hạn',
  'Còn lại (ngày)', 'Trạng thái', 'Nhân sự phụ trách', 'Tiến độ & Ghi chú gia hạn', 'Mã ĐK'
];

var COLUMN_WIDTHS = [55, 75, 280, 130, 150, 115, 180, 75, 100, 100, 110, 125, 140, 280, 75];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 Fermat Workspace')
    .addItem('📥 Khởi tạo bảng & Kéo dữ liệu từ Web', 'pullDataFromWebAndSetupSheet')
    .addItem('📤 Đẩy tất cả dữ liệu Sheet lên Web', 'syncAllRowsToWeb')
    .addSeparator()
    .addItem('⚡ Kích hoạt Trigger tự động (onEdit)', 'setupAutoTrigger')
    .addToUi();
}

function getWebhookUrl_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('WEBHOOK_URL') || WEBHOOK_URL_DEFAULT;
}

function getSyncUrl_() {
  var webhook = getWebhookUrl_();
  return webhook.replace('/sheet-webhook', '/sheet-sync');
}

function pullDataFromWebAndSetupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  ss.toast('Đang kết nối đến Web Fermat...', 'Khởi tạo bảng', 3);

  var payload = null;
  try {
    var response = UrlFetchApp.fetch(getSyncUrl_(), {
      method: 'get',
      headers: { 'Accept': 'application/json' },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      var data = JSON.parse(response.getContentText());
      if (data && data.success && data.data) {
        payload = data.data;
      }
    }
  } catch (err) {
    Logger.log('Không thể kéo dữ liệu trực tiếp: ' + err);
  }

  if (!payload || !payload.rows || payload.rows.length === 0) {
    var titleRow = ['FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG'].concat(new Array(HEADERS.length - 1).fill(''));
    payload = {
      title: 'FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG',
      headers: HEADERS,
      columnWidths: COLUMN_WIDTHS,
      rows: [
        titleRow,
        HEADERS,
        ['=IF(C3<>""; ROW()-2; "")', '1', 'THCS & THPT Marie Curie', 'Hà Nội', 'Cô Lan', '0912345678', 'Lớp học số', 1, '05/11/2025', '05/11/2026', '=IF(ISBLANK(J3); ""; INT(J3 - TODAY()))', 'Đang sử dụng', 'Nguyễn Văn A', 'Đang vận hành tốt', '1'],
        ['=IF(C4<>""; ROW()-2; "")', '4', 'THCS Chu Văn An', 'Hà Nội', 'Thầy Hùng', '0987654321', 'BNDC', 1, '28/10/2025', '28/10/2026', '=IF(ISBLANK(J4); ""; INT(J4 - TODAY()))', 'Đang sử dụng', 'Trần Thị B', 'Đã cấp tài khoản quản trị', '4'],
      ],
    };
  }

  setupSheetFormatAndData_(sheet, payload);
  ss.toast('✅ Đã tạo cấu trúc bảng, hàng, cột và đổ dữ liệu thành công!', 'Hoàn tất', 5);
}

function setupSheetFormatAndData_(sheet, payload) {
  var rows = payload.rows;
  var numRows = Math.max(rows.length, 10);
  var numCols = HEADERS.length;

  if (sheet.getMaxRows() < numRows + 10) {
    sheet.insertRowsAfter(sheet.getMaxRows(), numRows + 10 - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < numCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, sheet.getMaxRows(), numCols).clear({ contentsOnly: false, formatOnly: true });
  sheet.setFrozenRows(2);
  sheet.setRowHeight(1, 38);
  sheet.setRowHeight(2, 30);
  for (var r = 3; r <= numRows; r++) {
    sheet.setRowHeight(r, 25);
  }
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);
  }

  if (rows && rows.length > 0) {
    sheet.getRange(1, 1, rows.length, numCols).setValues(rows);
  }

  var bannerRange = sheet.getRange(1, 1, 1, numCols);
  bannerRange.merge();
  bannerRange.setBackground('#1D4ED8').setFontColor('#FFFFFF').setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');

  var headerRange = sheet.getRange(2, 1, 1, numCols);
  headerRange.setBackground('#DBEAFE').setFontColor('#1E3A8A').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  if (numRows >= 3) {
    var fullTableRange = sheet.getRange(1, 1, numRows, numCols);
    fullTableRange.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    sheet.getRange(3, 1, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 2, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 3, numRows - 2, 1).setHorizontalAlignment('left');
    sheet.getRange(3, 4, numRows - 2, 1).setHorizontalAlignment('left');
    sheet.getRange(3, 5, numRows - 2, 1).setHorizontalAlignment('left');
    sheet.getRange(3, 6, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 7, numRows - 2, 1).setHorizontalAlignment('left');
    sheet.getRange(3, 8, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 9, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy');
    sheet.getRange(3, 10, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy');
    sheet.getRange(3, 11, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 12, numRows - 2, 1).setHorizontalAlignment('center');
    sheet.getRange(3, 13, numRows - 2, 1).setHorizontalAlignment('left');
    sheet.getRange(3, 14, numRows - 2, 1).setHorizontalAlignment('left').setWrap(true);
    sheet.getRange(3, 15, numRows - 2, 1).setHorizontalAlignment('center');

    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Đang sử dụng', 'Sắp hết hạn', 'Đã quá hạn', 'Tạm dừng', 'Đã hủy'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(3, 12, numRows - 2, 1).setDataValidation(statusRule);

    var statusRange = sheet.getRange(3, 12, numRows - 2, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Đang sử dụng').setBackground('#DCFCE7').setFontColor('#166534').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Sắp hết hạn').setBackground('#FEF9C3').setFontColor('#854D0E').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Đã quá hạn').setBackground('#FEE2E2').setFontColor('#991B1B').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Tạm dừng').setBackground('#F1F5F9').setFontColor('#475569').setRanges([statusRange]).build(),
    ];
    sheet.setConditionalFormatRules(rules);
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

  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ss.toast('⚡ Đã kích hoạt Trigger tự động onEdit thành công!', 'Cài đặt Trigger', 5);
}

function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  if (row < FIRST_DATA_ROW) return;

  var lastCol = Math.max(sheet.getLastColumn(), 15);
  var values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  var hasContent = values.some(function(cell) {
    return String(cell || '').trim() !== '';
  });
  if (!hasContent) return;

  var payload = {
    row: row,
    values: values,
    edited_at: new Date().toISOString(),
    sheet_name: sheet.getName(),
  };

  sendToWebhook_(payload);
}

function syncAllRowsToWeb() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Không có dòng dữ liệu nào để đồng bộ.', 'Thông báo');
    return;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 15);
  var numRows = lastRow - FIRST_DATA_ROW + 1;
  var allValues = sheet.getRange(FIRST_DATA_ROW, 1, numRows, lastCol).getDisplayValues();

  var rowsPayload = [];
  for (var i = 0; i < allValues.length; i++) {
    var rowValues = allValues[i];
    var hasContent = rowValues.some(function(cell) {
      return String(cell || '').trim() !== '';
    });
    if (hasContent) {
      rowsPayload.push({
        row: FIRST_DATA_ROW + i,
        values: rowValues,
      });
    }
  }

  if (rowsPayload.length === 0) return;

  var batchSize = 50;
  for (var b = 0; b < rowsPayload.length; b += batchSize) {
    var batch = rowsPayload.slice(b, b + batchSize);
    sendToWebhook_({ rows: batch });
    Utilities.sleep(500);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Đã gửi ' + rowsPayload.length + ' dòng lên Web thành công.', 'Đồng bộ hoàn tất');
}

function sendToWebhook_(payload) {
  var url = getWebhookUrl_();
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    Logger.log('Webhook kết quả: ' + response.getContentText());
  } catch (error) {
    Logger.log('Lỗi kết nối Webhook: ' + error);
  }
}`;

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
      const res = await fetch("/api/digital-training/subscriptions/sheet-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

              {/* Webhook endpoint URL */}
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
                    <strong>Sao chép mã Apps Script</strong> bên dưới và dán toàn bộ vào.
                  </li>
                  <li>
                    Nhấn <strong>Lưu (Ctrl + S)</strong>.
                  </li>
                  <li className="bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-200 text-emerald-900 font-medium">
                    ⭐ <strong>Khởi tạo bảng & Kéo dữ liệu về Sheet:</strong> Trên thanh công cụ Apps Script, chọn hàm{" "}
                    <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono font-bold text-emerald-950">pullDataFromWebAndSetupSheet</code> rồi bấm nút <strong>Chạy (Run)</strong>.
                    <div className="text-[11px] font-normal text-emerald-800 mt-1">
                      &rarr; Google Sheet sẽ tự động tạo banner tiêu đề, hàng tiêu đề, độ rộng 15 cột, viền bảng, công thức STT & ngày còn lại, và kéo toàn bộ dữ liệu từ Web về ngay lập tức!
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
                    onClick={() => handleCopy(APPS_SCRIPT_CODE, "code")}
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
                  <pre>{APPS_SCRIPT_CODE}</pre>
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
