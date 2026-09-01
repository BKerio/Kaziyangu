import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, Clock, ExternalLink, History, MapPin, Plug, PlugZap, Unplug } from 'lucide-react';
import api from '@/api/client';
import { confirmDialog } from '@/lib/alert';
import { fmtDate, fmtTime, nairobiTodayISO } from '@/lib/datetime';
import { useNotificationStore } from '@/stores/notificationStore';
import { MicrosoftCalendarEvent } from '@/types/api';

const LOOKAHEAD_DAYS = 14;
const LOOKBACK_DAYS = 14;
const RECENT_COUNT = 2;

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

/** Compact countdown for a not-yet-ended event: "Happening now" / "In 25m" / "In 3h" / "Tomorrow". */
function countdown(event: MicrosoftCalendarEvent): string {
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  if (now >= start && now <= end) return 'Happening now';

  const mins = Math.round((start - now) / 60_000);
  if (mins < 60) return `In ${Math.max(mins, 1)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 20) return `In ${hours}h`;
  return dayLabel(event.start);
}

/** "2h ago" / "Yesterday" / "5d ago" / a full date - for an already-ended event. */
function timeAgo(event: MicrosoftCalendarEvent): string {
  const mins = Math.round((Date.now() - new Date(event.end).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDate(event.end);
}

function hasEnded(event: MicrosoftCalendarEvent): boolean {
  return new Date(event.end).getTime() < Date.now();
}

function withinLastDays(event: MicrosoftCalendarEvent, days: number): boolean {
  return Date.now() - new Date(event.end).getTime() <= days * 24 * 60 * 60 * 1000;
}

function withinNextDays(event: MicrosoftCalendarEvent, days: number): boolean {
  return new Date(event.start).getTime() - Date.now() <= days * 24 * 60 * 60 * 1000;
}

/** One meeting row shared by the Upcoming and Recently panels. */
function EventRow({ event, muted, timeLabel, showBorder }: {
  event: MicrosoftCalendarEvent;
  muted?: boolean;
  timeLabel: string;
  showBorder: boolean;
}) {
  return (
    <a
      href={event.webLink}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between"
      style={{
        padding: '12px 16px',
        gap: 12,
        borderBottom: showBorder ? '1px solid var(--border)' : 'none',
        color: 'inherit',
        textDecoration: 'none',
        opacity: muted ? 0.72 : 1,
      }}
    >
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        <span
          className="font-bold"
          style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
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
      <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
        <span className="pill pill-gray" style={{ fontSize: 11 }}>{timeLabel}</span>
        <ExternalLink size={14} style={{ color: 'var(--muted-2)' }} />
      </div>
    </a>
  );
}

/** Personal Outlook calendar dashboard - available to every signed-in role, same as ProfilePage. */
function MyCalendarPage() {
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['microsoft', 'calendar'],
    queryFn: async () => {
      const res = await api.get<{ data: { connected: boolean; events: MicrosoftCalendarEvent[] } }>('/auth/microsoft/calendar', {
        params: { days: LOOKAHEAD_DAYS, pastDays: LOOKBACK_DAYS },
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
  const upcoming = events.filter((e) => !hasEnded(e));
  const past = events.filter(hasEnded); // already ascending by start, so the tail is most recent
  const nextMeeting = upcoming[0];
  const recent = past.slice(-RECENT_COUNT).reverse();
  const upcomingGroups = groupByDay(upcoming);

  const dueSoonCount = upcoming.filter((e) => withinNextDays(e, 7)).length;
  const recentCount = past.filter((e) => withinLastDays(e, 7)).length;

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Outlook</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Calendar</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Your Outlook schedule, at a glance.</p>
        </div>
        {data?.connected && (
          <div className="flex items-center" style={{ gap: 10 }}>
            <span className="pill pill-teal"><PlugZap size={13} /> Connected</span>
            <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} disabled={disconnectMutation.isPending}>
              <Unplug size={14} /> Disconnect
            </button>
          </div>
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
          <div
            style={{
              width: 56, height: 56, borderRadius: 14,
              display: 'grid', placeItems: 'center',
              background: 'var(--teal-soft)', color: 'var(--teal)',
            }}
          >
            <Plug size={26} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Connect your Outlook account</p>
          <p className="text-sm" style={{ color: 'var(--muted)', maxWidth: 360 }}>
            Link your Outlook account to see your upcoming calendar events here.
          </p>
          <a href={connectUrl()} className="btn btn-primary" style={{ gap: 10, marginTop: 6 }}>
            <MicrosoftLogo /> Connect Outlook
          </a>
        </div>
      ) : (
        <>
          {/* Stat row */}
          <div className="stat-grid stat-grid-3">
            <div className="stat">
              <div className="stat-ico" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}><CalendarClock /></div>
              <div className="stat-label">Next Meeting</div>
              <div className="stat-val" style={{ fontSize: 22 }}>{nextMeeting ? countdown(nextMeeting) : 'None'}</div>
              <div className="stat-foot" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nextMeeting ? nextMeeting.subject : "You're all clear"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-ico" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}><CalendarDays /></div>
              <div className="stat-label">Next 7 Days</div>
              <div className="stat-val">{dueSoonCount}</div>
              <div className="stat-foot">meeting{dueSoonCount === 1 ? '' : 's'} scheduled</div>
            </div>
            <div className="stat">
              <div className="stat-ico" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}><History /></div>
              <div className="stat-label">Last 7 Days</div>
              <div className="stat-val">{recentCount}</div>
              <div className="stat-foot">meeting{recentCount === 1 ? '' : 's'} completed</div>
            </div>
          </div>

          {/* Next meeting spotlight */}
          {nextMeeting && (
            <div className="card card-pad" style={{ borderLeft: '4px solid var(--teal)' }}>
              <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="col" style={{ gap: 6, minWidth: 0 }}>
                  <div className="flex items-center gap-2">
                    <p className="eyebrow" style={{ color: 'var(--teal)' }}>Next Meeting</p>
                    <span className="pill pill-teal">{countdown(nextMeeting)}</span>
                  </div>
                  <h3 className="font-bold" style={{ fontSize: 18, color: 'var(--ink)' }}>{nextMeeting.subject}</h3>
                  <div className="flex items-center gap-3" style={{ fontSize: 13, color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      {dayLabel(nextMeeting.start)}, {nextMeeting.isAllDay ? 'All day' : `${fmtTime(nextMeeting.start, false)} - ${fmtTime(nextMeeting.end, false)}`}
                    </span>
                    {nextMeeting.location && (
                      <span className="flex items-center gap-1"><MapPin size={13} /> {nextMeeting.location}</span>
                    )}
                  </div>
                </div>
                <a href={nextMeeting.webLink} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" style={{ gap: 8, flexShrink: 0 }}>
                  Open <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}

          {/* Upcoming + Recently */}
          <div className="dash-main">
            <div className="card">
              <div className="card-head"><span className="card-title">Upcoming</span></div>
              {upcoming.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted)', padding: '20px 16px' }}>
                  Nothing on your Outlook calendar in the next {LOOKAHEAD_DAYS} days.
                </p>
              ) : (
                <div className="col" style={{ gap: 0 }}>
                  {upcomingGroups.map((group) => (
                    <div key={group.label}>
                      <div className="nav-group-label" style={{ padding: '10px 16px 4px' }}>{group.label}</div>
                      {group.events.map((event, i) => (
                        <EventRow key={event.id} event={event} timeLabel={countdown(event)} showBorder={i < group.events.length - 1} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span className="card-title">Recently</span></div>
              {recent.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted)', padding: '20px 16px' }}>
                  No meetings in the last {LOOKBACK_DAYS} days.
                </p>
              ) : (
                recent.map((event, i) => (
                  <EventRow key={event.id} event={event} muted timeLabel={timeAgo(event)} showBorder={i < recent.length - 1} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default MyCalendarPage;
