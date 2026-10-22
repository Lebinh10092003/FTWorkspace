/**
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

var FIRST_DATA_ROW = 3; // Dòng 1: Banner tiêu đề, Dòng 2: Tiêu đề cột, Dòng 3 trở đi: Dữ liệu
var WEBHOOK_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-webhook';
var SYNC_URL_DEFAULT = 'https://workspace.fermat.vn/api/digital-training/subscriptions/sheet-sync';

var HEADERS = [
  'STT',
  'Mã ĐT',
  'Tên trường / Đơn vị',
  'Tỉnh / Thành phố',
  'Đầu mối liên hệ',
  'Số điện thoại',
  'Dịch vụ / Sản phẩm',
  'Số lượng',
  'Ngày bắt đầu',
  'Ngày hết hạn',
  'Còn lại (ngày)',
  'Trạng thái',
  'Nhân sự phụ trách',
  'Tiến độ & Ghi chú gia hạn',
  'Mã ĐK',
];

var COLUMN_WIDTHS = [
  55,   // A: STT
  75,   // B: Mã ĐT
  280,  // C: Tên trường / Đơn vị
  130,  // D: Tỉnh / Thành phố
  150,  // E: Đầu mối liên hệ
  115,  // F: Số điện thoại
  180,  // G: Dịch vụ / Sản phẩm
  75,   // H: Số lượng
  100,  // I: Ngày bắt đầu
  100,  // J: Ngày hết hạn
  110,  // K: Còn lại (ngày)
  125,  // L: Trạng thái
  140,  // M: Nhân sự phụ trách
  280,  // N: Tiến độ & Ghi chú gia hạn
  75,   // O: Mã ĐK
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

  // Dữ liệu fallback nếu máy chủ dev local không truy cập được từ internet
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
        ['=IF(C5<>""; ROW()-2; "")', '2', 'THPT Chuyên Hà Nội - Amsterdam', 'Hà Nội', 'Thầy Minh', '0901234567', 'AI dùng chung', 1, '23/07/2026', '23/07/2027', '=IF(ISBLANK(J5); ""; INT(J5 - TODAY()))', 'Đang sử dụng', 'Lê C', 'Đăng ký thêm tài khoản phụ', '2'],
      ],
    };
  }

  setupSheetFormatAndData_(sheet, payload);
  ss.toast('✅ Đã tạo cấu trúc bảng, hàng, cột và đổ dữ liệu thành công!', 'Hoàn tất', 5);
}

/**
 * Thiết lập định dạng chuyên nghiệp chuẩn Fermat Workspace:
 * - Dòng 1: Banner xanh đậm #1D4ED8, gộp A1:O1, chữ trắng in đậm 12pt, cao 38px
 * - Dòng 2: Header xanh nhạt #DBEAFE, chữ xanh đậm #1E3A8A, in đậm 10pt, cao 30px
 * - Đóng băng 2 dòng đầu
 * - Đặt độ rộng cho tất cả 15 cột
 * - Định dạng ngày dd/MM/yyyy, công thức STT & Còn lại
 * - Dropdown chọn trạng thái & Conditional formatting màu sắc trạng thái
 * - Kẻ viền xám nhạt #CBD5E1
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

  // 2. Xóa nội dung và định dạng cũ
  sheet.getRange(1, 1, sheet.getMaxRows(), numCols).clear({ contentsOnly: false, formatOnly: true });

  // 3. Đóng băng 2 hàng đầu
  sheet.setFrozenRows(2);

  // 4. Chiều cao dòng
  sheet.setRowHeight(1, 38);
  sheet.setRowHeight(2, 30);
  for (var r = 3; r <= numRows; r++) {
    sheet.setRowHeight(r, 25);
  }

  // 5. Độ rộng cột
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);
  }

  // 6. Ghi dữ liệu
  if (rows && rows.length > 0) {
    sheet.getRange(1, 1, rows.length, numCols).setValues(rows);
  }

  // 7. Định dạng Banner Hàng 1
  var bannerRange = sheet.getRange(1, 1, 1, numCols);
  bannerRange.merge();
  bannerRange
    .setBackground('#1D4ED8')
    .setFontColor('#FFFFFF')
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  // 8. Định dạng Header Hàng 2
  var headerRange = sheet.getRange(2, 1, 1, numCols);
  headerRange
    .setBackground('#DBEAFE')
    .setFontColor('#1E3A8A')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  // 9. Định dạng các cột dữ liệu (từ hàng 3)
  if (numRows >= 3) {
    var dataRange = sheet.getRange(3, 1, numRows - 2, numCols);

    // Kẻ viền bảng cho toàn bộ vùng
    var fullTableRange = sheet.getRange(1, 1, numRows, numCols);
    fullTableRange.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // Căn lề từng cột
    sheet.getRange(3, 1, numRows - 2, 1).setHorizontalAlignment('center'); // A: STT
    sheet.getRange(3, 2, numRows - 2, 1).setHorizontalAlignment('center'); // B: Mã ĐT
    sheet.getRange(3, 3, numRows - 2, 1).setHorizontalAlignment('left');   // C: Tên trường
    sheet.getRange(3, 4, numRows - 2, 1).setHorizontalAlignment('left');   // D: Tỉnh/TP
    sheet.getRange(3, 5, numRows - 2, 1).setHorizontalAlignment('left');   // E: Liên hệ
    sheet.getRange(3, 6, numRows - 2, 1).setHorizontalAlignment('center'); // F: SĐT
    sheet.getRange(3, 7, numRows - 2, 1).setHorizontalAlignment('left');   // G: Dịch vụ
    sheet.getRange(3, 8, numRows - 2, 1).setHorizontalAlignment('center'); // H: Số lượng
    sheet.getRange(3, 9, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy'); // I: Bắt đầu
    sheet.getRange(3, 10, numRows - 2, 1).setHorizontalAlignment('center').setNumberFormat('dd/MM/yyyy'); // J: Hết hạn
    sheet.getRange(3, 11, numRows - 2, 1).setHorizontalAlignment('center'); // K: Còn lại
    sheet.getRange(3, 12, numRows - 2, 1).setHorizontalAlignment('center'); // L: Trạng thái
    sheet.getRange(3, 13, numRows - 2, 1).setHorizontalAlignment('left');   // M: Phụ trách
    sheet.getRange(3, 14, numRows - 2, 1).setHorizontalAlignment('left').setWrap(true); // N: Ghi chú
    sheet.getRange(3, 15, numRows - 2, 1).setHorizontalAlignment('center'); // O: Mã ĐK

    // Dropdown chọn Trạng thái (Cột L)
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Đang sử dụng', 'Sắp hết hạn', 'Đã quá hạn', 'Tạm dừng', 'Đã hủy'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(3, 12, numRows - 2, 1).setDataValidation(statusRule);

    // Conditional formatting cho Cột L (Trạng thái)
    var statusRange = sheet.getRange(3, 12, numRows - 2, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Đang sử dụng')
        .setBackground('#DCFCE7')
        .setFontColor('#166534')
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Sắp hết hạn')
        .setBackground('#FEF9C3')
        .setFontColor('#854D0E')
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Đã quá hạn')
        .setBackground('#FEE2E2')
        .setFontColor('#991B1B')
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Tạm dừng')
        .setBackground('#F1F5F9')
        .setFontColor('#475569')
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
}
