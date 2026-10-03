"""Opt-in Drive archive. No network call occurs until explicitly enabled."""
import io
import json
import os
import re

from django.db import transaction
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from authentication.models import SystemConfig
from integrations.google_sheets import build_google_credentials
from .models import TransferProof


def folder_for(session):
    # Exact session routing takes precedence over the competition's shared folder.
    config = SystemConfig.objects.filter(key='examination_proof_drive').first()
    data = config.data or {} if config else {}
    sessions = data.get('sessionFolders', {})
    competitions = data.get('competitionFolders', {})
    if os.getenv('EXAMINATION_PROOF_DRIVE_FOLDERS', '').strip():
        competitions = json.loads(os.environ['EXAMINATION_PROOF_DRIVE_FOLDERS'])
    folder = str(sessions.get(session.pk) or competitions.get(session.competition_id) or competitions.get(session.code.upper()) or '').strip()
    if folder and not re.fullmatch(r'[a-zA-Z0-9_-]+', folder):
        raise ValueError('Cấu hình cần ID thư mục Drive, không phải URL.')
    return folder


def archive_pending(limit=100, service=None):
    config = SystemConfig.objects.filter(key='examination_proof_drive').first()
    enabled = bool((config.data or {}).get('enabled')) if config else False
    enabled = enabled or os.getenv('EXAMINATION_PROOF_DRIVE_ENABLED', '').lower() in {'true', '1'}
    summary = {'synced': 0, 'pendingConfiguration': 0, 'awaitingSession': 0, 'failed': 0, 'enabled': enabled}
    if not enabled:
        return summary
    ids = list(TransferProof.objects.filter(drive_file_id='').order_by('created_at').values_list('pk', flat=True)[:limit])
    for proof_id in ids:
        with transaction.atomic():
            proof = TransferProof.objects.select_for_update().select_related('session').get(pk=proof_id)
            if proof.drive_file_id:
                continue
            if not proof.session_id:
                summary['awaitingSession'] += 1
                continue
            try:
                folder = folder_for(proof.session)
                if not folder:
                    proof.drive_status = 'pending_configuration'
                    proof.save(update_fields=['drive_status'])
                    summary['pendingConfiguration'] += 1
                    continue
                if service is None:
                    main = SystemConfig.objects.filter(key='main').first()
                    credentials = build_google_credentials(main.last_google_access_token if main else None, main.data or {} if main else {}, scopes=['https://www.googleapis.com/auth/drive.file'])
                    service = build('drive', 'v3', credentials=credentials, cache_discovery=False)
                # A network success followed by a DB failure is safe to retry.
                found = service.files().list(q=f"'{folder}' in parents and trashed = false and appProperties has {{ key='examinationProofId' and value='{proof.pk}' }}", fields='files(id)', supportsAllDrives=True, includeItemsFromAllDrives=True).execute().get('files', [])
                file_id = found[0]['id'] if found else service.files().create(
                    body={'name': f'{proof.session.code}_{proof.pk}_{proof.filename}', 'parents': [folder], 'appProperties': {'examinationProofId': str(proof.pk), 'sessionId': proof.session_id}},
                    media_body=MediaIoBaseUpload(io.BytesIO(bytes(proof.image)), mimetype=proof.image_type, resumable=False),
                    fields='id', supportsAllDrives=True,
                ).execute()['id']
                proof.drive_file_id = file_id
                proof.drive_folder_id = folder
                proof.drive_status = 'synced'
                proof.drive_error = ''
                summary['synced'] += 1
            except Exception as exc:
                proof.drive_status = 'failed'
                proof.drive_error = str(exc)[:3000]
                summary['failed'] += 1
            proof.save()
    return summary
