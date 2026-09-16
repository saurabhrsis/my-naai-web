import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCircle2, ChevronDown, CircleAlert, Copy, MapPin, RefreshCw, Settings } from 'lucide-react';
import { formatPushDiagnostics, getPushDiagnostics, getPushToken, isPushConfigured, watchNotificationPermission } from '../lib/push';
import { browserLabel, detectBrowser, isEmbeddedFrame, readPermission, rememberAskChoice, requestLocation, requestNotifications, ASK_CHOICES, siteHost } from '../lib/permissions';
import { PermissionSheet } from './PermissionUI';
import { Button, Modal, Spinner, cx } from './Shared';

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
  const alertsOn = alerts === 'granted';
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

  const alertsSummary = alertsOn
    ? 'Alerts are on for this device'
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
          <small>{alertsOn && locationOn ? 'Both on — you are all set' : alertsOn ? alertsSummary : `${alertsSummary}${locationOn ? '' : ' · Location optional'}`}</small>
        </span>
        {alertsOn
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
              <p>{alertsOn
                ? 'On. Booking requests, confirmations, delay updates and the buzzer all reach this device.'
                : blocked ? `Blocked in ${siteHost()}'s ${browserLabel(detectBrowser())} settings — three taps to switch back on.`
                  : unsupported ? 'This browser cannot receive web alerts. Chrome, Edge, Samsung Internet — or the installed app on iPhone — can.'
                    : 'Booking requests, confirmations, delay updates and the buzzer.'}</p>
            </div>
            {alertsOn
              ? <span className="perm-state-on"><CheckCircle2 size={14} /> On</span>
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

          {alertsOn && !failing.length && (
            <p className="diagnostics-note">Alerts are allowed in this browser. Missing one? Copy the support report below and we will trace it for you.</p>
          )}
          <div className="diagnostics-actions">
            {isPushConfigured() && !alertsOn && <Button size="small" variant="secondary" onClick={run} loading={busy === 'run'}><RefreshCw size={14} /> Check again</Button>}
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
