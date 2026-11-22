from django.db import models

from core.db import CreatedModel, TimestampedModel
from core.enums import ActivityType, OpportunityPriority, OpportunityStage


class Opportunity(TimestampedModel):
    """Sales pipeline entry, from lead identification through won/lost."""

    # ── 1. Opportunity Identified ───────────────────────────────────────────
    name = models.TextField()
    customer_name = models.TextField()
    contact_person = models.TextField(null=True, blank=True)
    source = models.TextField(null=True, blank=True)
    date_identified = models.DateField()
    estimated_value = models.FloatField(null=True, blank=True)
    description = models.TextField(null=True, blank=True)

    stage = models.TextField(choices=OpportunityStage.choices, default=OpportunityStage.NEW)
    priority = models.TextField(choices=OpportunityPriority.choices, default=OpportunityPriority.MEDIUM)

    # ── 2. Qualification ─────────────────────────────────────────────────────
    is_genuine = models.BooleanField(null=True, blank=True)
    customer_need = models.TextField(null=True, blank=True)
    budget_confirmed = models.TextField(null=True, blank=True)
    decision_maker = models.TextField(null=True, blank=True)
    expected_timeline = models.TextField(null=True, blank=True)
    probability = models.IntegerField(null=True, blank=True)  # 0-100

    # ── 3. Assigned ───────────────────────────────────────────────────────────
    assigned_to = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='opportunities_assigned'
    )
    follow_up_date = models.DateField(null=True, blank=True)

    # ── 5. Proposal / Quotation ──────────────────────────────────────────────
    proposal_submitted_date = models.DateField(null=True, blank=True)
    proposed_value = models.FloatField(null=True, blank=True)
    expected_closing_date = models.DateField(null=True, blank=True)

    # ── 6. Negotiation ───────────────────────────────────────────────────────
    customer_feedback = models.TextField(null=True, blank=True)
    revised_value = models.FloatField(null=True, blank=True)
    negotiation_notes = models.TextField(null=True, blank=True)
    competitors = models.TextField(null=True, blank=True)

    # ── 7a. Won ───────────────────────────────────────────────────────────────
    final_value = models.FloatField(null=True, blank=True)
    contract_number = models.TextField(null=True, blank=True)
    closing_date = models.DateField(null=True, blank=True)

    # ── 7b. Lost ──────────────────────────────────────────────────────────────
    reason_lost = models.TextField(null=True, blank=True)
    competitor_selected = models.TextField(null=True, blank=True)
    lost_value = models.FloatField(null=True, blank=True)
    lessons_learned = models.TextField(null=True, blank=True)

    created_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='opportunities_created')

    class Meta:
        db_table = 'opportunities'
        indexes = [models.Index(fields=['stage']), models.Index(fields=['assigned_to'])]


class OpportunityActivity(CreatedModel):
    """An engagement touchpoint (call, meeting, site visit, ...) logged against an opportunity."""

    type = models.TextField(choices=ActivityType.choices)
    date = models.DateField()
    notes = models.TextField(null=True, blank=True)
    opportunity = models.ForeignKey(Opportunity, on_delete=models.CASCADE, related_name='activities')
    logged_by = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='logged_activities'
    )

    class Meta:
        db_table = 'opportunity_activities'
        indexes = [models.Index(fields=['opportunity'])]


class OpportunityAttachment(CreatedModel):
    """A proposal, RFQ, contract or other document attached to an opportunity."""

    file_name = models.TextField()
    mime_type = models.TextField()
    bytes = models.IntegerField()
    storage_key = models.TextField()
    opportunity = models.ForeignKey(Opportunity, on_delete=models.CASCADE, related_name='attachments')
    uploaded_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='uploaded_opportunity_attachments'
    )

    class Meta:
        db_table = 'opportunity_attachments'
        indexes = [models.Index(fields=['opportunity'])]
