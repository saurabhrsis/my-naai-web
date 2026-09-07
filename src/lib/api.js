// The web client intentionally keeps the same REST contract as the React Native app.
// Set VITE_API_BASE_URL for a staging API; production defaults to the mobile app's API.
const configuredApiUrl = import.meta.env.VITE_API_BASE_URL;
// Vite proxies API calls in local development so the portal can use the mobile
// backend without a browser CORS hop. Production can point this at the same API
// directly (or set VITE_API_BASE_URL to the deployed reverse proxy).
export const API_BASE_URL = (configuredApiUrl || (import.meta.env.DEV ? '' : 'https://backend.mynaai.in')).replace(/\/$/, '');

const TOKEN_KEY = 'mynaai';

// Mirrors the mobile Axios interceptor's `isPlanAlertShown` guard. A busy salon
// can make several API requests at once; one response should produce one global
// paywall event, not a stack of redirects. It is reset after logout or a
// successful renewal.
let isPlanAlertShown = false;
export function resetPlanExpiredAlert() {
  isPlanAlertShown = false;
}

// The Firebase messaging service worker needs to perform the ACCEPT/REJECT/DELAY
// booking actions from a notification action button even when the PWA is closed.
// A service worker cannot read localStorage, so the session token is mirrored
// into IndexedDB (same origin) which the worker *can* read.
const AUTH_DB_NAME = 'mynaai-notification-actions';
const AUTH_DB_STORE = 'auth';
const AUTH_DB_ID = 'auth';

function openAuthDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(AUTH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTH_DB_STORE)) db.createObjectStore(AUTH_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeNotificationAuth(token, apiBaseUrl = API_BASE_URL) {
  try {
    const db = await openAuthDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTH_DB_STORE, 'readwrite');
      tx.objectStore(AUTH_DB_STORE).put({ id: AUTH_DB_ID, token, apiBaseUrl });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    // Non-fatal: action buttons from a closed app simply won't be able to call
    // the API without a mirror token; the in-app screen still works.
  }
}

export async function clearNotificationAuth() {
  try {
    const db = await openAuthDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTH_DB_STORE, 'readwrite');
      tx.objectStore(AUTH_DB_STORE).delete(AUTH_DB_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    // ignore
  }
}

export function getToken() {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return '';
  try {
    const parsed = JSON.parse(stored);
    return parsed?.token || '';
  } catch {
    return stored;
  }
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token }));
    writeNotificationAuth(token);
  }
}

export function clearSession() {
  resetPlanExpiredAlert();
  ['mynaai', 'mynaaiUser', 'isLoggedIn', 'userType', 'isNewSalon', 'FCM_TOKEN'].forEach(key => localStorage.removeItem(key));
  clearNotificationAuth();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('mynaai:session-expired'));
}

export function getServerUrl() {
  return API_BASE_URL;
}

// Uploads are reachable on the backend *only* under its `/getFiles` route, in
// that exact casing (the mobile app registers the route as `/getFiles`, and a
// case-sensitive router will not answer `/getfiles`). Stored paths are messy —
// `/public/uploads/x.jpg`, `public/uploads/x.jpg`, an absolute backend URL, or
// an already-prefixed `/getFiles/...` — so every one of them is normalised here.
// Missing prefix was why ad images requested
// `https://backend.mynaai.in/public/uploads/x.jpg` and never loaded.
export const FILES_ROUTE_PREFIX = '/getFiles';
const BACKEND_HOST = /(?:^|\.)mynaai\.in$/i;

function withFilesPrefix(relativePath) {
  const relative = relativePath.replace(/^\/+/, '').replace(/^getfiles\/+/i, '');
  if (!relative) return '';
  return `${API_BASE_URL}${FILES_ROUTE_PREFIX}/${relative}`;
}

// Rewrite a full URL that already points at our backend but skipped the route,
// so images stored as absolute URLs still resolve. Other hosts (a CDN, Razorpay)
// are left exactly as they are.
function repairBackendFileUrl(value) {
  try {
    const url = new URL(value);
    if (!BACKEND_HOST.test(url.hostname)) return value;
    if (url.pathname.toLowerCase().startsWith(`${FILES_ROUTE_PREFIX.toLowerCase()}/`)) return value;
    return `${url.origin}${FILES_ROUTE_PREFIX}/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function getFileUrl(path) {
  if (!path) return '';
  if (typeof path !== 'string') return '';
  const value = path.trim();
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return repairBackendFileUrl(value);
  if (value.startsWith('/assets/')) return value;
  return withFilesPrefix(value);
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  });
  const value = query.toString();
  return value ? `?${value}` : '';
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function isPlanExpiredPayload(data, httpStatus) {
  const candidates = [
    data?.status,
    data?.error,
    data?.code,
    data?.errorCode,
    data?.data?.status,
    data?.data?.error,
    data?.data?.code,
    data?.data?.errorCode,
    httpStatus,
  ];
  return candidates.some(value => String(value || '').toUpperCase() === 'PLAN_EXPIRED');
}

function dispatchPlanExpired(data, httpStatus) {
  if (typeof window === 'undefined' || isPlanAlertShown || !isPlanExpiredPayload(data, httpStatus)) return;
  isPlanAlertShown = true;
  window.dispatchEvent(new CustomEvent('mynaai:plan-expired', {
    detail: { data, httpStatus },
  }));
}

async function request(path, { method = 'GET', body, params, headers = {}, auth = true, signal } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const requestHeaders = { ...headers };
  if (!isFormData && body !== undefined && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const token = getToken();
  const hasAuthorizationHeader = Object.keys(requestHeaders).some(key => key.toLowerCase() === 'authorization');
  if (auth && token && !hasAuthorizationHeader) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}${queryString(params)}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : isFormData || typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  // This is the web equivalent of the mobile Axios response interceptor:
  // inspect every API response, including non-2xx responses, and notify the
  // mounted salon shell once so it can hard-reset to the renewal screen.
  dispatchPlanExpired(data, response.status);

  if (!response.ok) {
    const message = data?.message || data?.error || `Request failed (${response.status})`;
    if (data?.status === 'JWT_FAILED') clearSession();
    throw new ApiError(message, response.status, data);
  }
  if (data?.status === 'JWT_FAILED') {
    clearSession();
    throw new ApiError(data?.message || 'Your session has expired.', response.status, data);
  }
  return data;
}

const post = (path, body, options = {}) => request(path, { ...options, method: 'POST', body });
const get = (path, options = {}) => request(path, { ...options, method: 'GET' });
const put = (path, body, options = {}) => request(path, { ...options, method: 'PUT', body });
const del = (path, options = {}) => request(path, { ...options, method: 'DELETE' });

export const api = {
  // User API — endpoint names mirror src/services/communication.js in my_naai_app.
  sendRegisterOtp: userData => post('/api/users/send-otp-register', userData, { auth: false }),
  createUser: userData => post('/api/users/create', userData, { auth: false }),
  userOnBoard: userData => post('/api/users/onboard', userData, { auth: false }),
  userLogin: payload => post('/api/users/send-otp', payload, { auth: false }),
  verifyLogin: payload => post('/api/users/verify-otp', payload, { auth: false }),
  userProfile: ({ userId }) => get('/api/users/profile', { params: { userId } }),
  updateProfile: payload => post('/api/users/update', payload),
  userSalonList: payload => post('/api/salons/salon-list', payload),
  bookedSalonList: ({ userId }) => post('/api/booking/get-list', { userId }),
  userAds: () => get('/api/advertisement/get-advertisement'),
  toggleSaveSalon: payload => post('/api/users/toggle-saved-salon', payload),
  saveSalon: payload => post('/api/users/save-salon', payload),
  removeSalon: payload => post('/api/users/remove-salon', payload),
  userProductList: payload => post('/api/products/get-all-salons-products-list', payload),
  // Legacy mobile helpers choose the endpoint from the authenticated role.
  // Keep the explicit customer alias below for screens that must not depend on
  // ambient storage (this is also present in communication.js).
  userNotificationList: payload => {
    const role = String(payload?.userType || localStorage.getItem('userType') || '').toUpperCase();
    return post(role === 'SALON' ? '/api/notifications/get-salon-notification-list' : '/api/notifications/get-user-notification-list', payload);
  },
  userNotificationListUser: payload => post('/api/notifications/get-user-notification-list', payload),
  userNotificationCount: payload => {
    const role = String(payload?.userType || localStorage.getItem('userType') || '').toUpperCase();
    return get(role === 'SALON' ? '/api/notifications/get-notification-count' : '/api/notifications/get-user-notification-count', { params: payload });
  },

  // Booking API.
  salonByIdInfo: ({ salonId }) => post('/api/salons/get-salon-by-id', { salonId }),
  bookSalonService: payload => post('/api/booking/book', payload),
  createBookingRequest: payload => post('/api/bookingRequest/create-booking-request', payload),
  getBookingRequestById: bookingRequestId => get(`/api/bookingRequest/get-bookingRequest-by-id/${bookingRequestId}/`),
  bookingRequestCancel: bookingRequestId => post(`/api/booking/booking-request-cancel/${bookingRequestId}`, {}),
  customerDelayResponse: (bookingRequestId, payload) => post(`/api/bookingRequest/customer-delay-response/${bookingRequestId}/`, payload),
  bookingRequestOwnerAction: (bookingRequestId, payload) => post(`/api/bookingRequest/owner-action/${bookingRequestId}/`, payload),
  // The mobile owner-action contract also dispatches the customer delay notification.
  salonDelayBooking: (bookingRequestId, delayMinutes) => post(`/api/bookingRequest/owner-action/${bookingRequestId}/`, { action: 'DELAY', delayMinutes: String(delayMinutes) }),

  // Salon owner API.
  salonOwnerLogin: payload => post('/api/salons/send-register-otp', payload, { auth: false }),
  // Auth is attached when a session exists and skipped when it does not, so one
  // method serves both the logged-in renewal (where several backend builds
  // reject an unauthenticated order) and the pre-session registration flow.
  // `options.headers` carries the temporary verify-otp-register token.
  createPaymentOrder: (payload, options = {}) => post('/api/salons/create-payment-order', payload, options),
  createSalon: (payload, options = {}) => post('/api/salons/create-salon-with-plan', payload, options),
  renewSalon: payload => post('/api/salons/renew-salon-plan', payload),
  verifySalonOwnerLogin: payload => post('/api/salons/verify-otp-register', payload, { auth: false }),
  salonRequest: payload => post('/api/salonrequest/create-request', payload, { auth: false }),
  SalonLogin: payload => post('/api/salons/send-otp', payload, { auth: false }),
  verifySalonLogin: payload => post('/api/salons/login', payload, { auth: false }),
  customerList: payload => post('/api/booking/get-booking-list', payload),
  salonProfile: ({ salonId }) => post('/api/salons/get-salon', { salonId }),
  deleteSalonService: serviceId => post('/api/salons/delete-service', { serviceId }),
  deleteSalonBarber: barberId => del('/api/barbers/delete-barber', { body: { barberId } }),
  editSalonProfile: payload => post('/api/salons/edit-salon-profile', payload),
  updateSalonProfile: payload => post('/api/salons/update-salon', payload),
  SalonOpenClose: payload => post('/api/salons/open-close', payload),
  salonQueueHistory: () => get('/api/booking/get-completed-bookings'),
  bookingDone: payload => post('/api/booking/booking-complete', payload),
  getBarbersList: payload => get('/api/barbers/get-salon-barbers', { params: payload }),
  walkInBooking: payload => post('/api/booking/create-walk-in', payload),
  salonProductList: payload => post('/api/products/list', payload),
  createProductList: payload => post('/api/products/create', payload),
  updateProductList: payload => post('/api/products/update', payload),
  deleteProduct: productId => post('/api/products/delete', { productId }),
  salonNotificationList: payload => post('/api/notifications/get-salon-notification-list', payload),
  salonNotificationCount: payload => get('/api/notifications/get-notification-count', { params: payload }),

  uploadImages: formData => post('/api/upload/upload-image', formData, { auth: false }),
  // Friendly aliases for browser code.
  uploadImage: file => {
    const formData = new FormData();
    formData.append('image', file);
    return request('/api/upload/upload-image', { method: 'POST', body: formData, auth: false });
  },
};

export async function tryApi(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    if (fallback !== undefined) return typeof fallback === 'function' ? fallback(error) : fallback;
    throw error;
  }
}
