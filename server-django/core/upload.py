"""
Multipart upload parsing (backend/src/middleware/upload.ts used multer).
Files arrive in the "files" field; any type or size problem is a 400 with
multer's wording.
"""
from dataclasses import dataclass
from typing import Callable

from django.http import HttpRequest

from .errors import BadRequestError


@dataclass
class UploadedFile:
    buffer: bytes
    mime_type: str
    original_name: str
    size: int


def read_files(
    request: HttpRequest,
    max_bytes: int,
    max_files: int,
    is_allowed: Callable[[str, str], bool],
    allowed_extensions: str,
) -> list[UploadedFile]:
    if request.method != 'POST' or not (request.content_type or '').startswith('multipart/'):
        return []

    for field in request.FILES.keys():
        if field != 'files':
            raise BadRequestError('Unexpected field')

    files = request.FILES.getlist('files')
    if len(files) > max_files:
        raise BadRequestError('Too many files')

    out = []
    for f in files:
        mime = f.content_type or 'application/octet-stream'
        name = f.name or 'file'
        if not is_allowed(mime, name):
            raise BadRequestError(f'Unsupported file type. Allowed: {allowed_extensions}')
        if f.size > max_bytes:
            raise BadRequestError('File too large')
        out.append(UploadedFile(buffer=f.read(), mime_type=mime, original_name=name, size=f.size))
    return out
