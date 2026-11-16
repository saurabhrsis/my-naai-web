import React from 'react';
import { ArrowRight, CalendarClock, LockKeyhole, ShoppingBag } from 'lucide-react';
import { Button, Modal } from './Shared';

// The expired-plan notice, shown ONLY when a partner opens one of the two tabs a
// lapsed plan no longer covers — the Customer queue and Booking history.
//
// It used to be the other way round: an expired plan replaced the whole portal
// with a paywall, so a salon that had not renewed could not read its own profile,
// its booking REQUESTS (leads) or its shop orders either. Those are not the plan's
// features — the queue and the history are. The rest of My Naai now stays open,
// and this modal is the gate on the two that close.
//
// Two exits, exactly as the owner asked: renew (the renewal UI, `mode: 'RENEW'`)
// or cancel, which lands the partner in the Naai Shop — somewhere useful, rather
// than back on the tab they cannot open.
export function SubscriptionEndedModal({ open, onRenew, onCancel }) {
  if (!open) return null;
  return (
    <Modal open onClose={onCancel} title="Your subscription has ended">
      <div className="subscription-ended-body">
        <span className="subscription-ended-mark" aria-hidden="true"><LockKeyhole size={20} /></span>
        <p>
          <strong>The Customer queue and Booking history are closed until you renew.</strong>{' '}
          Renew your subscription to open this feature again.
        </p>
        <ul className="subscription-ended-list">
          <li><CalendarClock size={15} aria-hidden="true" /> Everything else stays open — your profile, booking requests, shop orders and account.</li>
          <li><ShoppingBag size={15} aria-hidden="true" /> No customer payments happen here; the plan is a partner subscription.</li>
        </ul>
      </div>
      <div className="subscription-ended-actions">
        <Button onClick={onRenew}>Renew subscription <ArrowRight size={16} /></Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <small className="subscription-ended-hint">Cancel opens the Naai Shop.</small>
      </div>
    </Modal>
  );
}

export default SubscriptionEndedModal;
