"""Read-only audit scoped to THCS Nguyen Du, with encrypted output."""
import base64,json,os,re,sqlite3
from pathlib import Path
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
root=Path('/home/workspace/ft-workspace-data')
report={'school':'THCS Nguyễn Du','current':[],'backupsChecked':[],'recovered':[],'remote':[]}
def inspect(path):
 with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as c:
  c.row_factory=sqlite3.Row
  columns={r[1] for r in c.execute('PRAGMA table_info(digital_training_trainingassessment)')}
  if not columns: return []
  wanted=['id','title','partner_id','public_slug','status','output_sheet_url','drive_folder_id','closed_at','backup_completed_at','sync_status','sync_error','created_at','trashed_at','purge_at']
  fields=','.join('a.'+field for field in wanted if field in columns)
  rows=c.execute(f'SELECT {fields} FROM digital_training_trainingassessment a LEFT JOIN digital_training_trainingpartner p ON p.id=a.partner_id WHERE p.name=? OR a.public_slug LIKE ?',('THCS Nguyễn Du','thcs-nguyen-du%')).fetchall()
  result=[]
  for row in rows:
   item=dict(row)
   attempts=c.execute('SELECT id,answers,status FROM digital_training_trainingassessmentattempt WHERE assessment_id=?',(item['id'],)).fetchall()
   item['attemptCount']=len(attempts)
   item['nonEmptyAnswers']=sum(bool(json.loads(a['answers'] or '{}')) for a in attempts)
   uploads=c.execute('SELECT u.drive_file_id,u.drive_url,u.file FROM digital_training_trainingassessmentupload u JOIN digital_training_trainingassessmentattempt a ON a.id=u.attempt_id WHERE a.assessment_id=?',(item['id'],)).fetchall()
   item['uploadCount']=len(uploads)
   item['driveUploadCount']=sum(bool(u['drive_file_id']) for u in uploads)
   item['localUploadCount']=sum(bool(u['file']) for u in uploads)
   item['sampleDriveFiles']=[dict(u) for u in uploads if u['drive_file_id']][:3]
   result.append(item)
  return result
report['current']=inspect(root/'workspace.sqlite3')
for path in sorted((root/'backups').glob('workspace-*.sqlite3'),reverse=True):
 try:
  rows=inspect(path)
  report['backupsChecked'].append({'name':path.name,'matches':len(rows)})
  if rows:
   report['recovered']=rows
   report['backup']=path.name
   break
 except Exception as error: report['backupsChecked'].append({'name':path.name,'error':str(error)[:250]})
try:
 from dotenv import load_dotenv
 load_dotenv('/var/www/ft-workspace/backend/.env')
 from google.oauth2 import service_account
 from googleapiclient.discovery import build
 info=json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
 info['private_key']=info['private_key'].replace('\\n','\n')
 credentials=service_account.Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/spreadsheets.readonly','https://www.googleapis.com/auth/drive.readonly'])
 sheets=build('sheets','v4',credentials=credentials,cache_discovery=False)
 drive=build('drive','v3',credentials=credentials,cache_discovery=False)
 for item in report['current'] or report['recovered']:
  remote={'assessmentId':item['id'],'files':[]}
  match=re.search(r'/spreadsheets/d/([^/]+)',item.get('output_sheet_url') or '')
  if match:
   sid=match.group(1)
   try:
    meta=sheets.spreadsheets().get(spreadsheetId=sid,fields='spreadsheetUrl,properties(title),sheets(properties(title,sheetId))').execute()
    remote['sheet']=meta
    remote['sheetCounts']=[]
    for tab in meta.get('sheets',[]):
     title=tab['properties']['title']
     if title.startswith('BÀI LÀM') or title=='DANH SÁCH BÀI LÀM':
      vals=sheets.spreadsheets().values().get(spreadsheetId=sid,range="'"+title.replace("'","''")+"'!A1:A500").execute().get('values',[])
      remote['sheetCounts'].append({'tab':title,'nonemptyRowsAfterHeader':sum(bool(r and r[0]) for r in vals[1:])})
   except Exception as error: remote['sheetError']=str(error)[:500]
  for upload in item.get('sampleDriveFiles',[]):
   try: remote['files'].append(drive.files().get(fileId=upload['drive_file_id'],fields='id,name,mimeType,trashed,webViewLink,size',supportsAllDrives=True).execute())
   except Exception as error: remote['files'].append({'id':upload['drive_file_id'],'error':str(error)[:350]})
  report['remote'].append(remote)
except Exception as error: report['remoteError']=str(error)[:500]
public_key=serialization.load_der_public_key(base64.b64decode(os.environ['AUDIT_PUBLIC_KEY']))
key=AESGCM.generate_key(bit_length=256)
nonce=os.urandom(12)
encrypted=AESGCM(key).encrypt(nonce,json.dumps(report,ensure_ascii=False).encode(),None)
wrapped=public_key.encrypt(key,padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
print('ENCRYPTED_TRAINING_AUDIT='+json.dumps({'wrappedKey':base64.b64encode(wrapped).decode(),'nonce':base64.b64encode(nonce).decode(),'ciphertext':base64.b64encode(encrypted).decode()}))
