/**
 * Realtime Sheet <-> Web sync trigger cho "Theo dõi dịch vụ khách hàng & Hạn dùng"
 * File Google Sheet: https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit
 *
 * TÍNH NĂNG CHÍNH:
 * 1. Tự động khởi tạo bảng 17 cột chuẩn mực, độ rộng, kẻ viền, đóng băng, công thức STT & ngày còn lại.
 * 2. Bảo mật qua WEBHOOK_SECRET (Script Properties).
 * 3. Menu "🚀 Fermat Workspace" trực tiếp trên Google Sheet:
 *    - 📥 Khởi tạo bảng & Kéo dữ liệu từ Web
 *    - 📤 Đẩy toàn bộ dữ liệu Sheet lên Web
 *    - ⚡ Kích hoạt Trigger tự động khi sửa (onEdit)
 * 4. Không dùng tài khoản Google Cloud Service Account vẫn đồng bộ 2 chiều thời gian thực an toàn.
 */

var FIRST_DATA_ROW = 3; // Dòng 1: Banner, Dòng 2: Header, Dòng 3 trở đi: Dữ liệu
var TAB_NAME = 'Dịch vụ khách hàng';
var WEBHOOK_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-webhook';
var SYNC_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-sync';

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
  75,   // B: Mã ĐK
  75,   // C: Mã KH
  280,  // D: Tên trường / Đơn vị
  130,  // E: Tỉnh / Thành phố
  150,  // F: Đầu mối liên hệ
  115,  // G: Số điện thoại
  180,  // H: Dịch vụ / Sản phẩm
  75,   // I: Số lượng
  100,  // J: Ngày bắt đầu
  100,  // K: Ngày hết hạn
  110,  // L: Còn lại (ngày)
  120,  // M: Tình trạng hạn
  120,  // N: Trạng thái
  140,  // O: Nhân sự phụ trách
  280,  // P: Tiến độ & Ghi chú gia hạn
  130,  // Q: Cập nhật web lúc
];

// Tạo Menu tùy chỉnh ngay khi người dùng mở Google Sheet
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

function getWebhookSecret_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('WEBHOOK_SECRET') || '';
}

function getSyncUrl_() {
  var webhook = getWebhookUrl_();
  return webhook.replace('/sheet-webhook', '/sheet-sync');
}

/**
 * Khởi tạo bảng đầy đủ khi trang tính trống hoặc kéo dữ liệu mới từ Web về Google Sheet.
 */
function pullDataFromWebAndSetupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  
  // Đổi tên tab thành "Dịch vụ khách hàng" nếu đang là "Trang tính1"
  if (sheet.getName() === 'Trang tính1') {
    try {
      sheet.setName(TAB_NAME);
    } catch (e) {}
  }

  ss.toast('Đang kết nối đến Web Fermat...', 'Khởi tạo bảng', 3);

  var payload = null;
  var secret = getWebhookSecret_();
  var headers = {
    'Accept': 'application/json',
  };
  if (secret) {
    headers['X-Sheet-Webhook-Secret'] = secret;
  }

  try {
    var response = UrlFetchApp.fetch(getSyncUrl_(), {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      var data = JSON.parse(response.getContentText());
      if (data && data.success && data.data) {
        payload = data.data;
      }
    } else if (code === 401 || code === 403) {
      ss.toast('⚠️ Không có quyền truy cập. Vui lòng kiểm tra lại WEBHOOK_SECRET trong Script Properties.', 'Lỗi xác thực', 8);
      return;
    }
  } catch (err) {
    Logger.log('Không thể kéo dữ liệu trực tiếp: ' + err);
  }

  if (!payload || !payload.rows || payload.rows.length === 0) {
    ss.toast('⚠️ Không thể tải dữ liệu từ Web hoặc chưa có đăng ký nào. Vui lòng kiểm tra URL/Secret và kết nối mạng.', 'Thông báo', 6);
    return;
  }

  setupSheetFormatAndData_(sheet, payload);
  ss.toast('✅ Đã tạo cấu trúc bảng 17 cột và đồng bộ dữ liệu thành công!', 'Hoàn tất', 5);
}

/**
 * Thiết lập định dạng chuyên nghiệp chuẩn Fermat Workspace:
 * - 17 cột: Banner A1:Q1 xanh đậm #1D4ED8, Header A2:Q2 xanh nhạt #DBEAFE
 * - Đóng băng 2 dòng đầu và 4 cột đầu (A-D)
 * - Khóa màu xám nhạt #F8FAFC cho các cột đối tác (B-G)
 * - Cài đặt công thức STT tự động tại A3
 * - Dropdown chọn trạng thái (Cột N)
 * - Kẻ viền bảng xám #CBD5E1
 */
function setupSheetFormatAndData_(sheet, payload) {
  var rows = payload.rows;
  var numRows = Math.max(rows.length, 10);
  var numCols = HEADERS.length;

  // 1. Đảm bảo đủ số dòng và cột
  if (sheet.getMaxRows() < numRows + 10) {
    sheet.insertRowsAfter(sheet.getMaxRows(), numRows + 10 - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < numCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());
  }

  // 2. Xóa định dạng cũ
  sheet.getRange(1, 1, sheet.getMaxRows(), numCols).clear({ contentsOnly: false, formatOnly: true });

  // 3. Đóng băng 2 hàng đầu và 4 cột đầu
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(4);

  // 4. Chiều cao dòng
  sheet.setRowHeight(1, 38);
  sheet.setRowHeight(2, 32);
  for (var r = 3; r <= numRows; r++) {
    sheet.setRowHeight(r, 26);
  }

  // 5. Độ rộng cột
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);
  }

  // 6. Ghi dữ liệu
  if (rows && rows.length > 0) {
    sheet.getRange(1, 1, rows.length, numCols).setValues(rows);
  }

  // 7. Cài đặt công thức STT tại A3
  sheet.getRange('A3').setFormula('=ARRAYFORMULA(IF(D3:D=""; ""; COUNTIFS(D3:D; "<>"; ROW(D3:D); "<="&ROW(D3:D))))');

  // 8. Định dạng Banner Hàng 1
  var bannerRange = sheet.getRange(1, 1, 1, numCols);
  bannerRange.merge();
  bannerRange
    .setBackground('#1D4ED8')
    .setFontColor('#FFFFFF')
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  // 9. Định dạng Header Hàng 2
  var headerRange = sheet.getRange(2, 1, 1, numCols);
  headerRange
    .setBackground('#DBEAFE')
    .setFontColor('#1E3A8A')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  // 10. Định dạng các cột dữ liệu (từ hàng 3)
  if (numRows >= 3) {
    var fullTableRange = sheet.getRange(1, 1, numRows, numCols);
    fullTableRange.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // Căn lề từng cột
    sheet.getRange(3, 1, numRows - 2, 1).setHorizontalAlignment('center'); // A: STT
    sheet.getRange(3, 2, numRows - 2, 1).setHorizontalAlignment('center'); // B: Mã ĐK
    sheet.getRange(3, 3, numRows - 2, 1).setHorizontalAlignment('center'); // C: Mã KH
    sheet.getRange(3, 4, numRows - 2, 1).setHorizontalAlignment('left');   // D: Tên trường
    sheet.getRange(3, 5, numRows - 2, 1).setHorizontalAlignment('left');   // E: Tỉnh/TP
    sheet.getRange(3, 6, numRows - 2, 1).setHorizontalAlignment('left');   // F: Đầu mối
    sheet.getRange(3, 7, numRows - 2, 1).setHorizontalAlignment('center'); // G: SĐT
    sheet.getRange(3, 8, numRows - 2, 1).setHorizontalAlignment('left');   // H: Dịch vụ/SP
    sheet.getRange(3, 9, numRows - 2, 1).setHorizontalAlignment('center'); // I: Số lượng
    sheet.getRange(3, 10, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy'); // J: Bắt đầu
    sheet.getRange(3, 11, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy'); // K: Hết hạn
    sheet.getRange(3, 12, numRows - 2, 1).setHorizontalAlignment('center'); // L: Còn lại
    sheet.getRange(3, 13, numRows - 2, 1).setHorizontalAlignment('center'); // M: Tình trạng hạn
    sheet.getRange(3, 14, numRows - 2, 1).setHorizontalAlignment('center'); // N: Trạng thái
    sheet.getRange(3, 15, numRows - 2, 1).setHorizontalAlignment('left');   // O: Phụ trách
    sheet.getRange(3, 16, numRows - 2, 1).setHorizontalAlignment('left').setWrap(true); // P: Ghi chú
    sheet.getRange(3, 17, numRows - 2, 1).setHorizontalAlignment('center'); // Q: Cập nhật web

    // Khóa màu các cột cố định đối tác (B-G: Cột 2-7) nền xám nhạt #F8FAFC
    sheet.getRange(3, 2, numRows - 2, 6)
      .setBackground('#F8FAFC')
      .setFontColor('#475569');

    // Dropdown chọn Trạng thái (Cột N - Cột 14)
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Đang sử dụng', 'Tạm dừng', 'Đã hủy'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(3, 14, numRows - 2, 1).setDataValidation(statusRule);

    // Conditional formatting cho Cột N (Trạng thái) và Cột M (Tình trạng hạn)
    var statusRange = sheet.getRange(3, 14, numRows - 2, 1);
    var expiryRange = sheet.getRange(3, 13, numRows - 2, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Đang sử dụng')
        .setBackground('#DCFCE7')
        .setFontColor('#166534')
        .setRanges([statusRange, expiryRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Sắp hết hạn')
        .setBackground('#FEF9C3')
        .setFontColor('#854D0E')
        .setRanges([expiryRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Đã quá hạn')
        .setBackground('#FEE2E2')
        .setFontColor('#991B1B')
        .setRanges([expiryRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Tạm dừng')
        .setBackground('#F1F5F9')
        .setFontColor('#475569')
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Đã hủy')
        .setBackground('#E2E8F0')
        .setFontColor('#64748B')
        .setRanges([statusRange])
        .build(),
    ];
    sheet.setConditionalFormatRules(rules);
  }
}

/**
 * Tự động tạo trigger onEdit mà không cần vào menu đồng hồ.
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

  ss.toast('⚡ Đã kích hoạt Trigger tự động onEdit thành công!', 'Cài đặt Trigger', 5);
}

/**
 * Trình kích hoạt tự động khi người dùng sửa dữ liệu trên Google Sheet.
 */
function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var row = e.range.getRow();

  if (row < FIRST_DATA_ROW) return; // Bỏ qua chỉnh sửa ở dòng tiêu đề

  var sheetName = sheet.getName();
  if (sheetName !== TAB_NAME && sheetName !== 'Trang tính1' && sheetName !== 'Theo dõi dịch vụ') {
    return; // Bỏ qua chỉnh sửa ở các tab khác
  }

  var lastCol = Math.max(sheet.getLastColumn(), 17);
  var values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  var hasContent = values.some(function(cell) {
    return String(cell || '').trim() !== '';
  });
  if (!hasContent) return;

  var payload = {
    row: row,
    values: values,
    edited_at: new Date().toISOString(),
    sheet_name: sheetName,
  };

  sendToWebhook_(payload);
}

/**
 * Đồng bộ toàn bộ các dòng hiện có trên Google Sheet lên Web.
 */
function syncAllRowsToWeb() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Không có dòng dữ liệu nào để đồng bộ.', 'Thông báo');
    return;
  }

  var sheetName = sheet.getName();
  var lastCol = Math.max(sheet.getLastColumn(), 17);
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
    sendToWebhook_({ rows: batch, sheet_name: sheetName });
    Utilities.sleep(500);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Đã gửi ' + rowsPayload.length + ' dòng lên Web thành công.', 'Đồng bộ hoàn tất');
}

function sendToWebhook_(payload) {
  var url = getWebhookUrl_();
  var secret = getWebhookSecret_();
  var headers = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['X-Sheet-Webhook-Secret'] = secret;
  }

  var options = {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    Logger.log('Webhook kết quả: ' + response.getContentText());
  } catch (error) {
    Logger.log('Lỗi kết nối Webhook: ' + error);
  }
}
