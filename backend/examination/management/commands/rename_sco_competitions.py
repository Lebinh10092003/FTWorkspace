"""Renames the SCO competitions: code gains an S, name gains an "SCO " prefix.

    IEO  ->  SIEO
    International English Olympiad  ->  SCO International English Olympiad

Only competitions whose code still starts with "I" are touched, so the Fermat
family (FIEO, FIMO, FISO, FIAIO) and AYSBC are left alone, and anything already
renamed by hand is skipped rather than renamed twice.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from examination.models import Competition, ExamSession

NAME_PREFIX = "SCO "
CODE_PREFIX = "S"


def targets():
    """Competitions still waiting to be renamed, in display order."""
    rows = []
    for competition in Competition.objects.all().order_by("sort_key", "code"):
        code = (competition.code or "").strip()
        if not code.upper().startswith("I"):
            continue  # Fermat family and AYSBC keep their names
        name = (competition.name or "").strip()
        new_code = f"{CODE_PREFIX}{code}"
        new_name = name if name.upper().startswith(NAME_PREFIX.strip()) else f"{NAME_PREFIX}{name}"
        rows.append({
            "id": competition.id,
            "code": code, "newCode": new_code,
            "name": name, "newName": new_name,
            "codeChanged": new_code != code,
            "nameChanged": new_name != name,
        })
    return rows


class Command(BaseCommand):
    help = "Thêm S vào mã và SCO vào tên các cuộc thi SCO (mã bắt đầu bằng I)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Ghi thay đổi.")
        parser.add_argument(
            "--only",
            default="",
            help="Chỉ đổi những mã này, cách nhau bằng dấu phẩy. Bỏ trống là đổi tất cả.",
        )

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        only = {code.strip().upper() for code in str(options["only"]).split(",") if code.strip()}

        rows = [row for row in targets() if not only or row["code"].upper() in only]
        pending = [row for row in rows if row["codeChanged"] or row["nameChanged"]]

        if only:
            missing = only - {row["code"].upper() for row in rows}
            for code in sorted(missing):
                self.stdout.write(self.style.WARNING(f"Không tìm thấy cuộc thi mã {code}."))

        self.stdout.write(f"Cuộc thi trong phạm vi: {len(rows)} · cần đổi: {len(pending)}")
        for row in rows:
            mark = "  " if (row["codeChanged"] or row["nameChanged"]) else "= "
            self.stdout.write(f"{mark}{row['code']:8} -> {row['newCode']:8} | {row['name']}")
            if row["nameChanged"]:
                self.stdout.write(f"{' ' * 22}-> {row['newName']}")

        if not apply:
            self.stdout.write(self.style.WARNING("Chạy thử: chưa ghi gì. Thêm --apply để ghi."))
            return

        renamed = 0
        with transaction.atomic():
            for row in pending:
                competition = Competition.objects.get(pk=row["id"])
                competition.code = row["newCode"]
                competition.name = row["newName"]
                # ``parent`` mirrors the display name across the tree views.
                if (competition.parent or "").strip() == row["name"]:
                    competition.parent = row["newName"]
                competition.save(update_fields=["code", "name", "parent", "updated_at"])
                # Sessions repeat the competition name in their own parent link.
                for session in ExamSession.objects.filter(competition_id=row["id"]):
                    if (session.parent or "").strip() == row["name"]:
                        session.parent = row["newName"]
                        session.save(update_fields=["parent", "updated_at"])
                renamed += 1
        self.stdout.write(self.style.SUCCESS(f"Đã đổi tên {renamed} cuộc thi."))
