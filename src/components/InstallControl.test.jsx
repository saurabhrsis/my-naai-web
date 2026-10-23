import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { InstallControl } from './PermissionUI';
import { clearInstallPrompt, noteInstallPrompt } from '../lib/install';

// "When we click install it feels stuck, or there is UI somewhere but it never
// shows." These cases pin down the three things a tap must always do: say it is
// working, hand over to the browser's dialog when there is one, and show the
// manual steps when there is not.
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

async function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(node); });
  await flush();
  return { container, root };
}

const click = async node => {
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

const makePromptEvent = (outcome = 'accepted') => ({
  prompt: vi.fn(() => Promise.resolve()),
  userChoice: Promise.resolve({ outcome }),
  preventDefault: vi.fn(),
});

beforeEach(() => { clearInstallPrompt(); delete window.deferredPWAInstallPrompt; });
afterEach(() => { clearInstallPrompt(); document.body.innerHTML = ''; });

describe('InstallControl always answers the tap', () => {
  it('shows the manual steps when the browser has no install dialog', async () => {
    const { container } = await render(<InstallControl variant="sidebar" />);
    const button = container.querySelector('.install-side-button');
    expect(button.textContent).toContain('Install My Naai');

    await click(button);
    expect(container.querySelector('.modal-card')).not.toBeNull();
    expect(container.querySelector('.modal-card').textContent).toMatch(/install my naai/i);
  });

  it('opens the browser dialog and never hangs on the button', async () => {
    const event = makePromptEvent('accepted');
    noteInstallPrompt(event);
    const { container } = await render(<InstallControl variant="sidebar" />);

    await click(container.querySelector('.install-side-button'));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // Accepted → the prompt was the whole flow: no guide, no dialogs.
    expect(container.querySelector('.modal-card')).toBeNull();
    expect(container.querySelector('.install-side-button')).toBeNull();
  });

  it('respects a dismissal without nagging', async () => {
    noteInstallPrompt(makePromptEvent('dismissed'));
    const { container } = await render(<InstallControl variant="sidebar" />);

    await click(container.querySelector('.install-side-button'));
    expect(container.querySelector('.modal-card')).toBeNull();
    // …but the control is still there for a second attempt.
    expect(container.querySelector('.install-side-button')).not.toBeNull();
  });

  it('falls back to the steps when a second tap has no usable prompt left', async () => {
    noteInstallPrompt(makePromptEvent('dismissed'));
    const { container } = await render(<InstallControl variant="sidebar" />);

    await click(container.querySelector('.install-side-button'));
    await click(container.querySelector('.install-side-button'));

    const modal = container.querySelector('.modal-card');
    expect(modal).not.toBeNull();
    expect(modal.querySelectorAll('.ios-install-steps li').length).toBeGreaterThan(0);
  });

  it('explains itself when the browser never opens its dialog', async () => {
    vi.useFakeTimers();
    try {
      // A suppressed prompt: the choice promise never settles.
      noteInstallPrompt({ prompt: vi.fn(() => Promise.resolve()), userChoice: new Promise(() => {}), preventDefault: vi.fn() });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<InstallControl variant="sidebar" />); });

      const button = container.querySelector('.install-side-button');
      await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      // The label says it is working before anything else happens.
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Opening');

      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      const note = container.querySelector('.install-fallback-note');
      expect(note).not.toBeNull();
      expect(note.textContent).toMatch(/did not open the install dialog/i);
      act(() => root.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it('is the same control in the login pill and the menu row', async () => {
    const pill = await render(<InstallControl variant="pill" />);
    expect(pill.container.querySelector('.install-auth-button').textContent).toContain('Install app');
    act(() => pill.root.unmount());
    pill.container.remove();

    clearInstallPrompt();
    const menu = await render(<InstallControl variant="menu" className="mobile-shell-menu-install" />);
    const row = menu.container.querySelector('.mobile-shell-menu-install');
    expect(row.textContent).toContain('Install My Naai');
    await click(row);
    expect(menu.container.querySelector('.modal-card')).not.toBeNull();
  });
});
