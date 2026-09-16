// jsdom lacks Notification / ServiceWorker / AudioContext; provide minimal
// stubs so lib modules that feature-detect them behave predictably under test.
import { vi } from 'vitest';

if (typeof window !== 'undefined') {
  if (!('Notification' in window)) {
    window.Notification = class Notification {
      static permission = 'granted';
      static requestPermission = vi.fn(() => Promise.resolve('granted'));
      constructor() {}
      close() {}
    };
  }
  if (!('navigator' in window)) {
    window.navigator = {};
  }
  if (!('vibrate' in (window.navigator || {}))) {
    window.navigator.vibrate = vi.fn(() => true);
  }
  if (!('AudioContext' in window)) {
    window.AudioContext = class AudioContext {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
      decodeAudioData() { return Promise.resolve({ duration: 1 }); }
      resume() { return Promise.resolve(); }
    };
    window.webkitAudioContext = window.AudioContext;
  }
  if (!('indexedDB' in window)) {
    window.indexedDB = { open: vi.fn() };
  }
  // jsdom ships no geolocation at all, so `readPermission('location')` used to
  // read "unsupported" and every location row vanished from the tests. A stub
  // that reports a refusal (code 1 = PERMISSION_DENIED) matches the real
  // "not granted yet" state the UI has to handle.
  if (!('geolocation' in (window.navigator || {}))) {
    window.navigator.geolocation = {
      getCurrentPosition: vi.fn((_success, error) => {
        if (typeof error === 'function') error({ code: 1, message: 'Geolocation is not granted in tests.' });
      }),
      watchPosition: vi.fn(() => 0),
      clearWatch: vi.fn(),
    };
  }
}
