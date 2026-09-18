import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The same Firebase stubs the rest of the suite uses: this card renders
// permission state, never messaging itself.
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
    isPushConfigured: vi.fn(() => true),
    notificationActionLimit: vi.fn(() => 2),
    getPushToken: vi.fn(() => Promise.resolve('')),
    getPushDiagnostics: vi.fn(() => Promise.resolve({ ok: true, checks: [] })),
    watchNotificationPermission: vi.fn(() => () => {}),
  };
});
vi.mock('../lib/buzzer', () => ({ playBuzzer: vi.fn(), unlockBuzzer: vi.fn() }));

import { NotificationDiagnostics } from './NotificationDiagnostics';
import { isPushConfigured } from '../lib/push';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

// What the Account screens show about alerts.
//
// The distinction that matters: "notifications are allowed" and "alerts will
// actually reach me" are not the same claim. A deployment without the Firebase
// web config can have the permission granted and still deliver nothing, and
// telling a salon owner their alerts are on there would cost them bookings.
describe('Alerts & permissions card', () => {
  let container;
  let root;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<NotificationDiagnostics />); });
    await flush();
    const toggle = container.querySelector('.diagnostics-toggle');
    await act(async () => { toggle.click(); });
    await flush();
  };

  beforeEach(() => {
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(() => Promise.resolve('granted')) };
    vi.mocked(isPushConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    vi.clearAllMocks();
  });

  it('announces live alerts and offers the buzzer test when alerts are configured', async () => {
    await mount();

    expect(container.textContent).toContain('Alerts are on for this device');
    expect(container.textContent).toContain('Booking requests, confirmations, delay updates and the buzzer');
    const testButton = Array.from(container.querySelectorAll('button')).find(node => node.textContent.includes('Test buzzer'));
    expect(testButton).toBeTruthy();
  });

  it('says the permission is allowed but alerts are not live yet when the build has no config', async () => {
    // The permission is real, the promise of delivery is not.
    vi.mocked(isPushConfigured).mockReturnValue(false);
    await mount();

    expect(container.textContent).toContain('Notifications allowed — alerts not switched on yet');
    expect(container.textContent).toContain('Booking alerts start as soon as My Naai switches them on');
    expect(container.textContent).not.toContain('reach this device');
    // No buzzer test either: it would prove nothing on a build with no alerts.
    const testButton = Array.from(container.querySelectorAll('button')).find(node => node.textContent.includes('Test buzzer'));
    expect(testButton).toBeUndefined();
    // …and the row still shows the permission as allowed.
    expect(container.querySelector('.perm-state-on').textContent).toContain('Allowed');
  });
});
