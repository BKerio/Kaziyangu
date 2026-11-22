"""Allowed types/limits for task attachments - screenshots, a PDF or a Word document attached as proof of work."""

DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_ATTACHMENTS_PER_TASK = 8
MAX_ATTACHMENT_FILES_PER_UPLOAD = 5

ALLOWED_ATTACHMENT_MIMES = frozenset({
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    DOCX_MIME,
})

ALLOWED_ATTACHMENT_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.docx'


def is_allowed_task_file(mime: str, _original_name: str) -> bool:
    return mime in ALLOWED_ATTACHMENT_MIMES
