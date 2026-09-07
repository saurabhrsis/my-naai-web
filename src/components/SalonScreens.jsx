import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Crown,
  Edit3,
  History,
  ImagePlus,
  Info,
  LogOut,
  MapPin,
  Maximize2,
  Minimize2,
  Package,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Scissors,
  Store,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import { api, getFileUrl } from '../lib/api';
import { closeNotification } from '../lib/push';
import { DEFAULT_SERVICES } from '../lib/defaultServices';
import { normalizePlanDetails } from '../lib/planDetails';
import { STATE_OPTIONS } from '../lib/stateOptions';
import { SALON_ABOUT_CONTENT, SALON_FAQ_CONTENT, SALON_TERMS_CONTENT } from '../lib/salonContent';
import { NotificationDiagnostics } from './NotificationDiagnostics';
import { LOGOUT_CONFIRM, useConfirm } from './ConfirmDialog';
import { subscribeToLiveUpdates } from '../lib/socket';
import {
  Button,
  EmptyState,
  Field,
  ImageWithFallback,
  Modal,
  PageHeader,
  Rating,
  SelectField,
  SkeletonCard,
  Spinner,
  StatusPill,
  Toggle,
  cx,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatTime,
  getBrowserLocation,
  getErrorMessage,
  getInitials,
  getSalonStatus,
} from './Shared';

function getList(response, keys = []) {
  if (Array.isArray(response?.data)) return response.data;
  for (const key of keys) if (Array.isArray(response?.data?.[key])) return response.data[key];
  return [];
}

function getSalonData(response) {
  const data = response?.data?.salon || response?.data || {};
  return {
    ...data,
    ...(data.profileCompleted === undefined && response?.profileCompleted !== undefined ? { profileCompleted: response.profileCompleted } : {}),
    ...(data.isNewSalon === undefined && response?.isNewSalon !== undefined ? { isNewSalon: response.isNewSalon } : {}),
  };
}

function salonProfileNeedsCompletion(profile = {}) {
  if (profile.profileCompleted === false || String(profile.profileCompleted).toLowerCase() === 'false' || profile.isNewSalon === true || String(profile.isNewSalon).toLowerCase() === 'true') return true;
  const hasProfileShape = ['salonName', 'ownerName', 'addressLine1', 'genderType', 'latitude', 'longitude', 'services', 'businessHours'].some(key => Object.prototype.hasOwnProperty.call(profile, key));
  if (!hasProfileShape) return true;
  const businessHours = Array.isArray(profile.businessHours) ? profile.businessHours[0] : profile.businessHours;
  return !String(profile.ownerName || '').trim() || !String(profile.salonName || '').trim() || !String(profile.addressLine1 || '').trim() || !profile.genderType || !hasCoordinate(profile.latitude) || !hasCoordinate(profile.longitude) || !Array.isArray(profile.services) || profile.services.length === 0 || !businessHours?.openingTime || !businessHours?.closingTime;
}

function isSameDate(value, offset = 0) {
  if (!value) return false;
  const target = new Date(Date.now() + offset * 86400000);
  const targetString = target.toISOString().slice(0, 10);
  return String(value).slice(0, 10) === targetString;
}



export function SalonQueueScreen({ session, navigate, notify }) {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [doneId, setDoneId] = useState('');
  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try { const response = await api.customerList({ salonId: session.userId, page: 1 }); setItems(getList(response, ['bookings', 'customers'])); } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load your queue.')); } finally { setLoading(false); }
  }, [notify, session.userId]);
  useEffect(() => { load(); }, [load]);
  // Live queue updates ride the shared portal socket (polling → WebSocket) so a
  // blocked WebSocket upgrade degrades gracefully instead of failing outright.
  useEffect(() => subscribeToLiveUpdates({ scope: 'salon', id: session.userId, event: 'queue_updated', handler: () => load(true) }), [load, session.userId]);
  const markDone = async bookingId => {
    // In-app sheet, never window.confirm: an installed PWA cannot style the
    // native dialog, and on some Android builds it is suppressed entirely, which
    // made "Done" look like a dead button.
    const confirmed = await confirm({
      title: 'Mark this service as completed?',
      message: 'The appointment closes and moves to your customer history.',
      confirmLabel: 'Mark done',
      cancelLabel: 'Not yet',
      tone: 'success',
      icon: CheckCircle2,
    });
    if (!confirmed) return;
    setDoneId(bookingId);
    try { const response = await api.bookingDone({ salonId: session.userId, bookingId }); if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not complete service'); setItems(current => current.filter(item => item.bookingId !== bookingId)); notify?.('success', 'Service marked as completed.'); } catch (error) { notify?.('error', getErrorMessage(error, 'Could not complete service.')); } finally { setDoneId(''); }
  };
  const grouped = [{ label: 'Today', key: 0, items: items.filter(item => isSameDate(item.bookingDate, 0)) }, { label: 'Tomorrow', key: 1, items: items.filter(item => isSameDate(item.bookingDate, 1)) }, { label: 'Day after tomorrow', key: 2, items: items.filter(item => !isSameDate(item.bookingDate, 0) && !isSameDate(item.bookingDate, 1)) }].filter(group => group.items.length);
  return <div className="screen salon-queue-screen"><PageHeader title="Customer queue" subtitle="Keep every chair moving smoothly." action={<div className="page-actions"><button className="refresh-icon-button" onClick={load} aria-label="Refresh queue"><Zap size={17} /></button></div>} />{loading ? <div className="list-stack">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} className="queue-skeleton" />)}</div> : grouped.length ? <div className="queue-groups">{grouped.map(group => <section className="queue-group" key={group.label}><div className="queue-group-heading"><h2>{group.label}</h2><span>{group.items.length} {group.items.length === 1 ? 'booking' : 'bookings'}</span></div>{group.items.map(item => <article className="queue-card" key={item.bookingId}><div className="queue-main"><div className="queue-card-heading"><div><h3>{item.userName || 'Guest'}</h3><span>{item.bookingDate ? `${formatDate(item.bookingDate)} · ${formatTime(item.bookingTime)}` : 'Appointment time pending'}</span></div><Button size="small" onClick={() => markDone(item.bookingId)} loading={doneId === item.bookingId}>Done</Button></div><div className="queue-meta"><span><Scissors size={14} /> {item.serviceNames || item.services || 'Salon service'}</span>{item.barberName && <span><UserRound size={14} /> {item.barberName}</span>}{item.userPhone && item.userPhone !== '0000000000' && <a href={`tel:${item.userPhone}`}><Phone size={14} /> {item.userPhone}</a>}</div></div></article>)}</section>)}</div> : <EmptyState icon={UsersRound} title="No customers in queue" message="New booking requests will appear here." />}</div>;
}

export function SalonHistoryScreen({ notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const response = await api.salonQueueHistory(); setItems(response?.bookings || getList(response, ['bookings'])); } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load booking history.')); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  return <div className="screen history-screen"><PageHeader title="Customer history" subtitle="A record of the work you have completed." action={<button className="refresh-text-button" onClick={load}><History size={15} /> Refresh</button>} />{loading ? <div className="list-stack">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} className="history-skeleton" />)}</div> : items.length ? <div className="history-list">{items.map((item, index) => <article className="history-card" key={item.bookingId || index}><div className="history-avatar">{getInitials(item.userName || 'Guest')}</div><div className="history-copy"><div className="history-heading"><h3>{item.userName || 'Guest'}</h3><span>{formatDate(item.bookingDate)}</span></div><p>{item.services || item.serviceNames || 'Salon service'}</p><div><span><UserRound size={13} /> {item.barberName || 'Any specialist'}</span><span><Clock3 size={13} /> {formatTime(item.bookingTime)}</span></div></div><CheckCircle2 className="history-check" size={19} /></article>)}</div> : <EmptyState icon={History} title="No completed bookings" message="Your completed services will be listed here." />}</div>;
}

function normalizeProduct(item = {}) { return { ...item, id: item.productId || item.id, name: item.productName || item.name || 'Unnamed product', price: item.price || 0, rating: Number(item.rating || 0), available: item.isAvailable ?? item.available ?? true, image: item.productImage || item.image || '' }; }

export function SalonProductsScreen({ notify }) {
  const confirm = useConfirm();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const emptyForm = { productName: '', price: '', rating: '0', isAvailable: true, productImage: '', imageFile: null, preview: '' };
  const [form, setForm] = useState(emptyForm);
  const load = useCallback(async () => { setLoading(true); try { const response = await api.salonProductList({}); setProducts(getList(response, ['products']).map(normalizeProduct)); } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load product catalog.')); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  const openAdd = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = item => { setEditing(item.id); setForm({ productName: item.name, price: String(item.price), rating: String(item.rating || 0), isAvailable: item.available, productImage: item.image, imageFile: null, preview: item.image ? getFileUrl(item.image) : '' }); setModalOpen(true); };
  const save = async event => {
    event.preventDefault();
    if (!form.productName.trim() || !form.price) return notify?.('error', 'Product name and price are required.');
    setSaving(true);
    try {
      let productImage = form.productImage;
      if (form.imageFile) { const uploaded = await api.uploadImage(form.imageFile); productImage = uploaded?.url || uploaded?.data?.url || uploaded?.path || ''; }
      const payload = { productId: editing || null, productName: form.productName.trim(), price: form.price, rating: Math.min(5, Math.max(0, Number(form.rating) || 0)), isAvailable: form.isAvailable, productImage, phoneNumber: '' };
      const response = editing ? await api.updateProductList(payload) : await api.createProductList(payload);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not save product');
      const returned = normalizeProduct(response.data || payload);
      setProducts(current => editing ? current.map(item => item.id === editing ? { ...returned, id: editing } : item) : [{ ...returned, id: returned.id || `product-${Date.now()}` }, ...current]);
      setModalOpen(false); notify?.('success', editing ? 'Product updated.' : 'Product added.');
    } catch (error) { notify?.('error', getErrorMessage(error, 'Could not save product.')); } finally { setSaving(false); }
  };
  const remove = async item => {
    const confirmed = await confirm({
      title: `Delete ${item.name}?`,
      message: 'It is removed from the customer product shelf straight away.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: Trash2,
    });
    if (!confirmed) return;
    try { const response = await api.deleteProduct(item.id); if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not delete product'); setProducts(current => current.filter(value => value.id !== item.id)); notify?.('success', 'Product deleted.'); } catch (error) { notify?.('error', getErrorMessage(error, 'Could not delete product.')); }
  };
  const toggle = async item => {
    const next = { ...item, available: !item.available }; setProducts(current => current.map(value => value.id === item.id ? next : value));
    try { await api.updateProductList({ productId: item.id, productName: item.name, price: item.price, rating: item.rating, isAvailable: next.available, productImage: item.image || '' }); } catch (error) { setProducts(current => current.map(value => value.id === item.id ? item : value)); notify?.('error', getErrorMessage(error, 'Availability could not be updated.')); }
  };
  return <div className="screen salon-products-screen"><PageHeader title="Product catalog" subtitle="Manage the products customers can discover." action={<Button size="small" onClick={openAdd}><Plus size={16} /> Add product</Button>} />{loading ? <div className="product-grid">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} />)}</div> : products.length ? <div className="product-grid salon-product-grid">{products.map(item => <article className="product-card salon-product-card" key={item.id}><div className="product-image-wrap"><ImageWithFallback src={item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} className="product-image" /><span className={cx('stock-label', item.available ? 'in-stock' : 'out-stock')}>{item.available ? 'In stock' : 'Out of stock'}</span></div><div className="product-copy"><h3>{item.name}</h3><div className="product-price-row"><strong>{formatCurrency(item.price)}</strong><Rating value={item.rating} /></div><div className="product-manage-row"><Toggle checked={item.available} onChange={() => toggle(item)} label={item.available ? 'Available' : 'Hidden'} /><div><button className="small-icon-button" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`}><Pencil size={15} /></button><button className="small-icon-button danger" onClick={() => remove(item)} aria-label={`Delete ${item.name}`}><Trash2 size={15} /></button></div></div></div></article>)}</div> : <EmptyState icon={Package} title="No products yet" message="Add your first product to the customer shelf." action={<Button onClick={openAdd}><Plus size={16} /> Add product</Button>} />}<Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit product' : 'Add product'}><form className="modal-form" onSubmit={save}><Field label="Product image" hint="Optional · JPG or PNG"><label className="image-upload-box">{form.preview ? <img src={form.preview} alt="Product preview" /> : <><ImagePlus size={24} /><span>Choose an image</span></>}<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) setForm(current => ({ ...current, imageFile: file, preview: URL.createObjectURL(file) })); }} /></label></Field><Field label="Product name"><input value={form.productName} onChange={event => setForm(current => ({ ...current, productName: event.target.value }))} placeholder="e.g. Matte Clay Pomade" autoFocus /></Field><div className="form-two-col"><Field label="Price"><input type="number" min="0" value={form.price} onChange={event => setForm(current => ({ ...current, price: event.target.value }))} placeholder="499" /></Field><Field label="Rating"><input type="number" min="0" max="5" step="0.1" value={form.rating} onChange={event => setForm(current => ({ ...current, rating: event.target.value }))} placeholder="4.8" /></Field></div><div className="switch-form-row"><span><strong>Available for customers</strong><small>Show this product on the shelf</small></span><Toggle checked={form.isAvailable} onChange={value => setForm(current => ({ ...current, isAvailable: value }))} /></div><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Add product'}</Button></div></form></Modal></div>;
}

// On-brand placeholders: a catalog item or specialist without an uploaded photo
// shows a neutral tile instead of an unrelated stock picture, letterboxed by
// .image-fallback-tile on the branded gradient.
const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';
const PERSON_PLACEHOLDER = '/assets/brand/person-placeholder.svg';

const MAX_IMAGE_MB = 2;
const MAX_IMAGES = 4;

function normalizeService(item = {}, index = 0) {
  const id = item.serviceId || item.id || `new-service-${Date.now()}-${index}`;
  return {
    id,
    serviceId: item.serviceId || null,
    name: textValue(item.serviceName || item.name),
    price: item.price === undefined || item.price === null ? '' : String(item.price),
    duration: String(item.durationMinutes ?? item.duration ?? 60),
    description: textValue(item.description),
  };
}

function normalizeBarber(item = {}, index = 0) {
  const id = item.barberId || item.id || `new-barber-${Date.now()}-${index}`;
  return {
    id,
    barberId: item.barberId || null,
    name: textValue(item.fullName || item.name),
    image: textValue(item.profileImageUrl || item.image),
    imageFile: null,
    rating: item.ratingAverage ?? item.rating ?? '1.0',
    isAvailable: item.isAvailable ?? true,
  };
}

// "MALE" -> "Male", "UNISEX" -> "Unisex": the label used in the salon-type
// picker, the Load Default Services button and the confirmation copy.
function salonTypeLabel(type) {
  const value = String(type || '').trim();
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : '';
}

function isNewEditorRecord(id) {
  const value = String(id || '');
  return !value || value.startsWith('new-') || value.startsWith('existing-');
}

function textValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeRemoteImagePath(value) {
  if (!value || typeof value !== 'string') return '';
  const image = value.trim();
  if (image.startsWith('/assets/')) return image;
  const filesMatch = image.match(/\/getfiles\/(.+)$/i);
  if (filesMatch) return filesMatch[1].replace(/^\/+/, '');
  return image.replace(/^\/+/, '');
}

function getProfileImages(profile = {}) {
  const values = Array.isArray(profile.imagesArray) ? profile.imagesArray : profile.imageUrl ? [profile.imageUrl] : [];
  return values.filter(Boolean).slice(0, MAX_IMAGES).map(image => typeof image === 'string' ? normalizeRemoteImagePath(image) : image);
}

export function SalonAccountScreen({ session, navigate, notify, onSessionUpdate, onLogout }) {
  const confirm = useConfirm();
  const initialProfile = { ...(session.user || {}), ...(session.user?.salon || {}) };
  const [profile, setProfile] = useState(initialProfile);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(Boolean(initialProfile.isOpen));
  const planDetails = useMemo(() => normalizePlanDetails(profile), [profile]);
  // The latest session writer is held in a ref (exactly as the customer
  // AccountScreen does) so the loader below does not list it as a dependency.
  // Listing it made `load` change identity every time the loader itself wrote to
  // the session, which re-fired the effect and refetched forever.
  const onSessionUpdateRef = useRef(onSessionUpdate);
  onSessionUpdateRef.current = onSessionUpdate;
  const load = useCallback(async () => { setLoading(true); try { const response = await api.salonProfile({ salonId: session.userId }); if (response?.status === 'SUCCESS') { const data = getSalonData(response); setProfile(data); setIsOpen(getSalonStatus(data.businessHours, data.isOpen).isOpen); const incomplete = salonProfileNeedsCompletion(data); onSessionUpdateRef.current?.(data, incomplete ? { isNewSalon: true } : { isNewSalon: false }); if (incomplete) navigate('editProfile', { isOnboarding: 'true' }, { replace: true }); } } catch (error) { notify?.('error', getErrorMessage(error, 'Unable to load salon profile.')); } finally { setLoading(false); } }, [navigate, notify, session.userId]);
  useEffect(() => { load(); }, [load]);
  const toggleOpen = async () => { const next = !isOpen; setIsOpen(next); try { const response = await api.SalonOpenClose({ salonId: session.userId, isOpen: next }); if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not update status'); notify?.('success', next ? 'Salon is now open.' : 'Salon is now closed.'); } catch (error) { setIsOpen(!next); notify?.('error', getErrorMessage(error, 'Could not update salon status.')); } };
  // The session already carries the salon profile, so a background refresh must
  // not blank a screen the partner can read right now. Only a cold load with
  // nothing cached earns the full-page spinner.
  const hasCachedProfile = Boolean(profile.salonName || profile.name || profile.imageUrl || profile.imagesArray?.length);
  if (loading && !hasCachedProfile) return <div className="screen salon-account-screen"><PageHeader title="Salon account" /><div className="account-loading"><Spinner label="Loading salon profile…" /></div></div>;
  const status = getSalonStatus(profile.businessHours, isOpen);
  const menus = [{ label: 'Edit salon profile', caption: 'Photos, hours, services and specialists', icon: Edit3, route: 'editProfile' }, { label: 'About My Naai', caption: 'How My Naai helps your business', icon: Store, route: 'salonAbout' }, { label: 'Frequently asked questions', caption: 'Partner help and booking basics', icon: Bell, route: 'salonFaq' }, { label: 'Terms & conditions', caption: 'Partner terms', icon: Receipt, route: 'salonTerms' }, { label: 'Subscription plans', caption: 'Upgrade or renew your plan', icon: WalletCards, route: 'subscription', params: { isUpgrade: true } }, { label: 'Need a help?', caption: 'Call 8380017393', icon: Phone, action: () => window.open('tel:8380017393') }];
  return <div className="screen salon-account-screen"><PageHeader title="Salon account" subtitle="Your business, in one place." action={<button className="refresh-text-button" onClick={load} disabled={loading}>{loading ? <Spinner size={14} /> : <Zap size={15} />} {loading ? 'Updating…' : 'Refresh'}</button>} /><section className="salon-profile-hero"><div className="salon-profile-photo"><ImageWithFallback src={profile.imageUrl || profile.imagesArray?.[0]} fallback="/assets/brand/naai-logo-dark.svg" alt={profile.salonName || 'Salon'} /></div><div className="salon-profile-copy"><span className="eyebrow">SALON PARTNER</span><h2>{profile.salonName || 'Your salon'}</h2><p><MapPin size={14} /> {profile.addressLine1 || profile.city || 'Add your salon address'}</p><span className={cx('account-status', status.isOpen ? 'open' : 'closed')}><i /> {status.isOpen ? 'Open for bookings' : 'Closed for bookings'}</span></div><Button size="small" variant="secondary" onClick={() => navigate('editProfile')}><Pencil size={15} /> Edit</Button></section><div className="salon-live-status"><div><span className="eyebrow">BOOKING STATUS</span><strong>{status.isOpen ? 'Customers can book you now' : 'Your salon is currently closed'}</strong><small>Toggle this when you are ready to take the next appointment.</small></div><Toggle checked={isOpen} onChange={toggleOpen} label={isOpen ? 'Open' : 'Closed'} /></div><div className="salon-profile-stats"><div><strong>{profile.services?.length || 0}</strong><span>Services</span></div><div><strong>{profile.barbers?.length || 0}</strong><span>Barbers</span></div></div>{planDetails ? <section className={cx('account-card', 'plan-card', !planDetails.isActive && 'plan-expired')}><div className="plan-card-top"><span className="plan-card-mark"><Crown size={18} /></span><div className="plan-card-title"><span className="eyebrow">{planDetails.isActive ? 'ACTIVE PLAN' : 'PLAN EXPIRED'}</span><strong>{planDetails.title}</strong><small>{planDetails.price !== null && planDetails.price > 0 ? `${formatCurrency(planDetails.price)}${planDetails.duration ? ` · ${planDetails.duration}` : ''}` : planDetails.duration || 'My Naai partner plan'}</small></div><StatusPill tone={planDetails.isActive ? 'open' : 'closed'} dot>{planDetails.isActive ? 'Active' : 'Expired'}</StatusPill></div><div className="plan-card-meta">{planDetails.startDate && <div><CalendarDays size={14} /><span><small>Started</small><strong>{formatDate(planDetails.startDate)}</strong></span></div>}{planDetails.expiryDate && <div><Clock3 size={14} /><span><small>{planDetails.isActive ? 'Expires' : 'Expired on'}</small><strong>{formatDate(planDetails.expiryDate)}</strong></span></div>}{planDetails.daysLeft !== null && <div><Zap size={14} /><span><small>Remaining</small><strong>{planDetails.daysLeft > 0 ? `${planDetails.daysLeft} day${planDetails.daysLeft === 1 ? '' : 's'} left` : 'Renewal due'}</strong></span></div>}</div><Button size="small" variant={planDetails.isActive ? 'secondary' : 'primary'} onClick={() => navigate('subscription', { isUpgrade: true })}>{planDetails.isActive ? 'Manage plan' : 'Renew plan'}</Button></section> : <section className="account-card plan-card plan-unknown"><div className="plan-card-top"><span className="plan-card-mark"><Crown size={18} /></span><div className="plan-card-title"><span className="eyebrow">SUBSCRIPTION</span><strong>Plan details unavailable</strong><small>Keep your salon visible with an active plan.</small></div></div><Button size="small" onClick={() => navigate('subscription', { isUpgrade: true })}>View plans</Button></section>}<div className="account-card partner-menu">{menus.map(item => <button className="account-menu-row" key={item.label} onClick={item.action || (() => navigate(item.route, item.params || {}))}><span className="account-menu-icon"><item.icon size={18} /></span><span><strong>{item.label}</strong><small>{item.caption}</small></span><ChevronRight size={17} /></button>)}</div>{onLogout && <button className="logout-button partner-logout" type="button" onClick={async () => { if (await confirm(LOGOUT_CONFIRM)) onLogout(); }}><LogOut size={16} /> Logout</button>}<NotificationDiagnostics /><p className="version-label">My Naai partner portal · 1.0</p></div>;
}

function getEditorBusinessHour(value = {}) {
  return Array.isArray(value) ? value[0] || {} : value || {};
}

function hasCoordinate(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function editorTime(value, fallback) {
  const text = String(value || fallback).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function apiTime(value) {
  return `${String(value || '09:00').slice(0, 5)}:00`;
}

const EDITOR_SECTIONS = ['owner', 'salon', 'address', 'images', 'businessHours', 'services', 'barbers'];

// Sub headings mirror the mobile editor's section captions so a collapsed card
// still tells the partner what is inside it.
const EDITOR_SECTION_SUBTITLES = {
  owner: 'Name, phone number and email',
  salon: 'Salon name, type and agent code',
  address: 'Address and current GPS coordinates',
  images: 'Photos customers see first',
  businessHours: 'Opening, closing and weekly off',
  services: 'Tap a service to edit its details',
  barbers: 'Tap a barber to edit details',
};

// Collapsible editor section — mirrors the mobile app's EditSalonProfileScreen,
// where every group (Owner Information, Salon Information, Address & Location,
// Salon Images, Business Hours, Salon Services, Barbers) is a toggleable card.
// The sub heading (`subtitle`) is always rendered — the mobile screen keeps its
// "Name, phone number and email" style caption visible in both states — while
// the live `summary` line only appears when the group is collapsed.
function CollapsibleSection({ id, icon, title, subtitle, summary, count, flag, flagTone = 'missing', open, onToggle, headingActions, children, innerRef }) {
  return (
    <section ref={innerRef} className={cx('editor-section collapsible-section', open && 'open', flag && flagTone === 'missing' && 'needs-attention')} data-section={id}>
      <div className="editor-section-heading collapsible-heading">
        <button type="button" className="collapsible-toggle" onClick={onToggle} aria-expanded={open} aria-controls={`editor-section-body-${id}`}>
          <span className="editor-section-icon">{icon}</span>
          <span className="collapsible-title">
            <span className="collapsible-title-row">
              <h2>{title}</h2>
              {count !== undefined && count !== null && <span className="collapsible-count">{count}</span>}
              {flag && <span className={cx('collapsible-flag', `flag-${flagTone}`)}>{flag}</span>}
            </span>
            {subtitle && <span className="collapsible-subtitle">{subtitle}</span>}
            {!open && summary && <span className="collapsible-summary">{summary}</span>}
          </span>
          <ChevronDown size={18} className="collapsible-chevron" />
        </button>
        {headingActions && <div className="editor-heading-actions">{headingActions}</div>}
      </div>
      <div id={`editor-section-body-${id}`} className={cx('collapsible-body-wrap', open && 'open')}><div className="collapsible-body">{children}</div></div>
    </section>
  );
}

// Collapsible service/barber card, matching the mobile app's expandable items.
function CollapsibleEditorCard({ idPrefix, icon, image, title, subtitle, flag, expanded, onToggle, onDelete, deleteLabel, children }) {
  return (
    <div className={cx('editor-item collapsible-item', expanded && 'open', flag && 'needs-attention')}>
      <div className="collapsible-item-heading">
        {image || <span className="editor-section-icon small">{icon}</span>}
        <button type="button" className="collapsible-item-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls={`editor-item-body-${idPrefix}`}>
          <span className="collapsible-item-copy">
            <strong>{title}</strong>
            <span className="collapsible-item-meta">
              {subtitle && <small>{subtitle}</small>}
              {flag && <em className="collapsible-flag flag-missing">{flag}</em>}
            </span>
          </span>
          <ChevronDown size={16} className="collapsible-chevron" />
        </button>
        <button type="button" className="item-delete-button" onClick={onDelete} aria-label={deleteLabel}><Trash2 size={16} /></button>
      </div>
      <div id={`editor-item-body-${idPrefix}`} className={cx('collapsible-body-wrap', expanded && 'open')}><div className="collapsible-body">{children}</div></div>
    </div>
  );
}

export function EditSalonProfileScreen({ params, session, navigate, notify, onSessionUpdate, onLogout }) {
  const confirm = useConfirm();
  const routeProfile = params?.profileData && typeof params.profileData === 'object' ? params.profileData : null;
  const initial = routeProfile || { ...(session.user || {}), ...(session.user?.salon || {}) };
  const isOnboarding = params?.isOnboarding === true || params?.isOnboarding === 'true' || session.isNewSalon;
  const salonId = params?.salonId || session.userId || initial.salonId || initial.salon?.salonId || '';
  const [profile, setProfile] = useState(initial);
  const [salonName, setSalonName] = useState(textValue(initial.salonName));
  const [ownerName, setOwnerName] = useState(textValue(initial.ownerName));
  const [phoneNumber, setPhoneNumber] = useState(textValue(initial.phoneNumber));
  const [email, setEmail] = useState(textValue(initial.email));
  const [addressLine1, setAddressLine1] = useState(textValue(initial.addressLine1 || initial.address));
  const [addressLine2, setAddressLine2] = useState(textValue(initial.addressLine2));
  const [city, setCity] = useState(textValue(initial.city));
  const [state, setState] = useState(textValue(initial.state));
  const [pincode, setPincode] = useState(textValue(initial.pincode));
  const [genderType, setGenderType] = useState(String(initial.genderType || '').toUpperCase());
  const [agentCode, setAgentCode] = useState(textValue(initial.agentCode));
  const [latitude, setLatitude] = useState(hasCoordinate(initial.latitude) ? Number(initial.latitude) : null);
  const [longitude, setLongitude] = useState(hasCoordinate(initial.longitude) ? Number(initial.longitude) : null);
  const initialHour = getEditorBusinessHour(initial.businessHours);
  const [openTime, setOpenTime] = useState(editorTime(initialHour.openingTime, '09:00'));
  const [closeTime, setCloseTime] = useState(editorTime(initialHour.closingTime, '22:00'));
  const initialHoliday = initialHour.holidayDays?.[0];
  const [holiday, setHoliday] = useState(initialHoliday === undefined || initialHoliday === null || initialHoliday === '' ? '' : String(initialHoliday));
  const [images, setImages] = useState(getProfileImages(initial));
  const [services, setServices] = useState((initial.services || []).map(normalizeService));
  const [barbers, setBarbers] = useState((initial.barbers || []).map(normalizeBarber));
  const [isActive, setIsActive] = useState(initial.isActive !== false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!routeProfile);
  const [locationLoading, setLocationLoading] = useState(false);
  // A salon that already has saved coordinates does not need a fresh GPS fix
  // before it can be edited again; only a missing pin forces re-detection.
  const [locationVerified, setLocationVerified] = useState(() => hasCoordinate(initial.latitude) && hasCoordinate(initial.longitude));
  const [locationError, setLocationError] = useState('');
  // Every group starts collapsed — on a phone the editor is a short list of
  // seven cards a partner can scan, then open one at a time. The mobile app
  // keeps Owner/Salon open; the portal collapses all of them and instead shows
  // each card's sub heading, its live summary and how many required details are
  // still missing, so nothing important is hidden.
  const [openSections, setOpenSections] = useState(() => Object.fromEntries(EDITOR_SECTIONS.map(key => [key, false])));
  const [expandedItems, setExpandedItems] = useState({});
  const sectionRefs = useRef({});
  const planDetails = useMemo(() => normalizePlanDetails(profile), [profile]);
  // Captured once, from the *loaded* profile (a stored session can be as thin as
  // `{ salon: { salonId } }`): a partner whose profile was incomplete when the
  // editor opened is sent to the payment screen after saving, everybody else
  // back to Account. `isOnboarding` covers a brand-new salon whose profile
  // request can still fail.
  const startedIncomplete = useRef(routeProfile ? salonProfileNeedsCompletion(routeProfile) : null);
  const toggleSection = key => setOpenSections(current => ({ ...current, [key]: !current[key] }));
  const toggleItem = key => setExpandedItems(current => ({ ...current, [key]: !current[key] }));
  const allSectionsOpen = EDITOR_SECTIONS.every(key => openSections[key]);
  const toggleAllSections = () => {
    const next = !allSectionsOpen;
    setOpenSections(Object.fromEntries(EDITOR_SECTIONS.map(key => [key, next])));
  };
  // A failed save opens the offending group and scrolls it into view, so the
  // partner is not left guessing which collapsed card needs attention.
  const focusSection = useCallback(key => {
    if (!key) return;
    setOpenSections(current => (current[key] ? current : { ...current, [key]: true }));
    window.requestAnimationFrame(() => {
      const node = sectionRefs.current[key];
      node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      node?.querySelector('input, textarea, select')?.focus({ preventScroll: true });
    });
  }, []);

  const populate = useCallback(data => {
    const next = data || {};
    const businessHour = getEditorBusinessHour(next.businessHours);
    if (startedIncomplete.current === null) startedIncomplete.current = salonProfileNeedsCompletion(next);
    setProfile(next);
    setSalonName(textValue(next.salonName));
    setOwnerName(textValue(next.ownerName));
    setPhoneNumber(textValue(next.phoneNumber));
    setEmail(textValue(next.email));
    setAddressLine1(textValue(next.addressLine1 || next.address));
    setAddressLine2(textValue(next.addressLine2));
    setCity(textValue(next.city));
    setState(textValue(next.state));
    setPincode(textValue(next.pincode));
    setGenderType(String(next.genderType || '').toUpperCase());
    setAgentCode(textValue(next.agentCode));
    setLatitude(hasCoordinate(next.latitude) ? Number(next.latitude) : null);
    setLongitude(hasCoordinate(next.longitude) ? Number(next.longitude) : null);
    setLocationVerified(hasCoordinate(next.latitude) && hasCoordinate(next.longitude));
    setOpenTime(editorTime(businessHour.openingTime, '09:00'));
    setCloseTime(editorTime(businessHour.closingTime, '22:00'));
    const nextHoliday = businessHour.holidayDays?.[0];
    setHoliday(nextHoliday === undefined || nextHoliday === null || nextHoliday === '' ? '' : String(nextHoliday));
    setImages(getProfileImages(next));
    setServices((next.services || []).map(normalizeService));
    setBarbers((next.barbers || []).map(normalizeBarber));
    setIsActive(next.isActive !== false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!salonId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.salonProfile({ salonId });
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Unable to load profile.');
      populate(getSalonData(response));
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Unable to load profile.'));
    } finally {
      setLoading(false);
    }
  }, [notify, populate, salonId]);

  useEffect(() => {
    if (!routeProfile) refreshProfile();
  }, [refreshProfile, routeProfile]);

  const detectLocation = useCallback(async () => {
    setLocationLoading(true);
    setLocationVerified(false);
    setLocationError('');
    try {
      const current = await getBrowserLocation();
      if (!current || !hasCoordinate(current.latitude) || !hasCoordinate(current.longitude)) {
        setLocationError('Location permission is unavailable. Allow location for this site, then try again.');
        return;
      }
      setLatitude(Number(current.latitude));
      setLongitude(Number(current.longitude));
      setLocationVerified(true);
      setLocationError('');
    } catch (error) {
      setLocationError(getErrorMessage(error, 'Unable to detect the current salon location.'));
    } finally {
      setLocationLoading(false);
    }
  }, []);

  // Ask for the browser location once, and only when the salon has no saved pin
  // yet — an existing partner editing their menu from home must not have the
  // salon coordinates silently replaced by wherever they are standing.
  const autoDetectedLocation = useRef(false);
  useEffect(() => {
    if (loading || autoDetectedLocation.current) return;
    autoDetectedLocation.current = true;
    if (hasCoordinate(latitude) && hasCoordinate(longitude)) return;
    detectLocation();
  }, [detectLocation, latitude, loading, longitude]);

  const validateImageFile = file => {
    if (!file) return false;
    if (file.type && !file.type.startsWith('image/')) {
      notify?.('error', 'Choose a JPG, PNG or other image file.');
      return false;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      notify?.('error', `Each salon image must be smaller than ${MAX_IMAGE_MB} MB.`);
      return false;
    }
    return true;
  };
  const addImages = event => {
    const selectedFiles = Array.from(event.target.files || []);
    const remaining = Math.max(0, MAX_IMAGES - images.length);
    const files = selectedFiles.filter(validateImageFile).slice(0, remaining);
    if (selectedFiles.length > remaining) notify?.('info', `You can upload up to ${MAX_IMAGES} salon images.`);
    setImages(current => [...current, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    event.target.value = '';
  };
  const replaceImage = (index, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!validateImageFile(file)) return;
    setImages(current => current.map((image, itemIndex) => {
      if (itemIndex !== index) return image;
      if (typeof image !== 'string' && image.preview) URL.revokeObjectURL(image.preview);
      return { file, preview: URL.createObjectURL(file) };
    }));
  };
  const removeImage = index => setImages(current => {
    const removed = current[index];
    if (typeof removed !== 'string' && removed?.preview) URL.revokeObjectURL(removed.preview);
    return current.filter((_, itemIndex) => itemIndex !== index);
  });
  const updateService = (id, key, value) => setServices(current => current.map(item => item.id === id ? { ...item, [key]: value } : item));
  const updateBarber = (id, key, value) => setBarbers(current => current.map(item => item.id === id ? { ...item, [key]: value } : item));
  const addService = () => {
    const item = normalizeService({ id: `new-service-${Date.now()}` }, 0);
    setServices(current => [...current, item]);
    setExpandedItems(current => ({ ...current, [`service-${item.id}`]: true }));
  };
  const addBarber = () => {
    const item = normalizeBarber({ id: `new-barber-${Date.now()}` }, 0);
    setBarbers(current => [...current, item]);
    setExpandedItems(current => ({ ...current, [`barber-${item.id}`]: true }));
  };
  const selectBarberImage = (id, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!validateImageFile(file)) return;
    setBarbers(current => current.map(item => {
      if (item.id !== id) return item;
      if (item.image?.startsWith('blob:')) URL.revokeObjectURL(item.image);
      return { ...item, image: URL.createObjectURL(file), imageFile: file };
    }));
  };
  const createDefaultEditorServices = type => {
    const defaults = DEFAULT_SERVICES[String(type || '').toLowerCase()] || [];
    return defaults.map((item, index) => ({ ...normalizeService(item, index), id: `new-service-${Date.now()}-${index}` }));
  };
  // Both default-service paths ask the same question with the same wording, so a
  // partner switching salon type and a partner tapping "Load defaults" get one
  // consistent sheet: Replace / Keep mine.
  const askReplaceServices = (type, currentCount, defaultCount) => confirm({
    title: 'Use the default services?',
    message: `Replace your ${currentCount} current ${currentCount === 1 ? 'service' : 'services'} with the ${defaultCount} ${salonTypeLabel(type) || 'salon'} defaults? Unsaved edits to them are lost.`,
    confirmLabel: 'Replace',
    cancelLabel: 'Keep mine',
    tone: 'warning',
    icon: RefreshCw,
    // "Keep mine" is the safe answer, so it gets the focus and the Enter key.
    defaultAction: 'cancel',
  });
  const loadDefaultServices = async () => {
    const defaults = createDefaultEditorServices(genderType);
    if (!defaults.length) return notify?.('error', 'Choose a salon type before loading default services.');
    if (services.length && !(await askReplaceServices(genderType, services.length, defaults.length))) return;
    setServices(defaults);
    setExpandedItems(current => ({ ...current, ...Object.fromEntries(defaults.map(item => [`service-${item.id}`, true])) }));
  };
  const changeGenderType = async event => {
    // Read the value before any `await`: React reuses synthetic event objects.
    const nextType = event.target.value;
    const previousType = genderType;
    const currentCount = services.length;
    setGenderType(nextType);
    if (!nextType || nextType === previousType) return;
    const defaults = createDefaultEditorServices(nextType);
    if (!currentCount) {
      if (defaults.length) setServices(defaults);
      return;
    }
    if (!defaults.length) return;
    if (await askReplaceServices(nextType, currentCount, defaults.length)) setServices(defaults);
  };
  const removeService = async id => {
    if (isNewEditorRecord(id)) return setServices(current => current.filter(item => item.id !== id));
    const confirmed = await confirm({
      title: 'Delete this service?',
      message: 'Customers will no longer be able to book it. This cannot be undone.',
      confirmLabel: 'Delete service',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: Trash2,
    });
    if (!confirmed) return;
    try {
      const response = await api.deleteSalonService(id);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not delete service.');
      setServices(current => current.filter(item => item.id !== id));
      notify?.('success', 'Service deleted.');
    } catch (error) { notify?.('error', getErrorMessage(error, 'Could not delete service.')); }
  };
  const removeBarber = async id => {
    if (isNewEditorRecord(id)) return setBarbers(current => {
      const removed = current.find(item => item.id === id);
      if (removed?.image?.startsWith('blob:')) URL.revokeObjectURL(removed.image);
      return current.filter(item => item.id !== id);
    });
    const confirmed = await confirm({
      title: 'Delete this specialist?',
      message: 'They stop appearing on your salon profile and customers can no longer pick them.',
      confirmLabel: 'Delete specialist',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: Trash2,
    });
    if (!confirmed) return;
    try {
      const response = await api.deleteSalonBarber(id);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not delete specialist.');
      setBarbers(current => current.filter(item => item.id !== id));
      notify?.('success', 'Specialist deleted.');
    } catch (error) { notify?.('error', getErrorMessage(error, 'Could not delete specialist.')); }
  };

  const uploadImage = async image => {
    if (!image?.file) return typeof image === 'string' ? normalizeRemoteImagePath(image) : '';
    const response = await api.uploadImage(image.file);
    if (response?.success === false || response?.data?.success === false) throw new Error(response?.message || response?.data?.message || 'Image upload failed.');
    const path = response?.url || response?.data?.url || response?.path || response?.data?.path || '';
    if (!path) throw new Error(response?.message || response?.data?.message || 'Image upload failed.');
    return normalizeRemoteImagePath(path);
  };

  const phoneDigits = phoneNumber.replace(/\D/g, '');
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const agentCodeValid = !agentCode.trim() || /^\d{10}$/.test(agentCode.trim());
  const pincodeValid = !pincode.trim() || /^\d{6}$/.test(pincode.trim());
  const locationReady = locationVerified && hasCoordinate(latitude) && hasCoordinate(longitude)
    && Number(latitude) >= -90 && Number(latitude) <= 90 && Number(longitude) >= -180 && Number(longitude) <= 180;
  const serviceIncomplete = item => !item.name.trim() || item.price === '' || !Number.isFinite(Number(item.price)) || Number(item.price) < 0
    || !item.duration || !Number.isFinite(Number(item.duration)) || Number(item.duration) <= 0;
  const barberIncomplete = item => !item.name.trim();

  // Required-field state for every collapsible group. The same object drives the
  // collapsed "Missing: …" line, the section flag chip and the save-time
  // validation, so a partner always sees exactly what still has to be filled in
  // while all sections stay collapsed by default.
  const sectionIssues = {
    owner: [!ownerName.trim() && 'Salon Owner Name', phoneDigits.length !== 10 && 'Mobile Number', !emailValid && 'a valid Email Address'].filter(Boolean),
    salon: [!salonName.trim() && 'Salon Name', !genderType && 'Salon Type', !agentCodeValid && 'a valid Agent Code'].filter(Boolean),
    address: [!addressLine1.trim() && 'Complete Address', !pincodeValid && 'a valid Pincode', !locationReady && 'salon GPS location'].filter(Boolean),
    images: [],
    businessHours: [!openTime && 'Opening Time', !closeTime && 'Closing Time', openTime && openTime === closeTime && 'different Opening and Closing Time'].filter(Boolean),
    services: [!services.length && 'at least one service', services.length > 0 && services.some(serviceIncomplete) && 'Service Name, Price and Duration for every service'].filter(Boolean),
    barbers: [barbers.some(barberIncomplete) && 'Barber Name for every team member'].filter(Boolean),
  };
  const missingCount = EDITOR_SECTIONS.reduce((total, key) => total + sectionIssues[key].length, 0);
  const sectionFlag = key => (sectionIssues[key]?.length ? `${sectionIssues[key].length} required` : '');
  const sectionSummary = (key, text) => (
    <>
      {text && <span className="summary-value">{text}</span>}
      {sectionIssues[key]?.length > 0 && <span className="collapsible-missing">Missing: {sectionIssues[key].join(', ')}</span>}
    </>
  );
  // A new or incomplete profile continues to the payment screen after saving;
  // an already-complete profile (or a partner with a live plan) goes to Account.
  // Skipping the payment step for an active plan prevents charging twice for the
  // same profile save.
  const needsPaymentStep = (isOnboarding || startedIncomplete.current === true) && !planDetails?.isActive;

  const validate = () => {
    if (!salonId) return { message: 'Salon ID is unavailable. Please sign in again.', section: '' };
    const checks = [
      ['owner', !ownerName.trim(), 'Please enter the Salon Owner Name.'],
      ['owner', phoneDigits.length !== 10, 'Please enter a valid 10-digit Mobile Number.'],
      ['owner', !emailValid, 'Please enter a valid Email Address.'],
      ['salon', !salonName.trim(), 'Please enter the Salon Name.'],
      ['salon', !genderType, 'Please select the Salon Type.'],
      ['salon', !agentCodeValid, 'Agent Code must be exactly 10 digits or blank.'],
      ['address', !addressLine1.trim(), 'Please enter the Complete Address.'],
      ['address', !pincodeValid, 'Pincode must contain 6 digits.'],
      ['address', !locationReady, 'Allow location access and detect the salon location before continuing.'],
      ['businessHours', !openTime || !closeTime, 'Please set the Opening Time and Closing Time.'],
      ['businessHours', Boolean(openTime) && openTime === closeTime, 'Opening Time and Closing Time cannot be the same.'],
      ['services', !services.length, 'Please add at least one salon service.'],
      ['services', services.length > 0 && services.some(serviceIncomplete), 'Enter a valid Service Name, Price and Duration for every service.'],
      ['barbers', barbers.some(barberIncomplete), 'Please enter the Barber Name of every team member.'],
    ];
    const failure = checks.find(([, failed]) => failed);
    return failure ? { message: failure[2], section: failure[0] } : null;
  };

  const save = async event => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      // Open the group that failed, scroll it into view and focus its first
      // input — with every section collapsed by default the partner must never
      // have to hunt for the field that blocked the save.
      focusSection(validationError.section);
      return notify?.('error', validationError.message);
    }
    setSaving(true);
    try {
      const uploadedImages = [];
      for (const image of images) {
        const path = await uploadImage(image);
        if (path) uploadedImages.push(path);
      }
      const existingServices = services.filter(item => !isNewEditorRecord(item.id)).map(item => ({
        serviceId: item.serviceId || item.id,
        serviceName: item.name.trim(),
        durationMinutes: Number(item.duration) || 60,
        price: String(item.price || 0),
        description: item.description?.trim() || 'Salon service',
      }));
      const newServices = services.filter(item => isNewEditorRecord(item.id)).map(item => ({
        serviceName: item.name.trim(),
        durationMinutes: Number(item.duration) || 60,
        price: String(item.price || 0),
        description: item.description?.trim() || 'Salon service',
      }));
      const barberPayloads = [];
      for (const item of barbers) {
        const image = item.imageFile ? await uploadImage({ file: item.imageFile }) : normalizeRemoteImagePath(item.image);
        barberPayloads.push({
          id: item.id,
          barberId: item.barberId || (!isNewEditorRecord(item.id) ? item.id : null),
          fullName: item.name.trim(),
          profileImageUrl: image || null,
          ratingAverage: String(item.rating || '1.0'),
          isAvailable: item.isAvailable !== false,
        });
      }
      const existingBarbers = barberPayloads.filter(item => !isNewEditorRecord(item.id)).map(({ id, ...item }) => item);
      const newBarbers = barberPayloads.filter(item => isNewEditorRecord(item.id)).map(({ id, barberId, ...item }) => item);
      const existingBusinessHour = getEditorBusinessHour(profile.businessHours);
      const businessHour = {
        openingTime: apiTime(openTime),
        closingTime: apiTime(closeTime),
        breakStartTime: existingBusinessHour.breakStartTime || null,
        breakEndTime: existingBusinessHour.breakEndTime || null,
        holidayDays: holiday === '' ? [] : [Number.isFinite(Number(holiday)) ? Number(holiday) : holiday],
      };
      if (existingBusinessHour.scheduleId) businessHour.scheduleId = existingBusinessHour.scheduleId;
      const payload = {
        salonId,
        ownerName: ownerName.trim(),
        salonName: salonName.trim(),
        phoneNumber: phoneNumber.replace(/\D/g, ''),
        email: email.trim() || null,
        genderType,
        agentCode: agentCode.trim() || null,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || null,
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        imageUrl: uploadedImages[0] || null,
        imagesArray: uploadedImages,
        existingServices,
        newServices,
        existingBarbers,
        newBarbers,
        businessHours: [businessHour],
        isActive,
        profileCompleted: true,
      };
      const response = await api.editSalonProfile(payload);
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Could not update profile.');
      const next = { ...profile, ...payload, services: [...existingServices, ...newServices], barbers: [...existingBarbers, ...newBarbers] };
      setProfile(next);
      localStorage.setItem('profileCompleted', 'true');
      localStorage.setItem('isNewSalon', 'false');
      // The saved profile is complete, so release the editor lock for both a
      // first-time partner and an existing salon fixing an incomplete profile.
      onSessionUpdate?.(next, { isNewSalon: false });
      if (needsPaymentStep) {
        notify?.('success', 'Salon profile saved. Choose a plan to continue.');
        navigate('subscription', isOnboarding ? { isUpgrade: true, isOnboarding: true } : { isUpgrade: true }, { replace: true });
      } else {
        notify?.('success', 'Salon profile saved.');
        navigate('account', {}, { replace: true });
      }
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not save salon profile.'));
    } finally { setSaving(false); }
  };

  if (loading) return <div className="screen"><PageHeader title="Edit salon profile" /><div className="account-loading"><Spinner label="Loading profile…" /></div></div>;
  const hasLocation = locationReady;
  const locationMessage = locationLoading
    ? 'Detecting current location…'
    : locationError || 'Required — allow location access so nearby customers can discover this salon.';
  const ownerSummary = `${ownerName.trim() || 'Name pending'} · ${phoneDigits ? `+91 ${phoneDigits}` : 'Mobile Number pending'}`;
  const salonSummary = `${salonName.trim() || 'Name pending'} · ${genderType ? genderType.charAt(0) + genderType.slice(1).toLowerCase() : 'Salon Type pending'}`;
  const addressSummary = `${addressLine1.trim() || 'Address pending'}${city.trim() ? `, ${city.trim()}` : ''}`;
  const hoursSummary = `${formatTime(openTime)} – ${formatTime(closeTime)}${holiday !== '' ? ' · Weekly off set' : ''}`;
  const planExpiryLine = planDetails?.expiryDate
    ? planDetails.isActive
      ? `Expires ${formatDate(planDetails.expiryDate)}${planDetails.daysLeft !== null && planDetails.daysLeft >= 0 ? ` · ${planDetails.daysLeft} day${planDetails.daysLeft === 1 ? '' : 's'} left` : ''}`
      : `Expired on ${formatDate(planDetails.expiryDate)}`
    : 'Active subscription';
  const goBackToAccount = () => navigate('account', {}, { replace: true });
  // Cancel/back out of the editor.
  //
  // This used to be `disabled={isOnboarding}` with the header's back arrow also
  // hidden, so during onboarding the partner had a visible Cancel button that
  // did nothing at all — the "cancel not working on all devices" report. It is
  // never disabled now:
  //  - a routine edit confirms only when there are unsaved changes, then
  //    returns to Account;
  //  - during onboarding Account does not exist yet, so Cancel explains that
  //    the profile has to be completed and offers signing out instead of
  //    silently doing nothing.
  // Everything runs through the in-app sheet (never window.confirm, which is
  // suppressed in some installed-PWA webviews and returns false, which is what
  // makes a button look dead on exactly one device).
  const cancelEdit = async () => {
    if (saving) return;
    if (isOnboarding) {
      const signOut = await confirm({
        title: 'Finish your salon profile first',
        message: 'Your salon needs these details before the dashboard opens, so there is nothing to go back to yet. You can keep filling it in, or sign out and finish later — your saved details are kept.',
        confirmLabel: 'Sign out',
        cancelLabel: 'Keep editing',
        tone: 'warning',
        icon: LogOut,
        defaultAction: 'cancel',
      });
      if (signOut) onLogout?.();
      return;
    }
    const discard = await confirm({
      title: 'Discard your changes?',
      message: 'Any edits you have made on this screen will be lost. Your saved salon profile stays exactly as it is.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
      icon: X,
      defaultAction: 'cancel',
    });
    if (!discard) return;
    goBackToAccount();
  };
  return <div className="screen edit-salon-screen"><PageHeader title={isOnboarding ? 'Complete salon profile' : 'Edit salon profile'} subtitle={isOnboarding ? 'Add the details customers need before you open your dashboard.' : 'Give customers a clear picture of your business.'} onBack={cancelEdit} action={<button className="refresh-text-button" type="button" onClick={refreshProfile} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    {planDetails && <div className={cx('editor-plan-strip', planDetails.isActive ? 'active' : 'expired')}><span className="editor-plan-mark"><Crown size={15} /></span><span className="editor-plan-copy"><strong>{planDetails.title}</strong><small>{planDetails.price !== null && planDetails.price > 0 ? `${formatCurrency(planDetails.price)} · ${planExpiryLine}` : planExpiryLine}</small></span>{!isOnboarding && <button type="button" onClick={() => navigate('subscription', { isUpgrade: true })}>Manage plan</button>}</div>}
    <div className={cx('editor-status-bar', missingCount ? 'missing' : 'ready')}>
      <span className="editor-status-mark">{missingCount ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}</span>
      <span className="editor-status-copy">
        <strong>{missingCount ? `${missingCount} required detail${missingCount === 1 ? '' : 's'} still missing` : 'All required details are filled in'}</strong>
        <small>{missingCount ? 'Open the cards marked in red to finish the profile.' : needsPaymentStep ? 'Save to continue to the payment screen.' : 'Save to publish the latest changes.'}</small>
      </span>
      <button type="button" className="expand-all-button" onClick={toggleAllSections}>{allSectionsOpen ? <><Minimize2 size={14} /> Collapse all</> : <><Maximize2 size={14} /> Expand all</>}</button>
    </div>
    <form className="profile-editor" onSubmit={save} noValidate>
    <p className="required-legend"><em className="required-star" aria-hidden="true">*</em> Required fields · every section stays closed until you tap it.</p>
    <CollapsibleSection id="owner" innerRef={node => { sectionRefs.current.owner = node; }} icon={<UserRound size={18} />} title="Owner Information" subtitle={EDITOR_SECTION_SUBTITLES.owner} flag={sectionFlag('owner')} summary={sectionSummary('owner', ownerSummary)} open={openSections.owner} onToggle={() => toggleSection('owner')}>
      <div className="form-two-col"><Field label="Salon Owner Name" required><input value={ownerName} onChange={event => setOwnerName(event.target.value)} placeholder="Enter salon owner name" aria-required="true" autoComplete="name" /></Field><Field label="Mobile Number" required hint={profile.phoneNumber ? 'The login number is managed by OTP authentication.' : '10 digits required'}><input inputMode="numeric" value={phoneNumber} onChange={event => setPhoneNumber(event.target.value.replace(/\D/g, '').slice(0, 10))} readOnly={Boolean(profile.phoneNumber)} placeholder="Enter mobile number" aria-required="true" autoComplete="tel" /></Field></div>
      <Field label="Email Address" hint="Optional"><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Enter email address" autoComplete="email" /></Field>
    </CollapsibleSection>
    <CollapsibleSection id="salon" innerRef={node => { sectionRefs.current.salon = node; }} icon={<Store size={18} />} title="Salon Information" subtitle={EDITOR_SECTION_SUBTITLES.salon} flag={sectionFlag('salon')} summary={sectionSummary('salon', salonSummary)} open={openSections.salon} onToggle={() => toggleSection('salon')}>
      <Field label="Salon Name" required><input value={salonName} onChange={event => setSalonName(event.target.value)} placeholder="Enter salon name" aria-required="true" /></Field>
      <SelectField label="Salon Type" required value={genderType} onChange={changeGenderType} options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'UNISEX', label: 'Unisex' }]} placeholder="Select salon type" />
      <Field label="Agent Code" hint="Optional · exactly 10 digits"><input inputMode="numeric" maxLength="10" value={agentCode} onChange={event => setAgentCode(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Optional 10-digit agent code" /></Field>
      <div className="switch-form-row"><span><strong>Accept new bookings</strong><small>Keep the salon active in customer discovery.</small></span><Toggle checked={isActive} onChange={setIsActive} /></div>
    </CollapsibleSection>
    <CollapsibleSection id="address" innerRef={node => { sectionRefs.current.address = node; }} icon={<MapPin size={18} />} title="Address & Location" subtitle={EDITOR_SECTION_SUBTITLES.address} flag={sectionFlag('address')} summary={sectionSummary('address', addressSummary)} open={openSections.address} onToggle={() => toggleSection('address')}>
      <Field label="Complete Address" required><textarea value={addressLine1} onChange={event => setAddressLine1(event.target.value)} placeholder="House number, street, area, building" rows="3" aria-required="true" /></Field>
      <Field label="Landmark / Address Line 2" hint="Optional"><input value={addressLine2} onChange={event => setAddressLine2(event.target.value)} placeholder="Nearby landmark" /></Field>
      <div className="form-three-col editor-address-grid"><Field label="City" hint="Optional"><input value={city} onChange={event => setCity(event.target.value)} placeholder="City" /></Field><SelectField label="State" hint="Optional" value={state} onChange={event => setState(event.target.value)} options={STATE_OPTIONS} placeholder="Select state" /><Field label="Pincode" hint="Optional · 6 digits"><input inputMode="numeric" maxLength="6" value={pincode} onChange={event => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Pincode" /></Field></div>
      <div className={cx('editor-location-status', hasLocation ? 'location-ready' : 'location-missing')}><MapPin size={18} /><span><strong>{hasLocation ? 'Salon location saved' : 'Salon location required *'}</strong><small>{hasLocation ? `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}` : locationMessage}</small></span></div>
      <Button type="button" size="small" variant="secondary" onClick={detectLocation} loading={locationLoading}><MapPin size={15} /> {hasLocation ? 'Update to current location' : 'Detect current location'}</Button>
    </CollapsibleSection>
    <CollapsibleSection id="images" innerRef={node => { sectionRefs.current.images = node; }} icon={<ImagePlus size={18} />} title="Salon Images" subtitle={EDITOR_SECTION_SUBTITLES.images} summary={sectionSummary('images', `${images.length} of ${MAX_IMAGES} photos added`)} open={openSections.images} onToggle={() => toggleSection('images')}>
      <p className="collapsible-lede">Optional · up to {MAX_IMAGES} photos, each smaller than {MAX_IMAGE_MB} MB. The first photo becomes your main image.</p>
      <div className="editor-photo-grid">{images.map((image, index) => <div className="editor-photo" key={`${typeof image === 'string' ? image : image.preview}-${index}`}><ImageWithFallback src={typeof image === 'string' ? image : image.preview} fallback="/assets/brand/naai-logo-dark.svg" alt="Salon photo" /><label className="editor-photo-change" aria-label={`Replace salon photo ${index + 1}`}><Pencil size={13} /><input type="file" accept="image/*" onChange={event => replaceImage(index, event)} /></label><button type="button" onClick={() => removeImage(index)} aria-label={`Remove salon photo ${index + 1}`}><X size={15} /></button></div>)}{images.length < MAX_IMAGES && <label className="add-photo"><Plus size={20} /><span>Add photo</span><input type="file" accept="image/*" multiple onChange={addImages} /></label>}</div>
    </CollapsibleSection>
    <CollapsibleSection id="businessHours" innerRef={node => { sectionRefs.current.businessHours = node; }} icon={<Clock3 size={18} />} title="Business Hours" subtitle={EDITOR_SECTION_SUBTITLES.businessHours} flag={sectionFlag('businessHours')} summary={sectionSummary('businessHours', hoursSummary)} open={openSections.businessHours} onToggle={() => toggleSection('businessHours')}>
      <div className="form-two-col"><Field label="Opening Time" required><input type="time" value={openTime} onChange={event => setOpenTime(event.target.value)} aria-required="true" /></Field><Field label="Closing Time" required><input type="time" value={closeTime} onChange={event => setCloseTime(event.target.value)} aria-required="true" /></Field></div>
      <SelectField label="Weekly Off" hint="Optional" value={holiday} onChange={event => setHoliday(event.target.value)} placeholder="No weekly off" options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => ({ value: String(index), label: day }))} />
    </CollapsibleSection>
    <CollapsibleSection id="services" innerRef={node => { sectionRefs.current.services = node; }} icon={<Scissors size={18} />} title="Salon Services" subtitle={EDITOR_SECTION_SUBTITLES.services} count={services.length} flag={sectionFlag('services')} summary={sectionSummary('services', services.length ? `${services.length} service${services.length === 1 ? '' : 's'} on your menu` : 'No services added yet')} open={openSections.services} onToggle={() => toggleSection('services')} headingActions={<>
      <button type="button" className="add-inline-button" onClick={loadDefaultServices}><RefreshCw size={14} /> Load Default {salonTypeLabel(genderType)} Services</button>
      <button type="button" className="add-inline-button" onClick={addService}><Plus size={15} /> Add Service</button>
    </>}>
      <p className="collapsible-lede">Every service needs a Service Name <em className="required-star">*</em>, Price <em className="required-star">*</em> and Duration <em className="required-star">*</em>.</p>
      <div className="editor-items">{services.map(item => {
        const itemKey = `service-${item.id}`;
        const incomplete = serviceIncomplete(item);
        return <CollapsibleEditorCard idPrefix={itemKey} icon={<Scissors size={16} />} title={item.name || 'New Service'} flag={incomplete ? 'Needs details' : ''} subtitle={[item.price !== '' ? formatCurrency(item.price) : 'Price pending', `${item.duration || 0} min`].filter(Boolean).join(' · ')} expanded={Boolean(expandedItems[itemKey])} onToggle={() => toggleItem(itemKey)} onDelete={() => removeService(item.id)} deleteLabel={`Delete ${item.name || 'service'}`} key={item.id}>
          <div className="form-three-col"><Field label="Service Name" required><input value={item.name} onChange={event => updateService(item.id, 'name', event.target.value)} placeholder="Service name" /></Field><Field label="Price" required><input type="number" min="0" value={item.price} onChange={event => updateService(item.id, 'price', event.target.value)} placeholder="₹ Price" /></Field><Field label="Duration" required hint="Minutes"><input type="number" min="5" value={item.duration} onChange={event => updateService(item.id, 'duration', event.target.value)} placeholder="Minutes" /></Field></div>
          <Field label="Description" hint="Optional"><textarea className="editor-description" value={item.description} onChange={event => updateService(item.id, 'description', event.target.value)} placeholder="Optional description" rows="2" /></Field>
        </CollapsibleEditorCard>;
      })}</div>
      {!services.length && <div className="editor-empty">No services added yet. Load the defaults for your salon type or add one manually.</div>}
    </CollapsibleSection>
    <CollapsibleSection id="barbers" innerRef={node => { sectionRefs.current.barbers = node; }} icon={<UsersRound size={18} />} title="Barbers" subtitle={EDITOR_SECTION_SUBTITLES.barbers} count={barbers.length} flag={sectionFlag('barbers')} summary={sectionSummary('barbers', barbers.length ? `${barbers.length} team member${barbers.length === 1 ? '' : 's'}` : 'No barbers added yet')} open={openSections.barbers} onToggle={() => toggleSection('barbers')} headingActions={<button type="button" className="add-inline-button" onClick={addBarber}><Plus size={15} /> Add Barber</button>}>
      <p className="collapsible-lede">Optional · add the people customers can choose during booking. Every barber needs a Barber Name <em className="required-star">*</em>.</p>
      <div className="editor-items">{barbers.map(item => {
        const itemKey = `barber-${item.id}`;
        return <CollapsibleEditorCard idPrefix={itemKey} image={<label className="editor-barber-image" aria-label={`Replace photo for ${item.name || 'new barber'}`}><ImageWithFallback src={item.image} fallback={PERSON_PLACEHOLDER} alt="" /><span><Pencil size={11} /></span><input type="file" accept="image/*" onChange={event => selectBarberImage(item.id, event)} /></label>} title={item.name || 'New Barber'} flag={barberIncomplete(item) ? 'Name required' : ''} subtitle={item.isAvailable ? 'Available' : 'Away'} expanded={Boolean(expandedItems[itemKey])} onToggle={() => toggleItem(itemKey)} onDelete={() => removeBarber(item.id)} deleteLabel={`Delete ${item.name || 'barber'}`} key={item.id}>
          <div className="form-two-col"><Field label="Barber Name" required><input value={item.name} onChange={event => updateBarber(item.id, 'name', event.target.value)} placeholder="Barber name" /></Field><Field label="Rating" hint="Optional · out of 5"><input type="number" min="0" max="5" step="0.1" value={item.rating} onChange={event => updateBarber(item.id, 'rating', event.target.value)} placeholder="Rating" /></Field></div>
          <div className="switch-form-row"><span><strong>Availability</strong><small>Available barbers can be picked at booking.</small></span><Toggle checked={item.isAvailable} onChange={value => updateBarber(item.id, 'isAvailable', value)} /></div>
        </CollapsibleEditorCard>;
      })}</div>
      {!barbers.length && <div className="editor-empty">No barbers added. Customers can still choose any available chair.</div>}
    </CollapsibleSection>
    <div className="editor-actions"><Button type="button" variant="secondary" onClick={cancelEdit} disabled={saving}>Cancel</Button><Button type="submit" loading={saving}>{needsPaymentStep ? 'Save and continue to payment' : isOnboarding ? 'Save and continue' : 'Save profile'} <Check size={17} /></Button></div>
  </form></div>;
}

export function BookingRequestScreen({ params, navigate, notify }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [delayOpen, setDelayOpen] = useState(params?.openDelayModal === true || params?.openDelayModal === 'true');
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [expired, setExpired] = useState(false);
  const bookingRequestId = params?.bookingRequestId || '';
  // The mobile app shows a 60-second countdown on a booking-request notification
  // and auto-cancels it after 70s. Mirror that timer here (the web Notification
  // API cannot render a live chronometer).
  const DURATION_MS = 60000;

  const loadRequest = useCallback(() => {
    if (!bookingRequestId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    return api.getBookingRequestById(bookingRequestId)
      .then(response => {
        setDetails(response?.data);
        const created = response?.data?.createdAt || response?.data?.bookingRequestTime || response?.data?.createdAtTimestamp;
        const createdMs = created ? new Date(created).getTime() : Date.now();
        const base = Number.isFinite(createdMs) && createdMs > 0 ? createdMs : Date.now();
        setDeadline(base + DURATION_MS);
      })
      .catch(error => notify?.('error', getErrorMessage(error, 'Unable to load booking request.')))
      .finally(() => setLoading(false));
  }, [bookingRequestId, notify]);

  useEffect(() => { loadRequest(); }, [loadRequest]);

  // Countdown ticking + expiry handling. Expiry is a one-time transition: it
  // closes the browser notification (mobile auto-cancels after 70s) and flips
  // the card to expired; the user taps Refresh to re-check the server state.
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      const remaining = deadline - Date.now();
      setNow(Date.now());
      if (remaining <= 0) {
        setExpired(true);
        if (bookingRequestId) closeNotification(bookingRequestId);
      }
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [bookingRequestId, deadline]);

  const remaining = deadline ? Math.max(0, deadline - now) : 0;
  const remainingSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const countdownLabel = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const timerActive = deadline && !expired && remaining > 0;
  const timerWarning = timerActive && remaining <= 15000;

  const action = async (value, delayMinutes) => {
    setActionLoading(value);
    try {
      const response = value === 'DELAY'
        ? await api.salonDelayBooking(bookingRequestId, delayMinutes)
        : await api.bookingRequestOwnerAction(bookingRequestId, { action: value });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not update request');
      notify?.('success', value === 'ACCEPT' ? 'Booking accepted.' : value === 'REJECT' ? 'Booking rejected.' : `Customer notified about a ${delayMinutes}-minute delay.`);
      setDelayOpen(false);
      closeNotification(bookingRequestId);
      navigate('queue');
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not update booking request.'));
    } finally {
      setActionLoading('');
    }
  };

  const refresh = () => { setExpired(false); setDeadline(0); loadRequest(); };

  if (loading) return <div className="screen"><PageHeader title="Booking request" onBack={() => navigate(-1)} /><div className="account-loading"><Spinner label="Loading request…" /></div></div>;
  return <div className="screen booking-request-screen"><PageHeader title="New booking request" subtitle="A customer is waiting for your response." onBack={() => navigate('queue')} /><div className="request-card"><div className="request-card-top"><div className="request-avatar">{getInitials(details?.customerName || 'Guest')}</div><div><span className="eyebrow">CUSTOMER</span><h2>{details?.customerName || 'Guest'}</h2><span className="request-status"><i /> {expired ? 'Response window closed' : 'Needs your response'}</span></div><div className={cx('request-timer', timerWarning && 'timer-warning')}><small>{expired ? 'Expired' : timerActive ? `Respond in` : '—'}</small>{timerActive && <strong>{countdownLabel}</strong>}</div></div><div className="request-detail-grid"><div><CalendarDays size={17} /><span><small>Selected date</small><strong>{formatDate(details?.bookingDate)}</strong></span></div><div><Clock3 size={17} /><span><small>Time slot</small><strong>{details?.startTime || '—'} – {details?.endTime || '—'}</strong></span></div><div><Scissors size={17} /><span><small>Services</small><strong>{details?.services || 'Salon service'}</strong></span></div></div></div>{expired && <div className="request-expired-note"><Info size={16} /><p>The 60-second response window has closed. This request may have been released to another customer — refresh to check its current status.</p><button onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>}<div className="request-actions">{!expired && <div><Button variant="success" loading={actionLoading === 'ACCEPT'} onClick={() => action('ACCEPT')}>Accept <Check size={17} /></Button><Button variant="danger" loading={actionLoading === 'REJECT'} onClick={() => action('REJECT')}>Reject <X size={17} /></Button></div>}{!expired && <Button variant="warning" loading={actionLoading === 'DELAY'} onClick={() => setDelayOpen(true)}>Update time <Clock3 size={17} /></Button>}</div><Modal open={delayOpen} onClose={() => setDelayOpen(false)} title="Update time & notify customer"><p className="modal-lede">If you are running a little late, choose a delay. My Naai will send the customer a delay request so they can accept or decline the updated time.</p><div className="delay-options">{[20, 40, 60].map(minutes => <button key={minutes} onClick={() => action('DELAY', minutes)} disabled={Boolean(actionLoading)}><Clock3 size={17} /><span><strong>+{minutes} minutes</strong><small>Send delay request to customer</small></span><ChevronRight size={16} /></button>)}</div></Modal></div>;
}
