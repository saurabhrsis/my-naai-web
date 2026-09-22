import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCircle2, ChevronDown, CircleAlert, Copy, MapPin, RefreshCw, Send, Settings } from 'lucide-react';
import { displayNotification, formatPushDiagnostics, getPushDiagnostics, getPushToken, isPushConfigured, notificationActionLimit, watchNotificationPermission } from '../lib/push';
import { playBuzzer, unlockBuzzer } from '../lib/buzzer';
import { browserLabel, detectBrowser, isEmbeddedFrame, isIosDevice, readPermission, rememberAskChoice, requestLocation, requestNotifications, ASK_CHOICES, siteHost } from '../lib/permissions';
import { PermissionSheet } from './PermissionUI';
import { api } from '../lib/api';
import { withDeviceToken } from '../lib/apiPayload';
import { readDeviceTokenSync, syncDeviceToken } from '../lib/deviceToken';
import { readLocalSession } from '../lib/session';
import { Button, Modal, Spinner, cx, getErrorMessage } from './Shared';

// Alerts & permissions — the calm home for the two permissions My Naai uses.
//
// This is where a user who said "Not now" (or was blocked by their browser)
// fixes things later, on their own terms: one row per permission, one tap per
// row, plain words, and no scolding. The technical report support may need lives
// behind "Support report" so the everyday view stays human — "notifications are
// not working" gets pinned to a specific layer, but nobody has to read it unless
// they want to send it to us.
export function NotificationDiagnostics({ onEnabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [report, setReport] = useState(null);
  const [alerts, setAlerts] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'));
  const [locationState, setLocationState] = useState('checking');
  const [sheet, setSheet] = useState({ open: false, state: 'needs-permission', kind: 'notifications' });
  const [testMessage, setTestMessage] = useState('');
  const reportRef = useRef(null);
  const onEnabledRef = useRef(onEnabled);
  onEnabledRef.current = onEnabled;

  const readStates = useCallback(async () => {
    const [notification, geo] = await Promise.all([readPermission('notifications'), readPermission('location')]);
    setAlerts(notification);
    setLocationState(geo);
    return { notification, geo };
  }, []);

  const run = useCallback(async () => {
    setBusy('run');
    try {
      setDiagnostics(await getPushDiagnostics());
      await readStates();
    } finally {
      setBusy('');
    }
  }, [readStates]);

  useEffect(() => { readStates(); }, [readStates]);
  // The technical report is collected the first time the panel is opened, so the
  // "Support report" button always has something to copy.
  useEffect(() => { if (open && !diagnostics && busy !== 'run') run(); }, [busy, diagnostics, open, run]);

  // Follow both permissions live: a switch flipped in the browser's own settings
  // updates this card the moment the browser reports it, and again on return.
  useEffect(() => watchNotificationPermission(() => { readStates(); }), [readStates]);
  // A device token that finishes in the background (the quiet retries in
  // lib/push.js) flips this card to "alerts are on" without a tap: the user
  // allowed notifications, so the rest is our job to finish.
  useEffect(() => {
    const onToken = () => {
      readStates();
      setDiagnostics(null);
    };
    window.addEventListener('mynaai:push-token', onToken);
    return () => window.removeEventListener('mynaai:push-token', onToken);
  }, [readStates]);
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      readStates();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [readStates]);

  const failing = (diagnostics?.checks || []).filter(check => check.state === 'fail');
  // `pushConfigured` false means this deployment has no Firebase web config: the
  // permission can still be granted, but nothing can be delivered until that is
  // set. Saying "alerts are on" there would be a lie.
  const pushConfigured = isPushConfigured();
  const alertsOn = alerts === 'granted';
  const alertsLive = alertsOn && pushConfigured;
  const locationOn = locationState === 'granted';
  const blocked = alerts === 'denied';
  const unsupported = alerts === 'unsupported';

  const turnOnAlerts = async () => {
    setBusy('alerts');
    try {
      const permission = await requestNotifications();
      if (permission === 'granted') {
        const token = await getPushToken({ requestPermission: false });
        if (token) {
          rememberAskChoice('notifications', ASK_CHOICES.allowed);
          // The server sends to the token it has on file — which, for an
          // account that allowed alerts AFTER signing in, is nothing. Hand it
          // the fresh token now, from this very tap.
          try { await syncDeviceToken(readLocalSession(), token, { force: true }); } catch { /* reported in the diagnostics card */ }
          onEnabledRef.current?.();
        } else {
          setSheet({ open: true, state: 'unavailable', kind: 'notifications' });
        }
      } else if (permission === 'denied') {
        setSheet({ open: true, state: 'denied', kind: 'notifications' });
      }
      await readStates();
      setDiagnostics(null);
    } finally {
      setBusy('');
    }
  };

  const turnOnLocation = async () => {
    setBusy('location');
    try {
      const result = await requestLocation();
      if (result.ok) {
        rememberAskChoice('location', ASK_CHOICES.allowed);
      } else if (result.state === 'denied') {
        setSheet({ open: true, state: 'denied', kind: 'location' });
      }
      await readStates();
    } finally {
      setBusy('');
    }
  };

  // Proof on THIS device that the alert banner + buzzer work. Tapping this button
  // is a user gesture, so the page is allowed to make a sound right here — which
  // is exactly what is being verified. The *time-critical* path (a booking
  // request arriving while the app is closed or in the background) is what an
  // end-to-end test has to prove, and the copy says so on the devices where the
  // browser, not the app, decides the sound.
  const testBuzzer = async () => {
    setBusy('test');
    try {
      unlockBuzzer();
      // A user-initiated ring: bypass the arrival gate deliberately (see
      // src/lib/buzzer.js — the gate only exists to stop late *deliveries*).
      playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1, manual: true });
      const shown = await displayNotification({
        title: 'Test alert — My Naai',
        body: 'This is how a booking request looks and sounds on this device.',
        data: { type: 'TEST' },
      });
      setTestMessage(!shown
        ? 'The buzzer played, but this browser would not show the alert banner — check the site notification setting.'
        : isIosDevice()
          // Safari locks the buzzer sound to the app being open. When the app is
          // closed, iOS plays the notification's own sound and vibration — which
          // is the alert a salon gets. Say it plainly instead of letting a
          // silent phone look like a broken buzzer.
          ? 'The buzzer played. On iPhone, this sound only plays while the app is open — with the app closed, iOS plays the alert\u2019s own sound and vibration.'
          : 'Test sent. Heard nothing? Turn the phone off silent and check the media volume.');
    } finally {
      setBusy('');
    }
  };

  // The real thing, end to end, without signing in: ask the API to push a test
  // notification to THIS browser's own device token. It arrives through the same
  // Firebase path a booking request uses — including while the app is in the
  // background or closed — so it is the only test that can prove the buzzer on
  // the device itself, and it needs no salon account.
  const sendTestPush = async () => {
    setBusy('push');
    try {
      const token = await getPushToken({ requestPermission: false });
      if (!token) {
        setTestMessage('This browser has no alert token yet — turn alerts on first, then tap Send test alert again.');
        return;
      }
      const response = await api.testPush(withDeviceToken({}, token));
      if (response?.status && response.status !== 'SUCCESS') {
        setTestMessage(getErrorMessage({ data: response }, 'The test alert could not be sent.'));
        return;
      }
      const alertCount = Number(response?.data?.notificationCount ?? response?.notification?.length ?? response?.data?.sent ?? 0);
      setTestMessage(alertCount === 0
        ? 'The server sent the test, but no device received it — check My Naai alerts in your phone settings.'
        : 'Test alert sent to this device. Lock the phone or switch apps and check that it buzzes when it arrives.');
    } catch (error) {
      setTestMessage(getErrorMessage(error, 'The test alert could not be sent right now.'));
    } finally {
      setBusy('');
    }
  };

  const buildReport = () => `My Naai web push report · ${new Date().toLocaleString('en-IN')}\n${formatPushDiagnostics(diagnostics)}`;

  // Clipboard access is refused in enough real situations (iOS Safari outside a
  // user gesture, an installed PWA resumed from the background, any non-secure
  // context) that a fallback is mandatory: an in-app sheet with a selectable
  // textarea — never `window.prompt`, which an installed PWA cannot style.
  const writeClipboard = async text => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (clipboardError) {
      console.debug('Clipboard write was blocked; falling back to a selectable report.', clipboardError);
    }
    try {
      const field = reportRef.current;
      if (field) {
        field.focus();
        field.select();
        field.setSelectionRange(0, field.value.length);
      }
      return typeof document.execCommand === 'function' && document.execCommand('copy') === true;
    } catch (legacyError) {
      console.debug('Legacy clipboard copy failed too.', legacyError);
      return false;
    }
  };

  const copyReport = async () => {
    if (await writeClipboard(buildReport())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
      return;
    }
    setReport(buildReport());
  };

  const copyFromSheet = async () => {
    if (await writeClipboard(report || '')) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  // What this particular device will do with an alert, in plain words, because
  // two real questions keep coming back: "how do I answer the notification on a
  // laptop?" and "why is there no sound when the app is closed?".
  //   · Buttons: a web notification renders only as many actions as the browser
  //     allows (Chromium on a laptop: 2, Android: 3, Safari: none). The app asks
  //     for `Notification.maxActions`, so what is shown here is what will show.
  //   · Sound: the Notifications standard has no custom-sound option — the phone
  //     or computer plays its own alert sound for the notification. With the app
  //     closed nothing of My Naai is running, so the buzzer file cannot play; the
  //     alert is re-raised twice inside the 60-second answer window so a missed
  //     first sound is not the only chance, and the OS silent switch / channel
  //     setting is what can mute it entirely.
  const deviceAlertNote = () => {
    const limit = notificationActionLimit();
    const buttons = limit >= 3
      ? 'Accept, Reject and Delay buttons appear in the alert.'
      : limit >= 2
        ? 'The alert shows Accept and Reject buttons; tap the alert itself to open the request and change the time.'
        : 'This browser shows no buttons in the alert — tap it to open the request and answer there.';
    const sound = isIosDevice()
      ? 'Sound comes from the alert itself (iPhone plays it with the app open or closed unless the phone is on silent).'
      : 'Sound comes from the alert itself, so the device volume and the browser\u2019s notification setting decide how loud it is.';
    return `${buttons} ${sound} With the app closed the alert repeats twice within the 60-second answer window.`;
  };

  const alertsSummary = alertsLive
    ? 'Alerts are on for this device'
    : alertsOn
      ? 'Notifications allowed — alerts not switched on yet'
      : blocked
      ? `Blocked in ${browserLabel(detectBrowser())}`
      : unsupported
        ? 'Not supported in this browser'
        : 'Off — turn them on in one tap';
  const locationSummary = locationOn
    ? 'On — salons sorted by distance'
    : locationState === 'denied'
      ? 'Off for this site — optional'
      : locationState === 'checking'
        ? 'Checking…'
        : 'Off — optional, shows distances';

  return (
    <section className={cx('account-card', 'notification-diagnostics', open && 'open')}>
      <button type="button" className="diagnostics-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="notification-diagnostics-body">
        <span className="account-menu-icon"><Bell size={18} /></span>
        <span className="diagnostics-heading">
          <strong>Alerts &amp; permissions</strong>
          <small>{alertsLive && locationOn ? 'Both on — you are all set' : alertsLive ? alertsSummary : `${alertsSummary}${locationOn ? '' : ' · Location optional'}`}</small>
        </span>
        {alertsLive
          ? <CheckCircle2 size={17} className="diagnostics-mark ok" />
          : blocked || unsupported
            ? <CircleAlert size={17} className="diagnostics-mark fail" />
            : <CircleAlert size={17} className="diagnostics-mark warn" />}
        <ChevronDown size={17} className="collapsible-chevron" />
      </button>

      {open && (
        <div className="diagnostics-body" id="notification-diagnostics-body">
          <div className="perm-row perm-row-account">
            <span className="perm-row-icon"><BellRing size={15} /></span>
            <div className="perm-row-copy">
              <strong>Booking alerts</strong>
              <p>{alertsLive
                ? 'On. Booking requests, confirmations, delay updates and the buzzer all reach this device.'
                : alertsOn
                  ? 'Notifications are allowed on this device. Booking alerts start as soon as My Naai switches them on — nothing else to do here.'
                : blocked ? `Blocked in ${siteHost()}'s ${browserLabel(detectBrowser())} settings — three taps to switch back on.`
                  : unsupported ? 'This browser cannot receive web alerts. Chrome, Edge, Samsung Internet — or the installed app on iPhone — can.'
                    : 'Booking requests, confirmations, delay updates and the buzzer.'}</p>
            </div>
            {alertsOn
              ? <span className="perm-state-on"><CheckCircle2 size={14} /> Allowed</span>
              : <button type="button" className="install-auth-button allow-alerts-button" onClick={blocked || unsupported ? () => setSheet({ open: true, state: blocked ? 'denied' : 'unsupported', kind: 'notifications' }) : turnOnAlerts} disabled={busy === 'alerts'}>
                {busy === 'alerts' ? <Spinner size={14} /> : blocked ? <Settings size={14} /> : <Bell size={14} />}
                {blocked ? 'How to allow' : 'Turn on'}
              </button>}
          </div>

          <div className="perm-row perm-row-account">
            <span className="perm-row-icon perm-row-icon-location"><MapPin size={15} /></span>
            <div className="perm-row-copy">
              <strong>Location</strong>
              <p>{locationOn
                ? 'On. Salons are sorted by distance for you.'
                : locationState === 'denied' ? 'Off for this site. Optional — it only shows how far each salon is.'
                  : 'Optional. Shows how far each salon is and puts the nearest first.'}</p>
            </div>
            {locationOn
              ? <span className="perm-state-on"><CheckCircle2 size={14} /> On</span>
              : <button type="button" className="install-auth-button perm-location-button" onClick={locationState === 'denied' ? () => setSheet({ open: true, state: 'denied', kind: 'location' }) : turnOnLocation} disabled={busy === 'location'}>
                {busy === 'location' ? <Spinner size={14} /> : <MapPin size={14} />}
                {locationState === 'denied' ? 'How to allow' : 'Turn on'}
              </button>}
          </div>

          {alertsLive && (
            <p className="diagnostics-note">
              {deviceAlertNote()}
            </p>
          )}
          {alertsLive && !failing.length && (
            <p className="diagnostics-note">Alerts are allowed in this browser. Missing one? Copy the support report below and we will trace it for you.</p>
          )}
          {testMessage && <p className="diagnostics-note">{testMessage}</p>}
          <div className="diagnostics-actions">
            {alertsLive && <Button size="small" variant="secondary" onClick={testBuzzer} loading={busy === 'test'}><BellRing size={14} /> Test buzzer</Button>}
            {alertsLive && <Button size="small" variant="secondary" onClick={sendTestPush} loading={busy === 'push'}><Send size={14} /> Send test alert</Button>}
            {pushConfigured && !alertsOn && <Button size="small" variant="secondary" onClick={run} loading={busy === 'run'}><RefreshCw size={14} /> Check again</Button>}
            <Button size="small" variant="secondary" onClick={copyReport}><Copy size={14} /> {copied ? 'Copied' : 'Support report'}</Button>
          </div>
          <p className="permission-help-note">Need a hand? Call <a href="tel:8380017393">8380017393</a> — we will turn it on with you.</p>
        </div>
      )}

      <PermissionSheet
        open={sheet.open}
        state={sheet.state}
        kind={sheet.kind}
        onClose={() => { setSheet(current => ({ ...current, open: false })); readStates(); }}
        onGranted={token => { if (token) onEnabledRef.current?.(); }}
      />

      <Modal
        open={Boolean(report)}
        onClose={() => setReport(null)}
        title="Copy the report"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReport(null)}>Close</Button>
            <Button onClick={copyFromSheet}>{copied ? 'Copied' : 'Copy report'}</Button>
          </>
        )}
      >
        <p className="modal-lede">This browser blocked the clipboard. Press and hold in the box below, choose <strong>Select All</strong>, then <strong>Copy</strong> — and send it to My Naai support.</p>
        <textarea
          ref={reportRef}
          className="report-textarea"
          rows={9}
          readOnly
          value={report || ''}
          aria-label="My Naai web push report"
          onFocus={event => event.target.select()}
        />
      </Modal>
    </section>
  );
}
