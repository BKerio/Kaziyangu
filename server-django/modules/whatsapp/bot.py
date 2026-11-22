"""
Routes inbound WhatsApp messages to the daily-task wizard, backed by the same
task service as the HTTP API - so every WhatsApp-created/updated task gets
identical validation, ownership checks, and socket broadcasts.

Every reply is billed by Meta, so related content is merged into one
interactive message wherever it fits (e.g. "Task saved" rides on the main
menu rather than arriving as a separate text).
"""
import json
import re
import secrets
import time

from core.dates import iso_day
from core.enums import Organization, TaskCategory, TaskStatus, TaskVertical, values
from core.env import frontend_origin
from core.jwt import Actor
from core.logger import logger
from modules.auth.models import User
from modules.campaigns import service as campaigns
from modules.tasks import attachment_service, service as tasks
from modules.tasks.attachment_constants import (
    ALLOWED_ATTACHMENT_MIMES,
    DOCX_MIME,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_PER_TASK,
)
from modules.tasks.models import WorkTask
from modules.tasks.options import CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS, VERTICAL_LABELS

from . import sessions
from .client import WhatsAppClient, is_business_scoped_user_id
from .menus import (
    ASSISTANT_NAME,
    BACK_BUTTON,
    LEAVE_BUTTONS,
    MAIN_MENU_ACTION_IDS,
    MAIN_MENU_TEXT,
    MENU_FOOTER,
    MENU_TRIGGERS,
    REVIEW_BUTTONS,
    STEP_BACK_BUTTON,
    WORKWEEK_HOURS,
    day_nudge,
    help_text,
    main_menu_sections,
    unregistered_text,
)
from .sessions import Session
from .task_format import format_task_summary
from .ui import (
    DATE_OTHER_ID,
    HOURS_CUSTOM_ID,
    PERCENT_CUSTOM_ID,
    STEP,
    TOTAL_STEPS,
    WORKDAY_HOURS,
    add_days,
    category_row,
    clip,
    date_rows,
    days_between,
    fmt_day_long,
    fmt_day_short,
    format_duration,
    gauge,
    greeting,
    hour_slider_rows,
    month_calendar,
    nairobi_now,
    nairobi_today,
    organization_row,
    organization_short_name,
    paged_sections,
    parse_date_input,
    parse_hours,
    parse_percent,
    percent_slider_rows,
    relative_day_name,
    status_needs_progress,
    status_row,
    step_footer,
    strip_number,
    vertical_row,
)
from .user_lookup import find_user_by_phone, find_user_by_whatsapp_id, link_whatsapp_id, to_whatsapp_number

MAX_ATTACHMENT_MB = round(MAX_ATTACHMENT_BYTES / (1024 * 1024))

VERTICAL_VALUES = values(TaskVertical)
CATEGORY_VALUES = values(TaskCategory)
STATUS_VALUES = values(TaskStatus)
ORGANIZATION_VALUES = values(Organization)

ADD_HEADER = 'Log New Task'
UPDATE_HEADER = 'Update Task'
REPEAT_HEADER = 'Repeat Last Task'

# Text messages max out at 4096 characters; leave headroom when splitting long task lists.
CHUNK_LIMIT = 3500
# Interactive message bodies max out at 1024 characters.
BODY_LIMIT = 1024

LINK_CODE_TTL_MS = 10 * 60_000
MAX_LINK_CODE_TRIES = 5
MAX_LINK_CODE_SENDS = 3

# How far back or ahead a task's date may be set from WhatsApp.
MAX_DAYS_BACK = 90
MAX_DAYS_AHEAD = 30

# WhatsApp text can't carry a custom icon, so a verified user's name gets the
# one emoji the assistant uses - the closest match to the portal's blue badge.
VERIFIED_MARK = '☑️'

_PHONE_RE = re.compile(r'^\+?\d{9,15}$')

# Which numbered step a draft is on, for the "Leave this task?" prompt.
FLOW_STEP = {
    'task_add_vertical': STEP['vertical'],
    'task_add_category': STEP['category'],
    'task_add_organization': STEP['organization'],
    'task_add_description': STEP['description'],
    'task_add_project': STEP['project'],
    'task_add_status': STEP['status'],
    'task_add_percent': STEP['status'],
    'task_add_hours': STEP['time'],
}


# ── Small helpers ───────────────────────────────────────────────────────────

def _ext_from_mime(mime_type: str) -> str:
    if mime_type == 'application/pdf':
        return '.pdf'
    if mime_type == DOCX_MIME:
        return '.docx'
    match = re.match(r'^image/(jpeg|png|webp|gif)$', mime_type)
    if not match:
        return ''
    return '.jpg' if match.group(1) == 'jpeg' else f'.{match.group(1)}'


def _kind_of(mime_type: str) -> str:
    """"PDF", "Word document" or "Screenshot" - how a queued file is described back."""
    if mime_type == 'application/pdf':
        return 'PDF'
    if mime_type == DOCX_MIME:
        return 'Word document'
    return 'Screenshot'


def _clean_file_name(name: str | None) -> str:
    """No path parts or control characters, sensible length."""
    base = re.split(r'[\\/]', name or '')[-1]
    return re.sub(r'[\x00-\x1f"<>|*?]', '', base).strip()[:120]


def _attachments_from_session(data: dict) -> list[dict]:
    """Queued files - stored as a JSON blob under one key, since session data is a flat string map."""
    raw = data.get('attachments')
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _identify_sender(message: dict, contacts: list[dict] | None) -> dict | None:
    """
    The sender's phone digits (from `from`, or the matching contact's `wa_id`)
    and business-scoped user id. A BSUID is not a phone number, so its digits
    are never matched against anyone's phone.
    """
    contacts = contacts or []

    def is_phone(value) -> bool:
        return isinstance(value, str) and bool(_PHONE_RE.match(value))

    sender_from = message.get('from')
    phone = sender_from if is_phone(sender_from) else next((c.get('wa_id') for c in contacts if is_phone(c.get('wa_id'))), None)
    candidates = [message.get('from_user_id'), sender_from, (contacts[0] if contacts else {}).get('user_id')]
    user_id = next((v for v in candidates if is_business_scoped_user_id(v)), None)
    address = phone or user_id
    return {'address': address, 'phone': phone, 'userId': user_id} if address else None


def _mask_phone(phone: str) -> str:
    """"…0480" - enough to tell senders apart in logs without recording full numbers."""
    return f'…{phone[-4:]}'


def _mask_address(address: str) -> str:
    return f'username user …{address[-4:]}' if is_business_scoped_user_id(address) else _mask_phone(address)


def _extract_input(message: dict) -> str:
    kind = message.get('type')
    if kind == 'text':
        return ((message.get('text') or {}).get('body') or '').strip()
    if kind == 'interactive':
        interactive = message.get('interactive') or {}
        button_id = (interactive.get('button_reply') or {}).get('id')
        if button_id is not None:
            return button_id
        return (interactive.get('list_reply') or {}).get('id') or ''
    if kind == 'button':
        return (message.get('button') or {}).get('payload') or ''
    return ''


def _display_name(user: User, name: str | None = None) -> str:
    """"*Brian Kerio* ☑️" for every active account, matching the web portal."""
    name = name or user.name
    return f'*{name}* {VERIFIED_MARK}' if user.is_active else f'*{name}*'


def _task_word(count: int) -> str:
    return 'task' if count == 1 else 'tasks'


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _indent(text: str, spaces: int = 2) -> str:
    pad = ' ' * spaces
    return '\n'.join(pad + line for line in text.split('\n'))


def _title_case(value: str) -> str:
    return re.sub(r'\b\w', lambda m: m.group(0).upper(), value.replace('_', ' ').lower())


def _resolve_from_id(value: str, prefix: str, allowed: list[str]) -> str | None:
    if not value.startswith(f'{prefix}_'):
        return None
    candidate = value[len(prefix) + 1:]
    return candidate if candidate in allowed else None


def _has_unsaved_draft(session: Session) -> bool:
    """True once a "Log New Task" draft holds answers worth protecting - past the opening date step."""
    return session.flow.startswith('task_add_') and session.flow != 'task_add_date'


def _default_percent_for_status(status: str) -> int:
    """Progress implied by a status that doesn't need asking about."""
    if status in (TaskStatus.COMPLETED_CLOSED, TaskStatus.RESOLVED):
        return 100
    if status == TaskStatus.IN_PROGRESS:
        return 50
    return 0


def _draft_from_session(data: dict) -> dict:
    return {
        'date': data.get('date') or nairobi_today(),
        'vertical': data.get('vertical') or None,
        'category': data.get('category') or None,
        'organization': data.get('organization') or None,
        'description': data.get('description') or None,
        'customerProject': data.get('customerProject') or None,
        'status': data.get('status') or TaskStatus.NOT_STARTED.value,
        'hoursSpent': float(data['hoursSpent']) if data.get('hoursSpent') else None,
        'percentComplete': int(float(data['percentComplete'])) if data.get('percentComplete') else 0,
    }


def _week_range() -> tuple[str, str]:
    """Monday-Sunday range containing today (Nairobi), as YYYY-MM-DD strings."""
    today = nairobi_today()
    start = add_days(today, -nairobi_now().weekday())
    return start, add_days(start, 6)


def _chunk_blocks(header: str, blocks: list[str]) -> list[str]:
    """Splits blocks of text into messages that each stay under the text-message size limit."""
    chunks, current = [], header
    for block in blocks:
        if len(current) + len(block) > CHUNK_LIMIT:
            chunks.append(current.strip())
            current = block
        else:
            current += block
    chunks.append(current.strip())
    return chunks


def _actor(user: User) -> Actor:
    return Actor(user_id=user.id, role=user.role)


class WhatsAppBot:
    def __init__(self, client: WhatsAppClient) -> None:
        self.client = client
        self.portal_url = frontend_origin() or 'the staff web portal'

    def _send(self, to: str, message: dict) -> bool:
        return self.client.send_message(to, message)

    def _text(self, to: str, text: str) -> bool:
        return self._send(to, {'type': 'text', 'text': text})

    # ── Webhook ──────────────────────────────────────────────────────────────

    def process_webhook(self, payload: dict) -> None:
        if not isinstance(payload, dict) or payload.get('object') != 'whatsapp_business_account':
            return

        for entry in payload.get('entry') or []:
            for change in entry.get('changes') or []:
                value = change.get('value')
                if not value:
                    continue

                # Meta accepts a send first and reports non-delivery later, here -
                # without this, a reply that never reached someone leaves no trace.
                for status in value.get('statuses') or []:
                    if status.get('status') != 'failed':
                        continue
                    err = (status.get('errors') or [{}])[0]
                    recipient = status.get('recipient_id')
                    logger.warn(
                        'WhatsApp message was not delivered',
                        to=_mask_phone(recipient) if recipient else ('username user' if status.get('recipient_user_id') else 'unknown'),
                        code=err.get('code'), title=err.get('title'),
                        details=(err.get('error_data') or {}).get('details') or err.get('message'),
                    )

                for message in value.get('messages') or []:
                    self.client.mark_as_read(message.get('id'))
                    sender = _identify_sender(message, value.get('contacts'))
                    if sender is None:
                        logger.warn(
                            'Inbound WhatsApp message has neither a phone number nor a user id - skipped',
                            type=message.get('type'), messageKeys=list(message.keys()),
                            contactKeys=list(((value.get('contacts') or [{}])[0]).keys()),
                        )
                        continue
                    try:
                        self._handle_message(sender, message)
                    except Exception as err:  # noqa: BLE001
                        logger.error('WhatsApp message handling failed', err, **{'from': _mask_address(sender['address'])})

    def _resolve_user(self, sender: dict) -> User | None:
        """By phone when WhatsApp shares it (remembering their user id), otherwise by a linked user id."""
        if sender['phone']:
            user = find_user_by_phone(sender['phone'])
            if user and sender['userId'] and user.whatsapp_user_id != sender['userId']:
                link_whatsapp_id(user.id, sender['userId'])
            if user or not sender['userId']:
                return user
        return find_user_by_whatsapp_id(sender['userId']) if sender['userId'] else None

    # ── Linking a username-only sender to their profile ────────────────────────
    # Someone whose WhatsApp hides their number can't be matched by phone, so
    # they confirm who they are once: they type the number on their profile and
    # we send a one-time code to that number. Only its real owner can read it.

    def _handle_unlinked_sender(self, to: str, whatsapp_user_id: str, text: str, normalized: str) -> None:
        session = sessions.get(to)
        if session.flow == 'link_code':
            if normalized == 'restart':
                sessions.advance(to, 'link_phone', {'code': '', 'linkUser': ''})
                self._send_link_intro(to, 'Start again: reply with the phone number saved on your staff profile.')
                return
            self._step_link_code(to, whatsapp_user_id, text, session)
            return
        if session.flow == 'link_phone':
            self._step_link_phone(to, text, session)
            return
        sessions.reset(to)
        sessions.advance(to, 'link_phone', {})
        self._send_link_intro(to)

    def _send_link_intro(self, to: str, lead: str | None = None) -> None:
        self._text(
            to,
            f'*{ASSISTANT_NAME}*\n\n'
            + (lead or 'Welcome. Your WhatsApp uses a username, which hides your phone number, so I need to confirm '
                       'who you are once.\n\nReply with the *phone number saved on your staff profile*, for example 0712 345 678.')
            + '\n\n_I will send a one-time code to that number to confirm it is yours._',
        )

    def _step_link_phone(self, to: str, text: str, session: Session) -> None:
        digits = re.sub(r'\D', '', text)
        if len(digits) < 9 or len(digits) > 15:
            self._send_link_intro(to, 'That does not look like a phone number. Reply with the number on your staff profile, '
                                      'for example 0712 345 678.')
            return

        sends = int(session.data.get('codeSends') or '0')
        if sends >= MAX_LINK_CODE_SENDS:
            self._text(to, 'Too many attempts. Please ask your administrator to check the phone number on your profile, '
                           f'or sign in at {self.portal_url}.')
            return

        user = find_user_by_phone(digits)
        if user is None or not user.phone:
            self._text(to, 'No staff profile has that phone number.\n\n'
                           f'Check the number and try again, or ask your administrator to add it to your profile at {self.portal_url}.')
            return

        code = str(secrets.randbelow(900_000) + 100_000)
        sent = self._text(
            to_whatsapp_number(user.phone),
            f'*{code}* is your Task Assistant code. Type it in the chat to link your WhatsApp to your staff profile. '
            'It expires in 10 minutes.\n\nIf you did not ask for this, ignore this message.',
        )
        if not sent:
            sessions.advance(to, 'link_phone', {'codeSends': str(sends + 1)})
            self._text(to, 'I could not send a code to that number. Make sure it is the number you use for WhatsApp, '
                           'then type it again.')
            return

        sessions.advance(to, 'link_code', {
            'linkUser': user.id,
            'code': code,
            'codeExpires': str(int(time.time() * 1000) + LINK_CODE_TTL_MS),
            'codeTries': '0',
            'codeSends': str(sends + 1),
        })
        last4 = re.sub(r'\D', '', user.phone)[-4:]
        self._text(to, f'I have sent a 6-digit code to the WhatsApp number ending *{last4}*. Type the code here.\n\n'
                       '_Type *restart* to use a different number._')

    def _step_link_code(self, to: str, whatsapp_user_id: str, text: str, session: Session) -> None:
        code, link_user = session.data.get('code'), session.data.get('linkUser')
        expires = int(session.data.get('codeExpires') or 0)
        tries = int(session.data.get('codeTries') or '0') + 1

        if not code or not link_user or time.time() * 1000 > expires or tries > MAX_LINK_CODE_TRIES:
            sessions.advance(to, 'link_phone', {'code': '', 'linkUser': ''})
            self._send_link_intro(to, 'That code has expired. Reply with your phone number again to get a new one.')
            return

        if not secrets.compare_digest(re.sub(r'\D', '', text), code):
            left = MAX_LINK_CODE_TRIES - tries
            sessions.advance(to, 'link_code', {'codeTries': str(tries)})
            self._text(to, f"That code is not right. {left} {'try' if left == 1 else 'tries'} left.")
            return

        link_whatsapp_id(link_user, whatsapp_user_id)
        logger.info('Linked WhatsApp username user to staff profile', userId=link_user)
        user = find_user_by_whatsapp_id(whatsapp_user_id)
        if user:
            self._show_main_menu(to, user, '*You are all set.* This WhatsApp is now linked to your staff profile.')

    # ── Routing ──────────────────────────────────────────────────────────────

    def _handle_message(self, sender: dict, message: dict) -> None:
        to = sender['address']
        user = self._resolve_user(sender)
        logger.info('Inbound WhatsApp message', **{
            'from': _mask_address(to), 'viaUsername': not sender['phone'], 'type': message.get('type'),
            'matchedUser': user.id if user else None,
        })
        if user is None:
            if not sender['phone'] and sender['userId']:
                text = _extract_input(message)
                self._handle_unlinked_sender(to, sender['userId'], text, text.lower().strip())
                return
            self._text(to, unregistered_text(self.portal_url))
            return

        if message.get('type') in ('image', 'document'):
            if message['type'] == 'image':
                image = message.get('image') or {}
                media = {'id': image.get('id'), 'mimeType': image.get('mime_type') or ''}
            else:
                document = message.get('document') or {}
                media = {'id': document.get('id'), 'mimeType': document.get('mime_type') or '',
                         'fileName': _clean_file_name(document.get('filename'))}

            if sessions.get(to).flow == 'task_add_attachment':
                self._step_add_attachment_media(to, media)
            else:
                self._send(to, {
                    'type': 'buttons',
                    'header': ASSISTANT_NAME,
                    'text': 'Files are added while logging a task, just before you review it.\n\n'
                            'Start with *Log New Task* and you will be asked for them at the right moment.',
                    'buttons': [{'id': 'task_add', 'title': 'Log New Task'}, BACK_BUTTON],
                })
            return

        text = _extract_input(message)
        if not text:
            self._text(to, 'The Task Assistant understands text, photos, PDF and Word files, and menu selections. '
                           'Type *menu* to see your options.')
            return

        normalized = text.lower().strip()
        session = sessions.get(to)

        # "View Notice" on a campaign notice - show the full message, then put
        # them back exactly where they were if they were mid-task.
        if text.startswith(campaigns.NOTICE_PAYLOAD_PREFIX):
            notice = campaigns.open_notice(text[len(campaigns.NOTICE_PAYLOAD_PREFIX):], user.id)
            self._text(to, campaigns.notice_text(notice['title'], notice['message'], user.name)
                       if notice else 'That notice is no longer available.')
            if session.flow != 'idle':
                self._render_step(to, user, session)
            return

        # "menu", "hi", "cancel" and the like mid-task would otherwise throw the
        # whole draft away on one stray message - so confirm first. Saying it a
        # second time while the confirmation is showing counts as the confirmation.
        wants_out = normalized in MENU_TRIGGERS or normalized == 'cancel' or text == 'main_menu'
        if wants_out:
            target = 'help' if normalized == 'help' else 'menu'
            draft = _has_unsaved_draft(session)
            if draft and session.data.get('leave') != '1':
                self._ask_leave_confirm(to, session, target)
                return
            if target == 'help':
                self._show_help(to, user)
            else:
                self._show_main_menu(to, user, 'Task discarded. Nothing was saved.' if draft else None)
            return

        if session.flow != 'idle':
            self._handle_active_flow(to, user, text, normalized, session)
            return

        if text in MAIN_MENU_ACTION_IDS:
            self._handle_menu_action(to, user, text)
            return

        self._show_main_menu(to, user)

    # ── Menu screens ─────────────────────────────────────────────────────────

    def _menu_snapshot(self, user: User) -> dict:
        """Today's and this week's totals plus the last task - everything the menu previews."""
        today = nairobi_today()
        start, end = _week_range()
        week = tasks.get_tasks(_actor(user), user_id=user.id, from_=start, to=end, page=1, limit=200)['data']
        last = WorkTask.objects.filter(user_id=user.id).order_by('-created_at').values('category', 'organization').first()
        todays = [t for t in week if iso_day(t['date']) == today]

        last_label = None
        if last:
            last_label = CATEGORY_LABELS[last['category']] + (
                f" · {organization_short_name(last['organization'])}" if last['organization'] else '')

        return {
            'todayCount': len(todays),
            'todayHours': sum(t['hoursSpent'] for t in todays),
            'weekCount': len(week),
            'weekHours': sum(t['hoursSpent'] for t in week),
            'lastTaskLabel': last_label,
            'roleLine': _title_case(user.role) + (f' · {_title_case(user.department)}' if user.department else ''),
        }

    def _menu_intro(self, user: User, s: dict) -> str:
        """Greeting card: who you are, the date, today's and this week's progress, and a nudge."""
        first_name = user.name.split(' ')[0] or user.name
        now = nairobi_now()
        date_line = fmt_day_long(now.date().isoformat())
        return (
            f'{greeting()}, {_display_name(user, first_name)}\n'
            f'_{date_line}_\n\n'
            f"*Today*\n{gauge(s['todayHours'] / WORKDAY_HOURS)}  {format_duration(s['todayHours'])} of {WORKDAY_HOURS} h · "
            f"{_plural(s['todayCount'], 'task')}\n\n"
            f"*This week*\n{gauge(s['weekHours'] / WORKWEEK_HOURS)}  {format_duration(s['weekHours'])} of {WORKWEEK_HOURS} h · "
            f"{_plural(s['weekCount'], 'task')}\n\n"
            + day_nudge(s)
        )

    def _show_main_menu(self, to: str, user: User, lead: str | None = None) -> None:
        sessions.reset(to)
        snapshot = self._menu_snapshot(user)
        body = f'{lead}\n\n{MAIN_MENU_TEXT}' if lead else f'{self._menu_intro(user, snapshot)}\n\n{MAIN_MENU_TEXT}'
        self._send_menu(to, snapshot, body)

    def _send_menu(self, to: str, snapshot: dict, body: str) -> None:
        """The main menu list, carrying `body` - or, if it's too long for a list, as a separate text first."""
        if len(body) > BODY_LIMIT:
            self._text(to, body)
            body = MAIN_MENU_TEXT
        self._send(to, {
            'type': 'list', 'header': ASSISTANT_NAME, 'text': body, 'footer': MENU_FOOTER,
            'buttonLabel': 'Open Menu', 'sections': main_menu_sections(snapshot),
        })

    def _send_chunks_with_buttons(self, to: str, chunks: list[str], buttons: list[dict], footer: str | None = None) -> None:
        """Sends text chunks, folding the last one into a buttons message when it fits."""
        last = chunks[-1] if chunks else ''
        leading = chunks[:-1] if len(last) <= BODY_LIMIT else chunks
        for text in leading:
            self._text(to, text)
        message = {'type': 'buttons', 'text': last if len(last) <= BODY_LIMIT else 'What next?', 'buttons': buttons}
        if footer:
            message['footer'] = footer
        self._send(to, message)

    def _show_help(self, to: str, user: User) -> None:
        sessions.reset(to)
        self._send_menu(to, self._menu_snapshot(user), help_text(self.portal_url))

    def _show_profile(self, to: str, user: User) -> None:
        sessions.reset(to)
        self._send(to, {
            'type': 'buttons',
            'header': 'My Profile',
            'text': f'{_display_name(user)}\n'
                    + _title_case(user.role)
                    + (f' · {_title_case(user.department)}' if user.department else '')
                    + '\n\n'
                    + f'Phone: {user.phone}\n'
                    + (f'Email: {user.email}\n' if user.email else '')
                    + f'\nTo change these details, sign in at {self.portal_url}',
            'footer': MENU_FOOTER,
            'buttons': [BACK_BUTTON],
        })

    def _show_today_tasks(self, to: str, user: User) -> None:
        sessions.reset(to)
        today = nairobi_today()
        task_list = tasks.get_tasks(_actor(user), user_id=user.id, from_=today, to=today, page=1, limit=50)['data']
        buttons = [{'id': 'task_add', 'title': 'Log New Task'}, {'id': 'task_update', 'title': 'Update Task'}, BACK_BUTTON]

        if not task_list:
            self._send(to, {
                'type': 'buttons',
                'header': "Today's Tasks",
                'text': f'Nothing logged yet for {today}.\n\nTap *Log New Task* to record your first one.',
                'buttons': [{'id': 'task_add', 'title': 'Log New Task'}, BACK_BUTTON],
            })
            return

        total_hours = sum(t['hoursSpent'] for t in task_list)
        header = (f"*Today's Tasks*  ·  {today}\n"
                  f'{gauge(total_hours / WORKDAY_HOURS)}  {format_duration(total_hours)} across {len(task_list)} '
                  f'{_task_word(len(task_list))}\n\n')
        chunks = _chunk_blocks(header, [f'{format_task_summary(t, i + 1)}\n\n' for i, t in enumerate(task_list)])
        self._send_chunks_with_buttons(to, chunks, buttons)

    def _show_week_tasks(self, to: str, user: User) -> None:
        sessions.reset(to)
        start, end = _week_range()
        task_list = tasks.get_tasks(_actor(user), user_id=user.id, from_=start, to=end, page=1, limit=200)['data']

        if not task_list:
            self._send(to, {
                'type': 'buttons',
                'header': 'This Week',
                'text': f'Nothing logged between {start} and {end} yet.',
                'buttons': [{'id': 'task_add', 'title': 'Log New Task'}, BACK_BUTTON],
            })
            return

        by_date: dict[str, list[dict]] = {}
        for t in task_list:
            by_date.setdefault(iso_day(t['date']), []).append(t)

        total_hours = sum(t['hoursSpent'] for t in task_list)
        header = (f'*This Week*  ·  {start} to {end}\n'
                  f'{format_duration(total_hours)} across {len(task_list)} {_task_word(len(task_list))}\n\n')

        blocks = []
        for day, day_tasks in sorted(by_date.items()):
            day_hours = sum(t['hoursSpent'] for t in day_tasks)
            block = (f'*{day}*\n{gauge(day_hours / WORKDAY_HOURS)}  {format_duration(day_hours)} · '
                     f'{len(day_tasks)} {_task_word(len(day_tasks))}\n\n')
            for i, t in enumerate(day_tasks):
                block += f'{_indent(format_task_summary(t, i + 1))}\n\n'
            blocks.append(block)

        self._send_chunks_with_buttons(to, _chunk_blocks(header, blocks), [BACK_BUTTON])

    def _handle_menu_action(self, to: str, user: User, action_id: str) -> None:
        handlers = {
            'tasks_today': self._show_today_tasks,
            'tasks_week': self._show_week_tasks,
            'task_add': self._start_add_task,
            'task_repeat': self._start_repeat_task,
            'task_update': self._start_update_task,
            'my_profile': self._show_profile,
            'help': self._show_help,
        }
        handlers.get(action_id, self._show_main_menu)(to, user)

    # ── Navigation safety ────────────────────────────────────────────────────

    def _ask_leave_confirm(self, to: str, session: Session, target: str) -> None:
        """
        "Leave this task?" - shown instead of silently discarding a half-filled
        draft. Keep Going comes first; the draft stays untouched until Discard
        Task is tapped explicitly.
        """
        sessions.advance(to, session.flow, {'leave': '1', 'leaveTo': target})
        draft = _draft_from_session(session.data)
        step = FLOW_STEP.get(session.flow)
        where = f"You're on step {step} of {TOTAL_STEPS}." if step else "You're at the final review."

        saved = [
            f"Date: {fmt_day_short(draft['date'])}",
            f"Category: {CATEGORY_LABELS[draft['category']]}" if draft['category'] else None,
            f"Organization: {organization_short_name(draft['organization'])}" if draft['organization'] else None,
            f"Description: {clip(draft['description'], 60)}" if draft['description'] else None,
        ]
        self._send(to, {
            'type': 'buttons',
            'header': 'Leave this task?',
            'text': f"{where} If you leave now, what you've entered will be lost:\n\n"
                    + '\n'.join(line for line in saved if line)
                    + '\n\nTap *Keep Going* to carry on where you left off.',
            'footer': 'Nothing is saved until you tap Save Task',
            'buttons': LEAVE_BUTTONS,
        })

    def _render_step(self, to: str, user: User, session: Session) -> None:
        """Re-sends the prompt for whichever step the session is on (after Keep Going or Back)."""
        data, flow = session.data, session.flow
        repeat = data.get('repeat') == '1'
        if flow == 'task_add_date':
            self._send_date_picker(to, user, REPEAT_HEADER if repeat else ADD_HEADER)
        elif flow == 'task_add_vertical':
            self._send_vertical_picker(to, int(data.get('verticalPage') or '0'))
        elif flow == 'task_add_category':
            self._send_category_picker(to, data.get('vertical'), int(data.get('categoryPage') or '0'))
        elif flow == 'task_add_organization':
            self._send_organization_picker(to, user, ADD_HEADER, '*Which organization is this for?*',
                                           step_footer(STEP['organization'], 'Organization'))
        elif flow == 'task_add_description':
            preface = (f"Your answer so far:\n_{clip(data['description'], 300)}_\n\nType it again, changed as needed.\n\n"
                       if data.get('description') else '')
            self._send_description_prompt(to, REPEAT_HEADER if repeat else ADD_HEADER, preface)
        elif flow == 'task_add_project':
            self._send_project_prompt(to, data.get('lastProject') or '')
        elif flow == 'task_add_status':
            self._send_status_step(to)
        elif flow == 'task_add_percent':
            self._send_percent_step(to, data.get('status'))
        elif flow == 'task_add_hours':
            self._send_add_hours_slider(to)
        elif flow == 'task_add_attachment':
            self._send_attachment_step(to, len(_attachments_from_session(data)))
        elif flow == 'task_add_confirm':
            self._show_add_confirm(to, session)
        else:
            self._show_main_menu(to, user)

    def _step_back(self, to: str, user: User, session: Session) -> None:
        """
        Back: one step earlier, keeping every answer given so far. From the very
        first step, Back returns to the menu, as nothing has been entered yet.
        """
        flow, data = session.flow, session.data
        repeat = data.get('repeat') == '1'

        # Update Task: back out one screen at a time, to the menu at most.
        if flow == 'task_update_pick':
            self._show_main_menu(to, user)
            return
        if flow == 'task_update_field':
            self._start_update_task(to, user)
            return
        if flow.startswith('task_update_'):
            sessions.set_flow(to, 'task_update_field')
            if not data.get('updateTaskId') or not self._send_update_field_picker(to, user, data['updateTaskId']):
                self._show_main_menu(to, user)
            return

        previous = {
            'task_add_vertical': 'task_add_date',
            'task_add_category': 'task_add_vertical',
            'task_add_organization': 'task_add_date' if repeat else 'task_add_category',
            'task_add_description': 'task_add_date' if repeat else 'task_add_organization',
            'task_add_project': 'task_add_description',
            'task_add_status': 'task_add_project',
            'task_add_percent': 'task_add_status',
            'task_add_hours': 'task_add_percent' if status_needs_progress(data.get('status') or '') else 'task_add_status',
            'task_add_attachment': 'task_add_hours',
            'task_add_confirm': 'task_add_attachment',
        }
        target = previous.get(flow)
        if not target:
            self._show_main_menu(to, user)
            return
        sessions.set_flow(to, target)
        self._render_step(to, user, Session(flow=target, data=data))

    # ── Multi-step flows ─────────────────────────────────────────────────────

    def _handle_active_flow(self, to: str, user: User, text: str, normalized: str, session: Session) -> None:
        # A "Leave this task?" prompt is showing. Anything other than an explicit
        # Discard keeps the draft: Keep Going re-shows the current step, and any
        # other reply is taken as the answer to that step, as if never asked.
        if session.data.get('leave') == '1':
            target = session.data.get('leaveTo')
            session = Session(flow=session.flow, data={**session.data, 'leave': '', 'leaveTo': ''})
            sessions.advance(to, session.flow, {'leave': '', 'leaveTo': ''})
            if text == 'leave_discard':
                if target == 'help':
                    self._show_help(to, user)
                else:
                    self._show_main_menu(to, user, 'Task discarded. Nothing was saved.')
                return
            if text == 'leave_keep':
                self._render_step(to, user, session)
                return

        if normalized == 'back' or text == 'nav_back':
            self._step_back(to, user, session)
            return

        flow = session.flow
        if flow == 'task_add_date':
            self._step_add_date(to, user, text, session)
        elif flow == 'task_add_vertical':
            self._step_add_vertical(to, text, session)
        elif flow == 'task_add_category':
            self._step_add_category(to, user, text, session)
        elif flow == 'task_add_organization':
            self._step_add_organization(to, user, text)
        elif flow == 'task_add_description':
            self._step_add_description(to, user, text)
        elif flow == 'task_add_project':
            self._step_add_project(to, text, normalized, session)
        elif flow == 'task_add_status':
            self._step_add_status(to, text)
        elif flow == 'task_add_percent':
            self._step_add_percent(to, text)
        elif flow == 'task_add_hours':
            self._step_add_hours(to, text, normalized)
        elif flow == 'task_add_attachment':
            self._step_add_attachment(to, normalized, session)
        elif flow == 'task_add_confirm':
            self._step_add_confirm(to, user, normalized, session)
        elif flow == 'task_update_pick':
            self._step_update_pick(to, user, text)
        elif flow == 'task_update_field':
            self._step_update_field(to, user, text, session)
        elif flow == 'task_update_status':
            self._step_update_status(to, user, text, session)
        elif flow == 'task_update_percent':
            self._step_update_percent(to, user, text, session)
        elif flow == 'task_update_hours':
            self._step_update_hours(to, user, text, session)
        elif flow == 'task_update_organization':
            self._step_update_organization(to, user, text, session)
        elif flow == 'task_update_blockers':
            self._step_update_blockers(to, user, text, normalized, session)
        else:
            self._show_main_menu(to, user)

    # ── Log New Task ─────────────────────────────────────────────────────────

    def _start_add_task(self, to: str, user: User) -> None:
        sessions.reset(to)
        sessions.advance(to, 'task_add_date')
        self._send_date_picker(to, user, ADD_HEADER)

    def _send_date_picker(self, to: str, user: User, header: str, preface: str = '') -> None:
        """
        Step 1: which day. The body draws this month as a small calendar (today
        bracketed, logged days dotted); the list offers Today / Yesterday /
        Tomorrow, the rest of the past week with task counts, and "Other date".
        """
        today = nairobi_today()
        month_start = f'{today[:7]}-01'
        six_back = add_days(today, -6)
        start = six_back if six_back < month_start else month_start
        recent = tasks.get_tasks(_actor(user), user_id=user.id, from_=start, to=add_days(today, 1), page=1, limit=500)['data']

        counts: dict[str, int] = {}
        for t in recent:
            day = iso_day(t['date'])
            counts[day] = counts.get(day, 0) + 1

        self._send(to, {
            'type': 'list',
            'header': header,
            'text': preface + '*Which day is this task for?*\n\n'
                    + f'{month_calendar(today, set(counts))}\n'
                    + '_[ ] today   • already has tasks_',
            'footer': step_footer(STEP['date'], 'Date'),
            'buttonLabel': 'Choose Day',
            'sections': date_rows(today, counts),
        })

    def _step_add_date(self, to: str, user: User, text: str, session: Session) -> None:
        if text == DATE_OTHER_ID:
            self._text(to, 'Type the date, day first. For example *05/10/2026*, *5 Oct* or *yesterday*.')
            return

        today = nairobi_today()
        chosen = parse_date_input(text, today)
        offset = days_between(today, chosen) if chosen else 0
        if not chosen or offset < -MAX_DAYS_BACK or offset > MAX_DAYS_AHEAD:
            self._text(to, (
                f'Pick a day within the last {MAX_DAYS_BACK} days or the next {MAX_DAYS_AHEAD}. '
                'Older entries can be added from the web portal.'
            ) if chosen else "That date wasn't recognised. Try *05/10/2026*, *5 Oct* or *yesterday*, or choose from the list.")
            return

        when = relative_day_name(chosen, today)
        day_line = f"_{fmt_day_long(chosen)}{f' ({when})' if when else ''}_\n\n"

        # Repeat Last Task arrives here with its setup already filled in.
        if session.data.get('repeat') == '1' and session.data.get('vertical') and session.data.get('category'):
            vertical, category = session.data['vertical'], session.data['category']
            if not session.data.get('organization'):
                sessions.advance(to, 'task_add_organization', {'date': chosen})
                self._send_organization_picker(
                    to, user, REPEAT_HEADER,
                    f'{day_line}*{CATEGORY_LABELS[category]}* · {strip_number(VERTICAL_LABELS[vertical])}\n\n'
                    '*Which organization is this for?*',
                    step_footer(STEP['organization'], 'Organization'),
                )
                return
            sessions.advance(to, 'task_add_description', {'date': chosen})
            self._send_description_prompt(
                to, REPEAT_HEADER,
                day_line + f'{CATEGORY_LABELS[category]} · {strip_number(VERTICAL_LABELS[vertical])}\n'
                + f"{ORGANIZATION_LABELS[session.data['organization']]}\n\n",
            )
            return

        sessions.advance(to, 'task_add_vertical', {'date': chosen, 'verticalPage': '0'})
        self._send_vertical_picker(to, 0, day_line)

    def _send_vertical_picker(self, to: str, page: int, preface: str = '') -> None:
        self._send(to, {
            'type': 'list',
            'header': ADD_HEADER,
            'text': f'{preface}*Which area of the business was this?*\n\nChoose the vertical this task belongs to.',
            'footer': step_footer(STEP['vertical'], 'Vertical'),
            'buttonLabel': 'Choose Vertical',
            'sections': paged_sections(VERTICAL_VALUES, page, 'vert', 'Verticals', vertical_row),
        })

    def _send_category_picker(self, to: str, vertical: str, page: int) -> None:
        self._send(to, {
            'type': 'list',
            'header': ADD_HEADER,
            'text': f'*What kind of work was it?*\n\nVertical: {strip_number(VERTICAL_LABELS[vertical])}',
            'footer': step_footer(STEP['category'], 'Category'),
            'buttonLabel': 'Choose Category',
            'sections': paged_sections(CATEGORY_VALUES, page, 'cat', 'Categories', category_row),
        })

    def _send_organization_picker(self, to: str, user: User, header: str, text: str, footer: str) -> None:
        """The user's most recent organization comes first, so the usual choice is always the top row."""
        recent_org = (WorkTask.objects.filter(user_id=user.id, organization__isnull=False)
                      .order_by('-created_at').values_list('organization', flat=True).first())
        if recent_org:
            sections = [
                {'title': 'Most recent', 'rows': [organization_row(recent_org, f'{ORGANIZATION_LABELS[recent_org]} · used last time')]},
                {'title': 'All organizations', 'rows': [organization_row(o) for o in ORGANIZATION_VALUES if o != recent_org]},
            ]
        else:
            sections = [{'title': 'Organizations', 'rows': [organization_row(o) for o in ORGANIZATION_VALUES]}]

        self._send(to, {'type': 'list', 'header': header, 'text': text, 'footer': footer,
                        'buttonLabel': 'Choose Organization', 'sections': sections})

    def _send_status_picker(self, to: str, header: str, text: str, footer: str | None = None) -> None:
        self._send(to, {'type': 'list', 'header': header, 'text': text, 'footer': footer, 'buttonLabel': 'Choose Status',
                        'sections': [{'title': 'Status', 'rows': [status_row(s) for s in STATUS_VALUES]}]})

    def _send_percent_slider(self, to: str, header: str, text: str, footer: str | None = None) -> None:
        self._send(to, {'type': 'list', 'header': header, 'text': text, 'footer': footer, 'buttonLabel': 'Set Progress',
                        'sections': [{'title': 'Progress', 'rows': percent_slider_rows()}]})

    def _send_hours_slider(self, to: str, header: str, text: str, footer: str | None = None) -> None:
        self._send(to, {'type': 'list', 'header': header, 'text': text, 'footer': footer, 'buttonLabel': 'Set Time',
                        'sections': [{'title': 'Time spent', 'rows': hour_slider_rows()}]})

    def _step_add_vertical(self, to: str, text: str, session: Session) -> None:
        page = int(session.data.get('verticalPage') or '0')
        if text in ('vert_next', 'vert_prev'):
            next_page = page + 1 if text == 'vert_next' else max(0, page - 1)
            sessions.set_data(to, 'verticalPage', str(next_page))
            self._send_vertical_picker(to, next_page)
            return

        vertical = _resolve_from_id(text, 'vert', VERTICAL_VALUES)
        if not vertical:
            self._send_vertical_picker(to, page)
            return
        sessions.advance(to, 'task_add_category', {'vertical': vertical, 'categoryPage': '0'})
        self._send_category_picker(to, vertical, 0)

    def _step_add_category(self, to: str, user: User, text: str, session: Session) -> None:
        page = int(session.data.get('categoryPage') or '0')
        vertical = session.data.get('vertical')
        if text in ('cat_next', 'cat_prev'):
            next_page = page + 1 if text == 'cat_next' else max(0, page - 1)
            sessions.set_data(to, 'categoryPage', str(next_page))
            self._send_category_picker(to, vertical, next_page)
            return

        category = _resolve_from_id(text, 'cat', CATEGORY_VALUES)
        if not category:
            self._send_category_picker(to, vertical, page)
            return
        sessions.advance(to, 'task_add_organization', {'category': category})
        self._send_organization_picker(
            to, user, ADD_HEADER,
            f'*Which organization is this for?*\n\n{CATEGORY_LABELS[category]} · {strip_number(VERTICAL_LABELS[vertical])}',
            step_footer(STEP['organization'], 'Organization'),
        )

    def _step_add_organization(self, to: str, user: User, text: str) -> None:
        organization = _resolve_from_id(text, 'org', ORGANIZATION_VALUES)
        if not organization:
            self._send_organization_picker(to, user, ADD_HEADER, '*Which organization is this for?*\n\nChoose one from the list.',
                                           step_footer(STEP['organization'], 'Organization'))
            return
        sessions.advance(to, 'task_add_description', {'organization': organization})
        self._send_description_prompt(to, ADD_HEADER)

    def _send_description_prompt(self, to: str, header: str, preface: str = '') -> None:
        self._send(to, {
            'type': 'buttons',
            'header': header,
            'text': preface + '*Describe what you worked on*\n\n'
                    'Type a sentence or two, as you would in your daily report.\n\n'
                    '_For example: Configured VLANs on the core switch at the Westlands branch._',
            'footer': step_footer(STEP['description'], 'Description'),
            'buttons': [STEP_BACK_BUTTON],
        })

    def _start_repeat_task(self, to: str, user: User) -> None:
        """
        "Repeat Last Task": copies the vertical, category and organization of the
        user's most recent task, so recurring work takes a few taps. The day is
        still picked first; the project is offered as "Same as Last" as usual.
        """
        last = (WorkTask.objects.filter(user_id=user.id).order_by('-created_at')
                .values('vertical', 'category', 'organization', 'customer_project').first())
        if not last:
            self._start_add_task(to, user)
            return

        sessions.reset(to)
        vertical, category, organization = last['vertical'], last['category'], last['organization']
        sessions.advance(to, 'task_add_date', {
            'repeat': '1', 'vertical': vertical, 'category': category,
            **({'organization': organization} if organization else {}),
        })
        self._send_date_picker(
            to, user, REPEAT_HEADER,
            '*Same setup as your last task*\n'
            + f'{CATEGORY_LABELS[category]} · {strip_number(VERTICAL_LABELS[vertical])}'
            + (f'\n{ORGANIZATION_LABELS[organization]}' if organization else '')
            + (f"\nProject: {clip(last['customer_project'], 80)}" if last['customer_project'] else '')
            + '\n\n',
        )

    def _step_add_description(self, to: str, user: User, text: str) -> None:
        if len(text) < 5:
            self._send(to, {
                'type': 'buttons',
                'header': ADD_HEADER,
                'text': 'A little more detail, please. The description needs at least 5 characters.',
                'footer': step_footer(STEP['description'], 'Description'),
                'buttons': [STEP_BACK_BUTTON],
            })
            return

        recent = (WorkTask.objects.filter(user_id=user.id, customer_project__isnull=False)
                  .order_by('-created_at').values_list('customer_project', flat=True).first())
        last_project = (recent or '').strip()
        sessions.advance(to, 'task_add_project', {'description': text, 'lastProject': last_project})
        self._send_project_prompt(to, last_project)

    def _send_project_prompt(self, to: str, last_project: str) -> None:
        buttons = [{'id': 'proj_last', 'title': 'Same as Last'}] if last_project else []
        buttons += [{'id': 'proj_skip', 'title': 'Skip'}, STEP_BACK_BUTTON]
        self._send(to, {
            'type': 'buttons',
            'header': ADD_HEADER,
            'text': '*Customer or project*\n\nType the customer or project name.'
                    + (f'\n\nLast used: *{clip(last_project, 120)}*' if last_project else ''),
            'footer': step_footer(STEP['project'], 'Customer / Project'),
            'buttons': buttons,
        })

    def _step_add_project(self, to: str, text: str, normalized: str, session: Session) -> None:
        customer_project = ''
        if text == 'proj_last':
            customer_project = session.data.get('lastProject') or ''
        elif text != 'proj_skip' and normalized != 'skip':
            customer_project = text
        sessions.advance(to, 'task_add_status', {'customerProject': customer_project})
        self._send_status_step(to)

    def _send_status_step(self, to: str) -> None:
        self._send_status_picker(to, ADD_HEADER, '*Where does it stand?*\n\nChoose the current status. Type *back* to change the project.',
                                 step_footer(STEP['status'], 'Status'))

    def _send_percent_step(self, to: str, status: str) -> None:
        self._send_percent_slider(
            to, ADD_HEADER,
            f'*How far along is it?*\n\nStatus: {STATUS_LABELS.get(status, status)}\n\nSlide to the closest mark, or choose *Exact value*.',
            step_footer(STEP['status'], 'Progress'),
        )

    def _step_add_status(self, to: str, text: str) -> None:
        status = _resolve_from_id(text, 'status', STATUS_VALUES)
        if not status:
            self._send_status_step(to)
            return
        if status_needs_progress(status):
            sessions.advance(to, 'task_add_percent', {'status': status})
            self._send_percent_step(to, status)
            return
        sessions.advance(to, 'task_add_hours', {'status': status, 'percentComplete': str(_default_percent_for_status(status))})
        self._send_add_hours_slider(to)

    def _step_add_percent(self, to: str, text: str) -> None:
        if text == PERCENT_CUSTOM_ID:
            self._text(to, 'Type the progress as a number from 0 to 100, for example *65*.')
            return
        pct = parse_percent(text)
        if pct is None:
            self._send_percent_slider(to, ADD_HEADER,
                                      'That was not a percentage between 0 and 100. Choose a mark, or type a number such as *65*.',
                                      step_footer(STEP['status'], 'Progress'))
            return
        sessions.advance(to, 'task_add_hours', {'percentComplete': str(pct)})
        self._send_add_hours_slider(to)

    def _send_add_hours_slider(self, to: str) -> None:
        self._send_hours_slider(
            to, ADD_HEADER,
            '*How much time did it take?*\n\n'
            f'Each bar is measured against an {WORKDAY_HOURS}-hour day. Choose the closest mark, or *Exact time* to type it.',
            step_footer(STEP['time'], 'Time spent'),
        )

    def _step_add_hours(self, to: str, text: str, normalized: str) -> None:
        if text == HOURS_CUSTOM_ID:
            self._text(to, 'Type the time spent, for example *2.5*, *2h 15m*, *45m* or *1:30*.')
            return
        hours = None if normalized == 'skip' else parse_hours(text)
        if normalized != 'skip' and hours is None:
            self._send_hours_slider(to, ADD_HEADER,
                                    'That time was not recognised. Choose a mark, or type something like *2h 15m* (up to 24 hours).',
                                    step_footer(STEP['time'], 'Time spent'))
            return
        sessions.advance(to, 'task_add_attachment', {'hoursSpent': _num(hours)} if hours is not None else {})
        self._send_attachment_step(to, 0)

    def _send_attachment_step(self, to: str, count: int) -> None:
        intro = (
            f"{_plural(count, 'file')} attached so far. Send another, or continue to review.\n\n" if count > 0 else
            f'Send up to {MAX_ATTACHMENTS_PER_TASK} files, one at a time: screenshots, photos, PDFs or Word documents (.docx), '
            f'up to {MAX_ATTACHMENT_MB} MB each. They will be attached to this task.\n\n'
        )
        self._send(to, {
            'type': 'buttons',
            'header': ADD_HEADER,
            'text': '*Proof of work (optional)*\n\n' + intro + '_To send a file, tap the attachment icon, then Document._',
            'footer': 'Almost done · You will review everything next',
            'buttons': [
                {'id': 'att_done' if count > 0 else 'att_skip', 'title': 'Continue to Review' if count > 0 else 'Skip to Review'},
                STEP_BACK_BUTTON,
            ],
        })

    def _step_add_attachment(self, to: str, normalized: str, session: Session) -> None:
        if normalized in ('att_skip', 'att_done', 'skip', 'done'):
            self._show_add_confirm(to, session)
            return
        self._send_attachment_step(to, len(_attachments_from_session(session.data)))

    def _step_add_attachment_media(self, to: str, media: dict) -> None:
        session = sessions.get(to)
        pending = _attachments_from_session(session.data)
        continue_button = {'id': 'att_done' if pending else 'att_skip', 'title': 'Continue to Review' if pending else 'Skip to Review'}

        if media['mimeType'] not in ALLOWED_ATTACHMENT_MIMES:
            self._send(to, {
                'type': 'buttons',
                'header': ADD_HEADER,
                'text': f"*{media.get('fileName') or 'That file'}* can't be attached.\n\n"
                        'Send a photo or screenshot (JPG, PNG, WEBP, GIF), a PDF, or a Word document (.docx). '
                        'Older .doc files need to be saved as .docx first.',
                'buttons': [continue_button],
            })
            return

        if len(pending) >= MAX_ATTACHMENTS_PER_TASK:
            self._send(to, {
                'type': 'buttons',
                'header': ADD_HEADER,
                'text': f'This task already has the maximum of {MAX_ATTACHMENTS_PER_TASK} files.',
                'buttons': [{'id': 'att_done', 'title': 'Continue to Review'}],
            })
            return

        entry = {'mediaId': media['id'], 'mimeType': media['mimeType']}
        if media.get('fileName'):
            entry['fileName'] = media['fileName']
        updated = [*pending, entry]
        sessions.set_data(to, 'attachments', json.dumps(updated))

        remaining = MAX_ATTACHMENTS_PER_TASK - len(updated)
        self._send(to, {
            'type': 'buttons',
            'header': ADD_HEADER,
            'text': f"*{_kind_of(media['mimeType'])} received*"
                    + (f"\n{clip(media['fileName'], 80)}" if media.get('fileName') else '')
                    + f'\n\n{gauge(len(updated) / MAX_ATTACHMENTS_PER_TASK, MAX_ATTACHMENTS_PER_TASK)}  '
                      f'{len(updated)} of {MAX_ATTACHMENTS_PER_TASK} files\n\n'
                    + ('Send another, or continue to review.' if remaining > 0 else 'That is the limit for one task.'),
            'buttons': [{'id': 'att_done', 'title': 'Continue to Review'}],
        })

    def _show_add_confirm(self, to: str, session: Session) -> None:
        draft = _draft_from_session(session.data)
        attachment_count = len(_attachments_from_session(session.data))
        card = format_task_summary({**draft, 'description': draft['description'] or ''}) if draft['vertical'] and draft['category'] else ''
        evidence = f"\nEvidence: {_plural(attachment_count, 'file')}" if attachment_count > 0 else ''
        when = relative_day_name(draft['date'], nairobi_today())
        date_line = f"Date: *{fmt_day_short(draft['date'])}*{f' ({when})' if when else ''}\n"

        sessions.set_flow(to, 'task_add_confirm')
        self._send(to, {
            'type': 'buttons',
            'header': 'Review Task',
            'text': f'{date_line}{card}{evidence}',
            'footer': 'Nothing is saved until you tap Save Task',
            'buttons': REVIEW_BUTTONS,
        })

    def _step_add_confirm(self, to: str, user: User, normalized: str, session: Session) -> None:
        if normalized == 'confirm_yes':
            self._complete_add_task(to, user, session)
            return
        if normalized == 'confirm_no':
            # Discard is one tap from Save, so it asks before throwing work away.
            self._ask_leave_confirm(to, session, 'menu')
            return
        self._show_add_confirm(to, session)

    def _complete_add_task(self, to: str, user: User, session: Session) -> None:
        draft = _draft_from_session(session.data)
        try:
            data = {
                'date': draft['date'],
                'vertical': draft['vertical'],
                'category': draft['category'],
                'description': draft['description'],
                'status': draft['status'],
                'percentComplete': draft['percentComplete'],
            }
            if draft['organization']:
                data['organization'] = draft['organization']
            if draft['customerProject']:
                data['customerProject'] = draft['customerProject']
            if draft['hoursSpent'] is not None:
                data['hoursSpent'] = draft['hoursSpent']
            task = tasks.create_task(_actor(user), data)

            note = self._save_attachments_from_session(task['id'], user, session) if _attachments_from_session(session.data) else ''
            self._show_main_menu(to, user, f'*Task saved*\n\n{format_task_summary(task)}{note}')
        except Exception as err:  # noqa: BLE001
            logger.error('Create task from WhatsApp bot failed', err)
            self._send(to, {
                'type': 'buttons',
                'header': 'Review Task',
                'text': 'The task could not be saved. Your answers are still here, so you can try again.',
                'buttons': REVIEW_BUTTONS,
            })

    def _save_attachments_from_session(self, task_id: str, user: User, session: Session) -> str:
        """Downloads every queued file and attaches it to the newly created task."""
        pending = _attachments_from_session(session.data)
        if not pending:
            return ''

        saved, failures = 0, []
        for index, att in enumerate(pending):
            label = att.get('fileName') or f"{_kind_of(att.get('mimeType', '')).lower()} {index + 1}"
            media = self.client.download_media(att.get('mediaId'))
            if media is None:
                failures.append(label)
                continue
            buffer, downloaded_mime = media
            mime_type = downloaded_mime or att.get('mimeType', '')
            if mime_type not in ALLOWED_ATTACHMENT_MIMES:
                failures.append(f'{label} (unsupported type)')
                continue
            if len(buffer) > MAX_ATTACHMENT_BYTES:
                failures.append(f'{label} (over {MAX_ATTACHMENT_MB} MB)')
                continue
            try:
                # Keep a document's own name; give photos (which arrive unnamed) a readable one.
                own_name = att.get('fileName')
                if own_name and re.search(r'\.[a-z0-9]+$', own_name, re.IGNORECASE):
                    file_name = own_name
                else:
                    base = own_name or f"whatsapp-{re.sub(r'\s+', '-', _kind_of(mime_type).lower())}-{index + 1}"
                    file_name = f'{base}{_ext_from_mime(mime_type)}'
                attachment_service.add_from_buffer(task_id, user.id, buffer, mime_type, file_name)
                saved += 1
            except Exception as err:  # noqa: BLE001
                logger.error('Saving WhatsApp attachment failed', err, taskId=task_id)
                failures.append(label)

        if not failures:
            return f"\nEvidence: {_plural(saved, 'file')} attached"
        failed_list = ', '.join(clip(f, 60) for f in failures)
        if saved == 0:
            return f"\nEvidence: could not save {failed_list}. Add {'it' if len(failures) == 1 else 'them'} from the web portal."
        return f"\nEvidence: {_plural(saved, 'file')} attached. Could not save {failed_list}."

    # ── Update Task ──────────────────────────────────────────────────────────

    def _start_update_task(self, to: str, user: User) -> None:
        today = nairobi_today()
        # 9 tasks plus the Main Menu row = WhatsApp's 10-row limit.
        task_list = tasks.get_tasks(_actor(user), user_id=user.id, from_=today, to=today, page=1, limit=9)['data']
        if not task_list:
            self._show_main_menu(to, user, 'There is nothing logged today to update yet. Start with *Log New Task*.')
            return

        sessions.reset(to)
        sessions.set_flow(to, 'task_update_pick')
        rows = []
        for i, t in enumerate(task_list):
            description = f"{STATUS_LABELS[t['status']]} · {t['percentComplete']}%"
            if t['hoursSpent'] > 0:
                description += f" · {format_duration(t['hoursSpent'])}"
            description += f" · {clip(t['description'], 40)}"
            rows.append({'id': f"task_{t['id']}", 'title': f"{i + 1}. {CATEGORY_LABELS[t['category']]}", 'description': description})

        self._send(to, {
            'type': 'list',
            'header': UPDATE_HEADER,
            'text': '*Which task would you like to update?*\n\nShowing what you logged today.',
            'footer': MENU_FOOTER,
            'buttonLabel': 'Choose Task',
            'sections': [
                {'title': "Today's tasks", 'rows': rows},
                {'title': 'Navigation', 'rows': [{'id': 'main_menu', 'title': 'Main Menu', 'description': 'Leave without changes'}]},
            ],
        })

    def _get_task(self, task_id: str, user: User) -> dict | None:
        try:
            return tasks.get_task_by_id(task_id, _actor(user))
        except Exception:  # noqa: BLE001 - missing or not theirs
            return None

    def _send_update_field_picker(self, to: str, user: User, task_id: str) -> bool:
        """The chosen task's card plus what can be changed, each row showing its current value."""
        task = self._get_task(task_id, user)
        if task is None:
            return False

        hours = task['hoursSpent']
        self._send(to, {
            'type': 'list',
            'header': UPDATE_HEADER,
            'text': f'{format_task_summary(task)}\n\n*What would you like to change?*',
            'buttonLabel': 'Choose Field',
            'sections': [
                {'title': 'Fields', 'rows': [
                    {'id': 'upd_status', 'title': 'Status', 'description': f"Now: {STATUS_LABELS[task['status']]}"},
                    {'id': 'upd_progress', 'title': 'Progress',
                     'description': f"{gauge(task['percentComplete'] / 100)}  {task['percentComplete']}%"},
                    {'id': 'upd_hours', 'title': 'Time Spent',
                     'description': f'{gauge(hours / WORKDAY_HOURS)}  {format_duration(hours)}' if hours > 0 else 'Not recorded yet'},
                    {'id': 'upd_org', 'title': 'Organization',
                     'description': ORGANIZATION_LABELS[task['organization']] if task.get('organization') else 'Not set'},
                    {'id': 'upd_blockers', 'title': 'Blockers',
                     'description': clip(task['blockersNotes'], 60) if task.get('blockersNotes') else 'None recorded'},
                ]},
                {'title': 'Navigation', 'rows': [{'id': 'main_menu', 'title': 'Main Menu', 'description': 'Leave without changes'}]},
            ],
        })
        return True

    def _step_update_pick(self, to: str, user: User, text: str) -> None:
        if not text.startswith('task_'):
            self._start_update_task(to, user)
            return
        task_id = text[len('task_'):]
        sessions.advance(to, 'task_update_field', {'updateTaskId': task_id})
        if not self._send_update_field_picker(to, user, task_id):
            self._show_main_menu(to, user, 'That task could not be found. It may have been removed.')

    def _step_update_field(self, to: str, user: User, text: str, session: Session) -> None:
        task_id = session.data.get('updateTaskId')
        if not task_id:
            self._show_main_menu(to, user)
            return

        if text == 'upd_status':
            sessions.set_flow(to, 'task_update_status')
            self._send_status_picker(to, UPDATE_HEADER, '*Choose the new status*')
        elif text == 'upd_progress':
            sessions.set_flow(to, 'task_update_percent')
            self._send_percent_slider(to, UPDATE_HEADER, '*How far along is it now?*\n\nSlide to the closest mark, or choose *Exact value*.')
        elif text == 'upd_hours':
            sessions.set_flow(to, 'task_update_hours')
            self._send_hours_slider(to, UPDATE_HEADER, '*How much time has it taken in total?*\n\n'
                                                       'Choose the closest mark, or *Exact time* to type it.')
        elif text == 'upd_org':
            sessions.set_flow(to, 'task_update_organization')
            self._send_organization_picker(to, user, UPDATE_HEADER, '*Which organization is this for?*', MENU_FOOTER)
        elif text == 'upd_blockers':
            sessions.set_flow(to, 'task_update_blockers')
            self._send(to, {
                'type': 'buttons',
                'header': UPDATE_HEADER,
                'text': "*What's holding it up?*\n\nType the blocker notes, or clear any existing ones.",
                'buttons': [{'id': 'blk_clear', 'title': 'Clear Blockers'}, BACK_BUTTON],
            })
        elif not self._send_update_field_picker(to, user, task_id):
            self._show_main_menu(to, user)

    def _step_update_status(self, to: str, user: User, text: str, session: Session) -> None:
        status = _resolve_from_id(text, 'status', STATUS_VALUES)
        task_id = session.data.get('updateTaskId')
        if not status or not task_id:
            self._send_status_picker(to, UPDATE_HEADER, '*Choose the new status* from the list.')
            return

        # Keep partial progress already recorded; only snap to the status's
        # implied value when it would otherwise contradict it.
        changes: dict = {'status': status}
        if not status_needs_progress(status):
            changes['percentComplete'] = _default_percent_for_status(status)
        else:
            current = self._get_task(task_id, user)
            if current is None or current['percentComplete'] in (0, 100):
                changes['percentComplete'] = _default_percent_for_status(status)
        self._finish_update(to, user, task_id, changes)

    def _step_update_percent(self, to: str, user: User, text: str, session: Session) -> None:
        task_id = session.data.get('updateTaskId')
        if text == PERCENT_CUSTOM_ID:
            self._text(to, 'Type the progress as a number from 0 to 100, for example *65*.')
            return
        pct = parse_percent(text)
        if not task_id or pct is None:
            self._send_percent_slider(to, UPDATE_HEADER,
                                      'That was not a percentage between 0 and 100. Choose a mark, or type a number such as *65*.')
            return
        self._finish_update(to, user, task_id, {'percentComplete': pct})

    def _step_update_hours(self, to: str, user: User, text: str, session: Session) -> None:
        task_id = session.data.get('updateTaskId')
        if text == HOURS_CUSTOM_ID:
            self._text(to, 'Type the total time spent, for example *2.5*, *2h 15m*, *45m* or *1:30*.')
            return
        hours = parse_hours(text)
        if not task_id or hours is None:
            self._send_hours_slider(to, UPDATE_HEADER,
                                    'That time was not recognised. Choose a mark, or type something like *2h 15m* (up to 24 hours).')
            return
        self._finish_update(to, user, task_id, {'hoursSpent': hours})

    def _step_update_organization(self, to: str, user: User, text: str, session: Session) -> None:
        task_id = session.data.get('updateTaskId')
        organization = _resolve_from_id(text, 'org', ORGANIZATION_VALUES)
        if not task_id or not organization:
            self._send_organization_picker(to, user, UPDATE_HEADER, '*Which organization is this for?*\n\nChoose one from the list.',
                                           MENU_FOOTER)
            return
        self._finish_update(to, user, task_id, {'organization': organization})

    def _step_update_blockers(self, to: str, user: User, text: str, normalized: str, session: Session) -> None:
        task_id = session.data.get('updateTaskId')
        if not task_id:
            self._show_main_menu(to, user)
            return
        notes = '' if text == 'blk_clear' or normalized == 'clear' else text
        self._finish_update(to, user, task_id, {'blockersNotes': notes})

    def _finish_update(self, to: str, user: User, task_id: str, changes: dict) -> None:
        try:
            updated = tasks.update_task(task_id, _actor(user), changes)
            self._show_main_menu(to, user, f'*Task updated*\n\n{format_task_summary(updated)}')
        except Exception as err:  # noqa: BLE001
            logger.error('Update task from WhatsApp bot failed', err)
            self._show_main_menu(to, user, 'The task could not be updated. Please try again.')


def _num(n: float) -> str:
    """A number as JavaScript's String(n) prints it: 2.0 -> "2", 2.5 -> "2.5"."""
    return str(int(n)) if float(n).is_integer() else str(n)
