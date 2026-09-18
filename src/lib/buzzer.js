/*
 * My Naai booking buzzer.
 *
 * Replays the exact buzzer sound the My Naai mobile app uses (the Notifee
 * `buzzer` / `buzzer_old` sounds from android/app/src/main/res/raw in
 * rightserveinfotechsystems/my_naai_app) for time-critical booking notifications.
 *
 * Time-critical alerts (a salon booking request, a delay proposal) buzz + pulse
 * the device; informational messages stay silent by design.
 *
 * WHEN the buzzer sounds — the rule this file exists to enforce
 * ------------------------------------------------------------
 * The buzzer sounds at the moment the notification arrives, or not at all. It
 * must never sound later, when the user brings the app back to the front:
 *
 *   · a phone that receives a push while the app is in the background suspends
 *     the AudioContext ('suspended' / 'interrupted' on iOS). Scheduling audio
 *     into a suspended context queues it, and the queue is flushed the instant
 *     the app is resumed — that is the "the buzzer rings when I open the app"
 *     report. So we only ever play when the context is *running right now*;
 *     nothing is scheduled for later, and any burst that has not started yet is
 *     cancelled the moment the page goes to the background.
 *   · the HTMLAudio fallback could not be used as a retry chain either: a
 *     rejected play() that was retried in the background started the alarm on
 *     the next foreground. It is now one attempt, while visible.
 *   · `unlockBuzzer()` used to "unlock" the HTML audio elements by playing the
 *     real buzzer file and pausing it — an audible blip on the very first tap
 *     after opening the app. Unlocking is silent now (muted element + a silence
 *     buffer through Web Audio).
 *
 * While the app cannot sound anything (backgrounded, locked phone, or the very
 * first seconds before a gesture) the alert is still delivered by the system
 * notification the service worker raises for buzzer types, which carries sound
 * and the vibrate pattern.
 *
 * Platform notes
 * --------------
 * - Sound uses the Web Audio API, which browsers only let play after a user
 *   gesture (autoplay policy). `unlockBuzzer()` is called on user interaction to
 *   unlock (and preload) audio for the session.
 * - Vibration works on Android Chrome and a few other mobile browsers; desktop
 *   ignores `navigator.vibrate`.
 * - iOS Safari requires special handling — AudioContext must be resumed on a user
 *   gesture, and HTMLAudio is the fallback when Web Audio cannot start.
 * - One listener per page: the service worker broadcasts MYNAAI_PLAY_BUZZER to
 *   every client when a push arrives, and this module is the only place that
 *   turns that message into sound.
 */

const SOUNDS = {
  booking: '/assets/audio/buzzer_old.wav', // mobile 'booking' channel - piercing
  default: '/assets/audio/buzzer.wav',      // mobile 'default_channel'
};

let audioContext = null;
let unlocked = false;
let audioElements = {}; // url -> HTMLAudioElement fallback
const buffers = {};   // url -> Promise<AudioBuffer>
const bufferFailed = {}; // url -> true (fall back to synthetic tone)
let broadcastListenerSetup = false;
// Bursts handed to the Web Audio clock that have not started playing yet, and
// the timers used to chain HTMLAudio repeats — both are cancelled when the page
// goes to the background so a stale alarm can never fire on the way back in.
const scheduledBursts = new Set();
const pendingTimers = new Set();

function isHidden() {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
}

function addTimer(callback, delay) {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    callback();
  }, delay);
  pendingTimers.add(id);
  return id;
}

function clearPendingTimers() {
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
}

let visibilityHooked = false;
function hookVisibility() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (isHidden()) {
      // Nothing rings on the way back in: cancel what has not started, and any
      // queued HTMLAudio repeat.
      stopScheduledBursts();
      clearPendingTimers();
      return;
    }
    // Back in the foreground: the context was suspended while we were away, so
    // resume it for the NEXT alert (never to replay the previous one).
    try {
      if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch {
      // ignore
    }
  });
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) {
      audioContext = new Ctor();
      hookVisibility();
    }
    return audioContext;
  } catch {
    return null;
  }
}

// True only when audio can actually start in this instant. A suspended or
// interrupted context cannot — and asking it to play would queue the sound for
// whenever the page resumes.
function isRunning(ctx) {
  return Boolean(ctx) && ctx.state === 'running';
}

function getAudioElement(url) {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!audioElements[url]) {
    try {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audioElements[url] = audio;
    } catch {
      return null;
    }
  }
  return audioElements[url];
}

// Decode the real buzzer file into an AudioBuffer we can replay instantly.
function loadBuffer(url) {
  if (buffers[url]) return buffers[url];
  buffers[url] = (async () => {
    const ctx = getAudioContext();
    if (!ctx) throw new Error('No AudioContext');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  })().catch(error => {
    bufferFailed[url] = true;
    delete buffers[url];
    throw error;
  });
  return buffers[url];
}

function playSynthetic(ctx, { frequency, start, duration, volume }) {
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'square'; // square wave reads as the shop-buzzer rasp
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    if (start > ctx.currentTime + 0.05) scheduledBursts.add(oscillator);
    oscillator.onended = () => scheduledBursts.delete(oscillator);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  } catch {
    // ignore synthetic failures
  }
}

// Stop every burst that has been handed to the clock but has not started yet.
function stopScheduledBursts() {
  for (const node of Array.from(scheduledBursts)) {
    scheduledBursts.delete(node);
    try {
      node.stop(0);
    } catch {
      // already stopped / never started
    }
  }
}

// Vibrate the device like the buzzer. Returns whether vibration was issued.
export function vibrate(pattern = [260, 120, 260, 120, 520]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}

function soundForType(type = '') {
  const value = String(type || '').toUpperCase();
  // Booking requests use the piercing `buzzer_old`; secondary alerts use `buzzer`.
  return value === 'BOOKING_REQUEST' || value === 'DELAY_BOOKING' ? SOUNDS.booking : SOUNDS.default;
}

export function isBuzzerSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.AudioContext || window.webkitAudioContext || typeof Audio !== 'undefined');
}

// Which alert types buzz, in one place for the client and the worker broadcast.
export function isBuzzerType(type = '') {
  const value = String(type || '').toUpperCase();
  return value === 'BOOKING_REQUEST' || value === 'DELAY_BOOKING' || value === 'DELAY_TIME_PROPOSAL';
}

function setupBroadcastListener() {
  if (broadcastListenerSetup || typeof window === 'undefined') return;
  broadcastListenerSetup = true;
  hookVisibility();

  // The service worker broadcasts this to every client the moment a push
  // arrives — the one place a background push turns into sound in a live page.
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        const data = event.data || {};
        if (data.type === 'MYNAAI_PLAY_BUZZER') {
          playBuzzer({ type: data.notificationType || data.data?.type || 'BOOKING_REQUEST', repeats: 3 });
        }
      });
    }
  } catch {
    // ignore
  }

  // BroadcastChannel for cross-tab buzzer
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.unref?.();
      channel.addEventListener('message', event => {
        const data = event.data || {};
        if (data.type === 'MYNAAI_PLAY_BUZZER') {
          playBuzzer({ type: data.notificationType || data.data?.type || 'BOOKING_REQUEST', repeats: 3 });
        }
      });
    }
  } catch {
    // BroadcastChannel not supported, ignore
  }
}

// Called from the app on user interaction so the AudioContext is allowed to
// produce sound (and the buzzer file is preloaded) later without a gesture.
// Completely silent: unlocking must never make a sound of its own.
export function unlockBuzzer() {
  setupBroadcastListener();
  hookVisibility();
  if (unlocked && !audioContext) return;
  unlocked = true;

  const ctx = getAudioContext();
  if (ctx) {
    // Preload the real buzzer files so an alert can fire immediately.
    loadBuffer(SOUNDS.booking).catch(() => {});
    loadBuffer(SOUNDS.default).catch(() => {});

    // Playing a one-sample silent buffer is what actually unlocks iOS.
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore
    }
  }

  // Warm the HTMLAudio fallback too — MUTED. Playing the real file to "unlock"
  // it (the old behaviour) is audible on a slow phone, which is one more way the
  // buzzer appeared to ring when the app was opened.
  try {
    Object.values(SOUNDS).forEach(url => {
      const audio = getAudioElement(url);
      if (!audio) return;
      audio.muted = true;
      const promise = audio.play();
      const release = () => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // ignore
        }
        audio.muted = false;
      };
      if (promise && promise.then) promise.then(release).catch(() => { audio.muted = false; });
      else release();
    });
  } catch {
    // ignore
  }
}

// Last resort for a page that is *hidden* and whose audio clock would not start
// (the Android report: the notification arrives in a backgrounded tab and
// nothing is heard). Playback starts immediately — while the page is still in
// the background — and is abandoned the moment the page becomes visible, so a
// browser that silently deferred it can never make the alarm ring on app open.
function playWithAudioElementWhileHidden(url, repeats = 1) {
  const startedAt = Date.now();
  const guard = startedAt + 4000;
  let finished = false;
  let audio = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    pendingTimers.delete(guardId);
    try { audio?.pause(); } catch { /* ignore */ }
  };
  const guardId = setTimeout(cleanup, guard - startedAt);
  pendingTimers.add(guardId);
  try {
    audio = getAudioElement(url);
    if (!audio) {
      clearTimeout(guardId);
      pendingTimers.delete(guardId);
      return false;
    }
    audio.muted = false;
    const attempt = () => {
      if (finished) return;
      if (!isHidden() || Date.now() > guard) return cleanup();
      try { audio.currentTime = 0; } catch { /* ignore */ }
      const promise = audio.play();
      if (promise && promise.then) {
        promise.then(() => {
          if (Number(repeats) > 1 && !finished) {
            const next = setTimeout(attempt, Math.max(700, (audio.duration || 1) * 1000 + 150));
            pendingTimers.add(next);
          }
        }).catch(() => cleanup());
      }
    };
    attempt();
    return true;
  } catch {
    return false;
  }
}

// One attempt, while the page is visible. Returns whether playback was started.
function playWithAudioElement(url, repeats = 2) {
  if (isHidden()) return false;
  try {
    const audio = getAudioElement(url);
    if (!audio) return false;
    audio.muted = false;
    const maxPlays = Math.max(1, Math.min(3, repeats || 1));
    const startedAt = Date.now();
    let playCount = 0;

    const playNext = () => {
      // Backgrounded, or the attempt is old enough that a buzz would be noise
      // rather than an alert: stop instead of turning into "it rings when I
      // open the app".
      if (playCount >= maxPlays || isHidden() || Date.now() - startedAt > 6000) return;
      playCount += 1;
      try {
        audio.currentTime = 0;
      } catch {
        // ignore
      }
      const promise = audio.play();
      if (promise && promise.then) {
        promise.then(() => {
          addTimer(playNext, Math.max(700, (audio.duration || 1) * 1000 + 150));
        }).catch(() => {
          addTimer(playNext, 200);
        });
      }
    };

    playNext();
    return true;
  } catch {
    return false;
  }
}

// How long the buzzer may wait for the audio clock to start before it gives up.
// A page that is *hidden* gets a very short window on purpose: on iOS the resume
// request only completes when the app is brought forward, and playing then is
// the late alarm ("it rings when I open the app") this file must never produce.
// Chrome on Android resumes a backgrounded page's audio clock immediately, so
// the buzz still lands at the moment the notification arrives.
const BACKGROUND_START_DEADLINE = 1200;
const FOREGROUND_START_DEADLINE = 5000;

// Play the real My Naai buzzer (or a synthetic pulse if the file/stream is
// unavailable) plus a device vibration, at the instant the alert arrives.
export function playBuzzer({ type = '', repeats = 2 } = {}) {
  const isBooking = String(type || '').toUpperCase() === 'BOOKING_REQUEST';
  const vibrated = vibrate(isBooking ? [260, 120, 260, 120, 520] : [300, 140, 300, 140, 500]);
  setupBroadcastListener();

  const url = soundForType(type);
  const count = Math.max(1, Math.min(3, repeats || 1));
  const ctx = getAudioContext();

  const playNow = () => {
    const current = getAudioContext();
    if (!isRunning(current)) return;
    stopScheduledBursts();
    if (bufferFailed[url]) {
      playSyntheticSequence(current, count);
      return;
    }
    loadBuffer(url)
      .then(buffer => {
        const ready = getAudioContext();
        if (isRunning(ready)) playBufferBursts(ready, buffer, count);
      })
      .catch(() => {
        const fallback = getAudioContext();
        if (isRunning(fallback)) playSyntheticSequence(fallback, count);
      });
  };

  // 1. The audio clock is running right now — play immediately, wherever the
  //    page is. A hidden Android tab keeps its clock running, which is exactly
  //    the "it buzzes when the notification arrives, in the background" case.
  if (isRunning(ctx)) {
    playNow();
    return true;
  }

  // 2. Suspended or interrupted (phone locked, app backgrounded, audio focus
  //    lost). Ask the browser to start the clock and buzz the moment it does —
  //    under a deadline. On iOS a background resume stays pending until the app
  //    returns, so the deadline abandons it and NOTHING is replayed later; the
  //    worker's own notification (sound + vibrate) is the alert in that window.
  if (ctx) {
    const deadline = isHidden() ? BACKGROUND_START_DEADLINE : FOREGROUND_START_DEADLINE;
    let expired = false;
    // Deliberately not one of the cancellable retry timers: this is a guard, not
    // a pending buzz.
    setTimeout(() => { expired = true; }, deadline);
    ctx.resume()
      .then(() => {
        if (expired || !isRunning(ctx)) return;
        playNow();
      })
      .catch(() => {});
    // If the clock never starts and the page is still in the background, the
    // alert must not go silent: try the element path, immediately and bounded.
    // It is cancelled the instant the page comes forward.
    setTimeout(() => {
      if (!isRunning(ctx) && isHidden()) playWithAudioElementWhileHidden(url, count > 1 ? 2 : 1);
    }, deadline + 100);
    return true;
  }

  // 3. No Web Audio at all (rare): the HTMLAudio fallback, one attempt on a
  //    visible page — never a background retry chain.
  if (!isHidden() && playWithAudioElement(url, count)) return true;
  return vibrated;
}

// Schedule the burst(s) on the running context and remember the ones that have
// not started, so a page that goes to the background cancels them instead of
// firing them on resume.
function playBufferBursts(ctx, buffer, repeats) {
  if (!isRunning(ctx)) return;
  let offset = 0.02;
  for (let i = 0; i < repeats; i += 1) {
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.9, ctx.currentTime + offset);
      source.connect(gain);
      gain.connect(ctx.destination);
      if (offset > 0.05) {
        scheduledBursts.add(source);
        source.onended = () => scheduledBursts.delete(source);
      }
      source.start(ctx.currentTime + offset);
      offset += buffer.duration + 0.15;
    } catch {
      break;
    }
  }
}

function playSyntheticSequence(ctx, repeats) {
  if (!isRunning(ctx)) return;
  try {
    const count = Math.max(1, Math.min(6, repeats || 2));
    const now = ctx.currentTime;
    const step = 0.52;
    const on = 0.3;
    for (let i = 0; i < count; i += 1) {
      playSynthetic(ctx, { frequency: 920, start: now + i * step, duration: on, volume: 0.32 });
      playSynthetic(ctx, { frequency: 700, start: now + i * step + 0.05, duration: on * 0.72, volume: 0.3 });
    }
  } catch {
    // ignore synthetic failures
  }
}

// Called when the app comes back to the foreground: resume the context so the
// NEXT alert can sound. Never replays anything.
export function keepBuzzerAlive() {
  if (!unlocked || !audioContext || isHidden()) return;
  try {
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch {
    // ignore
  }
}

// Set up the single buzzer listener as soon as this module is loaded (App
// imports it statically), so a push that arrives before any tap is still heard.
if (typeof window !== 'undefined') setupBroadcastListener();
