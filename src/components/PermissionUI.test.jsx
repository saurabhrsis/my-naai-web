import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PendingPermissionAsk } from './PermissionUI';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

// The tab My Naai opens when the ask cannot happen inside another page. It is
// the only path that ends in a real browser popup, so it is the one surface
// where asking without a tap is correct: the visitor opened this tab *to* be
// asked.
describe('PendingPermissionAsk', () => {
  let container;
  let root;
  let onNotify;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onNotify = vi.fn();
    await act(async () => { root.render(<PendingPermissionAsk onNotify={onNotify} />); });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button'))
    .find(node => node.textContent.trim().includes(text));

  beforeEach(() => {
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    delete navigator.permissions;
    vi.restoreAllMocks();
  });

  it('stays out of the way on a tab that was not opened to ask', async () => {
    window.history.replaceState({}, '', '/login');
    await mount();
    expect(container.innerHTML).toBe('');
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('asks for the real popup the moment the tab opens, and leaves the URL clean', async () => {
    window.history.replaceState({}, '', '/login?mynaai-ask=notifications');
    await mount();

    // This is the whole point of the tab: the browser's own popup, not copy.
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    // The marker is single-use — a reload must never ask again.
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/login');
  });

  it('shows a labelled Allow card when the browser answers nothing, instead of going quiet', async () => {
    window.history.replaceState({}, '', '/?mynaai-ask=notifications');
    await mount();

    // Quieter-messaging UI: no popup, no denial — one more labelled tap.
    expect(container.querySelector('.pending-ask')).not.toBeNull();
    expect(container.textContent).toContain('Allow notifications');
    await act(async () => { buttonByText('Allow').click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(2);
  });

  it('closes itself and confirms out loud once alerts are on', async () => {
    globalThis.Notification.requestPermission = vi.fn(() => {
      globalThis.Notification.permission = 'granted';
      return Promise.resolve('granted');
    });
    window.history.replaceState({}, '', '/?mynaai-ask=notifications');
    await mount();

    expect(container.querySelector('.pending-ask')).toBeNull();
    expect(onNotify).toHaveBeenCalledWith('success', expect.stringContaining('Booking alerts on'));
  });

  it('asks for location with one tap and says what it is for', async () => {
    const getCurrentPosition = vi.fn(success => success({ coords: { latitude: 21.1458, longitude: 79.0882 } }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    window.history.replaceState({}, '', '/?mynaai-ask=location');
    await mount();

    // Location is never fired on load — a popup for it belongs to a tap.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Allow location');
    await act(async () => { buttonByText('Allow location').click(); });
    await flush();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pending-ask')).toBeNull();
    expect(onNotify).toHaveBeenCalledWith('success', expect.stringContaining('Location on'));
  });

  it('a "Not now" is the end of it — the tab never asks twice', async () => {
    window.history.replaceState({}, '', '/?mynaai-ask=notifications');
    await mount();
    await act(async () => { buttonByText('Not now').click(); });
    await flush();
    expect(container.querySelector('.pending-ask')).toBeNull();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
  });
});
