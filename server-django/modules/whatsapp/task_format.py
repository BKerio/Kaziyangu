from modules.tasks.options import CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS

from .ui import format_duration, gauge, vertical_title


def format_task_summary(task: dict, index: int | None = None) -> str:
    """Renders a task (camelCase dict) as a WhatsApp task card, optionally numbered."""
    prefix = f'{index}. ' if index is not None else ''
    hours = task.get('hoursSpent')
    lines = [
        f"{prefix}*{CATEGORY_LABELS[task['category']]}*  ·  {vertical_title(task['vertical'])}",
        f"_{ORGANIZATION_LABELS[task['organization']]}_" if task.get('organization') else None,
        f"Status: *{STATUS_LABELS[task['status']]}*",
        f"Progress: {gauge(task['percentComplete'] / 100)} {task['percentComplete']}%",
        f'Time: {format_duration(hours)}' if hours is not None and hours > 0 else None,
        f"Project: {task['customerProject']}" if task.get('customerProject') else None,
        f"Notes: {task['description']}",
        f"Blockers: {task['blockersNotes']}" if task.get('blockersNotes') else None,
    ]
    return '\n'.join(line for line in lines if line)
