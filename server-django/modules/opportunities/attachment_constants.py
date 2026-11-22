"""Allowed types/limits for opportunity documents - proposals, RFQs, contracts."""
import os

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_ATTACHMENTS_PER_OPPORTUNITY = 10
MAX_ATTACHMENT_FILES_PER_UPLOAD = 5

PDF_MIME = 'application/pdf'
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
DOC_MIME = 'application/msword'

ALLOWED_ATTACHMENT_MIMES = frozenset({PDF_MIME, DOCX_MIME, DOC_MIME})
ALLOWED_ATTACHMENT_EXTENSIONS = '.pdf,.docx,.doc'

_EXT_TO_MIME = {'.pdf': PDF_MIME, '.docx': DOCX_MIME, '.doc': DOC_MIME}


def file_extension(original_name: str) -> str:
    return os.path.splitext(original_name)[1].lower()


def is_allowed_opportunity_file(mime: str, original_name: str) -> bool:
    return mime in ALLOWED_ATTACHMENT_MIMES or file_extension(original_name) in _EXT_TO_MIME


def canonical_opportunity_mime(mime: str, original_name: str) -> str:
    """Canonical MIME when the browser sends a generic type (common for .docx)."""
    if mime in ALLOWED_ATTACHMENT_MIMES:
        return mime
    return _EXT_TO_MIME.get(file_extension(original_name), mime)
