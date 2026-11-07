import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Inbox,
  Phone,
  RefreshCw,
  Timer,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { LeadDetailSheet } from './LeadDetailSheet';
import {
  LEAD_FILTERS,
  LEAD_FILTER_STATUS,
  LEAD_STATE,
  LEAD_STATE_LABEL,
  LEAD_STATE_TONE,
  bookingWindowMissed,
  filterLeads,
  leadView,
  normalizeLead,
  summarizeLeads,
} from '../lib/bookingLeads';
import {
  Button,
  EmptyState,
  PageHeader,
  SkeletonCard,
  StatusPill,
  cx,
  formatCurrency,
  formatDate,
  formatTime,
  getErrorMessage,
} from './Shared';

const PAGE_SIZE = 20;

function listFrom(response, keys = []) {
  if (Array.isArray(response?.data)) return response.data;
  for (const key of keys) if (Array.isArray(response?.data?.[key])) return response.data[key];
  return [];
}

// The salon's own API answers the request list. Until that patch is deployed the
// endpoint is missing (404 / "not found"), and the tab still has to work — so it
// falls back to the notifications feed, which has carried the same requests all
// along, and says so quietly (a banner, not an error).
const isMissingEndpoint = error => {
  const message = String(error?.message || error || '').toLowerCase();
  return error?.status === 404 || /not found|404|cannot post|unexpected|no such/i.test(message);
};

function leadFromNotification(item = {}) {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : item;
  const type = String(item.type || item.notificationType || '').toUpperCase();
  if (type !== 'BOOKING_REQUEST') return null;
  return normalizeLead({
    bookingRequestId: item.bookingRequestId || item.bookingId || item.booking_request_id,
    customerName: payload.customerName || payload.userName || item.title,
    customerPhone: payload.customerPhone || payload.phoneNumber,
    bookingDate: payload.bookingDate,
    bookingTime: payload.bookingTime,
    services: payload.services,
    status: payload.status || payload.requestStatus,
    createdAt: item.createdAt || item.created_at || item.createdOn,
  });
}

// ── One request card ────────────────────────────────────────────────────────
// Who, when, what — then the answer. Accept / Reject sit on the card because
// that is the whole job of this tab; a request whose window has closed is
// shown as auto-cancelled with no buttons at all, so the salon is never offered
// an action the server will refuse.
function LeadCard({ lead, now, busy, onAnswer, onOpen }) {
  const view = leadView(lead, now);
  const services = lead.services.length ? lead.services : [];
  return (
    <article className={cx('lead-card', `lead-${view.state}`)}>
      <header className="lead-card-top">
        <div className="lead-card-who">
          <span className="lead-avatar" aria-hidden="true"><UserRound size={15} /></span>
          <div>
            <strong>{lead.customerName}</strong>
            <small>
              {lead.bookingDate ? formatDate(lead.bookingDate) : 'Date not set'}
              {lead.bookingTime ? ` · ${formatTime(lead.bookingTime)}` : ''}
              {lead.barberName ? ` · ${lead.barberName}` : ''}
            </small>
          </div>
        </div>
        <StatusPill tone={LEAD_STATE_TONE[view.state] || 'neutral'} dot>{LEAD_STATE_LABEL[view.state] || view.state}</StatusPill>
      </header>

      {services.length > 0 && (
        <ul className="lead-services">
          {services.map((service, index) => (
            <li key={`${service.id || service.name}-${index}`}>{service.name}{service.price > 0 ? ` · ${formatCurrency(service.price)}` : ''}</li>
          ))}
        </ul>
      )}

      <footer className="lead-card-foot">
        <div className="lead-meta">
          {lead.amount > 0 && <strong>{formatCurrency(lead.amount)}</strong>}
          {view.canAnswer && (
            <span className="lead-countdown"><Timer size={12} aria-hidden="true" /> Answer in {view.countdown}</span>
          )}
          {view.state === LEAD_STATE.autoCancelled && (
            <span className="lead-closed-note"><AlarmClock size={12} aria-hidden="true" /> {bookingWindowMissed} — cancelled automatically</span>
          )}
          {view.state === LEAD_STATE.cancelled && (
            <span className="lead-closed-note"><CircleSlash size={12} aria-hidden="true" /> The customer withdrew this request</span>
          )}
        </div>
        <div className="lead-actions">
          {/* Details is always here and is always READ-ONLY: it opens the
              request's facts, never the live-answer screen. The answer lives
              beside it, on the card. */}
          <button type="button" className="lead-open" onClick={() => onOpen(lead)}>Details <ArrowRight size={13} /></button>
          {lead.customerPhone && (
            <a className="lead-icon-button" href={`tel:${lead.customerPhone}`} aria-label={`Call ${lead.customerName}`}>
              <Phone size={14} />
            </a>
          )}
          {/* Accept / Reject exist only while the request can still be
              answered. A request from last month — accepted, rejected or
              auto-cancelled — gets no actions at all, so the salon can never
              be offered a button the server will refuse. */}
          {view.canAnswer && (
            <>
              <button type="button" className="lead-answer reject" disabled={Boolean(busy)} onClick={() => onAnswer(lead, 'REJECT')}>
                {busy === 'REJECT' ? <RefreshCw size={14} className="spin" /> : <X size={14} />} Reject
              </button>
              <button type="button" className="lead-answer accept" disabled={Boolean(busy)} onClick={() => onAnswer(lead, 'ACCEPT')}>
                {busy === 'ACCEPT' ? <RefreshCw size={14} className="spin" /> : <Check size={14} />} Accept
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

/**
 * Salon → Booking requests.
 *
 * Leads, not bookings: every request the salon received, with how many it
 * accepted, rejected or let expire unanswered. A salon can answer a live
 * request here (Accept / Reject), see the auto-cancelled ones it missed, and
 * read the answer rate the numbers add up to.
 */
export function SalonLeadsScreen({ session, notify }) {
  const salonId = session?.userId || session?.user?.salon?.salonId || '';
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  // Answers produced on this screen, keyed by request id. The list API can
  // answer a beat behind the action, and a card that reverts to "waiting"
  // after it was accepted (or keeps offering Accept) is worse than one that
  // is a second ahead. The override is applied on every load.
  const [outcomes, setOutcomes] = useState({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [now, setNow] = useState(Date.now());
  // The request whose details are open. A sheet ON this screen, not a route:
  // the salon opened it to read a name or a number, so closing it must land
  // back on the list (and not on the Queue tab, which is what navigating to
  // the live-answer screen used to do).
  const [selected, setSelected] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    setNote('');
    try {
      const response = await api.salonBookingRequestList({
        salonId,
        status: LEAD_FILTER_STATUS[filter] || 'ALL',
        page,
        limit: PAGE_SIZE,
      });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Unable to load booking requests.');
      const rows = listFrom(response, ['requests', 'bookingRequests', 'bookingRequestList', 'list', 'items', 'results']);
      setLeads(rows.map(row => {
        const lead = normalizeLead(row);
        return outcomes[lead.id] ? { ...lead, status: outcomes[lead.id] } : lead;
      }));
      const pagination = response?.data?.pagination || {};
      setTotalPages(Math.max(1, Number(pagination.totalPages) || 1));
    } catch (err) {
      if (isMissingEndpoint(err)) {
        // No request endpoint on this deployment yet: read the same leads from
        // the notifications feed rather than showing an empty tab.
        try {
          const response = await api.salonNotificationList({ salonId, page: 1 });
          const rows = listFrom(response, ['notifications', 'notificationList', 'list', 'items', 'results'])
            .map(leadFromNotification)
            .filter(Boolean);
          setLeads(rows);
          setTotalPages(1);
          setNote('Showing requests from your notifications. The full request history arrives with the next backend update.');
        } catch (fallbackError) {
          const message = getErrorMessage(fallbackError, 'Unable to load booking requests.');
          setLeads([]);
          setError(message);
          notify?.('error', message);
        }
      } else {
        const message = getErrorMessage(err, 'Unable to load booking requests.');
        setLeads([]);
        setError(message);
        notify?.('error', message);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, notify, outcomes, page, salonId]);

  useEffect(() => { load(); }, [load]);

  // The answer window is a minute, so a live request has to turn into an
  // auto-cancelled one while the salon is looking at it — the tick is what
  // notices, and it also keeps the countdown honest.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // …and new requests arrive on their own: the tab refreshes every 20s.
  useEffect(() => {
    const timer = window.setInterval(() => load({ quiet: true }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => summarizeLeads(leads, now), [leads, now]);
  const visible = useMemo(() => filterLeads(leads, filter, now), [leads, filter, now]);

  const answer = async (lead, action) => {
    if (!lead?.id || busy) return;
    setBusy(action);
    try {
      const response = await api.bookingRequestOwnerAction(lead.id, { action });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || `${action} failed`);
      // Answer in place: the list API is not always quick to reflect it, and a
      // card that keeps offering Accept after the accept went through is worse
      // than a card that is a second behind.
      const nextState = action === 'ACCEPT' ? LEAD_STATE.accepted : LEAD_STATE.rejected;
      setOutcomes(current => ({ ...current, [lead.id]: nextState }));
      setLeads(current => current.map(item => (item.id === lead.id ? { ...item, status: nextState } : item)));
      notify?.('success', action === 'ACCEPT' ? `${lead.customerName}'s booking is accepted — it is in your queue now.` : `Request from ${lead.customerName} rejected.`);
      load({ quiet: true });
    } catch (err) {
      const message = getErrorMessage(err, `Could not ${action === 'ACCEPT' ? 'accept' : 'reject'} this request.`);
      notify?.('error', message);
      // "Already actioned" / "expired" is an answer too — show it as such.
      if (/already|expired|cannot be action|not found/i.test(message)) {
        setOutcomes(current => ({ ...current, [lead.id]: LEAD_STATE.autoCancelled }));
        setLeads(current => current.map(item => (item.id === lead.id ? { ...item, status: LEAD_STATE.autoCancelled } : item)));
      }
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="screen salon-leads-screen">
      <PageHeader
        title="Booking requests"
        subtitle="Every request a customer sent you — accept or reject it, and see what you missed."
        action={(
          <button type="button" className="refresh-text-button" onClick={() => load()} disabled={loading}>
            {loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} {loading ? 'Updating…' : 'Refresh'}
          </button>
        )}
      />

      {/* The numbers the tab exists for: how many leads came in and what became
          of them. Requests only — a booking lives in the queue, not here. */}
      <section className="lead-summary" aria-label="Request summary">
        <div className="lead-stat received">
          <span><Inbox size={14} /> Received</span>
          <strong>{summary.received}</strong>
        </div>
        <div className="lead-stat accepted">
          <span><CheckCircle2 size={14} /> Accepted</span>
          <strong>{summary.accepted}</strong>
        </div>
        <div className="lead-stat rejected">
          <span><XCircle size={14} /> Rejected</span>
          <strong>{summary.rejected}</strong>
        </div>
        <div className="lead-stat cancelled">
          <span><AlarmClock size={14} /> Auto-cancelled</span>
          <strong>{summary.autoCancelled}</strong>
        </div>
      </section>
      {summary.received > 0 && (
        <p className="lead-rate">
          <strong>{summary.answerRate}%</strong> of these requests were answered
          {summary.awaiting > 0 ? ` · ${summary.awaiting} still waiting` : ''}
          {' '}· a request left unanswered for a minute is cancelled automatically.
        </p>
      )}

      <div className="lead-toolbar">
        <label className="lead-filter">
          <span>Show</span>
          <select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} aria-label="Filter booking requests">
            {LEAD_FILTERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <span className="lead-count">{visible.length} {visible.length === 1 ? 'request' : 'requests'}</span>
      </div>

      {note && <p className="lead-note" role="status">{note}</p>}

      {loading ? (
        <div className="lead-list">{[1, 2, 3].map(item => <SkeletonCard key={item} className="lead-skeleton" />)}</div>
      ) : error ? (
        <EmptyState
          icon={Inbox}
          title="Your requests are out of reach"
          message={`${error} Check your connection and try again.`}
          action={<Button onClick={() => load()}><RefreshCw size={15} /> Retry</Button>}
        />
      ) : visible.length ? (
        <div className="lead-list">
          {visible.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              now={now}
              busy={busy.startsWith(lead.id) ? busy.slice(lead.id.length + 1) : ''}
              onAnswer={answer}
              onOpen={setSelected}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Inbox}
          title={filter === 'all' ? 'No booking requests yet' : 'Nothing in this filter'}
          message={filter === 'all'
            ? 'When a customer requests a slot at your salon, it lands here with a one-minute window to accept or reject it.'
            : 'Try another filter to see the rest of your requests.'}
          action={filter === 'all' ? undefined : <Button variant="secondary" onClick={() => setFilter('all')}>Show all requests</Button>}
        />
      )}

      <LeadDetailSheet
        lead={selected ? (leads.find(item => item.id === selected.id) || selected) : null}
        now={now}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />

      {totalPages > 1 && (
        <div className="lead-pager">
          <Button variant="secondary" size="small" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>
            <ChevronLeft size={15} /> Previous
          </Button>
          <span>Page {page} of {totalPages}</span>
          <Button variant="secondary" size="small" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>
            Next <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}

export default SalonLeadsScreen;
