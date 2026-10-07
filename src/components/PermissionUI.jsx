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
  Copy,
  Download,
  ExternalLink,
  MapPin,
  RefreshCw,
  RotateCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Volume2,
} from 'lucide-react';
import { Button, Modal, Spinner, cx, getErrorMessage } from './Shared';
import {
  ASK_CHOICES,
  alertsPromptFallback,
  androidAppNotificationHint,
  browserLabel,
  buzzerHint,
  canAskForAlerts,
  clearPendingAsk,
  detectBrowser,
  detectInAppBrowser,
  hiddenPromptHint,
  inAppBrowserHint,
  openInOwnTabForAsk,
  pendingAskKind,
  promptsAvailable,
  isIosDevice,
  isIosPwaInstalled,
  isStandalone,
  permissionSteps,
  ALERTS_UNCONFIGURED_MESSAGE,
  readPermission,
  rememberAskChoice,
  requestLocation,
  requestNotifications,
  siteHost,
  watchPermission,
} from '../lib/permissions';
import { formatPushDiagnostics, getPushDiagnostics, getPushStatus, getPushToken, isPushConfigured, watchNotificationPermission } from '../lib/push';

// Compact login rows call the browser's permission API directly from each Allow
// tap, so the browser — not My Naai — owns the popup. When it cannot produce one
// (a block, an iPhone tab, a page inside another page), the same tap opens the
// unblock guide rather than dying in silence: a denied permission can never be
// re-asked from JavaScript, so the steps ARE the recovery.
export function LoginPermissionCard({ onToken, onNotify, onDismiss, className = '' }) {
  const [alerts, setAlerts] = useState('checking');
  const [location, setLocation] = useState('checking');
  const [busy, setBusy] = useState('');
  const [permissionNotice, setPermissionNotice] = useState('');
  // The tap that produced no browser popup opens the same guide the Account
  // screen uses: three exact steps for the browser in front of them, a Try
  // again that re-reads the setting, and it closes itself once the block is
  // lifted. Before this, a visitor who had blocked alerts only got one line of
  // small print — and the only way forward was hunting through browser
  // settings, which is what "it does nothing" really meant.
  const [guide, setGuide] = useState({ open: false, kind: 'notifications', state: 'needs-permission' });
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Whether the browser can even show its own prompt on this page. Inside another
  // page's frame without an `allow` delegation it cannot — the browser reports
  // 'denied' instead, which must never be dressed up as "you blocked us".
  const alertsPromptable = promptsAvailable('notifications');
  const locationPromptable = promptsAvailable('location');
  // Inside another app's WebView (WhatsApp, Instagram, Facebook …) the location
  // ask still works but no notification prompt can ever appear: the API is
  // missing or answers 'denied' instantly. The row stays on the page so the
  // visitor gets that explained instead of a button that silently does nothing.
  const inAppBrowser = detectInAppBrowser();
  // An iPhone/iPad tab cannot ask for web notifications at all: iOS gives them
  // only to an app on the Home Screen. Tapping Allow there would spend the tap on
  // a call the OS answers 'denied' without showing anything, and the reply can
  // even stick — so this visitor gets the Home Screen step, not a dead button.
  // (Location is unaffected, which is why "location asked but notifications did
  // not" is an iPhone report.)
  const alertsNeedHomeScreen = isIosDevice() && !isIosPwaInstalled();

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
      return state;
    }
    try {
      const status = await getPushStatus();
      const state = status.state === 'denied' && !alertsPromptable ? 'embedded' : status.state;
      setAlerts(state);
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
    // Safari and several mobile browsers do not expose a live location setting
    // through the Permissions API, so an empty answer says nothing. Preserve
    // what we actually observed: a denial from getCurrentPosition must not turn
    // back into "Allow" on focus — and a fix that worked must not lose its
    // grant and put the row back on the page either.
    setLocation(current => {
      if (next === 'granted') return 'granted';
      if (['denied', 'device-settings'].includes(current) && next === 'default') return current;
      if (current === 'granted' && next === 'default') return 'granted';
      return next;
    });
    return next;
  }, []);

  useEffect(() => { readAlerts(); readLocation(); }, [readAlerts, readLocation]);

  // Live updates: a row fixes itself the moment the user flips a setting in the
  // browser's own UI, and again when they come back to the tab.
  useEffect(() => watchNotificationPermission(() => { readAlerts(); }), [readAlerts]);
  // A device token that finishes later (the quiet retries in lib/push.js) is
  // handed straight to the parent, and the row stays gone.
  useEffect(() => {
    const onToken = event => {
      const token = event?.detail?.token;
      if (!token) return;
      onTokenRef.current?.(token);
      setAlerts('enabled');
    };
    window.addEventListener('mynaai:push-token', onToken);
    return () => window.removeEventListener('mynaai:push-token', onToken);
  }, []);
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

  // Each Allow tap calls the browser API directly, so the browser — not My Naai
  // — owns the popup. When it answers with a block (or cannot ask here at all),
  // the tap opens the unblock guide instead of dying: a denied permission can
  // never be re-asked from JavaScript, so the three steps ARE the recovery, and
  // leaving them out is what made the button look broken.
  const openGuide = useCallback((kind, state) => setGuide({ open: true, kind, state }), []);

  const closeGuide = useCallback(() => {
    setGuide(current => ({ ...current, open: false }));
    // Coming back from the guide is exactly when a switch flipped in the
    // browser's own settings becomes visible.
    readAlerts();
    readLocation();
  }, [readAlerts, readLocation]);

  // A permission the guide finished: bank the token and re-read both rows so the
  // page can never keep asking for something the visitor just allowed.
  const guideGranted = useCallback(value => {
    if (value === 'location') setLocation('granted');
    else if (value) onTokenRef.current?.(value);
    readAlerts();
    readLocation();
  }, [readAlerts, readLocation]);

  // The one line for a page that lives inside another page: name the fix (open
  // My Naai in its own tab), not only the failure — "try the live site" is
  // useless to somebody whose live site is the page that is embedded.
  const frameNotice = kind => `This page is open inside another page, so the browser cannot show the ${kind} prompt here. Open My Naai in its own browser tab, then tap Allow there.`;

  // Which view the guide opens on when no popup can appear in this context.
  // Each branch is a different real cause — never a generic one.
  const alertsGuideState = () => {
    if (inAppBrowser) return 'unsupported'; // names the app: open in a real browser
    if (alertsNeedHomeScreen) return 'needs-permission'; // iPhone tab → install gate
    if (!alertsPromptable) return 'denied'; // cross-origin frame → the embedded view
    return 'unsupported'; // no Notification API here at all
  };

  const allowAlerts = async () => {
    setBusy('alerts');
    setPermissionNotice('');
    try {
      if (!canAskForAlerts()) {
        // A page inside another page can never show a popup, so the tap opens
        // My Naai in a top-level tab — where the browser DOES show one — instead
        // of spending itself on a call that silently fails. One short line, one
        // real popup.
        if (!alertsPromptable && !inAppBrowser && !alertsNeedHomeScreen) {
          setPermissionNotice(openInOwnTabForAsk('notifications')
            ? 'New tab opened — choose Allow in the browser popup there.'
            : `Allow pop-ups for ${siteHost()} to open My Naai in its own tab, then tap Allow.`);
          onDismissRef.current?.();
          return;
        }
        // No popup exists in this context (iPhone tab, an app's WebView, no
        // Notification API): say what to do instead. Never a fake "you blocked us".
        if (alertsNeedHomeScreen) setAlerts('needs-permission');
        setPermissionNotice(alertsPromptFallback());
        openGuide('notifications', alertsGuideState());
        onDismissRef.current?.();
        return;
      }
      const permission = await requestNotifications();
      if (permission === 'denied') {
        // A denied setting cannot produce another native prompt, so the tap
        // hands the visitor the way back: three steps for the browser in front
        // of them, plus — on Android — the browser APP's own notification
        // switch, which keeps the site setting stuck at Blocked until it is on
        // (Android 13+ and OEM builds). Android users hit exactly this: they tap
        // Allow, no popup can appear, and nothing says why.
        setAlerts(alertsPromptable ? 'denied' : 'embedded');
        setPermissionNotice(inAppBrowser
          ? inAppBrowserHint(inAppBrowser)
          : !alertsPromptable
            ? frameNotice('notifications')
            : `Change Notifications in browser site settings to try again.${androidAppNotificationHint()}`);
        if (alertsPromptable) rememberAskChoice('notifications', ASK_CHOICES.blocked);
        // In a frame this block is the frame's doing, not the visitor's: open a
        // tab that can actually show the popup (the guide has the same button).
        if (!alertsPromptable) {
          setPermissionNotice(openInOwnTabForAsk('notifications')
            ? 'New tab opened — choose Allow in the browser popup there.'
            : `Allow pop-ups for ${siteHost()} to open My Naai in its own tab, then tap Allow.`);
          onDismissRef.current?.();
          return;
        }
        openGuide('notifications', 'denied');
        onDismissRef.current?.();
        return;
      }
      if (permission !== 'granted') {
        setAlerts(permission === 'unsupported' ? 'unsupported' : 'needs-permission');
        if (inAppBrowser) setPermissionNotice(inAppBrowserHint(inAppBrowser));
        else if (!alertsPromptable) setPermissionNotice(frameNotice('notifications'));
        // A tapped Allow that ends with no popup and no denial is the quieter-UI
        // case (Chromium answers silently and parks the decision behind the bell
        // icon), so name where the switch actually is — and offer a fresh,
        // labelled Allow of our own, which is a new gesture the browser accepts.
        else if (permission !== 'unsupported') setPermissionNotice(hiddenPromptHint());
        openGuide('notifications', permission === 'unsupported' ? 'unsupported' : 'needs-permission');
        // If the visitor dismissed the native prompt, Continue must not surprise
        // them by asking again during sign-in.
        onDismissRef.current?.();
        return;
      }
      setPermissionNotice('');

      rememberAskChoice('notifications', ASK_CHOICES.allowed);
      if (!isPushConfigured()) {
        setAlerts('enabled');
        return;
      }
      setAlerts('enabled');
      const token = await getPushToken({ requestPermission: false });
      if (token) onTokenRef.current?.(token);
    } finally {
      setBusy('');
    }
  };

  const allowLocation = async () => {
    setBusy('location');
    setPermissionNotice('');
    try {
      // requestLocation calls getCurrentPosition synchronously from this tap;
      // the browser—not an app sheet—owns the permission prompt.
      const result = await requestLocation();
      setLocation(result.ok ? 'granted' : result.state === 'denied' ? 'denied' : result.state === 'device-settings' ? 'device-settings' : result.state === 'unsupported' ? 'unsupported' : 'default');
      if (result.ok) {
        onNotify?.('success', 'Location on — salons are now sorted by distance for you.');
        return;
      }
      if (!locationPromptable) {
        setPermissionNotice(openInOwnTabForAsk('location')
          ? 'New tab opened — choose Allow in the location popup there.'
          : `Allow pop-ups for ${siteHost()} to open My Naai in its own tab, then tap Allow.`);
        return;
      }
      setPermissionNotice('Change Location in browser site settings to try again.');
      // Blocked at the site (code 1), blocked at the device (code 2: Android
      // Location off or the app denied a fix) or simply unavailable — each has
      // its own three steps, and a tap that ends in none of them is the dead
      // button a visitor cannot recover from.
      openGuide('location', result.state === 'denied' ? 'denied'
        : result.state === 'device-settings' ? 'device-settings'
          : result.state === 'unsupported' ? 'unsupported'
            : 'needs-permission');
    } finally {
      setBusy('');
    }
  };

  // A WebView has no Notification API at all, so the state reads 'unsupported' —
  // keep the row for exactly that case, because the visitor's fix (open a real
  // browser) is a sentence this row can carry.
  const alertsRowVisible = !['checking', 'enabled'].includes(alerts)
    && (alerts !== 'unsupported' || Boolean(inAppBrowser));
  const locationRowVisible = !['granted', 'checking', 'unsupported'].includes(location);
  if (!alertsRowVisible && !locationRowVisible) return null;

  // Keep the login surface neutral and compact in every permission state.
  const alertsUnavailable = alerts === 'unavailable';
  const alertsTitle = alertsUnavailable ? 'Alerts allowed' : 'Notifications';
  const alertsAction = alertsUnavailable ? 'Try again' : alerts === 'unsupported' ? 'How' : 'Allow';
  const locationTitle = 'Location';

  return (
    <section className={cx('perm-card', className)} aria-live="polite">
      {alertsRowVisible && (
        <div className="perm-row">
          <span className="perm-row-icon"><BellRing size={15} /></span>
          <div className="perm-row-copy">
            <strong>{alertsTitle}</strong>
          </div>
          <button
            type="button"
            className={cx('install-auth-button', 'allow-alerts-button')}
            onClick={allowAlerts}
            disabled={busy === 'alerts'}
            aria-busy={busy === 'alerts'}
            aria-label={alertsUnavailable ? 'Try notification setup again' : alerts === 'unsupported' ? 'How to turn on notifications' : 'Allow notifications'}
          >
            {busy === 'alerts' ? <Spinner size={14} /> : alertsAction}
          </button>
        </div>
      )}
      {locationRowVisible && (
        <div className="perm-row">
          <span className="perm-row-icon perm-row-icon-location"><MapPin size={15} /></span>
          <div className="perm-row-copy">
            <strong>{locationTitle}</strong>
          </div>
          <div className="perm-row-actions">
            <button
              type="button"
              className="install-auth-button perm-location-button"
              onClick={allowLocation}
              disabled={busy === 'location'}
              aria-busy={busy === 'location'}
              aria-label="Allow location"
            >
              {busy === 'location' ? <Spinner size={14} /> : 'Allow'}
            </button>
          </div>
        </div>
      )}
      {permissionNotice && <p className="perm-card-note" role="status">{permissionNotice}</p>}
      <PermissionSheet
        open={guide.open}
        kind={guide.kind}
        state={guide.state}
        onClose={closeGuide}
        onGranted={guideGranted}
      />
    </section>
  );
}

// The sheet that owns every "it did not work" state. One job per state, one
// primary action, and at most three short steps — a blocked permission cannot be
// re-asked from JavaScript, so the steps have to be exact, but they do not have
// to be a manual.
export function PermissionSheet({ open, onClose, onGranted, state: initialState = 'needs-permission', kind = 'notifications', required = false }) {
  const [state, setState] = useState(initialState === 'unavailable' ? 'finishing' : initialState);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  // null = not tried, true = the tab opened, false = the browser blocked it.
  const [embeddedTabOpen, setEmbeddedTabOpen] = useState(null);
  const [extraHelp, setExtraHelp] = useState(false);
  // Every "Try again" tap stamps the time and refreshes the reason, so a retry
  // that still fails never looks like a dead button that "did nothing".
  const [lastChecked, setLastChecked] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [reportText, setReportText] = useState('');
  const browser = detectBrowser();
  const label = browserLabel(browser);
  const isLocation = kind === 'location';
  const needsInstall = !isLocation && isIosDevice() && !isIosPwaInstalled();
  // A frame that was delegated the feature by its embedder is a normal page; one
  // that was not can never show the popup, and saying "switch it back on in
  // Chrome" there would be wrong.
  const embedded = !promptsAvailable(isLocation ? 'location' : 'notifications');
  const embeddedGate = embedded && !needsInstall && ['denied', 'needs-permission'].includes(state);

  useEffect(() => {
    if (open) {
      // 'unavailable' means the permission IS granted and the leftover work is
      // ours — that is the "finishing" state, never a blocked-looking one.
      setState(initialState === 'unavailable' ? 'finishing' : initialState);
      setReason('');
      setCheckFailed(false);
      setEmbeddedTabOpen(null);
      setExtraHelp(false);
      setLastChecked(null);
      setReportCopied(false);
      setReportText('');
    }
  }, [open, initialState]);

  const readStatus = useCallback(async () => {
    if (isLocation) {
      const next = await readPermission('location');
      const mapped = next === 'denied' ? 'denied' : next === 'granted' ? 'granted' : 'needs-permission';
      setState(mapped);
      return { state: mapped, token: '' };
    }
    // A build with no Firebase config cannot mint a token, but the browser
    // permission is still exactly what the visitor can give — so read it here
    // instead of letting "not switched on for this build" swallow a real block.
    // That difference is "here is how to unblock it" versus "nothing else to do
    // here", and only one of those is true.
    if (!isPushConfigured()) {
      const permission = await readPermission('notifications');
      const mapped = permission === 'granted' ? 'unconfigured'
        : permission === 'denied' ? 'denied'
          : permission === 'unsupported' ? 'unsupported'
            : 'needs-permission';
      setState(mapped);
      setReason(mapped === 'unconfigured' ? ALERTS_UNCONFIGURED_MESSAGE : '');
      return { state: mapped, token: '' };
    }
    try {
      const status = await getPushStatus();
      const mapped = status.state === 'unavailable' ? 'finishing' : status.state;
      setState(mapped);
      setReason(status.reason || '');
      return { ...status, state: mapped };
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not read the notification status.'));
      setState('finishing');
      setReason('');
      return { state: 'finishing', token: '' };
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
    if (!open) return undefined;
    if (isLocation) {
      // Watching the live setting means a block lifted in the browser's own
      // settings closes this sheet by itself — nobody has to tap anything.
      return watchPermission('location', async () => {
        const status = await readStatus().catch(() => null);
        if (status?.state === 'granted') succeed('location');
      });
    }
    return watchNotificationPermission(async () => {
      const status = await readStatus();
      if (status.state === 'enabled' && status.token) succeed(status.token);
    });
  }, [isLocation, open, readStatus, succeed]);

  // Coming back to the app is the moment a permission flipped in the browser's
  // own UI (or one the browser was slow to report) becomes visible: re-read and
  // close on success, exactly like the cards do.
  useEffect(() => {
    if (!open) return undefined;
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      readStatus().then(status => {
        // Location only ever closes on success: a browser that cannot report a
        // block through the Permissions API must never downgrade a real
        // "blocked" view back to "Allow location".
        if (isLocation) {
          if (status.state === 'granted') succeed('location');
          return;
        }
        if (status.state === 'enabled' && status.token) succeed(status.token);
      }).catch(() => {});
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [isLocation, open, readStatus, succeed]);

  // The background token retry in lib/push.js finishing: close this sheet by
  // itself, with no tap from the user.
  useEffect(() => {
    if (!open || isLocation) return undefined;
    const onToken = event => {
      const token = event?.detail?.token;
      if (token) succeed(token);
    };
    window.addEventListener('mynaai:push-token', onToken);
    return () => window.removeEventListener('mynaai:push-token', onToken);
  }, [isLocation, open, succeed]);

  // Copy the same nine-check report the Account card offers, so a visitor who
  // is stuck *before* sign-in can still send support something pinnable to a
  // layer. Falls back to an on-screen selectable report when the clipboard
  // refuses (iOS Safari outside a gesture, installed PWAs, non-secure contexts).
  const copySupportReport = async () => {
    if (isLocation) return;
    setReportBusy(true);
    try {
      let diagnostics = null;
      try {
        diagnostics = await getPushDiagnostics();
      } catch (diagnosticsError) {
        console.debug(getErrorMessage(diagnosticsError, 'Could not build the support report.'));
      }
      const text = diagnostics
        ? `My Naai web push report · ${new Date().toLocaleString('en-IN')}\n${formatPushDiagnostics(diagnostics)}`
        : `My Naai web push report · ${new Date().toLocaleString('en-IN')}\nSheet state: ${state}\nReason: ${reason || '(none)'}\nBrowser: ${label}\n`;
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (clipboardError) {
        console.debug('Clipboard write was blocked; showing the report instead.', clipboardError);
      }
      if (copied) {
        setReportCopied(true);
        setReportText('');
        window.setTimeout(() => setReportCopied(false), 2200);
      } else {
        setReportText(text);
      }
    } finally {
      setReportBusy(false);
    }
  };

  const allow = async () => {
    setBusy(true);
    try {
      if (isLocation) {
        const result = await requestLocation();
        if (result.ok) { succeed('location'); return; }
        if (result.state === 'device-settings') {
          setState('device-settings');
          setCheckFailed(false);
          setLastChecked(new Date());
          return;
        }
        setState(result.state === 'denied' ? 'denied' : 'needs-permission');
        await readStatus();
        return;
      }
      // Gesture-safe: requestNotifications() calls the browser API
      // synchronously, and this handler awaits nothing before it — so Safari
      // keeps the tap gesture and the Allow popup actually appears.
      const permission = await requestNotifications();
      if (permission === 'granted') {
        // The user just tapped Allow. Whatever happens next is our side of the
        // job (minting the device token) — say "finishing", never "still off".
        setState('finishing');
        setCheckFailed(false);
        setLastChecked(new Date());
        const token = await getPushToken({ requestPermission: false });
        if (token) { succeed(token); return; }
        // Refresh the human reason so the finishing view names the real cause
        // (offline, rejected key, worker that will not start) instead of going
        // quiet. The background retries in lib/push.js still close this sheet
        // through `mynaai:push-token` the moment the token lands.
        try {
          const fresh = await getPushStatus();
          if (fresh?.reason) setReason(fresh.reason);
        } catch (reasonError) {
          console.debug(getErrorMessage(reasonError, 'Could not refresh the alert status.'));
        }
        setLastChecked(new Date());
        return;
      }
      await readStatus();
      setLastChecked(new Date());
    } catch (askError) {
      console.debug(getErrorMessage(askError, 'Could not ask the browser for permission.'));
    } finally {
      setBusy(false);
    }
  };

  // One tap after the user flipped the setting in the browser's own settings —
  // or after a token mint failed and they want it retried. Every path ends with
  // visible feedback (a new state, a refreshed reason, a timestamp): a "Try
  // again" that silently returns to the same pixels is the "not getting any"
  // report this function exists to prevent.
  const check = async () => {
    setBusy(true);
    try {
      // The iPhone install gate is synchronous — answer it before any async
      // work, and say so out loud instead of spinning and landing nowhere.
      if (!isLocation && isIosDevice() && !isIosPwaInstalled()) {
        setCheckFailed(true);
        setLastChecked(new Date());
        return;
      }
      const status = await readStatus();
      setLastChecked(new Date());
      if (isLocation) {
        if (status.state === 'granted') { succeed('location'); return; }
        if (status.state === 'needs-permission') {
          const result = await requestLocation();
          if (result.ok) { succeed('location'); return; }
          if (result.state === 'device-settings') {
            setState('device-settings');
            setCheckFailed(true);
            return;
          }
          await readStatus();
        }
        setCheckFailed(true);
        return;
      }
      if (status.state === 'enabled' && status.token) { succeed(status.token); return; }
      if (status.state === 'needs-permission') {
        // The awaits above already spent the tap gesture, so asking the browser
        // here would never show a popup on Safari — it would just look like
        // another dead "Try again". Show the Allow view instead: its button is
        // a fresh gesture and the popup opens from there.
        setState('needs-permission');
        setCheckFailed(true);
        return;
      }
      if (status.state === 'finishing') {
        // Notifications are allowed — the token is what failed. "Still off,
        // switch Notifications back on" would send somebody who already
        // allowed alerts hunting through settings that are already correct.
        const token = await getPushToken({ requestPermission: false });
        if (token) { succeed(token); return; }
        try {
          const fresh = await getPushStatus();
          if (fresh?.reason) setReason(fresh.reason);
        } catch (reasonError) {
          console.debug(getErrorMessage(reasonError, 'Could not refresh the alert status.'));
        }
        setState('finishing');
        setCheckFailed(false);
        setLastChecked(new Date());
        return;
      }
      // denied / unconfigured / unsupported / anything else: stay on the honest
      // view for that state and flag that the re-check changed nothing, so the
      // view can say what to do next instead of going quiet.
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
  const lastCheckedLine = lastChecked
    ? `Last checked ${lastChecked.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} — tap Try again any time.`
    : '';
  const reportBlock = !isLocation && (reportText || reportCopied) && (
    <div className="permission-gate-report">
      {reportCopied && <p className="permission-gate-report-copied"><Check size={14} /> Report copied — paste it into WhatsApp or email to support.</p>}
      {reportText && (
        <>
          <p>This browser blocked the clipboard — press and hold below, choose <strong>Select All</strong>, then <strong>Copy</strong>:</p>
          <textarea className="report-textarea" rows={6} readOnly value={reportText} aria-label="My Naai web push report" onFocus={event => event.target.select()} />
        </>
      )}
    </div>
  );

  if (embeddedGate) {
    heading = isLocation ? 'Allow location' : 'Allow notifications';
    // One short line and one button that produces the real popup. A page inside
    // another page can never show the browser's own prompt, so the only useful
    // action is a top-level tab — and three paragraphs about the frame are not
    // an action.
    lede = `This page cannot show the ${isLocation ? 'location' : 'notifications'} prompt — browsers only allow it on a page that is not inside another one.`;
    body = (
      <>
        <div className="permission-gate-actions">
          <Button onClick={() => setEmbeddedTabOpen(openInOwnTabForAsk(isLocation ? 'location' : 'notifications'))} loading={busy}>
            <ExternalLink size={16} /> Open a new tab and allow
          </Button>
        </div>
        {embeddedTabOpen === true && <p className="permission-help-note permission-gate-inline-note" role="status">New tab opened — choose <strong>Allow</strong> in the browser popup there.</p>}
        {embeddedTabOpen === false && <p className="permission-help-note permission-gate-inline-note" role="status">Your browser blocked the new tab. Allow pop-ups for {siteHost()} and tap again.</p>}
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={allow} disabled={busy}>Try in this page anyway</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </>
    );
  } else if (needsInstall) {
    heading = 'Install My Naai to get alerts';
    lede = 'On iPhone, web notifications only work once My Naai is on your Home Screen. It takes about 20 seconds:';
    body = (
      <>
        <ol className="ios-install-steps permission-gate-steps">
          <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open My Naai from your Home Screen and tap <strong>Turn on alerts</strong>.</li>
        </ol>
        {checkFailed && (
          <div className="permission-gate-warn">
            <p>Still not installed — this check runs in {label}, but the alerts live in the Home Screen app. Open <strong>My Naai from your Home Screen</strong> (not Safari) and sign in from there. If you just installed it, close Safari completely and look for the My Naai icon.</p>
          </div>
        )}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><Check size={16} /> I installed it — Check</Button>
        </div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </>
    );
  } else if (state === 'device-settings' && isLocation) {
    heading = 'Location services are off';
    lede = 'This phone returned no location fix. On OPPO, Vivo and newer Android devices, the browser can have site access while Android still blocks the device-level location service:';
    body = (
      <>
        <ol className="ios-install-steps permission-gate-steps">
          {permissionSteps(browser, 'location').map(step => <li key={step}>{step}</li>)}
        </ol>
        {checkFailed && <div className="permission-gate-warn"><p>Location is still unavailable. Turn on Location for the app and come back, then tap <strong>Try again</strong>.</p></div>}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions"><Button onClick={check} loading={busy}><Check size={16} /> I turned it on — Try again</Button></div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </>
    );
  } else if (state === 'denied') {
    heading = isLocation ? 'Location is blocked' : 'Alerts are blocked';
    lede = `Your browser only asks once, so this has to be switched back on in ${label}. It takes about 15 seconds:`;
    body = (
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
        {checkFailed && (
          <div className="permission-gate-warn">
            <p>Still off. Switch {permissionName} back on for <strong>{siteHost()}</strong>, then tap <strong>Try again</strong>. A reload helps on some browsers.</p>
          </div>
        )}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><Check size={16} /> I allowed it — Try again</Button>
        </div>
        <div className="permission-gate-secondary">
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
        {checkFailed && !isLocation && (
          <div className="permission-gate-warn">
            <p>Still waiting for your answer — tap <strong>Allow notifications</strong> below and choose <strong>Allow</strong> in the browser popup. If no popup appears, reload this page and tap once more.</p>
          </div>
        )}
        <div className="permission-gate-actions">
          <Button onClick={allow} loading={busy}>
            {isLocation ? <MapPin size={16} /> : <Bell size={16} />} {isLocation ? 'Allow location' : 'Allow notifications'}
          </Button>
        </div>
        <div className="permission-gate-secondary">
          {!isLocation && <button className="ghost" onClick={check} disabled={busy}><RefreshCw size={14} /> Check again</button>}
          <button className="ghost" onClick={onClose}>Not now</button>
        </div>
      </>
    );
  } else if (state === 'finishing') {
    heading = 'Alerts are allowed — finishing setup';
    lede = 'Your browser has allowed notifications. My Naai is finishing the last step for this device, and it keeps trying by itself — there is nothing to change in your settings.';
    body = (
      <>
        {reason && <p className="permission-help-note">{reason}</p>}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><RefreshCw size={16} /> Try again</Button>
        </div>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          {!isLocation && (
            <button className="ghost" onClick={copySupportReport} disabled={reportBusy}>
              <Copy size={14} /> {reportBusy ? 'Copying…' : reportCopied ? 'Copied' : 'Copy support report'}
            </button>
          )}
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
        {reportBlock}
      </>
    );
  } else if (state === 'unconfigured') {
    heading = 'Alerts are not switched on yet';
    lede = 'Booking alerts have not been switched on for this My Naai build, so no tap on this device can finish the setup. This is not your browser and not your fault.';
    body = (
      <>
        <div className="permission-gate-warn">
          <p>
            {required
              ? <>Sign-in asked for alerts, but this build cannot provide them. Call <a href="tel:8380017393">8380017393</a> and we will let you in — meanwhile try signing in again in case the server was just updated.</>
              : <>If you already allowed notifications, that permission is banked for the day alerts go live. Nothing else to do here.</>}
          </p>
        </div>
        {reason && <p className="permission-help-note">{reason}</p>}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><RefreshCw size={16} /> Check again</Button>
        </div>
        <div className="permission-gate-secondary">
          {!isLocation && (
            <button className="ghost" onClick={copySupportReport} disabled={reportBusy}>
              <Copy size={14} /> {reportBusy ? 'Copying…' : reportCopied ? 'Copied' : 'Copy support report'}
            </button>
          )}
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          <button className="ghost" onClick={onClose}>{required ? 'Close' : 'Not now'}</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
        {reportBlock}
      </>
    );
  } else if (state === 'unsupported') {
    const inApp = detectInAppBrowser();
    heading = isLocation ? 'Location is not available' : 'This browser cannot receive alerts';
    lede = isLocation
      ? 'This browser or device has no location service My Naai can use. You can still browse and book — distances just stay hidden.'
      : inApp
        ? `This page is open inside ${inApp === 'an app' ? 'another app' : inApp}’s built-in browser, which cannot receive web booking alerts. Your bookings still work — open My Naai in Chrome or Safari to hear the buzzer.`
        : `${label} on this device cannot receive web booking alerts. Your bookings still work — you just will not hear the buzzer here.`;
    body = (
      <>
        {!isLocation && (
          <ol className="ios-install-steps permission-gate-steps">
            {inApp ? <li>Tap the <strong>⋮</strong> (or <strong>⋯</strong>) menu and choose <strong>Open in browser</strong>.</li> : null}
            <li>On Android or desktop, open My Naai in <strong>Chrome, Edge or Samsung Internet</strong>.</li>
            <li>On iPhone, open My Naai in <strong>Safari → Share → Add to Home Screen</strong>, then sign in from the Home Screen app.</li>
            <li>Tap <strong>Turn on alerts</strong> there and choose <strong>Allow</strong>.</li>
          </ol>
        )}
        {reason && <p className="permission-help-note">{reason}</p>}
        {checkFailed && lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><RefreshCw size={16} /> Check again</Button>
        </div>
        <div className="permission-gate-secondary">
          {!isLocation && (
            <button className="ghost" onClick={copySupportReport} disabled={reportBusy}>
              <Copy size={14} /> {reportBusy ? 'Copying…' : reportCopied ? 'Copied' : 'Copy support report'}
            </button>
          )}
          <button className="ghost" onClick={onClose}>Got it</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
        {reportBlock}
      </>
    );
  } else if (state === 'enabled' || state === 'granted') {
    heading = isLocation ? 'Location is on' : 'Alerts are on';
    lede = isLocation
      ? 'Location is on — salons are sorted by distance for you.'
      : 'Booking alerts are on for this device. Booking requests, confirmations, delay updates and the buzzer will reach you.';
    body = (
      <>
        <div className="permission-gate-actions">
          <Button onClick={onClose}><Check size={16} /> Got it</Button>
        </div>
      </>
    );
  } else {
    heading = 'One more tap';
    lede = 'The last step of the alert setup did not finish on this device. Try once more — it usually works on the second try.';
    body = (
      <>
        {reason && <p className="permission-help-note">{reason}</p>}
        {lastCheckedLine && <p className="permission-help-note">{lastCheckedLine}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><RefreshCw size={16} /> Try again</Button>
        </div>
        <div className="permission-gate-secondary">
          {!isLocation && (
            <button className="ghost" onClick={copySupportReport} disabled={reportBusy}>
              <Copy size={14} /> {reportBusy ? 'Copying…' : reportCopied ? 'Copied' : 'Copy support report'}
            </button>
          )}
          <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
        {reportBlock}
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
        {!embeddedGate && <span className="permission-gate-browser">{isLocation ? <MapPin size={12} /> : <Bell size={12} />} {label}</span>}
        <h2>{heading}</h2>
        {lede && <p className="permission-gate-lede">{lede}</p>}
        {required && !needsInstall && !embeddedGate && (
          <p className="permission-gate-required"><CircleAlert size={14} /> Sign-in on this device has to finish with alerts on — it is how bookings reach you.</p>
        )}
        {body}
        {!isLocation && !embeddedGate && (
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
        // Permission granted: bank it, then finish our side (the device token)
        // without asking the salon owner for anything else. A token that lands
        // later arrives through `mynaai:push-token`.
        setStatus('checking');
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

  // A token that finishes in the background (lib/push.js retries) completes this
  // card by itself — the salon owner does not have to tap anything.
  useEffect(() => {
    const onToken = event => {
      const token = event?.detail?.token;
      if (token) onEnabledRef.current?.(token);
      inspect();
    };
    window.addEventListener('mynaai:push-token', onToken);
    return () => window.removeEventListener('mynaai:push-token', onToken);
  }, [inspect]);

  if (!isPushConfigured() || ['checking', 'unconfigured', 'enabled'].includes(status)) return null;
  const blocked = status === 'denied';
  const unavailable = status === 'unavailable' || status === 'unsupported';
  return (
    <section className={cx('push-setup-card', compact && 'push-setup-compact', unavailable && 'push-setup-retry')} aria-live="polite">
      <span className="push-setup-icon"><Bell size={compact ? 15 : 18} /></span>
      <div className="push-setup-copy">
        <strong>{blocked ? 'Booking alerts are blocked' : unavailable ? 'Alerts allowed — finishing setup' : 'Turn on booking alerts'}</strong>
        <p>{blocked
          ? `Allow Notifications for ${siteHost()} in ${browserLabel(detectBrowser())} — three taps, then Check again.`
          : unavailable ? (reason || 'Notifications are on for this device. My Naai is finishing the last step — this usually completes by itself.') : 'Booking requests, confirmations and the buzzer reach you only with alerts on.'}</p>
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

// ── The tab that was opened just to ask ──────────────────────────────────────
// A permission ask cannot happen inside another page, so My Naai opens this tab
// (same URL, `?mynaai-ask=notifications|location`) and asks here, where the
// browser does allow a popup. This is the piece that turns "open a new tab"
// from advice into a real Allow popup.
//
// It fires the browser's own request as soon as it mounts, because the visitor
// who opened this tab already asked for it — except on iPhone, where Safari
// silently drops a request made outside a tap and can make that answer stick;
// there, the button below owns the gesture.
export function PendingPermissionAsk({ onNotify }) {
  const [kind, setKind] = useState(() => pendingAskKind());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!kind) return;
    // The marker is single-use: a reload, share or bookmark must never ask again.
    clearPendingAsk();
  }, [kind]);

  const ask = useCallback(async () => {
    if (!kind) return;
    setBusy(true);
    try {
      if (kind === 'location') {
        const result = await requestLocation();
        if (result.ok) {
          onNotify?.('success', 'Location on — salons are now sorted by distance for you.');
          setKind('');
          return;
        }
        // A refusal here is a real one (this tab can prompt), so hand it to the
        // sheet with the steps for this browser instead of nagging.
        setKind('');
        return;
      }
      const permission = await requestNotifications();
      if (permission === 'granted') {
        onNotify?.('success', 'Booking alerts on — you will hear the buzzer.');
        setKind('');
        return;
      }
      // Not granted, not blocked: the browser swallowed the popup (quieter UI).
      // Keep the card up — the button below is a fresh, labelled gesture.
    } finally {
      setBusy(false);
    }
  }, [kind, onNotify]);

  useEffect(() => {
    // Desktop Chrome, Edge, Firefox and Android all answer a request made on
    // load, so the popup the visitor came for appears straight away.
    if (kind === 'notifications' && canAskForAlerts() && !isIosDevice()) ask();
  }, [ask, kind]);

  if (!kind) return null;
  const isLocation = kind === 'location';
  return (
    <div className="pending-ask" role="dialog" aria-label={isLocation ? 'Allow location' : 'Allow notifications'}>
      <span className="pending-ask-icon">{isLocation ? <MapPin size={18} /> : <BellRing size={18} />}</span>
      <div className="pending-ask-copy">
        <strong>{isLocation ? 'Allow location' : 'Allow notifications'}</strong>
        <p>{isLocation
          ? 'One tap, and salons are sorted by how far they are from you.'
          : 'One tap, and booking requests and the buzzer reach this device.'}</p>
      </div>
      <div className="pending-ask-actions">
        <Button size="small" onClick={ask} loading={busy}>{isLocation ? 'Allow location' : 'Allow'}</Button>
        <button type="button" className="ghost" onClick={() => setKind('')}>Not now</button>
      </div>
    </div>
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
