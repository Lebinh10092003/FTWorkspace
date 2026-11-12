"""Dữ liệu dựng sẵn cho test form đăng ký công khai."""
from datetime import timedelta

from django.utils import timezone


def open_rounds(fee=250000, days=30, name='Vòng loại Quốc gia', later=()):
    """Vòng đầu đang trong cửa sổ nhận đăng ký (hạn sau `days` ngày)."""
    deadline = timezone.localdate() + timedelta(days=days)
    rounds = [{'id': 'entry', 'name': name, 'label': '', 'date': (deadline + timedelta(days=10)).isoformat(),
               'slots': [], 'fee': fee, 'registrationDeadline': deadline.isoformat()}]
    for index, (round_name, round_fee) in enumerate(later):
        rounds.append({'id': f'later-{index}', 'name': round_name, 'label': '', 'date': '', 'slots': [], 'fee': round_fee,
                       'registrationDeadline': ''})
    return rounds
