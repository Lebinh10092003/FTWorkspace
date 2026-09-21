"""Django settings for the FT Workspace API."""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-local-development-only")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "corsheaders", "rest_framework", "rest_framework.authtoken",
    "authentication", "social", "examination", "email_builder", "digital_training", "attendance", "work_schedule",
    "documents",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug", "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages",
    ]},
}]

# Local development keeps the database in backend/db.sqlite3. On the production
# host, even an ad-hoc `manage.py` command must use the durable data directory;
# otherwise it silently opens a second, empty SQLite file inside a Git release.
_default_database_path = BASE_DIR / "db.sqlite3"
_configured_database_path = os.getenv("DJANGO_DB_PATH", "").strip()
_workspace_data_dir = Path(os.getenv("WORKSPACE_DATA_DIR", "/home/workspace/ft-workspace-data")).expanduser()
_is_workspace_production = os.name != "nt" and str(PROJECT_ROOT).startswith("/var/www/ft-workspace")
if _configured_database_path:
    DATABASE_PATH = Path(_configured_database_path).expanduser()
elif _is_workspace_production:
    DATABASE_PATH = _workspace_data_dir / "workspace.sqlite3"
else:
    DATABASE_PATH = _default_database_path
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = (PROJECT_ROOT / DATABASE_PATH).resolve()

DATABASES = {"default": {"ENGINE": "config.sqlite", "NAME": DATABASE_PATH, "OPTIONS": {"timeout": 30}}}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "vi"
TIME_ZONE = "Asia/Ho_Chi_Minh"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
MEDIA_URL = "/uploads/"
MEDIA_ROOT = PROJECT_ROOT / "uploads"
# Keep under nginx's 12 MB request cap. Email-builder uploads are optimised in
# the browser first; this remains a server-side guard for every caller.
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(10 * 1024 * 1024)))
# Work-schedule rows are currently treated as unconfirmed training suggestions.
# Keep direct/customer-created Digital Training sessions authoritative while the
# reconciliation workflow is being introduced.
WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED = env_bool(
    "WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED",
    False,
)
# The mirror image of the setting above. Đào tạo số sessions used to copy
# themselves onto the instructor's personal schedule, so Lịch cá nhân filled up
# with identically shaped rows their owner never wrote. The two calendars are
# separate: a training session belongs to Đào tạo số, and staff add their own
# work-schedule row when they want one.
TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED = env_bool(
    "TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED",
    False,
)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:5173", "http://127.0.0.1:5173",
]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
)

REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "config.api_errors.exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": ["authentication.auth.DjangoTokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["authentication.permissions.IsAuthenticated"],
}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
