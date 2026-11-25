/**
 * Bound script for the private form workbook "Phiếu đăng ký cá nhân tham dự các
 * cuộc thi năm học 2026–2027". It reads rows under the signed-in Sheet owner
 * and sends them to FT Workspace; the Sheet does not need public sharing.
 *
 * Script Properties (Project settings):
 *   WEBHOOK_URL = https://workspace.fermat.vn/api/examination/form-registration/webhook
 *   WEBHOOK_SECRET = same value as EXAMINATION_REGISTRATION_WEBHOOK_SECRET on server
 * Run installRegistrationTriggers() once. syncAllRegistrations() is manual repair only.
 */
var REGISTRATION_SPREADSHEET_ID = '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E';
var REGISTRATION_TABS = ['SIAIO', 'SIPhO, SIChO, SIBO, SILSO', 'FIMO, FIEO'];
// Network drops, gateway errors and Google's own "server error occurred" /
// DEADLINE_EXCEEDED clear by themselves: the queues keep every row for the
// next run. Only report them after about an hour of failed runs.
var TRANSIENT_ERROR = /timeout|timed out|hết thời gian|address unavailable|dns error|a server error occurred|lỗi máy chủ|deadline_exceeded|(?:trả mã|Workspace:|dòng Sheet:) 50[234]\b/i;
var FAILED_SYNC_RUNS_KEY = 'WORKSPACE_FAILED_SYNC_RUNS';
var FAILED_SYNC_RUNS_BEFORE_ALERT = 6;
// Small batches keep each webhook call well under UrlFetch's one-minute limit.
var BATCH_ROWS = 50;
// A time-based run may last six minutes; leave room for the Workspace pull.
var QUEUE_BUDGET_MS = 4 * 60 * 1000;
// The _SYNC_LOG tab records failed and recovered runs. Change the version on
// every paste into Apps Script: the next good run logs it, proving it is live.
var SYNC_LOG_TAB = '_SYNC_LOG';
var SYNC_LOG_VERSION = '2026-11-25b';
var SYNC_LOG_VERSION_KEY = 'WORKSPACE_SYNC_LOG_VERSION';
var FULL_RESYNC_VERSION_KEY = 'WORKSPACE_FULL_RESYNC_VERSION';

// Standard Form column order (the SIPhO tab). Staff insert columns such as
// "Hóa đơn" mid-tab, so both directions find each field by its header; a
// repeated header (contest choice, payment) takes its n-th occurrence.
// Keep in step with FORM_COLUMNS in backend/examination/form_registration.py.
var FORM_COLUMNS = [
  [0, /^dấu thời gian/], [1, /^địa chỉ email/], [2, /họ và tên thí sinh/], [3, /ngày sinh/],
  [4, /cccd|hộ chiếu/], [5, /email liên hệ/], [6, /tỉnh/], [7, /^xã|xã\//], [8, /địa chỉ hiện tại/],
  [9, /số điện thoại/], [10, /^trường/], [11, /^khối/], [12, /^chọn cuộc thi/],
  [13, /thanh toán|nộp lệ phí/], [14, /^chọn cuộc thi/], [15, /thanh toán|nộp lệ phí/],
  [16, /họ tên phụ huynh/], [17, /mã đăng ký workspace/]
];
var MARKER_HEADER = 'Mã đăng ký Workspace';

function headerKey_(value) {
  return String(value || '').trim().replace(/^\s*\d+\s*[.)]\s*/, '').toLowerCase();
}

function formLayout_(headers) {
  var keys = headers.map(headerKey_);
  var used = {};
  var layout = {};
  FORM_COLUMNS.forEach(function(spec) {
    for (var column = 0; column < keys.length; column++) {
      if (!used[column] && keys[column] && spec[1].test(keys[column])) {
        used[column] = true;
        layout[spec[0]] = column;
        return;
      }
    }
  });
  return layout;
}

function ensureColumns_(sheet, count) {
  if (sheet.getMaxColumns() < count) sheet.insertColumnsAfter(sheet.getMaxColumns(), count - sheet.getMaxColumns());
}

/** 0-based column of every standard field on this tab; adds the marker column when missing. */
function tabLayout_(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
  var layout = formLayout_(headers);
  if (layout[2] === undefined) {
    // No Form headers yet: the standard positions, marker in column R.
    layout = {};
    for (var index = 0; index < FORM_COLUMNS.length; index++) layout[index] = index;
    var current = String(headers[17] || '').trim();
    if (current && current !== MARKER_HEADER) throw new Error('Cột R của ' + sheet.getName() + ' đang được dùng.');
    if (!current) {
      ensureColumns_(sheet, 18);
      sheet.getRange(1, 18).setValue(MARKER_HEADER);
    }
    return layout;
  }
  if (layout[17] === undefined) {
    var taken = Object.keys(layout).map(function(key) { return layout[key]; });
    var freeR = !String(headers[17] || '').trim() && taken.indexOf(17) < 0;
    layout[17] = freeR ? 17 : headers.length;
    ensureColumns_(sheet, layout[17] + 1);
    sheet.getRange(1, layout[17] + 1).setValue(MARKER_HEADER);
  }
  return layout;
}

/** Standard-order values (as sent by Workspace) placed in this tab's real columns. */
function sheetRow_(layout, values) {
  var width = 0;
  Object.keys(layout).forEach(function(key) { width = Math.max(width, layout[key] + 1); });
  var row = [];
  for (var column = 0; column < width; column++) row.push('');
  Object.keys(layout).forEach(function(key) { row[layout[key]] = values[key]; });
  return row;
}

function sendRegistrationRows_(sheet, firstRow, count) {
  if (!sheet || REGISTRATION_TABS.indexOf(sheet.getName()) < 0 || count < 1) return;
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Cần WEBHOOK_URL và WEBHOOK_SECRET trong Script Properties.');
  var last = sheet.getLastRow();
  var start = Math.max(2, firstRow);
  var end = Math.min(last, firstRow + count - 1);
  if (end < start) return;
  var width = Math.min(30, Math.max(16, sheet.getLastColumn()));
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var values = sheet.getRange(start, 1, end - start + 1, width).getDisplayValues();
  var rows = values.map(function(value, index) { return {rowNumber: start + index, values: value}; });
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {'X-Examination-Webhook-Secret': secret},
    payload: JSON.stringify({
      spreadsheetId: REGISTRATION_SPREADSHEET_ID,
      sheetTab: sheet.getName(),
      headers: headers,
      rows: rows
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('FT Workspace trả mã ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  var result = JSON.parse(response.getContentText());
  if (result.errors && result.errors.length) {
    console.warn(sheet.getName() + ': ' + JSON.stringify(result.errors));
  }
}

function processRegistrationBatch_(key) {
  var props = PropertiesService.getScriptProperties();
  var value = props.getProperty(key);
  if (!value) return;
  var job;
  try {
    job = JSON.parse(value);
  } catch (error) {
    props.deleteProperty(key);
    logSyncRun_('Bỏ lô hỏng', key);
    return;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(job.tab);
  if (!sheet) {
    // A renamed or deleted tab can never be read again; keeping the job would
    // only fail every run.
    props.deleteProperty(key);
    logSyncRun_('Bỏ lô', 'Thiếu tab ' + job.tab + ', dòng ' + job.first + '–' + (job.first + job.count - 1));
    return;
  }
  var count = Math.min(BATCH_ROWS, job.count);
  sendRegistrationRows_(sheet, job.first, count);
  if (job.count > count) {
    job.first += count;
    job.count -= count;
    props.setProperty(key, JSON.stringify(job));
  } else {
    props.deleteProperty(key);
  }
}

function queueRegistrationRows_(sheet, first, count) {
  if (!sheet || REGISTRATION_TABS.indexOf(sheet.getName()) < 0) return;
  var end = Math.min(sheet.getLastRow(), first + count - 1);
  first = Math.max(2, first);
  if (end < first) return;
  var key = 'REG_DIRTY_' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    tab: sheet.getName(), first: first, count: end - first + 1, createdAt: Date.now()
  }));
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    processRegistrationBatch_(key);
  } catch (error) {
    if (TRANSIENT_ERROR.test(String(error))) {
      console.warn('Đã giữ dòng đăng ký trong hàng đợi để thử lại: ' + error);
      return;
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function queuedJob_(value) {
  try {
    var job = JSON.parse(value);
    return job && job.tab && job.first >= 2 && job.count >= 1 ? job : null;
  } catch (error) {
    return null;
  }
}

/**
 * Every cell edit queues its own job, so one busy afternoon can leave hundreds
 * of overlapping jobs. Merge them into one job per continuous row range.
 */
function compactRegistrationQueue_(props) {
  var values = props.getProperties();
  var keys = Object.keys(values).filter(function(key) { return key.indexOf('REG_DIRTY_') === 0; });
  if (keys.length < 2) return;
  var byTab = {};
  keys.forEach(function(key) {
    var job = queuedJob_(values[key]);
    if (!job) return;
    (byTab[job.tab] = byTab[job.tab] || []).push({
      first: job.first, last: job.first + job.count - 1, createdAt: job.createdAt || 0
    });
  });
  var merged = [];
  Object.keys(byTab).forEach(function(tab) {
    var current = null;
    byTab[tab].sort(function(a, b) { return a.first - b.first; }).forEach(function(range) {
      if (current && range.first <= current.last + 1) {
        current.last = Math.max(current.last, range.last);
        current.createdAt = Math.min(current.createdAt, range.createdAt);
      } else {
        current = {tab: tab, first: range.first, last: range.last, createdAt: range.createdAt};
        merged.push(current);
      }
    });
  });
  if (merged.length === keys.length) return;
  var next = {};
  merged.forEach(function(range) {
    next['REG_DIRTY_' + Utilities.getUuid()] = JSON.stringify({
      tab: range.tab, first: range.first, count: range.last - range.first + 1, createdAt: range.createdAt
    });
  });
  // Write the merged jobs before removing the old ones so no row is lost.
  props.setProperties(next);
  keys.forEach(function(key) { props.deleteProperty(key); });
}

/**
 * Send queued rows, oldest first, until the queue is empty or the time budget
 * runs out. One failing job never stops the others: errors are returned for
 * the caller to report after the rest of the sync has run.
 */
function retryRegistrationRows_(deadline) {
  var props = PropertiesService.getScriptProperties();
  compactRegistrationQueue_(props);
  var values = props.getProperties();
  var keys = Object.keys(values).filter(function(key) { return key.indexOf('REG_DIRTY_') === 0; })
    .sort(function(a, b) {
      var jobA = queuedJob_(values[a]), jobB = queuedJob_(values[b]);
      return (jobA ? jobA.createdAt : 0) - (jobB ? jobB.createdAt : 0);
    });
  var errors = [];
  for (var index = 0; index < keys.length && Date.now() < deadline; index++) {
    try {
      do {
        processRegistrationBatch_(keys[index]);
      } while (props.getProperty(keys[index]) && Date.now() < deadline);
    } catch (error) {
      errors.push(error);
      // Workspace unreachable: every other job would wait for the same timeout.
      if (TRANSIENT_ERROR.test(String(error))) break;
    }
  }
  return errors;
}

function onRegistrationEdit(e) {
  if (!e || !e.range || !e.source || e.source.getId() !== REGISTRATION_SPREADSHEET_ID) return;
  queueRegistrationRows_(e.range.getSheet(), e.range.getRow(), e.range.getNumRows());
}

function onRegistrationFormSubmit(e) {
  if (!e || !e.range || !e.source || e.source.getId() !== REGISTRATION_SPREADSHEET_ID) return;
  queueRegistrationRows_(e.range.getSheet(), e.range.getRow(), 1);
}

/**
 * Queue every row instead of sending it here: a large sheet would outlast the
 * six-minute run. The 10-minute trigger drains the rest within its budget.
 */
function queueAllRegistrationRows_(book) {
  var props = PropertiesService.getScriptProperties();
  REGISTRATION_TABS.forEach(function(name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) throw new Error('Thiếu tab ' + name);
    if (sheet.getLastRow() < 2) return;
    props.setProperty('REG_DIRTY_' + Utilities.getUuid(), JSON.stringify({
      tab: name, first: 2, count: sheet.getLastRow() - 1, createdAt: Date.now()
    }));
  });
}

/**
 * The first run of each new script version re-sends every row once, so rows
 * missed while an older version was failing reach Workspace without anyone
 * having to run syncAllRegistrations by hand. Rows are matched, not duplicated.
 */
function queueFullResyncOnce_(book) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(FULL_RESYNC_VERSION_KEY) === SYNC_LOG_VERSION) return;
  queueAllRegistrationRows_(book);
  props.setProperty(FULL_RESYNC_VERSION_KEY, SYNC_LOG_VERSION);
  logSyncRun_('Gửi lại toàn bộ', 'Đã xếp hàng mọi dòng cho phiên bản ' + SYNC_LOG_VERSION);
}

function syncAllRegistrations() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  queueAllRegistrationRows_(book);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var errors = retryRegistrationRows_(Date.now() + QUEUE_BUDGET_MS);
    if (errors.length) throw errors[0];
  } finally {
    lock.releaseLock();
  }
}

function logSyncRun_(status, detail) {
  try {
    var book = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName(SYNC_LOG_TAB) || book.insertSheet(SYNC_LOG_TAB);
    sheet.appendRow([new Date(), status, String(detail).slice(0, 300)]);
  } catch (error) {
    // The log only reports on the sync; it must never fail the sync itself.
    console.warn('Không ghi được ' + SYNC_LOG_TAB + ': ' + error);
  }
}

/** Copy registrations entered on Workspace back to the original private Form tabs. */
function syncWorkspaceRegistrations() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var props = PropertiesService.getScriptProperties();
  try {
    syncWorkspaceRegistrations_();
    var failedBefore = Number(props.getProperty(FAILED_SYNC_RUNS_KEY) || 0);
    if (failedBefore) {
      logSyncRun_('Đã phục hồi', 'Sau ' + failedBefore + ' lượt lỗi liên tiếp');
      props.deleteProperty(FAILED_SYNC_RUNS_KEY);
    }
    if (props.getProperty(SYNC_LOG_VERSION_KEY) !== SYNC_LOG_VERSION) {
      logSyncRun_('Phiên bản mới', SYNC_LOG_VERSION);
      props.setProperty(SYNC_LOG_VERSION_KEY, SYNC_LOG_VERSION);
    }
  } catch (error) {
    if (!TRANSIENT_ERROR.test(String(error))) {
      logSyncRun_('Lỗi', error);
      throw error;
    }
    var failedRuns = Number(props.getProperty(FAILED_SYNC_RUNS_KEY) || 0) + 1;
    props.setProperty(FAILED_SYNC_RUNS_KEY, String(failedRuns));
    logSyncRun_('Lỗi tạm thời', 'Lượt ' + failedRuns + ': ' + error);
    if (failedRuns >= FAILED_SYNC_RUNS_BEFORE_ALERT) throw error;
    console.warn('Workspace tạm thời không phản hồi; sẽ thử lại: ' + error);
  } finally {
    lock.releaseLock();
  }
}

function syncWorkspaceRegistrations_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  queueFullResyncOnce_(book);
  var queueErrors = retryRegistrationRows_(Date.now() + QUEUE_BUDGET_MS);
  pullWorkspaceRegistrations_();
  // Report queue failures only after the Workspace pull had its turn.
  if (queueErrors.length) throw queueErrors[0];
}

function pullWorkspaceRegistrations_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Cần WEBHOOK_URL và WEBHOOK_SECRET trong Script Properties.');
  var base = url.replace(/\/webhook\/?$/, '');
  if (base === url) throw new Error('WEBHOOK_URL cần kết thúc bằng /webhook.');
  var options = {
    method: 'post', contentType: 'application/json',
    headers: {'X-Examination-Webhook-Secret': secret},
    payload: '{}', muteHttpExceptions: true
  };
  // The database queue retains every unacknowledged registration for the next run.
  var response = UrlFetchApp.fetch(base + '/workspace-pending', options);
  if (response.getResponseCode() !== 200) throw new Error('Không thể lấy đăng ký Workspace: ' + response.getResponseCode());
  var pending = JSON.parse(response.getContentText()).registrations || [];
  var markerIndexes = {};
  var layouts = {};
  pending.forEach(function(item) {
    Object.keys(item.tabs || {}).forEach(function(tab) {
      if (REGISTRATION_TABS.indexOf(tab) < 0) throw new Error('Tab không hợp lệ: ' + tab);
      var sheet = book.getSheetByName(tab);
      if (!sheet) throw new Error('Thiếu tab ' + tab);
      if (!layouts[tab]) layouts[tab] = tabLayout_(sheet);
      var layout = layouts[tab];
      if (!markerIndexes[tab]) {
        var indexByMarker = {};
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var existing = sheet.getRange(2, layout[17] + 1, lastRow - 1, 1).getDisplayValues();
          for (var index = 0; index < existing.length; index++) {
            if (existing[index][0]) indexByMarker[existing[index][0]] = index + 2;
          }
        }
        markerIndexes[tab] = indexByMarker;
      }
      var marker = 'WORKSPACE:' + item.registrationId;
      var rowNumber = markerIndexes[tab][marker] || 0;
      if (!rowNumber) {
        var values = item.tabs[tab];
        if (!Array.isArray(values) || values.length !== 18 || values[17] !== marker) throw new Error('Dòng đăng ký không hợp lệ.');
        sheet.appendRow(sheetRow_(layout, values));
        rowNumber = sheet.getLastRow();
        markerIndexes[tab][marker] = rowNumber;
      }
      var ack = UrlFetchApp.fetch(base + '/workspace-ack', {
        method: 'post', contentType: 'application/json',
        headers: {'X-Examination-Webhook-Secret': secret},
        payload: JSON.stringify({registrationId: item.registrationId, sheetTab: tab, rowNumber: rowNumber}),
        muteHttpExceptions: true
      });
      if (ack.getResponseCode() !== 200) throw new Error('Không thể xác nhận dòng Sheet: ' + ack.getResponseCode());
    });
  });
}

function installRegistrationTriggers() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  var handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  if (handlers.indexOf('onRegistrationEdit') < 0) {
    ScriptApp.newTrigger('onRegistrationEdit').forSpreadsheet(book).onEdit().create();
  }
  if (handlers.indexOf('onRegistrationFormSubmit') < 0) {
    ScriptApp.newTrigger('onRegistrationFormSubmit').forSpreadsheet(book).onFormSubmit().create();
  }
  // Historical rows are imported by the onEdit/onFormSubmit triggers; a full
  // sweep is available manually and should not run every 10 minutes.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncAllRegistrations') ScriptApp.deleteTrigger(trigger);
  });
  if (handlers.indexOf('syncWorkspaceRegistrations') < 0) {
    ScriptApp.newTrigger('syncWorkspaceRegistrations').timeBased().everyMinutes(10).create();
  }
}
