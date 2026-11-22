"""
Proof-of-work files attached to a WorkTask, from the web form or the WhatsApp
bot. Same ownership rule as the task: its logger, or any Admin/Super Admin.
"""
from pathlib import Path

from core.enums import MANAGER_ROLES
from core.errors import BadRequestError, ForbiddenError, NotFoundError
from core.jwt import Actor
from core.serialize import to_dict
from core.storage import task_attachments
from core.upload import UploadedFile
from modules.audit import service as audit

from .attachment_constants import MAX_ATTACHMENTS_PER_TASK
from .models import TaskAttachment, WorkTask


def _find_owned_task(task_id: str, actor: Actor) -> WorkTask:
    task = WorkTask.objects.filter(id=task_id).first()
    if task is None:
        raise NotFoundError('Task')
    if task.user_id != actor.user_id and actor.role not in MANAGER_ROLES:
        raise ForbiddenError('You do not have permission to access this task')
    return task


def list_attachments(task_id: str, actor: Actor) -> list[dict]:
    _find_owned_task(task_id, actor)
    return [to_dict(a) for a in TaskAttachment.objects.filter(task_id=task_id).order_by('created_at')]


def add_many(task_id: str, actor: Actor, files: list[UploadedFile]) -> list[dict]:
    task = _find_owned_task(task_id, actor)
    existing = TaskAttachment.objects.filter(task_id=task_id).count()
    if existing + len(files) > MAX_ATTACHMENTS_PER_TASK:
        raise BadRequestError(f'A task can have at most {MAX_ATTACHMENTS_PER_TASK} attachments')

    created = []
    for f in files:
        storage_key = task_attachments.save(task.id, f.buffer, f.original_name)
        attachment = TaskAttachment.objects.create(
            task_id=task.id, uploaded_by_id=actor.user_id, file_name=f.original_name,
            mime_type=f.mime_type, bytes=f.size, storage_key=storage_key,
        )
        data = to_dict(attachment)
        created.append(data)
        audit.record(actor.user_id, 'CREATE', 'TASK_ATTACHMENT', attachment.id,
                     summary=f'Attached file to task "{task.description}": {attachment.file_name}', new_values=data)
    return created


def add_from_buffer(task_id: str, uploaded_by_id: str, buffer: bytes, mime_type: str, file_name: str) -> dict:
    """Used by the WhatsApp bot, which already has raw bytes rather than a multipart upload."""
    if TaskAttachment.objects.filter(task_id=task_id).count() + 1 > MAX_ATTACHMENTS_PER_TASK:
        raise BadRequestError(f'A task can have at most {MAX_ATTACHMENTS_PER_TASK} attachments')
    storage_key = task_attachments.save(task_id, buffer, file_name)
    attachment = TaskAttachment.objects.create(
        task_id=task_id, uploaded_by_id=uploaded_by_id, file_name=file_name,
        mime_type=mime_type, bytes=len(buffer), storage_key=storage_key,
    )
    return to_dict(attachment)


def get_file(task_id: str, attachment_id: str, actor: Actor) -> tuple[TaskAttachment, Path]:
    _find_owned_task(task_id, actor)
    attachment = TaskAttachment.objects.filter(id=attachment_id, task_id=task_id).first()
    if attachment is None:
        raise NotFoundError('Attachment')
    return attachment, task_attachments.path(attachment.storage_key)


def remove(task_id: str, attachment_id: str, actor: Actor) -> None:
    _find_owned_task(task_id, actor)
    attachment = TaskAttachment.objects.filter(id=attachment_id, task_id=task_id).first()
    if attachment is None:
        raise NotFoundError('Attachment')

    old = to_dict(attachment)
    task_attachments.delete(attachment.storage_key)
    attachment.delete()
    audit.record(actor.user_id, 'DELETE', 'TASK_ATTACHMENT', attachment_id,
                 summary=f'Removed attachment: {attachment.file_name}', old_values=old)
