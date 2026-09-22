import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationsScreen } from './UserScreens';

const { salonNotificationList, bookingRequestOwnerAction, salonDelayBooking, getBookingRequestById, closeNotification } = vi.hoisted(() => ({
  salonNotificationList: vi.fn(),
  bookingRequestOwnerAction: vi.fn(),
  salonDelayBooking: vi.fn(),
  getBookingRequestById: vi.fn(),
  closeNotification: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonNotificationList, bookingRequestOwnerAction, salonDelayBooking, getBookingRequestById } };
});

vi.mock('../lib/push', async () => {
  const actual = await vi.importActual('../lib/push');
  return { ...actual, closeNotification };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

function byText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ').startsWith(label));
}

const session = { role: 'SALON', userId: 'salon-1', user: {} };
const roots = [];

async function renderScreen(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const notify = props.notify || vi.fn();
  const navigate = props.navigate || vi.fn();
  await act(async () => {
    root.render(<NotificationsScreen session={session} notify={notify} navigate={navigate} {...props} />);
  });
  await flush();
  return { container, root, notify, navigate };
}

function freshRequest(overrides = {}) {
  return {
    notificationId: 'n-1',
    type: 'BOOKING_REQUEST',
    bookingRequestId: 'req-1',
    title: 'New booking request',
    body: 'Riya Sharma wants a haircut at 6:30 PM',
    createdAt: new Date(Date.now() - 10000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [freshRequest()] } });
  bookingRequestOwnerAction.mockResolvedValue({ status: 'SUCCESS' });
  salonDelayBooking.mockResolvedValue({ status: 'SUCCESS' });
  getBookingRequestById.mockResolvedValue({ status: 'SUCCESS', data: { status: 'pending' } });
});

afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('salon Notifications tab — booking request actions', () => {
  it('offers Accept / Reject / Delay with a countdown for a live booking request', async () => {
    const { container } = await renderScreen();
    expect(byText('Accept', container)).toBeTruthy();
    expect(byText('Reject', container)).toBeTruthy();
    expect(byText('Delay', container)).toBeTruthy();
    expect(container.textContent).toMatch(/Respond in 0:[45]\d/);
  });

  it('accepts with the owner-action contract ({ action }) and shows the result instead of a loader', async () => {
    const { container, notify } = await renderScreen();
    await act(async () => { byText('Accept', container).click(); });
    await flush();
    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-1', { action: 'ACCEPT' });
    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('accepted'));
    expect(closeNotification).toHaveBeenCalledWith('req-1');
    expect(byText('Accept', container)).toBeFalsy();
    expect(container.textContent).toContain('You accepted this booking');
    expect(container.querySelector('[aria-busy="true"]')).toBeFalsy();
  });

  it('rejects and marks the card rejected', async () => {
    const { container } = await renderScreen();
    await act(async () => { byText('Reject', container).click(); });
    await flush();
    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-1', { action: 'REJECT' });
    expect(container.textContent).toContain('You rejected this booking request');
  });

  it('releases the buttons and reports the error when the server refuses', async () => {
    bookingRequestOwnerAction.mockRejectedValueOnce(new Error('network down'));
    const { container, notify } = await renderScreen();
    await act(async () => { byText('Accept', container).click(); });
    await flush();
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('network down'));
    const accept = byText('Accept', container);
    expect(accept).toBeTruthy();
    expect(accept.disabled).toBe(false);
  });

  it('sends the delay from the 20 / 40 / 60 minute picker', async () => {
    const { container } = await renderScreen();
    await act(async () => { byText('Delay', container).click(); });
    await flush();
    const option = byText('+40 minutes');
    expect(option).toBeTruthy();
    await act(async () => { option.click(); });
    await flush();
    expect(salonDelayBooking).toHaveBeenCalledWith('req-1', '40');
    expect(container.textContent).toContain('Delay sent');
  });

  it('says the time has gone once the 60-second window has passed, with no action buttons', async () => {
    salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [freshRequest({ createdAt: new Date(Date.now() - 5 * 60000).toISOString() })] } });
    const { container } = await renderScreen();
    expect(byText('Accept', container)).toBeFalsy();
    expect(byText('Delay', container)).toBeFalsy();
    expect(container.textContent).toContain('Time has gone');
    expect(getBookingRequestById).toHaveBeenCalledWith('req-1');
    expect(byText('Open request', container)).toBeTruthy();
  });

  it('reports what happened to an expired request when the server knows', async () => {
    getBookingRequestById.mockResolvedValue({ status: 'SUCCESS', data: { status: 'ACCEPTED' } });
    salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [freshRequest({ createdAt: new Date(Date.now() - 5 * 60000).toISOString() })] } });
    const { container } = await renderScreen();
    await flush();
    await act(async () => { vi.advanceTimersByTime(1100); });
    await flush();
    expect(container.textContent).toContain('Accepted');
    expect(byText('Open queue', container)).toBeTruthy();
  });

  it('removes the buttons as the minute runs out while the screen stays open', async () => {
    salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [freshRequest({ createdAt: new Date(Date.now() - 58000).toISOString() })] } });
    const { container } = await renderScreen();
    expect(byText('Accept', container)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(4000); });
    await flush();
    expect(byText('Accept', container)).toBeFalsy();
    expect(container.textContent).toContain('Time has gone');
  });

  it('refreshes the list when a new notification is delivered to the page', async () => {
    const { container } = await renderScreen();
    expect(salonNotificationList).toHaveBeenCalledTimes(1);
    salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [freshRequest(), freshRequest({ notificationId: 'n-2', bookingRequestId: 'req-2' })] } });
    await act(async () => { window.dispatchEvent(new CustomEvent('mynaai:notification', { detail: { type: 'BOOKING_REQUEST' } })); });
    await flush();
    expect(salonNotificationList).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.notification-booking-request').length).toBe(2);
  });
});
