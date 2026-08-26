import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Users,
  CalendarOff,
  UserRoundX,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { confirmDialog, promptDialog } from '@/lib/alert';
import { nairobiTodayISO } from '@/lib/datetime';
import { OutOfOfficeEntry } from '@/types/api';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Plain calendar-date -> "YYYY-MM-DD", using the Date's own local Y/M/D
 * components (never `.toISOString()`, which reinterprets through UTC and can
 * shift the date by a day). These cells are built as calendar dates, not
 * derived from "now", so no timezone conversion belongs here at all - "now"
 * itself is anchored separately via `nairobiTodayISO`, below.
 */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday-indexed weekday offset (0 = Monday .. 6 = Sunday) for the day-of-week grid alignment. */
function mondayOffset(d: Date): number {
  const day = d.getDay(); // 0 = Sunday
  return day === 0 ? 6 : day - 1;
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function formatDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatDayShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatDatesSummary(dates: string[]): string {
  const sorted = [...dates].sort();
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return formatDayLabel(sorted[0]);
  if (sorted.length <= 3) return sorted.map(formatDayShort).join(', ');
  return `${sorted.length} days · ${formatDayShort(sorted[0])} – ${formatDayShort(sorted[sorted.length - 1])}`;
}

const AVATAR_TONES = [
  { bg: 'var(--blue-soft)', fg: 'var(--blue)' },
  { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  { bg: 'var(--green-light)', fg: 'var(--green-dark)' },
  { bg: 'var(--gold-soft)', fg: 'var(--gold)' },
  { bg: 'var(--red-soft)', fg: 'var(--red)' },
];

function avatarTone(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i) * (i + 1)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash];
}

function PersonAvatar({
  name,
  userId,
  isSelf,
  size = 28,
}: {
  name: string;
  userId: string;
  isSelf?: boolean;
  size?: number;
}) {
  const tone = isSelf
    ? { bg: 'var(--red)', fg: '#fff' }
    : avatarTone(userId);
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        fontSize: size <= 20 ? 9 : 11,
        fontWeight: 700,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: tone.bg,
        color: tone.fg,
        border: isSelf ? '1.5px solid var(--red)' : '1.5px solid var(--surface)',
        boxSizing: 'border-box',
      }}
    >
      {initials(name)}
    </span>
  );
}

function OutPersonMark({
  name,
  reason,
  isSelf,
  compact = false,
}: {
  name: string;
  reason?: string | null;
  isSelf?: boolean;
  compact?: boolean;
}) {
  const displayName = isSelf ? 'You' : name.split(' ')[0];
  const note = reason?.trim() || 'Not available';
  const iconSize = compact ? 12 : 18;
  const boxSize = compact ? 22 : 36;

  return (
    <div
      className="col"
      title={`${name} — ${note}`}
      style={{
        alignItems: compact ? 'flex-start' : 'center',
        gap: compact ? 2 : 4,
        minWidth: 0,
        width: compact ? '100%' : 88,
      }}
    >
      {compact ? (
        <div className="flex items-center" style={{ gap: 4, minWidth: 0, width: '100%' }}>
          <span
            style={{
              width: boxSize,
              height: boxSize,
              borderRadius: 99,
              display: 'grid',
              placeItems: 'center',
              background: isSelf ? 'var(--red)' : 'var(--red-soft)',
              color: isSelf ? '#fff' : 'var(--red)',
              flexShrink: 0,
            }}
          >
            <UserRoundX size={iconSize} strokeWidth={2.2} />
          </span>
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {displayName}
          </span>
        </div>
      ) : (
        <span
          style={{
            width: boxSize,
            height: boxSize,
            borderRadius: 99,
            display: 'grid',
            placeItems: 'center',
            background: isSelf ? 'var(--red)' : 'var(--red-soft)',
            color: isSelf ? '#fff' : 'var(--red)',
            flexShrink: 0,
          }}
        >
          <UserRoundX size={iconSize} strokeWidth={2.2} />
        </span>
      )}
      {!compact && (
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--ink)', textAlign: 'center', lineHeight: 1.2 }}
        >
          {displayName}
        </span>
      )}
      <span
        className="text-xs"
        style={{
          color: 'var(--muted)',
          textAlign: compact ? 'left' : 'center',
          lineHeight: 1.25,
          display: '-webkit-box',
          WebkitLineClamp: compact ? 1 : 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          width: '100%',
          paddingLeft: compact ? 26 : 0,
        }}
      >
        {note}
      </span>
    </div>
  );
}

function OutRoster({
  label,
  names,
  entries,
  userId,
}: {
  label: string;
  names: string[];
  entries: OutOfOfficeEntry[];
  userId?: string;
}) {
  const empty = names.length === 0;
  return (
    <div
      className="col"
      style={{
        gap: 10,
        flex: 1,
        minWidth: 0,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        background: empty ? 'var(--surface-2)' : 'var(--red-soft)',
        border: `1px solid ${empty ? 'var(--border)' : 'transparent'}`,
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span className="text-xs font-bold" style={{ color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span
          className="text-xs font-bold"
          style={{
            color: empty ? 'var(--muted-2)' : 'var(--red)',
            background: empty ? 'var(--surface-3)' : 'var(--surface)',
            padding: '2px 8px',
            borderRadius: 99,
          }}
        >
          {empty ? 'All in' : `${names.length} out`}
        </span>
      </div>

      {empty ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Everyone is around.</p>
      ) : (
        <div className="flex" style={{ flexWrap: 'wrap', gap: 12 }}>
          {entries.map((e) => (
            <div
              key={e.id}
              style={{
                padding: '10px 8px 8px',
                borderRadius: 12,
                background: 'var(--surface)',
                border: `1px solid ${e.userId === userId ? 'var(--red)' : 'var(--border)'}`,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <OutPersonMark
                name={e.user.name}
                reason={e.reason}
                isSelf={e.userId === userId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const userId = useAuthStore((s) => s.user?.id);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const now = new Date();
  const todayISO = nairobiTodayISO(now);
  const tomorrowISO = nairobiTodayISO(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const [focusedDate, setFocusedDate] = useState(todayISO);

  const from = toISO(startOfMonth(month));
  const to = toISO(endOfMonth(month));

  const { data, isLoading } = useQuery({
    queryKey: ['team-calendar', from, to],
    queryFn: async () => {
      const res = await api.get<{ data: OutOfOfficeEntry[] }>('/team-calendar', { params: { from, to } });
      return res.data.data;
    },
  });
  const entries = data ?? [];

  const byDate = useMemo(() => {
    const map = new Map<string, OutOfOfficeEntry[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entries]);

  const myEntryByDate = useMemo(() => {
    const map = new Map<string, OutOfOfficeEntry>();
    for (const e of entries) {
      if (e.userId === userId) map.set(e.date.slice(0, 10), e);
    }
    return map;
  }, [entries, userId]);

  const mutation = useMutation({
    mutationFn: async (payload: {
      clearing: boolean;
      dates: string[];
      entryIds?: string[];
      reason?: string;
    }) => {
      if (payload.clearing) {
        await Promise.all((payload.entryIds ?? []).map((id) => api.delete(`/team-calendar/${id}`)));
        return;
      }
      return api.post('/team-calendar', { dates: payload.dates, reason: payload.reason });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['team-calendar'] });
      setSelectedDates([]);
      const summary = formatDatesSummary(variables.dates);
      if (variables.clearing) {
        addNotification({
          type: 'success',
          title: variables.dates.length > 1 ? 'Days unmarked' : 'Marked as available',
          message:
            variables.dates.length > 1
              ? `Cleared ${variables.dates.length} days (${summary}).`
              : `You're no longer marked out on ${summary}.`,
        });
      } else {
        addNotification({
          type: 'success',
          title: variables.dates.length > 1 ? 'Days marked out' : 'Marked out of office',
          message:
            variables.dates.length > 1
              ? `You're marked out for ${variables.dates.length} days (${summary}).`
              : `You're marked out on ${summary}.`,
        });
      }
    },
    onError: (err: any) =>
      addNotification({
        type: 'error',
        title: 'Update failed',
        message: err?.response?.data?.message || 'Please try again.',
      }),
  });

  const selectionMeta = useMemo(() => {
    const sorted = [...selectedDates].sort();
    const marked = sorted.filter((d) => myEntryByDate.has(d));
    const unmarked = sorted.filter((d) => !myEntryByDate.has(d));
    return { sorted, marked, unmarked };
  }, [selectedDates, myEntryByDate]);

  const toggleSelected = (dateISO: string) => {
    setSelectedDates((prev) =>
      prev.includes(dateISO) ? prev.filter((d) => d !== dateISO) : [...prev, dateISO].sort(),
    );
  };

  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelectedDates([]);
  };

  const markDatesOut = async (dates: string[]) => {
    const sorted = [...dates].sort();
    const reason = await promptDialog({
      title: sorted.length > 1 ? 'Mark these days out?' : 'Mark yourself out?',
      kicker: 'Out of office',
      text:
        sorted.length > 1
          ? 'Add one short note that applies to all selected days.'
          : 'Add a short note so the team knows why you won’t be around.',
      badge: formatDatesSummary(sorted),
      inputLabel: 'Reason',
      placeholder: 'e.g. Client visit, leave, working remotely…',
      confirmLabel: sorted.length > 1 ? `Mark ${sorted.length} days out` : 'Mark out',
      minLength: 2,
      maxLength: 200,
      validationMessage: 'Add a brief reason (at least 2 characters).',
    });
    if (!reason) return;
    mutation.mutate({ clearing: false, dates: sorted, reason });
  };

  const unmarkDates = async (dates: string[]) => {
    const sorted = [...dates].sort();
    const entryIds = sorted
      .map((d) => myEntryByDate.get(d)?.id)
      .filter((id): id is string => Boolean(id));
    if (entryIds.length === 0) return;

    const confirmed = await confirmDialog({
      title: sorted.length > 1 ? 'Unmark these days?' : 'Unmark this day?',
      text:
        sorted.length > 1
          ? `Remove your out-of-office marks for ${sorted.length} days (${formatDatesSummary(sorted)})?`
          : `Remove your out-of-office mark for ${formatDayLabel(sorted[0])}?`,
      confirmLabel: sorted.length > 1 ? `Unmark ${sorted.length} days` : 'Unmark',
      danger: true,
    });
    if (!confirmed) return;
    mutation.mutate({ clearing: true, dates: sorted, entryIds });
  };

  const handleDayClick = async (dateISO: string) => {
    setFocusedDate(dateISO);

    if (dateISO < todayISO) {
      if (!multiSelect) {
        addNotification({
          type: 'warning',
          title: 'Past date',
          message: 'You can only mark or unmark today and future days.',
        });
      }
      return;
    }

    if (multiSelect) {
      toggleSelected(dateISO);
      return;
    }

    const mine = myEntryByDate.get(dateISO);
    if (mine) {
      await unmarkDates([dateISO]);
      return;
    }
    await markDatesOut([dateISO]);
  };

  const handleBulkAction = async () => {
    const { marked, unmarked, sorted } = selectionMeta;
    if (sorted.length === 0) return;

    if (marked.length > 0 && unmarked.length > 0) {
      addNotification({
        type: 'warning',
        title: 'Mixed selection',
        message: 'Select only days to mark out, or only days to unmark — not both.',
      });
      return;
    }

    if (marked.length > 0) {
      await unmarkDates(marked);
      return;
    }
    await markDatesOut(unmarked);
  };

  const todayEntries = byDate.get(todayISO) ?? [];
  const tomorrowEntries = byDate.get(tomorrowISO) ?? [];
  const focusedEntries = byDate.get(focusedDate) ?? [];

  // ── Build the month grid (Monday-start, blank filler for lead/trail days) ──
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const leadBlanks = mondayOffset(first);
  const daysInMonth = last.getDate();
  const cells: (Date | null)[] = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // ── This month's absences grouped by person, for the side list ─────────────
  const byPerson = useMemo(() => {
    const map = new Map<string, { id: string; name: string; dates: string[] }>();
    for (const e of entries) {
      const key = e.userId;
      if (!map.has(key)) map.set(key, { id: e.userId, name: e.user.name, dates: [] });
      map.get(key)!.dates.push(e.date.slice(0, 10));
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const bulkIsUnmark = selectionMeta.marked.length > 0 && selectionMeta.unmarked.length === 0;

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Team</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Team Collaboration</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Mark the days you won't be in the office, and see who else is out.
        </p>
      </div>

      <div className="card card-pad">
        {isLoading ? (
          <div className="skel" style={{ height: 72 }} />
        ) : (
          <div className="flex" style={{ gap: 12, flexWrap: 'wrap' }}>
            <OutRoster
              label="Today"
              names={todayEntries.map((e) => e.user.name)}
              entries={todayEntries}
              userId={userId}
            />
            <OutRoster
              label="Tomorrow"
              names={tomorrowEntries.map((e) => e.user.name)}
              entries={tomorrowEntries}
              userId={userId}
            />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 20 }}>
        {/* Calendar grid */}
        <div className="card card-pad">
          <div className="flex items-center justify-between" style={{ marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <div className="flex items-center gap-2">
              <button className="btn btn-soft btn-sm" onClick={() => setMonth((m) => addMonths(m, -1))}><ChevronLeft size={14} /></button>
              <span className="text-base font-bold" style={{ color: 'var(--ink)', minWidth: 140, textAlign: 'center' }}>
                {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </span>
              <button className="btn btn-soft btn-sm" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight size={14} /></button>
            </div>

            <button
              type="button"
              className={`btn btn-sm ${multiSelect ? 'btn-primary' : 'btn-soft'}`}
              onClick={() => {
                if (multiSelect) exitMultiSelect();
                else setMultiSelect(true);
              }}
            >
              {multiSelect ? <CheckSquare size={14} /> : <Square size={14} />}
              {multiSelect ? 'Selecting…' : 'Select multiple'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="text-xs font-bold text-center" style={{ color: 'var(--muted)' }}>{w}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {cells.map((date, idx) => {
              if (!date) return <div key={idx} />;
              const dateISO = toISO(date);
              const dayEntries = byDate.get(dateISO) ?? [];
              const mine = myEntryByDate.has(dateISO);
              const isToday = dateISO === todayISO;
              const isPast = dateISO < todayISO;
              const isFocused = dateISO === focusedDate;
              const isSelected = selectedDates.includes(dateISO);

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (isPast) {
                      setFocusedDate(dateISO);
                      return;
                    }
                    void handleDayClick(dateISO);
                  }}
                  disabled={mutation.isPending}
                  title={
                    isPast
                      ? dayEntries.length > 0
                        ? dayEntries.map((e) => `${e.user.name}${e.reason ? ` — ${e.reason}` : ''}`).join('\n')
                        : 'Past dates cannot be changed'
                      : multiSelect
                        ? isSelected
                          ? 'Click to deselect'
                          : 'Click to select'
                        : dayEntries.length > 0
                          ? dayEntries.map((e) => `${e.user.name}${e.reason ? ` — ${e.reason}` : ''}`).join('\n')
                          : 'Click to mark yourself out'
                  }
                  className="col"
                  style={{
                    gap: 4,
                    padding: '6px 5px',
                    minHeight: 86,
                    borderRadius: 10,
                    textAlign: 'left',
                    cursor: isPast ? 'default' : 'pointer',
                    opacity: isPast ? 0.55 : 1,
                    position: 'relative',
                    border: isSelected
                      ? '1.5px solid var(--green)'
                      : isFocused
                        ? '1.5px solid var(--ink)'
                        : isToday
                          ? '1.5px solid var(--green)'
                          : '1px solid var(--border)',
                    background: isSelected
                      ? 'var(--green-light)'
                      : mine
                        ? 'var(--red-soft)'
                        : isPast
                          ? 'var(--surface-2)'
                          : isFocused
                            ? 'var(--surface-2)'
                            : 'var(--surface)',
                    boxShadow: (isSelected || (isFocused && !isPast)) ? 'var(--shadow-sm)' : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color: isPast
                          ? 'var(--muted-2)'
                          : isSelected || isToday
                            ? 'var(--green)'
                            : 'var(--ink-2)',
                      }}
                    >
                      {date.getDate()}
                    </span>
                    {multiSelect && !isPast && (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          border: `1.5px solid ${isSelected ? 'var(--green)' : 'var(--border-strong)'}`,
                          background: isSelected ? 'var(--green)' : 'var(--surface)',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#fff',
                          fontSize: 9,
                          fontWeight: 800,
                          lineHeight: 1,
                        }}
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                    )}
                    {!multiSelect && dayEntries.length > 0 && (
                      <span className="text-xs font-bold" style={{ color: 'var(--red)', opacity: 0.85 }}>
                        {dayEntries.length}
                      </span>
                    )}
                  </div>
                  {dayEntries.length > 0 && (
                    <div className="col" style={{ gap: 4, minWidth: 0 }}>
                      {dayEntries.slice(0, 2).map((e) => (
                        <OutPersonMark
                          key={e.id}
                          name={e.user.name}
                          reason={e.reason}
                          isSelf={e.userId === userId}
                          compact
                        />
                      ))}
                      {dayEntries.length > 2 && (
                        <span
                          className="text-xs font-bold"
                          style={{
                            color: 'var(--muted)',
                            background: 'var(--surface-3)',
                            borderRadius: 99,
                            padding: '1px 5px',
                            alignSelf: 'flex-start',
                          }}
                        >
                          +{dayEntries.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {multiSelect && selectedDates.length > 0 ? (
            <div
              className="flex items-center justify-between mt-3"
              style={{
                gap: 10,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {selectedDates.length} day{selectedDates.length === 1 ? '' : 's'} selected
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {formatDatesSummary(selectedDates)}
                </p>
              </div>
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedDates([])} disabled={mutation.isPending}>
                  <X size={14} /> Clear
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${bulkIsUnmark ? 'btn-danger' : 'btn-primary'}`}
                  onClick={() => void handleBulkAction()}
                  disabled={mutation.isPending}
                >
                  {bulkIsUnmark
                    ? `Unmark ${selectedDates.length} day${selectedDates.length === 1 ? '' : 's'}`
                    : `Mark ${selectedDates.length} day${selectedDates.length === 1 ? '' : 's'} out`}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              {multiSelect
                ? 'Click today or future days to select them, then mark or unmark together.'
                : 'Click a day to update it, or use Select multiple for several dates at once. Past days are view-only.'}
            </p>
          )}
        </div>

        {/* Side panel — focused day + month overview */}
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad col" style={{ gap: 12 }}>
            <div className="flex items-center justify-between" style={{ gap: 8 }}>
              <div className="flex items-center gap-2">
                <UserRoundX size={16} style={{ color: 'var(--red)' }} />
                <span className="card-title">Out on this day</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                {formatDayLabel(focusedDate)}
              </span>
            </div>

            {focusedEntries.length === 0 ? (
              <div
                className="flex flex-col items-center text-center"
                style={{ gap: 6, padding: '20px 8px', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}
              >
                <CalendarOff size={22} style={{ color: 'var(--red)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>No one is marked out</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {focusedDate < todayISO
                    ? 'Past days are view-only.'
                    : 'Click a calendar day to update your status.'}
                </p>
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {focusedEntries.map((e) => {
                  const self = e.userId === userId;
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: self ? 'var(--red-soft)' : 'var(--surface-2)',
                        border: `1px solid ${self ? 'rgba(214,40,40,0.2)' : 'var(--border)'}`,
                      }}
                    >
                      <span
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 99,
                          display: 'grid',
                          placeItems: 'center',
                          background: self ? 'var(--red)' : 'var(--red-soft)',
                          color: self ? '#fff' : 'var(--red)',
                          flexShrink: 0,
                        }}
                      >
                        <UserRoundX size={18} strokeWidth={2.2} />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                          {self ? 'You' : e.user.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>
                          {e.reason?.trim() || (self ? 'You marked this day out' : 'Not available')}
                        </p>
                      </div>
                      <span
                        className="text-xs font-bold"
                        style={{
                          color: 'var(--red)',
                          background: 'var(--surface)',
                          padding: '3px 8px',
                          borderRadius: 99,
                          flexShrink: 0,
                        }}
                      >
                        Out
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card card-pad col" style={{ gap: 10 }}>
            <div className="flex items-center gap-2">
              <Users size={16} style={{ color: 'var(--red)' }} />
              <span className="card-title">Out this month</span>
            </div>
            {byPerson.length === 0 ? (
              <div className="flex flex-col items-center text-center" style={{ gap: 6, padding: '24px 8px' }}>
                <CalendarOff size={26} style={{ color: 'var(--red)' }} />
                <p className="text-xs" style={{ color: 'var(--muted)' }}>No one has marked time out this month.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                {byPerson.map((p) => {
                  const self = p.id === userId;
                  const sorted = [...p.dates].sort();
                  return (
                    <div key={p.id} className="col" style={{ gap: 6 }}>
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={p.name} userId={p.id} isSelf={self} size={26} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            {self ? 'You' : p.name}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>
                            {sorted.length} day{sorted.length === 1 ? '' : 's'} out
                          </p>
                        </div>
                      </div>
                      <div className="flex" style={{ flexWrap: 'wrap', gap: 4, paddingLeft: 34 }}>
                        {sorted.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setFocusedDate(d)}
                            className="text-xs font-semibold"
                            style={{
                              padding: '3px 8px',
                              borderRadius: 99,
                              border: d === focusedDate ? '1px solid var(--ink)' : '1px solid var(--border)',
                              background: d === focusedDate ? 'var(--ink)' : 'var(--surface-3)',
                              color: d === focusedDate ? '#fff' : 'var(--ink-2)',
                              cursor: 'pointer',
                            }}
                          >
                            {formatDayShort(d)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TeamCalendarPage;
