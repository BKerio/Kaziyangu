import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import api from '@/api/client';
import { useOnlinePresence } from '@/hooks/useOnlinePresence';
import { TeamRosterMember } from '@/types/api';

const CYCLE_MS = 2200;

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/**
 * Live "who's active" strip for the dashboard - cycles through active team
 * members' names one at a time with a slide+fade transition. Adapted from
 * KokonutUI's DynamicText (github.com/kokonut-labs/kokonutui): same
 * initial/animate/exit choreography, but wired to the real roster instead
 * of a hardcoded greeting list, and looping continuously (a live headcount
 * belongs on screen the whole time a dashboard is open, not just once).
 * The per-name status dot is genuinely live too - it overlays the shared
 * socket's presence:update broadcast on top of the roster fetch, so it
 * flips the instant someone actually connects or disconnects.
 */
function ActiveTeamText() {
  const liveOnline = useOnlinePresence();

  const { data, isLoading } = useQuery({
    queryKey: ['team-calendar', 'roster'],
    queryFn: async () => {
      const res = await api.get<{ data: TeamRosterMember[] }>('/team-calendar/roster');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const roster = data ?? [];
  const isOnline = (m: TeamRosterMember) => (liveOnline ? liveOnline.has(m.id) : m.isOnline);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (roster.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % roster.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [roster.length]);

  if (isLoading) {
    return <div className="card card-pad"><div className="skel" style={{ height: 40 }} /></div>;
  }
  if (roster.length === 0) return null;

  const current = roster[index % roster.length];

  return (
    <div className="card card-pad flex items-center" style={{ gap: 16 }}>
      <div
        className="flex items-center justify-center"
        style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--red-soft)', color: 'var(--red)', flexShrink: 0 }}
      >
        <Users size={18} />
      </div>
      <div className="col" style={{ gap: 3, minWidth: 0, flex: 1 }}>
        <p className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>
          {roster.length} Active Team Member{roster.length === 1 ? '' : 's'}
        </p>
        <div style={{ position: 'relative', height: 24, overflow: 'hidden' }}>
          <AnimatePresence mode="popLayout">
            <motion.div
              key={current.id}
              aria-live="off"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="flex items-center gap-2"
              style={{ position: 'absolute', fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}
            >
              <span
                className="flex items-center justify-center"
                style={{ width: 20, height: 20, borderRadius: 99, background: 'var(--red)', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}
              >
                {initials(current.name)}
              </span>
              {current.name}
              {/* Green = online right now; amber = not currently connected. Live,
                  not historical - genuine status colors, not the app's red brand
                  accent, which is the one place they're right. */}
              <span
                aria-hidden
                title={isOnline(current) ? 'Online now' : 'Offline'}
                style={{
                  width: 6, height: 6, borderRadius: 99, flexShrink: 0,
                  background: isOnline(current) ? '#169A5B' : 'var(--amber)',
                }}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default ActiveTeamText;
