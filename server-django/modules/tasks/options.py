"""
Human-readable labels for the task taxonomy, matching the source
spreadsheet's "Validation" sheet verbatim. Single source of truth for the
/tasks/options dropdowns and the WhatsApp bot.
"""
from core.enums import TaskStatus

VERTICAL_LABELS = {
    'APPLICATIONS_DATABASES': '1. Applications & Databases',
    'INFRASTRUCTURE': '2. Infrastructure (Compute & Storage)',
    'NETWORKING': '3. Networking (LAN & WAN)',
    'POWER_SOLUTIONS': '4. Power Solutions',
    'CYBERSECURITY': '5. Cybersecurity Solutions',
    'FINANCE': '6. Finance',
    'LOGISTICS': '7. Logistics',
    'BIDS': '8. Bids',
    'ACCOUNT_MANAGEMENT': '9. Account Management',
    'TECHNICAL_PRESALES': '10. Technical Presales',
    'PROJECT_MANAGEMENT': '11. Project Management',
    'ADMINISTRATION': '12. Administration',
    'ERP_BUSINESS_APPLICATIONS': '13. ERP & Business Applications',
    'CLOUD_SERVICES': '14. Cloud Services',
    'DATA_ANALYTICS': '15. Data & Analytics',
    'HUMAN_RESOURCES': '16. Human Resources',
}

CATEGORY_LABELS = {
    'DEPLOYMENT': 'Deployment',
    'SUPPORT_BREAK_FIX': 'Support (Break/Fix)',
    'PROOF_OF_CONCEPT': 'Proof of Concept (POC)',
    'MAINTENANCE_UPGRADE': 'Maintenance / Upgrade',
    'DESIGN_ARCHITECTURE': 'Design/Architecture',
    'RECEIVABLES': 'Receivables',
    'PAYABLES': 'Payables',
    'RECONCILIATIONS': 'Reconciliations',
    'STATUTORY': 'Statutory',
    'REPORTING': 'Reporting',
    'INTRODUCTION': 'Introduction',
    'QUALIFICATION': 'Qualification',
    'SUBMISSION': 'Submission',
    'TRAINING': 'Training',
    'DOCUMENTATION': 'Documentation',
    'MIGRATION': 'Migration',
    'AUDIT_COMPLIANCE': 'Audit / Compliance',
    'TENDER': 'Tender',
    'CUSTOMER_MEETING': 'Customer Meeting',
    'PREQUALIFICATION': 'Prequalifications',
    'WORKSHOP': 'Workshops',
}

STATUS_LABELS = {
    'NOT_STARTED': 'Not Started',
    'IN_PROGRESS': 'In Progress',
    'RESOLVED': 'Resolved',
    'BLOCKED': 'Blocked',
    'COMPLETED_CLOSED': 'Completed / Closed',
    'ESCALATED': 'Escalated',
}

ORGANIZATION_LABELS = {
    'MILLENIUM_SOLUTIONS': 'Millenium Solutions E.A Limited',
    'BRESTONE_AFRICA': 'Brestone Africa Limited',
    'BRIGHTON_TECHNOLOGIES': 'Brighton Technologies Limited',
    'MIRACOM_AFRICA': 'Miracom Africa Limited',
    'TRANSBIZ': 'Transbiz Limited',
    'BIGHATCH': 'Bighatch Limited',
}


def _as_options(labels: dict[str, str]) -> list[dict]:
    return [{'value': value, 'label': label} for value, label in labels.items()]


def get_task_options() -> dict:
    return {
        'verticals': _as_options(VERTICAL_LABELS),
        'categories': _as_options(CATEGORY_LABELS),
        'statuses': _as_options(STATUS_LABELS),
        'organizations': _as_options(ORGANIZATION_LABELS),
    }


# Statuses that count as "done" for the weekly completed-task counts.
COMPLETED_STATUSES = (TaskStatus.RESOLVED.value, TaskStatus.COMPLETED_CLOSED.value)
