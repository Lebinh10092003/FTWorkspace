from django.apps import AppConfig


class ExaminationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "examination"

    def ready(self):
        from . import signals  # noqa: F401
