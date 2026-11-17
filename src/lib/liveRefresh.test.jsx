// The safety net under the socket: a tab that comes back into view re-reads, and
// a screen with something waiting on the server polls fast while it waits.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshWhenVisible, useAdaptiveRefresh } from './liveRefresh';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setVisibility = state => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  setVisibility('visible');
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('refreshWhenVisible', () => {
  beforeEach(() => setVisibility('visible'));

  it('re-reads when the tab is shown again, focused, or back online', () => {
    const load = vi.fn();
    const stop = refreshWhenVisible(load);

    setVisibility('hidden');
    expect(load).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(load).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    expect(load).toHaveBeenCalledTimes(3);

    stop();
    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not re-read for a hidden tab that merely gets focus events', () => {
    setVisibility('visible');
    const load = vi.fn();
    const stop = refreshWhenVisible(load);
    setVisibility('hidden');
    // Some browsers fire `focus` on a window that is behind another one.
    window.dispatchEvent(new Event('focus'));
    expect(load).not.toHaveBeenCalled();
    stop();
  });
});

function Probe({ load, isActive }) {
  useAdaptiveRefresh(load, isActive, { active: 5000, idle: 20000 });
  return null;
}

describe('useAdaptiveRefresh', () => {
  it('polls every 5 s while a request is waiting, 20 s when nothing is', async () => {
    vi.useFakeTimers();
    const load = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(<Probe load={load} isActive />); });

    await act(async () => { vi.advanceTimersByTime(4999); });
    expect(load).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(load).toHaveBeenCalledTimes(1);
    // Quiet: a background refresh must not flash a skeleton over the list.
    expect(load.mock.calls[0][0]).toEqual({ quiet: true });

    await act(async () => { root.render(<Probe load={load} isActive={false} />); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => { root.unmount(); });
  });
});
