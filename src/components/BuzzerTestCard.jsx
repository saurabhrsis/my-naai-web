import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, CircleAlert, ExternalLink, RefreshCw, Settings } from 'lucide-react';
import { displayNotification, isPushConfigured, readNotificationPermission, requestNotificationPermission } from '../lib/push';
import { browserLabel, detectBrowser, promptsAvailable } from '../lib/permissions';
import { playBuzzer, unlockBuzzer } from '../lib/buzzer';
import { Button, cx } from './Shared';

// The signed-out buzzer check.
//
// Why this exists: iOS (and iPadOS) only ever grants a notification permission
// to an app that is *running*, and the login wall meant the buzzer could not be
// tried on an iPhone until after signing in — "unable to check on iOS without
// login". This card sits on the same pre-login card as the permission rows and
// fires the exact alert a booking request produces, so the device can be proven
// before an account exists. It is the same test the salon's Alerts & permissions
// card offers after sign-in, mirrored where the tester can reach it.
//
// What it can and cannot prove stays honest in the copy: tapping a button is a
// user gesture, so the buzzer is allowed to sound right there. The
// time-critical path (a booking arriving while the app is closed) is what the
// admin test alert in Alerts & permissions checks, and the note says so.
const SIMULATED_SALON = 'Your salon';

function simulatedBooking(data = {}) {
  const id = `mynaai-buzzer-test-${Date.now()}`;
  return {
    title: 'New booking request (simulated)',
    body: `${data.customerName || 'A customer'} wants ${data.serviceName || 'a service'} with ${data.barberName || 'your team'} · this is the buzzer and vibration a real request brings.`,
    data: {
      type: 'TEST',
      simulatedType: 'BOOKING_REQUEST',
      bookingRequestId: id,
      bookingId: id,
      salonName: data.salonName || SIMULATED_SALON,
    },
  };
}

export function BuzzerTestCard({ notify, className = '' }) {
  const [permission, setPermission] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  const read = useCallback(async () => {
    const next = await readNotificationPermission();
    setPermission(next);
    return next;
  }, []);

  useEffect(() => { read(); }, [read]);
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      read();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [read]);

  // One tap: ask (if needed) inside the gesture, unlock the audio, ring the real
  // buzzer, show the real notification. Nothing here needs an account.
  //
  // Gesture-safe: Safari drops a permission popup that happens after an `await`,
  // so when the permission is not already settled ('default' or still
  // 'checking') the browser is asked synchronously — before any async read.
  // Asking when the answer is already granted/denied/unsupported is harmless
  // (no popup, just the current value), which is what makes the blind ask safe.
  const test = async () => {
    setBusy(true);
    setMessage('');
    try {
      let state = permission;
      if (state === 'checking' || state === 'default') {
        state = await requestNotificationPermission();
        setPermission(state);
      }
      if (state === 'denied' || state === 'unsupported') {
        setMessage(state === 'denied'
          ? 'This browser is blocking notifications for My Naai. Turn them back on in its settings, then tap Test again.'
          : 'This browser cannot show web alerts, so the alert banner is skipped — the buzzer sound still plays.');
      }
      // The tap itself is the gesture browsers need before audio may play.
      unlockBuzzer();
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1 });
      const alert = simulatedBooking();
      const shown = state === 'granted'
        ? await displayNotification(alert)
        : false;
      setDone(true);
      if (shown) {
        setMessage('Buzzer played and the simulated alert was shown. Heard nothing? Turn the phone off silent and raise the media volume.');
      } else if (state === 'granted') {
        setMessage('The buzzer played, but this browser would not show the alert banner — check My Naai notifications in the site settings.');
      }
      notify?.('info', 'Simulated booking request — buzzer + alert sent.');
    } finally {
      setBusy(false);
    }
  };

  const blocked = permission === 'denied';
  const unsupported = permission === 'unsupported';
  const configured = isPushConfigured();
  // A page inside another page's frame can never show a permission popup, and
  // browsers answer 'denied' to every question there — so the fix is a real tab,
  // never browser settings that were never the problem.
  const embedded = !promptsAvailable('notifications');
  const openInTab = () => { try { return Boolean(window.open(window.location.href, '_blank', 'noopener')); } catch { return false; } };
  const buttonLabel = embedded ? 'Open in a new tab' : blocked || unsupported ? 'How to allow' : done ? 'Test again' : 'Test booking buzzer';

  return (
    <section className={cx('perm-card', 'buzzer-test-card', className)} aria-live="polite">
      <div className="perm-row">
        <span className="perm-row-icon"><BellRing size={15} /></span>
        <div className="perm-row-copy">
          <strong>{embedded ? 'Test the buzzer in its own tab' : blocked ? 'Buzzer is blocked' : 'Hear the booking buzzer'}</strong>
          <p>
            {embedded
              ? 'This page is open inside another app, where browsers hide the Allow prompt — and a silenced test would prove nothing. Open My Naai in its own tab, then tap Test booking buzzer there.'
              : blocked
              ? `Notifications are off for My Naai in ${browserLabel(detectBrowser())}, so neither the alert nor the buzzer can reach this phone. Flip that switch, then test again.`
              : 'Tap once to play the real My Naai buzzer — the sound a new booking request makes — plus the alert itself. No account needed. It rings while the app is open; with the app closed your phone plays the alert’s own sound and vibration.'}
          </p>
        </div>
        <button
          type="button"
          className={cx('install-auth-button', 'buzzer-test-button', blocked && 'allow-alerts-attention')}
          onClick={embedded ? openInTab : blocked || unsupported ? () => setMessage(blocked ? `Open this site’s settings in ${browserLabel(detectBrowser())} (the lock or ⚙ icon next to the address bar), set Notifications to Allow, then tap Test again.` : 'Add My Naai to the Home Screen on iPhone — that is the only way iOS allows alerts and the buzzer.') : test}
          disabled={busy}
        >
          {busy ? <RefreshCw size={14} className="spin" /> : embedded ? <ExternalLink size={14} /> : blocked ? <Settings size={14} /> : done ? <CheckCircle2 size={14} /> : <BellRing size={14} />}
          {buttonLabel}
        </button>
      </div>
      {permission === 'checking' && <p className="permission-help-note">Checking this device…</p>}
      {message && (
        <p className={cx('permission-help-note', 'buzzer-test-note', (blocked || unsupported) && 'warn')}>
          {(blocked || unsupported) ? <CircleAlert size={13} /> : null} {message}
        </p>
      )}
      {!configured && (
        <p className="permission-help-note">
          Booking alerts are not configured for this build yet, so nothing can be delivered to this device — the buzzer test above still proves the sound.
        </p>
      )}
      {permission !== 'checking' && permission !== 'denied' && permission !== 'unsupported' && (
        <p className="permission-help-note">
          {permission === 'granted'
            ? 'Notifications are allowed on this device. Sign in as a salon and open Account → Alerts & permissions to send a real test alert through the push path.'
            : 'Alerts are off — tap Test and your browser will ask once; choose Allow to let booking alerts through.'}
        </p>
      )}
    </section>
  );
}

export { simulatedBooking };
