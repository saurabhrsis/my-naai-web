import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Scissors, Trash2, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { DEFAULT_SERVICES } from '../lib/defaultServices';
import { salonProfileFromResponse } from '../lib/salonProfile';
import { useConfirm } from './ConfirmDialog';
import {
  Button,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  cx,
  formatCurrency,
  getErrorMessage,
} from './Shared';

// Editing the menu, on its own.
//
// The salon account screen already had one Edit button, which opens the whole
// profile editor: seven collapsed cards, of which a partner who only wants to
// change "Haircut ₹250 → ₹300" needs exactly one. Worse, that editor saves
// everything in one request — address, images, hours, barbers — so a small price
// change also re-sends every other field.
//
// This screen edits services and nothing else, and it is deliberately the
// opposite of the accordion: EVERY service is open as a fillable row from the
// first paint, because the real task is "run down my list and fix the prices",
// not "open one card, read it, close it, open the next". Four things make that
// fast:
//
//   · every row is already an input — no tap to open, no tap to close;
//   · Enter walks Service → Price → Duration → Description of the same row and
//     then adds a new row and puts the cursor in it, so a whole menu can be
//     typed without touching the mouse;
//   · the duration is a select of the lengths salons actually use (plus whatever
//     an existing service already has), so "45" can never become "450";
//   · names are suggested from the default menu for the salon type, so the first
//     letter fills the common ones.
//
// The save is one request to `POST /api/salons/services/save` that carries the
// services and the ids to drop — nothing else about the salon. See
// docs/BACKEND-SALON-SERVICES-API.md.

// The durations a salon actually uses. A row whose saved duration is not here
// keeps its own value as an extra option instead of being silently rounded.
export const SERVICE_DURATIONS = [10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120];

// Shared with the profile editor: the same validation, so a service that this
// screen accepts is never rejected by the profile editor and vice versa.
export const SERVICE_LIMITS = { nameMin: 2, nameMax: 100, priceMax: 1000000, durationMin: 1, durationMax: 1440 };

let rowSeq = 0;

const text = value => String(value ?? '').trim();
const durationOf = value => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 60;
};

// One editable row. `key` is a local identity (a new row has no serviceId yet);
// `serviceId` is what the server knows the row by.
export function serviceRowFrom(item = {}) {
  const serviceId = item.serviceId || item.id || null;
  return {
    key: serviceId ? String(serviceId) : `new-service-${(rowSeq += 1)}`,
    serviceId: serviceId ? String(serviceId) : null,
    name: text(item.serviceName ?? item.name),
    price: item.price === undefined || item.price === null || item.price === '' ? '' : String(Number(item.price)),
    duration: String(durationOf(item.durationMinutes ?? item.duration)),
    description: text(item.description),
  };
}

export function serviceRowsFromProfile(profile = {}) {
  const list = Array.isArray(profile.services) ? profile.services : [];
  return list.map(serviceRowFrom);
}

export function blankServiceRow() {
  return { key: `new-service-${(rowSeq += 1)}`, serviceId: null, name: '', price: '', duration: '30', description: '' };
}

// What is wrong with one row, field by field. An empty row the partner has not
// touched yet is reported as empty rather than "too short", so the message reads
// like a sentence a person would say.
export function validateServiceRow(row = {}, { duplicate = false } = {}) {
  const errors = {};
  const name = text(row.name);
  if (!name) errors.name = 'Add the service name';
  else if (name.length < SERVICE_LIMITS.nameMin) errors.name = 'Name is too short';
  else if (name.length > SERVICE_LIMITS.nameMax) errors.name = 'Keep the name under 100 characters';
  else if (duplicate) errors.name = 'Two services have this name';

  const price = text(row.price);
  if (price === '') errors.price = 'Add the price';
  else if (!Number.isFinite(Number(price)) || Number(price) < 0) errors.price = 'Price must be a number, 0 or more';
  else if (Number(price) > SERVICE_LIMITS.priceMax) errors.price = 'That price looks too high';

  const duration = Number(row.duration);
  if (!Number.isFinite(duration) || duration < SERVICE_LIMITS.durationMin) errors.duration = 'Add the minutes';
  else if (duration > SERVICE_LIMITS.durationMax) errors.duration = 'Keep it under 24 hours';

  return errors;
}

// Rows keyed by a normalised name, so "hair cut" and "Hair  Cut" collide the way
// a customer reading the menu would see them.
function duplicateNameKeys(rows = []) {
  const seen = new Map();
  rows.forEach(row => {
    const key = text(row.name).toLowerCase().replace(/\s+/g, ' ');
    if (!key) return;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

export function validateServiceRows(rows = []) {
  const duplicates = duplicateNameKeys(rows);
  const errorsByKey = {};
  rows.forEach(row => {
    const key = text(row.name).toLowerCase().replace(/\s+/g, ' ');
    const errors = validateServiceRow(row, { duplicate: Boolean(key) && duplicates.has(key) });
    if (Object.keys(errors).length) errorsByKey[row.key] = errors;
  });
  return { errorsByKey, valid: Object.keys(errorsByKey).length === 0 };
}

// The request body. Only what the endpoint understands: the menu as it should
// look (order included) and the ids to take off it. The salon id is never sent —
// the server reads it from the partner's token, so one salon cannot edit another
// salon's menu by editing the payload.
export function buildServicesPayload(rows = [], removedServiceIds = []) {
  return {
    services: rows.map((row, index) => ({
      ...(row.serviceId ? { serviceId: row.serviceId } : {}),
      serviceName: text(row.name),
      price: Number(Number(row.price || 0).toFixed(2)),
      durationMinutes: durationOf(row.duration),
      ...(text(row.description) ? { description: text(row.description) } : {}),
      displayOrder: index,
    })),
    removedServiceIds: removedServiceIds.filter(Boolean),
  };
}

// Names to suggest while typing. The salon's own type comes first, then the
// other default menus, deduplicated.
export function serviceNameSuggestions(genderType = '', extra = []) {
  const type = String(genderType || '').toLowerCase();
  const order = [type, ...Object.keys(DEFAULT_SERVICES).filter(key => key !== type)];
  const names = [];
  order.forEach(key => (DEFAULT_SERVICES[key] || []).forEach(item => names.push(text(item.serviceName))));
  extra.forEach(name => names.push(text(name)));
  return [...new Set(names.filter(Boolean))];
}

export function EditSalonServicesScreen({ session, navigate, notify }) {
  const confirm = useConfirm();
  const salonId = session?.userId || '';
  const [rows, setRows] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [errorsByKey, setErrorsByKey] = useState({});
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [savedAt, setSavedAt] = useState(false);
  const [profile, setProfile] = useState({});
  const fieldRefs = useRef({});
  // Set on mount by the loader and never changed afterwards: comparing against it
  // is what makes "are there unsaved edits?" cheap and exact.
  const snapshotOf = useCallback((nextRows, nextRemoved) => JSON.stringify(buildServicesPayload(nextRows, nextRemoved)), []);

  const load = useCallback(async () => {
    if (!salonId) { setLoading(false); setLoadError('Sign in again to edit your services.'); return; }
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.salonProfile({ salonId });
      const data = salonProfileFromResponse(response);
      if (!data || (response?.status && response.status !== 'SUCCESS')) throw new Error(response?.message || 'Could not load your services.');
      const nextRows = serviceRowsFromProfile(data);
      setProfile(data);
      setRows(nextRows);
      setRemoved([]);
      setErrorsByKey({});
      setSavedSnapshot(snapshotOf(nextRows, []));
      setSavedAt(false);
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Could not load your services.'));
    } finally {
      setLoading(false);
    }
  }, [salonId, snapshotOf]);

  useEffect(() => { load(); }, [load]);

  const dirty = snapshotOf(rows, removed) !== savedSnapshot;
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.price || 0), 0), [rows]);
  const suggestions = useMemo(() => serviceNameSuggestions(profile.genderType, rows.map(row => row.name)), [profile.genderType, rows]);

  const focusField = useCallback((key, field) => {
    const node = fieldRefs.current[`${key}:${field}`];
    if (node) { node.focus(); if (node.select) node.select(); }
  }, []);

  const updateRow = useCallback((key, patch) => {
    setSavedAt(false);
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)));
    // Clear a row's error as soon as the partner starts fixing it — a red border
    // that stays after the fix reads as "still wrong".
    setErrorsByKey(current => (current[key] ? { ...current, [key]: {} } : current));
  }, []);

  const addRow = useCallback((afterKey = null) => {
    const row = blankServiceRow();
    setSavedAt(false);
    setRows(current => {
      if (!afterKey) return [...current, row];
      const index = current.findIndex(item => item.key === afterKey);
      if (index === -1) return [...current, row];
      const next = [...current];
      next.splice(index + 1, 0, row);
      return next;
    });
    // Focus after paint: the input does not exist until React has rendered it.
    requestAnimationFrame(() => focusField(row.key, 'name'));
    return row;
  }, [focusField]);

  const moveRow = useCallback((key, offset) => {
    setSavedAt(false);
    setRows(current => {
      const index = current.findIndex(row => row.key === key);
      const target = index + offset;
      if (index === -1 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const removeRow = useCallback(async key => {
    const row = rows.find(item => item.key === key);
    if (!row) return;
    if (!row.serviceId) {
      // Never saved, so there is nothing to tell the server about.
      setRows(current => current.filter(item => item.key !== key));
      setErrorsByKey(current => { const { [key]: _drop, ...rest } = current; return rest; });
      return;
    }
    const confirmed = await confirm({
      title: `Remove ${row.name || 'this service'}?`,
      message: 'Customers will not be able to book it any more. Past bookings that used it stay exactly as they are. You can undo this until you save.',
      confirmLabel: 'Remove from menu',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: Trash2,
    });
    if (!confirmed) return;
    setSavedAt(false);
    // The whole row is kept, not just its id: Undo has to put the price and the
    // duration back, not an empty line with a familiar name.
    setRemoved(current => [...current, { ...row, name: row.name || 'Service' }]);
    setRows(current => current.filter(item => item.key !== key));
  }, [confirm, rows]);

  const undoRemove = useCallback(serviceId => {
    const entry = removed.find(item => item.serviceId === serviceId);
    if (!entry) return;
    setSavedAt(false);
    setRemoved(current => current.filter(item => item.serviceId !== serviceId));
    setRows(current => [...current, serviceRowFrom(entry)]);
  }, [removed]);

  // Enter walks the row and then adds the next one. This is the "fill it fast"
  // contract: a partner typing a menu never has to reach for the mouse.
  const onFieldKeyDown = useCallback((event, key, field) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const order = ['name', 'price', 'duration', 'description'];
    const next = order[order.indexOf(field) + 1];
    if (next) { focusField(key, next); return; }
    const isLastRow = rows[rows.length - 1]?.key === key;
    if (isLastRow) { addRow(); return; }
    const index = rows.findIndex(row => row.key === key);
    const following = rows[index + 1];
    if (following) focusField(following.key, 'name');
  }, [addRow, focusField, rows]);

  const loadDefaults = useCallback(async () => {
    const type = String(profile.genderType || '').toLowerCase();
    const defaults = (DEFAULT_SERVICES[type] || DEFAULT_SERVICES.unisex || []).map(item => serviceRowFrom({ ...item, serviceName: item.serviceName }));
    if (!defaults.length) return notify?.('error', 'No default menu for this salon type.');
    if (rows.length) {
      const confirmed = await confirm({
        title: 'Load the default menu?',
        message: `This replaces the ${rows.length} ${rows.length === 1 ? 'service' : 'services'} on this screen with the ${defaults.length} defaults for your salon type. Nothing is saved until you press Save services.`,
        confirmLabel: 'Load defaults',
        cancelLabel: 'Keep mine',
        tone: 'warning',
        icon: RefreshCw,
        defaultAction: 'cancel',
      });
      if (!confirmed) return;
    }
    setSavedAt(false);
    setRows(defaults);
    setErrorsByKey({});
  }, [confirm, notify, profile.genderType, rows.length]);

  const save = async () => {
    const { errorsByKey: found, valid } = validateServiceRows(rows);
    if (!valid) {
      setErrorsByKey(found);
      const firstKey = rows.find(row => found[row.key])?.key;
      if (firstKey) focusField(firstKey, Object.keys(found[firstKey])[0]);
      return notify?.('error', 'Every service needs a name, a price and a duration.');
    }
    setSaving(true);
    try {
      const payload = buildServicesPayload(rows, removed.map(item => item.serviceId));
      const response = await api.salonServicesSave(payload);
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response?.message || 'Could not save your services.');
      // The server answers with the menu as it is now stored — order, ids and all
      // — so the screen repaints from the record instead of from a guess.
      const saved = Array.isArray(response?.data?.services) ? serviceRowsFromProfile({ services: response.data.services }) : rows;
      setRows(saved);
      setRemoved([]);
      setErrorsByKey({});
      setSavedSnapshot(snapshotOf(saved, []));
      setSavedAt(true);
      notify?.('success', `Services saved — ${saved.length} ${saved.length === 1 ? 'service' : 'services'} on your menu.`);
    } catch (error) {
      const message = getErrorMessage(error, 'Could not save your services.');
      // A deployment that has not shipped the backend patch answers 404. Say so
      // plainly instead of pretending the save failed for an unknown reason.
      notify?.('error', /404|not found/i.test(message) ? 'Saving services needs the latest backend update. Please contact My Naai support.' : message);
    } finally {
      setSaving(false);
    }
  };

  const attemptLeave = useCallback(async () => {
    if (!dirty) return navigate(-1);
    const confirmed = await confirm({
      title: 'Discard your changes?',
      message: 'Your edits on this screen have not been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'warning',
      icon: Undo2,
      defaultAction: 'cancel',
    });
    if (confirmed) navigate(-1);
    return undefined;
  }, [confirm, dirty, navigate]);

  if (loading) {
    return (
      <div className="screen services-editor-screen">
        <PageHeader title="Your services" onBack={() => navigate(-1)} />
        <div className="detail-loading"><Spinner label="Loading your services…" /></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="screen services-editor-screen">
        <PageHeader title="Your services" onBack={() => navigate(-1)} />
        <EmptyState
          icon={Scissors}
          title="Services unavailable"
          message={loadError}
          action={<Button onClick={load}>Try again</Button>}
        />
      </div>
    );
  }

  const addButton = (
    <Button size="small" variant="secondary" onClick={() => addRow()}>
      <Plus size={15} /> Add service
    </Button>
  );

  return (
    <div className="screen services-editor-screen">
      <PageHeader
        title="Your services"
        subtitle="Prices and timing only — the rest of your profile is untouched."
        onBack={attemptLeave}
        action={addButton}
      />

      <div className="service-editor-summary">
        <div>
          <span className="eyebrow">ON YOUR MENU</span>
          <strong>{rows.length} {rows.length === 1 ? 'service' : 'services'}</strong>
          <small>{rows.length ? `Totals ${formatCurrency(total)} · customers book these at the price you set` : 'Add your first service to start taking bookings'}</small>
        </div>
        <div className="service-editor-state">
          {savedAt && !dirty && <span className="service-editor-saved"><Check size={14} /> Saved</span>}
          {dirty && <span className="service-editor-dirty">Unsaved changes</span>}
        </div>
      </div>

      {removed.length > 0 && (
        <div className="service-editor-removed" role="status">
          <span>
            <strong>{removed.length}</strong> {removed.length === 1 ? 'service' : 'services'} will be removed when you save
            {removed.map(item => (
              <button key={item.serviceId} type="button" className="service-editor-undo" onClick={() => undoRemove(item.serviceId)}>
                <Undo2 size={13} /> {item.name}
              </button>
            ))}
          </span>
          <small>Past bookings that used them stay as they are.</small>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No services yet"
          message="Add the services you offer with their price and how long they take. Customers can only book what is on this list."
          action={(
            <div className="empty-state-actions">
              <Button onClick={() => addRow()}><Plus size={16} /> Add your first service</Button>
              <Button variant="secondary" onClick={loadDefaults}><RefreshCw size={15} /> Load defaults</Button>
            </div>
          )}
        />
      ) : (
        <>
        <p className="service-editor-hint">
          <kbd>Enter</kbd> moves to the next field, and the last field of the last row adds a new service.
        </p>
        <ol className="service-editor-list">
          {rows.map((row, index) => {
            const rowErrors = errorsByKey[row.key] || {};
            const invalid = Object.keys(rowErrors).length > 0;
            return (
              <li key={row.key} className={cx('service-editor-row', invalid && 'has-error', !row.serviceId && 'is-new')} data-service-row>
                <div className="service-editor-row-head">
                  <span className="service-editor-index">{index + 1}</span>
                  <strong>{row.name || 'New service'}</strong>
                  {!row.serviceId && <span className="service-editor-badge">New</span>}
                  <div className="service-editor-tools">
                    <button type="button" className="icon-btn ghost" aria-label={`Move ${row.name || 'service'} up`} onClick={() => moveRow(row.key, -1)} disabled={index === 0}><ArrowUp size={15} /></button>
                    <button type="button" className="icon-btn ghost" aria-label={`Move ${row.name || 'service'} down`} onClick={() => moveRow(row.key, 1)} disabled={index === rows.length - 1}><ArrowDown size={15} /></button>
                    <button type="button" className="icon-btn ghost danger" aria-label={`Remove ${row.name || 'service'}`} onClick={() => removeRow(row.key)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="service-editor-fields">
                  <Field label="Service" required error={rowErrors.name}>
                    <input
                      ref={node => { fieldRefs.current[`${row.key}:name`] = node; }}
                      value={row.name}
                      list="mynaai-service-names"
                      placeholder="e.g. Haircut"
                      autoComplete="off"
                      aria-invalid={rowErrors.name ? 'true' : undefined}
                      onChange={event => updateRow(row.key, { name: event.target.value })}
                      onKeyDown={event => onFieldKeyDown(event, row.key, 'name')}
                    />
                  </Field>
                  <Field label="Price (₹)" required error={rowErrors.price}>
                    <input
                      ref={node => { fieldRefs.current[`${row.key}:price`] = node; }}
                      value={row.price}
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      aria-invalid={rowErrors.price ? 'true' : undefined}
                      onChange={event => updateRow(row.key, { price: event.target.value })}
                      onKeyDown={event => onFieldKeyDown(event, row.key, 'price')}
                    />
                  </Field>
                  <Field label="Duration" required error={rowErrors.duration}>
                    <select
                      ref={node => { fieldRefs.current[`${row.key}:duration`] = node; }}
                      value={row.duration}
                      aria-invalid={rowErrors.duration ? 'true' : undefined}
                      onChange={event => updateRow(row.key, { duration: event.target.value })}
                      onKeyDown={event => onFieldKeyDown(event, row.key, 'duration')}
                    >
                      {(SERVICE_DURATIONS.includes(Number(row.duration)) ? SERVICE_DURATIONS : [...SERVICE_DURATIONS, Number(row.duration)].sort((a, b) => a - b)).map(minutes => (
                        <option key={minutes} value={String(minutes)}>{minutes} min</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Description" hint="Optional" error={rowErrors.description}>
                    <input
                      ref={node => { fieldRefs.current[`${row.key}:description`] = node; }}
                      value={row.description}
                      placeholder="Optional note for customers"
                      onChange={event => updateRow(row.key, { description: event.target.value })}
                      onKeyDown={event => onFieldKeyDown(event, row.key, 'description')}
                    />
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
        </>
      )}

      <datalist id="mynaai-service-names">
        {suggestions.map(name => <option key={name} value={name} />)}
      </datalist>

      <div className="service-editor-actions">
        <div>
          <strong>{rows.length} {rows.length === 1 ? 'service' : 'services'}</strong>
          <small>{rows.length ? `${formatCurrency(total)} in total` : 'Nothing on the menu yet'}</small>
        </div>
        <div className="service-editor-buttons">
          {rows.length > 0 && <Button size="small" variant="secondary" onClick={() => addRow()}><Plus size={15} /> Add</Button>}
          <Button size="small" onClick={save} loading={saving} disabled={!dirty || saving}>
            Save services
          </Button>
        </div>
      </div>
    </div>
  );
}

export default EditSalonServicesScreen;
