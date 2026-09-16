import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Apple,
  ArrowRight,
  AlarmClock,
  Bell,
  Bookmark,
  BookmarkCheck,
  CalendarCheck2,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  ExternalLink,
  Globe,
  Heart,
  HelpCircle,
  Info,
  LocateFixed,
  LogOut,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Play,
  Quote,
  Search,
  Scissors,
  Send,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Timer,
  UserRound,
  UsersRound,
  X,
  Zap,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage as getApiError } from './Shared';
import { normalizeAdImages } from '../lib/ads';
import { describeOffset } from '../lib/bookingTime';
import { getNotificationRoute, isActionableNotification } from '../lib/push';
import { armStoredReminders, cancelBookingReminder, remindersEnabled, scheduleBookingReminder, setRemindersEnabled } from '../lib/reminders';
import { stashPendingRoute } from '../lib/pendingRoute';
import { softNavigate } from '../lib/routes';

import { subscribeToLiveUpdates } from '../lib/socket';
import { LOGOUT_CONFIRM, useConfirm } from './ConfirmDialog';
import {
  Button,
  DetailRow,
  EmptyState,
  Field,
  GOLD,
  getBrowserLocation,
  formatDistanceInKm,
  getDistanceInKm,
  getErrorMessage,
  normalizeDistanceInKm,
  getSalonStatus,
  ImageWithFallback,
  Modal,
  normalizeSalon,
  PageHeader,
  Rating,
  SkeletonCard,
  Spinner,
  StatusPill,
  cx,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatTime,
  firstName,
} from './Shared';
import { NotificationDiagnostics } from './NotificationDiagnostics';

const USER_FALLBACK_IMAGE = '/assets/brand/naai-logo-dark.svg';
// On-brand placeholders for catalog items and specialists without an uploaded
// photo. The old defaults were stock pictures (an advert with a film roll, one
// specific barber's face repeated for every specialist), which looked like
// wrong data rather than "no photo yet". ImageWithFallback letterboxes these
// SVG tiles on a branded gradient (.image-fallback-tile).
const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';
const PERSON_PLACEHOLDER = '/assets/brand/person-placeholder.svg';

function getList(response, keys = []) {
  if (Array.isArray(response?.data)) return response.data;
  for (const key of keys) if (Array.isArray(response?.data?.[key])) return response.data[key];
  return [];
}

function getNotificationAction(item = {}, role = '') {
  const type = String(item.type || item.notificationType || item.notification_type || '').toUpperCase();
  const bookingRequestId = item.bookingRequestId || item.bookingId || item.booking_request_id || '';
  if (!type || !bookingRequestId || !isActionableNotification(type, role)) return null;
  const route = getNotificationRoute({ ...item, type, bookingRequestId }, role);
  if (!route?.name) return null;
  return {
    route,
    label: type === 'DELAY_TIME_PROPOSAL' ? 'Review delay' : type === 'DELAY_BOOKING' ? 'Open delay options' : 'Open booking request',
  };
}

function normalizeProduct(item = {}) {
  return {
    ...item,
    id: item.productId || item.id,
    name: item.productName || item.name || 'Unnamed product',
    price: item.price || 0,
    rating: Number(item.rating || 0),
    available: item.isAvailable ?? item.available ?? true,
    image: item.productImage || item.image || '',
    salonName: item.salon?.salonName || item.salonName || '',
  };
}

function getBookingStatus(item) {
  const passed = item?.bookingDate && new Date(`${String(item.bookingDate).split('T')[0]}T${String(item.bookingTime || '00:00').slice(0, 5)}:00`).getTime() < Date.now();
  const key = passed ? 'completed' : String(item?.status || 'pending').toLowerCase();
  return {
    key,
    label: key === 'confirmed' ? 'Confirmed' : key === 'completed' ? 'Completed' : key === 'cancelled' ? 'Cancelled' : 'Pending',
  };
}

function AdCarousel({ ads }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const startX = useRef(0);
  const slides = Array.isArray(ads) ? ads.filter(item => typeof item === 'string' && item) : [];
  useEffect(() => {
    if (paused || slides.length < 2) return undefined;
    const timer = window.setInterval(() => setActive(index => (index + 1) % slides.length), 3000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);
  useEffect(() => { if (active >= slides.length) setActive(0); }, [active, slides.length]);
  if (!slides.length) return null;
  const go = offset => setActive(index => (index + offset + slides.length) % slides.length);
  return (
    <div className="ad-carousel-wrap">
      <div
        className="ad-carousel"
        aria-label="Promotions"
        onPointerDown={event => { startX.current = event.clientX; setPaused(true); }}
        onPointerUp={event => {
          const delta = event.clientX - startX.current;
          if (delta > 40) go(-1);
          else if (delta < -40) go(1);
          setPaused(false);
        }}
        onPointerCancel={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="ad-track" style={{ transform: `translateX(-${active * 100}%)` }}>
          {slides.map((src, index) => (
            <div className="ad-slide" key={`${src}-${index}`}>
              <ImageWithFallback src={src} fallback="" alt="" className="ad-image" />
            </div>
          ))}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="carousel-dots">
          {slides.map((src, index) => (
            <button key={`${src}-dot-${index}`} type="button" aria-label={`Show promotion ${index + 1}`} className={cx('carousel-dot', index === active && 'active')} onClick={() => setActive(index)} />
          ))}
        </div>
      )}
    </div>
  );
}

function GenderToggle({ value, onChange }) {
  return <div className="gender-toggle" role="group" aria-label="Salon for male or female"><span className="gender-toggle-label">Salons for</span><button className={value === 'male' ? 'active' : ''} onClick={() => onChange('male')} aria-pressed={value === 'male'}>Male</button><button className={value === 'female' ? 'active' : ''} onClick={() => onChange('female')} aria-pressed={value === 'female'}>Female</button></div>;
}

// Every salon has its own route (`#/salon/<id>`) which is what the share
// button copies/sends — a guest opening that link lands straight on that
// salon's page (see parseRouteHash in App.jsx). Native share sheet when
// available, clipboard copy otherwise.
export function salonShareUrl(salon) {
  const id = salon.salonId || salon.id;
  return `${window.location.origin}/salon/${id}`;
}

async function shareSalon(salon, notify) {
  const url = salonShareUrl(salon);
  const name = salon.name || 'this salon';
  try {
    if (navigator.share) {
      await navigator.share({ title: `${name} on My Naai`, text: `Book ${name} on My Naai — join the queue without waiting at the shop.`, url });
      return;
    }
  } catch (shareError) {
    if (shareError?.name === 'AbortError') return; // user closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(url);
    notify?.('success', 'Salon link copied — share it anywhere.');
  } catch {
    // Legacy copy for browsers without the async clipboard API (no native
    // dialogs — those are banned app-wide); last resort, show the link in a
    // toast so the guest can copy it by hand.
    try {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
      notify?.('success', 'Salon link copied — share it anywhere.');
    } catch {
      notify?.('info', url);
    }
  }
}

function SalonCard({ salon, saved, onSelect, onBook, onShare, onBookmark, userLocation }) {
  const calculatedDistance = userLocation ? getDistanceInKm(userLocation.latitude, userLocation.longitude, salon.latitude, salon.longitude) : null;
  const distance = calculatedDistance !== null ? calculatedDistance : normalizeDistanceInKm(salon.distance);
  const distanceLabel = distance === null ? '' : formatDistanceInKm(distance);
  const openMap = event => {
    event.stopPropagation();
    if (salon.latitude && salon.longitude) window.open(`https://www.google.com/maps/search/?api=1&query=${salon.latitude},${salon.longitude}`, '_blank', 'noopener,noreferrer');
  };
  return (
    <article className="salon-card" onClick={() => onSelect(salon)}>
      <div className="salon-card-image-wrap">
        <ImageWithFallback src={salon.image} fallback={USER_FALLBACK_IMAGE} alt={salon.name} className="salon-card-image" />
        <span className="image-overlay-label"><i className={cx('status-dot', salon.isOpen && 'open')} />{salon.isOpen ? 'Open now' : 'Closed'}</span>
        {distanceLabel && <span className="distance-chip"><Navigation size={11} /> {distanceLabel}</span>}
        <button className={cx('bookmark-button', saved && 'saved')} onClick={event => { event.stopPropagation(); onBookmark(salon.id); }} aria-label={saved ? 'Remove bookmark' : 'Save salon'}>{saved ? <BookmarkCheck size={18} fill="currentColor" /> : <Bookmark size={18} />}</button>
      </div>
      <div className="salon-card-body">
        <div className="salon-card-heading"><div><span className="salon-type">{salon.genderType || 'UNISEX'} SALON</span><h3>{salon.name}</h3></div></div>
        <button className="salon-address" onClick={openMap}><MapPin size={14} /> <span>{salon.address}</span></button>
        <div className="salon-card-footer">
          <span className="wait-copy"><Clock3 size={14} /> {salon.isOpen ? salon.waitTime : 'Come back later'}</span>
          <div className="salon-card-cta">
            <button className="card-share-button" aria-label={`Share ${salon.name}`} onClick={event => { event.stopPropagation(); onShare(salon); }}><Share2 size={15} /></button>
            <button className={cx('card-book-button', !salon.isOpen && 'disabled')} disabled={!salon.isOpen} onClick={event => { event.stopPropagation(); onBook(salon); }}>{salon.isOpen ? 'Book now' : 'Closed'}</button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function HomeScreen({ session, navigate, notify }) {
  const [gender, setGender] = useState('male');
  const [search, setSearch] = useState('');
  const [salons, setSalons] = useState([]);
  const [ads, setAds] = useState([]);
  const [savedId, setSavedId] = useState(() => localStorage.getItem('mynaaiSavedSalonId') || null);
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [userName, setUserName] = useState(session?.user?.fullName || '');
  const requestId = useRef(0);
  const isGuest = !session?.userId;

  // Ads are loaded once, independently of search/gender, matching NaaiDashboard.
  useEffect(() => {
    let cancelled = false;
    api.userAds()
      .then(response => { if (!cancelled) setAds(normalizeAdImages(response)); })
      .catch(() => { if (!cancelled) setAds([]); });
    return () => { cancelled = true; };
  }, []);

  const loadData = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError('');

    // The mobile dashboard waits for the best available browser location before
    // building the salon-list body. That lets the API do its proximity work as
    // well as giving the UI a reliable distance to sort and display.
    const currentLocation = await getBrowserLocation();
    if (id !== requestId.current) return;
    setLocation(currentLocation);

    const salonPayload = {
      page: 1,
      searchString: search,
      genderType: gender,
      ...(currentLocation || {}),
    };

    try {
      // Guests get the token-free public list (same payload contract);
      // signed-in customers keep the personalized one (saved-flag etc.).
      const salonResult = await (session?.userId ? api.userSalonList(salonPayload) : api.userSalonListPublic(salonPayload));
      if (id !== requestId.current) return;

      const raw = getList(salonResult, ['salons', 'plans']);
      const decorated = raw.map(item => {
        const normalized = normalizeSalon(item);
        const distance = currentLocation
          ? getDistanceInKm(currentLocation.latitude, currentLocation.longitude, item.latitude, item.longitude)
          : null;
        return {
          ...normalized,
          // A server-side 0 is usually the missing-distance sentinel. Keep a
          // calculated zero (the salon really is within 50 m), but never carry
          // an unverified API zero to the card or nearest-first sort.
          distance: distance ?? normalizeDistanceInKm(item.distance),
          isSaved: item.isSaved ?? item.saved ?? item.isSavedSalon ?? false,
        };
      });

      // Match the mobile ordering: a saved salon remains prominent, then
      // listings with a known distance are nearest-first. When geolocation is
      // denied, the API response is intentionally retained as the fallback list.
      decorated.sort((left, right) => {
        if (left.isSaved !== right.isSaved) return left.isSaved ? -1 : 1;
        const leftDistance = Number.isFinite(left.distance) ? left.distance : Infinity;
        const rightDistance = Number.isFinite(right.distance) ? right.distance : Infinity;
        return leftDistance - rightDistance;
      });
      setSalons(decorated);

      // Keep the single-bookmark state in step with the API, like the app's
      // savedSalonId (only one salon can be bookmarked at a time).
      const apiSavedId = decorated.find(salon => salon.isSaved)?.id;
      if (apiSavedId) {
        setSavedId(apiSavedId);
        localStorage.setItem('mynaaiSavedSalonId', String(apiSavedId));
      }

      // Profile loading should not turn a successful salon-list response into
      // an empty screen. Guests browse without a session — there is no profile
      // to greet, so the greeting stays generic below.
      if (session?.userId) {
        try {
          const profile = await api.userProfile({ userId: session.userId });
          if (id === requestId.current && profile?.status === 'SUCCESS') {
            setUserName(currentName => profile.data?.fullName || currentName);
          }
        } catch (profileError) {
          console.debug(getErrorMessage(profileError, 'Unable to refresh the customer greeting.'));
          // The discovery list remains useful if the optional greeting request fails.
        }
      }
    } catch (error) {
      if (id !== requestId.current) return;
      setLoadError(getErrorMessage(error, 'Could not reach the salon network.'));
      notify?.('error', 'Showing the latest available salon list.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [gender, notify, search, session?.userId]);

  useEffect(() => {
    const timer = window.setTimeout(loadData, search ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [loadData, search]);

  const visibleSalons = useMemo(() => {
    const query = search.trim().toLowerCase();
    return salons.filter(salon => !query || `${salon.name} ${salon.address} ${salon.location}`.toLowerCase().includes(query));
  }, [salons, search]);

  // Browsing is open to everyone; only booking intent and personal actions
  // (bookmark) require a login. The guest's exact page is stashed so auth
  // returns them straight back here after login/register.
  const openSalon = item => navigate('salon', { salonId: item.id, salon: item });

  const bookSalon = item => {
    if (isGuest) {
      stashPendingRoute(`/salon/${item.id}`);
      notify?.('info', 'Login to book this salon.');
      navigate('login');
      return;
    }
    openSalon(item);
  };

  const bookmark = async salonId => {
    if (isGuest) {
      stashPendingRoute('/');
      notify?.('info', 'Login to save a salon.');
      navigate('login');
      return;
    }
    // Mirror the mobile dashboard: only one salon can be bookmarked at a time.
    if (savedId && savedId !== salonId) {
      notify?.('info', 'Bookmark exists. Please remove the previously saved salon first.');
      return;
    }
    try {
      const response = await api.toggleSaveSalon({ salonId });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not update saved salon.');
      const message = String(response?.message || '').toLowerCase();
      const next = message.includes('save') && !message.includes('unsave') ? salonId : null;
      setSavedId(next);
      if (next) localStorage.setItem('mynaaiSavedSalonId', String(next)); else localStorage.removeItem('mynaaiSavedSalonId');
      // Re-pin the saved salon to the top, like the app's post-toggle reload.
      setSalons(current => [...current].sort((left, right) => {
        if ((left.id === next) !== (right.id === next)) return left.id === next ? -1 : 1;
        const leftDistance = Number.isFinite(left.distance) ? left.distance : Infinity;
        const rightDistance = Number.isFinite(right.distance) ? right.distance : Infinity;
        return leftDistance - rightDistance;
      }));
      notify?.('success', next ? 'Salon saved.' : 'Salon removed from saved list.');
    } catch (error) { notify?.('error', getErrorMessage(error, 'Could not update saved salon.')); }
  };

  return (
    <div className="screen home-screen">
      {/* Section 1 — the discovery band: greeting, search and the male/female
          filter (which replaced the old dead-end "For you" button), with the
          ad carousel as its visual anchor. */}
      <section className="home-band home-hero-band" aria-label="Find a salon">
        <div className="home-topline"><div><span className="eyebrow">{isGuest ? 'SALON BOOKINGS, SIMPLIFIED' : 'NEARBY GROOMING'}</span><h1>{isGuest ? 'Find your salon' : `Hi ${firstName(userName)}`}</h1><p className="muted-line"><LocateFixed size={14} /> {location ? 'Using your current location' : isGuest ? 'Browse trusted salons around you — login only when you book' : 'Discover trusted specialists around you'}</p></div></div>
        <div className="home-search-row"><label className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find salon, specialist..." aria-label="Search salons" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label><GenderToggle value={gender} onChange={setGender} /></div>
        <AdCarousel ads={ads} />
      </section>
      {/* Section 2 — the salon listings, on its own panel so the page reads as
          distinct website sections instead of one long app feed. */}
      <section className="home-band home-salons-band" aria-label="Salons near you">
        <div className="section-heading"><div><span className="eyebrow">CURATED FOR YOU</span><h2>Salons near you</h2></div><span className="result-count">{loading ? 'Updating…' : `${visibleSalons.length} places`}</span></div>
        {loadError && <div className="inline-notice"><CircleAlert size={16} /> {loadError} <button onClick={loadData}>Try again</button></div>}
        {!loading && !location && <div className="inline-notice location-fallback-notice"><MapPin size={16} /> <span>Location is unavailable, so we are showing the available salon list without distance sorting.</span><button onClick={loadData}>Enable location</button></div>}
        {loading ? <div className="salon-grid">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} />)}</div> : visibleSalons.length ? <div className="salon-grid">{visibleSalons.map(salon => <SalonCard key={salon.id} salon={salon} saved={savedId === salon.id || salon.isSaved} onSelect={openSalon} onBook={bookSalon} onShare={item => shareSalon(item, notify)} onBookmark={bookmark} userLocation={location} />)}</div> : <EmptyState icon={Scissors} title="No salons found" message="Try another search or switch the salon type." />}
      </section>
      <div className="home-trust-row"><ShieldCheck size={16} /><span>Verified listings</span><i /><Clock3 size={16} /><span>Book in minutes</span><i /><Heart size={16} /><span>Made for your time</span></div>
      <TestimonialSection />
      <SiteFooter />
    </div>
  );
}

export function BookingsScreen({ session, notify }) {
  const confirm = useConfirm();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.bookedSalonList({ userId: session.userId });
      setBookings(getList(response, ['bookings', 'salons']));
    } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load bookings.')); } finally { setLoading(false); }
  }, [notify, session.userId]);
  useEffect(() => { load(); }, [load]);

  // Live booking updates ride the shared portal socket (polling → WebSocket)
  // in the `user_<id>` room, exactly like the mobile app's ServicesScreen.
  useEffect(() => subscribeToLiveUpdates({ scope: 'user', id: session.userId, event: 'booking_status_updated', handler: () => load() }), [load, session.userId]);

  const filtered = bookings.filter(item => filter === 'all' || getBookingStatus(item).key === filter);
  const cancel = async bookingId => {
    // In-app sheet instead of window.confirm: inside an installed PWA the native
    // dialog is unstyled, says "website says", and on some Android builds never
    // appears at all (the call then returns false and the button looks broken).
    const confirmed = await confirm({
      title: 'Cancel this booking?',
      message: 'Your slot will be released to the salon. You can always book a new time.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: CalendarX2,
    });
    if (!confirmed) return;
    const previous = bookings;
    setBookings(items => items.filter(item => item.bookingId !== bookingId));
    setCancelling(bookingId);
    try {
      const response = await api.bookingRequestCancel(bookingId);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Cancellation failed');
      cancelBookingReminder(bookingId);
      notify?.('success', 'Booking cancelled.');
    } catch (error) { setBookings(previous); notify?.('error', getErrorMessage(error, 'Could not cancel this booking.')); } finally { setCancelling(''); }
  };

  return <div className="screen bookings-screen"><PageHeader title="My bookings" subtitle="Keep every appointment in view." action={<button className="refresh-text-button" onClick={load}><Zap size={15} /> Live updates</button>} /><div className="booking-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <span>{bookings.length}</span></button><button className={filter === 'confirmed' ? 'active' : ''} onClick={() => setFilter('confirmed')}>Confirmed</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pending</button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>Completed</button></div>{loading ? <div className="list-stack">{[1, 2, 3].map(item => <SkeletonCard key={item} className="booking-skeleton" />)}</div> : filtered.length ? <div className="booking-list">{filtered.map((item, index) => { const status = getBookingStatus(item); const canCancel = !['completed', 'cancelled'].includes(status.key); return <article className="booking-card" key={item.bookingId || item.id || index}><div className="booking-calendar"><span>{new Date(item.bookingDate || Date.now()).toLocaleDateString('en-IN', { month: 'short' })}</span><strong>{new Date(item.bookingDate || Date.now()).getDate()}</strong><small>{new Date(item.bookingDate || Date.now()).toLocaleDateString('en-IN', { weekday: 'short' })}</small></div><div className="booking-main"><div className="booking-title-row"><div><span className="booking-label">APPOINTMENT</span><h3>{item.salonName || 'My Naai salon'}</h3><p>{item.salonCity || item.city || 'Nearby'}</p></div><StatusPill tone={status.key} dot>{status.label}</StatusPill></div><div className="booking-details"><span><UserRound size={14} /> {item.barberName || 'Any specialist'}</span><span><Scissors size={14} /> {item.serviceName || item.services || 'Salon service'}</span><span><Clock3 size={14} /> {formatTime(item.bookingTime)}</span></div>{canCancel && <button className="cancel-booking" onClick={() => cancel(item.bookingId)} disabled={cancelling === item.bookingId}>{cancelling === item.bookingId ? <Spinner size={14} /> : <><X size={14} /> Cancel booking</>}</button>}</div></article>; })}</div> : <EmptyState icon={CalendarCheck2} title="No bookings yet" message="Your next good hair day is only a few taps away." />}</div>;
}

export function ProductsScreen({ notify }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.userProductList({ page: 1, searchString: search });
      setProducts(getList(response, ['products']).map(normalizeProduct));
    } catch (error) { setProducts([]); notify?.('error', getErrorMessage(error, 'Unable to load products.')); } finally { setLoading(false); }
  }, [notify, search]);
  useEffect(() => { const timer = window.setTimeout(load, search ? 320 : 0); return () => window.clearTimeout(timer); }, [load, search]);
  const filtered = products.filter(product => `${product.name} ${product.salonName}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="screen products-screen"><PageHeader title="Products" subtitle="Little rituals from salons you love." action={<span className="catalog-label"><ShoppingBag size={15} /> Salon picks</span>} /><label className="search-field product-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></label>{loading ? <div className="product-grid">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} />)}</div> : filtered.length ? <div className="product-grid">{filtered.map(product => <article className="product-card" key={product.id}><div className="product-image-wrap"><ImageWithFallback src={product.image} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="product-image" /><span className={cx('stock-label', product.available ? 'in-stock' : 'out-stock')}>{product.available ? 'Available' : 'Out of stock'}</span></div><div className="product-copy"><span className="product-salon">{product.salonName || 'My Naai partner'}</span><h3>{product.name}</h3><div className="product-price-row"><strong>{formatCurrency(product.price)}</strong><Rating value={product.rating} /></div></div></article>)}</div> : <EmptyState icon={ShoppingBag} title="No products found" message="Try a different product name." />}</div>;
}

export function AccountScreen({ session, navigate, onLogout, notify, onSessionUpdate }) {
  const confirm = useConfirm();
  const [profile, setProfile] = useState(session.user || {});
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(session.user?.fullName || '');
  const [saving, setSaving] = useState(false);
  const onSessionUpdateRef = useRef(onSessionUpdate);
  onSessionUpdateRef.current = onSessionUpdate;

  // Same content as the app Account screen: name, phone, edit, About / FAQ /
  // Terms / help, then logout. Never replace the page with a spinner — session
  // already has the logged-in user, and refreshing profile must not loop.
  const load = useCallback(async () => {
    if (!session.userId) return;
    try {
      const response = await api.userProfile({ userId: session.userId });
      if (response?.status === 'SUCCESS' && response.data) {
        setProfile(current => ({ ...current, ...response.data }));
        onSessionUpdateRef.current?.(response.data);
      }
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Unable to load your profile.'));
    }
  }, [notify, session.userId]);
  useEffect(() => { load(); }, [load]);

  const save = async event => {
    event.preventDefault();
    if (!name.trim()) return notify?.('error', 'Name cannot be empty.');
    setSaving(true);
    try {
      const response = await api.updateProfile({ userId: session.userId, fullName: name.trim() });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Update failed');
      const next = { ...profile, fullName: name.trim() };
      setProfile(next);
      onSessionUpdateRef.current?.(next);
      setEditOpen(false);
      notify?.('success', 'Profile updated successfully.');
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not update profile.'));
    } finally {
      setSaving(false);
    }
  };

  const menus = [
    { label: 'About', caption: 'Why we built a better way to book', icon: Info, route: 'about' },
    { label: 'FAQ', caption: 'Quick answers about bookings', icon: HelpCircle, route: 'faq' },
    { label: 'Terms & Conditions', caption: 'The important fine print', icon: ShieldCheck, route: 'terms' },
    { label: 'Want Help ? Call on : 8380017393', caption: 'Talk to My Naai support', icon: Phone, action: () => window.open('tel:8380017393') },
  ];

  // Booking reminders ride the same single notification permission as push
  // (one funnel, nothing extra to grant). Turning the toggle on while the
  // browser is still neutral is the permission-plea moment.
  const [remindersOn, setRemindersOn] = useState(() => remindersEnabled());
  const toggleReminders = async () => {
    const next = !remindersOn;
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* prompt may be blocked */ }
      if (Notification.permission !== 'granted') {
        notify?.('info', 'Reminders need notification permission — allow it in the browser prompt.');
        return;
      }
    }
    setRemindersEnabled(next);
    setRemindersOn(next);
    if (next) armStoredReminders();
    notify?.('success', next ? 'Booking reminders on — 30 min before every visit.' : 'Booking reminders off.');
  };

  return (
    <div className="screen account-screen">
      <PageHeader title="Account" />
      <section className="profile-card customer-profile-card">
        <div className="profile-copy">
          <h2>{profile.fullName || session.user?.fullName || 'User'}</h2>
          <p><Phone size={14} /> {profile.phoneNumber || session.user?.phoneNumber || ''}</p>
        </div>
        <button className="edit-profile-button" type="button" onClick={() => { setName(profile.fullName || session.user?.fullName || ''); setEditOpen(true); }}>
          Edit Profile
        </button>
      </section>
      <div className="account-card">
        <div className="account-menu-row reminder-toggle-row">
          <span className="account-menu-icon"><AlarmClock size={18} /></span>
          <span><strong>Booking reminders</strong><small>Get reminded 30 minutes before your slot</small></span>
          <button
            type="button"
            className={cx('switch-toggle', remindersOn && 'on')}
            role="switch"
            aria-checked={remindersOn}
            aria-label="Toggle booking reminders"
            onClick={toggleReminders}
          ><span /></button>
        </div>
        {menus.map(item => (
          <button className="account-menu-row" key={item.label} type="button" onClick={item.action || (() => navigate(item.route))}>
            <span className="account-menu-icon"><item.icon size={18} /></span>
            <span><strong>{item.label}</strong><small>{item.caption}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <button
        className="logout-button customer-logout"
        type="button"
        onClick={async () => { if (await confirm(LOGOUT_CONFIRM)) onLogout(); }}
      >
        <LogOut size={16} /> Logout
      </button>
      <NotificationDiagnostics />
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <form className="modal-form" onSubmit={save}>
          <Field label="Name"><input value={name} onChange={event => setName(event.target.value)} placeholder="Name" autoFocus /></Field>
          <Field label="Mobile Number" hint="Your mobile number is used for OTP login."><input value={profile.phoneNumber || session.user?.phoneNumber || ''} disabled /></Field>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Weekday helpers for the salon business-hours block. The partner editor
// stores the weekly off as a day index string ("0" = Sunday … "6" = Saturday)
// while older records may carry the day name itself — render either as a day
// name so the public page never shows a bare number.
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function holidayDayName(day) {
  if (day === null || day === undefined || day === '') return '';
  const numeric = Number(day);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 6) return WEEK_DAYS[Math.trunc(numeric)];
  const label = String(day).trim();
  const named = WEEK_DAYS.find(name => name.toLowerCase() === label.toLowerCase());
  return named || label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

export function SalonDetailScreen({ session, params, navigate, notify }) {
  const [salon, setSalon] = useState(params?.salon || null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const [imageOpen, setImageOpen] = useState(false);
  const load = useCallback(async () => {
    try { const response = await api.salonByIdInfo({ salonId: params?.salonId }); if (response?.status === 'SUCCESS') setSalon(response.data); else throw new Error(response?.message || 'Salon not found'); } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load salon details.')); } finally { setLoading(false); }
  }, [notify, params?.salonId]);
  useEffect(() => { load(); }, [load]);
  // The salon card the user tapped is handed over in route params, so the
  // detail page can paint instantly and swap in the fresher payload when it
  // lands. A full-page spinner here hid content that was already on screen.
  if (loading && !salon) return <div className="screen detail-screen"><PageHeader title="Salon details" onBack={() => navigate(-1)} /><div className="detail-loading"><Spinner label="Loading salon…" /></div></div>;
  if (!salon) return <div className="screen"><EmptyState title="Salon unavailable" message="This salon may have moved or closed." action={<Button onClick={() => navigate('home')}>Back to salons</Button>} /></div>;
  const normalized = normalizeSalon(salon);
  const details = { ...salon, ...normalized };
  const images = details.images?.length ? details.images : [details.image];
  const status = getSalonStatus(details.businessHours, details.isOpen);
  const isGuest = !session?.userId;
  // A deep-linked guest's route id is the one id that is always known — the
  // fetched salon payload may arrive later (or lack the field entirely).
  const salonRouteId = details.id || params?.salonId;
  // Booking intent is where the login requirement kicks in — the guest keeps
  // their exact salon page via the pending-route stash, and auth resumes it.
  const continueToBooking = () => {
    if (isGuest) {
      stashPendingRoute(`/salon/${salonRouteId}`);
      notify?.('info', 'Login is required to book this salon.');
      navigate('login');
      return;
    }
    navigate('services', { salon: details, salonId: salonRouteId });
  };
  // Every public detail the API knows about the salon, normalised once so the
  // sections below stay declarative.
  const services = details.services || [];
  const barbers = details.barbers || [];
  const schedules = (Array.isArray(details.businessHours) ? details.businessHours : [details.businessHours])
    .filter(entry => entry && (entry.openingTime || entry.closingTime));
  const primaryHours = schedules[0] || {};
  const holidayDays = [...new Set(schedules.flatMap(entry => (entry.holidayDays || []).map(holidayDayName)).filter(Boolean))];
  const openDays = WEEK_DAYS.filter(day => !holidayDays.includes(day));
  const fullAddress = [details.addressLine1 || details.address, details.addressLine2, details.city || details.location, details.state, details.pincode]
    .map(value => String(value || '').trim()).filter(Boolean).join(', ');
  const infoRows = [
    details.phoneNumber && { icon: Phone, label: 'Call the salon', value: `+91 ${details.phoneNumber}`, href: `tel:${details.phoneNumber}` },
    fullAddress && { icon: MapPin, label: 'Address', value: fullAddress, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`, external: true },
    { icon: Store, label: 'Salon type', value: `${details.genderType || 'UNISEX'} salon` },
    details.ownerName && { icon: UserRound, label: 'Managed by', value: details.ownerName },
    details.email && { icon: Mail, label: 'Email', value: details.email, href: `mailto:${details.email}` },
  ].filter(Boolean);
  return (
    <div className="screen detail-screen" aria-busy={loading || undefined}>
      <PageHeader
        title={details.name}
        subtitle={`${details.genderType || 'UNISEX'} salon`}
        onBack={() => navigate(-1)}
        action={<div className="detail-header-actions"><button className="icon-btn ghost" onClick={() => shareSalon(details, notify)} aria-label="Share salon"><Share2 size={18} /></button>{details.phoneNumber && <button className="icon-btn ghost" onClick={() => window.open(`tel:${details.phoneNumber}`)} aria-label="Call salon"><Phone size={18} /></button>}</div>}
      />
      <div className="detail-hero">
        <div className="detail-gallery">
          <ImageWithFallback src={images[active]} fallback={USER_FALLBACK_IMAGE} alt={details.name} className="detail-main-image" onClick={() => setImageOpen(true)} />
          <button className="gallery-expand" onClick={() => setImageOpen(true)} aria-label="Open image"><ExternalLink size={16} /></button>
          {images.length > 1 && <div className="gallery-thumbs">{images.map((image, index) => <button key={`${image}-${index}`} className={index === active ? 'active' : ''} onClick={() => setActive(index)}><ImageWithFallback src={image} fallback={USER_FALLBACK_IMAGE} alt="" /></button>)}</div>}
        </div>
        <div className="detail-overview">
          <div className="detail-title-row"><div><span className="salon-type">{details.genderType || 'UNISEX'} SALON</span><h2>{details.name}</h2></div></div>
          <div className="detail-status-line">
            <StatusPill tone={status.isOpen ? 'open' : 'closed'} dot>{status.text}</StatusPill>
            {primaryHours.openingTime && <span><Clock3 size={14} /> {formatTime(primaryHours.openingTime)} – {formatTime(primaryHours.closingTime)}</span>}
          </div>
          <button className="detail-location" onClick={() => window.open(fullAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}` : `https://www.google.com/maps/search/?api=1&query=${details.latitude},${details.longitude}`, '_blank', 'noopener,noreferrer')}><MapPin size={17} /><span>{fullAddress || 'Address unavailable'}</span><ExternalLink size={14} /></button>
          <div className="detail-stat-grid">
            <div><Timer size={17} /><span><small>Current wait</small><strong>{details.waitTime || '10–15 min'}</strong></span></div>
            <div><Scissors size={17} /><span><small>Services</small><strong>{services.length || '—'} to choose</strong></span></div>
            <div><UsersRound size={17} /><span><small>Specialists</small><strong>{barbers.length || '—'}</strong></span></div>
          </div>
          <div className="arrival-note"><Zap size={16} /><span><strong>Before you arrive</strong> Come 10 minutes before your slot and follow the latest appointment status.</span></div>
          <Button className="detail-book-inline" onClick={continueToBooking}>{isGuest ? 'Login to book' : 'Book salon'} <ArrowRight size={17} /></Button>
          {isGuest && <p className="detail-book-note">Login is required to book this salon — it takes less than a minute.</p>}
        </div>
      </div>

      {/* All public details of the salon. */}
      <section className="detail-section">
        <div className="section-heading compact"><div><span className="eyebrow">ABOUT THE SALON</span><h2>Salon details</h2></div></div>
        <div className="detail-info-card">
          {infoRows.map(row => (
            <a key={row.label} className="detail-info-row" href={row.href} target={row.external ? '_blank' : undefined} rel={row.external ? 'noopener,noreferrer' : undefined}>
              <span className="detail-info-icon"><row.icon size={16} /></span>
              <span className="detail-info-copy"><small>{row.label}</small><strong>{row.value}</strong></span>
              {row.href && <ChevronRight size={16} className="detail-info-chev" />}
            </a>
          ))}
        </div>
      </section>

      {/* Every service the salon lists — never just a preview. */}
      <section className="detail-section">
        <div className="section-heading compact"><div><span className="eyebrow">SERVICES & PRICES</span><h2>All services</h2></div><span className="result-count">{services.length} services</span></div>
        {services.length ? (
          <div className="detail-service-list">
            {services.map(service => {
              const serviceKey = service.serviceId || service.id || service.serviceName || service.name;
              const duration = Number(service.durationMinutes || service.duration || 0);
              return (
                <div className="detail-service-row" key={serviceKey}>
                  <span className="service-select-icon"><Scissors size={16} /></span>
                  <span className="detail-service-copy"><strong>{service.serviceName || service.name}</strong><small>{[duration ? `${duration} min` : '', service.description || ''].filter(Boolean).join(' · ') || 'Salon service'}</small></span>
                  <b>{formatCurrency(service.price)}</b>
                </div>
              );
            })}
          </div>
        ) : <p className="detail-empty-note">This salon has not listed its services yet — call the salon for the latest prices and offerings.</p>}
      </section>

      {/* Business hours and the days the salon works, when the owner set them. */}
      <section className="detail-section">
        <div className="section-heading compact"><div><span className="eyebrow">TIMINGS</span><h2>Business hours & days</h2></div><StatusPill tone={status.isOpen ? 'open' : 'closed'} dot>{status.text}</StatusPill></div>
        {schedules.length ? (
          <div className="detail-hours-card">
            {schedules.map((entry, index) => (
              <div className="detail-hours-row" key={entry.businessHourId || entry.id || index}>
                <span className="detail-info-icon"><Clock3 size={16} /></span>
                <span className="detail-info-copy"><small>{schedules.length > 1 ? `Schedule ${index + 1}` : 'Working hours'}</small><strong>{formatTime(entry.openingTime)} – {formatTime(entry.closingTime)}</strong></span>
              </div>
            ))}
            {(primaryHours.breakStartTime || primaryHours.breakEndTime) && (
              <div className="detail-hours-row"><span className="detail-info-icon"><AlarmClock size={16} /></span><span className="detail-info-copy"><small>Break time</small><strong>{formatTime(primaryHours.breakStartTime)} – {formatTime(primaryHours.breakEndTime)}</strong></span></div>
            )}
            <div className="detail-days-block">
              <small>{holidayDays.length ? 'Open days' : 'Open all days of the week'}</small>
              <div className="detail-days-row">
                {openDays.map(day => <span key={day} className="day-chip">{day}</span>)}
                {holidayDays.map(day => <span key={day} className="day-chip off">{day} — weekly off</span>)}
              </div>
            </div>
          </div>
        ) : <p className="detail-empty-note">The salon has not shared its timings yet — call the salon before you visit.</p>}
      </section>

      {/* The team — the barbers a customer can pick during booking. */}
      <section className="detail-section">
        <div className="section-heading compact"><div><span className="eyebrow">THE TEAM</span><h2>Barbers & specialists</h2></div><span className="result-count">{barbers.length} specialists</span></div>
        {barbers.length ? (
          <div className="detail-barber-grid">
            {barbers.map(barber => {
              const barberKey = barber.barberId || barber.id || barber.fullName || barber.name;
              return (
                <div className="detail-barber-card" key={barberKey}>
                  <ImageWithFallback src={barber.profileImageUrl || barber.image} fallback={PERSON_PLACEHOLDER} alt={barber.fullName || barber.name} className="detail-barber-image" />
                  <strong>{barber.fullName || barber.name}</strong>
                  <span className={barber.isAvailable ? 'available' : 'unavailable'}><i />{barber.isAvailable ? 'Available' : 'Away'}</span>
                  <small><Star size={12} fill="currentColor" /> {barber.ratingAverage || barber.rating || '0.0'}</small>
                </div>
              );
            })}
          </div>
        ) : <p className="detail-empty-note">No specialists added yet — any available barber will take care of you.</p>}
      </section>

      <SiteFooter />
      <div className="sticky-continue">
        <div><span>Ready when you are?</span><small>{isGuest ? 'Login is required to book this salon' : 'Pick services, a specialist and a time slot'}</small></div>
        <Button onClick={continueToBooking}>{isGuest ? 'Login to book' : 'Book salon'} <ArrowRight size={17} /></Button>
      </div>
      <Modal open={imageOpen} onClose={() => setImageOpen(false)} title={details.name} size="image"><ImageWithFallback src={images[active]} fallback={USER_FALLBACK_IMAGE} alt={details.name} className="modal-full-image" /></Modal>
    </div>
  );
}

export function ServicesScreen({ params, navigate, notify }) {
  const salon = params?.salon || {};
  const services = salon.services || [];
  const [selected, setSelected] = useState([]);
  const toggle = item => setSelected(current => current.some(value => (value.serviceId || value.id) === (item.serviceId || item.id)) ? current.filter(value => (value.serviceId || value.id) !== (item.serviceId || item.id)) : [...current, item]);
  const total = selected.reduce((sum, item) => sum + Number(item.price || 0), 0);
  return <div className="screen services-screen"><PageHeader title="Select services" subtitle={salon.salonName || salon.name} onBack={() => navigate(-1)} /><div className="selection-summary"><span><Scissors size={17} /> Pick one or more</span><strong>{selected.length ? `${selected.length} selected · ${formatCurrency(total)}` : 'Nothing selected yet'}</strong></div>{services.length ? <div className="select-service-grid">{services.map(item => { const itemId = item.serviceId || item.id; const active = selected.some(value => (value.serviceId || value.id) === itemId); return <button key={itemId} className={cx('select-service-card', active && 'active')} onClick={() => toggle(item)}><span className="service-select-icon">{active ? <Check size={17} /> : <Scissors size={17} />}</span><span className="service-card-copy"><strong>{item.serviceName || item.name}</strong><small>{item.durationMinutes || item.duration || 30} min · {item.description || 'Professional salon service'}</small></span><b>{formatCurrency(item.price)}</b></button>; })}</div> : <EmptyState icon={Scissors} title="No services listed" message="Please check back with this salon." />}{selected.length > 0 && <div className="sticky-continue"><div><span>{selected.length} service{selected.length > 1 ? 's' : ''}</span><small>Next, choose a barber and time</small></div><Button onClick={() => navigate('schedule', { salon, selectedServices: selected })}>Choose a time <ArrowRight size={17} /></Button></div>}</div>;
}

function getServiceDurationMinutes(service = {}) {
  const value = service.durationMinutes ?? service.duration;
  const duration = Number.parseFloat(String(value));
  return Number.isFinite(duration) && duration > 0 ? duration : 30;
}

function createTimeSlots(open = '09:00', close = '21:00') {
  const [openHour, openMinute] = String(open).slice(0, 5).split(':').map(Number);
  const [closeHour, closeMinute] = String(close).slice(0, 5).split(':').map(Number);
  let start = openHour * 60 + openMinute;
  let end = closeHour * 60 + closeMinute;
  if (end <= start) end += 24 * 60;
  const slots = [];
  for (let minutes = start; minutes < end; minutes += 10) {
    const normal = minutes % (24 * 60);
    const hour = Math.floor(normal / 60);
    const minute = normal % 60;
    slots.push({ value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, label: formatTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`) });
  }
  return slots;
}

export function ScheduleScreen({ params, navigate, notify }) {
  const salon = params?.salon || {};
  const services = params?.selectedServices || [];
  const [dayOffset, setDayOffset] = useState(0);
  const [barber, setBarber] = useState(null);
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(false);
  const schedule = {
    openingTime: '09:00:00',
    closingTime: '21:00:00',
    holidayDays: [],
    ...((Array.isArray(salon.businessHours) ? salon.businessHours[0] : salon.businessHours) || {}),
  };
  const date = new Date(Date.now() + dayOffset * 86400000);
  const bookingDate = date.toISOString().slice(0, 10);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const holiday = (schedule.holidayDays || []).some(day => String(day).toLowerCase() === weekday.toLowerCase());
  const slots = useMemo(() => createTimeSlots(schedule.openingTime, schedule.closingTime), [schedule.openingTime, schedule.closingTime]);
  const booked = useMemo(() => {
    const day = (salon.bookedSlots || []).find(item => String(item.date || item.bookingDate || '').slice(0, 10) === bookingDate);
    const asMinutes = value => {
      const [hour, minute] = String(value || '').slice(0, 5).split(':').map(Number);
      return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
    };
    return (day?.slots || []).map(item => [asMinutes(item.start || item.startTime), asMinutes(item.end || item.endTime)])
      .filter(([start, end]) => start !== null && end !== null && end > start);
  }, [bookingDate, salon.bookedSlots]);
  const serviceDuration = Math.max(10, services.reduce((total, item) => total + getServiceDurationMinutes(item), 0));
  const toMinutes = value => { const [hour, minute] = String(value).slice(0, 5).split(':').map(Number); return hour * 60 + minute; };
  const isPast = useCallback(value => dayOffset === 0 && (() => { const [h, m] = value.split(':').map(Number); const now = new Date(); return h * 60 + m <= now.getHours() * 60 + now.getMinutes(); })(), [dayOffset]);
  const isBooked = useCallback(value => { const current = toMinutes(value); return booked.some(([start, end]) => current >= start && current < end); }, [booked]);
  const availableSlots = useMemo(() => {
    const opening = toMinutes(schedule.openingTime);
    const closing = toMinutes(schedule.closingTime);
    const closingAbsolute = closing <= opening ? closing + 1440 : closing;
    return slots.filter(slot => {
      if (isPast(slot.value)) return false;
      const rawStart = toMinutes(slot.value);
      const start = closing <= opening && rawStart < opening ? rawStart + 1440 : rawStart;
      const end = start + serviceDuration;
      if (end > closingAbsolute || isBooked(slot.value)) return false;
      return !booked.some(([bookedStart, bookedEnd]) => {
        const normalizedStart = closing <= opening && bookedStart < opening ? bookedStart + 1440 : bookedStart;
        const normalizedEnd = closing <= opening && bookedEnd < opening ? bookedEnd + 1440 : bookedEnd;
        return normalizedStart < end && normalizedEnd > start;
      });
    });
  }, [booked, isBooked, isPast, schedule.closingTime, schedule.openingTime, serviceDuration, slots]);
  useEffect(() => { setTime(availableSlots[0]?.value || ''); }, [availableSlots]);
  const confirm = async () => {
    if (!time) return notify?.('error', holiday ? `This salon is closed on ${weekday}.` : 'Please choose an available time.');
    if (!services.length) return notify?.('error', 'Please select at least one service.');
    setLoading(true);
    try {
      const response = await api.createBookingRequest({ salonId: salon.salonId || salon.id, barberId: barber?.barberId || barber?.id || '', bookingDate, bookingTime: time, services: services.map(item => item.serviceId || item.id) });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Booking failed');
      notify?.('success', 'Request sent — wait for the salon response.');
      // Alarm/reminder through the same (single) notification permission as
      // push: 30 minutes before the slot the visitor gets a heads-up. Rejects
      // silently when the funnel is unavailable — the booking already went
      // through, so nothing here may block navigation.
      const bookingId = response?.data?.bookingRequestId || response?.data?.bookingId || '';
      scheduleBookingReminder({ bookingId, bookingDate, bookingTime: time, salonName: salon.salonName || salon.name })
        .then(outcome => { if (outcome) notify?.('info', 'Reminder set — 30 min before your visit.'); })
        .catch(() => {});
      navigate('bookings');
    } catch (error) { notify?.('error', getErrorMessage(error, 'Could not send booking request.')); } finally { setLoading(false); }
  };
  return <div className="screen schedule-screen"><PageHeader title="Schedule appointment" subtitle={salon.salonName || salon.name} onBack={() => navigate(-1)} /><section className="schedule-section"><div className="section-label"><UserRound size={17} /><span>Choose a barber <small>Optional</small></span></div><div className="barber-scroll">{(salon.barbers || []).map(item => { const active = (barber?.barberId || barber?.id) === (item.barberId || item.id); return <button key={item.barberId || item.id} className={cx('barber-card', active && 'active')} onClick={() => setBarber(active ? null : item)}><ImageWithFallback src={item.profileImageUrl || item.image} fallback={PERSON_PLACEHOLDER} alt={item.fullName || item.name} className="barber-image" /><strong>{item.fullName || item.name}</strong><span className={item.isAvailable ? 'available' : 'unavailable'}><i />{item.isAvailable ? 'Available' : 'Away'}</span><small><Star size={12} fill="currentColor" /> {item.ratingAverage || item.rating || '0.0'}</small></button>; })}{!(salon.barbers || []).length && <p className="muted-line">Any available barber will take care of you.</p>}</div></section><section className="schedule-section"><div className="section-label"><CalendarDays size={17} /><span>Choose a date</span></div><div className="date-choice-row">{[0, 1, 2].map(offset => { const optionDate = new Date(Date.now() + offset * 86400000); return <button key={offset} className={cx('date-choice', dayOffset === offset && 'active')} onClick={() => setDayOffset(offset)}><small>{offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : 'Day after'}</small><strong>{optionDate.getDate()}</strong><span>{optionDate.toLocaleDateString('en-IN', { month: 'short' })}</span></button>; })}</div></section><section className="schedule-section"><div className="section-label"><Clock3 size={17} /><span>Choose a time <small>{holiday ? `Closed on ${weekday}` : 'Available 10 minute slots'}</small></span></div>{holiday ? <div className="holiday-note"><CircleAlert size={18} /><span>Salon is closed on {weekday}. Choose another day.</span></div> : availableSlots.length ? <div className="time-grid">{availableSlots.map(slot => <button key={slot.value} className={cx('time-slot', time === slot.value && 'active')} onClick={() => setTime(slot.value)}>{slot.label}</button>)}</div> : <div className="holiday-note availability-empty"><CircleAlert size={18} /><span>No available time slots for {weekday}. Please choose another day.</span></div>}</section><div className="schedule-total"><div><span>Estimated total</span><strong>{formatCurrency(services.reduce((sum, item) => sum + Number(item.price || 0), 0))}</strong></div><Button loading={loading} onClick={confirm}>Confirm booking <Check size={17} /></Button></div></div>;
}

export function NotificationsScreen({ session, notify, navigate }) {
  const isSalon = session.role === 'SALON';
  const role = isSalon ? 'SALON' : 'USER';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [delayModal, setDelayModal] = useState(null);
  const [delayMinutes, setDelayMinutes] = useState('15');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = isSalon
        ? await api.salonNotificationList({ salonId: session.userId, page: 1 })
        : await api.userNotificationListUser({ userId: session.userId, page: 1 });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Unable to load notifications.');
      setItems(getList(response, ['notifications', 'notificationList', 'list', 'items', 'results']));
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to load notifications.');
      setLoadError(message);
      notify?.('error', message);
    } finally { setLoading(false); }
  }, [isSalon, notify, session.userId]);

  useEffect(() => { load(); }, [load]);

  const handleSalonAction = async (item, action) => {
    const bookingRequestId = item.bookingRequestId || item.bookingId || item.booking_request_id || item.id;
    if (!bookingRequestId) {
      notify?.('error', 'Booking request ID not found.');
      return;
    }
    if (action === 'DELAY') {
      setDelayModal({ item, bookingRequestId });
      return;
    }
    setActionLoading(`${bookingRequestId}-${action}`);
    try {
      const response = await api.bookingRequestOwnerAction(bookingRequestId, action);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || `${action} failed`);
      notify?.('success', action === 'ACCEPT' ? 'Booking accepted!' : 'Booking rejected.');
      // Refresh list
      load();
      // Navigate to queue if accepted
      if (action === 'ACCEPT') {
        setTimeout(() => navigate('queue'), 800);
      }
    } catch (error) {
      notify?.('error', getErrorMessage(error, `Could not ${action.toLowerCase()} booking.`));
    } finally {
      setActionLoading('');
    }
  };

  const handleDelayConfirm = async () => {
    if (!delayModal) return;
    const minutes = parseInt(delayMinutes, 10);
    if (!minutes || minutes < 1) {
      notify?.('error', 'Enter valid delay minutes.');
      return;
    }
    setActionLoading(`${delayModal.bookingRequestId}-DELAY`);
    try {
      const response = await api.salonDelayBooking(delayModal.bookingRequestId, String(minutes));
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Delay failed');
      notify?.('success', `Customer notified — ${minutes} min delay proposed.`);
      setDelayModal(null);
      load();
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not send delay request.'));
    } finally {
      setActionLoading('');
    }
  };

  const isBookingRequest = (item) => {
    const type = String(item.type || item.notificationType || '').toUpperCase();
    return type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING';
  };

  return <div className="screen notifications-screen">
    <PageHeader title="Notifications" subtitle={isSalon ? 'Booking requests and salon updates — tap to act.' : 'Updates about your appointments.'} onBack={() => navigate(isSalon ? 'queue' : 'home')} action={<button className="icon-btn ghost" onClick={load} aria-label="Refresh notifications"><Zap size={18} /></button>} />
    {loadError && !loading && <div className="inline-notice notification-error"><CircleAlert size={16} /><span>{loadError}</span><button onClick={load}>Try again</button></div>}
    {loading ? <div className="notification-list">{[1, 2, 3].map(item => <SkeletonCard key={item} className="notification-skeleton" />)}</div> : items.length ? <div className="notification-list">{items.map((item, index) => {
      const action = getNotificationAction(item, role);
      const bookingType = isBookingRequest(item);
      const bookingId = item.bookingRequestId || item.bookingId || '';
      return <article className={cx('notification-card', action && 'notification-actionable', bookingType && isSalon && 'notification-booking-request')} key={item.notificationId || item.id || index}>
        <div className="notification-icon"><Bell size={17} /></div>
        <div style={{ flex: 1 }}>
          <div className="notification-heading"><h3>{item.title || 'My Naai update'}</h3><span>{formatDateTime(item.createdAt)}</span></div>
          <p>{item.body || item.message || 'You have a new update from My Naai.'}</p>
          {bookingType && bookingId && <span className="notification-type-pill">{String(item.type || '').replace(/_/g, ' ')}</span>}
          <div className="notification-card-actions">
            {action && <button className="notification-open-button" type="button" onClick={() => navigate(action.route.name, action.route.params)}>{action.label}<ArrowRight size={14} /></button>}
            {isSalon && bookingType && bookingId && (
              <>
                <button className="notification-action-btn accept" disabled={!!actionLoading} onClick={() => handleSalonAction(item, 'ACCEPT')}>
                  {actionLoading === `${bookingId}-ACCEPT` ? '...' : <><Check size={14} /> Accept</>}
                </button>
                <button className="notification-action-btn reject" disabled={!!actionLoading} onClick={() => handleSalonAction(item, 'REJECT')}>
                  {actionLoading === `${bookingId}-REJECT` ? '...' : <><X size={14} /> Reject</>}
                </button>
                <button className="notification-action-btn delay" disabled={!!actionLoading} onClick={() => handleSalonAction(item, 'DELAY')}>
                  <Clock size={14} /> Delay
                </button>
              </>
            )}
          </div>
        </div>
      </article>;
    })}</div> : !loadError && <EmptyState icon={Bell} title="No notifications yet" message="We will keep important booking updates here. Booking requests will show Accept / Reject / Delay actions." />}

    <Modal open={!!delayModal} onClose={() => setDelayModal(null)} title="Propose delay">
      <p className="modal-lede">How many minutes delay do you need? The customer will be asked to accept the new time.</p>
      <Field label="Delay minutes">
        <select value={delayMinutes} onChange={e => setDelayMinutes(e.target.value)} className="select-field">
          <option value="5">5 minutes earlier/later</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="20">20 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
        </select>
      </Field>
      <div className="form-actions">
        <Button variant="secondary" onClick={() => setDelayModal(null)}>Cancel</Button>
        <Button loading={!!actionLoading} onClick={handleDelayConfirm}>Send delay request</Button>
      </div>
    </Modal>
  </div>;
}

export function DelayRequestScreen({ params, navigate, notify }) {
  const [loading, setLoading] = useState('');
  const accept = async action => {
    setLoading(action);
    try { await api.customerDelayResponse(params.bookingRequestId, { action }); notify?.('success', action === 'ACCEPT' ? 'New time accepted.' : 'You kept your original time.'); navigate('bookings'); } catch (error) { notify?.('error', getErrorMessage(error, 'Could not update this request.')); } finally { setLoading(''); }
  };
  // A salon can now also offer an EARLIER slot from the queue, which arrives as
  // a negative delayMinutes. Reading the sign here keeps the screen honest:
  // telling a customer their appointment "needs a little more time" when it has
  // actually been pulled forward would make them arrive late.
  const offsetMinutes = Number(params.delayMinutes);
  const isEarlier = Number.isFinite(offsetMinutes) && offsetMinutes < 0;
  const offsetLabel = Number.isFinite(offsetMinutes) && offsetMinutes !== 0 ? describeOffset(offsetMinutes) : '';
  const reason = String(params.reason || '').trim();
  return <div className="screen delay-screen"><PageHeader title={isEarlier ? 'Earlier time available' : 'Delay request'} subtitle="The salon has suggested a new time." onBack={() => navigate(-1)} /><div className="delay-card"><div className="delay-icon"><Clock3 size={26} /></div><span className="eyebrow">ACTION NEEDED</span><h2>{isEarlier ? 'Your salon can see you earlier.' : 'Your appointment needs a little more time.'}</h2><p>{offsetLabel ? <>The salon has asked to move your booking <strong>{offsetLabel}</strong>.</> : <>The salon has asked to move your booking to a new time.</>}</p>{reason && <p className="delay-reason">“{reason}”</p>}<div className="proposed-time"><span>New suggested time</span><strong>{params.proposedTime || 'Updated time'}</strong></div><small>{isEarlier ? 'Can you make the earlier time?' : 'Would you like to accept this change?'}</small></div><div className="delay-actions"><Button variant="success" loading={loading === 'ACCEPT'} onClick={() => accept('ACCEPT')}>Accept change <Check size={17} /></Button><Button variant="danger" loading={loading === 'REJECT'} onClick={() => accept('REJECT')}>Keep original <X size={17} /></Button></div></div>;
}

const INFO_CONTENT = {
  about: { title: 'About My Naai', eyebrow: 'THE COMPANY', intro: 'Welcome to My Naai — the salon booking platform that gives your time back. Find a trusted salon nearby, book a slot and skip the waiting bench.', sections: [
    { title: 'Welcome to My Naai', text: 'My Naai (mynaai.in) connects customers with trusted local salons and helps salon owners run a calmer, fuller day. People book from anywhere and walk straight in; owners see bookings reach their phone instantly. The platform is built in India and is growing salon by salon — starting with the salons and specialists you already know around you.' },
    { title: 'What you can do here', bullets: ['Browse nearby salons free — no login needed', 'Open any salon’s own page with services, prices and live wait time', 'Book a slot and get a reminder before your visit', 'Salon owners: manage bookings, queue and listing from your phone'] },
    { title: 'Our vision', text: 'A world where nobody wastes an afternoon sitting in a salon queue — every visit booked, every chair busy, every customer on time.' },
    { title: 'Our mission', text: 'To make booking a salon as simple as calling one — and to give every neighbourhood salon the booking tools big chains take for granted, straight on their phone.' },
    { title: 'What we value', bullets: ['Time first — both the customer’s and the salon’s', 'Transparency — real prices, real wait times, verified partners', 'Local businesses — neighbourhood salons deserve modern tools', 'Payments stay at the salon — never through an app'] },
    { title: 'About our app', app: true, text: 'My Naai runs right here in your browser — full browsing, booking and live updates. For the app feel on Android, grab it on Google Play; the iOS app is coming soon, and until then adding this site to your Home Screen works the same way.', bullets: ['Android app on Google Play', 'iOS app coming soon', 'Everything works on the web too — nothing is held back'] },
  ] },
  faq: { title: 'Frequently asked questions', eyebrow: 'NEED TO KNOW', sections: [{ title: 'How do I book a salon?', text: 'Choose your salon, select one or more services, pick an available specialist and time, then confirm your booking request.' }, { title: 'Can I cancel a booking?', text: 'Yes. Open My bookings and choose Cancel booking on a pending or confirmed appointment.' }, { title: 'What happens after I send a request?', text: 'The salon receives your request and confirms it. You will see the latest status in My bookings and receive an update.' }, { title: 'Can I use My Naai as a salon owner?', text: 'Absolutely. Use Continue as Salon Partner on the login screen to sign in or register your salon.' }] },
  terms: { title: 'Terms & Conditions', eyebrow: 'PLEASE READ', date: 'Effective Date: 09 January 2026', intro: 'Welcome to MyNaai. By accessing or using the MyNaai website or app, you accept these Terms and Conditions. If you do not agree with any part of them, please do not continue to use the service.', sections: [{ title: '1. The service', text: 'MyNaai connects you with nearby salons so you can request an appointment, follow its status and keep track of your bookings. Appointments remain requests until the salon confirms them.', bullets: ['Choose a salon, services, specialist and time', 'The salon confirms, declines or proposes a new time', 'Arrive at least 10 minutes before your slot'] }, { title: '2. Your account', text: 'You are responsible for keeping your login OTP and account secure and for everything that happens under it. Please keep your name and mobile number accurate and up to date — booking alerts reach you through them.' }, { title: '3. Bookings, delays and cancellations', text: 'Cancel as early as possible so the salon can offer the slot to another customer. The salon may decline or change a request based on availability, and may propose a small time delay you can accept or decline.', bullets: ['You can cancel from My bookings while the visit is upcoming', 'A salon delay offer needs your acceptance to take effect', 'Repeated last-minute cancellations may limit booking'] }, { title: '4. Payments', text: 'All payments are made directly at the salon — not through MyNaai. Price ranges shown on salon pages are indicative; the salon determines the final amount.' }, { title: '5. Fair use', text: 'Please use MyNaai respectfully: accurate details at booking, no misuse of salons\u2019 or other users\u2019 information, and no attempts to disrupt the service. We may suspend accounts that abuse the platform.' }, { title: '6. Privacy', text: 'Your privacy matters to us. The Privacy Policy on this site explains what we collect, how we use it and the choices you have — it is part of these terms.' }, { title: '7. Service changes', text: 'We may improve, modify or pause parts of the service at any time. We are not liable for any modification, suspension or discontinuance, though we always aim to communicate material changes on this page.' }, { title: '8. Questions', text: 'MyNaai is built in India. For anything about these terms, call 8380017393 or write to support@mynaai.com.' }] },
  privacy: { title: 'Privacy Policy', eyebrow: 'YOUR DATA', date: 'Effective Date: 09 January 2026', intro: 'MyNaai (“we”, “our”, “us”) operates the MyNaai mobile application and website. This Privacy Policy explains how we collect, use and protect your information when you use our services.', sections: [{ title: '1. Information we collect', text: 'Personal information:', bullets: ['Name', 'Mobile number', 'Email address (optional)', 'Location (city/area only)', 'Profile details (optional)'] }, { title: 'Booking information', bullets: ['Selected salon', 'Appointment date & time', 'Service details'] }, { title: 'Device information', bullets: ['Device type', 'Operating system', 'App version', 'IP address (for security & analytics)'] }, { title: '2. What we do NOT collect', text: 'We do not collect or store: credit or debit card details, UPI or wallet information, bank account details or any online payment information. All payments are made directly at the salon and not through the app.' }, { title: '3. How we use your information', bullets: ['To show nearby salons', 'To enable appointment booking', 'To notify you about booking updates and reminders', 'To improve app performance and user experience', 'To prevent fraud and misuse'] }, { title: '4. Location information', text: 'MyNaai may use approximate location (city or area) to show nearby salons. We do not track real-time or background location.' }, { title: '5. Data sharing', text: 'We do not sell or rent your personal data. Information may be shared only:', bullets: ['With the selected salon for booking confirmation', 'When required by law', 'To protect users and platform security'] }, { title: '6. Data security', text: 'We use reasonable security measures such as secure servers and encrypted communication to protect user data. However, no method of transmission over the internet is 100% secure.' }, { title: '7. Children\u2019s privacy', text: 'MyNaai is not intended for children under the age of 13. We do not knowingly collect personal information from children.' }, { title: '8. Your rights', bullets: ['Update or correct your profile', 'Request account deletion', 'Contact us for data-related concerns'] }, { title: '9. Third-party services', text: 'We may use third-party services for analytics, notifications, and app performance monitoring. These services have their own privacy policies.' }, { title: '10. Changes to this policy', text: 'We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated effective date.' }, { title: '11. Contact us', text: 'MyNaai — Email: support@mynaai.com · Location: India. You can also call our support team on 8380017393.' }] },
  contact: { title: 'Contact us', eyebrow: 'TALK TO US', intro: 'Booking help, account questions or a salon partnership — call, email or write to the My Naai team. We answer every day.' },
};

// The Android app on Google Play — the web version tells visitors it exists.
// iOS is "coming soon"; until then the full booking flow lives on this site.
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mynaai&hl=en';

// One polished app-badge pair used by the footer AND the About page — proper
// store buttons: icon tile, eyebrow line, store name.
export function StoreBadges() {
  return (
    <div className="store-badges" role="group" aria-label="Get the My Naai app">
      <a className="store-badge" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get the My Naai app on Google Play">
        <span className="store-badge-icon"><Play size={19} fill="currentColor" /></span>
        <span className="store-badge-text"><small>GET THE APP</small><strong>Google Play</strong></span>
        <ChevronRight size={15} />
      </a>
      <span className="store-badge store-badge-soon" aria-disabled="true" title="The iOS app is coming soon — until then the web app works everywhere">
        <span className="store-badge-icon"><Apple size={19} /></span>
        <span className="store-badge-text"><small>COMING SOON</small><strong>iOS App Store</strong></span>
      </span>
    </div>
  );
}

// Website-style footer for the public pages (home `#/`, salon, About/FAQ/
// Terms). Hash-link anchors keep it fully route-based in both the guest shell
// and the signed-in shell — no special casing, the router resolves them.
// Real path hrefs keep the links valid for search engines and "open in new
// tab"; the click handler turns them into router pushes (no reload) inside
// the app, guest or signed-in, because the route listener owns popstate.
function footerNav(event) {
  const href = event.currentTarget.getAttribute('href');
  if (!href || href.startsWith('tel:')) return;
  event.preventDefault();
  softNavigate(href);
}

// Starter stories shown on the public pages — short, phone-friendly quotes.
// Owners can swap the copy anytime; keep it this length so cards stay compact.
const TESTIMONIALS = [
  { quote: 'Booked my haircut from the bus and walked straight in — no more waiting on the bench.', name: 'Rahul Deshmukh', meta: 'Customer' },
  { quote: 'The reminder before my slot means I never miss my booking any more.', name: 'Sneha Waghmare', meta: 'Customer' },
  { quote: 'Found my regular salon through My Naai. Browsing is free; login came only when I booked.', name: 'Priya Kulkarni', meta: 'Customer' },
  { quote: 'Every salon page shows prices and the live wait — no surprises at the counter.', name: 'Aniket Sahare', meta: 'Customer' },
  { quote: 'Booking requests buzz straight on my phone — I never miss a customer now.', name: 'Amit Jichkar', meta: 'Salon partner' },
  { quote: 'My chairs stay busy during the day instead of everyone arriving at the same time.', name: 'Neha Bawankar', meta: 'Salon partner' },
];

// The ratings row sits right above the site footer on the public pages —
// social proof on the way out. It is a real carousel: swipe/drag on touch,
// arrows on the heading row, and it auto-advances gently until interacted
// with, so any number of reviews works.
export function TestimonialSection() {
  const trackRef = useRef(null);
  const userDroveRef = useRef(false);
  const move = useCallback(direction => {
    const track = trackRef.current;
    if (!track) return;
    const cardWidth = track.firstElementChild?.getBoundingClientRect().width || 300;
    track.scrollBy({ left: direction * (cardWidth + 12), behavior: 'smooth' });
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      const track = trackRef.current;
      if (!track || userDroveRef.current) return; // nobody fights a user
      const max = track.scrollWidth - track.clientWidth;
      if (max <= 0) return; // everything fits — no carousel needed
      const cardWidth = track.firstElementChild?.getBoundingClientRect().width || 300;
      const nearEnd = track.scrollLeft + 8 >= max;
      track.scrollTo({ left: nearEnd ? 0 : track.scrollLeft + cardWidth + 12, behavior: 'smooth' });
    }, 4200);
    return () => window.clearInterval(id);
  }, []);
  const stopAuto = () => { userDroveRef.current = true; };
  return (
    <section className="testimonial-section" aria-label="What people say about My Naai" onPointerDown={stopAuto}>
      <div className="section-heading"><div><span className="eyebrow">REAL STORIES</span><h2>What customers & salon owners say</h2></div><div className="testimonial-nav"><button type="button" onClick={() => { stopAuto(); move(-1); }} aria-label="Previous reviews"><ChevronRight size={17} className="rotate-180" /></button><button type="button" onClick={() => { stopAuto(); move(1); }} aria-label="Next reviews"><ChevronRight size={17} /></button></div></div>
      <div className="testimonial-track" ref={trackRef}>
        {TESTIMONIALS.map(item => (
          <figure className="testimonial-card" key={item.name}>
            <span className="testimonial-quote"><Quote size={16} /></span>
            <span className="testimonial-stars" aria-label="5 out of 5 stars">{[1, 2, 3, 4, 5].map(star => <Star key={star} size={13} fill="currentColor" />)}</span>
            <blockquote>{item.quote}</blockquote>
            <figcaption><strong>{item.name}</strong><small>{item.meta}</small></figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// The salon partner landing page (/salon-partner): what My Naai offers an
// owner, how onboarding works, and one-tap entry into the partner login /
// registration flow — the same content the app shows only after signing in,
// public like the customer-facing home page.
const PARTNER_BENEFITS = [
  { icon: Compass, title: 'Get discovered nearby', body: 'Customers searching for a salon around you see your listing, timings and live wait time.' },
  { icon: Bell, title: 'Bookings with a buzzer', body: 'New booking requests reach your phone instantly with sound and vibration.' },
  { icon: Scissors, title: 'Manage your own page', body: 'Update services, prices, photos and opening hours whenever you like.' },
  { icon: Timer, title: 'A calmer waiting room', body: 'Customers book slots and arrive on time instead of crowding in the evening.' },
];

const PARTNER_STEPS = [
  { step: '1', title: 'Register your salon', body: 'Sign in with your mobile number and add your salon details.' },
  { step: '2', title: 'Go live on the map', body: 'Your salon is listed for customers browsing nearby.' },
  { step: '3', title: 'Receive bookings', body: 'Accept requests, manage the queue and keep your chairs busy.' },
];

export function PartnerScreen({ navigate }) {
  const startPartner = () => navigate('login', { role: 'SALON' });
  return (
    <div className="screen partner-screen">
      <section className="partner-hero">
        <div className="partner-hero-copy">
          <span className="eyebrow">FOR SALON OWNERS</span>
          <h1>Your salon, <em>fully booked.</em></h1>
          <p>List your salon on My Naai and let customers book instead of wait. You manage everything from your phone.</p>
          <div className="partner-hero-actions">
            <Button onClick={startPartner}>Register your salon <ArrowRight size={17} /></Button>
            <button className="partner-signin" type="button" onClick={startPartner}>Already a partner? Sign in</button>
          </div>
        </div>
        <div className="partner-hero-card" aria-hidden="true">
          <Store size={34} />
          <strong>New booking request</strong>
          <span>Haircut · Rakesh · Arriving in 20 min</span>
          <div className="partner-hero-card-actions"><i>Accept</i><i>Delay</i></div>
        </div>
      </section>
      <section className="partner-benefits" aria-label="Why join My Naai">
        <div className="section-heading"><div><span className="eyebrow">WHY MY NAAI</span><h2>Built for your salon’s day</h2></div></div>
        <div className="partner-benefit-grid">
          {PARTNER_BENEFITS.map(benefit => (
            <div className="partner-benefit" key={benefit.title}>
              <benefit.icon size={20} />
              <strong>{benefit.title}</strong>
              <p>{benefit.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="partner-steps" aria-label="How it works">
        <div className="section-heading"><div><span className="eyebrow">GETTING STARTED</span><h2>Live in three steps</h2></div></div>
        <div className="partner-step-grid">
          {PARTNER_STEPS.map(item => (
            <div className="partner-step" key={item.step}>
              <span className="partner-step-num">{item.step}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="partner-cta-band">
        <div><span className="eyebrow">READY?</span><h2>Grow your salon with My Naai</h2><p>Register in minutes — our team verifies the details and your salon goes live.</p></div>
        <Button onClick={startPartner}><Store size={16} /> Register your salon</Button>
      </section>
      <TestimonialSection />
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <strong>My Naai</strong>
          <p>Book your salon. Skip the wait.</p>
          <StoreBadges />
          <p className="site-footer-webnote"><Globe size={13} /> On iPhone or a computer? Everything works right here on the web.</p>
        </div>
        <nav className="site-footer-col" aria-label="Explore">
          <h3>Explore</h3>
          <a href="/" onClick={footerNav}>Salons near you</a>
          <a href="/about" onClick={footerNav}>About</a>
          <a href="/faq" onClick={footerNav}>FAQ</a>
          <a href="/contact" onClick={footerNav}>Contact</a>
        </nav>
        <nav className="site-footer-col" aria-label="Salon partners">
          <h3>Salon partners</h3>
          <a href="/salon-partner" onClick={footerNav}>Partner opportunities</a>
          <a href="/login?role=SALON" onClick={footerNav}>Register your salon</a>
          <a href="/login?role=SALON" onClick={footerNav}>Partner sign in</a>
        </nav>
        <nav className="site-footer-col" aria-label="Support and legal">
          <h3>Support & legal</h3>
          <a href="tel:8380017393"><Phone size={13} /> Support: 8380017393</a>
          <a href="mailto:support@mynaai.com"><Mail size={13} /> support@mynaai.com</a>
          <a href="/terms" onClick={footerNav}>Terms &amp; Conditions</a>
          <a href="/privacy-policy" onClick={footerNav}>Privacy Policy</a>
        </nav>
      </div>
      <div className="site-footer-bottom"><span>© {new Date().getFullYear()} My Naai · All rights reserved</span><a href="/" onClick={footerNav}>mynaai.in</a></div>
    </footer>
  );
}

// Website-styled info pages (About / FAQ / Terms / Privacy): a full-width page
// hero and a card grid on the same rail as every other public page, instead of
// the app-style narrow column these screens used before. Inside the signed-in
// app shell `showBack` adds the back control — the app chrome keeps the
// in-app feel the client asked for ("the website stays a website, login is the
// app").
export function InfoScreen({ type, navigate, showBack = false }) {
  if (type === 'contact') return <ContactScreen navigate={navigate} showBack={showBack} />;
  const content = INFO_CONTENT[type] || INFO_CONTENT.about;
  return (
    <div className={cx('screen info-screen site-info-screen', ['terms', 'privacy'].includes(type) && 'legal-screen')}>
      {showBack && <div className="site-info-back-row"><button className="icon-btn ghost" onClick={() => navigate(-1)} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button></div>}
      <header className="site-info-hero">
        <span className="eyebrow">{content.eyebrow}</span>
        <h1>{content.title}</h1>
        {content.date && <p className="site-info-date">{content.date}</p>}
        <p>{content.intro || 'Everything you need to know about using My Naai.'}</p>
      </header>
      <div className="site-info-grid">
        {content.sections.map(section => (
          <section key={section.title} className="site-info-card">
            <h2>{section.title}</h2>
            {section.text && <p>{section.text}</p>}
            {section.bullets && <ul>{section.bullets.map(item => <li key={item}><CheckCircle2 size={16} />{item}</li>)}</ul>}
            {section.app && <StoreBadges />}
          </section>
        ))}
      </div>
      <div className="info-contact"><span className="info-contact-icon"><Phone size={18} /></span><div><strong>Need more help?</strong><p>Call our support team on 8380017393</p></div><button onClick={() => window.open('tel:8380017393')}><ArrowRight size={17} /></button></div>
      <SiteFooter />
    </div>
  );
}

// The My Naai company contact channels — one source of truth so the cards
// and the footer never disagree.
export const CONTACT_PHONE = '8380017393';
export const CONTACT_EMAIL = 'support@mynaai.com';
const CONTACT_CHANNELS = [
  { icon: Phone, label: 'Call us', value: CONTACT_PHONE, href: `tel:${CONTACT_PHONE}`, note: 'Support, bookings and salon partners — every day.' },
  { icon: Mail, label: 'Email', value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}`, note: 'We reply within 24 hours on working days.' },
  { icon: Globe, label: 'Website', value: 'mynaai.in', href: '/', note: 'Everything works on the web — browse, book, manage.' },
  { icon: MapPin, label: 'Location', value: 'India', note: 'Built in India, growing salon by salon.' },
];

const CONTACT_SUBJECTS = ['Booking help', 'My account', 'Salon partnership', 'Feedback', 'Something else'];

// The My Naai contact page as a real website page: company contact details,
// then a working contact form. There is no contact inbox API, so the form
// composes a ready-to-send email addressed to support — the visitor's own
// mail app opens with everything filled in, and the page confirms it.
export function ContactScreen({ navigate, showBack = false }) {
  const [form, setForm] = useState({ name: '', contact: '', subject: CONTACT_SUBJECTS[0], message: '' });
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const submit = event => {
    event.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Please tell us your name.');
    const contact = form.contact.trim();
    if (!contact) return setError('Please share a phone number or email so we can reach you.');
    if (!/^\d{10}$/.test(contact) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return setError('Enter a 10-digit mobile number or a valid email address.');
    if (!form.message.trim()) return setError('Please write your message — a line or two is enough.');
    const subject = encodeURIComponent(`My Naai — ${form.subject} (${form.name.trim()})`);
    const body = encodeURIComponent(`Name: ${form.name.trim()}\nPhone / email: ${contact}\nTopic: ${form.subject}\n\n${form.message.trim()}\n\n— Sent from the mynaai.in contact page`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  };
  return (
    <div className="screen info-screen site-info-screen contact-screen">
      {showBack && <div className="site-info-back-row"><button className="icon-btn ghost" onClick={() => navigate(-1)} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button></div>}
      <header className="site-info-hero">
        <span className="eyebrow">TALK TO US</span>
        <h1>Contact us</h1>
        <p>Questions about a booking, your account or partnering with My Naai — reach the team directly or send a message below. We answer every day.</p>
      </header>
      <div className="contact-layout">
        <div className="contact-details">
          <div className="contact-details-heading"><span className="eyebrow">MY NAAI SUPPORT</span><h2>Reach us directly</h2></div>
          {CONTACT_CHANNELS.map(channel => {
            const inner = <><span className="contact-detail-icon"><channel.icon size={18} /></span><span className="contact-detail-copy"><small>{channel.label}</small><strong>{channel.value}</strong><span>{channel.note}</span></span>{channel.href ? <ChevronRight size={16} className="contact-detail-chev" /> : null}</>;
            return channel.href
              ? <a key={channel.label} className="contact-detail-card" href={channel.href} onClick={channel.href === '/' ? footerNav : undefined}>{inner}</a>
              : <div key={channel.label} className="contact-detail-card">{inner}</div>;
          })}
          <div className="contact-hours-note"><Clock3 size={15} /><span>Support is available on call and email <strong>every day</strong> — booking help never waits for Monday.</span></div>
        </div>
        <div className="contact-form-card">
          <span className="eyebrow">SEND A MESSAGE</span>
          <h2>Write to the My Naai team</h2>
          {sent ? (
            <div className="contact-success">
              <span className="contact-success-icon"><CheckCircle2 size={22} /></span>
              <strong>Your message is ready to send</strong>
              <p>We opened your email app with the message filled in — press send there and it reaches us. Nothing opened? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or call <a href={`tel:${CONTACT_PHONE}`}>{CONTACT_PHONE}</a>.</p>
              <Button variant="secondary" size="small" onClick={() => { setSent(false); setForm({ name: '', contact: '', subject: CONTACT_SUBJECTS[0], message: '' }); }}>Write another message</Button>
            </div>
          ) : (
            <form className="contact-form" onSubmit={submit} noValidate>
              {error && <div className="form-error" role="alert"><Info size={16} />{error}</div>}
              <div className="contact-form-row">
                <Field label="Your name"><input value={form.name} onChange={set('name')} placeholder="Full name" autoComplete="name" /></Field>
                <Field label="Phone or email"><input value={form.contact} onChange={set('contact')} placeholder="10-digit mobile or email" autoComplete="tel-email" /></Field>
              </div>
              <Field label="What is this about?">
                <span className="select-wrap">
                  <select value={form.subject} onChange={set('subject')}>
                    {CONTACT_SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </span>
              </Field>
              <Field label="Your message"><textarea rows="5" value={form.message} onChange={set('message')} placeholder="Tell us how we can help — we reply within 24 hours." /></Field>
              <Button type="submit"><Send size={16} /> Send message</Button>
              <p className="contact-form-note">Prefer to talk? Call <a href={`tel:${CONTACT_PHONE}`}>{CONTACT_PHONE}</a> or WhatsApp us — or write directly to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
            </form>
          )}
        </div>
      </div>
      {/* The partnership band only makes sense on the public website — inside
          the signed-in app there is no partner landing route to send a
          customer to. showBack is the in-app marker. */}
      {!showBack && (
        <section className="partner-cta-band contact-cta-band">
          <div><span className="eyebrow">OWN A SALON?</span><h2>List it on My Naai</h2><p>Register your salon in minutes — customers nearby discover you, book with you and arrive on time.</p></div>
          <Button onClick={() => navigate('partner')}><Store size={16} /> Explore partnership</Button>
        </section>
      )}
      <SiteFooter />
    </div>
  );
}
