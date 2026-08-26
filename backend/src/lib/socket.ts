import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './jwt.js';
import { env } from './env.js';
import { JwtPayload } from '../shared/types/index.js';

/**
 * Wires up Socket.io on the shared HTTP server: JWT auth on connect, and
 * auto-join of a personal room and a role room so the tasks module can push
 * live updates (new/updated task entries) to the right people without a
 * poll loop on the frontend.
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
  });

  return io;
}
