import logging
import traceback
from pathlib import Path

from django.db import OperationalError
from rest_framework.response import Response
from rest_framework.views import exception_handler as default_handler

logger = logging.getLogger(__name__)


def exception_handler(exc, context):
    response = default_handler(exc, context)
    if response is not None:
        return response
    request = context.get("request")
    path = str(getattr(request, "path", ""))
    endpoint = next((prefix for prefix in ["/api/work-schedule/day", "/api/work-schedule", "/api/attendance", "/api/digital-training", "/api/examination"] if path.startswith(prefix)), "/api/other")
    frames = [f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}" for frame in traceback.extract_tb(exc.__traceback__)]
    locked = isinstance(exc, OperationalError) and "locked" in str(exc).lower()
    logger.error("api_save_failure endpoint=%s type=%s database_locked=%s code_locations=%s", endpoint, type(exc).__name__, locked, frames)
    if locked:
        return Response({"error": "Dữ liệu đang được cập nhật bởi một thao tác khác. Nội dung chưa lưu vẫn được giữ; vui lòng thử lưu lại.", "code": "database_busy"}, status=503, headers={"Retry-After": "1"})
    return Response({"error": "Máy chủ không thể hoàn tất thao tác. Nội dung chưa lưu vẫn được giữ.", "code": "server_error"}, status=500)
