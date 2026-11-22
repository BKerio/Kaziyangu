"""
Model base classes and helpers that reproduce Prisma's column conventions:
String ids are text UUIDs, `@default(now())` / `@updatedAt` timestamps are
naive UTC, and an update stamps `updated_at` even on bulk updates.
"""
import uuid

from django.db import models

from .dates import utcnow


def new_id() -> str:
    return str(uuid.uuid4())


class IdModel(models.Model):
    id = models.TextField(primary_key=True, default=new_id, editable=False)

    class Meta:
        abstract = True


class CreatedModel(IdModel):
    created_at = models.DateTimeField(default=utcnow)

    class Meta:
        abstract = True


class TimestampedModel(CreatedModel):
    updated_at = models.DateTimeField(default=utcnow)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.updated_at = utcnow()
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'updated_at' not in update_fields:
            kwargs['update_fields'] = [*update_fields, 'updated_at']
        super().save(*args, **kwargs)


def _has_updated_at(model: type[models.Model]) -> bool:
    return any(f.name == 'updated_at' for f in model._meta.concrete_fields)


def update_where(queryset: models.QuerySet, **changes) -> int:
    """`updateMany` - bulk update that also bumps `updated_at` like Prisma's @updatedAt."""
    if _has_updated_at(queryset.model) and 'updated_at' not in changes:
        changes['updated_at'] = utcnow()
    return queryset.update(**changes)


def update_row(model: type[models.Model], pk: str, **changes) -> None:
    """`prisma.x.update({ where: { id }, data })` without the read-modify-write race of save()."""
    if changes:
        update_where(model.objects.filter(pk=pk), **changes)


class EnumArrayField(models.Field):
    """
    A Postgres array of enum values (Prisma `Enum[]`, e.g. TaskReminder.channels).

    Prisma's database holds these as a native enum array; psycopg2 can't send a
    Python list to that type (it would be text[]), so values go over the wire
    as an untyped array literal - '{SMS,EMAIL}' - that Postgres casts to
    whatever the column is. A database created by Django migrations uses text[].
    """

    description = 'Array of enum values'

    def db_type(self, connection):
        return 'text[]'

    @staticmethod
    def _parse(value):
        if value is None or isinstance(value, list):
            return value
        text = str(value).strip()
        if text in ('', '{}'):
            return []
        return [part.strip().strip('"') for part in text.strip('{}').split(',')]

    def from_db_value(self, value, expression, connection):
        return self._parse(value)

    def to_python(self, value):
        return self._parse(value)

    def get_prep_value(self, value):
        if value is None:
            return None
        return '{' + ','.join(str(v) for v in value) + '}'
