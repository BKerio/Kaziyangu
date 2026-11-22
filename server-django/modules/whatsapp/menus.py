"""Main menu, help text and the shared buttons of the WhatsApp task assistant."""
from .ui import WORKDAY_HOURS, clip, format_duration, gauge

# 'open menu' is the reminder template's quick-reply button.
MENU_TRIGGERS = {'hi', 'hello', 'hey', 'start', 'menu', 'open menu', '0', 'help'}

ASSISTANT_NAME = 'Task Assistant'
MENU_FOOTER = 'Millenium Solutions · Type menu at any time'
MAIN_MENU_TEXT = 'Tap *Open Menu* to choose what to do next.'

WORKWEEK_HOURS = WORKDAY_HOURS * 5

# Every id the main menu can send back, whether or not that row is showing right now.
MAIN_MENU_ACTION_IDS = {'task_add', 'task_repeat', 'task_update', 'tasks_today', 'tasks_week', 'my_profile', 'help', 'main_menu'}


def _s(n: int) -> str:
    return '' if n == 1 else 's'


def main_menu_sections(s: dict) -> list[dict]:
    """
    Rebuilt on every open: quick actions, your progress and your account, each
    row's description showing live data rather than static help text.
    `s` holds todayCount, todayHours, weekCount, weekHours, lastTaskLabel, roleLine.
    """
    quick_rows = [{'id': 'task_add', 'title': 'Log New Task', 'description': 'Eight quick steps, about a minute'}]
    if s['lastTaskLabel']:
        quick_rows.append({'id': 'task_repeat', 'title': 'Repeat Last Task',
                           'description': clip(f"Same setup as {s['lastTaskLabel']}", 72)})
    quick_rows.append({
        'id': 'task_update',
        'title': 'Update Task',
        'description': f"{s['todayCount']} task{_s(s['todayCount'])} from today ready to update"
        if s['todayCount'] > 0 else 'Log a task first, then update it here',
    })

    progress_rows = [
        {
            'id': 'tasks_today',
            'title': "Today's Tasks",
            'description': f"{gauge(s['todayHours'] / WORKDAY_HOURS)}  {format_duration(s['todayHours'])} · "
                           f"{s['todayCount']} task{_s(s['todayCount'])}"
            if s['todayCount'] > 0 else 'Nothing logged yet today',
        },
        {
            'id': 'tasks_week',
            'title': 'This Week',
            'description': f"{gauge(s['weekHours'] / WORKWEEK_HOURS)}  {format_duration(s['weekHours'])} of {WORKWEEK_HOURS} h",
        },
    ]

    account_rows = [
        {'id': 'my_profile', 'title': 'My Profile', 'description': s['roleLine']},
        {'id': 'help', 'title': 'Help', 'description': 'How each option works, plus handy shortcuts'},
    ]

    return [
        {'title': 'Quick actions', 'rows': quick_rows},
        {'title': 'Your progress', 'rows': progress_rows},
        {'title': 'Account', 'rows': account_rows},
    ]


def day_nudge(s: dict) -> str:
    """One line on where the day stands, shown under the greeting."""
    if s['todayCount'] == 0:
        return 'Nothing logged yet today. *Log New Task* takes about a minute.'
    if s['todayHours'] >= WORKDAY_HOURS:
        return 'A full day logged. Great work.'
    return f"{format_duration(WORKDAY_HOURS - s['todayHours'])} to go for a full day."


BACK_BUTTON = {'id': 'main_menu', 'title': 'Main Menu'}

# Non-destructive "previous step" - replaces Cancel on wizard steps, so a stray tap never loses work.
STEP_BACK_BUTTON = {'id': 'nav_back', 'title': 'Back'}

# Safe action first, destructive last - and Discard asks for confirmation.
REVIEW_BUTTONS = [{'id': 'confirm_yes', 'title': 'Save Task'}, STEP_BACK_BUTTON, {'id': 'confirm_no', 'title': 'Discard'}]

LEAVE_BUTTONS = [{'id': 'leave_keep', 'title': 'Keep Going'}, {'id': 'leave_discard', 'title': 'Discard Task'}]


def help_text(portal_url: str) -> str:
    return (
        '*How the Task Assistant works*\n\n'
        '*Log New Task*\nEight quick steps: day, vertical, category, organization, description, project, status and time. '
        'Pick the day from a calendar: today, yesterday, tomorrow or any other date. '
        'Pick from the lists, and use the sliders to set time and progress in one tap.\n\n'
        '*Update Task*\nChange the status, progress, time, organization or blockers on anything logged today.\n\n'
        '*Repeat Last Task*\nStarts a new task with the same vertical, category, organization and project as your last one, '
        'so you only describe the work.\n\n'
        "*Today's Tasks* and *This Week*\nSee what you've logged, with totals.\n\n"
        'While logging, tap *Back* or type *back* to change your previous answer. Type *menu* to leave; '
        'you will be asked before anything is discarded.\n\n'
        f'For the full editor, visit {portal_url}'
    )


def unregistered_text(portal_url: str) -> str:
    return (
        '*Staff profile not found*\n\n'
        'This WhatsApp number is not linked to a staff profile.\n\n'
        f'Sign in at {portal_url} and add this number under *My Profile*, or ask your administrator to add it for you.'
    )
