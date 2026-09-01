import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

/**
 * Live set of currently-connected user IDs, kept in sync via the shared
 * socket's `presence:update` broadcast (see lib/socket.ts on the backend -
 * every connect/disconnect rebroadcasts the full online set). Returns null
 * until the first event arrives, so callers can fall back to a REST-fetched
 * snapshot for that brief window rather than flashing "nobody's online".
 */
export function useOnlinePresence(): Set<string> | null {
  const [onlineIds, setOnlineIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    const handler = (payload: { onlineUserIds: string[] }) => setOnlineIds(new Set(payload.onlineUserIds));
    socket.on('presence:update', handler);
    return () => {
      socket.off('presence:update', handler);
    };
  }, []);

  return onlineIds;
}
