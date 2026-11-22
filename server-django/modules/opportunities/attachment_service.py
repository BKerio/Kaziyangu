"""Documents attached to an opportunity - proposals, RFQs, contracts, etc."""
from pathlib import Path

from core.errors import BadRequestError, NotFoundError
from core.serialize import pick, to_dict
from core.storage import opportunity_attachments
from core.upload import UploadedFile
from modules.audit import service as audit

from .attachment_constants import MAX_ATTACHMENTS_PER_OPPORTUNITY
from .models import Opportunity, OpportunityAttachment


def serialize(attachment: OpportunityAttachment) -> dict:
    return {**to_dict(attachment), 'uploadedBy': pick(attachment.uploaded_by, 'id', 'name')}


def _find_opportunity(opportunity_id: str) -> Opportunity:
    opportunity = Opportunity.objects.filter(id=opportunity_id).first()
    if opportunity is None:
        raise NotFoundError('Opportunity')
    return opportunity


def list_attachments(opportunity_id: str) -> list[dict]:
    _find_opportunity(opportunity_id)
    rows = OpportunityAttachment.objects.filter(opportunity_id=opportunity_id).select_related('uploaded_by').order_by('created_at')
    return [serialize(a) for a in rows]


def add_many(opportunity_id: str, uploaded_by_id: str, files: list[UploadedFile]) -> list[dict]:
    opportunity = _find_opportunity(opportunity_id)
    existing = OpportunityAttachment.objects.filter(opportunity_id=opportunity_id).count()
    if existing + len(files) > MAX_ATTACHMENTS_PER_OPPORTUNITY:
        raise BadRequestError(f'An opportunity can have at most {MAX_ATTACHMENTS_PER_OPPORTUNITY} files')

    created = []
    for f in files:
        storage_key = opportunity_attachments.save(opportunity.id, f.buffer, f.original_name)
        attachment = OpportunityAttachment.objects.create(
            opportunity_id=opportunity.id, uploaded_by_id=uploaded_by_id, file_name=f.original_name,
            mime_type=f.mime_type, bytes=f.size, storage_key=storage_key,
        )
        data = serialize(OpportunityAttachment.objects.select_related('uploaded_by').get(id=attachment.id))
        created.append(data)
        audit.record(uploaded_by_id, 'CREATE', 'OPPORTUNITY_ATTACHMENT', attachment.id,
                     summary=f'Attached file to opportunity "{opportunity.name}": {attachment.file_name}', new_values=data)
    return created


def get_file(opportunity_id: str, attachment_id: str) -> tuple[OpportunityAttachment, Path]:
    _find_opportunity(opportunity_id)
    attachment = OpportunityAttachment.objects.filter(id=attachment_id, opportunity_id=opportunity_id).first()
    if attachment is None:
        raise NotFoundError('Attachment')
    return attachment, opportunity_attachments.path(attachment.storage_key)


def remove(opportunity_id: str, attachment_id: str, actor_id: str) -> None:
    _find_opportunity(opportunity_id)
    attachment = OpportunityAttachment.objects.filter(id=attachment_id, opportunity_id=opportunity_id).first()
    if attachment is None:
        raise NotFoundError('Attachment')
    old = to_dict(attachment)
    opportunity_attachments.delete(attachment.storage_key)
    attachment.delete()
    audit.record(actor_id, 'DELETE', 'OPPORTUNITY_ATTACHMENT', attachment_id,
                 summary=f'Removed opportunity attachment: {attachment.file_name}', old_values=old)
