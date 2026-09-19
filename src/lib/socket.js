// Shared live-update socket for the My Naai web portal.
// A socket is shared by screens in one tab, while BroadcastChannel mirrors room
// events to the other tabs/windows for the same signed-in identity. This matters
// on iPad/Safari where owners commonly keep Queue and Notifications open in two
// tabs: a booking update must reach both of them.
import { io } from 'socket.io-client';
import { getServerUrl } from './api';

const JOIN_EVENT = { salon: 'join_salon', user: 'join_user' };
const CHANNEL_NAME = 'mynaai-live-room';
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let current = null;
let channel = null;
let storageListener = null;
const seenEvents = new Map();

function getChannel() {
  if (channel || typeof window === 'undefined') return channel;
  try {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', event => receiveCrossTab(event.data));
    } else {
      storageListener = event => {
        if (event.key !== CHANNEL_NAME || !event.newValue) return;
        try { receiveCrossTab(JSON.parse(event.newValue)); } catch { /* ignore malformed relay */ }
      };
      window.addEventListener('storage', storageListener);
    }
  } catch { channel = null; }
  return channel;
}

function markSeen(id) {
  const now = Date.now();
  for (const [key, timestamp] of seenEvents) if (now - timestamp > 30000) seenEvents.delete(key);
  if (seenEvents.has(id)) return false;
  seenEvents.set(id, now);
  return true;
}

function relay(scope, id, event, args) {
  const message = {
    source: TAB_ID,
    roomKey: `${scope}:${id}`,
    event,
    args,
    eventId: `${TAB_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  };
  markSeen(message.eventId);
  try {
    if (getChannel()) channel.postMessage(message);
    else if (typeof window !== 'undefined') window.localStorage.setItem(CHANNEL_NAME, JSON.stringify(message));
  } catch { /* private browsing/storage disabled: this tab still receives its socket */ }
}

function receiveCrossTab(message) {
  if (!message || message.source === TAB_ID || !message.roomKey || !markSeen(message.eventId || '')) return;
  const room = current?.rooms.get(message.roomKey);
  if (!room || room.event !== message.event) return;
  const args = Array.isArray(message.args) ? message.args : [message.args];
  room.handlers.forEach(handler => {
    try { handler(...args); } catch (error) { setTimeout(() => { throw error; }, 0); }
  });
}

function teardown() {
  if (!current) return;
  current.socket.removeAllListeners();
  current.socket.disconnect();
  current = null;
}

function ensureSocket(identity) {
  getChannel();
  if (current && current.identity === identity) {
    if (!current.socket.connected && !current.socket.active) teardown();
    if (current) return current;
  }
  teardown();
  const socket = io(getServerUrl() || undefined, {
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 20000,
  });
  current = { identity, socket, rooms: new Map() };
  socket.on('connect', () => {
    if (current?.socket !== socket) return;
    for (const room of current.rooms.values()) socket.emit(JOIN_EVENT[room.scope], String(room.id));
  });
  return current;
}

export function subscribeToLiveUpdates({ scope, id, event, handler }) {
  if (!id || !JOIN_EVENT[scope] || !event || typeof handler !== 'function') return () => {};
  const identity = `${scope}:${id}`;
  const state = ensureSocket(identity);
  const roomKey = `${scope}:${id}`;
  let room = state.rooms.get(roomKey);
  if (!room) {
    room = { scope, id, event, handlers: new Set() };
    state.rooms.set(roomKey, room);
  }
  room.handlers.add(handler);
  const socketHandler = (...args) => {
    if (!room.handlers.has(handler)) return;
    handler(...args);
    relay(scope, id, event, args);
  };
  state.socket.on(event, socketHandler);
  if (state.socket.connected) state.socket.emit(JOIN_EVENT[scope], String(id));
  return () => {
    if (!current || current.identity !== identity) return;
    const activeRoom = current.rooms.get(roomKey);
    if (activeRoom) {
      activeRoom.handlers.delete(handler);
      state.socket.off(event, socketHandler);
      if (!activeRoom.handlers.size) current.rooms.delete(roomKey);
    }
  };
}

export function resetLiveUpdatesSocket() { teardown(); }
