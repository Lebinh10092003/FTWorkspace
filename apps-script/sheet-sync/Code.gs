/**
 * Realtime Sheet -> Web sync trigger for "Lịch công tác FT 2026 mới"
 * (spreadsheet 1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc, tab "Lịch công tác").
 *
 * This file is kept in the FTWorkspace repo (apps-script/sheet-sync/Code.gs) so the logic is
 * reviewable and versioned, but the code that actually runs lives in the Sheet's own
 * Script Editor (Extensions -> Apps Script) — paste this file's contents there by hand,
 * there is no API access to deploy Apps Script projects from this repo.
 *
 * Companion backend endpoint: POST /api/work-schedule/sheet-webhook
 * (backend/work_schedule/views.py::work_schedule_sheet_webhook).
 *
 * One-time setup in the Script Editor:
 *   1. Project Settings -> Script Properties, add:
 *        WEBHOOK_URL    = https://<your-backend-host>/api/work-schedule/sheet-webhook
 *        WEBHOOK_SECRET = <same value as backend SHEET_WEBHOOK_SECRET>
 *   2. Triggers (clock icon in the left sidebar) -> Add Trigger:
 *        Function: onEditInstallable | Event source: From spreadsheet | Event type: On edit
 *   3. Add a second trigger:
 *        Function: onChangeInstallable | Event source: From spreadsheet | Event type: On change
 *      (an installable trigger, not the bare `onEdit(e)` simple trigger, because UrlFetchApp
 *      needs authorization that simple triggers are not allowed to request).
 */

var SHEET_NAME = 'Lịch công tác';
var OUTBOX_SHEET_NAME = '_SYNC_OUTBOX';
var FIRST_DATA_ROW = 3; // row 1 is the title and row 2 contains the column headers.
var FORMAT_SELECTION_PROPERTY = 'LAST_SCHEDULE_FORMAT_SELECTION';
var FORMAT_SELECTION_MAX_AGE_MS = 5 * 60 * 1000;
var FORMAT_SELECTION_MAX_ROWS = 100;
var OUTBOX_GROWTH_PROPERTY = 'LAST_INTERNAL_OUTBOX_GROWTH_AT';
var OUTBOX_GROWTH_MAX_AGE_MS = 15 * 1000;

// Installable trigger entry point. Wire this up via Triggers -> Add Trigger -> On edit.
function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return; // ignore edits on Danh mục/Hướng dẫn/Quy trình/_SYNC_OUTBOX

  var firstRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  for (var offset = 0; offset < numRows; offset++) {
    var row = firstRow + offset;
    if (row < FIRST_DATA_ROW) continue; // skip header row edits
    handleRowEdit_(sheet, row, e);
  }
}

// Simple trigger. Google does not include a range in an installable onChange
// event, so keep the last selected schedule range for a later FORMAT event.
// Keep this handler deliberately lightweight: reading rich text here made
// concurrent selection events race and allowed an older row to overwrite the
// latest selection before the FORMAT event was processed.
function onSelectionChange(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  var firstRow = Math.max(FIRST_DATA_ROW, range.getRow());
  var lastRow = range.getLastRow();
  var numRows = lastRow - firstRow + 1;
  if (numRows < 1 || numRows > FORMAT_SELECTION_MAX_ROWS) return;

  var selection = {
    sheet_id: sheet.getSheetId(),
    first_row: firstRow,
    num_rows: numRows,
    recorded_at: Date.now(),
    // The baseline is captured lazily by onChangeInstallable. A simple
    // selection trigger should not perform an extra Sheets read.
    fingerprint: '',
  };
  var lock = LockService.getDocumentLock();
  try {
    if (!lock.tryLock(1000)) return;
    PropertiesService.getDocumentProperties().setProperty(
      FORMAT_SELECTION_PROPERTY,
      JSON.stringify(selection),
    );
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // The lock may not have been acquired before a transient trigger error.
    }
  }
}

// Structural row operations do not emit row-level onEdit events. Reconcile the
// retained window after a real row insertion/deletion. Do not treat OTHER as a
// structural edit: Google emits it for unrelated changes and it caused needless
// full syncs while the backend was formatting or repairing rows.
function onChangeInstallable(e) {
  if (!e || !e.source) return;
  var changeType = String(e.changeType || 'OTHER');
  if (changeType === 'FORMAT') {
    // Formatting-only edits do not fire onEdit and onChange has no range.
    // Resolve the last selected range from the schedule tab, even if the user
    // has already switched to another tab while the trigger was queued.
    var selection = rememberedFormatSelection_(e.source);
    if (!selection) return;
    var sheet = e.source.getSheetByName(SHEET_NAME);
    var firstRow = selection.first_row;
    var numRows = selection.num_rows;
    for (var offset = 0; offset < numRows; offset++) {
      var row = firstRow + offset;
      if (row >= FIRST_DATA_ROW) handleRowEdit_(sheet, row, e);
    }
    return;
  }
  if (changeType === 'INSERT_ROW' && consumeRecentOutboxGrowth_()) return;
  var sheet = e.source.getActiveSheet();
  if (!sheet || sheet.getName() !== SHEET_NAME) return;
  if (['INSERT_ROW', 'REMOVE_ROW'].indexOf(changeType) === -1) return;

  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var lastRun = Number(props.getProperty('LAST_STRUCTURAL_SYNC_AT') || 0);
  if (now - lastRun < 10000) return;
  props.setProperty('LAST_STRUCTURAL_SYNC_AT', String(now));

  var eventId = Utilities.getUuid();
  var payload = { event_type: 'full_sync', sheet_name: SHEET_NAME, reason: changeType };
  var outboxRow = appendToOutbox_(eventId, 1, payload);
  var result = sendFullSyncWebhook_(eventId, changeType);
  markOutboxResult_(outboxRow, result);
}

function consumeRecentOutboxGrowth_() {
  var props = PropertiesService.getDocumentProperties();
  var raw = props.getProperty(OUTBOX_GROWTH_PROPERTY);
  if (!raw) return false;
  props.deleteProperty(OUTBOX_GROWTH_PROPERTY);
  var timestamp = Number(raw);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= OUTBOX_GROWTH_MAX_AGE_MS;
}

function rememberedFormatSelection_(spreadsheet) {
  var raw = PropertiesService.getDocumentProperties().getProperty(FORMAT_SELECTION_PROPERTY);
  if (!raw) return null;

  var selection;
  try {
    selection = JSON.parse(raw);
  } catch (error) {
    return null;
  }
  if (!selection || !selection.first_row || !selection.num_rows || !selection.recorded_at) return null;
  if (Date.now() - Number(selection.recorded_at) > FORMAT_SELECTION_MAX_AGE_MS) return null;

  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet || Number(selection.sheet_id) !== sheet.getSheetId()) return null;
  if (selection.first_row < FIRST_DATA_ROW || selection.num_rows > FORMAT_SELECTION_MAX_ROWS) return null;

  var currentFingerprint = contentFormatFingerprint_(sheet, selection.first_row, selection.num_rows);
  if (!currentFingerprint) return null;
  if (selection.fingerprint && currentFingerprint === selection.fingerprint) return null;

  // Advance the watermark before sending the row. If Google emits duplicate
  // FORMAT events, the same format change must not create duplicate web writes.
  selection.fingerprint = currentFingerprint;
  selection.recorded_at = Date.now();
  PropertiesService.getDocumentProperties().setProperty(
    FORMAT_SELECTION_PROPERTY,
    JSON.stringify(selection),
  );
  return selection;
}

function contentFormatFingerprint_(sheet, firstRow, numRows) {
  try {
    var contentColumn = contentColumn_(sheet);
    var richValues = sheet.getRange(firstRow, contentColumn, numRows, 1).getRichTextValues();
    return JSON.stringify(richValues.map(function(row) {
      var richText = row && row[0];
      if (!richText) return [];
      return richText.getRuns().map(function(run) {
        var style = run.getTextStyle();
        return [
          Number(run.getStartIndex() || 0),
          String(run.getText() || ''),
          !!(style && style.isBold && style.isBold() === true),
          !!(style && style.isItalic && style.isItalic() === true),
        ];
      });
    }));
  } catch (error) {
    return '';
  }
}

function contentColumn_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 5);
  var headers = sheet.getRange(2, 1, 1, lastColumn).getDisplayValues()[0];
  for (var index = 0; index < headers.length; index++) {
    var header = String(headers[index] || '').replace(/\s+/g, ' ').trim();
    if (header === 'Nội dung công việc') return index + 1;
  }
  return 5;
}

function handleRowEdit_(sheet, row, event) {
  // Keep the payload identical to the backend's Google Sheets read path
  // (valueRenderOption=FORMATTED_VALUE). getValues() turns date cells into
  // Date objects which JSON serializes as UTC and can shift the calendar day.
  // Read through the actual last header instead of assuming A:K. The visible
  // layout can gain columns (for example "Chấm công") while backend metadata
  // columns move to the right.
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var eventId = Utilities.getUuid();
  var payload = {
    row: row,
    values: values,
    edited_at: new Date().toISOString(),
    editor_email: currentEditorEmail_(event),
    sheet_name: SHEET_NAME,
  };
  var outboxRow = appendToOutbox_(eventId, row, payload);
  var result = sendWebhook_(eventId, row, payload);
  markOutboxResult_(outboxRow, result);
}

function appendToOutbox_(eventId, row, payload) {
  var outbox = ensureOutboxSheet_();
  var editedAt = payload && payload.edited_at ? payload.edited_at : new Date().toISOString();
  var values = [[
    eventId,
    row,
    editedAt,
    JSON.stringify(payload),
    'pending', // status: pending -> sent | error
    '', // response summary
    '', // processed_at
  ]];
  // appendRow() may insert physical rows when the hidden outbox reaches its
  // current grid size. That emits INSERT_ROW and can trigger an unintended
  // full schedule sync while the real row event is still being processed.
  // Write into the next existing row instead; serialize concurrent triggers so
  // two events cannot choose the same destination row.
  var lock = LockService.getDocumentLock();
  lock.waitLock(5000);
  try {
    var nextRow = Math.max(outbox.getLastRow() + 1, 2);
    if (nextRow > outbox.getMaxRows()) {
      PropertiesService.getDocumentProperties().setProperty(
        OUTBOX_GROWTH_PROPERTY,
        String(Date.now()),
      );
      outbox.insertRowsAfter(outbox.getMaxRows(), Math.max(100, nextRow - outbox.getMaxRows()));
    }
    outbox.getRange(nextRow, 1, 1, values[0].length).setValues(values);
    return nextRow;
  } finally {
    lock.releaseLock();
  }
}

function currentEditorEmail_(event) {
  try {
    if (event && event.user && typeof event.user.getEmail === 'function') {
      var eventEmail = String(event.user.getEmail() || '').trim().toLowerCase();
      if (eventEmail) return eventEmail;
    }
  } catch (error) {
    // Some domains hide the event user's email from installable triggers.
  }
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (error) {
    return '';
  }
}

function markOutboxResult_(outboxRow, result) {
  var outbox = ensureOutboxSheet_();
  outbox.getRange(outboxRow, 5, 1, 3).setValues([[
    result.ok ? 'sent' : 'error',
    result.summary,
    new Date(),
  ]]);
}

function sendWebhook_(eventId, row, payload) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) {
    return { ok: false, summary: 'Thiếu WEBHOOK_URL/WEBHOOK_SECRET trong Script Properties.' };
  }
  var requestPayload = {
    event_id: eventId,
    row: row,
    values: Array.isArray(payload) ? payload : (payload && payload.values) || [],
  };
  if (payload && !Array.isArray(payload)) {
    if (payload.edited_at) requestPayload.edited_at = payload.edited_at;
    if (payload.editor_email) requestPayload.editor_email = payload.editor_email;
    if (payload.sheet_name) requestPayload.sheet_name = payload.sheet_name;
  }
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Webhook-Secret': secret },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code === 200) {
      return { ok: true, summary: 'HTTP 200: ' + body.substring(0, 300) };
    }
    return { ok: false, summary: 'HTTP ' + code + ': ' + body.substring(0, 300) };
  } catch (error) {
    return { ok: false, summary: 'Lỗi UrlFetchApp: ' + error };
  }
}

function sendFullSyncWebhook_(eventId, reason) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) {
    return { ok: false, summary: 'Thiếu WEBHOOK_URL/WEBHOOK_SECRET trong Script Properties.' };
  }
  var payload = {
    event_id: eventId,
    event_type: 'full_sync',
    sheet_name: SHEET_NAME,
    reason: reason || 'structural_change',
  };
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Webhook-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    return { ok: code === 200 || code === 202, summary: 'HTTP ' + code + ': ' + body.substring(0, 300) };
  } catch (error) {
    return { ok: false, summary: 'Lỗi UrlFetchApp: ' + error };
  }
}

function ensureOutboxSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var outbox = spreadsheet.getSheetByName(OUTBOX_SHEET_NAME);
  if (!outbox) {
    outbox = spreadsheet.insertSheet(OUTBOX_SHEET_NAME);
    outbox.getRange(1, 1, 1, 7).setValues([[
      'event_id', 'row', 'edited_at', 'values_json', 'status', 'response', 'processed_at'
    ]]);
    outbox.hideSheet();
  }
  return outbox;
}

// Compatibility no-op for the legacy time-driven trigger. The realtime
// onEdit/onChange triggers now own synchronization; keep the old trigger
// harmless until its owner removes it from the Apps Script project.
function watchdogSheetChanges() {}

/**
 * Manual retry helper: re-sends every outbox row still marked "error" or "pending".
 * Run this by hand from the Script Editor (Run -> retryFailedOutboxRows) after fixing
 * whatever caused the failures (e.g. backend was briefly down) — there is no automatic
 * retry loop, matching the brief's "chỉ đánh dấu đã xử lý sau khi backend trả 200".
 */
function retryFailedOutboxRows() {
  var outbox = ensureOutboxSheet_();
  var lastRow = outbox.getLastRow();
  if (lastRow < 2) return;
  var rows = outbox.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < rows.length; i++) {
    var status = rows[i][4];
    if (status === 'sent') continue;
    var eventId = rows[i][0];
    var row = rows[i][1];
    var payload = JSON.parse(rows[i][3]);
    var result = payload && payload.event_type === 'full_sync'
      ? sendFullSyncWebhook_(eventId, payload.reason)
      : sendWebhook_(eventId, row, payload);
    markOutboxResult_(i + 2, result);
  }
}
