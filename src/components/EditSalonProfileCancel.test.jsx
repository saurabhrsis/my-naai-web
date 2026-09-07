import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditSalonProfileScreen } from './SalonScreens';
import { ConfirmProvider } from './ConfirmDialog';

const { salonProfile } = vi.hoisted(() => ({ salonProfile: vi.fn() }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonProfile } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const completeProfile = {
  salonId: 'salon-1',
  salonName: 'Glamour Studio',
  ownerName: 'Ravi',
  phoneNumber: '9876543210',
  addressLine1: 'Sitabuldi, Nagpur',
  genderType: 'MALE',
  latitude: 21.12,
  longitude: 79.08,
  services: [{ serviceId: 's1', serviceName: 'Haircut', price: 250, durationMinutes: 30 }],
  businessHours: [{ openingTime: '10:00:00', closingTime: '20:00:00' }],
  profileCompleted: true,
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

function findButton(container, label) {
  return Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim() === label);
}

async function renderEditor({ params, onLogout = () => {}, navigate = () => {} }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ConfirmProvider>
        <EditSalonProfileScreen
          params={params}
          session={{ userId: 'salon-1', user: { salon: completeProfile }, isNewSalon: params?.isOnboarding === 'true' }}
          navigate={navigate}
          notify={() => {}}
          onSessionUpdate={() => {}}
          onLogout={onLogout}
        />
      </ConfirmProvider>,
    );
  });
  await flush();
  return { container, root };
}

// The Cancel button in the salon profile editor was rendered `disabled` during
// onboarding while the header back arrow was hidden, so a partner saw a Cancel
// control that did nothing at all and had no way off the screen. Both paths now
// respond on every device, through the in-app sheet (never window.confirm,
// which some installed-PWA webviews suppress).
describe('salon profile editor Cancel', () => {
  beforeEach(() => {
    salonProfile.mockReset();
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: completeProfile } });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('is enabled and asks before discarding a routine edit', async () => {
    const navigate = vi.fn();
    const { container, root } = await renderEditor({ params: {}, navigate });

    const cancel = findButton(container, 'Cancel');
    expect(cancel).toBeTruthy();
    expect(cancel.disabled).toBe(false);

    await act(async () => { cancel.click(); });
    await flush();

    // The app's own sheet, not a native dialog.
    expect(document.querySelector('.confirm-sheet')).toBeTruthy();
    expect(document.body.textContent).toContain('Discard your changes?');
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => { findButton(document.body, 'Discard changes').click(); });
    await flush();
    expect(navigate).toHaveBeenCalledWith('account', {}, { replace: true });

    await act(async () => { root.unmount(); });
  });

  it('keeps the partner on the screen when they choose Keep editing', async () => {
    const navigate = vi.fn();
    const { container, root } = await renderEditor({ params: {}, navigate });

    await act(async () => { findButton(container, 'Cancel').click(); });
    await flush();
    await act(async () => { findButton(document.body, 'Keep editing').click(); });
    await flush();

    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelector('.confirm-sheet')).toBeNull();

    await act(async () => { root.unmount(); });
  });

  it('during onboarding stays enabled and offers signing out instead of doing nothing', async () => {
    const onLogout = vi.fn();
    const { container, root } = await renderEditor({ params: { isOnboarding: 'true' }, onLogout });

    const cancel = findButton(container, 'Cancel');
    expect(cancel.disabled).toBe(false);

    await act(async () => { cancel.click(); });
    await flush();
    expect(document.body.textContent).toContain('Finish your salon profile first');

    await act(async () => { findButton(document.body, 'Sign out').click(); });
    await flush();
    expect(onLogout).toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });

  it('always renders a back control in the header, including during onboarding', async () => {
    const { container, root } = await renderEditor({ params: { isOnboarding: 'true' } });
    expect(container.querySelector('button[aria-label="Go back"]')).toBeTruthy();
    await act(async () => { root.unmount(); });
  });
});
