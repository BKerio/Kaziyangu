"""Matching WhatsApp senders to staff profiles."""
import re

from django.db import transaction

from core.db import update_where
from modules.auth.models import User


def significant_digits(phone: str | None) -> str:
    """
    The last 9 digits - long enough to be unique per person while absorbing
    country-code / leading-zero differences between "07XX…", "+254 7XX…" and
    WhatsApp's "2547XX…".
    """
    return re.sub(r'\D', '', phone or '')[-9:]


def to_whatsapp_number(phone: str) -> str:
    """A free-text staff phone as the international digits WhatsApp delivers to ("254712345678")."""
    digits = re.sub(r'\D', '', phone)
    if digits.startswith('0') and len(digits) == 10:
        return f'254{digits[1:]}'
    if len(digits) == 9:
        return f'254{digits}'
    return digits


def find_user_by_phone(wa_phone: str) -> User | None:
    target = significant_digits(wa_phone)
    # Fewer than 9 digits can't identify anyone - and would otherwise match
    # every staff row whose phone was saved blank.
    if len(target) < 9:
        return None
    for user in User.objects.filter(is_active=True, phone__isnull=False):
        if user.phone and significant_digits(user.phone) == target:
            return user
    return None


def find_user_by_whatsapp_id(whatsapp_user_id: str) -> User | None:
    return User.objects.filter(whatsapp_user_id=whatsapp_user_id, is_active=True).first()


def link_whatsapp_id(user_id: str, whatsapp_user_id: str) -> None:
    """Remembers which business-scoped id belongs to a user, moving it off any other row first."""
    with transaction.atomic():
        update_where(User.objects.filter(whatsapp_user_id=whatsapp_user_id).exclude(id=user_id), whatsapp_user_id=None)
        update_where(User.objects.filter(id=user_id), whatsapp_user_id=whatsapp_user_id)
