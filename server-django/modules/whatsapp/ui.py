"""
Presentation helpers for the WhatsApp task assistant: text gauges that stand
in for sliders (WhatsApp has no slider control), duration formatting, and the
short titles/hints shown on list rows. Plain Unicode shapes only - no emoji -
so it renders the same on every phone.
"""
import re
from datetime import date, datetime, timedelta

from core.dates import NAIROBI, js_round, utcnow
from core.enums import TaskStatus
from modules.tasks.options import CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS, VERTICAL_LABELS

FILLED = '■'
EMPTY = '□'


def gauge(fraction: float, cells: int = 10) -> str:
    """A text "slider track", e.g. gauge(0.3) -> ■■■□□□□□□□"""
    clamped = min(1, max(0, fraction))
    filled = js_round(clamped * cells)
    return FILLED * filled + EMPTY * (cells - filled)


def format_duration(hours: float) -> str:
    """1.2 -> "1 h 12 min", 0.5 -> "30 min", 3 -> "3 h"."""
    total_minutes = js_round(hours * 60)
    h, m = divmod(total_minutes, 60)
    if h == 0:
        return f'{m} min'
    if m == 0:
        return f'{h} h'
    return f'{h} h {m} min'


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else f'{text[:limit - 1]}…'


def _num(n: float) -> str:
    """A number as JavaScript prints it: 1 -> "1", 1.5 -> "1.5"."""
    return str(int(n)) if float(n).is_integer() else str(n)


# ── Step tracker ────────────────────────────────────────────────────────────

# Position of each "Log New Task" step - one place to renumber when a step is added.
STEP = {'date': 1, 'vertical': 2, 'category': 3, 'organization': 4, 'description': 5, 'project': 6, 'status': 7, 'time': 8}
TOTAL_STEPS = 8


def step_footer(step: int, label: str) -> str:
    """e.g. "■■■■□□□□  Step 4 of 8 · Organization"."""
    return f'{gauge(step / TOTAL_STEPS, TOTAL_STEPS)}  Step {step} of {TOTAL_STEPS} · {label}'


# ── Time slider ─────────────────────────────────────────────────────────────

WORKDAY_HOURS = 8

HOUR_STOPS = [
    (0.5, 'Quick fix or follow-up'),
    (1, 'One focused hour'),
    (1.5, 'A short session'),
    (2, 'Quarter of the day'),
    (3, 'A solid block'),
    (4, 'Half the day'),
    (5, 'A long stretch'),
    (6, 'Most of the day'),
    (8, 'The full working day'),
]

HOURS_CUSTOM_ID = 'hrs_custom'


def hour_slider_rows() -> list[dict]:
    rows = [
        {
            'id': f'hrs_{_num(hours)}',
            'title': format_duration(hours),
            # One cell per half hour, so every stop on the track looks different.
            'description': f'{gauge(hours / WORKDAY_HOURS, WORKDAY_HOURS * 2)}  {hint}',
        }
        for hours, hint in HOUR_STOPS
    ]
    rows.append({'id': HOURS_CUSTOM_ID, 'title': 'Exact time', 'description': 'Type it yourself, for example 2h 15m or 2.25'})
    return rows


_HRS_ROW = re.compile(r'^hrs_(\d+(?:\.\d+)?)$')
_CLOCK = re.compile(r'^(\d{1,2}):([0-5]\d)$')
_UNITS = re.compile(r'^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:ins?|inutes?)?)?$')
_PLAIN = re.compile(r'^\d+(?:[.,]\d+)?$')


def parse_hours(value: str) -> float | None:
    """Hours from a slider row id (hrs_1.5) or typed text (2.5, 2h 15m, 45m, 1:30). None outside 0-24."""
    text = value.strip().lower()
    hours = None
    from_row, clock, units, plain = _HRS_ROW.match(text), _CLOCK.match(text), _UNITS.match(text), _PLAIN.match(text)

    if from_row:
        hours = float(from_row.group(1))
    elif clock:
        hours = int(clock.group(1)) + int(clock.group(2)) / 60
    elif plain:
        hours = float(text.replace(',', '.', 1))
    elif units and (units.group(1) or units.group(2)):
        hours = float((units.group(1) or '0').replace(',', '.', 1)) + int(units.group(2) or '0') / 60

    if hours is None or hours < 0 or hours > 24:
        return None
    return js_round(hours * 100) / 100


# ── Progress slider ─────────────────────────────────────────────────────────

PERCENT_STOPS = [
    (0, 'Not started yet'),
    (10, 'Just getting going'),
    (25, 'A quarter of the way'),
    (40, 'Taking shape'),
    (50, 'Halfway there'),
    (60, 'Past the midpoint'),
    (75, 'Three quarters done'),
    (90, 'Final touches'),
    (100, 'Complete'),
]

PERCENT_CUSTOM_ID = 'pct_custom'


def percent_slider_rows() -> list[dict]:
    rows = [{'id': f'pct_{pct}', 'title': f'{pct}%', 'description': f'{gauge(pct / 100)}  {hint}'} for pct, hint in PERCENT_STOPS]
    rows.append({'id': PERCENT_CUSTOM_ID, 'title': 'Exact value', 'description': 'Type any whole number from 0 to 100'})
    return rows


_PERCENT = re.compile(r'^(?:pct_)?(\d{1,3}(?:\.\d+)?)\s*%?$')


def parse_percent(value: str) -> int | None:
    """Percent from a slider row id (pct_75) or typed text (75, 75%). None outside 0-100."""
    match = _PERCENT.match(value.strip().lower())
    if not match:
        return None
    pct = float(match.group(1))
    return js_round(pct) if 0 <= pct <= 100 else None


def status_needs_progress(status: str) -> bool:
    """Statuses where progress is genuinely partial, so it's worth asking for."""
    return status in (TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.ESCALATED)


# ── Row titles and hints ────────────────────────────────────────────────────
# List row titles cap at 24 characters and descriptions at 72, so the long
# spreadsheet labels get a short title plus a one-line hint.

VERTICAL_HINTS = {
    'APPLICATIONS_DATABASES': 'Business applications, databases and integrations',
    'INFRASTRUCTURE': 'Compute and storage: servers, virtualisation, backup',
    'NETWORKING': 'LAN and WAN: switching, routing, wireless, links',
    'POWER_SOLUTIONS': 'UPS, generators and power distribution',
    'CYBERSECURITY': 'Firewalls, endpoint protection and access control',
    'FINANCE': 'Accounts, payments and financial reporting',
    'LOGISTICS': 'Procurement, deliveries and inventory',
    'BIDS': 'Tenders, RFPs and proposals',
    'ACCOUNT_MANAGEMENT': 'Client relationships and renewals',
    'TECHNICAL_PRESALES': 'Solution design, demos and sizing',
    'PROJECT_MANAGEMENT': 'Planning, tracking and delivery',
    'ADMINISTRATION': 'Office and internal operations',
    'ERP_BUSINESS_APPLICATIONS': 'ERP, CRM and line-of-business systems',
    'CLOUD_SERVICES': 'Public, private and hybrid cloud',
    'DATA_ANALYTICS': 'BI, dashboards and data platforms',
    'HUMAN_RESOURCES': 'People, recruitment and staff welfare',
}

CATEGORY_HINTS = {
    'DEPLOYMENT': 'Installing or rolling out a new system',
    'SUPPORT_BREAK_FIX': 'Fixing a fault or responding to an incident',
    'PROOF_OF_CONCEPT': 'Trialling a solution with a client',
    'MAINTENANCE_UPGRADE': 'Patching, upgrades and routine care',
    'DESIGN_ARCHITECTURE': 'Planning and designing a solution',
    'RECEIVABLES': 'Invoicing and collecting payments',
    'PAYABLES': 'Paying suppliers and processing bills',
    'RECONCILIATIONS': 'Matching accounts and statements',
    'STATUTORY': 'Tax, compliance and regulatory filings',
    'REPORTING': 'Preparing reports and summaries',
    'INTRODUCTION': 'First contact with a prospect',
    'QUALIFICATION': 'Assessing a lead or opportunity',
    'SUBMISSION': 'Sending a proposal or bid',
    'TRAINING': 'Delivering or attending training',
    'DOCUMENTATION': 'Writing guides, runbooks or records',
    'MIGRATION': 'Moving systems or data',
    'AUDIT_COMPLIANCE': 'Audits, reviews and policy checks',
    'TENDER': 'Preparing or tracking a tender',
    'CUSTOMER_MEETING': 'Meeting or call with a customer',
    'PREQUALIFICATION': 'Supplier registration and prequalification',
    'WORKSHOP': 'Running or attending a workshop',
}

STATUS_HINTS = {
    'NOT_STARTED': 'Planned, work has not begun',
    'IN_PROGRESS': 'Work is under way',
    'RESOLVED': 'Issue fixed, awaiting closure',
    'BLOCKED': 'Waiting on something before it can continue',
    'COMPLETED_CLOSED': 'Finished and signed off',
    'ESCALATED': 'Handed up for further action',
}


def strip_number(label: str) -> str:
    """"13. ERP & Business Applications" -> "ERP & Business Applications"."""
    return re.sub(r'^\d+\.\s*', '', label, count=1)


def vertical_title(vertical: str) -> str:
    """Drops the number and any bracketed detail; ERP gets a hand-shortened title."""
    if vertical == 'ERP_BUSINESS_APPLICATIONS':
        return 'ERP & Business Apps'
    return clip(re.sub(r'\s*\(.*\)$', '', strip_number(VERTICAL_LABELS[vertical])), 24)


def organization_short_name(org: str) -> str:
    """"Millenium Solutions E.A Limited" -> "Millenium Solutions"."""
    return re.sub(r'\s+(E\.A\s+)?Limited$', '', ORGANIZATION_LABELS[org])


def vertical_row(vertical: str) -> dict:
    return {'id': f'vert_{vertical}', 'title': vertical_title(vertical), 'description': VERTICAL_HINTS[vertical]}


def category_row(category: str) -> dict:
    return {'id': f'cat_{category}', 'title': clip(CATEGORY_LABELS[category], 24), 'description': CATEGORY_HINTS[category]}


def status_row(status: str) -> dict:
    return {'id': f'status_{status}', 'title': STATUS_LABELS[status], 'description': STATUS_HINTS[status]}


def organization_row(org: str, description: str | None = None) -> dict:
    return {'id': f'org_{org}', 'title': clip(organization_short_name(org), 24), 'description': description or ORGANIZATION_LABELS[org]}


# ── Paged pickers ───────────────────────────────────────────────────────────

# WhatsApp lists hold at most 10 rows in total, so a middle page needs room
# for 8 options plus both "Previous" and "More" rows.
PAGE_SIZE = 8


def paged_sections(values: list[str], page: int, prefix: str, noun: str, row_for) -> list[dict]:
    """One page of a long picker: the options under a "Verticals 1-8 of 16" heading, then a "Browse" section."""
    last_page = max(0, -(-len(values) // PAGE_SIZE) - 1)
    current = min(max(0, page), last_page)
    start = current * PAGE_SIZE
    chunk = values[start:start + PAGE_SIZE]

    sections = [{'title': clip(f'{noun} {start + 1}-{start + len(chunk)} of {len(values)}', 24), 'rows': [row_for(v) for v in chunk]}]
    nav = []
    if current < last_page:
        remaining = len(values) - (start + len(chunk))
        nav.append({'id': f'{prefix}_next', 'title': 'Show more', 'description': f'{remaining} more {noun.lower()}'})
    if current > 0:
        nav.append({'id': f'{prefix}_prev', 'title': 'Previous page', 'description': 'Go back to the earlier options'})
    if nav:
        sections.append({'title': 'Browse', 'rows': nav})
    return sections


# ── Dates and the calendar picker ───────────────────────────────────────────
# Dates are plain "YYYY-MM-DD" strings for the Nairobi calendar day - the day
# a task is logged against - so no timezone drift creeps in near midnight.

MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def nairobi_now() -> datetime:
    return utcnow() + NAIROBI.utcoffset(None)


def nairobi_today() -> str:
    """Today's date in Nairobi, as YYYY-MM-DD."""
    return nairobi_now().date().isoformat()


def _d(iso: str) -> date:
    return date.fromisoformat(iso)


def add_days(iso: str, days: int) -> str:
    return (_d(iso) + timedelta(days=days)).isoformat()


def days_between(start: str, end: str) -> int:
    """Whole days from `start` to `end` (negative when `end` is earlier)."""
    return (_d(end) - _d(start)).days


def _month_name(month: int) -> str:
    return MONTHS[month - 1].capitalize()


def fmt_day_short(iso: str) -> str:
    """"Tue 14 Oct"."""
    d = _d(iso)
    return f'{_WEEKDAYS[d.weekday()][:3]} {d.day} {_month_name(d.month)[:3]}'


def fmt_day_long(iso: str) -> str:
    """"Tuesday 14 October"."""
    d = _d(iso)
    return f'{_WEEKDAYS[d.weekday()]} {d.day} {_month_name(d.month)}'


def relative_day_name(iso: str, today: str) -> str | None:
    diff = days_between(today, iso)
    return {0: 'today', -1: 'yesterday', 1: 'tomorrow'}.get(diff)


def month_calendar(today: str, logged_days: set[str]) -> str:
    """
    A month grid in monospace, Monday first. Today is bracketed and days that
    already have tasks carry a dot:

         Mo  Tu  We  Th  Fr  Sa  Su
                   1   2   3   4•
         12• 13•[14] 15  16  17  18
    """
    year, month = int(today[:4]), int(today[5:7])
    first = date(year, month, 1)
    next_month = date(year + (month == 12), month % 12 + 1, 1)
    days_in_month = (next_month - first).days
    lead = first.weekday()  # Monday = 0

    def cell(day: int) -> str:
        iso = f'{year:04d}-{month:02d}-{day:02d}'
        dd = f'{day:>2}'
        if iso == today:
            return f'[{dd}]'
        return f" {dd}{'•' if iso in logged_days else ' '}"

    cells = ['    '] * lead + [cell(i + 1) for i in range(days_in_month)]
    weeks = [''.join(cells[i:i + 7]).rstrip() for i in range(0, len(cells), 7)]
    title = f'{_month_name(month)} {year}'
    return '\n'.join(['```', title, ' Mo  Tu  We  Th  Fr  Sa  Su', *weeks, '```'])


DATE_OTHER_ID = 'date_other'


def date_rows(today: str, counts: dict[str, int]) -> list[dict]:
    """Today, yesterday, tomorrow, then the five days before yesterday - each with its task count."""
    def describe(iso: str) -> str:
        n = counts.get(iso, 0)
        logged = 'nothing logged yet' if n == 0 else f"{n} task{'' if n == 1 else 's'} logged"
        return f'{fmt_day_long(iso)} · {logged}'

    quick = [(today, 'Today'), (add_days(today, -1), 'Yesterday'), (add_days(today, 1), 'Tomorrow')]
    earlier = [add_days(today, -n) for n in (2, 3, 4, 5, 6)]
    return [
        {'title': 'Quick picks', 'rows': [{'id': f'date_{iso}', 'title': title, 'description': describe(iso)} for iso, title in quick]},
        {'title': 'Earlier days', 'rows': [{'id': f'date_{iso}', 'title': fmt_day_short(iso), 'description': describe(iso)} for iso in earlier]},
        {'title': 'Any other day', 'rows': [{'id': DATE_OTHER_ID, 'title': 'Other date', 'description': 'Type it, for example 05/10/2026 or 5 Oct'}]},
    ]


_ORDINAL = re.compile(r'(\d)(st|nd|rd|th)\b')
_DATE_ROW = re.compile(r'^date_(\d{4})-(\d{2})-(\d{2})$')
_ISO_LIKE = re.compile(r'^(\d{4})-(\d{1,2})-(\d{1,2})$')
_NUMERIC = re.compile(r'^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$')
_DAY_MONTH = re.compile(r'^(\d{1,2}) ([a-z]{3,9})(?: (\d{4}))?$')
_MONTH_DAY = re.compile(r'^([a-z]{3,9}) (\d{1,2})(?: (\d{4}))?$')


def _month_index(name: str) -> int:
    return next((i + 1 for i, m in enumerate(MONTHS) if m.startswith(name)), 0)


def parse_date_input(value: str, today: str) -> str | None:
    """
    A date from a picker row id (date_2026-10-14) or typed text: today /
    yesterday / tomorrow, 14/10, 14/10/2026, 14-10-2026, 2026-10-14, 14 Oct,
    Oct 14 or 14 October 2026. Day-first, as dates are written in Kenya.
    None when it isn't a real calendar date.
    """
    text = _ORDINAL.sub(r'\1', value.strip().lower())
    text = re.sub(r'\s+', ' ', text.replace(',', ' ')).strip()
    this_year = int(today[:4])

    words = {'today': 0, 'yesterday': -1, 'tomorrow': 1}
    if text in words:
        return add_days(today, words[text])

    y = m = d = None
    if match := _DATE_ROW.match(text):
        y, m, d = (int(g) for g in match.groups())
    elif match := _ISO_LIKE.match(text):
        y, m, d = (int(g) for g in match.groups())
    elif match := _NUMERIC.match(text):
        d, m = int(match.group(1)), int(match.group(2))
        year = match.group(3)
        y = int(f'20{year}' if year and len(year) == 2 else year) if year else this_year
    elif (match := _DAY_MONTH.match(text)) and _month_index(match.group(2)) > 0:
        d, m = int(match.group(1)), _month_index(match.group(2))
        y = int(match.group(3)) if match.group(3) else this_year
    elif (match := _MONTH_DAY.match(text)) and _month_index(match.group(1)) > 0:
        m, d = _month_index(match.group(1)), int(match.group(2))
        y = int(match.group(3)) if match.group(3) else this_year

    if not y or not m or not d:
        return None
    try:
        return date(y, m, d).isoformat()  # rejects 31/02 and the like
    except ValueError:
        return None


def greeting(now: datetime | None = None) -> str:
    """Time-of-day greeting in Nairobi time, where the team works."""
    hour = (now or nairobi_now()).hour
    if hour < 12:
        return 'Good morning'
    if hour < 17:
        return 'Good afternoon'
    return 'Good evening'
