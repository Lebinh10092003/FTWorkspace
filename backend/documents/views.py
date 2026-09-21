import unicodedata
from urllib.parse import quote

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

# These are shared tools, like the QR and signature builders: any signed-in
# member can draft a document, so they are not scoped to a single module.
from authentication.permissions import IsWorkspaceAuthenticated

from .funding_proposal import build_funding_proposal
from .numbering import (
    DOCUMENT_TYPES,
    format_number,
    issue_number,
    register_state,
    type_code_for,
)


def _google_token(request):
    return str(request.data.get("googleAccessToken") or request.query_params.get("googleAccessToken") or "").strip() or None


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def document_number_register(request):
    """Next available number plus the tail of the register, read from the Sheet."""
    try:
        state = register_state(google_token=_google_token(request))
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    document_type = str(request.query_params.get("documentType") or "Công văn")
    state["documentTypes"] = DOCUMENT_TYPES
    state["preview"] = format_number(state["next"], document_type)
    state["typeCode"] = type_code_for(document_type)
    return Response(state)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def document_number_issue(request):
    """Take the next number and write the row into the register."""
    document_type = str(request.data.get("documentType") or "").strip()
    subject = str(request.data.get("subject") or "").strip()
    if not document_type:
        return Response({"error": "Vui lòng chọn loại văn bản."}, status=status.HTTP_400_BAD_REQUEST)
    if not subject:
        return Response({"error": "Vui lòng nhập nội dung công việc."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        issued = issue_number(
            document_type=document_type,
            subject=subject,
            drafter=request.data.get("drafter"),
            signer=request.data.get("signer"),
            issued_on=request.data.get("issuedOn"),
            google_token=_google_token(request),
        )
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(issued, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def funding_proposal_docx(request):
    """Render the funding proposal and return it as a Word download."""
    payload = request.data if isinstance(request.data, dict) else {}
    filename, content = build_funding_proposal(payload)
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    # The name carries Vietnamese characters. Left whole, Django RFC2047-encodes
    # the entire header and browsers save it under a mangled name, so send an
    # ASCII fallback beside the UTF-8 form (RFC 6266).
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_filename(filename)}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    response["Content-Length"] = str(len(content))
    return response


def _ascii_filename(filename):
    folded = unicodedata.normalize("NFKD", filename.replace("Đ", "D").replace("đ", "d"))
    plain = folded.encode("ascii", "ignore").decode("ascii").strip()
    return plain or "phieu-de-xuat-kinh-phi.docx"
