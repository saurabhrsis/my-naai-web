import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the push surface is stubbed: the sheet's job is to tell the truth about
// what the browser reported, and every "Try again" must end with visible
// feedback — never a silent return to the same pixels ("not getting any").
vi.mock('../lib/push', () => ({
  getPushStatus: vi.fn(),
  getPushToken: vi.fn(),
  getPushDiagnostics: vi.fn(() => Promise.resolve({ ok: true, checks: [] })),
  formatPushDiagnostics: vi.fn(() => 'OK · test: Yes'),
  isPushConfigured: vi.fn(() => true),
  watchNotificationPermission: vi.fn(() => () => {}),
}));

import { PermissionSheet } from './PermissionUI';
import { getPushStatus, getPushToken } from '../lib/push';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('alerts sheet states that used to go quiet on Try again', () => {
  let container;
  let root;
  let onGranted;
  let onClose;

  const mount = async (state = 'needs-permission', props = {}) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onGranted = vi.fn();
    onClose = vi.fn();
    await act(async () => {
      root.render(<PermissionSheet open state={state} kind="notifications" onGranted={onGranted} onClose={onClose} {...props} />);
    });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button'))
    .find(node => node.textContent.includes(text));

  beforeEach(() => {
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
    vi.mocked(getPushStatus).mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(getPushToken).mockResolvedValue('');
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('a re-check that is still waiting for permission shows the Allow view with a hint — it never fires a gesture-less popup', async () => {
    await mount('needs-permission');

    await act(async () => { buttonByText('Check again').click(); });
    await flush();

    // The tap gesture was already spent by the status re-read, so asking the
    // browser here would never show a popup on Safari — the sheet must NOT try.
    expect(vi.mocked(getPushToken)).not.toHaveBeenCalledWith(expect.objectContaining({ requestPermission: true }));
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
    // …and the user is told exactly what to do next instead of seeing nothing.
    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Allow notifications');
    expect(sheet.textContent).toContain('Still waiting for your answer');
  });

  it('an unconfigured build says so honestly and every retry stamps the time', async () => {
    vi.mocked(getPushStatus).mockResolvedValue({ state: 'unconfigured', reason: 'Notifications have not been enabled for this build yet.' });
    await mount('unconfigured', { required: true });

    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Alerts are not switched on yet');
    expect(sheet.textContent).toContain('not your browser');
    expect(sheet.textContent).toContain('Sign-in on this device has to finish with alerts on');

    await act(async () => { buttonByText('Check again').click(); });
    await flush();

    expect(vi.mocked(getPushStatus)).toHaveBeenCalled();
    expect(container.querySelector('.permission-gate-sheet').textContent).toContain('Last checked');
  });

  it('an unsupported browser names the way out instead of a dead Try again', async () => {
    vi.mocked(getPushStatus).mockResolvedValue({ state: 'unsupported', reason: 'This browser context cannot receive web notifications.' });
    await mount('unsupported');

    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('This browser cannot receive alerts');
    expect(sheet.textContent).toContain('Chrome, Edge or Samsung Internet');
    expect(sheet.textContent).toContain('Add to Home Screen');

    await act(async () => { buttonByText('Check again').click(); });
    await flush();

    expect(vi.mocked(getPushStatus)).toHaveBeenCalled();
  });

  it('a finishing retry that still fails refreshes the reason and stamps the time', async () => {
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(() => Promise.resolve('granted')) };
    vi.mocked(getPushStatus).mockResolvedValue({ state: 'unavailable', reason: 'First reason.' });
    await mount('unavailable');

    vi.mocked(getPushStatus).mockResolvedValue({ state: 'unavailable', reason: 'Refreshed reason: the worker would not start.' });
    await act(async () => { buttonByText('Try again').click(); });
    await flush();

    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Alerts are allowed — finishing setup');
    expect(sheet.textContent).toContain('Refreshed reason');
    expect(sheet.textContent).toContain('Last checked');
    expect(sheet.textContent).not.toContain('Still off');
  });

  it('the iPhone install check says out loud when the app is still not installed', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1');
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    try {
      await mount('needs-permission');

      expect(container.querySelector('.permission-gate-sheet').textContent).toContain('Install My Naai to get alerts');

      await act(async () => { buttonByText('I installed it — Check').click(); });
      await flush();

      const sheet = container.querySelector('.permission-gate-sheet');
      expect(sheet.textContent).toContain('Still not installed');
      expect(sheet.textContent).toContain('Home Screen');
      expect(sheet.textContent).toContain('Last checked');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
