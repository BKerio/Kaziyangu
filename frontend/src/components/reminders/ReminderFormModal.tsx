import { useMemo, useState } from 'react';
import { X, AlertTriangle, BellRing, CalendarClock, Flag, Mail, MessageCircle, Plus, Trash2, Check } from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';
import { useAuthStore } from '@/stores/authStore';
import { toNairobiInput, nairobiInputToISO, NBO_TZ } from '@/lib/datetime';
import { ReminderChannel, TaskReminder } from '@/types/api';

// Must match MAX_TIMES in backend/src/modules/reminders/reminder.service.ts.
const MAX_TIMES = 5;
// Cadence the server used before times could be chosen - only needed to show
// (and carry over) the times of reminders created back then.
const LEGACY_LEAD_MINUTES = 30;
const LEGACY_INTERVAL_MINUTES = 100;

export interface ReminderFormValues {
  dueAt: string; // ISO instant
  channels: ReminderChannel[];
  remindAt: string[]; // ISO instants
}

interface ReminderFormModalProps {
  task: { description: string };
  initial?: TaskReminder | null;
  onClose: () => void;
  onSubmit: (values: ReminderFormValues) => Promise<void> | void;
  submitting?: boolean;
}

/** A Nairobi wall-clock date and time, as the two inputs hold them. */
interface Slot {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

interface ReminderRow extends Slot {
  key: number;
}

const PRESETS: Array<{ label: string; minutesBefore: number }> = [
  { label: 'At due time', minutesBefore: 0 },
  { label: '15 min before', minutesBefore: 15 },
  { label: '30 min before', minutesBefore: 30 },
  { label: '1 hour before', minutesBefore: 60 },
  { label: '1 day before', minutesBefore: 24 * 60 },
];

const CHANNELS: Array<{ value: ReminderChannel; label: string; Icon: typeof Mail }> = [
  { value: 'WHATSAPP', label: 'WhatsApp', Icon: MessageCircle },
  { value: 'EMAIL', label: 'Email', Icon: Mail },
];

let rowKey = 0;
const nextKey = () => ++rowKey;

function toSlot(d: Date): Slot {
  const [date, time] = toNairobiInput(d).split('T');
  return { date, time };
}

function slotToDate(slot: Slot): Date | null {
  const iso = nairobiInputToISO(`${slot.date}T${slot.time}`);
  return iso ? new Date(iso) : null;
}

/** Rounds up to the next 5-minute mark, so defaults look like times a person would pick. */
function roundUp5(ms: number): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(ms / step) * step);
}

function fmtWhen(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: NBO_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: NBO_TZ, hour: 'numeric', minute: '2-digit' });
}

/** 95 -> "1 h 35 min", 1440 -> "1 day", 1500 -> "1 day 1 h". */
function fmtGap(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days} day${days === 1 ? '' : 's'}` : '',
    hours ? `${hours} h` : '',
    minutes && !days ? `${minutes} min` : '',
  ].filter(Boolean);
  return parts.join(' ') || '0 min';
}

/** The send times a reminder had - its chosen ones, or the old fixed cadence. */
function initialTimes(reminder: TaskReminder): Date[] {
  if (reminder.remindAt?.length) return reminder.remindAt.map((t) => new Date(t));
  const first = new Date(reminder.dueAt).getTime() - LEGACY_LEAD_MINUTES * 60_000;
  return Array.from({ length: reminder.repeatCount }, (_, i) => new Date(first + i * LEGACY_INTERVAL_MINUTES * 60_000));
}

function ReminderFormModal({ task, initial, onClose, onSubmit, submitting }: ReminderFormModalProps) {
  const user = useAuthStore((s) => s.user);

  const [due, setDue] = useState<Slot>(() =>
    toSlot(initial ? new Date(initial.dueAt) : roundUp5(Date.now() + 2 * 60 * 60_000))
  );

  const [rows, setRows] = useState<ReminderRow[]>(() => {
    const dueDate = initial ? new Date(initial.dueAt) : roundUp5(Date.now() + 2 * 60 * 60_000);
    // Only times still ahead can be kept - ones already sent drop off on edit.
    const upcoming = (initial ? initialTimes(initial) : []).filter((d) => d.getTime() > Date.now());
    const fallback = new Date(dueDate.getTime() - 30 * 60_000);
    const start = upcoming.length > 0 ? upcoming : [fallback.getTime() > Date.now() ? fallback : dueDate];
    return start.map((d) => ({ key: nextKey(), ...toSlot(d) }));
  });

  // Drop SMS from older reminders so saving an edit moves them off it.
  const [channels, setChannels] = useState<ReminderChannel[]>(() => {
    const kept = (initial?.channels ?? []).filter((c) => c !== 'SMS');
    return kept.length > 0 ? kept : ['WHATSAPP'];
  });
  const [error, setError] = useState<string | null>(null);

  const dueDate = useMemo(() => slotToDate(due), [due]);

  /** Each row's parsed time plus what's wrong with it, if anything. */
  const checked = useMemo(
    () =>
      rows.map((row) => {
        const at = slotToDate(row);
        let problem: string | null = null;
        let caption = '';
        if (!at) problem = 'Pick a date and time';
        else if (at.getTime() < Date.now() - 60_000) problem = 'This time has already passed';
        else if (dueDate && at.getTime() > dueDate.getTime()) problem = 'This is after the due time';
        if (at && dueDate && !problem) {
          const before = Math.round((dueDate.getTime() - at.getTime()) / 60_000);
          caption = before === 0 ? 'At the due time' : `${fmtGap(before)} before due`;
        }
        return { row, at, problem, caption };
      }),
    [rows, dueDate]
  );

  const timeline = useMemo(
    () =>
      checked
        .filter((c) => c.at && !c.problem)
        .map((c) => c.at!)
        .sort((a, b) => a.getTime() - b.getTime()),
    [checked]
  );

  const hasMinute = (d: Date) => rows.some((r) => slotToDate(r)?.getTime() === d.getTime());

  const addPreset = (minutesBefore: number) => {
    if (!dueDate || rows.length >= MAX_TIMES) return;
    const at = new Date(dueDate.getTime() - minutesBefore * 60_000);
    if (hasMinute(at)) return;
    setRows((prev) => [...prev, { key: nextKey(), ...toSlot(at) }]);
  };

  const addCustom = () => {
    if (rows.length >= MAX_TIMES) return;
    const base = dueDate ? new Date(dueDate.getTime() - 60 * 60_000) : roundUp5(Date.now() + 30 * 60_000);
    const at = base.getTime() > Date.now() ? base : roundUp5(Date.now() + 5 * 60_000);
    setRows((prev) => [...prev, { key: nextKey(), ...toSlot(at) }]);
  };

  const updateRow = (key: number, patch: Partial<Slot>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: number) => setRows((prev) => prev.filter((r) => r.key !== key));

  const toggleChannel = (channel: ReminderChannel) =>
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));

  const missingPhone = channels.includes('WHATSAPP') && !user?.phone;
  const dueInPast = !!dueDate && dueDate.getTime() < Date.now();

  const handleSubmit = async () => {
    setError(null);
    if (!dueDate) return setError('Set a valid due date and time.');
    if (dueInPast) return setError('The due time has already passed.');
    if (rows.length === 0) return setError('Add at least one reminder time.');
    const firstProblem = checked.find((c) => c.problem);
    if (firstProblem) return setError(`Fix the highlighted reminder: ${firstProblem.problem!.toLowerCase()}.`);
    if (channels.length === 0) return setError('Choose how you want to be reminded.');
    await onSubmit({ dueAt: dueDate.toISOString(), channels, remindAt: timeline.map((d) => d.toISOString()) });
  };

  const sectionTitle = (n: number, text: string, hint?: string) => (
    <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
      <span
        style={{
          width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center',
          background: 'var(--ink)', color: 'var(--surface)', fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{text}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{hint}</span>}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,15,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="card w-full" style={{ maxWidth: 560, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="card-head" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="flex gap-3" style={{ minWidth: 0 }}>
            <span
              style={{
                width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', flexShrink: 0,
                background: 'var(--red-soft)', color: 'var(--red)',
              }}
            >
              <BellRing size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <span className="card-title">{initial ? 'Edit reminder' : 'Set a reminder'}</span>
              <p
                className="text-sm"
                style={{ color: 'var(--muted)', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                title={task.description}
              >
                {task.description}
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="card-pad col" style={{ gap: 22, overflowY: 'auto' }}>
          {/* 1. Due */}
          <section>
            {sectionTitle(1, 'When is it due?')}
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="reminder-due-date">Due date</label>
                <input
                  id="reminder-due-date"
                  className="input"
                  type="date"
                  value={due.date}
                  onChange={(e) => setDue((d) => ({ ...d, date: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="reminder-due-time">Due time</label>
                <input
                  id="reminder-due-time"
                  className="input"
                  type="time"
                  value={due.time}
                  onChange={(e) => setDue((d) => ({ ...d, time: e.target.value }))}
                />
              </div>
            </div>
            {dueDate && (
              <p className="flex items-center gap-1" style={{ fontSize: 12, marginTop: 6, color: dueInPast ? 'var(--red)' : 'var(--muted)' }}>
                <CalendarClock size={13} />
                {dueInPast ? 'This due time has already passed.' : `Due ${fmtWhen(dueDate)} (Nairobi time)`}
              </p>
            )}
          </section>

          {/* 2. Reminder times */}
          <section>
            {sectionTitle(2, 'When should we remind you?', `${rows.length} of ${MAX_TIMES}`)}

            <div className="col" style={{ gap: 8 }}>
              {checked.map(({ row, problem, caption }, i) => (
                <div
                  key={row.key}
                  style={{
                    border: `1px solid ${problem ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 12, padding: '10px 10px 8px 12px',
                    background: problem ? 'var(--red-soft)' : 'var(--surface)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', width: 18, flexShrink: 0 }}>{i + 1}</span>
                    <input
                      className="input"
                      type="date"
                      aria-label={`Reminder ${i + 1} date`}
                      value={row.date}
                      onChange={(e) => updateRow(row.key, { date: e.target.value })}
                      style={{ flex: 1.3, minWidth: 0 }}
                    />
                    <input
                      className="input"
                      type="time"
                      aria-label={`Reminder ${i + 1} time`}
                      value={row.time}
                      onChange={(e) => updateRow(row.key, { time: e.target.value })}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length === 1}
                      title={rows.length === 1 ? 'At least one reminder is needed' : 'Remove this reminder'}
                      aria-label={`Remove reminder ${i + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p style={{ fontSize: 11.5, marginTop: 5, paddingLeft: 26, color: problem ? 'var(--red)' : 'var(--muted)' }}>
                    {problem ?? caption}
                  </p>
                </div>
              ))}
            </div>

            {rows.length < MAX_TIMES && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Add another reminder</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => {
                    const at = dueDate ? new Date(dueDate.getTime() - p.minutesBefore * 60_000) : null;
                    const unavailable = !at || at.getTime() < Date.now() || hasMinute(at);
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={unavailable}
                        onClick={() => addPreset(p.minutesBefore)}
                        title={at ? fmtWhen(at) : undefined}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button type="button" className="btn btn-soft btn-sm" onClick={addCustom}>
                    <Plus size={13} /> Custom time
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 3. Channels */}
          <section>
            {sectionTitle(3, 'How should we reach you?')}
            <div className="grid grid-cols-2 gap-3">
              {CHANNELS.map(({ value, label, Icon }) => {
                const on = channels.includes(value);
                const detail = value === 'EMAIL' ? user?.email : user?.phone || 'No phone number on file';
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleChannel(value)}
                    aria-pressed={on}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px',
                      borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1.5px solid ${on ? 'var(--green)' : 'var(--border)'}`,
                      background: on ? 'var(--green-light)' : 'var(--surface)',
                      transition: '.14s',
                    }}
                  >
                    <span
                      style={{
                        width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0,
                        background: on ? 'var(--green)' : 'var(--surface-3)', color: on ? '#fff' : 'var(--muted)',
                      }}
                    >
                      <Icon size={16} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: 'var(--ink)' }}>{label}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {detail}
                      </span>
                    </span>
                    {on && <Check size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
            {missingPhone && (
              <span className="field-error flex items-center gap-1" style={{ marginTop: 6 }}>
                <AlertTriangle size={12} /> Add a phone number in your Profile to receive WhatsApp reminders.
              </span>
            )}
          </section>

          {/* Summary timeline */}
          {dueDate && timeline.length > 0 && (
            <div style={{ borderRadius: 12, background: 'var(--surface-2)', padding: '12px 14px' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Schedule
              </p>
              <div className="flex items-center flex-wrap" style={{ gap: 6, fontSize: 12.5 }}>
                {timeline.map((t) => (
                  <span key={t.getTime()} className="flex items-center" style={{ gap: 6 }}>
                    <span className="flex items-center gap-1" style={{ padding: '4px 9px', borderRadius: 99, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <BellRing size={12} style={{ color: 'var(--red)' }} /> {fmtClock(t)}
                    </span>
                    <span style={{ color: 'var(--muted-2)' }}>→</span>
                  </span>
                ))}
                <span className="flex items-center gap-1" style={{ padding: '4px 9px', borderRadius: 99, background: 'var(--ink)', color: 'var(--surface)', fontWeight: 600 }}>
                  <Flag size={12} /> Due {fmtClock(dueDate)}
                </span>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                Reminders stop early once the task is marked complete.
              </p>
            </div>
          )}

          {error && (
            <div className="alert-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="btn btn-primary flex-1" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <AppLoader size={20} /> : null}
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Set reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReminderFormModal;
