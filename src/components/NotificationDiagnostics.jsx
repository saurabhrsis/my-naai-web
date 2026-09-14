import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, ChevronDown, CircleAlert, Copy, RefreshCw } from 'lucide-react';
import { formatPushDiagnostics, getPushDiagnostics, getPushToken, isEmbeddedFrame, readNotificationPermission } from '../lib/push';
import { Button, Modal, cx } from './Shared';

// "Notifications are not working" can come from several layers — browser
// permission, Firebase config, the messaging worker or the FCM token. Users
// never need to see those internals: this card explains notification status
// and gives them one plain way to hand the team the facts when
// something does not arrive ("Copy report"). The full detail stays inside the
// copied report, never on screen.
export function NotificationDiagnostics({ onEnabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [report, setReport] = useState(null);
  const [permission, setPermission] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'));
  const reportRef = useRef(null);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setDiagnostics(await getPushDiagnostics());
      // Live read (Permissions API first): `Notification.permission` can keep
      // saying "denied" after the user has just allowed the site again.
      setPermission(await readNotificationPermission());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (open && !diagnostics && !busy) run(); }, [busy, diagnostics, open, run]);

  const failing = (diagnostics?.checks || []).filter(check => check.state === 'fail');
  const working = permission === 'granted' && failing.length === 0;
  const canRequestPermission = permission === 'default';

  const summary = !diagnostics
    ? 'Required for booking buzzers and updates'
    : working
      ? 'Allowed in this browser'
      : permission === 'denied'
        ? 'Blocked in this browser'
        : permission === 'unsupported'
          ? 'Not supported in this browser'
          : failing.length
            ? 'Allowed, but something needs a fix'
            : 'Required — enable notifications to continue';

  const buildReport = () => `My Naai web push report · ${new Date().toLocaleString('en-IN')}\n${formatPushDiagnostics(diagnostics)}`;

  // Clipboard access is refused in enough real situations (iOS Safari outside a
  // user gesture, Chrome on iOS, an installed PWA resumed from the background,
  // any non-secure context) that a fallback is mandatory. It is an in-app sheet
  // with a selectable textarea — never `window.prompt`, which an installed PWA
  // cannot style and may suppress outright.
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

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const copyReport = async () => {
    if (await writeClipboard(buildReport())) return markCopied();
    setReport(buildReport());
  };

  const copyFromSheet = async () => {
    if (await writeClipboard(report || buildReport())) markCopied();
  };

  const enable = async () => {
    setBusy(true);
    try {
      await getPushToken({ requestPermission: true });
      await run();
      onEnabled?.();
    } finally {
      setBusy(false);
    }
  };

  const note = permission === 'denied'
    ? (isEmbeddedFrame()
      ? 'My Naai is open inside another page, and browsers switch notifications off for embedded pages. Open My Naai in its own browser tab, tap Turn on there and choose Allow.'
      : 'Notifications are blocked in this browser. Open the site’s permission settings and set Notifications to Allow, so booking buzzers, delay requests and appointment updates can reach you. If it still says blocked after allowing, reload this page once.')
    : permission === 'unsupported'
      ? 'This browser cannot show notifications. Use Chrome, Edge or Samsung Internet — or install the My Naai app on iPhone/iPad.'
      : permission === 'default'
        ? 'You must enable notifications. Tap Allow so My Naai can log you in and send booking buzzers, delay requests and appointment updates.'
        : failing.length
          ? 'Notifications are allowed in this browser, but something is stopping them on this device.'
          : 'Notifications are allowed in this browser, so booking buzzers, delay requests and appointment updates can reach you.';

  return (
    <section className={cx('account-card', 'notification-diagnostics', open && 'open')}>
      <button type="button" className="diagnostics-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="notification-diagnostics-body">
        <span className="account-menu-icon"><Bell size={18} /></span>
        <span className="diagnostics-heading">
          <strong>Notifications</strong>
          <small>{summary}</small>
        </span>
        {diagnostics && (working
          ? <CheckCircle2 size={17} className="diagnostics-mark ok" />
          : permission === 'denied' || permission === 'unsupported' || failing.length
            ? <CircleAlert size={17} className="diagnostics-mark fail" />
            : <CircleAlert size={17} className="diagnostics-mark warn" />)}
        <ChevronDown size={17} className="collapsible-chevron" />
      </button>
      {open && <div className="diagnostics-body" id="notification-diagnostics-body">
        {!diagnostics
          ? <p className="diagnostics-note">{busy ? 'Checking this browser…' : 'You must enable notifications. Tap Enable so My Naai can send booking buzzers, delay requests and appointment updates.'}</p>
          : <>
            <p className="diagnostics-note">{note}</p>
            <p className="diagnostics-note">Missing a notification? Copy the report and share it with My Naai support — we can check it from there.</p>
          </>}
        <div className="diagnostics-actions">
          <Button size="small" variant="secondary" onClick={run} loading={busy}><RefreshCw size={14} /> Check again</Button>
          {canRequestPermission && <Button size="small" variant="secondary" onClick={enable} loading={busy}>Enable</Button>}
          {diagnostics && <Button size="small" variant="secondary" onClick={copyReport}><Copy size={14} /> {copied ? 'Copied' : 'Copy report'}</Button>}
        </div>
      </div>}
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
