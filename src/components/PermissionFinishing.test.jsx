import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the push surface is stubbed: the sheet's job is to tell the truth about
// what the browser reported.
vi.mock('../lib/push', () => ({
  getPushStatus: vi.fn(),
  getPushToken: vi.fn(),
  isPushConfigured: vi.fn(() => true),
    notificationActionLimit: vi.fn(() => 2),
  watchNotificationPermission: vi.fn(() => () => {}),
}));

import { PermissionSheet } from './PermissionUI';
import { getPushStatus, getPushToken } from '../lib/push';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

// The report behind these tests: "I allowed the pop-up and it still shows the
// error." The permission is granted — the browser's own UI says so — and the
// only thing missing is our half of the job (the device token). Sending the user
// back to browser settings that are already correct, or calling it "still off",
// is a lie about their own device.
describe('alerts sheet with a granted permission whose token is late', () => {
  let container;
  let root;
  let onGranted;
  let onClose;

  const mount = async (state = 'unavailable') => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onGranted = vi.fn();
    onClose = vi.fn();
    await act(async () => {
      root.render(<PermissionSheet open state={state} kind="notifications" onGranted={onGranted} onClose={onClose} />);
    });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button'))
    .find(node => node.textContent.includes(text));

  beforeEach(() => {
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(() => Promise.resolve('granted')) };
    vi.mocked(getPushStatus).mockResolvedValue({ state: 'unavailable', reason: 'Notifications are allowed on this device — the last step is still finishing.' });
    vi.mocked(getPushToken).mockResolvedValue('');
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    vi.clearAllMocks();
  });

  it('never says "still off" or sends the user back to browser settings', async () => {
    await mount();

    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Alerts are allowed — finishing setup');
    expect(sheet.textContent).toContain('nothing to change in your settings');
    expect(sheet.textContent).not.toContain('Still off');
    expect(sheet.textContent).not.toContain('Switch Notifications back on');
  });

  it('retries the token and keeps the honest state when it is still not ready', async () => {
    await mount();

    await act(async () => { buttonByText('Try again').click(); });
    await flush();

    // The permission IS granted, so there is nothing to change in the browser —
    // the sheet retries our side and stays honest about it.
    expect(vi.mocked(getPushToken)).toHaveBeenCalled();
    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Alerts are allowed — finishing setup');
    expect(sheet.textContent).not.toContain('Still off');
  });

  it('closes itself the moment the background retry finishes', async () => {
    await mount();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mynaai:push-token', { detail: { token: 'late-token' } }));
    });
    await flush();

    expect(onGranted).toHaveBeenCalledWith('late-token');
    expect(onClose).toHaveBeenCalled();
  });
});
