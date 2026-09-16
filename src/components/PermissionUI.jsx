// Every permission surface in one place: the one-tap rows on the login page,
// the "turn it on / fix it" sheet, the install guides and the Alerts &
// permissions card used by both Account screens.
//
// The rules these components follow (see src/lib/permissions.js for the why):
//   · an ask is always a labelled button the user can read first — never a
//     popup that fires while they were tapping something else;
//   · a blocked permission gets THREE short steps for the browser actually in
//     use, not a wall of text, and the sheet closes itself the moment the
//     browser reports the change;
//   · nothing here blocks sign-in. Alerts are offered, explained and always
//     recoverable; if the API ever insists on a deviceToken the sheet says so
//     plainly and retries the action for the user.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  MapPin,
  RefreshCw,
  RotateCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Volume2,
  X,
} from 'lucide-react';
import { Button, Modal, Spinner, cx, getErrorMessage } from './Shared';
import {
  ASK_CHOICES,
  androidAppNotificationHint,
  browserLabel,
  buzzerHint,
  detectBrowser,
  isEmbeddedFrame,
  promptsAvailable,
  isIosDevice,
  isIosPwaInstalled,
  isStandalone,
  permissionSteps,
  readAskChoice,
  readPermission,
  rememberAskChoice,
  requestLocation,
  requestNotifications,
  siteHost,
} from '../lib/permissions';
import { getPushStatus, getPushToken, isPushConfigured, watchNotificationPermission } from '../lib/push';

// The two permissions, side by side, each with ONE action. This is the whole
// login-page ask: the visitor reads one line, taps once, done. Nothing here can
// block sign-in — a "Not now" (or a browser block) simply leaves the row in a
// recoverable state and the form keeps working.
export function LoginPermissionCard({ onToken, onNotify, onDismiss, className = '' }) {
  const [alerts, setAlerts] = useState('checking');
  const [alertsReason, setAlertsReason] = useState('');
  const [location, setLocation] = useState('checking');
  const [busy, setBusy] = useState('');
  const [sheet, setSheet] = useState({ open: false, state: 'needs-permission', kind: 'notifications' });
  const [locationDismissed, setLocationDismissed] = useState(() => readAskChoice('location') === ASK_CHOICES.never);
  // "Not now" on the alerts sheet hides that row for the rest of this visit —
  // the login form keeps working and the visitor is not nagged. A new visit
  // offers it again, because a customer who books really does want the alerts.
  const [alertsSuppressed, setAlertsSuppressed] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const pushConfigured = isPushConfigured();
  const needsInstall = isIosDevice() && !isIosPwaInstalled();
  const embedded = isEmbeddedFrame();
  // Whether the browser can even show its own prompt on this page. Inside another
  // page's frame without an `allow` delegation it cannot — the browser reports
  // 'denied' instead, which must never be dressed up as "you blocked us".
  const alertsPromptable = promptsAvailable('notifications');
  const locationPromptable = promptsAvailable('location');

  const readAlerts = useCallback(async () => {
    // Alerts may not be wired into this build yet (no Firebase web config). The
    // *notification permission* is still exactly what the visitor can give, and
    // it is what this row exists for — so the row stays on the page, the button
    // opens the browser's own prompt, and the device is ready the moment booking
    // alerts go live. (Hiding the row here is why "the login page has no
    // notification permission" was reported.)
    if (!isPushConfigured()) {
      const permission = await readPermission('notifications');
      const state = permission === 'granted' ? 'enabled'
        : permission === 'unsupported' ? 'unsupported'
          : permission !== 'denied' ? 'needs-permission'
            // 'denied' while the browser is refusing to prompt at all in here is
            // not a block by the visitor.
            : alertsPromptable ? 'denied' : 'embedded';
      setAlerts(state);
      setAlertsReason('');
      return state;
    }
    try {
      const status = await getPushStatus();
      const state = status.state === 'denied' && !alertsPromptable ? 'embedded' : status.state;
      setAlerts(state);
      setAlertsReason(state === 'embedded' ? '' : status.reason || '');
      if (state === 'enabled' && status.token) onTokenRef.current?.(status.token);
      return state;
    } catch (error) {
      console.debug(getErrorMessage(error, 'Could not read the notification status.'));
      setAlerts('unavailable');
      return 'unavailable';
    }
  }, []);

  const readLocation = useCallback(async () => {
    const next = await readPermission('location');
    setLocation(next);
    return next;
  }, []);

  useEffect(() => { readAlerts(); readLocation(); }, [readAlerts, readLocation]);

  // Live updates: a row fixes itself the moment the user flips a setting in the
  // browser's own UI, and again when they come back to the tab.
  useEffect(() => watchNotificationPermission(() => { readAlerts(); }), [readAlerts]);
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      readAlerts();
      readLocation();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [readAlerts, readLocation]);

  // Alerts — the normal path: this tap IS the gesture the browser needs, so its
  // own Allow popup opens right here. Whatever the user answers, sign-in keeps
  // working; the row just reflects the answer.
  const allowAlerts = async () => {
    setBusy('alerts');
    try {
      // Embedded: no popup can ever appear in here, so the only useful action is
      // to get the visitor into a real tab (and the sheet if the browser blocks
      // that new tab).
      if (alerts === 'embedded') {
        if (!openInNewTab()) setSheet({ open: true, state: 'denied', kind: 'notifications' });
        return;
      }

      // The few states where a popup cannot possibly appear: the permission is
      // blocked, iOS needs the app on the Home Screen first, the page is inside
      // another page's frame, or the browser has no support at all. Those get the
      // sheet with the exact fix instead of a button that silently does nothing.
      if (alerts === 'denied' || embedded) {
        setSheet({ open: true, state: 'denied', kind: 'notifications' });
        return;
      }
      if (needsInstall) {
        setSheet({ open: true, state: 'needs-permission', kind: 'notifications' });
        return;
      }
      if (alerts === 'unsupported') {
        setSheet({ open: true, state: 'unsupported', kind: 'notifications' });
        return;
      }

      // Everything else — never asked yet, or a token that needs one more try —
      // asks the browser RIGHT HERE. This tap is the user gesture, and
      // requestNotifications() calls the browser API synchronously, so Safari
      // keeps the gesture and the Allow popup actually appears.
      const permission = await requestNotifications();
      if (permission === 'denied') {
        setAlerts('denied');
        setSheet({ open: true, state: 'denied', kind: 'notifications' });
        return;
      }
      if (permission !== 'granted') {
        setAlerts('needs-permission');
        return;
      }

      rememberAskChoice('notifications', ASK_CHOICES.allowed);
      if (!isPushConfigured()) {
        // Permission banked; no device token can be minted until booking alerts
        // are configured for this build. Nothing left to ask on this page.
        setAlerts('enabled');
        return;
      }
      const token = await getPushToken({ requestPermission: false });
      if (token) {
        onTokenRef.current?.(token);
        setAlerts('enabled');
        return;
      }
      // Allowed, but minting the token did not finish (a slow first worker):
      // keep the row so "Try again" can complete it.
      setAlerts('unavailable');
    } finally {
      setBusy('');
    }
  };

  const allowLocation = async () => {
    setBusy('location');
    try {
      const result = await requestLocation();
      rememberAskChoice('location', result.ok ? ASK_CHOICES.allowed : result.state === 'denied' ? ASK_CHOICES.blocked : ASK_CHOICES.later);
      setLocation(result.ok ? 'granted' : result.state === 'denied' ? 'denied' : 'default');
      if (result.ok) {
        onNotify?.('success', 'Location on — salons are now sorted by distance for you.');
      } else if (result.state === 'denied') {
        setSheet({ open: true, state: 'denied', kind: 'location' });
      }
    } finally {
      setBusy('');
    }
  };

  const dismissLocation = () => {
    rememberAskChoice('location', ASK_CHOICES.never);
    setLocationDismissed(true);
  };

  const alertsRowVisible = !alertsSuppressed && !['checking', 'enabled'].includes(alerts);
  const locationRowVisible = !locationDismissed && !['granted', 'checking', 'unsupported'].includes(location);
  if (!alertsRowVisible && !locationRowVisible) return null;

  const alertsCopy = {
    'needs-permission': {
      title: 'Notification permission',
      body: pushConfigured
        ? 'Tap Allow notifications — your browser asks once, and booking alerts arrive with the buzzer (sound + vibration).'
        : 'Tap Allow notifications — your browser asks once. My Naai uses it for booking alerts and the buzzer.',
    },
    denied: { title: 'Notifications are blocked', body: `Turn Notifications back on for ${siteHost()} in ${browserLabel(detectBrowser())}.` },
    embedded: {
      title: 'Notifications need their own tab',
      body: 'This page is open inside another app, where browsers hide the Allow prompt. Open My Naai in a tab — the login page there asks in one tap.',
    },
    unsupported: { title: 'Alerts need an install', body: needsInstall ? 'Add My Naai to your Home Screen — that is the only way iPhone allows alerts and the buzzer.' : 'This browser cannot receive web alerts, but you can still book normally.' },
    unavailable: { title: 'Alerts almost ready', body: alertsReason || 'The last setup step did not finish. Tap Try again — it usually works on the second try.' },
  }[alerts] || { title: 'Booking alerts', body: '' };

  return (
    <section className={cx('perm-card', className)} aria-live="polite">
      {alertsRowVisible && (
        <div className="perm-row">
          <span className="perm-row-icon"><BellRing size={15} /></span>
          <div className="perm-row-copy">
            <strong>{alertsCopy.title}</strong>
            <p>{alertsCopy.body}</p>
          </div>
          <button
            type="button"
            className={cx('install-auth-button', 'allow-alerts-button', alerts === 'denied' && 'allow-alerts-attention')}
            onClick={allowAlerts}
            disabled={busy === 'alerts'}
          >
            {busy === 'alerts'
              ? <Spinner size={14} />
              : alerts === 'denied' ? <CircleAlert size={14} />
                : alerts === 'embedded' ? <ExternalLink size={14} />
                  : alerts === 'unsupported' ? <Smartphone size={14} />
                    : alerts === 'unavailable' ? <RefreshCw size={14} /> : <Bell size={14} />}
            {alerts === 'denied' ? 'Fix alerts'
              : alerts === 'embedded' ? 'Open in a new tab'
                : alerts === 'unsupported' ? 'How to turn on'
                  : alerts === 'unavailable' ? 'Try again' : 'Allow notifications'}
          </button>
        </div>
      )}
      {locationRowVisible && (
        <div className="perm-row">
          <span className="perm-row-icon perm-row-icon-location"><MapPin size={15} /></span>
          <div className="perm-row-copy">
            <strong>{location === 'denied' ? 'Location is off' : 'Salons near me'}</strong>
            <p>{location === 'denied'
              ? locationPromptable
                ? 'Optional — turn Location on for this site to see how far each salon is.'
                : 'Optional — this page is open inside another app, where browsers hide the location prompt. Open My Naai in a tab to sort by distance.'
              : 'Optional — puts the nearest salons first. Skip it and browsing still works.'}</p>
          </div>
          <div className="perm-row-actions">
            <button type="button" className="install-auth-button perm-location-button" onClick={allowLocation} disabled={busy === 'location'}>
              {busy === 'location' ? <Spinner size={14} /> : <MapPin size={14} />}
              {location === 'denied' ? 'How to allow' : 'Allow location'}
            </button>
            <button type="button" className="perm-dismiss" onClick={dismissLocation} aria-label="Not now — do not ask again">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      <PermissionSheet
        open={sheet.open}
        state={sheet.state}
        kind={sheet.kind}
        onClose={() => {
          if (sheet.kind === 'notifications') {
            setAlertsSuppressed(true);
            // Tell the auth flow, so pressing Continue afterwards cannot pop the
            // browser prompt at somebody who just said "not now" — the exact
            // surprise that turns into a permanent Block.
            onDismissRef.current?.();
          }
          setSheet(current => ({ ...current, open: false }));
          readAlerts();
          readLocation();
        }}
        onGranted={token => {
          if (sheet.kind === 'location') setLocation('granted');
          else if (token) { onTokenRef.current?.(token); setAlerts('enabled'); }
        }}
      />
    </section>
  );
}

// Some states cannot be fixed in the page the visitor is looking at: inside
// another page's frame (a preview pane, an in-app browser) the browser will not
// show a permission popup at all. A real tab can, so this is the escape hatch both
// the card and the sheet use.
function openInNewTab() {
  try { return Boolean(window.open(window.location.href, '_blank', 'noopener')); } catch (error) {
    console.debug(getErrorMessage(error, 'Could not open My Naai in a new tab.'));
    return false;
  }
}

// The sheet that owns every "it did not work" state. One job per state, one
// primary action, and at most three short steps — a blocked permission cannot be
// re-asked from JavaScript, so the steps have to be exact, but they do not have
// to be a manual.
export function PermissionSheet({ open, onClose, onGranted, state: initialState = 'needs-permission', kind = 'notifications', required = false }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [extraHelp, setExtraHelp] = useState(false);
  const browser = detectBrowser();
  const label = browserLabel(browser);
  const isLocation = kind === 'location';
  const needsInstall = !isLocation && isIosDevice() && !isIosPwaInstalled();
  // A frame that was delegated the feature by its embedder is a normal page; one
  // that was not can never show the popup, and saying "switch it back on in
  // Chrome" there would be wrong.
  const embedded = !promptsAvailable(isLocation ? 'location' : 'notifications');

  useEffect(() => {
    if (open) {
      setState(initialState);
      setCheckFailed(false);
      setExtraHelp(false);
    }
  }, [open, initialState]);

  const readStatus = useCallback(async () => {
    if (isLocation) {
      const next = await readPermission('location');
      const mapped = next === 'denied' ? 'denied' : next === 'granted' ? 'granted' : 'needs-permission';
      setState(mapped);
      return { state: mapped, token: '' };
    }
    try {
      const status = await getPushStatus();
      setState(status.state);
      return status;
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not read the notification status.'));
      setState('unavailable');
      return { state: 'unavailable', token: '' };
    }
  }, [isLocation]);

  const succeed = useCallback(token => {
    if (isLocation) {
      onGranted?.('location');
      onClose?.();
      return;
    }
    if (token) {
      onGranted?.(token);
      onClose?.();
    }
  }, [isLocation, onClose, onGranted]);

  // The sheet follows the live permission: the moment the user flips the switch
  // in the browser (or the browser finally reports it), it re-reads and closes
  // itself on success — no Check tap needed.
  useEffect(() => {
    if (!open || isLocation) return undefined;
    return watchNotificationPermission(async () => {
      const status = await readStatus();
      if (status.state === 'enabled' && status.token) succeed(status.token);
    });
  }, [isLocation, open, readStatus, succeed]);

  const openStandalone = () => { openInNewTab(); };

  const allow = async () => {
    setBusy(true);
    try {
      if (isLocation) {
        const result = await requestLocation();
        if (result.ok) { succeed('location'); return; }
        setState(result.state === 'denied' ? 'denied' : 'needs-permission');
        await readStatus();
        return;
      }
      const permission = await requestNotifications();
      if (permission === 'granted') {
        const token = await getPushToken({ requestPermission: false });
        if (token) { succeed(token); return; }
      }
      await readStatus();
    } catch (askError) {
      console.debug(getErrorMessage(askError, 'Could not ask the browser for permission.'));
    } finally {
      setBusy(false);
    }
  };

  // One tap after the user flipped the setting in the browser's own settings.
  const check = async () => {
    setBusy(true);
    try {
      const status = await readStatus();
      if (isLocation) {
        if (status.state === 'granted') { succeed('location'); return; }
        if (status.state === 'needs-permission') {
          const result = await requestLocation();
          if (result.ok) { succeed('location'); return; }
        }
        setCheckFailed(true);
        return;
      }
      if (status.state === 'enabled' && status.token) { succeed(status.token); return; }
      if (status.state === 'needs-permission') {
        const token = await getPushToken({ requestPermission: true });
        if (token) { succeed(token); return; }
        await readStatus();
      }
      setCheckFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const permissionName = isLocation ? 'Location' : 'Notifications';
  let heading = isLocation ? 'Turn on location' : 'Turn on booking alerts';
  let lede = isLocation
    ? 'Location is optional. It only shows how far each salon is and puts the nearest first.'
    : 'Alerts bring booking requests, confirmations and delay updates — and the buzzer a salon needs to hear a customer waiting.';
  let body;

  if (needsInstall) {
    heading = 'Install My Naai to get alerts';
    lede = 'On iPhone, web notifications only work once My Naai is on your Home Screen. It takes about 20 seconds:';
    body = (
      <>
        <ol className="ios-install-steps permission-gate-steps">
          <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open My Naai from your Home Screen and tap <strong>Turn on alerts</strong>.</li>
        </ol>
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><Check size={16} /> I installed it — Check</Button>
        </div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </>
    );
  } else if (state === 'denied') {
    heading = isLocation ? 'Location is blocked' : 'Alerts are blocked';
    lede = embedded
      ? isLocation
        ? 'This page is open inside another app or page, so the browser will not show its location popup here. Open My Naai in its own tab to allow location:'
        : 'This page is open inside another app or page, so the browser will not show its Allow popup here. Open My Naai in its own tab to allow notifications:'
      : `Your browser only asks once, so this has to be switched back on in ${label}. It takes about 15 seconds:`;
    body = (
      <>
        {embedded ? (
          <ol className="ios-install-steps permission-gate-steps">
            <li>Tap <strong>Open My Naai in a new tab</strong> below.</li>
            <li>Tap <strong>{isLocation ? 'Allow location' : 'Allow notifications'}</strong> there and choose <strong>Allow</strong>.</li>
            <li>{isLocation ? 'Nearest-first sorting works from that tab.' : 'Sign in from that tab — alerts reach you there.'}</li>
          </ol>
        ) : (
          <>
            <ol className="ios-install-steps permission-gate-steps">
              {permissionSteps(browser, isLocation ? 'location' : 'notifications').map(step => <li key={step}>{step}</li>)}
            </ol>
            {!isLocation && (
              <>
                <p className="permission-help-note">{buzzerHint(browser)}</p>
                <button type="button" className="permission-help-link" onClick={() => setExtraHelp(help => !help)}>
                  {extraHelp ? 'Hide extra help' : 'Still blocked? Extra help'}
                </button>
                {extraHelp && (
                  <div className="permission-gate-warn">
                    <p>
                      The site must be exactly <strong>{siteHost()}</strong> and the setting must be <strong>Notifications</strong> — not Location.{androidAppNotificationHint(browser)} A reload also helps some browsers.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {checkFailed && (
          <div className="permission-gate-warn">
            <p>Still off. Switch {permissionName} back on for <strong>{siteHost()}</strong>, then tap <strong>Try again</strong>. A reload helps on some browsers.</p>
          </div>
        )}
        <div className="permission-gate-actions">
          {embedded
            ? <Button onClick={openStandalone}><ExternalLink size={16} /> Open My Naai in a new tab</Button>
            : <Button onClick={check} loading={busy}><Check size={16} /> I allowed it — Try again</Button>}
        </div>
        <div className="permission-gate-secondary">
          {embedded && <button className="ghost" onClick={check}>I allowed it — Check</button>}
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </>
    );
  } else if (state === 'needs-permission') {
    body = (
      <>
        <div className="permission-gate-benefits">
          {isLocation ? (
            <>
              <span><MapPin size={14} /> Nearest salons first, with real distances</span>
              <span><ShieldCheck size={14} /> Used only while you use the app — never stored on a map</span>
            </>
          ) : (
            <>
              <span><BellRing size={14} /> Booking requests and confirmations reach you instantly — even in the background</span>
              <span><Volume2 size={14} /> Buzzer sound + vibration for time-critical alerts</span>
              <span><Smartphone size={14} /> {buzzerHint(browser)}</span>
            </>
          )}
        </div>
        <div className="permission-gate-actions">
          <Button onClick={allow} loading={busy}>
            {isLocation ? <MapPin size={16} /> : <Bell size={16} />} {isLocation ? 'Allow location' : 'Allow notifications'}
          </Button>
        </div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={onClose}>Not now</button>
        </div>
      </>
    );
  } else {
    heading = 'One more tap';
    lede = 'The last step of the alert setup did not finish on this device. Try once more — it usually works on the second try.';
    body = (
      <>
        <div className="permission-gate-actions">
          {state === 'unsupported'
            ? <Button onClick={onClose}>Got it</Button>
            : <Button onClick={allow} loading={busy}><RefreshCw size={16} /> Try again</Button>}
        </div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </>
    );
  }

  return (
    <div className="permission-gate-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="permission-gate-sheet" role="dialog" aria-modal="true" aria-label={isLocation ? 'Location permission' : 'Notification permission'}>
        <span className="permission-gate-grip" />
        <div className="permission-gate-icon">
          {needsInstall ? <Smartphone size={26} /> : isLocation ? <MapPin size={26} /> : state === 'denied' ? <Settings size={26} /> : <BellRing size={26} />}
        </div>
        <span className="permission-gate-browser">{isLocation ? <MapPin size={12} /> : <Bell size={12} />} {label}</span>
        <h2>{heading}</h2>
        {lede && <p className="permission-gate-lede">{lede}</p>}
        {required && !needsInstall && (
          <p className="permission-gate-required"><CircleAlert size={14} /> Sign-in on this device has to finish with alerts on — it is how bookings reach you.</p>
        )}
        {body}
        {!isLocation && (
          <p className="permission-gate-note">
            Trouble turning alerts on? Call <a href="tel:8380017393">8380017393</a> and we will do it with you.
          </p>
        )}
      </div>
    </div>
  );
}

// Compact "turn alerts on" card for the salon registration steps. Same one-tap
// contract as the login card, without the location row.
export function NotificationSetupCard({ compact = false, onEnabled }) {
  const [status, setStatus] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reason, setReason] = useState('');
  const onEnabledRef = useRef(onEnabled);
  onEnabledRef.current = onEnabled;

  const inspect = useCallback(async () => {
    if (!isPushConfigured()) { setStatus('unconfigured'); return; }
    try {
      const result = await getPushStatus();
      setStatus(result.state);
      setReason(result.reason || '');
      if (result.state === 'enabled' && result.token) onEnabledRef.current?.(result.token);
    } catch (error) {
      console.debug(getErrorMessage(error, 'Could not check notification status.'));
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => { inspect(); }, [inspect]);
  useEffect(() => watchNotificationPermission(() => { inspect(); }), [inspect]);
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      inspect();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [inspect]);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await requestNotifications();
      if (permission === 'granted') {
        const token = await getPushToken({ requestPermission: false });
        if (token) onEnabledRef.current?.(token);
        await inspect();
        if (!token) setHelpOpen(true);
        return;
      }
      await inspect();
      if (permission === 'denied') setHelpOpen(true);
    } finally {
      setBusy(false);
    }
  };

  if (!isPushConfigured() || ['checking', 'unconfigured', 'enabled'].includes(status)) return null;
  const blocked = status === 'denied';
  const unavailable = status === 'unavailable' || status === 'unsupported';
  return (
    <section className={cx('push-setup-card', compact && 'push-setup-compact', unavailable && 'push-setup-retry')} aria-live="polite">
      <span className="push-setup-icon"><Bell size={compact ? 15 : 18} /></span>
      <div className="push-setup-copy">
        <strong>{blocked ? 'Booking alerts are blocked' : unavailable ? 'Booking alerts are not ready' : 'Turn on booking alerts'}</strong>
        <p>{blocked
          ? `Allow Notifications for ${siteHost()} in ${browserLabel(detectBrowser())} — three taps, then Check again.`
          : unavailable ? (reason || 'The last setup step did not finish — tap Try again.') : 'Booking requests, confirmations and the buzzer reach you only with alerts on.'}</p>
      </div>
      <div className="push-setup-actions">
        <Button size="small" onClick={blocked ? () => setHelpOpen(true) : enable} loading={busy}>
          {blocked ? <><Settings size={13} /> How to allow</> : unavailable ? <><RefreshCw size={13} /> Try again</> : <><Bell size={13} /> Allow alerts</>}
        </Button>
        {blocked && <button type="button" className="permission-help-link" onClick={enable}>Check again</button>}
      </div>
      <PermissionSheet
        open={helpOpen}
        state={blocked ? 'denied' : unavailable ? 'unavailable' : 'needs-permission'}
        onClose={() => { setHelpOpen(false); inspect(); }}
        onGranted={token => { if (token) onEnabledRef.current?.(token); }}
      />
    </section>
  );
}

// ── Install guides ───────────────────────────────────────────────────────────
export function IosInstallHelp({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Install My Naai on iPhone" footer={<Button onClick={onClose}>Got it</Button>}>
      <p className="modal-lede">iPhone only allows web notifications after My Naai is added to your Home Screen. It takes a few seconds:</p>
      <ol className="ios-install-steps">
        <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow) at the bottom of the screen.</li>
        <li>Scroll the menu and choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>, then open <strong>My Naai</strong> from your Home Screen.</li>
        <li>Tap <strong>Allow alerts</strong> and choose <strong>Allow</strong> when asked.</li>
      </ol>
      <p className="permission-help-note">Once installed, notifications and the buzzer work in the background just like the mobile app — on Safari and Chrome on iOS when opened from the Home Screen.</p>
    </Modal>
  );
}

const INSTALL_STEPS = {
  'chrome-android': [
    <>Tap the <strong>⋮ menu</strong> (top right).</>,
    <>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</>,
    <>Tap <strong>Add</strong> — done.</>,
  ],
  samsung: [
    <>Tap the <strong>≡ menu</strong> (bottom right).</>,
    <>Tap <strong>Add page to</strong> → <strong>Home screen</strong>.</>,
    <>Tap <strong>Add</strong> — done.</>,
  ],
  firefox: [
    <>Tap the <strong>⋮ menu</strong>.</>,
    <>Tap <strong>Install</strong> (or <strong>Add to Home screen</strong>).</>,
    <>Tap <strong>Add</strong> — done.</>,
  ],
  edge: [
    <>Tap the <strong>menu</strong> at the bottom.</>,
    <>Tap <strong>Add to phone</strong> → <strong>Home screen</strong>.</>,
    <>Tap <strong>Add</strong> — done.</>,
  ],
  opera: [
    <>Tap the <strong>menu</strong>.</>,
    <>Tap <strong>Home screen</strong>.</>,
    <>Tap <strong>Add</strong> — done.</>,
  ],
  'chrome-desktop': [
    <>Click the <strong>install icon</strong> at the right of the address bar — or the <strong>⋮ menu</strong> → <strong>Save &amp; share / Install My Naai</strong>.</>,
    <>Click <strong>Install</strong> — done.</>,
  ],
  'safari-desktop': [
    <>Choose <strong>File → Add to Dock</strong> (macOS Sonoma or later).</>,
  ],
  other: [
    <>Open the <strong>browser menu</strong>.</>,
    <>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</>,
  ],
};

export function InstallStepsHelp({ open, onClose }) {
  const browser = detectBrowser();
  const steps = INSTALL_STEPS[browser] || INSTALL_STEPS.other;
  return (
    <Modal open={open} onClose={onClose} title="Install My Naai" footer={<Button onClick={onClose}>Got it</Button>}>
      <p className="modal-lede">A few taps in {browserLabel(browser)}:</p>
      <ol className="ios-install-steps install-steps">{steps.map((step, index) => <li key={`${browser}-${index + 1}`}>{step}</li>)}</ol>
      <p className="permission-help-note">Once installed: full-screen app, one-tap launch, and booking alerts with the buzzer even when the browser is closed.</p>
    </Modal>
  );
}

// The guest shell and login page always offer a way to install — install UI
// hidden until `beforeinstallprompt` meant most first-time mobile visitors never
// saw the easiest route to background alerts. Already installed → nothing.
export function InstallAppButton({ onInstall = null }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [standalone, setStandaloneState] = useState(() => isStandalone());
  useEffect(() => {
    const check = () => setStandaloneState(isStandalone());
    window.addEventListener('pwa-installed', check);
    window.addEventListener('appinstalled', check);
    return () => {
      window.removeEventListener('pwa-installed', check);
      window.removeEventListener('appinstalled', check);
    };
  }, []);
  if (standalone) return null;
  const open = () => { if (onInstall) onInstall(); else setHelpOpen(true); };
  return (
    <>
      <button type="button" className="install-auth-button install-login-button" onClick={open}>
        <Download size={14} /> Install app
      </button>
      {isIosDevice() && !isIosPwaInstalled()
        ? <IosInstallHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        : <InstallStepsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />}
    </>
  );
}
