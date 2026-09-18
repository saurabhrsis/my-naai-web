import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
//     late (a restored tab, a window still loading) rang on open;
//   · with the app closed the banner arrived but nothing sounded, because a
//     closed web app cannot play a sound at all — the alert has to be raised
//     again for the device to alert again.
const SW_SOURCE = readFileSync(join(process.cwd(), 'public/firebase-messaging-sw.js'), 'utf8');

const CONFIG_QUERY = 'apiKey=a&authDomain=d&projectId=p&storageBucket=b&messagingSenderId=s&appId=c';

function makeHarness({ clients = [], maxActions = 2 } = {}) {
  const listeners = new Map();
  const notifications = [];
  const channelMessages = [];

  const registration = {
    showNotification: vi.fn((title, options) => {
      // A notification with the same tag replaces the one on screen, exactly as
      // the notification centre does it.
      const index = notifications.findIndex(entry => options?.tag && entry.options.tag === options.tag);
      if (index >= 0) notifications.splice(index, 1);
      notifications.push({ title, options });
      return Promise.resolve();
    }),
    getNotifications: vi.fn((filter = {}) => Promise.resolve(
      notifications
        .filter(entry => !filter.tag || entry.options.tag === filter.tag)
        .map(entry => ({ tag: entry.options.tag, close: vi.fn(() => { const at = notifications.indexOf(entry); if (at >= 0) notifications.splice(at, 1); }) })),
    )),
    active: {},
  };

  const self = {
    location: { origin: 'https://mynaai.in', href: `https://mynaai.in/firebase-messaging-sw.js?${CONFIG_QUERY}` },
    registration,
    // What the worker reads to size its action list: a real service worker
    // global reads it off `self`, not off the module scope.
    Notification: { maxActions },
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

  const showNotificationSpy = registration.showNotification;
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
    // Share the host clock so `Date.now()` inside the worker and the test agree
    // (vitest's fake timers live in the host realm).
    Date,
    Response: class Response { constructor(body, init) { this.body = body; this.init = init; } },
    indexedDB: undefined,
    console,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    Notification: { maxActions },
  });
  vm.runInContext(SW_SOURCE, context, { filename: 'firebase-messaging-sw.js' });

  const dispatch = (type, event) => {
    const handlers = listeners.get(type) || [];
    handlers.forEach(handler => handler(event));
  };

  // Advances the worker's own timers (the repeat sequence) and lets every
  // promise it chained off them settle.
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  };

  const deliverPush = payload => {
    dispatch('push', {
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: () => {},
    });
    return settle();
  };

  return {
    self,
    registration,
    showNotification: showNotificationSpy,
    notifications,
    channelMessages,
    deliverPush,
    dispatch,
    settle,
    backgroundHandlers,
    firebase,
    dismiss: tag => { const at = notifications.findIndex(entry => entry.options.tag === tag); if (at >= 0) notifications.splice(at, 1); },
  };
}

function windowClient(visibilityState, url = 'https://mynaai.in/queue') {
  return { url, visibilityState, postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
}

const bookingPush = (id = 'req-1') => ({
  from: '1234567890',
  notification: { title: 'New booking request', body: 'Riya wants a fade' },
  data: { type: 'BOOKING_REQUEST', bookingRequestId: id },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one alert, one notification', () => {
  it('shows a single notification, with the actions this device renders, when no window is open', async () => {
    const harness = makeHarness({ clients: [], maxActions: 3 });
    await harness.deliverPush(bookingPush());

    expect(harness.notifications).toHaveLength(1);
    const [alert] = harness.notifications;
    expect(alert.title).toBe('New booking request');
    expect(alert.options.actions.map(action => action.title)).toEqual(['Accept', 'Reject', 'Delay']);
    expect(alert.options.data.target).toBe('/bookingRequest?bookingRequestId=req-1');
    expect(alert.options.tag).toBe('req-1');
    expect(alert.options.silent).toBe(false);
    // …and the SDK's own copy of the same alert stays suppressed.
    const sdkCall = await harness.registration.showNotification('New booking request', {
      body: 'Riya wants a fade',
      data: { FCM_MSG: { data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-1' } } },
    });
    expect(sdkCall).toBeUndefined();
    expect(harness.notifications).toHaveLength(1);
  });

  it('asks for only the buttons a laptop will render', async () => {
    // Chromium on a laptop renders two: requesting three is how one of the two
    // usable buttons gets dropped instead. Delay stays one tap away — tapping
    // the alert opens the request screen.
    const harness = makeHarness({ clients: [], maxActions: 2 });
    await harness.deliverPush(bookingPush());
    expect(harness.notifications[0].options.actions.map(action => action.title)).toEqual(['Accept', 'Reject']);
    expect(harness.notifications[0].options.data.target).toBe('/bookingRequest?bookingRequestId=req-1');
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

  it('leaves the banner of a non-buzzer message to the Firebase SDK, but not its sound', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush({ notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED' } });
    expect(harness.notifications).toHaveLength(0);
    expect(harness.channelMessages).toHaveLength(0);
  });

  it('rings a background tab for an informational alert the SDK never tells it about', async () => {
    const hidden = windowClient('hidden');
    const harness = makeHarness({ clients: [hidden] });
    await harness.deliverPush({ notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED', bookingId: 'bk-5' } });

    // Firebase posts to a window only when it is visible, so a background tab
    // would otherwise only ever get the system banner sound — and no in-app
    // alert when the person switches back.
    expect(hidden.postMessage).toHaveBeenCalledTimes(1);
    expect(hidden.postMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ type: 'MYNAAI_PLAY_BUZZER', notificationType: 'BOOKING_CONFIRMED' }));
    // The banner stays the SDK's, with its own single copy.
    expect(harness.notifications).toHaveLength(0);
  });

  it('does not ring anything for an informational alert when a window is in front', async () => {
    const visible = windowClient('visible');
    const hidden = windowClient('hidden');
    const harness = makeHarness({ clients: [visible, hidden] });
    await harness.deliverPush({ notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED' } });

    // That page is handed the message by Firebase and rings it itself.
    expect(visible.postMessage).not.toHaveBeenCalled();
    expect(hidden.postMessage).not.toHaveBeenCalled();
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

    harness.dispatch('message', {
      data: { type: 'MYNAAI_PLAY_BUZZER', notificationType: 'BOOKING_REQUEST', data: { bookingRequestId: 'req-2' } },
      waitUntil: () => {},
    });
    await harness.settle();

    expect(hidden.postMessage).toHaveBeenCalledTimes(1);
    const message = hidden.postMessage.mock.calls[0][0];
    expect(message.alertId).toBe('BOOKING_REQUEST:req-2');
    expect(message.sentAt).toBeGreaterThan(0);
  });
});

// With the app closed there is no page, no AudioContext and no way to play the
// buzzer file — the Notifications API has no custom sound (it was removed from
// the standard in 2018 and no browser ever implemented it). The device's own
// notification sound is the alarm, so the worker raises the alert again inside
// the salon's 60-second answer window.
describe('keeping the alert audible with the app closed', () => {
  it('re-raises the booking alert inside the answer window, then stops', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush());
    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].options.renotify).toBe(true);

    await harness.settle(20000);
    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].options.body).toMatch(/40s left to respond/);
    expect(harness.notifications[0].options.renotify).toBe(true);

    await harness.settle(20000);
    expect(harness.notifications[0].options.body).toMatch(/20s left to respond/);

    // The window is over: no fourth banner, whatever the phone did with the
    // first three.
    await harness.settle(60000);
    expect(harness.showNotification).toHaveBeenCalledTimes(3);
  });

  it('never repeats an informational alert', async () => {
    const harness = makeHarness({ clients: [] });
    harness.dispatch('push', {
      data: {
        json: () => ({ notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED', bookingId: 'bk-1' } }),
        text: () => '',
      },
      waitUntil: () => {},
    });
    // Non-buzzer types are the Firebase SDK's business; the push listener leaves
    // them alone entirely, repeats included.
    await harness.settle(60000);
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  it('stops repeating once the salon answers the alert', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush());
    expect(harness.notifications).toHaveLength(1);

    harness.dispatch('notificationclick', {
      action: 'ACCEPT_BOOKING',
      notification: { data: { bookingRequestId: 'req-1', target: '/bookingRequest?bookingRequestId=req-1' }, close: vi.fn() },
      stopImmediatePropagation: vi.fn(),
      waitUntil: () => {},
    });
    await harness.settle(60000);

    // The accepted alert was closed by the click, and nothing was raised again.
    expect(harness.showNotification).toHaveBeenCalledTimes(1);
  });

  it('stops repeating when the app handled the request', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush());

    // What the app posts when the request screen acts or expires.
    harness.dispatch('message', { data: { type: 'MYNAAI_CLOSE_NOTIFICATION', tag: 'req-1' }, waitUntil: () => {} });
    await harness.settle(60000);

    expect(harness.showNotification).toHaveBeenCalledTimes(1);
  });

  it('stops repeating when the salon has already dismissed the banner', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush());

    // A swipe-away is an answer too: the alert has been seen, and a phone that
    // rings again after that is nagging.
    harness.dismiss('req-1');
    await harness.settle(60000);
    expect(harness.showNotification).toHaveBeenCalledTimes(1);
  });

  it('gives each booking request its own place in the notification centre', async () => {
    const harness = makeHarness({ clients: [] });
    await harness.deliverPush(bookingPush('req-1'));
    await harness.deliverPush(bookingPush('req-2'));
    // Separate tags: the second request must never silently replace the first.
    expect(harness.notifications).toHaveLength(2);
    expect(harness.notifications.map(entry => entry.options.tag)).toEqual(['req-1', 'req-2']);
  });
});
