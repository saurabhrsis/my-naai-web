// Booking reminders ("alarm") for the web build.
//
// The mobile app wakes the customer a little before their slot. The web can do
// the same through the SAME notification permission the push flow already
// owns — one permission flow, two features:
//
//   · Browsers implementing Notification Triggers (Chrome and friends) get a
//     genuinely scheduled OS notification via the service worker's
//     `showNotification({ showTrigger: new TimestampTrigger(ts) })` — it fires
//     even with the tab closed.
//   · Everywhere else we arm an in-page timer as a graceful fallback, re-armed
//     from localStorage on every app start (`armStoredReminders`). A closed
//     browser cannot be woken there; the booking-approved push from the salon
//     side still reaches them.
//
// Entries live in localStorage so a reload between booking and visit keeps
// the reminder armed, and cancelling the booking cancels the reminder.
import { getErrorMessage } from '../components/Shared';

export const REMINDER_MINUTES_BEFORE = 30;
const PREF_KEY = 'mynaaiBookingRemindersEnabled';
const LIST_KEY = 'mynaaiReminderList';
const timers = new Map();

export function remindersEnabled() {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    return stored === null ? true : stored === 'true';
  } catch { return true; }
}

export function setRemindersEnabled(enabled) {
  try { localStorage.setItem(PREF_KEY, enabled ? 'true' : 'false'); } catch { /* private mode */ }
  if (!enabled) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }
}

function readList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeList(entries) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(entries)); } catch { /* private mode */ }
}

// The booking payload stores separate date and time strings; combine them the
// same way the bookings list does (`YYYY-MM-DDT09:30:00`), tolerating seconds.
export function reminderTimestamp(bookingDate, bookingTime) {
  const day = String(bookingDate || '').split('T')[0];
  const time = String(bookingTime || '00:00').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const start = new Date(`${day}T${time}:00`).getTime();
  if (!Number.isFinite(start)) return NaN;
  return start - REMINDER_MINUTES_BEFORE * 60 * 1000;
}

function notificationSupported() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

async function showViaServiceWorker(entry, scheduledTs) {
  try {
    if (!navigator?.serviceWorker) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    // Feature-detect Notification Triggers; TimestampTrigger only exists where
    // scheduled notifications are implemented.
    if (typeof TimestampTrigger === 'undefined') return false;
    await registration.showNotification(entry.title, {
      body: entry.body,
      tag: reminderTag(entry.bookingId),
      showTrigger: new TimestampTrigger(scheduledTs),
      data: { url: `/#/bookings`, bookingId: entry.bookingId },
    });
    return true;
  } catch (error) {
    console.debug(getErrorMessage(error, 'Scheduled reminder is unavailable in this browser.'));
    return false;
  }
}

function reminderTag(bookingId) {
  return `booking-reminder-${bookingId || 'booking'}`;
}

function fireReminder(entry) {
  timers.delete(entry.bookingId);
  // The in-page fallback: show through the Notification API (permission was
  // verified when armed; it cannot be taken back without a page visit, but
  // check anyway — the user can revoke between arm and fire).
  if (!notificationSupported()) return;
  try {
    const notification = new Notification(entry.title, { body: entry.body, tag: reminderTag(entry.bookingId) });
    notification.onclick = () => {
      try { window.focus(); window.location.hash = '/bookings'; } catch { /* no-op */ }
    };
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not show the booking reminder.'));
  }
  writeList(readList().filter(item => item.bookingId !== entry.bookingId));
}

function armTimer(entry) {
  if (timers.has(entry.bookingId)) return;
  const delayMs = entry.ts - Date.now();
  if (delayMs <= 0) return;
  timers.set(entry.bookingId, setTimeout(() => fireReminder(entry), delayMs));
}

// Call once on app start: clean out the past, re-arm the future. Needed
// because setTimeout does not survive a reload, and the salon-side delay /
// earlier-slot change may have already re-pointed the entry.
export function armStoredReminders() {
  if (!remindersEnabled()) return 0;
  const now = Date.now();
  const fresh = readList().filter(entry => Number(entry.ts) > now);
  writeList(fresh);
  fresh.forEach(armTimer);
  return fresh.length;
}

// Schedule the reminder 30 minutes before the slot. Returns 'scheduled'
// (os-level), 'armed' (in-page fallback), or '' (off / denied / too late) so
// the caller can toast the accurate outcome.
export async function scheduleBookingReminder({ bookingId = '', bookingDate, bookingTime, salonName = 'your salon' }) {
  if (!remindersEnabled()) return '';
  const ts = reminderTimestamp(bookingDate, bookingTime);
  if (!Number.isFinite(ts) || ts <= Date.now()) return '';
  if (!notificationSupported()) return '';

  const entry = {
    bookingId: bookingId || `booking-${ts}`,
    ts,
    title: `${salonName} in ${REMINDER_MINUTES_BEFORE} minutes`,
    body: `Leave now to reach on time for your My Naai booking.`,
    bookingDate,
    bookingTime,
  };
  writeList([...readList().filter(item => item.bookingId !== entry.bookingId), entry]);

  if (await showViaServiceWorker(entry, ts)) return 'scheduled';
  armTimer(entry);
  return 'armed';
}

// The booking was cancelled — drop the armed reminder and best-effort close a
// scheduled OS notification carrying this tag.
export function cancelBookingReminder(bookingId) {
  if (!bookingId) return;
  if (timers.has(bookingId)) {
    clearTimeout(timers.get(bookingId));
    timers.delete(bookingId);
  }
  writeList(readList().filter(item => item.bookingId !== bookingId));
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistration) {
    navigator.serviceWorker.getRegistration()
      .then(registration => registration?.getNotifications?.({ tag: reminderTag(bookingId) }))
      .then(notifications => (notifications || []).forEach(notification => notification.close()))
      .catch(() => {});
  }
}
