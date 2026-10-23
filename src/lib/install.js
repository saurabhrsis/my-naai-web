// The browser's "install this app" prompt, owned in exactly one place.
//
// Three things went wrong when each screen handled this itself:
//
//   1. A prompt event can be used ONCE. `window.deferredPWAInstallPrompt` was
//      never cleared, so a second tap called `prompt()` on a spent event —
//      Chrome throws `InvalidStateError`, the error was swallowed, and the
//      button sat there looking stuck.
//   2. `prompt()` + `await userChoice` has no timeout. When the browser
//      suppresses its own dialog (a policy block, an embedded preview, a
//      prompt that will never resurface) the choice promise never settles, so
//      the tap did nothing at all — no spinner, no message, no fallback.
//   3. The manual guide was unreachable whenever a prompt existed. If the
//      native dialog refused to appear, the only install route was dead.
//
// So: one module keeps the event, refuses to reuse it, races the choice
// against a short timeout, and tells the caller which of the four things
// happened. Every install control then always has something to show — the
// browser's dialog, or the step-by-step guide for the browser in use.
import { isStandalone } from './permissions';

export const INSTALL_RESULT = {
  // The user accepted: `appinstalled` will follow (sometimes it does not, so
  // the caller may treat this as installed too).
  ACCEPTED: 'accepted',
  // The user closed the dialog. Do not nag — but the prompt is now spent.
  DISMISSED: 'dismissed',
  // No deferred prompt on this device/browser, or it was already used.
  UNAVAILABLE: 'unavailable',
  // The dialog never answered in time. Very often it never appeared at all,
  // so the caller should offer the manual steps.
  TIMEOUT: 'timeout',
};

// How long to wait for the browser's dialog to answer. Chrome resolves
// `userChoice` as soon as the dialog closes; when the dialog never opens (a
// suppressed prompt), nothing resolves, and waiting longer only makes the
// button look frozen.
const CHOICE_TIMEOUT_MS = 1200;

// The event object lives here rather than on `window` so it cannot be reused
// by accident. `window.deferredPWAInstallPrompt` is still read as a fallback:
// index.html captures the event before React exists.
let deferred = null;
let spent = false;
const listeners = new Set();

const readGlobalPrompt = () => {
  if (typeof window === 'undefined') return null;
  const global = window.deferredPWAInstallPrompt;
  return global && typeof global.prompt === 'function' ? global : null;
};

const emit = () => { listeners.forEach(listener => { try { listener(); } catch { /* a listener must not break the others */ } }); };

/** Record a captured `beforeinstallprompt` event. */
export function noteInstallPrompt(event) {
  if (!event || typeof event.prompt !== 'function') return;
  deferred = event;
  spent = false;
  emit();
}

/** Is there a prompt we have not used yet? */
export function hasInstallPrompt() {
  if (spent) return false;
  return Boolean(deferred || readGlobalPrompt());
}

/** Subscribe to "a prompt arrived / was used / the app got installed". */
export function onInstallPromptChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget the captured prompt (after use, or once the app is installed). */
export function clearInstallPrompt() {
  deferred = null;
  spent = true;
  if (typeof window !== 'undefined') window.deferredPWAInstallPrompt = null;
  emit();
}

/** True when My Naai is already running as an installed app. */
export function isInstalled() {
  return isStandalone();
}

/**
 * Ask the browser to install. Always settles — with one of INSTALL_RESULT —
 * within roughly `CHOICE_TIMEOUT_MS`, so a caller can never be left waiting.
 */
export async function requestInstall() {
  if (isStandalone()) return INSTALL_RESULT.ACCEPTED;
  if (spent) return INSTALL_RESULT.UNAVAILABLE;
  const event = deferred || readGlobalPrompt();
  if (!event) return INSTALL_RESULT.UNAVAILABLE;

  // A prompt event is single-use; mark it before the call so a double tap
  // cannot reach the browser twice.
  spent = true;
  deferred = event;

  try {
    // Newer Chrome returns a promise here; older builds return undefined.
    await event.prompt();
  } catch {
    // The event was already used by another handler, or this browser refuses
    // the programmatic prompt. Both mean "show the manual steps".
    return INSTALL_RESULT.UNAVAILABLE;
  }

  const choice = event.userChoice && typeof event.userChoice.then === 'function'
    ? event.userChoice.then(result => (result && result.outcome) || '').catch(() => '')
    : Promise.resolve('');

  const settled = await Promise.race([
    choice,
    new Promise(resolve => { window.setTimeout(() => resolve('timeout'), CHOICE_TIMEOUT_MS); }),
  ]);

  // Whatever happened, this event is done: the browser will not accept a
  // second prompt() on it.
  if (typeof window !== 'undefined' && window.deferredPWAInstallPrompt === event) {
    window.deferredPWAInstallPrompt = null;
  }

  if (settled === 'accepted') return INSTALL_RESULT.ACCEPTED;
  if (settled === 'dismissed') return INSTALL_RESULT.DISMISSED;
  return INSTALL_RESULT.TIMEOUT;
}

// Listen once, from the app shell, so every install control reflects reality:
// the prompt may arrive long after the button was first rendered, and an
// installed app must stop offering to install itself.
export function watchInstallPrompt() {
  if (typeof window === 'undefined') return () => {};
  const onPrompt = event => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    noteInstallPrompt(event);
  };
  const onAvailable = () => noteInstallPrompt(readGlobalPrompt());
  const onInstalled = () => { clearInstallPrompt(); emit(); };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('pwa-install-available', onAvailable);
  window.addEventListener('appinstalled', onInstalled);
  window.addEventListener('pwa-installed', onInstalled);
  if (readGlobalPrompt()) noteInstallPrompt(readGlobalPrompt());
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('pwa-install-available', onAvailable);
    window.removeEventListener('appinstalled', onInstalled);
    window.removeEventListener('pwa-installed', onInstalled);
  };
}
