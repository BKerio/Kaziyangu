import { io } from 'socket.io-client';
import { useAuthStore } from '@/stores/authStore';

export const socket = io(import.meta.env.VITE_SOCKET_URL, {
  // Function form: token is read fresh from store on every connect/reconnect attempt
  auth: (cb: (data: Record<string, unknown>) => void) => cb({ token: useAuthStore.getState().token }),
  autoConnect: false,
  transports: ['websocket'], // skip HTTP long-polling; prevents Chrome tab spinner
});
