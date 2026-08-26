import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock, ExternalLink, MapPin, Unlink } from 'lucide-react';
import api from '@/api/client';
import { confirmDialog } from '@/lib/alert';
import { fmtDate, fmtTime, nairobiTodayISO } from '@/lib/datetime';
import { useNotificationStore } from '@/stores/notificationStore';
import { MicrosoftCalendarEvent } from '@/types/api';

/** The four-pane Microsoft logo mark - matches the one on LoginPage. */
function MicrosoftLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function connectUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${base}/auth/microsoft/login?redirect=${encodeURIComponent('/my-calendar')}`;
}

/** "Today" / "Tomorrow" / "12 Aug 2026" - anchored to the event's own Nairobi calendar day. */
function dayLabel(iso: string): string {
  const today = nairobiTodayISO();
  const tomorrow = nairobiTodayISO(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const day = nairobiTodayISO(new Date(iso));
  if (day === today) return 'Today';
  if (day === tomorrow) return 'Tomorrow';
  return fmtDate(iso);
}

function groupByDay(events: MicrosoftCalendarEvent[]): { label: string; events: MicrosoftCalendarEvent[] }[] {
  const groups: { label: string; events: MicrosoftCalendarEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.start);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

/** Personal Outlook calendar view - available to every signed-in role, same as ProfilePage. */
function MyCalendarPage() {
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['microsoft', 'calendar'],
    queryFn: async () => {
      const res = await api.get<{ data: { connected: boolean; events: MicrosoftCalendarEvent[] } }>('/auth/microsoft/calendar', {
        params: { days: 14 },
      });
      return res.data.data;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete('/auth/microsoft/connection'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['microsoft', 'calendar'] });
      addNotification({ type: 'success', title: 'Outlook disconnected', message: 'Your calendar is no longer linked.' });
    },
    onError: () => addNotification({ type: 'error', title: 'Failed to disconnect', message: 'Please try again.' }),
  });

  const handleDisconnect = async () => {
    const confirmed = await confirmDialog({
      title: 'Disconnect Outlook',
      text: 'Your calendar will stop showing here until you reconnect. This does not affect your Outlook account itself.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (confirmed) disconnectMutation.mutate();
  };

  const events = data?.events ?? [];
  const groups = groupByDay(events);

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Outlook</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Calendar</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Your upcoming Outlook events for the next 14 days.</p>
        </div>
        {data?.connected && (
          <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} disabled={disconnectMutation.isPending}>
            <Unlink size={14} /> Disconnect
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="card card-pad"><div className="skel" style={{ height: 200 }} /></div>
      ) : isError ? (
        <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
          <CalendarDays size={32} style={{ color: 'var(--muted-2)' }} />
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Could not load your calendar</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Please try again in a moment.</p>
        </div>
      ) : !data?.connected ? (
        <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 10, padding: '56px 20px' }}>
          <CalendarDays size={32} style={{ color: 'var(--muted-2)' }} />
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Connect your Outlook account</p>
          <p className="text-sm" style={{ color: 'var(--muted)', maxWidth: 360 }}>
            Link your Outlook account to see your upcoming calendar events here.
          </p>
          <a href={connectUrl()} className="btn btn-primary" style={{ gap: 10, marginTop: 6 }}>
            <MicrosoftLogo /> Connect Outlook
          </a>
        </div>
      ) : events.length === 0 ? (
        <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
          <CalendarDays size={32} style={{ color: 'var(--muted-2)' }} />
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No upcoming events</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing on your Outlook calendar in the next 14 days.</p>
        </div>
      ) : (
        <div className="col" style={{ gap: 20 }}>
          {groups.map((group) => (
            <div key={group.label} className="col" style={{ gap: 8 }}>
              <div className="nav-group-label" style={{ paddingLeft: 2 }}>{group.label}</div>
              <div className="card">
                {group.events.map((event, i) => (
                  <a
                    key={event.id}
                    href={event.webLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between"
                    style={{
                      padding: '12px 16px',
                      gap: 12,
                      borderBottom: i < group.events.length - 1 ? '1px solid var(--border)' : 'none',
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    <div className="col" style={{ gap: 3, minWidth: 0 }}>
                      <span className="font-bold" style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {event.subject}
                      </span>
                      <div className="flex items-center gap-3" style={{ fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {event.isAllDay ? 'All day' : `${fmtTime(event.start, false)} - ${fmtTime(event.end, false)}`}
                        </span>
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} /> {event.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <ExternalLink size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MyCalendarPage;
