import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vibrate, isBuzzerSupported, unlockBuzzer, playBuzzer } from './buzzer';

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
  it('returns true and vibrates', () => {
    const result = playBuzzer({ type: 'BOOKING_REQUEST' });
    expect(result).toBe(true);
    expect(window.navigator.vibrate).toHaveBeenCalled();
  });
});

describe('unlockBuzzer', () => {
  it('preloads without throwing', () => {
    expect(() => unlockBuzzer()).not.toThrow();
  });
});


// ── WHEN the buzzer sounds ──────────────────────────────────────────────────
// The reported bug this suite pins down: the alarm rang when the salon owner
// opened the app again, not when the booking notification actually arrived.
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
    playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1 });
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
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3 });
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

    playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1 });
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
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 3 });
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
