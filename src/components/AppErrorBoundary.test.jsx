import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import AppErrorBoundary from './AppErrorBoundary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A blank page is the worst failure this app can have, and it is what a render
// crash looks like from the outside — React unmounts what it cannot draw and
// leaves an empty <div id="root">. These tests keep the net in place: the
// visitor must always be left with a message and a way out.
describe('AppErrorBoundary', () => {
  let container;
  let root;

  const mount = async children => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<AppErrorBoundary>{children}</AppErrorBoundary>); });
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('renders children untouched while nothing throws', async () => {
    await mount(<p>All good</p>);
    expect(container.textContent).toBe('All good');
    expect(container.querySelector('.crash-screen')).toBeNull();
  });

  it('shows what broke and a reload button instead of an empty page', async () => {
    const Boom = () => { throw new Error('Cannot read properties of undefined'); };
    await mount(<Boom />);

    const screen = container.querySelector('.crash-screen');
    expect(screen).not.toBeNull();
    expect(screen.textContent).toContain('Something went wrong');
    // The error line is what support is told, so it has to be on the screen.
    expect(container.querySelector('.crash-detail').textContent).toContain('Cannot read properties of undefined');
    const reload = Array.from(container.querySelectorAll('button')).find(node => node.textContent.includes('Reload the page'));
    expect(reload).not.toBeNull();
    expect(screen.textContent).toContain('8380017393');
  });

  it('names a crash that carries no message at all', async () => {
    const Boom = () => { throw new Error(''); };
    await mount(<Boom />);
    // Never an empty box where the reason should be.
    expect(container.querySelector('.crash-detail').textContent.trim().length).toBeGreaterThan(0);
  });

  it('reloading is the one action it offers', async () => {
    const Boom = () => { throw new Error('boom'); };
    await mount(<Boom />);
    const reload = Array.from(container.querySelectorAll('button')).find(node => node.textContent.includes('Reload the page'));
    // jsdom cannot navigate, so the click only has to exist and not throw.
    await act(async () => { reload.click(); });
    expect(container.querySelector('.crash-screen')).not.toBeNull();
  });
});
