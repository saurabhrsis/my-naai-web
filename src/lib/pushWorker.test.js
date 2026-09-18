import { describe, it, expect, vi, beforeEach } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push worker (public/firebase-messaging-sw.js) is a classic service-worker
// script, so it is exercised through a real VM context with a fake `self`.
// Everything asserted here happened in production and hurt:
//   · one booking request produced the SDK's notification *and* the worker's,
//     in two system sounds;
//   · the worker broadcast the buzzer even while an app window was in front of
//     the user, who was already being told by the page itself;
//   · the buzzer broadcast carried no arrival stamp, so a page that received it
//     late (a restored tab, a window still loading) rang on open.
const SW_SOURCE = readFileSync(join(process.cwd(), 'public/firebase-messaging-sw.js'), 'utf8');

const CONFIG_QUERY = 'apiKey=a&authDomain=d&projectId=p&storageBucket=b&messagingSenderId=s&appId=c';

function makeHarness({ clients = [], ready = true } = {}) {
  const listeners = new Map();
  const notifications = [];
  const channelMessages = [];

  const registration = {
    showNotification: vi.fn((title, options) => {
      notifications.push({ title, options });
      return Promise.resolve();
    }),
    getNotifications: vi.fn(() => Promise.resolve([])),
    active: {},
  };

  const self = {
    location: { origin: 'https://mynaai.in', href: `https://mynaai.in/firebase-messaging-sw.js?${CONFIG_QUERY}` },
    registration,
    clients: {
      matchAll: vi.fn(() => Promise.resolve(clients)),
      openWindow: vi.fn(() => Promise.resolve(null)),
      claim: vi.fn(() => Promise.resolve()),
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
    addEventListener: (type, handler) => {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
  };

  const backgroundHandlers = [];
  const firebase = {
    apps: [],
    initializeApp: vi.fn(() => ({})),
    messaging: vi.fn(() => ({ onBackgroundMessage: handler => backgroundHandlers.push(handler) })),
  };

  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.postMessage = message => channelMessages.push({ name, message });
    }
    close() {}
  }

  const context = vm.createContext({
    self,
    firebase,
    BroadcastChannel: FakeBroadcastChannel,
    caches: {
      open: vi.fn(() => Promise.resolve({ addAll: vi.fn(() => Promise.resolve()) })),
      keys: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() => Promise.resolve()),
      match: vi.fn(() => Promise.resolve(undefined)),
    },
    importScripts: vi.fn(),
    URL,
    Response: class Response { constructor(body, init) { this.body = body; this.init = init; } },
    indexedDB: undefined,
    console,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    Notification: { maxActions: 2 },
  });
  if (ready) vm.runInContext(SW_SOURCE, context, { filename: 'firebase-messaging-sw.js' });

  const dispatch = (type, event) => {
    const handlers = listeners.get(type) || [];
    handlers.forEach(handler => handler(event));
  };

  const deliverPush = payload => {
    const waits = [];
    dispatch('push', {
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: promise => waits.push(promise),
    });
    return Promise.all(waits);
  };

  return { self, registration, notifications, channelMessages, deliverPush, dispatch, backgroundHandlers, firebase };
}

function windowClient(visibilityState, url = 'https://mynaai.in/queue') {
  return { url, visibilityState, postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
}

const bookingPush = () => ({
  from: '1234567890',
  notification: { title: 'New booking request', body: 'Riya wants a fade' },
  data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-1' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('one alert, one notification', () => {
  it('shows a single notification, with its actions, when no window is open', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush());

    expect(harness.notifications).toHaveLength(1);
    const [alert] = harness.notifications;
    expect(alert.title).toBe('New booking request');
    expect(alert.options.actions.map(action => action.title)).toEqual(['Accept', 'Reject', 'Delay']);
    expect(alert.options.data.target).toBe('/bookingRequest?bookingRequestId=req-1');
    // …and the SDK's own copy of the same alert stays suppressed.
    const sdkCall = await harness.registration.showNotification('New booking request', {
      body: 'Riya wants a fade',
      data: { FCM_MSG: { data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-1' } } },
    });
    expect(sdkCall).toBeUndefined();
    expect(harness.notifications).toHaveLength(1);
  });

  it('passes a non-buzzer notification from the SDK straight through', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.registration.showNotification('Booking confirmed', {
      body: 'See you at 6pm',
      data: { FCM_MSG: { data: { type: 'BOOKING_CONFIRMED' } } },
    });
    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].title).toBe('Booking confirmed');
  });

  it('lets the page in front own the alert — no banner, no ring from the worker', async () => {
    const visible = windowClient('visible');
    const harness = makeHarness({ clients: [visible] });
    await harness.deliverPush(bookingPush());

    // Firebase hands a visible window the message; that page shows the alert
    // and rings the buzzer itself, so the worker must stay out of both.
    expect(harness.notifications).toHaveLength(0);
    expect(visible.postMessage).not.toHaveBeenCalled();
    expect(harness.channelMessages).toHaveLength(0);
  });

  it('leaves non-buzzer messages entirely to the Firebase SDK', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush({ notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED' } });
    expect(harness.notifications).toHaveLength(0);
    expect(harness.channelMessages).toHaveLength(0);
  });
});

describe('ringing the app that is open in another tab', () => {
  it('sends one stamped buzzer message to a hidden window', async () => {
    const hidden = windowClient('hidden');
    const harness = makeHarness({ clients: [hidden] });
    const before = Date.now();
    await harness.deliverPush(bookingPush());

    expect(hidden.postMessage).toHaveBeenCalledTimes(1);
    const message = hidden.postMessage.mock.calls[0][0];
    expect(message.type).toBe('MYNAAI_PLAY_BUZZER');
    expect(message.notificationType).toBe('BOOKING_REQUEST');
    expect(message.alertId).toBe('BOOKING_REQUEST:req-1');
    // The arrival stamp is what lets the page drop a late delivery instead of
    // ringing when the user comes back to it.
    expect(message.sentAt).toBeGreaterThanOrEqual(before);
    expect(message.sentAt).toBeLessThanOrEqual(Date.now());
    // The BroadcastChannel copy carries the same envelope (a page without a
    // controller has no other way to hear it) …
    expect(harness.channelMessages).toHaveLength(1);
    expect(harness.channelMessages[0].message.alertId).toBe(message.alertId);
  });

  it('rings every tab that is open in the background, and only once each', async () => {
    const first = windowClient('hidden', 'https://mynaai.in/queue');
    const second = windowClient('hidden', 'https://mynaai.in/bookings');
    const harness = makeHarness({ clients: [first, second] });
    await harness.deliverPush(bookingPush());

    // The buzzer rings on the device once per alert; each background tab gets
    // the message, and the arrival gate in the page de-duplicates them.
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(second.postMessage).toHaveBeenCalledTimes(1);
    expect(first.postMessage.mock.calls[0][0]).toEqual(second.postMessage.mock.calls[0][0]);
    expect(harness.channelMessages).toHaveLength(1);
    // Nobody is looking at the app, so the worker also shows the system banner:
    // the buzz is best-effort in a hidden tab, the banner is not.
    expect(harness.notifications).toHaveLength(1);
  });

  it('stays silent when any My Naai tab is in front, even with other tabs behind it', async () => {
    const hidden = windowClient('hidden');
    const visible = windowClient('visible');
    const harness = makeHarness({ clients: [hidden, visible] });
    await harness.deliverPush(bookingPush());

    // The visible tab is handed the push by Firebase and rings it there; the
    // worker must not ring the other tab or show a second banner.
    expect(hidden.postMessage).not.toHaveBeenCalled();
    expect(visible.postMessage).not.toHaveBeenCalled();
    expect(harness.channelMessages).toHaveLength(0);
    expect(harness.notifications).toHaveLength(0);
  });

  it('ignores an extension page that claims to be visible', async () => {
    const extension = windowClient('visible', 'chrome-extension://abcdefghijklmnop/page.html');
    const hidden = windowClient('hidden');
    const harness = makeHarness({ clients: [extension, hidden] });
    await harness.deliverPush(bookingPush());

    // Chat extensions report visibilityState 'visible'; they are not a person
    // looking at the app, so the alert still belongs to the background tab.
    expect(hidden.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.channelMessages).toHaveLength(1);
  });

  it('relays a page-requested ring with the same envelope rules', async () => {
    const hidden = windowClient('hidden');
    const harness = makeHarness({ clients: [hidden] });

    const waits = [];
    harness.dispatch('message', {
      data: { type: 'MYNAAI_PLAY_BUZZER', notificationType: 'BOOKING_REQUEST', data: { bookingRequestId: 'req-2' } },
      waitUntil: promise => waits.push(promise),
    });
    await Promise.all(waits);

    expect(hidden.postMessage).toHaveBeenCalledTimes(1);
    const message = hidden.postMessage.mock.calls[0][0];
    expect(message.alertId).toBe('BOOKING_REQUEST:req-2');
    expect(message.sentAt).toBeGreaterThan(0);
  });
});
