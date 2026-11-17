import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ChevronDown,
  Clock3,
  Inbox,
  RefreshCw,
  Store,
  Timer,
} from 'lucide-react';
import { api } from '../lib/api';
import { refreshWhenVisible, useAdaptiveRefresh } from '../lib/liveRefresh';
import { subscribeToLiveUpdates } from '../lib/socket';
import {
  LEAD_CUSTOMER_LABEL,
  LEAD_CUSTOMER_NOTE,
  LEAD_STATE,
  LEAD_STATE_TONE,
  bookingWindowLabel,
  filterLeads,
  leadStateFromStatus,
  leadView,
  normalizeLead,
  summarizeLeads,
} from '../lib/bookingLeads';
import { Button, EmptyState, SkeletonCard, StatusPill, cx, formatCurrency, formatDate, formatTime, getErrorMessage } from './Shared';

const PAGE_SIZE = 20;

// The customer's own requests, read from the same table the salon's tab reads.
// This list is HISTORY: it shows what was asked for and what the salon (or the
// clock) did about it. Nothing on this screen sends a request anywhere —
// accept / reject belong to the salon, the customer's own delay answer lives in
// My bookings, and the deadline belongs to the server.
function listFrom(response, keys = []) {
  if (Array.isArray(response?.data)) return response.data;
  for (const key of keys) if (Array.isArray(response?.data?.[key])) return response.data[key];
  return [];
}

// A backend older than this screen answers 404 / "cannot POST". That is not an
// error the customer can act on, so the tab says what is true instead: there is
// nothing to read here YET. The same requests are still visible in My bookings,
// where a request that was accepted becomes a booking.
const isMissingEndpoint = error => {
  const message = String(error?.message || error || '').toLowerCase();
  return error?.status === 404 || /not found|404|cannot post|unexpected|no such/i.test(message);
};

const FILTERS = [
  { id: 'all', label: 'All requests' },
  { id: 'awaiting', label: 'Waiting' },
  { id: 'closed', label: 'Answered' },
];

function RequestCard({ lead, now }) {
  const view = leadView(lead, now);
  const label = LEAD_CUSTOMER_LABEL[view.state] || view.state;
  return (
    <article className={cx('lead-card', `lead-${view.state}`, 'customer-request-card')}>
      <header className="lead-card-top">
        <div className="lead-card-who">
          <span className="lead-avatar" aria-hidden="true"><Store size={15} /></span>
          <div>
            <strong>{lead.salonName || 'My Naai salon'}</strong>
            <small>
              {lead.bookingDate ? formatDate(lead.bookingDate) : 'Date not set'}
              {lead.bookingTime ? ` · ${formatTime(lead.bookingTime)}` : ''}
              {lead.barberName ? ` · ${lead.barberName}` : ''}
            </small>
          </div>
        </div>
        <StatusPill tone={LEAD_STATE_TONE[view.state] || 'neutral'} dot>{label}</StatusPill>
      </header>

      {lead.services.length > 0 && (
        <ul className="lead-services">
          {lead.services.map((service, index) => (
            <li key={`${service.id || service.name}-${index}`}>
              {service.name}{service.price > 0 ? ` · ${formatCurrency(service.price)}` : ''}
            </li>
          ))}
        </ul>
      )}

      <footer className="lead-card-foot">
        <div className="lead-meta">
          {lead.amount > 0 && <strong>{formatCurrency(lead.amount)}</strong>}
          {/* The clock the customer actually watches: minutes and seconds left of
              the salon's answer window, ticking down while the tab is open and
              turning into "expired" at 0:00 by itself (the server revokes the
              slot at the same instant, so the two can never disagree for long). */}
          {view.canAnswer && (
            <span className="lead-countdown"><Timer size={12} aria-hidden="true" /> {view.countdown} left to be answered</span>
          )}
          {view.state === LEAD_STATE.awaiting && !view.canAnswer && (
            <span className="lead-closed-note"><AlarmClock size={12} aria-hidden="true" /> Answer window closed</span>
          )}
          {lead.createdAt > 0 && (
            <span className="lead-requested-at">Sent {new Date(lead.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
      </footer>
      <p className="lead-customer-note">{LEAD_CUSTOMER_NOTE[view.state] || ''}</p>
    </article>
  );
}

/**
 * Customer → My bookings → Booking requests.
 *
 * Every request this customer sent, newest first: waiting, accepted, declined,
 * expired with no answer, or cancelled. There are no actions in this tab on
 * purpose — see the note at the top of the file.
 */
export function CustomerBookingRequests({ session, notify }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async ({ quiet = false, nextPage = 1 } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    setNote('');
    try {
      const response = await api.userBookingRequestList({ page: nextPage, limit: PAGE_SIZE });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Unable to load your booking requests.');
      const rows = listFrom(response, ['requests', 'bookingRequests', 'bookingRequestList', 'list', 'items', 'results']);
      const leads = rows.map(row => normalizeLead(row));
      setRequests(current => (nextPage > 1
        ? [...current, ...leads.filter(lead => !current.some(item => item.id === lead.id))]
        : leads));
      const pagination = response?.data?.pagination || {};
      setTotalPages(Math.max(1, Number(pagination.totalPages) || 1));
      setTotalRequests(Number(pagination.totalRequests ?? pagination.total ?? rows.length) || rows.length);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        // The endpoint ships with the backend patch. Until it is deployed the
        // tab is honest about it rather than showing an empty history.
        setRequests([]);
        setTotalPages(1);
        setTotalRequests(0);
        setNote('Your request history appears here after the next backend update. A request that was accepted is already in My bookings.');
      } else {
        const message = getErrorMessage(err, 'Unable to load your booking requests.');
        setRequests([]);
        setError(message);
        notify?.('error', message);
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // The countdown is the point of this tab, so it ticks once a second whether or
  // not anything is fetched.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Live, like the salon's tab: the same `user_<id>` room already carries
  // `booking_status_updated` (accept / reject / delay proposal) and the backend
  // now also sends `booking_request_updated` when a request is answered or
  // expires.
  //
  // The event is applied to the card FIRST and the list is re-read after. That
  // ordering is the fix for "it still says 0:30 left after the salon accepted":
  // the refetch is a network round trip, and a countdown that keeps ticking
  // while an answer is already known is a lie the screen tells for as long as
  // that round trip takes. `booking_request_updated` carries the status, so the
  // card flips to "Accepted" (or "Declined", or "expired") on the spot; the
  // quiet reload then replaces it with whatever the server actually recorded.
  const applyStatus = useCallback(payload => {
    const id = payload?.bookingRequestId ? String(payload.bookingRequestId) : '';
    if (!id || !payload?.status) return false;
    const state = leadStateFromStatus(payload.status);
    let matched = false;
    setRequests(items => items.map(item => {
      if (item.id !== id) return item;
      matched = true;
      return { ...item, status: state, rawStatus: String(payload.status) };
    }));
    return matched;
  }, []);

  const onLiveChange = useCallback(payload => {
    applyStatus(payload);
    load({ quiet: true });
  }, [applyStatus, load]);

  useEffect(() => subscribeToLiveUpdates({
    scope: 'user', id: session?.userId, event: 'booking_status_updated', handler: onLiveChange,
  }), [onLiveChange, session?.userId]);
  useEffect(() => subscribeToLiveUpdates({
    scope: 'user', id: session?.userId, event: 'booking_request_updated', handler: onLiveChange,
  }), [onLiveChange, session?.userId]);

  // …and the floor under the socket: while a request is waiting on an answer the
  // list re-reads every 5 s (a stuck socket, a sleeping phone), every 30 s when
  // nothing is waiting, and immediately when the tab is shown again.
  const anyWaiting = useMemo(() => requests.some(lead => leadView(lead, Date.now()).state === LEAD_STATE.awaiting), [requests]);
  useAdaptiveRefresh(load, anyWaiting, { active: 5000, idle: 30000 });
  useEffect(() => refreshWhenVisible(() => load({ quiet: true })), [load]);

  const summary = useMemo(() => summarizeLeads(requests, now), [requests, now]);
  const visible = useMemo(() => {
    const byFilter = filter === 'closed'
      ? requests.filter(lead => leadView(lead, now).state !== LEAD_STATE.awaiting)
      : filterLeads(requests, filter, now);
    return byFilter;
  }, [requests, filter, now]);

  return (
    <div className="customer-requests">
      {/* What the tab is for, in the customer's words — and the one rule that
          matters: nobody has to do anything here. */}
      {summary.awaiting > 0 ? (
        <div className="booking-waiting-banner" role="status">
          <Clock3 size={16} />
          <span>
            <strong>{summary.awaiting === 1 ? 'One request is waiting for the salon.' : `${summary.awaiting} requests are waiting for the salon.`}</strong>
            {' '}Each one is answered within {bookingWindowLabel} — accepted, declined, or cancelled automatically if the salon does not answer. There is nothing to do here; you will be alerted either way.
          </span>
        </div>
      ) : null}

      <div className="booking-tabs">
        {FILTERS.map(item => (
          <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>
            {item.label}
            {item.id === 'all' && <span>{summary.received}</span>}
            {item.id === 'awaiting' && summary.awaiting > 0 && <span>{summary.awaiting}</span>}
          </button>
        ))}
        <button className="booking-tabs-refresh" onClick={() => load()} disabled={loading} aria-label="Refresh requests">
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
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
        <>
          <div className="lead-list">
            {visible.map(lead => <RequestCard key={lead.id} lead={lead} now={now} />)}
          </div>
          {page < totalPages && (
            <div className="lead-pager">
              <Button
                variant="secondary"
                size="small"
                onClick={() => { const next = page + 1; setPage(next); load({ quiet: true, nextPage: next }); }}
              >
                <ChevronDown size={15} /> Show older requests
              </Button>
            </div>
          )}
          <p className="lead-count customer-request-count">
            {totalRequests > requests.length ? `${requests.length} of ${totalRequests} requests` : `${summary.received} ${summary.received === 1 ? 'request' : 'requests'}`}
            {summary.accepted > 0 ? ` · ${summary.accepted} accepted` : ''}
            {summary.rejected > 0 ? ` · ${summary.rejected} declined` : ''}
            {summary.autoCancelled > 0 ? ` · ${summary.autoCancelled} expired` : ''}
          </p>
        </>
      ) : (
        <EmptyState
          icon={Inbox}
          title={filter === 'all' ? 'No booking requests yet' : 'Nothing in this filter'}
          message={filter === 'all'
            ? 'When you ask a salon for a slot, the request appears here with the time the salon has to answer it.'
            : 'Try another filter to see the rest of your requests.'}
          action={filter === 'all' ? undefined : <Button variant="secondary" onClick={() => setFilter('all')}>Show all requests</Button>}
        />
      )}
    </div>
  );
}

export default CustomerBookingRequests;
