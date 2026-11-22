"""Sales pipeline: opportunity tracking from lead identification through won/lost."""
from django.db.models import Count, Q

from core.dates import js_round, parse_date
from core.db import update_row
from core.enums import OpportunityStage
from core.errors import BadRequestError, NotFoundError
from core.http import meta, paginate
from core.serialize import pick, snake_keys, to_dict
from core.storage import opportunity_attachments
from modules.audit import service as audit

from .models import Opportunity, OpportunityActivity, OpportunityAttachment

DATE_FIELDS = ('dateIdentified', 'followUpDate', 'proposalSubmittedDate', 'expectedClosingDate', 'closingDate')


def _to_date_fields(data: dict) -> dict:
    """"YYYY-MM-DD" strings -> dates for the date columns; an empty string clears the field."""
    out = dict(data)
    for key in DATE_FIELDS:
        if key in out:
            if out[key]:
                parsed = parse_date(out[key])
                if parsed is None:
                    raise BadRequestError(f'Invalid date for {key}')
                out[key] = parsed
            else:
                out[key] = None
    return out


def _qs():
    return Opportunity.objects.select_related('assigned_to', 'created_by')


def serialize(opportunity: Opportunity) -> dict:
    return {
        **to_dict(opportunity),
        'assignedTo': pick(opportunity.assigned_to, 'id', 'name'),
        'createdBy': pick(opportunity.created_by, 'id', 'name'),
    }


def serialize_activity(activity: OpportunityActivity) -> dict:
    return {**to_dict(activity), 'loggedBy': pick(activity.logged_by, 'id', 'name')}


def list_opportunities(stage=None, priority=None, assigned_to_id=None, search=None, page=1, limit=20) -> dict:
    qs = _qs().annotate(attachment_count=Count('attachments'))
    if stage:
        qs = qs.filter(stage=stage)
    if priority:
        qs = qs.filter(priority=priority)
    if assigned_to_id:
        qs = qs.filter(assigned_to_id=assigned_to_id)
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(customer_name__icontains=search) | Q(contact_person__icontains=search))
    rows, total = paginate(qs.order_by('-updated_at'), page, limit)
    data = [{**serialize(o), '_count': {'attachments': o.attachment_count}} for o in rows]
    return {'data': data, 'meta': meta(total, page, limit)}


def get_by_id(opportunity_id: str) -> dict:
    opportunity = _qs().filter(id=opportunity_id).first()
    if opportunity is None:
        raise NotFoundError('Opportunity')
    activities = opportunity.activities.select_related('logged_by').order_by('-date')
    return {**serialize(opportunity), 'activities': [serialize_activity(a) for a in activities]}


def create(data: dict, created_by_id: str) -> dict:
    fields = snake_keys(_to_date_fields(data))
    # Assigning a salesperson at creation time naturally advances the stage.
    fields['stage'] = OpportunityStage.ASSIGNED if data.get('assignedToId') else OpportunityStage.NEW
    opportunity = Opportunity.objects.create(created_by_id=created_by_id, **fields)
    created = serialize(_qs().get(id=opportunity.id))
    audit.record(created_by_id, 'CREATE', 'OPPORTUNITY', opportunity.id, summary=f'Created opportunity: {opportunity.name}',
                 new_values=created)
    return created


def update(opportunity_id: str, data: dict, actor_id: str) -> dict:
    existing = Opportunity.objects.filter(id=opportunity_id).first()
    if existing is None:
        raise NotFoundError('Opportunity')
    old = to_dict(existing)
    update_row(Opportunity, opportunity_id, **snake_keys(_to_date_fields(data)))
    updated = serialize(_qs().get(id=opportunity_id))
    audit.record(actor_id, 'UPDATE', 'OPPORTUNITY', opportunity_id, summary=f"Updated opportunity: {updated['name']}",
                 old_values=old, new_values=updated)
    return updated


def delete(opportunity_id: str, actor_id: str) -> None:
    existing = Opportunity.objects.filter(id=opportunity_id).first()
    if existing is None:
        raise NotFoundError('Opportunity')
    old = to_dict(existing)
    for attachment in OpportunityAttachment.objects.filter(opportunity_id=opportunity_id):
        opportunity_attachments.delete(attachment.storage_key)
    existing.delete()
    audit.record(actor_id, 'DELETE', 'OPPORTUNITY', opportunity_id, summary=f'Deleted opportunity: {existing.name}',
                 old_values=old)


def log_activity(opportunity_id: str, data: dict, logged_by_id: str) -> dict:
    opportunity = Opportunity.objects.filter(id=opportunity_id).first()
    if opportunity is None:
        raise NotFoundError('Opportunity')
    when = parse_date(data['date'])
    if when is None:
        raise BadRequestError('Invalid date')
    activity = OpportunityActivity.objects.create(
        opportunity_id=opportunity_id, type=data['type'], date=when, notes=data.get('notes'), logged_by_id=logged_by_id,
    )
    created = serialize_activity(OpportunityActivity.objects.select_related('logged_by').get(id=activity.id))
    audit.record(logged_by_id, 'CREATE', 'OPPORTUNITY_ACTIVITY', activity.id,
                 summary=f"Logged {data['type'].lower()} activity on opportunity: {opportunity.name}", new_values=created)
    return created


def _first_value(*candidates):
    return next((c for c in candidates if c is not None), 0)


def get_stats() -> dict:
    """Dashboard KPIs at the top of the Opportunity Tracker."""
    rows = Opportunity.objects.values('stage', 'estimated_value', 'proposed_value', 'final_value')
    in_progress = (OpportunityStage.QUALIFICATION, OpportunityStage.ASSIGNED, OpportunityStage.ENGAGEMENT)

    counts = {'new': 0, 'inProgress': 0, 'proposals': 0, 'negotiation': 0, 'won': 0, 'lost': 0}
    pipeline_value = won_value = 0.0
    total = 0
    for o in rows:
        total += 1
        stage = o['stage']
        if stage == OpportunityStage.NEW:
            counts['new'] += 1
        elif stage in in_progress:
            counts['inProgress'] += 1
        elif stage == OpportunityStage.PROPOSAL:
            counts['proposals'] += 1
        elif stage == OpportunityStage.NEGOTIATION:
            counts['negotiation'] += 1
        elif stage == OpportunityStage.WON:
            counts['won'] += 1
        elif stage == OpportunityStage.LOST:
            counts['lost'] += 1

        if stage == OpportunityStage.WON:
            won_value += _first_value(o['final_value'], o['proposed_value'], o['estimated_value'])
        elif stage != OpportunityStage.LOST:
            pipeline_value += _first_value(o['proposed_value'], o['estimated_value'])

    closed = counts['won'] + counts['lost']
    return {
        'total': total,
        **counts,
        'pipelineValue': js_round(pipeline_value * 100) / 100,
        'wonValue': js_round(won_value * 100) / 100,
        'winRate': js_round(counts['won'] / closed * 1000) / 10 if closed > 0 else 0,
    }
