"""
Local disk storage for uploaded attachments, keyed by owner id so files for a
deleted record are easy to spot. Callers only deal in `storage_key` strings
("<ownerId>/<uuid><ext>"), so this can later be swapped for object storage.
"""
import os
import uuid
from pathlib import Path

from django.conf import settings


class DiskStorage:
    def __init__(self, folder: str) -> None:
        self.folder = folder

    @property
    def root(self) -> Path:
        return Path(settings.UPLOADS_DIR).resolve() / self.folder

    def path(self, storage_key: str) -> Path:
        full = (self.root / storage_key).resolve()
        if self.root not in full.parents:
            raise ValueError('Storage key escapes the uploads folder')
        return full

    def save(self, owner_id: str, buffer: bytes, original_name: str) -> str:
        ext = os.path.splitext(original_name)[1].lower()
        storage_key = f'{owner_id}/{uuid.uuid4()}{ext}'
        full = self.path(storage_key)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(buffer)
        return storage_key

    def delete(self, storage_key: str) -> None:
        try:
            self.path(storage_key).unlink()
        except (FileNotFoundError, ValueError):
            pass  # already gone - nothing left to clean up


task_attachments = DiskStorage('task-attachments')
opportunity_attachments = DiskStorage('opportunity-attachments')
