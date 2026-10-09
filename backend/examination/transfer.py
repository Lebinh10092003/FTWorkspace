"""Move a registration to another contest ("đổi môn thi"), e.g. FIMO -> FIEO.

The registration keeps its school group and fee (or its own paid bill) in the
new session. Round results, SBD and room of the old session are not carried
over: every session only holds its own results. Both Sheet tabs follow through
the participation signals (row removed from the old tab, added to the new).
"""
from django.db import transaction

from .models import CandidateParticipation, ExaminationBillingRecord


def refresh_school_group(group):
    if group is None:
        return
    from .school_import import refresh_group_billing
    refresh_group_billing(group)


def _partner_for(group):
    from .school_import import partner_rows
    return next((item for item in partner_rows() if item['id'] == group.partner_id), None) or {
        'id': group.partner_id, 'school': group.school}


@transaction.atomic
def transfer_participation(participation, target, room_choice=None, actor=''):
    """Returns (new participation, summary text)."""
    from .school_import import attach_to_school, has_individual_accounting
    source = participation.session
    candidate = participation.candidate
    if target.pk == source.pk:
        raise ValueError('Hãy chọn một cuộc thi khác với cuộc thi hiện tại.')
    if CandidateParticipation.objects.filter(candidate=candidate, session=target).exists():
        raise ValueError(f'{candidate.name} đã đăng ký {target.code}. Nếu chỉ bỏ {source.code}, hãy dùng "Gỡ khỏi kỳ thi".')
    data = dict(participation.registration_data or {})
    moved = CandidateParticipation.objects.create(
        candidate=candidate, session=target, source=f'Đổi từ {source.code}',
        category=participation.category, registration_method=participation.registration_method,
        registration_unit=participation.registration_unit, team_name=participation.team_name,
        exam_language=participation.exam_language, general_note=participation.general_note,
        registration_data={key: value for key, value in data.items() if key not in ('schoolFee', 'schoolPartnerId')},
    )
    old_group = participation.school_registration
    notes = []
    if old_group:
        group = attach_to_school(moved, _partner_for(old_group), data.get('schoolFee'))
        refresh_school_group(group)
        notes.append(f'giữ đăng ký qua {old_group.school}')
    elif has_individual_accounting(participation):
        # Money already paid for this registration pays for the new contest.
        ExaminationBillingRecord.objects.filter(participation=moved).delete()
        ExaminationBillingRecord.objects.filter(participation=participation).update(participation=moved)
        notes.append('chuyển theo khoản lệ phí cá nhân đã có')
    participation.delete()
    refresh_school_group(old_group)
    candidate.session_ids = [item for item in (candidate.session_ids or []) if item != source.pk] + [target.pk]
    contests = [item.strip() for item in (candidate.contests or '').split(',') if item.strip() and item.strip().upper() != source.code.upper()]
    candidate.contests = ', '.join(dict.fromkeys(contests + [target.code]))
    candidate.save(update_fields=['session_ids', 'contests', 'updated_at'])
    room = None
    if room_choice:
        from .models import ExamRoom
        from .room_entry import assign_to_room, create_room
        if room_choice.get('newRoom'):
            room = create_room(target, room_choice['newRoom'], actor)
        elif room_choice.get('roomId'):
            room = ExamRoom.objects.filter(pk=room_choice['roomId'], session=target).first()
            if not room:
                raise ValueError('Phòng thi đã chọn không còn trong kỳ tổ chức, hãy tải lại.')
        if room:
            assign_to_room(moved, room)
            notes.append(f'xếp vào {room.label}')
    summary = f'Đổi cuộc thi của {candidate.code} ({candidate.name}) từ {source.code} sang {target.code}'
    summary += (': ' + '; '.join(notes) + '.') if notes else '.'
    summary += f' Kết quả, SBD và phòng thi của {source.code} không chuyển sang.'
    return moved, summary
