import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The signed-out buzzer check. iOS only ever grants a notification permission to
// an app that is open, so a login wall made the buzzer untestable on an iPhone
// before signing in. These tests pin the simulated booking-request alert: it
// rings the real buzzer, shows the same notification, and claims the same route
// ids a real BOOKING_REQUEST carries — without asking for an account.
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')),
  isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(),
  onMessage: vi.fn(),
}));
vi.mock('../lib/push', async () => {
  const actual = await vi.importActual('../lib/push');
  return {
    ...actual,
    displayNotification: vi.fn(() => Promise.resolve(true)),
    getPushToken: vi.fn(() => Promise.resolve('')),
  };
});
vi.mock('../lib/buzzer', () => ({ playBuzzer: vi.fn(() => true), unlockBuzzer: vi.fn() }));

import { BuzzerTestCard } from './BuzzerTestCard';
import { displayNotification } from '../lib/push';
import { playBuzzer, unlockBuzzer } from '../lib/buzzer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('signed-out buzzer check', () => {
  let container;
  let root;
  let notify;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    notify = vi.fn();
    await act(async () => { root.render(<BuzzerTestCard notify={notify} />); });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button'))
    .find(node => node.textContent.includes(text));

  beforeEach(() => {
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(() => Promise.resolve('granted')) };
    window.AudioContext = function AudioContext() {};
    vi.mocked(playBuzzer).mockReset().mockReturnValue(true);
    vi.mocked(unlockBuzzer).mockReset();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    delete window.AudioContext;
    vi.clearAllMocks();
  });

  it('plays the real buzzer and the real notification on the tap, with no account', async () => {
    await mount();

    const button = buttonByText('Test booking buzzer');
    expect(button).not.toBeNull();
    await act(async () => { button.click(); });
    await flush();

    // The unlock happens inside the same tap, then the buzzer rings, then the
    // banner — the order the salon actually experiences.
    expect(unlockBuzzer).toHaveBeenCalled();
    expect(playBuzzer).toHaveBeenCalledWith(expect.objectContaining({ type: 'BOOKING_REQUEST' }));
    expect(displayNotification).toHaveBeenCalled();
    const payload = vi.mocked(displayNotification).mock.calls[0][0];
    expect(payload.title).toContain('booking request');
    expect(payload.title).toContain('simulated');
    expect(payload.body).toContain('buzzer');
    // Shaped like the real thing so the worker's own routing is exercised, while
    // the type stays TEST: a simulated alert can never be offered for answering.
    const data = payload.data;
    expect(data.type).toBe('TEST');
    expect(data.simulatedType).toBe('BOOKING_REQUEST');
    expect(data.bookingRequestId).toMatch(/^mynaai-buzzer-test-\d+$/);
    expect(buttonByText('Test again')).not.toBeNull();
  });

  it('starts the buzzer in the tap before awaiting the notification permission', async () => {
    const order = [];
    let resolvePermission;
    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn(() => {
        order.push('permission');
        return new Promise(resolve => { resolvePermission = resolve; });
      }),
    };
    vi.mocked(unlockBuzzer).mockImplementation(() => { order.push('unlock'); });
    vi.mocked(playBuzzer).mockImplementation(() => { order.push('buzzer'); return true; });
    await mount();

    act(() => { buttonByText('Test booking buzzer').click(); });

    expect(order).toEqual(['unlock', 'buzzer', 'permission']);
    expect(displayNotification).not.toHaveBeenCalled();
    await act(async () => { resolvePermission('granted'); });
    await flush();

    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(displayNotification).toHaveBeenCalledTimes(1);
  });

  it('tests the buzzer in an embedded preview without substituting a popup or opening a tab', async () => {
    // An embedded preview may suppress the native prompt. It must say so rather
    // than faking an Allow dialog, while still letting the user hear the buzzer.
    Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => false }, configurable: true });
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
    try {
      await mount();
      const openSpy = vi.spyOn(window, 'open').mockReturnValue({});
      const button = buttonByText('Test booking buzzer');
      expect(button).not.toBeNull();
      expect(container.textContent).toContain('This preview may suppress notification prompts');
      await act(async () => { button.click(); });
      await flush();

      expect(openSpy).not.toHaveBeenCalled();
      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(playBuzzer).toHaveBeenCalled();
      expect(container.textContent).toContain('sandbox did not show a notification prompt');
      expect(displayNotification).not.toHaveBeenCalled();
      openSpy.mockRestore();
    } finally {
      delete document.permissionsPolicy;
    }
  });

  it('still lets the sound be tested when notifications are blocked and explains how to unblock alerts', async () => {
    globalThis.Notification = { permission: 'denied', requestPermission: vi.fn(() => Promise.resolve('denied')) };
    await mount();

    const button = buttonByText('Test booking buzzer');
    expect(button).not.toBeNull();
    await act(async () => { button.click(); });
    await flush();

    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
    expect(unlockBuzzer).toHaveBeenCalled();
    expect(playBuzzer).toHaveBeenCalled();
    expect(displayNotification).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Notifications are off for this site');
    expect(container.textContent).toContain('Change the site permission in browser settings');
  });
});
