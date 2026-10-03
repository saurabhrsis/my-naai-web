import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react';
import { displayNotification, isPushConfigured, readNotificationPermission, requestNotificationPermission } from '../lib/push';
import { browserLabel, detectBrowser, promptsAvailable } from '../lib/permissions';
import { playBuzzer, unlockBuzzer } from '../lib/buzzer';
import { cx } from './Shared';

// The signed-out buzzer check.
//
// Why this exists: iOS (and iPadOS) only ever grants a notification permission
// to an app that is *running*, and the login wall meant the buzzer could not be
// tried on an iPhone until after signing in. This card lives on the public salon-
// partner page—not the login form—and fires a simulated booking alert so a salon
// can test the sound before creating an account. The account card offers the same
// checks after sign-in.
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
  const embedded = !promptsAvailable('notifications');

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

  // One tap starts audio and requests browser permission before any await. That
  // preserves the gesture for both Web Audio and the native notification prompt.
  // In an embedded preview the browser may suppress the prompt, but the sound can
  // still be checked here and the card reports that the alert was not shown.
  const test = async () => {
    setBusy(true);
    setMessage('');
    try {
      unlockBuzzer();
      const buzzerStarted = playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, manual: true }) !== false;

      let state = permission;
      const permissionRequest = state === 'checking' || state === 'default'
        ? requestNotificationPermission()
        : null;
      if (permissionRequest) {
        state = await permissionRequest;
        setPermission(state);
      }

      const buzzerResult = buzzerStarted ? 'The buzzer test played.' : 'This browser could not start the buzzer.';
      if (state === 'denied' || state === 'unsupported') {
        setMessage(embedded
          ? `${buzzerResult} This preview cannot show the native notification prompt or alert banner; verify alerts on the live site.`
          : state === 'denied'
            ? `${buzzerResult} Notifications are off for this site, so no alert banner was shown. Change the site permission in browser settings to test alerts.`
            : `${buzzerResult} This browser cannot show web alerts.`);
      }

      const shown = state === 'granted'
        ? await displayNotification(simulatedBooking())
        : false;
      setDone(true);
      if (shown) {
        setMessage(`${buzzerResult} The simulated alert was shown. Heard nothing? Turn the phone off silent and raise the media volume.`);
      } else if (state === 'granted') {
        setMessage(`${buzzerResult} This browser would not show the alert banner — check My Naai notifications in the site settings.`);
      } else if (state === 'default') {
        setMessage(embedded
          ? `${buzzerResult} The sandbox did not show a notification prompt; verify alerts on the live site.`
          : `${buzzerResult} The notification prompt was dismissed, so no alert banner was shown.`);
      }
      notify?.(shown && buzzerStarted ? 'success' : 'info', shown
        ? 'Simulated booking alert shown.'
        : buzzerStarted ? 'Buzzer tested; no notification banner was shown.' : 'The buzzer and notification could not be tested in this browser.');
    } finally {
      setBusy(false);
    }
  };

  const blocked = permission === 'denied' && !embedded;
  const unsupported = permission === 'unsupported';
  const configured = isPushConfigured();
  const buttonLabel = done ? 'Test again' : 'Test booking buzzer';

  return (
    <section className={cx('perm-card', 'buzzer-test-card', className)} aria-live="polite">
      <div className="perm-row">
        <span className="perm-row-icon"><BellRing size={15} /></span>
        <div className="perm-row-copy">
          <strong>{embedded ? 'Test the buzzer here' : blocked ? 'Notifications are off' : unsupported ? 'Test the buzzer' : 'Hear the booking buzzer'}</strong>
          <p>
            {embedded
              ? 'This preview may suppress notification prompts and banners, but you can still test the buzzer sound here.'
              : blocked
                ? `Notifications are off for My Naai in ${browserLabel(detectBrowser())}. You can still test the in-page buzzer; alert banners need site notifications enabled.`
                : unsupported
                  ? 'This browser cannot show web alerts, but you can test the buzzer sound while this page is open.'
                  : 'Tap once to play the real My Naai buzzer — the sound a new booking request makes — plus the alert itself. No account needed. It rings while the app is open; with the app closed your phone plays the alert’s own sound and vibration.'}
          </p>
        </div>
        <button
          type="button"
          className="install-auth-button buzzer-test-button"
          onClick={test}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? <RefreshCw size={14} className="spin" /> : done ? <CheckCircle2 size={14} /> : <BellRing size={14} />}
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
      {!embedded && permission !== 'checking' && permission !== 'denied' && permission !== 'unsupported' && (
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
