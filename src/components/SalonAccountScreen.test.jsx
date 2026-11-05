import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalonAccountScreen } from './SalonScreens';

const { salonProfile } = vi.hoisted(() => ({ salonProfile: vi.fn() }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonProfile } };
});


globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Stable identities, exactly like AppShell's useCallback'd `navigate` / `notify`.
// `onSessionUpdate` is deliberately NOT stable: the salon session writer used to
// receive a new identity on every session write, and the loader depended on it.
const navigate = () => {};
const notify = () => {};

const completeProfile = {
  salonName: 'Glamour Studio',
  ownerName: 'Ravi',
  addressLine1: 'Sitabuldi, Nagpur',
  genderType: 'MALE',
  latitude: 21.12,
  longitude: 79.08,
  services: [{ id: 's1', name: 'Haircut', price: 250 }],
  businessHours: [{ openingTime: '10:00', closingTime: '20:00', weeklyOff: 'Sunday' }],
  profileCompleted: true,
  isOpen: true,
};

const session = { userId: 'salon-1', user: { fullName: 'Ravi', salon: completeProfile } };

function renderScreen() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  // Re-rendering the parent hands the screen a brand new `onSessionUpdate`
  // identity each time — what a session write does in the real shell.
  let setTick = () => {};
  function Harness() {
    const [tick, update] = useState(0);
    setTick = update;
    return (
      <SalonAccountScreen
        session={session}
        navigate={navigate}
        notify={notify}
        onSessionUpdate={() => setTick(value => value + 1)}
        onLogout={() => {}}
      />
    );
  }

  return { container, root, Harness, bumpParent: () => setTick(value => value + 1) };
}

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('SalonAccountScreen loading', () => {
  beforeEach(() => { salonProfile.mockReset(); });
  afterEach(() => { document.body.innerHTML = ''; });

  it('fetches the profile once even while the session callback identity keeps changing', async () => {
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: completeProfile } });
    const { container, root, Harness } = renderScreen();

    await act(async () => { root.render(<Harness />); });
    await flush();
    await flush();

    // Before the loader stopped depending on `onSessionUpdate`, each response
    // wrote to the session, which rebuilt `load`, which re-fired the effect: an
    // endless fetch loop that pinned the screen on "Loading salon profile…".
    expect(salonProfile).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Glamour Studio');
    expect(container.textContent).not.toContain('Loading salon profile');

    await act(async () => { root.render(<Harness />); });
    await flush();
    expect(salonProfile).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });

  it('paints the cached profile instead of a full-page spinner while refreshing', async () => {
    // A request that never settles models a slow network: the partner should
    // still read their salon, not a blocked page.
    salonProfile.mockReturnValue(new Promise(() => {}));
    const { container, root, Harness } = renderScreen();

    await act(async () => { root.render(<Harness />); });
    await flush();

    expect(container.textContent).toContain('Glamour Studio');
    expect(container.textContent).toContain('Updating…');
    expect(container.textContent).not.toContain('Loading salon profile');

    await act(async () => { root.unmount(); });
  });

  it('still shows the full-page loader on a cold start with nothing cached', async () => {
    salonProfile.mockReturnValue(new Promise(() => {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SalonAccountScreen
          session={{ userId: 'salon-1', user: {} }}
          navigate={navigate}
          notify={notify}
          onSessionUpdate={() => {}}
          onLogout={() => {}}
        />,
      );
    });
    await flush();

    expect(container.textContent).toContain('Loading salon profile');

    await act(async () => { root.unmount(); });
  });
});

// "Just like we have Edit profile, we have to give the Edit Services button."
// The menu editor is a separate screen on purpose: the profile editor saves the
// address, photos, hours and barbers along with the services, so changing one
// price there means re-sending everything.
describe('SalonAccountScreen → Edit services', () => {
  beforeEach(() => { salonProfile.mockReset(); });
  afterEach(() => { document.body.innerHTML = ''; });

  it('puts an Edit services button beside Edit, and it opens the menu editor', async () => {
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: completeProfile } });
    const go = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SalonAccountScreen
          session={session}
          navigate={go}
          notify={notify}
          onSessionUpdate={() => {}}
          onLogout={() => {}}
        />,
      );
    });
    await flush();
    await flush();

    const buttons = Array.from(container.querySelectorAll('button'));
    const servicesButton = buttons.find(node => node.textContent.includes('Edit services'));
    expect(servicesButton).toBeTruthy();
    // Both entries sit in the same hero, side by side.
    expect(servicesButton.parentElement.className).toContain('salon-profile-actions');
    expect(servicesButton.parentElement.textContent).toContain('Edit');

    await act(async () => { servicesButton.click(); });
    expect(go).toHaveBeenCalledWith('editServices');

    // The partner menu offers the same door in plain words, and so does the
    // Services tile in the profile stats.
    const menuRow = buttons.find(node => node.textContent.includes('Prices and timing only'));
    expect(menuRow).toBeTruthy();
    await act(async () => { menuRow.click(); });
    expect(go.mock.calls.filter(([name]) => name === 'editServices')).toHaveLength(2);

    const statTile = container.querySelector('.salon-profile-stats button');
    expect(statTile.getAttribute('aria-label')).toBe('Edit your services');
    await act(async () => { statTile.click(); });
    expect(go.mock.calls.filter(([name]) => name === 'editServices')).toHaveLength(3);

    await act(async () => { root.unmount(); });
  });
});
