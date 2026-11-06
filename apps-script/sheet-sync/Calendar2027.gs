/** Setup and verification for the existing bound 2027 calendar project. */
function setupCalendar2027Integration() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet.getId() !== '1e1lNQPDV-nr9MF1swK17Y32bWwuYyP2D2FDJbFnEwtw') {
    throw new Error('This setup belongs to the 2027 calendar only.');
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_URL')) {
    props.setProperty('WEBHOOK_URL', 'https://workspace.fermat.vn/api/work-schedule/sheet-webhook');
  }
  var triggers = ScriptApp.getProjectTriggers();
  ['onEditInstallable', 'onChangeInstallable'].forEach(function(handler) {
    if (!triggers.some(function(trigger) {
      return trigger.getHandlerFunction() === handler && trigger.getTriggerSourceId() === spreadsheet.getId();
    })) {
      var builder = ScriptApp.newTrigger(handler).forSpreadsheet(spreadsheet);
      if (handler === 'onEditInstallable') builder.onEdit().create();
      else builder.onChange().create();
    }
  });
  installAutoRetryTrigger();
  console.log(JSON.stringify({calendarYear: 2027, webhookConfigured: !!props.getProperty('WEBHOOK_URL'),
    secretConfigured: !!props.getProperty('WEBHOOK_SECRET'), triggerCount: ScriptApp.getProjectTriggers().length}));
}

function verifyCalendar2027Webhook() {
  if (SpreadsheetApp.getActiveSpreadsheet().getId() !== '1e1lNQPDV-nr9MF1swK17Y32bWwuYyP2D2FDJbFnEwtw') {
    throw new Error('Wrong calendar workbook.');
  }
  var result = sendFullSyncWebhook_(Utilities.getUuid(), 'calendar_2027_verification');
  console.log(JSON.stringify({ok: result.ok, httpStatus: (result.summary.match(/HTTP (\d+)/) || [])[1] || ''}));
  if (!result.ok) throw new Error('Calendar webhook verification failed; inspect configuration.');
}
