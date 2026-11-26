/** Called by the existing invitation handler after it verifies a confirmation link. */
function syncFimoBatch2Confirmation_(candidateCode) {
  var secret = (PropertiesService.getScriptProperties().getProperty('FIMO_BATCH_2_WEBHOOK_SECRET') || '').trim();
  if (secret.length < 32) {
    throw new Error('Chưa cấu hình kết nối xác nhận FIMO với FT Workspace.');
  }

  var url = 'https://workspace.fermat.vn/api/examination/fimo/batch-2/confirmation';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {'X-Examination-Webhook-Secret': secret},
    payload: JSON.stringify({candidateCode: String(candidateCode || '').trim().toUpperCase()}),
    followRedirects: false,
    muteHttpExceptions: true
  };

  for (var attempt = 0; attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(attempt * 750);
    var response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (error) {
      console.warn('Không kết nối được webhook xác nhận FIMO.');
      continue;
    }
    var code = response.getResponseCode();
    if (code === 200) {
      var result = JSON.parse(response.getContentText());
      if (result.status === 'added' || result.status === 'already_assigned') return;
    }
    console.warn('Webhook xác nhận FIMO trả mã ' + code + '.');
    if (code !== 429 && code < 500) break;
  }

  throw new Error('Chưa thể xác nhận trên Workspace. Vui lòng bấm xác nhận lại hoặc liên hệ Khảo thí.');
}
