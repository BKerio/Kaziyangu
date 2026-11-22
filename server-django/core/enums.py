"""
Shared enums (the Prisma enums re-exported by backend/src/shared/types).
Values equal names, exactly as Prisma stores them.
"""
from django.db import models


class Role(models.TextChoices):
    SUPER_ADMIN = 'SUPER_ADMIN'  # Full access, all verticals, user management
    ADMIN = 'ADMIN'  # Manage users + see all tasks/reports
    STAFF = 'STAFF'  # Logs and manages their own tasks
    ATTACHEE = 'ATTACHEE'  # Attachment/intern candidate - profile managed by admin


class Department(models.TextChoices):
    TECHNICAL = 'TECHNICAL'
    BUSINESS_DEVELOPMENT = 'BUSINESS_DEVELOPMENT'
    FINANCE = 'FINANCE'
    COMMERCIAL = 'COMMERCIAL'
    ADMIN = 'ADMIN'


# Sales pipeline: NEW -> QUALIFICATION -> ASSIGNED -> ENGAGEMENT -> PROPOSAL -> NEGOTIATION -> WON / LOST.
class OpportunityStage(models.TextChoices):
    NEW = 'NEW'
    QUALIFICATION = 'QUALIFICATION'
    ASSIGNED = 'ASSIGNED'
    ENGAGEMENT = 'ENGAGEMENT'
    PROPOSAL = 'PROPOSAL'
    NEGOTIATION = 'NEGOTIATION'
    WON = 'WON'
    LOST = 'LOST'


class OpportunityPriority(models.TextChoices):
    LOW = 'LOW'
    MEDIUM = 'MEDIUM'
    HIGH = 'HIGH'
    CRITICAL = 'CRITICAL'


class ActivityType(models.TextChoices):
    CALL = 'CALL'
    MEETING = 'MEETING'
    SITE_VISIT = 'SITE_VISIT'
    EMAIL = 'EMAIL'
    REQUIREMENTS_GATHERING = 'REQUIREMENTS_GATHERING'
    OTHER = 'OTHER'


class AttendanceStatus(models.TextChoices):
    PRESENT = 'PRESENT'
    LATE = 'LATE'
    HALF_DAY = 'HALF_DAY'
    ON_LEAVE = 'ON_LEAVE'
    ABSENT = 'ABSENT'


class WorkMode(models.TextChoices):
    ON_SITE = 'ON_SITE'
    REMOTE = 'REMOTE'
    HYBRID = 'HYBRID'


class ReportStatus(models.TextChoices):
    PENDING = 'PENDING'
    APPROVED = 'APPROVED'
    NEEDS_REVISION = 'NEEDS_REVISION'
    REJECTED = 'REJECTED'


# The organizational verticals a task can belong to (Master Daily Tasks sheet).
class TaskVertical(models.TextChoices):
    APPLICATIONS_DATABASES = 'APPLICATIONS_DATABASES'
    INFRASTRUCTURE = 'INFRASTRUCTURE'
    NETWORKING = 'NETWORKING'
    POWER_SOLUTIONS = 'POWER_SOLUTIONS'
    CYBERSECURITY = 'CYBERSECURITY'
    FINANCE = 'FINANCE'
    LOGISTICS = 'LOGISTICS'
    BIDS = 'BIDS'
    ACCOUNT_MANAGEMENT = 'ACCOUNT_MANAGEMENT'
    TECHNICAL_PRESALES = 'TECHNICAL_PRESALES'
    PROJECT_MANAGEMENT = 'PROJECT_MANAGEMENT'
    ADMINISTRATION = 'ADMINISTRATION'
    ERP_BUSINESS_APPLICATIONS = 'ERP_BUSINESS_APPLICATIONS'
    CLOUD_SERVICES = 'CLOUD_SERVICES'
    DATA_ANALYTICS = 'DATA_ANALYTICS'
    HUMAN_RESOURCES = 'HUMAN_RESOURCES'


class ReminderChannel(models.TextChoices):
    SMS = 'SMS'
    EMAIL = 'EMAIL'
    WHATSAPP = 'WHATSAPP'


# SCHEDULED -> ACTIVE (fired at least once) -> DONE / CANCELLED.
class ReminderStatus(models.TextChoices):
    SCHEDULED = 'SCHEDULED'
    ACTIVE = 'ACTIVE'
    DONE = 'DONE'
    CANCELLED = 'CANCELLED'


class TaskCategory(models.TextChoices):
    DEPLOYMENT = 'DEPLOYMENT'
    SUPPORT_BREAK_FIX = 'SUPPORT_BREAK_FIX'
    PROOF_OF_CONCEPT = 'PROOF_OF_CONCEPT'
    MAINTENANCE_UPGRADE = 'MAINTENANCE_UPGRADE'
    DESIGN_ARCHITECTURE = 'DESIGN_ARCHITECTURE'
    RECEIVABLES = 'RECEIVABLES'
    PAYABLES = 'PAYABLES'
    RECONCILIATIONS = 'RECONCILIATIONS'
    STATUTORY = 'STATUTORY'
    REPORTING = 'REPORTING'
    INTRODUCTION = 'INTRODUCTION'
    QUALIFICATION = 'QUALIFICATION'
    SUBMISSION = 'SUBMISSION'
    TRAINING = 'TRAINING'
    DOCUMENTATION = 'DOCUMENTATION'
    MIGRATION = 'MIGRATION'
    AUDIT_COMPLIANCE = 'AUDIT_COMPLIANCE'
    TENDER = 'TENDER'
    CUSTOMER_MEETING = 'CUSTOMER_MEETING'
    PREQUALIFICATION = 'PREQUALIFICATION'
    WORKSHOP = 'WORKSHOP'


class TaskStatus(models.TextChoices):
    NOT_STARTED = 'NOT_STARTED'
    IN_PROGRESS = 'IN_PROGRESS'
    RESOLVED = 'RESOLVED'
    BLOCKED = 'BLOCKED'
    COMPLETED_CLOSED = 'COMPLETED_CLOSED'
    ESCALATED = 'ESCALATED'


# Which of the group's legal entities a task is logged against.
class Organization(models.TextChoices):
    MILLENIUM_SOLUTIONS = 'MILLENIUM_SOLUTIONS'
    BRESTONE_AFRICA = 'BRESTONE_AFRICA'
    BRIGHTON_TECHNOLOGIES = 'BRIGHTON_TECHNOLOGIES'
    MIRACOM_AFRICA = 'MIRACOM_AFRICA'
    TRANSBIZ = 'TRANSBIZ'
    BIGHATCH = 'BIGHATCH'


def values(choices: type[models.TextChoices]) -> list[str]:
    """Enum values in declaration order (Object.values(Enum) in the Node code)."""
    return [c.value for c in choices]


MANAGER_ROLES = (Role.ADMIN.value, Role.SUPER_ADMIN.value)
STAFF_ROLES = (Role.STAFF.value, Role.ADMIN.value, Role.SUPER_ADMIN.value)
