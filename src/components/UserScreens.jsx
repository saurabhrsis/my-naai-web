import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Bookmark,
  BookmarkCheck,
  CalendarCheck2,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  ExternalLink,
  Heart,
  HelpCircle,
  Info,
  LocateFixed,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  Search,
  Scissors,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Timer,
  UserRound,
  X,
  Zap,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage as getApiError } from './Shared';
import { normalizeAdImages } from '../lib/ads';
import { describeOffset } from '../lib/bookingTime';
import { getNotificationRoute, isActionableNotification } from '../lib/push';

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
  return <div className="gender-toggle" role="group" aria-label="Salon type"><button className={value === 'male' ? 'active' : ''} onClick={() => onChange('male')}>Male</button><button className={value === 'female' ? 'active' : ''} onClick={() => onChange('female')}>Female</button></div>;
}

function SalonCard({ salon, saved, onSelect, onBookmark, userLocation }) {
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
        <div className="salon-card-footer"><span className="wait-copy"><Clock3 size={14} /> {salon.isOpen ? salon.waitTime : 'Come back later'}</span><button className={cx('card-book-button', !salon.isOpen && 'disabled')} disabled={!salon.isOpen} onClick={event => { event.stopPropagation(); onSelect(salon); }}>{salon.isOpen ? 'Book now' : 'Closed'}</button></div>
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
  const [userName, setUserName] = useState(session.user?.fullName || '');
  const requestId = useRef(0);

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
      const salonResult = await api.userSalonList(salonPayload);
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
      // an empty screen.
      try {
        const profile = await api.userProfile({ userId: session.userId });
        if (id === requestId.current && profile?.status === 'SUCCESS') {
          setUserName(currentName => profile.data?.fullName || currentName);
        }
      } catch (profileError) {
        console.debug(getErrorMessage(profileError, 'Unable to refresh the customer greeting.'));
        // The discovery list remains useful if the optional greeting request fails.
      }
    } catch (error) {
      if (id !== requestId.current) return;
      setLoadError(getErrorMessage(error, 'Could not reach the salon network.'));
      notify?.('error', 'Showing the latest available salon list.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [gender, notify, search, session.userId]);

  useEffect(() => {
    const timer = window.setTimeout(loadData, search ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [loadData, search]);

  const visibleSalons = useMemo(() => {
    const query = search.trim().toLowerCase();
    return salons.filter(salon => !query || `${salon.name} ${salon.address} ${salon.location}`.toLowerCase().includes(query));
  }, [salons, search]);

  const bookmark = async salonId => {
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
      <div className="home-topline"><div><span className="eyebrow">NEARBY GROOMING</span><h1>Hi {firstName(userName)}</h1><p className="muted-line"><LocateFixed size={14} /> {location ? 'Using your current location' : 'Discover trusted specialists around you'}</p></div><div className="home-actions"><GenderToggle value={gender} onChange={setGender} /></div></div>
      <div className="home-search-row"><label className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find salon, specialist..." aria-label="Search salons" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label><button className="filter-button" onClick={() => notify?.('info', 'Use Male or Female to change salon recommendations.')}><Sparkles size={17} /><span>For you</span></button></div>
      <AdCarousel ads={ads} />
      <div className="section-heading"><div><span className="eyebrow">CURATED FOR YOU</span><h2>Salons near you</h2></div><span className="result-count">{loading ? 'Updating…' : `${visibleSalons.length} places`}</span></div>
      {loadError && <div className="inline-notice"><CircleAlert size={16} /> {loadError} <button onClick={loadData}>Try again</button></div>}
      {!loading && !location && <div className="inline-notice location-fallback-notice"><MapPin size={16} /> <span>Location is unavailable, so we are showing the available salon list without distance sorting.</span><button onClick={loadData}>Enable location</button></div>}
      {loading ? <div className="salon-grid">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} />)}</div> : visibleSalons.length ? <div className="salon-grid">{visibleSalons.map(salon => <SalonCard key={salon.id} salon={salon} saved={savedId === salon.id || salon.isSaved} onSelect={item => navigate('detail', { salonId: item.id, salon: item })} onBookmark={bookmark} userLocation={location} />)}</div> : <EmptyState icon={Scissors} title="No salons found" message="Try another search or switch the salon type." />}
      <div className="home-trust-row"><ShieldCheck size={16} /><span>Verified listings</span><i /><Clock3 size={16} /><span>Book in minutes</span><i /><Heart size={16} /><span>Made for your time</span></div>
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

export function SalonDetailScreen({ params, navigate, notify }) {
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
  const hours = details.businessHours?.[0];
  return <div className="screen detail-screen" aria-busy={loading || undefined}><PageHeader title={details.name} subtitle={`${details.genderType || 'UNISEX'} salon`} onBack={() => navigate(-1)} action={<button className="icon-btn ghost" onClick={() => window.open(`tel:${details.phoneNumber || ''}`)} aria-label="Call salon"><Phone size={18} /></button>} /><div className="detail-hero"><div className="detail-gallery"><ImageWithFallback src={images[active]} fallback={USER_FALLBACK_IMAGE} alt={details.name} className="detail-main-image" onClick={() => setImageOpen(true)} /><button className="gallery-expand" onClick={() => setImageOpen(true)} aria-label="Open image"><ExternalLink size={16} /></button>{images.length > 1 && <div className="gallery-thumbs">{images.map((image, index) => <button key={`${image}-${index}`} className={index === active ? 'active' : ''} onClick={() => setActive(index)}><ImageWithFallback src={image} fallback={USER_FALLBACK_IMAGE} alt="" /></button>)}</div>}</div><div className="detail-overview"><div className="detail-title-row"><div><span className="salon-type">{details.genderType || 'UNISEX'} SALON</span><h2>{details.name}</h2></div></div><div className="detail-status-line"><StatusPill tone={status.isOpen ? 'open' : 'closed'} dot>{status.text}</StatusPill>{hours && <span><Clock3 size={14} /> {formatTime(hours.openingTime)} – {formatTime(hours.closingTime)}</span>}</div><button className="detail-location" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${details.latitude},${details.longitude}`, '_blank', 'noopener,noreferrer')}><MapPin size={17} /><span>{details.address || 'Address unavailable'}</span><ExternalLink size={14} /></button><div className="detail-stat-grid"><div><Timer size={17} /><span><small>Current wait</small><strong>{details.waitTime || '10–15 min'}</strong></span></div><div><Scissors size={17} /><span><small>Services</small><strong>{details.services?.length || 0} to choose</strong></span></div></div><div className="arrival-note"><Zap size={16} /><span><strong>Before you arrive</strong> Come 10 minutes before your slot and follow the latest appointment status.</span></div></div></div><section className="detail-section"><div className="section-heading compact"><div><span className="eyebrow">WHAT THEY OFFER</span><h2>Services & specialists</h2></div><span className="muted-line">{details.barbers?.length || 0} specialists</span></div><div className="service-preview-grid">{(details.services || []).slice(0, 4).map(service => <div className="service-preview" key={service.serviceId || service.id}><Scissors size={15} /><span>{service.serviceName || service.name}</span><strong>{formatCurrency(service.price)}</strong></div>)}</div></section><div className="sticky-continue"><div><span>Ready when you are?</span><small>Select services and a time slot</small></div><Button onClick={() => navigate('services', { salon: details, salonId: details.id })}>Continue <ArrowRight size={17} /></Button></div><Modal open={imageOpen} onClose={() => setImageOpen(false)} title={details.name} size="image"><ImageWithFallback src={images[active]} fallback={USER_FALLBACK_IMAGE} alt={details.name} className="modal-full-image" /></Modal></div>;
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
  about: { title: 'About My Naai', eyebrow: 'THE IDEA', intro: 'Your time is valuable. My Naai connects you with trusted local salons so you can find a great specialist, book a slot and skip the wait.', sections: [{ title: 'A calmer way to get ready', text: 'We built My Naai for people who want the confidence of a good salon visit without spending their day in a queue.' }, { title: 'For every kind of look', text: 'Discover male, female and unisex salons, from a quick trim to a full refresh, with clear services and convenient time slots.' }, { title: 'Our promise', bullets: ['Simple, thoughtful booking', 'Verified salon partners near you', 'Clear availability and appointment updates'] }] },
  faq: { title: 'Frequently asked questions', eyebrow: 'NEED TO KNOW', sections: [{ title: 'How do I book a salon?', text: 'Choose your salon, select one or more services, pick an available specialist and time, then confirm your booking request.' }, { title: 'Can I cancel a booking?', text: 'Yes. Open My bookings and choose Cancel booking on a pending or confirmed appointment.' }, { title: 'What happens after I send a request?', text: 'The salon receives your request and confirms it. You will see the latest status in My bookings and receive an update.' }, { title: 'Can I use My Naai as a salon owner?', text: 'Absolutely. Use Continue as Salon Partner on the login screen to sign in or register your salon.' }] },
  terms: { title: 'Terms & conditions', eyebrow: 'PLEASE READ', intro: 'By using My Naai, you agree to use the service respectfully and provide accurate information when making an appointment.', sections: [{ title: 'Bookings', text: 'Appointments are requests until the salon confirms them. Please arrive at least 10 minutes before your selected time. Service duration and availability may vary.' }, { title: 'Cancellations', text: 'Cancel as early as possible so the salon can offer the slot to another customer. The salon may decline or change a request based on availability.' }, { title: 'Information', text: 'We use your account and location information to help show relevant salons and manage your bookings. Please keep your account details up to date.' }] },
};

export function InfoScreen({ type, navigate }) {
  const content = INFO_CONTENT[type] || INFO_CONTENT.about;
  return <div className="screen info-screen"><PageHeader title={content.title} eyebrow={content.eyebrow} onBack={() => navigate(-1)} /><div className="info-intro"><Sparkles size={18} /><p>{content.intro || 'Everything you need to know about using My Naai.'}</p></div><div className="info-sections">{content.sections.map(section => <section key={section.title}><h2>{section.title}</h2>{section.text && <p>{section.text}</p>}{section.bullets && <ul>{section.bullets.map(item => <li key={item}><CheckCircle2 size={16} />{item}</li>)}</ul>}</section>)}</div><div className="info-contact"><span className="info-contact-icon"><Phone size={18} /></span><div><strong>Need more help?</strong><p>Call our support team on 8380017393</p></div><button onClick={() => window.open('tel:8380017393')}><ArrowRight size={17} /></button></div></div>;
}
