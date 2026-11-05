// Booking REQUESTS are not bookings.
//
// A booking request is a lead: a customer asked for a slot, and the salon has a
// short window to accept, reject or delay it. A booking is what exists once the
// salon accepted — a row in the bookings table, with a chair, a time and a
// status the queue works from. The two live in different tables and mean
// different things, so nothing here shares a record type with
// `bookings`/`booking_list` — and the leads tab counts requests, never bookings.
//
// The window: a request that nobody answers inside BOOKING_ACTION_WINDOW_MS is
// cancelled by the server (a customer cannot hold a slot forever, and the salon
// cannot leave a lead hanging). That is an **auto-cancelled** request — not a
// rejection, and deliberately counted apart from one.

export const BOOKING_ACTION_WINDOW_MS = 60 * 1000;

export const LEAD_STATE = {
  awaiting: 'awaiting', // live, still inside the answer window
  accepted: 'accepted',
  rejected: 'rejected',
  delayed: 'delayed', // a new time was proposed; the request stays open
  autoCancelled: 'autoCancelled', // the window closed with no answer
  cancelled: 'cancelled', // the customer withdrew it
};

export const LEAD_FILTERS = [
  { id: 'all', label: 'All requests' },
  { id: 'awaiting', label: 'Awaiting answer' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'autoCancelled', label: 'Auto-cancelled' },
];

// The words a backend may use for the same state, read loosely — the same
// approach the notifications screen takes (`requestOutcome`), because the
// deployed API has answered with 'PENDING', 'OPEN', 'EXPIRED', 'ACCEPTED',
// 'REJECTED', 'CANCELLED' and 'DELAY_TIME_PROPOSAL' at different times.
export function leadStateFromStatus(raw) {
  const value = String(raw || '').toLowerCase();
  if (!value) return LEAD_STATE.awaiting;
  if (/accept|confirm|approve/.test(value)) return LEAD_STATE.accepted;
  if (/reject|declin/.test(value)) return LEAD_STATE.rejected;
  if (/delay|propos/.test(value)) return LEAD_STATE.delayed;
  // "Auto-cancelled" and "expired" are the same event; a customer's own
  // cancellation is different and must not be filed as the salon missing one.
  if (/auto.?cancel|expire|timeout|timed.?out/.test(value)) return LEAD_STATE.autoCancelled;
  if (/cancel/.test(value)) return LEAD_STATE.cancelled;
  return LEAD_STATE.awaiting;
}

const firstOf = (row, keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
};

const toMs = value => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).length >= 10 && !String(value).includes('-')) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

// One request, in the shape the screen reads. The API has been re-shaped twice,
// so every field is looked up under the names the backend and the mobile app
// have used instead of assuming one.
export function normalizeLead(row = {}, now = Date.now()) {
  const createdAt = toMs(firstOf(row, ['createdAt', 'created_at', 'requestedAt', 'requestTime', 'bookingRequestTime']));
  const services = Array.isArray(row.services)
    ? row.services.map(item => ({
      id: item?.serviceId || item?.id || '',
      name: item?.serviceName || item?.name || item?.title || 'Service',
      price: Number(item?.price ?? item?.amount ?? 0) || 0,
    }))
    : [];
  const id = String(firstOf(row, ['bookingRequestId', 'booking_request_id', 'requestId', 'id']));
  const status = leadStateFromStatus(firstOf(row, ['status', 'requestStatus', 'bookingStatus', 'state']));
  const expiresAt = toMs(firstOf(row, ['expiresAt', 'expires_at', 'expiryTime'])) || (createdAt ? createdAt + BOOKING_ACTION_WINDOW_MS : 0);
  return {
    id,
    customerName: String(firstOf(row, ['customerName', 'userName', 'fullName', 'name']) || 'Customer'),
    customerPhone: String(firstOf(row, ['customerPhone', 'phoneNumber', 'phone', 'mobile']) || ''),
    salonName: String(firstOf(row, ['salonName']) || ''),
    barberName: String(firstOf(row, ['barberName', 'staffName']) || ''),
    bookingDate: String(firstOf(row, ['bookingDate', 'date']) || '').slice(0, 10),
    bookingTime: String(firstOf(row, ['bookingTime', 'time', 'slot']) || ''),
    services,
    amount: services.reduce((sum, item) => sum + item.price, 0),
    createdAt,
    expiresAt,
    status,
    rawStatus: String(firstOf(row, ['status', 'requestStatus', 'bookingStatus', 'state']) || ''),
    isLead: Boolean(id),
    now,
  };
}

// What the card shows, given the clock. A request the salon has not answered
// stops being answerable the moment its window closes: it is auto-cancelled
// then, whether or not the server has caught up with that fact yet.
export function leadView(lead, now = Date.now()) {
  const remainingMs = lead.status === LEAD_STATE.awaiting && lead.expiresAt ? Math.max(0, lead.expiresAt - now) : 0;
  const state = lead.status === LEAD_STATE.awaiting && lead.expiresAt && now >= lead.expiresAt
    ? LEAD_STATE.autoCancelled
    : lead.status;
  return {
    state,
    remainingMs,
    canAnswer: state === LEAD_STATE.awaiting && remainingMs > 0,
    countdown: remainingMs > 0 ? `${Math.floor(remainingMs / 60000)}:${String(Math.ceil((remainingMs % 60000) / 1000)).padStart(2, '0')}` : '',
  };
}

// The numbers the tab leads with: how many requests came in, and what became of
// them. `received` is every request in the current half of the list; the states
// add up to it (auto-cancelled and customer-cancelled are separate buckets).
export function summarizeLeads(leads = [], now = Date.now()) {
  const summary = { received: 0, awaiting: 0, accepted: 0, rejected: 0, autoCancelled: 0, cancelled: 0, delayed: 0 };
  leads.forEach(lead => {
    summary.received += 1;
    const { state } = leadView(lead, now);
    if (state === LEAD_STATE.awaiting) summary.awaiting += 1;
    else if (state === LEAD_STATE.accepted) summary.accepted += 1;
    else if (state === LEAD_STATE.rejected) summary.rejected += 1;
    else if (state === LEAD_STATE.autoCancelled) summary.autoCancelled += 1;
    else if (state === LEAD_STATE.cancelled) summary.cancelled += 1;
    else if (state === LEAD_STATE.delayed) summary.delayed += 1;
  });
  const answered = summary.accepted + summary.rejected;
  summary.answered = answered;
  summary.answerRate = summary.received ? Math.round((answered / summary.received) * 100) : 0;
  return summary;
}

export function filterLeads(leads = [], filter = 'all', now = Date.now()) {
  if (!filter || filter === 'all') return leads;
  return leads.filter(lead => leadView(lead, now).state === filter);
}

// Server-side filter value for each chip, so the API can page a filtered list.
export const LEAD_FILTER_STATUS = {
  all: 'ALL',
  awaiting: 'PENDING',
  accepted: 'ACCEPTED',
  rejected: 'REJECTED',
  autoCancelled: 'AUTO_CANCELLED',
  cancelled: 'CANCELLED',
  delayed: 'DELAYED',
};

export const LEAD_STATE_LABEL = {
  awaiting: 'Awaiting your answer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  delayed: 'New time proposed',
  autoCancelled: 'Auto-cancelled',
  cancelled: 'Cancelled by customer',
};

export const LEAD_STATE_TONE = {
  awaiting: 'pending',
  accepted: 'open',
  rejected: 'closed',
  delayed: 'pending',
  autoCancelled: 'neutral',
  cancelled: 'neutral',
};
