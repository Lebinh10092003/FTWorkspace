/**
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
var WEBHOOK_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-webhook';
var SYNC_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-sync';
var WEBHOOK_SECRET_DEFAULT = '';

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
  'Thời gian theo HĐ',         // J (10) dd/mm/yyyy - dd/mm/yyyy
  'Thời gian thực tế',         // K (11) dd/mm/yyyy - dd/mm/yyyy
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
  190,  // J: Thời gian theo HĐ
  190,  // K: Thời gian thực tế
  110,  // L: Còn lại (ngày)
  120,  // M: Tình trạng hạn
  125,  // N: Trạng thái
  140,  // O: Nhân sự phụ trách
  290,  // P: Tiến độ & Ghi chú gia hạn
  130,  // Q: Cập nhật web lúc
];

/**
 * Tạo Menu tiện ích tùy chỉnh trên thanh công cụ Google Sheet
 */
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

/**
 * 1. Khởi tạo khung bảng sạch chuẩn 17 cột, không chứa dữ liệu mẫu, sẵn sàng đồng bộ
 */
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

  // Đóng băng 2 hàng đầu, không cố định cột để tránh lỗi merge banner
  sheet.setFrozenColumns(0);
  sheet.setFrozenRows(2);

  sheet.setRowHeight(1, 38);
  sheet.setRowHeight(2, 34);
  for (var r = 3; r <= 30; r++) sheet.setRowHeight(r, 28);
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);

  // Banner Hàng 1
  var titleRow = ["FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG"];
  for (var i = 1; i < numCols; i++) titleRow.push("");
  sheet.getRange(1, 1, 1, numCols).setValues([titleRow]);
  
  var banner = sheet.getRange(1, 1, 1, numCols);
  banner.merge().setBackground('#1D4ED8').setFontColor('#FFFFFF').setFontSize(12).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // Header Hàng 2
  sheet.getRange(2, 1, 1, numCols).setValues([HEADERS]);
  sheet.getRange(2, 1, 1, numCols)
    .setBackground('#DBEAFE').setFontColor('#1E3A8A').setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true)
    .setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Công thức STT tự động tại A3 (khi cột D có Tên trường thì tự nhảy số 1, 2, 3...)
  sheet.getRange('A3').setFormula('=ARRAYFORMULA(IF(D3:D=""; ""; COUNTIFS(D3:D; "<>"; ROW(D3:D); "<="&ROW(D3:D))))');

  // Định dạng các cột dữ liệu (500 dòng sẵn sàng)
  var dataRange = sheet.getRange(3, 1, 500, numCols);
  dataRange.setFontSize(10).setVerticalAlignment('middle');

  sheet.getRange(3, 1, 500, 1).setHorizontalAlignment('center'); // STT
  sheet.getRange(3, 2, 500, 2).setHorizontalAlignment('center'); // Mã ĐK, Mã KH
  sheet.getRange(3, 4, 500, 1).setHorizontalAlignment('left').setFontWeight('bold'); // Tên trường in đậm
  sheet.getRange(3, 5, 500, 2).setHorizontalAlignment('left');   // Tỉnh, Đầu mối
  sheet.getRange(3, 7, 500, 1).setHorizontalAlignment('center'); // SĐT
  sheet.getRange(3, 8, 500, 1).setHorizontalAlignment('left');   // Dịch vụ
  sheet.getRange(3, 9, 500, 1).setHorizontalAlignment('center'); // Số lượng
  sheet.getRange(3, 10, 500, 2).setHorizontalAlignment('center').setNumberFormat('@'); // Khoảng thời gian dạng chữ
  sheet.getRange(3, 12, 500, 1).setHorizontalAlignment('center').setFontWeight('bold'); // Còn lại
  sheet.getRange(3, 13, 500, 2).setHorizontalAlignment('center'); // Tình trạng, Trạng thái
  sheet.getRange(3, 15, 500, 2).setHorizontalAlignment('left');   // Phụ trách, Ghi chú
  sheet.getRange(3, 17, 500, 1).setHorizontalAlignment('center'); // Cập nhật lúc

  // Khóa nền xám nhạt cho cột thông tin gốc (Cột B–G)
  sheet.getRange(3, 2, 500, 6).setBackground('#F8FAFC').setFontColor('#334155');

  // Dropdown Cột N (Trạng thái)
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Đang sử dụng', 'Tạm dừng', 'Đã hủy'], true)
    .setAllowInvalid(false).build();
  sheet.getRange(3, 14, 500, 1).setDataValidation(statusRule);

  // Tô màu có điều kiện (Đỏ: Quá hạn, Vàng: Sắp hết hạn, Xanh: Đang sử dụng)
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

/**
 * 2. Tự động gom nhóm: Các dịch vụ của cùng 1 khách hàng luôn đứng sát cạnh nhau
 */
function autoSortGroupPartners() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  var numCols = HEADERS.length;
  var range = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, numCols);
  
  // Sắp xếp: Cột 4 (Tên trường) A-Z -> Cột 8 (Dịch vụ) A-Z
  range.sort([
    { column: 4, ascending: true },
    { column: 8, ascending: true }
  ]);

  SpreadsheetApp.getActiveSpreadsheet().toast('✅ Đã tự động gom nhóm các dịch vụ cùng khách hàng liền kề nhau!', 'Sắp xếp');
}

/**
 * 3. Kéo dữ liệu từ Web về Google Sheet (khi kết nối qua API)
 */
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

  // Ghi dữ liệu lấy được từ Web
  var rows = payload.rows;
  var numCols = HEADERS.length;
  sheet.getRange(1, 1, rows.length, numCols).setValues(rows);

  // Đảm bảo công thức STT tự động tại A3
  sheet.getRange('A3').setFormula('=ARRAYFORMULA(IF(D3:D=""; ""; COUNTIFS(D3:D; "<>"; ROW(D3:D); "<="&ROW(D3:D))))');
  autoSortGroupPartners();

  ss.toast('✅ Đã kéo dữ liệu từ Web và gom nhóm dịch vụ thành công!', 'Hoàn tất', 5);
}

/**
 * 4. Đẩy toàn bộ dữ liệu trên Sheet lên Web
 */
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

/**
 * Trigger tự động khi người dùng sửa trên Sheet
 */
function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row < FIRST_DATA_ROW) return;
  var sheetName = sheet.getName();
  if (sheetName !== TAB_NAME && sheetName !== 'Trang tính1') return;

  // Nếu người dùng nhập/sửa ở Cột D (Tên trường): Tự động gom nhóm lại
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

/**
 * Cài đặt Trigger onEdit tự động
 */
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
}
