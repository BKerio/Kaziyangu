import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './jwt.js';
import { env } from './env.js';
import { JwtPayload } from '../shared/types/index.js';

/**
 * userId -> number of open sockets for that user (a second browser tab, or a
 * flaky connection mid-reconnect, shouldn't flip someone to "offline" the
 * instant one of their sockets drops - only when the last one does).
 * Module-scoped: fine for this app's single-process deployment: see the
 * "not run here" note in .github/workflows/deploy.yml for the same
 * single-instance assumption elsewhere.
 */
const onlineCounts = new Map<string, number>();

function broadcastPresence(io: Server): void {
  io.emit('presence:update', { onlineUserIds: Array.from(onlineCounts.keys()) });
}

/** Live snapshot for REST responses (e.g. the team roster) - the initial state a fresh page load needs before any socket event has arrived. */
export function getOnlineUserIds(): Set<string> {
  return new Set(onlineCounts.keys());
}

/**
 * Wires up Socket.io on the shared HTTP server: JWT auth on connect,
 * auto-join of a personal room and a role room so the tasks module can push
 * live updates (new/updated task entries) to the right people without a
 * poll loop on the frontend, and live online/offline presence tracking so
 * "who's active" reflects who's actually connected right now rather than a
 * static "has ever logged in" flag.
 */
export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
    },
  });

  // Verify JWT on every socket connection - runs before 'connection' fires
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    try {
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data.user as JwtPayload;

    // Auto-join rooms from the verified token - client cannot spoof these
    socket.join(`user:${userId}`);
    socket.join(`role:${role}`);

    onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);
    broadcastPresence(io);

    socket.on('disconnect', () => {
      const remaining = (onlineCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) onlineCounts.delete(userId);
      else onlineCounts.set(userId, remaining);
      broadcastPresence(io);
    });
  });

  return io;
}
