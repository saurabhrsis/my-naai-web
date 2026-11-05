import React from 'react';
import {
  AlarmClock,
  CalendarDays,
  CircleSlash,
  Clock3,
  Phone,
  Scissors,
  UserRound,
  XCircle,
} from 'lucide-react';
import { LEAD_STATE, LEAD_STATE_LABEL, LEAD_STATE_TONE, leadView } from '../lib/bookingLeads';
import { Modal, StatusPill, formatCurrency, formatDate, formatTime } from './Shared';

// One request, read-only.
//
// This used to open the "New booking request" screen — the one a live push
// notification opens, with its 60-second countdown and Accept / Reject / Update
// time. Tapping "Details" on a request from last month therefore offered to
// accept a month-old lead, and its back button dropped the salon in the Queue
// tab. A request that is already accepted, rejected, cancelled or expired has
// exactly one thing to show: what the customer asked for. The answer buttons
// live on the card, where a live request can be answered in one tap inside its
// minute — not behind a screen.
//
// So: no countdown, no actions, no navigation. The sheet closes onto the list
// the salon opened it from.
function Row({ icon: Icon, label, children, className = '' }) {
  return (
    <div className={className ? `lead-detail-row ${className}` : 'lead-detail-row'}>
      <Icon size={15} aria-hidden="true" />
      <span>
        <small>{label}</small>
        <strong>{children}</strong>
      </span>
    </div>
  );
}

export function LeadDetailSheet({ lead, now = Date.now(), open, onClose }) {
  if (!lead) return null;
  const view = leadView(lead, now);
  const state = view.state;
  const services = lead.services || [];
  const amount = lead.amount || 0;

  return (
    <Modal open={open} onClose={onClose} title="Booking request">
      <div className="lead-detail">
        <header className="lead-detail-head">
          <div>
            <span className="eyebrow">CUSTOMER</span>
            <h3>{lead.customerName}</h3>
          </div>
          <StatusPill tone={LEAD_STATE_TONE[state] || 'neutral'} dot>{LEAD_STATE_LABEL[state] || state}</StatusPill>
        </header>

        <div className="lead-detail-grid">
          <Row icon={UserRound} label="Customer">{lead.customerName}</Row>
          <Row icon={Phone} label="Mobile">
            {lead.customerPhone
              ? <a href={`tel:${lead.customerPhone}`}>{lead.customerPhone}</a>
              : 'Not provided'}
          </Row>
          <Row icon={CalendarDays} label="Date">{lead.bookingDate ? formatDate(lead.bookingDate) : 'Not set'}</Row>
          <Row icon={Clock3} label="Time slot">{lead.bookingTime ? formatTime(lead.bookingTime) : 'Not set'}</Row>
          {/* A barber is only on a request when the customer picked one; "Any
              specialist" is what the salon allocates at accept time. */}
          <Row icon={UserRound} label="Barber">{lead.barberName || 'Any available specialist'}</Row>
          <Row icon={Scissors} label="Services" className="services">
            {services.length
              ? services.map((service, index) => (
                <span key={`${service.id || service.name}-${index}`} className="lead-detail-service">
                  {service.name}{service.price > 0 ? ` · ${formatCurrency(service.price)}` : ''}
                </span>
              ))
              : 'Salon service'}
          </Row>
        </div>

        {amount > 0 && (
          <p className="lead-detail-total"><span>Requested value</span><strong>{formatCurrency(amount)}</strong></p>
        )}

        {/* What happened, in the salon's words. No button is offered for any of
            these — the request is closed. */}
        <p className={`lead-detail-outcome ${state}`}>
          {state === LEAD_STATE.accepted && <>You accepted this request — it is in your <strong>customer queue</strong> as a booking.</>}
          {state === LEAD_STATE.rejected && <><XCircle size={14} aria-hidden="true" /> You rejected this request. The customer was told.</>}
          {state === LEAD_STATE.autoCancelled && <><AlarmClock size={14} aria-hidden="true" /> Nobody answered within 1 minute, so the request was cancelled automatically. It is not a rejection.</>}
          {state === LEAD_STATE.cancelled && <><CircleSlash size={14} aria-hidden="true" /> The customer withdrew this request.</>}
          {state === LEAD_STATE.delayed && <>You proposed a new time and the request is waiting on the customer.</>}
          {state === LEAD_STATE.awaiting && view.canAnswer && (
            <>This request is still open — answer it with <strong>Accept</strong> or <strong>Reject</strong> on the card. {view.countdown} left.</>
          )}
          {state === LEAD_STATE.awaiting && !view.canAnswer && (
            <>The one-minute answer window for this request has closed. Refresh the list to see how the server recorded it.</>
          )}
        </p>
      </div>
    </Modal>
  );
}

export default LeadDetailSheet;
