import { useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import DotLoader from '@/components/shared/DotLoader';
import { useAuthStore } from '@/stores/authStore';
import { toNairobiInput, nairobiInputToISO, NBO_TZ } from '@/lib/datetime';
import { REMINDER_CHANNEL_OPTIONS, ReminderChannel, TaskReminder } from '@/types/api';

// Fixed cadence, matches backend/src/modules/reminders/reminder.service.ts.
const LEAD_MINUTES = 30;
const INTERVAL_MINUTES = 10;
const MAX_REPEAT = 5;

export interface ReminderFormValues {
  dueAt: string; // ISO instant
  channels: ReminderChannel[];
  repeatCount: number;
}

interface ReminderFormModalProps {
  task: { description: string };
  initial?: TaskReminder | null;
  onClose: () => void;
  onSubmit: (values: ReminderFormValues) => Promise<void> | void;
  submitting?: boolean;
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: NBO_TZ, hour: 'numeric', minute: '2-digit' });
}

function ReminderFormModal({ task, initial, onClose, onSubmit, submitting }: ReminderFormModalProps) {
  const user = useAuthStore((s) => s.user);

  const [dueLocal, setDueLocal] = useState(() =>
    initial ? toNairobiInput(new Date(initial.dueAt)) : toNairobiInput(new Date(Date.now() + 60 * 60_000))
  );
  const [channels, setChannels] = useState<ReminderChannel[]>(initial?.channels ?? ['WHATSAPP']);
  const [repeatCount, setRepeatCount] = useState(initial?.repeatCount ?? 2);
  const [error, setError] = useState<string | null>(null);

  const toggleChannel = (channel: ReminderChannel) => {
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  };

  const dueAtISO = useMemo(() => nairobiInputToISO(dueLocal), [dueLocal]);

  const schedulePreview = useMemo(() => {
    if (!dueAtISO) return [];
    const due = new Date(dueAtISO);
    return Array.from({ length: repeatCount }, (_, i) => fmtClock(new Date(due.getTime() - LEAD_MINUTES * 60_000 + i * INTERVAL_MINUTES * 60_000)));
  }, [dueAtISO, repeatCount]);

  const needsPhone = channels.some((c) => c === 'SMS' || c === 'WHATSAPP');
  const missingPhone = needsPhone && !user?.phone;

  const handleSubmit = async () => {
    setError(null);
    if (!dueAtISO) return setError('Enter a valid due date/time');
    if (channels.length === 0) return setError('Pick at least one reminder channel');
    await onSubmit({ dueAt: dueAtISO, channels, repeatCount });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 480 }}>
        <div className="card-head">
          <span className="card-title">{initial ? 'Edit Reminder' : 'Set Reminder'}</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>

        <div className="card-pad col" style={{ gap: 14 }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            For: <b style={{ color: 'var(--ink)' }}>{task.description}</b>
          </p>

          <div className="field">
            <label className="label" htmlFor="reminder-due">Due date &amp; time</label>
            <input
              id="reminder-due"
              className="input"
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">Remind me via</label>
            <div className="flex flex-wrap gap-2">
              {REMINDER_CHANNEL_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2"
                  style={{
                    padding: '7px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer',
                    background: channels.includes(opt.value) ? 'var(--surface-2, #f3f6f4)' : 'transparent',
                  }}
                >
                  <input type="checkbox" checked={channels.includes(opt.value)} onChange={() => toggleChannel(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>
            {missingPhone && (
              <span className="field-error flex items-center gap-1">
                <AlertTriangle size={12} /> Add a phone number in your Profile to receive SMS/WhatsApp reminders.
              </span>
            )}
          </div>

          <div className="field">
            <label className="label" htmlFor="reminder-count">How many times</label>
            <input
              id="reminder-count"
              className="input"
              type="number"
              min={1}
              max={MAX_REPEAT}
              value={repeatCount}
              onChange={(e) => setRepeatCount(Math.min(MAX_REPEAT, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            />
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              First reminder fires {LEAD_MINUTES} minutes before the due time, then every {INTERVAL_MINUTES} minutes after - up to {MAX_REPEAT} times, and it stops early once the task is marked complete.
            </span>
          </div>

          {schedulePreview.length > 0 && (
            <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2, #f3f6f4)', fontSize: 12.5 }}>
              Reminders at: {schedulePreview.join(', ')}
            </div>
          )}

          {error && <span className="field-error">{error}</span>}

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="btn btn-primary flex-1" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Set reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReminderFormModal;
