from django.db import migrations

BOTS = [
    {
        "code": "trend",
        "email": "bot.fb.trend@fermat.vn",
        "name": "AI Săn tin & Xu hướng",
        "role": "Chuyên viên Săn tin AI",
        "seat_index": 3,
        "avatar": {"shirt": "#10B981", "hair": "#1E293B", "hairStyle": "spiky", "glasses": True},
    },
    {
        "code": "material",
        "email": "bot.fb.material@fermat.vn",
        "name": "AI Xử lý tư liệu",
        "role": "Chuyên viên Tư liệu AI",
        "seat_index": 4,
        "avatar": {"shirt": "#F59E0B", "hair": "#3B2F2F", "hairStyle": "plain"},
    },
    {
        "code": "writer",
        "email": "bot.fb.writer@fermat.vn",
        "name": "AI Soạn thảo bài viết",
        "role": "Biên tập viên AI",
        "seat_index": 5,
        "avatar": {"shirt": "#3B82F6", "hair": "#18181B", "hairStyle": "plain"},
    },
    {
        "code": "reviewer",
        "email": "bot.fb.reviewer@fermat.vn",
        "name": "AI Kiểm duyệt nội dung",
        "role": "Kiểm duyệt viên AI",
        "seat_index": 6,
        "avatar": {"shirt": "#8B5CF6", "hair": "#4C1D95", "hairStyle": "spiky", "glasses": True},
    },
    {
        "code": "publisher",
        "email": "bot.fb.publisher@fermat.vn",
        "name": "AI Đăng bài tự động",
        "role": "Điều phối xuất bản AI",
        "seat_index": 7,
        "avatar": {"shirt": "#EC4899", "hair": "#1F2937", "hairStyle": "plain"},
    },
]

def provision_fb_bots(apps, schema_editor):
    Department = apps.get_model("authentication", "Department")
    JobTitle = apps.get_model("authentication", "JobTitle")
    UserProfile = apps.get_model("authentication", "UserProfile")
    OfficeSeat = apps.get_model("office", "OfficeSeat")
    OfficePresence = apps.get_model("office", "OfficePresence")
    FbBotProfile = apps.get_model("social", "FbBotProfile")

    exam_dept = (
        Department.objects.filter(code="EXAM").first()
        or Department.objects.filter(name="Khảo thí").first()
        or Department.objects.create(name="Khảo thí", code="EXAM")
    )

    for b in BOTS:
        job_title = JobTitle.objects.filter(name=b["role"]).first()
        if not job_title:
            job_title = JobTitle.objects.create(name=b["role"], department=exam_dept)

        user, created = UserProfile.objects.get_or_create(
            email=b["email"],
            defaults={
                "name": b["name"],
                "department": exam_dept,
                "job_title": job_title,
                "role": "BOT",
                "employment_status": "ACTIVE",
            }
        )
        if not created:
            user.name = b["name"]
            user.department = exam_dept
            user.job_title = job_title
            user.role = "BOT"
            user.employment_status = "ACTIVE"
            user.save()

        if hasattr(user, "departments"):
            user.departments.add(exam_dept)

        seat, _ = OfficeSeat.objects.get_or_create(
            user=user,
            defaults={"room": "exam", "seat_index": b["seat_index"], "is_head": False}
        )
        seat.room = "exam"
        seat.seat_index = b["seat_index"]
        seat.save()

        presence, _ = OfficePresence.objects.get_or_create(
            user=user,
            defaults={"show_presence": True, "avatar_config": b["avatar"]}
        )
        presence.show_presence = True
        presence.avatar_config = b["avatar"]
        presence.save()

        FbBotProfile.objects.update_or_create(
            code=b["code"],
            defaults={
                "name": b["name"],
                "role": b["role"],
                "email": b["email"],
                "avatar_config": b["avatar"],
                "is_active": True,
            }
        )

def remove_fb_bots(apps, schema_editor):
    pass

class Migration(migrations.Migration):
    dependencies = [
        ('office', '0001_initial'),
        ('social', '0008_fbbotprofile_fbdraftpost_fbmaterialupload_and_more'),
        ('authentication', '0017_login_throttle'),
    ]

    operations = [
        migrations.RunPython(provision_fb_bots, remove_fb_bots),
    ]
