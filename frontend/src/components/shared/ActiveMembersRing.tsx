import { useEffect, useId, useState } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { useOnlinePresence } from '@/hooks/useOnlinePresence';
import { TeamRosterMember } from '@/types/api';

const SIZE = 128;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CENTER = SIZE / 2;
const GREEN = '#169A5B';

/** Animates a number counting up to `target` whenever it changes, via motion's own animation engine. */
function useCountUp(target: number, duration = 1.1): number {
  const motionValue = useMotionValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const unsubscribe = motionValue.on('change', (v) => setDisplay(Math.round(v)));
    const controls = animate(motionValue, target, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => {
      controls.stop();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

/**
 * A two-tone progress ring showing what fraction of the team is online right
 * now (green) versus offline (amber) - the same live status ActiveTeamText
 * shows per name, here as a single glanceable shape instead. Draws itself in
 * on mount, with a soft radar-style pulse behind it and a count-up
 * percentage in the center - and keeps redrawing itself as people connect
 * and disconnect, via the shared socket's presence:update broadcast.
 */
function ActiveMembersRing() {
  const gradientId = useId();
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
  // Live presence once it's arrived; the REST snapshot fills the brief gap before it does.
  const isOnline = (m: TeamRosterMember) => (liveOnline ? liveOnline.has(m.id) : m.isOnline);
  const total = roster.length;
  const activeCount = roster.filter(isOnline).length;
  const inactiveCount = total - activeCount;
  const activeFraction = total > 0 ? activeCount / total : 0;
  const inactiveFraction = total > 0 ? inactiveCount / total : 0;
  const pct = useCountUp(Math.round(activeFraction * 100));

  if (isLoading) {
    return <div className="card card-pad"><div className="skel" style={{ height: 128 }} /></div>;
  }
  if (total === 0) return null;

  return (
    <div className="card card-pad flex items-center" style={{ gap: 24 }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        {/* Radar-style pulse, echoing the "online" dot elsewhere in this dashboard. */}
        <motion.span
          aria-hidden
          style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${GREEN}` }}
          animate={{ scale: [1, 1.16, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />

        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <linearGradient id={`${gradientId}-active`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22C58B" />
              <stop offset="100%" stopColor={GREEN} />
            </linearGradient>
            <linearGradient id={`${gradientId}-inactive`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E8B44B" />
              <stop offset="100%" stopColor="#B7791F" />
            </linearGradient>
            <filter id={`${gradientId}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Track */}
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--surface-3)" strokeWidth={STROKE} />

          {/* Offline arc, starting where the online arc ends */}
          <motion.circle
            cx={CENTER} cy={CENTER} r={RADIUS} fill="none"
            stroke={`url(#${gradientId}-inactive)`} strokeWidth={STROKE} strokeLinecap="round"
            style={{ rotate: -90, transformOrigin: '50% 50%', pathOffset: activeFraction }}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: inactiveFraction }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          />

          {/* Online arc, drawn from the top, glowing */}
          <motion.circle
            cx={CENTER} cy={CENTER} r={RADIUS} fill="none"
            stroke={`url(#${gradientId}-active)`} strokeWidth={STROKE} strokeLinecap="round"
            filter={`url(#${gradientId}-glow)`}
            style={{ rotate: -90, transformOrigin: '50% 50%' }}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: activeFraction }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>

        <div
          className="flex flex-col items-center justify-center"
          style={{ position: 'absolute', inset: 0, textAlign: 'center' }}
        >
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
            {pct}%
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--muted)', textTransform: 'uppercase', marginTop: 3 }}>
            Online
          </span>
        </div>
      </div>

      <div className="col" style={{ gap: 10, flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold normal" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>Team Activation</p>
          <span className="flex items-center gap-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', color: GREEN }}>
            <motion.span
              aria-hidden
              style={{ width: 5, height: 5, borderRadius: 99, background: GREEN, display: 'inline-block' }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--ink)' }}><strong>{activeCount}</strong> online now</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--amber)', flexShrink: 0 }} />
          <span className="text-sm" style={{ color: 'var(--ink)' }}><strong>{inactiveCount}</strong> offline</span>
        </div>
      </div>
    </div>
  );
}

export default ActiveMembersRing;
