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
 * Platform notes
 * --------------
 * - Sound uses the Web Audio API, which browsers only let play after a user
 *   gesture (autoplay policy). On a background/closed app the OS notification
 *   sound is controlled by the push payload the server sends; the client
 *   service worker can only pulse the device. `unlockBuzzer()` is called on the
 *   first user interaction to unlock (and preload) audio for the session.
 * - Vibration works on Android Chrome and a few other mobile browsers; desktop
 *   ignores `navigator.vibrate`.
 * - iOS Safari requires special handling - AudioContext must be resumed on user
 *   gesture and HTMLAudio fallback is used when Web Audio fails.
 * - Background support: service worker broadcasts MYNAAI_PLAY_BUZZER to all
 *   clients when a push arrives, so even a hidden tab can buzz if it has been
 *   unlocked before.
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

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) {
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
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
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  } catch {
    // ignore synthetic failures
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

function setupBroadcastListener() {
  if (broadcastListenerSetup || typeof window === 'undefined') return;
  broadcastListenerSetup = true;

  // Listen for service worker messages to play buzzer in background
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        const data = event.data || {};
        if (data.type === 'MYNAAI_PLAY_BUZZER' || data.type === 'MYNAAI_CLOSE_NOTIFICATION') {
          if (data.type === 'MYNAAI_PLAY_BUZZER') {
            playBuzzer({ type: data.notificationType || data.data?.type || 'BOOKING_REQUEST', repeats: 3 });
          }
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

  // Keep audio context alive on visibility change - helps with background tabs
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && audioContext) {
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
      }
    });
  } catch {
    // ignore
  }
}

// Called from the app on the first user interaction so the AudioContext is
// allowed to produce sound (and the buzzer file is preloaded) later without a
// gesture.
export function unlockBuzzer() {
  if (unlocked) {
    // Even if already unlocked, ensure context is resumed
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return;
  }
  unlocked = true;
  setupBroadcastListener();

  const ctx = getAudioContext();
  if (ctx) {
    // Preload the real buzzer files so a push can fire immediately.
    loadBuffer(SOUNDS.booking).catch(() => {});
    loadBuffer(SOUNDS.default).catch(() => {});

    // Play a silent buffer to fully unlock on iOS
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore
    }
  }

  // Also preload HTMLAudio elements as fallback for iOS and strict autoplay policies
  try {
    Object.values(SOUNDS).forEach(url => {
      const audio = getAudioElement(url);
      if (audio) {
        audio.load();
        // Try to play and immediately pause to unlock - works on some browsers
        const playPromise = audio.play();
        if (playPromise && playPromise.then) {
          playPromise.then(() => {
            audio.pause();
            audio.currentTime = 0;
          }).catch(() => {});
        }
      }
    });
  } catch {
    // ignore
  }
}

function playWithAudioElement(url, repeats = 2) {
  try {
    const audio = getAudioElement(url);
    if (!audio) return false;

    let playCount = 0;
    const maxPlays = Math.max(1, Math.min(3, repeats));

    const playNext = () => {
      if (playCount >= maxPlays) return;
      playCount++;
      audio.currentTime = 0;
      const promise = audio.play();
      if (promise && promise.then) {
        promise.then(() => {
          // Schedule next play after current finishes + small gap
          audio.onended = () => {
            if (playCount < maxPlays) {
              setTimeout(playNext, 150);
            } else {
              audio.onended = null;
            }
          };
        }).catch(() => {
          // Autoplay blocked, try next after delay
          if (playCount < maxPlays) {
            setTimeout(playNext, 200);
          }
        });
      } else {
        // Old browser without promise
        if (playCount < maxPlays) {
          setTimeout(playNext, (audio.duration || 1) * 1000 + 150);
        }
      }
    };

    playNext();
    return true;
  } catch {
    return false;
  }
}

// Play the real My Naai buzzer (or a synthetic pulse if the file/stream is
// unavailable) plus a device vibration. Returns true when a sound was started.
export function playBuzzer({ type = '', repeats = 2 } = {}) {
  // Always vibrate - works on Android Chrome, Samsung Internet, some iOS browsers
  const vibratePattern = type === 'BOOKING_REQUEST' ? [260, 120, 260, 120, 520] : [300, 140, 300, 140, 500];
  vibrate(vibratePattern);

  // Setup broadcast listener if not already done
  if (!broadcastListenerSetup) {
    setupBroadcastListener();
  }

  const url = soundForType(type);
  const ctx = getAudioContext();

  // Try Web Audio first if available and running
  if (ctx) {
    if (ctx.state === 'suspended') {
      try { ctx.resume().catch(() => {}); } catch { /* ignore */ }
    }

    if (ctx.state === 'running' || ctx.state === 'interrupted') {
      // Prefer the real mobile buzzer file.
      if (!bufferFailed[url]) {
        loadBuffer(url)
          .then(buffer => {
            const current = getAudioContext();
            if (!current || (current.state !== 'running' && current.state !== 'interrupted')) {
              // Fall back to Audio element if context not running
              playWithAudioElement(url, repeats);
              return;
            }
            // Play it a couple of times so it reads as a buzzer burst.
            let offset = 0;
            for (let i = 0; i < Math.max(1, Math.min(3, repeats || 1)); i += 1) {
              try {
                const source = current.createBufferSource();
                const gain = current.createGain();
                source.buffer = buffer;
                gain.gain.setValueAtTime(0.9, current.currentTime + offset);
                source.connect(gain);
                gain.connect(current.destination);
                source.start(current.currentTime + offset);
                offset += buffer.duration + 0.15;
              } catch {
                // If Web Audio source fails, break and try Audio element
                break;
              }
            }
          })
          .catch(() => {
            // File load failed - try Audio element, then synthetic
            if (!playWithAudioElement(url, repeats)) {
              const fallbackCtx = getAudioContext();
              if (fallbackCtx) playSyntheticSequence(fallbackCtx, repeats);
            }
          });
        return true;
      }

      // File previously failed — try Audio element first, then synthetic
      if (playWithAudioElement(url, repeats)) {
        return true;
      }
      playSyntheticSequence(ctx, repeats);
      return true;
    }
  }

  // No Web Audio or suspended - try HTMLAudio fallback (works better on iOS after unlock)
  if (playWithAudioElement(url, repeats)) {
    return true;
  }

  // Last resort: try synthetic if we can get a context
  if (ctx) {
    playSyntheticSequence(ctx, repeats);
    return true;
  }

  // Even if sound failed, vibration may have succeeded - return true if we vibrated
  return true;
}

function playSyntheticSequence(ctx, repeats) {
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

// Keep buzzer alive in background - called periodically by the app
export function keepBuzzerAlive() {
  if (!unlocked || !audioContext) return;
  try {
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  } catch {
    // ignore
  }
}
