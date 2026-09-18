import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vibrate, isBuzzerSupported, unlockBuzzer, playBuzzer, claimAlertDelivery, alertIdentity } from './buzzer';

// A stand-in AudioContext: records every burst that is actually handed to the
// audio clock, so a test can prove that nothing was queued for later.
class FakeAudioContext {
  constructor(state = FakeAudioContext.state || 'running') {
    this.state = state;
    this.resumeMode = FakeAudioContext.resumeMode || 'immediate';
    this.currentTime = 0;
    this.destination = {};
    this.started = [];
    FakeAudioContext.instance = this;
  }

  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start: when => { this.started.push(when); },
      stop() {},
      set onended(handler) { this.handler = handler; },
    };
  }

  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }

  createOscillator() {
    return {
      type: 'square',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
      set onended(handler) { this.handler = handler; },
    };
  }

  createBuffer() { return {}; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }

  // 'immediate' is Chrome on Android (a background tab resumes its audio clock
  // right away); 'pending' is iOS, where the resume request only completes when
  // the app is brought forward — the case that made the buzzer ring late.
  resume() {
    if (this.resumeMode === 'pending') {
      this.pendingResumes = this.pendingResumes || [];
      return new Promise(resolve => this.pendingResumes.push(() => { this.state = 'running'; resolve(); }));
    }
    this.state = 'running';
    return Promise.resolve();
  }

  flushPendingResumes() {
    const pending = this.pendingResumes || [];
    this.pendingResumes = [];
    pending.forEach(resolve => resolve());
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

async function freshBuzzer() {
  vi.resetModules();
  return import('./buzzer');
}

beforeEach(() => {
  // The single-ring record lives in localStorage (that is what lets two tabs of
  // the same origin agree), so every test starts from a clean origin.
  localStorage.clear();
  window.navigator.vibrate = vi.fn(() => true);
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  }));
});

describe('vibrate', () => {
  it('issues navigator.vibrate when available', () => {
    expect(vibrate([100, 50])).toBe(true);
    expect(window.navigator.vibrate).toHaveBeenCalledWith([100, 50]);
  });

  it('returns false when vibrate is not a function', () => {
    window.navigator.vibrate = undefined;
    expect(vibrate()).toBe(false);
  });
});

describe('isBuzzerSupported', () => {
  it('is true when an AudioContext exists', () => {
    expect(isBuzzerSupported()).toBe(true);
  });
});

describe('playBuzzer', () => {
  it('returns true and vibrates for an alert that just arrived', () => {
    const result = playBuzzer({ type: 'BOOKING_REQUEST', alertId: 'BOOKING_REQUEST:req-9', sentAt: Date.now() });
    expect(result).toBe(true);
    expect(window.navigator.vibrate).toHaveBeenCalled();
  });

  it('refuses an alert that carries no arrival stamp at all', () => {
    // Nothing the app did not witness arriving may start the alarm: an unstamped
    // message is how a push from before the reload used to ring on load.
    expect(playBuzzer({ type: 'BOOKING_REQUEST', alertId: 'BOOKING_REQUEST:req-9' })).toBe(false);
    expect(window.navigator.vibrate).not.toHaveBeenCalled();
  });
});

describe('unlockBuzzer', () => {
  it('preloads without throwing', () => {
    expect(() => unlockBuzzer()).not.toThrow();
  });
});


// ── WHEN the buzzer sounds ──────────────────────────────────────────────────
// The reported bug this suite pins down: the alarm rang when the salon owner
// opened the app again, or reloaded the site — not when the notification
// actually arrived.
describe('buzzer timing', () => {
  beforeEach(() => {
    setVisibility('visible');
    window.AudioContext = FakeAudioContext;
    FakeAudioContext.instance = null;
    FakeAudioContext.state = 'running';
    FakeAudioContext.resumeMode = 'immediate';
  });

  afterEach(() => {
    setVisibility('visible');
    delete window.AudioContext;
    delete window.webkitAudioContext;
    FakeAudioContext.instance = null;
    FakeAudioContext.state = 'running';
    FakeAudioContext.resumeMode = 'immediate';
  });

  it('plays at the moment the alert arrives when audio can start right now', async () => {
    const { playBuzzer } = await freshBuzzer();
    playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, alertId: 'BOOKING_REQUEST:b1', sentAt: Date.now() });
    await flush();
    await flush();

    expect(FakeAudioContext.instance.started.length).toBeGreaterThan(0);
  });

  it('never queues the buzzer for when the app is reopened (iOS resume stays pending)', async () => {
    // The reported bug: the phone is locked / the app is in the background, the
    // booking request arrives, and nothing is heard — until the app is opened,
    // when the alarm fires late. On iOS the resume request stays pending until
    // the app comes forward, so the buzz window must close while it waits.
    FakeAudioContext.state = 'suspended';
    FakeAudioContext.resumeMode = 'pending';
    const { playBuzzer } = await freshBuzzer();
    setVisibility('hidden');
    vi.useFakeTimers();
    try {
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3, alertId: 'BOOKING_REQUEST:b2', sentAt: Date.now() });
      const ctx = FakeAudioContext.instance;
      // The app stays away well past the buzz window (the salon owner opens it
      // minutes later, not 2ms later).
      await vi.advanceTimersByTimeAsync(60000);
      expect(ctx.started).toHaveLength(0);

      // The app comes back: the pending resume finishes — a stale alarm must NOT
      // ring now.
      setVisibility('visible');
      ctx.resumeMode = 'immediate';
      ctx.flushPendingResumes();
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(ctx.started).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still buzzes a hidden page whose audio clock resumes immediately (Android background tab)', async () => {
    // The other half of the contract: when the browser *can* start audio in the
    // background, the buzz must land at the moment the notification arrives —
    // a backgrounded Android tab is exactly that case.
    FakeAudioContext.state = 'suspended';
    FakeAudioContext.resumeMode = 'immediate';
    const { playBuzzer } = await freshBuzzer();
    setVisibility('hidden');

    playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, alertId: 'BOOKING_REQUEST:b3', sentAt: Date.now() });
    await flush();
    await flush();

    expect(FakeAudioContext.instance.started.length).toBeGreaterThan(0);
  });

  it('cancels a burst that has not started yet when the page goes to the background', async () => {
    const stopped = [];
    const original = FakeAudioContext.prototype.createBufferSource;
    FakeAudioContext.prototype.createBufferSource = function createBufferSource() {
      const ctx = this;
      return {
        buffer: null,
        connect() {},
        start(when) { ctx.started.push(when); },
        stop() { stopped.push(true); },
        set onended(handler) { this.handler = handler; },
      };
    };
    try {
      const { playBuzzer } = await freshBuzzer();
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3, alertId: 'BOOKING_REQUEST:b4', sentAt: Date.now() });
      await flush();
      await flush();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(stopped.length).toBeGreaterThan(0);
    } finally {
      FakeAudioContext.prototype.createBufferSource = original;
    }
  });
});

// Unlocking audio must be silent. Playing the real buzzer file to "unlock" the
// HTML audio elements was audible on the very first tap after opening the app.
describe('buzzer unlock is silent', () => {
  afterEach(() => {
    FakeAudioContext.instance = null;
    delete window.AudioContext;
  });

  it('only ever plays a muted element while warming up', async () => {
    setVisibility('visible');
    window.AudioContext = FakeAudioContext;
    const seen = [];
    window.Audio = class {
      constructor(url) { this.url = url; this.muted = false; this.preload = ''; this.currentTime = 0; this.duration = 1; }
      play() { seen.push(this.muted); return Promise.resolve(); }
      pause() {}
      load() {}
    };

    const { unlockBuzzer } = await freshBuzzer();
    unlockBuzzer();
    await flush();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(muted => muted === true)).toBe(true);
  });
});

// ── The arrival envelope ────────────────────────────────────────────────────
// The second half of the reported bug: the buzzer also sounded on a plain page
// load or refresh. Every delivered alert now carries its id and the moment the
// push arrived, and a delivery that cannot prove it is happening *now* is
// dropped instead of played late.
describe('alert arrival gate', () => {
  beforeEach(() => {
    setVisibility('visible');
    window.AudioContext = FakeAudioContext;
    FakeAudioContext.instance = null;
    FakeAudioContext.state = 'running';
    FakeAudioContext.resumeMode = 'immediate';
  });

  afterEach(() => {
    setVisibility('visible');
    delete window.AudioContext;
    delete window.webkitAudioContext;
    FakeAudioContext.instance = null;
  });

  it('names one alert the same way every handler does', async () => {
    const { alertIdentity } = await freshBuzzer();
    expect(alertIdentity({ bookingRequestId: 'abc' }, 'BOOKING_REQUEST')).toBe('BOOKING_REQUEST:abc');
    expect(alertIdentity({ bookingId: 'abc' }, 'booking_request')).toBe('BOOKING_REQUEST:abc');
    expect(alertIdentity({}, 'DELAY_TIME_PROPOSAL')).toBe('DELAY_TIME_PROPOSAL:');
  });

  it('drops an alert that arrived long before this page did — the refresh case', async () => {
    // A page is reloaded a minute after the notification arrived (the worker
    // hands the message to whichever page is listening). The alert is real, the
    // arrival is not now, so nothing may ring.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      const { playBuzzer } = await freshBuzzer();
      vi.setSystemTime(new Date('2026-01-01T10:01:00Z'));

      expect(playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3, alertId: 'BOOKING_REQUEST:stale', sentAt: Date.parse('2026-01-01T10:00:30Z') })).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      // No AudioContext was even created: the alert never reached the audio
      // engine, let alone played late.
      expect(FakeAudioContext.instance).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops an alert stamped before this page started, even seconds old', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:10Z'));
      const { playBuzzer } = await freshBuzzer();   // this page starts running now
      vi.setSystemTime(new Date('2026-01-01T10:00:14Z'));

      // Arrived four seconds ago (well inside the freshness window) but *before*
      // this document existed: a page that loads into a queued delivery must not
      // ring for it. The notification banner is still the user's alert.
      expect(playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3, alertId: 'BOOKING_REQUEST:queued', sentAt: Date.parse('2026-01-01T10:00:06Z') })).toBe(false);
      expect(FakeAudioContext.instance).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rings a fresh alert delivered to a page that is already running', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      const { playBuzzer } = await freshBuzzer();
      vi.setSystemTime(new Date('2026-01-01T10:00:20Z'));

      expect(playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, alertId: 'BOOKING_REQUEST:live', sentAt: Date.parse('2026-01-01T10:00:19.800Z') })).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeAudioContext.instance.started.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rings a single notification once, however many times it is delivered', async () => {
    // The worker posts the alert to every window AND broadcasts it on the
    // BroadcastChannel; the two copies used to ring twice.
    const { playBuzzer } = await freshBuzzer();
    const alert = { type: 'BOOKING_REQUEST', repeats: 3, alertId: 'BOOKING_REQUEST:once', sentAt: Date.now() };

    expect(playBuzzer({ ...alert })).toBe(true);
    expect(playBuzzer({ ...alert })).toBe(false);
    expect(playBuzzer({ ...alert })).toBe(false);
  });

  it('keeps one tab silent when another tab of the same origin already rang', async () => {
    // Two tabs, one notification: the alarm is one sound, not one per tab.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      const firstTab = await freshBuzzer();
      const { claimAlertDelivery } = firstTab;
      expect(claimAlertDelivery({ alertId: 'BOOKING_REQUEST:twotabs', sentAt: Date.now() })).toBe(true);

      // A second tab is a second module instance with the same localStorage.
      const secondTab = await freshBuzzer();
      expect(secondTab.claimAlertDelivery({ alertId: 'BOOKING_REQUEST:twotabs', sentAt: Date.now() })).toBe(false);
      // …and a different alert still rings there.
      expect(secondTab.claimAlertDelivery({ alertId: 'BOOKING_REQUEST:other', sentAt: Date.now() })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rings for a delivery the caller already cleared, without claiming it twice', async () => {
    // The app claims the arrival first (so a page that cannot make a sound still
    // shows the banner and the toast) and then asks for the ring. Claiming again
    // inside playBuzzer would refuse the very alert the caller just accepted.
    const { playBuzzer, claimAlertDelivery } = await freshBuzzer();
    const envelope = { alertId: 'BOOKING_REQUEST:req-claimed', sentAt: Date.now() };
    expect(claimAlertDelivery(envelope)).toBe(true);
    expect(playBuzzer({ type: 'BOOKING_REQUEST', ...envelope, claimed: true })).toBe(true);
  });

  it('never lets the gate swallow a buzzer the user asked for', async () => {
    const { playBuzzer } = await freshBuzzer();
    expect(playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, manual: true })).toBe(true);
    expect(playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, manual: true })).toBe(true);
  });

  it('exposes the same identity helper the app and the worker use', () => {
    expect(alertIdentity({ bookingRequestId: 'xyz' }, 'DELAY_BOOKING')).toBe('DELAY_BOOKING:xyz');
    expect(claimAlertDelivery({ alertId: 'DELAY_BOOKING:xyz', sentAt: Date.now() })).toBe(true);
    expect(claimAlertDelivery({ alertId: 'DELAY_BOOKING:xyz', sentAt: Date.now() })).toBe(false);
  });
});
