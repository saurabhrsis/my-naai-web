import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  INSTALL_RESULT,
  clearInstallPrompt,
  hasInstallPrompt,
  isInstalled,
  noteInstallPrompt,
  onInstallPromptChange,
  requestInstall,
  watchInstallPrompt,
} from './install';

// The deferred prompt is module state, so every test starts from "nothing
// captured" and installs its own fake event.
const makePromptEvent = ({ outcome = 'accepted' } = {}) => ({
  prompt: vi.fn(() => Promise.resolve()),
  userChoice: Promise.resolve({ outcome }),
  preventDefault: vi.fn(),
});

beforeEach(() => {
  clearInstallPrompt();
  delete window.deferredPWAInstallPrompt;
  vi.clearAllMocks();
});

describe('the install prompt is used at most once', () => {
  it('has nothing to offer before the browser fires its event', async () => {
    expect(hasInstallPrompt()).toBe(false);
    expect(await requestInstall()).toBe(INSTALL_RESULT.UNAVAILABLE);
  });

  it('opens the browser dialog and reports the acceptance', async () => {
    const event = makePromptEvent({ outcome: 'accepted' });
    noteInstallPrompt(event);
    expect(hasInstallPrompt()).toBe(true);

    expect(await requestInstall()).toBe(INSTALL_RESULT.ACCEPTED);
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('reports a dismissal as a dismissal (so the caller does not nag)', async () => {
    noteInstallPrompt(makePromptEvent({ outcome: 'dismissed' }));
    expect(await requestInstall()).toBe(INSTALL_RESULT.DISMISSED);
  });

  it('never calls prompt() twice on the same event', async () => {
    // Chrome throws InvalidStateError on a spent event and the button used to
    // sit there doing nothing — the exact "it feels stuck" report.
    const event = makePromptEvent();
    noteInstallPrompt(event);

    await requestInstall();
    expect(hasInstallPrompt()).toBe(false);
    expect(await requestInstall()).toBe(INSTALL_RESULT.UNAVAILABLE);
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('turns a prompt() that throws into "show the manual steps"', async () => {
    const event = makePromptEvent();
    event.prompt.mockImplementation(() => { throw new Error('InvalidStateError'); });
    noteInstallPrompt(event);

    expect(await requestInstall()).toBe(INSTALL_RESULT.UNAVAILABLE);
  });
});

describe('a dialog that never answers cannot hang the button', () => {
  it('gives up after the timeout and says so', async () => {
    vi.useFakeTimers();
    try {
      // A suppressed prompt: `userChoice` never settles.
      const event = { prompt: vi.fn(() => Promise.resolve()), userChoice: new Promise(() => {}), preventDefault: vi.fn() };
      noteInstallPrompt(event);

      const pending = requestInstall();
      await vi.advanceTimersByTimeAsync(1300);
      expect(await pending).toBe(INSTALL_RESULT.TIMEOUT);
      // …and the event is spent, so the next tap goes to the guide.
      expect(hasInstallPrompt()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait when the browser gives no userChoice at all', async () => {
    const event = { prompt: vi.fn(() => Promise.resolve()), preventDefault: vi.fn() };
    noteInstallPrompt(event);
    expect(await requestInstall()).toBe(INSTALL_RESULT.TIMEOUT);
  });
});

describe('every surface can react to the prompt appearing', () => {
  it('notifies subscribers when a prompt arrives, is used and is cleared', async () => {
    const listener = vi.fn();
    const stop = onInstallPromptChange(listener);

    noteInstallPrompt(makePromptEvent());
    expect(listener).toHaveBeenCalledTimes(1);

    await requestInstall();
    clearInstallPrompt();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();
    const calls = listener.mock.calls.length;
    clearInstallPrompt();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('picks up a prompt captured by index.html before React existed', () => {
    window.deferredPWAInstallPrompt = makePromptEvent();
    const stop = watchInstallPrompt();
    try {
      expect(hasInstallPrompt()).toBe(true);
    } finally {
      stop();
    }
  });

  it('drops the prompt when the app reports itself installed', () => {
    // The app shell keeps this watcher alive for the whole session.
    const stop = watchInstallPrompt();
    try {
      noteInstallPrompt(makePromptEvent());
      expect(hasInstallPrompt()).toBe(true);
      window.dispatchEvent(new Event('appinstalled'));
      expect(hasInstallPrompt()).toBe(false);
    } finally {
      stop();
    }
  });

  it('knows a browser tab is not an installed app', () => {
    expect(isInstalled()).toBe(false);
  });
});
