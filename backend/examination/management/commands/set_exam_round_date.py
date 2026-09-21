"""Moves one dated round (or one đợt of it) of an exam session.

The date lives in three places that have to agree: the slot's own ``date``, the
round's ``date`` (which mirrors the first slot) and the human ``label`` the
module prints. Editing only one of them leaves the calendar disagreeing with
what the screen shows, so this command rewrites all three.
"""
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from examination.models import Competition, ExamSession


def _as_date(value):
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m"):
        try:
            parsed = datetime.strptime(str(value).strip(), pattern)
            return parsed.date()
        except ValueError:
            continue
    raise CommandError(f"Ngày không hợp lệ: {value!r}. Dùng YYYY-MM-DD hoặc dd/mm/yyyy.")


def _label_for(round_data):
    """Rebuild the "27/09/2026; 13/12/2026" label from the slots."""
    slots = [slot for slot in (round_data.get("slots") or []) if isinstance(slot, dict)]
    dates = [str(slot.get("date") or "").strip() for slot in slots]
    dates = [value for value in dates if value]
    if not dates:
        return str(round_data.get("date") or "").strip()
    formatted = []
    for value in dates:
        try:
            formatted.append(datetime.strptime(value, "%Y-%m-%d").strftime("%d/%m/%Y"))
        except ValueError:
            formatted.append(value)
    return "; ".join(formatted)


class Command(BaseCommand):
    help = "Đổi ngày thi của một vòng (hoặc một đợt trong vòng) của kỳ tổ chức."

    def add_arguments(self, parser):
        parser.add_argument("--session", required=True, help="Mã kỳ tổ chức, ví dụ fieo-2026-2027.")
        parser.add_argument("--round", required=True, help="Mã vòng, ví dụ round-national.")
        parser.add_argument("--batch", type=int, default=1, help="Đợt thứ mấy trong vòng (mặc định 1).")
        parser.add_argument("--date", required=True, help="Ngày mới, YYYY-MM-DD hoặc dd/mm/yyyy.")
        parser.add_argument("--apply", action="store_true", help="Ghi thay đổi.")

    def handle(self, *args, **options):
        session = ExamSession.objects.filter(pk=options["session"]).first()
        if not session:
            raise CommandError(f"Không tìm thấy kỳ tổ chức {options['session']!r}.")

        rounds = list(session.rounds or [])
        index = next(
            (position for position, item in enumerate(rounds)
             if isinstance(item, dict) and str(item.get("id")) == options["round"]),
            None,
        )
        if index is None:
            available = ", ".join(str(item.get("id")) for item in rounds if isinstance(item, dict))
            raise CommandError(f"Không tìm thấy vòng {options['round']!r}. Đang có: {available}")

        round_data = dict(rounds[index])
        new_date = _as_date(options["date"]).isoformat()
        batch = max(1, int(options["batch"]))
        slots = [dict(slot) for slot in (round_data.get("slots") or []) if isinstance(slot, dict)]

        competition = Competition.objects.filter(pk=session.competition_id).first()
        code = (competition.code if competition else session.competition_id) or ""
        self.stdout.write(f"{code} · {session.name} · {round_data.get('name')}")
        self.stdout.write(f"  trước: date={round_data.get('date')!r} label={round_data.get('label')!r}")

        if slots:
            if batch > len(slots):
                raise CommandError(f"Vòng này chỉ có {len(slots)} đợt, không có đợt {batch}.")
            slots[batch - 1]["date"] = new_date
            round_data["slots"] = slots
            round_data["date"] = slots[0].get("date") or new_date
        else:
            round_data["date"] = new_date
        round_data["label"] = _label_for(round_data)

        self.stdout.write(f"  sau:   date={round_data.get('date')!r} label={round_data.get('label')!r}")
        if slots:
            for position, slot in enumerate(slots, start=1):
                marker = "<-" if position == batch else "  "
                self.stdout.write(f"    đợt {position}: {slot.get('date')} {marker}")

        if not options["apply"]:
            self.stdout.write(self.style.WARNING("Chạy thử: chưa ghi gì. Thêm --apply để ghi."))
            return

        rounds[index] = round_data
        session.rounds = rounds
        session.save(update_fields=["rounds", "updated_at"])
        self.stdout.write(self.style.SUCCESS("Đã cập nhật ngày thi."))
