import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, LocateFixed, MapPin, Minus, Plus, Trash2 } from 'lucide-react';
import { cx, getBrowserLocation } from './Shared';
import { readPermission } from '../lib/permissions';
import { toPoint } from '../lib/geo';
import {
  DEFAULT_MAP_CENTRE,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panCentre,
  pointToScreen,
  roundPoint,
  screenToPoint,
  visibleTiles,
} from '../lib/tileMap';

// Dropping a pin is the one thing the read-only map preview cannot do, and the
// reason "No location saved yet" used to be a dead end: a partner could see the
// words, not the place. This is a small, keyless OpenStreetMap surface — plain
// raster tiles from openstreetmap.org, no SDK, no billing account (see the note
// at the top of `src/lib/tileMap.js` for why it is hand-rolled) — where the map
// is on screen the whole time and one tap puts the pin on the gate.
//
// It starts where the person probably is: the saved pin if there is one,
// otherwise their device location, otherwise Nagpur. A pin dropped here is
// reported through `onChange`, so the parent owns saving and validation.
const PIN_ZOOM = 17;
const START_ZOOM = 13;
const DRAG_THRESHOLD = 5;

export function LocationPicker({
  value,
  onChange,
  height = 220,
  label = 'Tap the map to drop your pin',
  // A parent that already owns the permission conversation (the partner editor
  // has a settings sheet for a blocked permission) passes it in; without one
  // the picker just asks the browser.
  onLocate = null,
  locateLabel = 'Use my current location',
  locating = false,
  message = '',
  disabled = false,
  // On a first visit the map should already be where the person is, not on a
  // city they have to hunt for. Only a permission that is ALREADY granted is
  // used here — an unasked device gets no popup from a map merely rendering.
  autoLocate = true,
}) {
  const point = toPoint(value);
  const [centre, setCentre] = useState(() => point || DEFAULT_MAP_CENTRE);
  const [zoom, setZoom] = useState(() => (point ? PIN_ZOOM : START_ZOOM));
  const [size, setSize] = useState({ width: 320, height });
  const [dragging, setDragging] = useState(false);
  const [selfLocating, setSelfLocating] = useState(false);
  const [localError, setLocalError] = useState('');
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  // The last pin THIS component emitted: a pin the user just dropped must not
  // re-centre the map under their finger, while one that arrives from outside
  // (geolocation, a freshly loaded profile) should.
  const emittedRef = useRef(null);
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;

  const emit = useCallback(next => {
    const rounded = roundPoint(next);
    if (!rounded) return;
    emittedRef.current = rounded;
    onChange?.(rounded);
  }, [onChange]);

  const pointKey = point ? `${point.latitude},${point.longitude}` : '';
  useEffect(() => {
    if (!pointKey) return;
    const emitted = emittedRef.current;
    if (emitted && `${emitted.latitude},${emitted.longitude}` === pointKey) return;
    setCentre(point);
    setZoom(current => Math.max(current, PIN_ZOOM));
    // `point` is derived from `pointKey`; the key is the dependency on purpose.
  }, [pointKey]);

  // The tile grid is laid out for the real box, so it has to be measured.
  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return undefined;
    const measure = () => {
      const width = node.clientWidth || 320;
      const boxHeight = node.clientHeight || height;
      setSize(current => (current.width === width && current.height === boxHeight ? current : { width, height: boxHeight }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height]);

  const autoLocated = useRef(false);
  const locate = async () => {
    if (disabled) return;
    if (onLocate) {
      await onLocate();
      return;
    }
    setSelfLocating(true);
    setLocalError('');
    try {
      const fix = await getBrowserLocation();
      if (!fix) {
        setLocalError('Could not read this device’s location. Allow location access, or tap the map where the salon is.');
        return;
      }
      emit(fix);
    } finally {
      setSelfLocating(false);
    }
  };

  useEffect(() => {
    if (autoLocated.current || disabled || !autoLocate || pointKey) return undefined;
    autoLocated.current = true;
    let cancelled = false;
    readPermission('location')
      .then(state => { if (!cancelled && state === 'granted') locate(); })
      .catch(() => { /* no permission API: the button is the ask */ });
    return () => { cancelled = true; };
    // Mount-only on purpose: this is the "where am I?" first look.
  }, []);

  const dropPinAt = (clientX, clientY) => {
    const node = surfaceRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    emit(screenToPoint(
      { left: clientX - rect.left, top: clientY - rect.top },
      { centre, zoom, width: rect.width, height: rect.height }
    ));
  };

  const onPointerDown = event => {
    if (disabled || event.button === 2) return;
    dragRef.current = {
      downX: event.clientX,
      downY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  };

  const onPointerMove = event => {
    const state = dragRef.current;
    if (!state || disabled) return;
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    if (!state.moved) {
      if (Math.hypot(event.clientX - state.downX, event.clientY - state.downY) < DRAG_THRESHOLD) return;
      state.moved = true;
      setDragging(true);
    }
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    setCentre(current => panCentre(current, { left: dx, top: dy }, currentZoom.current));
  };

  const endDrag = event => {
    const state = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!state || disabled) return;
    // A tap (no meaningful movement) places the pin; a drag was a pan.
    if (state.moved) return;
    dropPinAt(event.clientX, event.clientY);
  };

  const onKeyDown = event => {
    if (disabled) return;
    const step = 60;
    const moves = {
      ArrowUp: { left: 0, top: step },
      ArrowDown: { left: 0, top: -step },
      ArrowLeft: { left: step, top: 0 },
      ArrowRight: { left: -step, top: 0 },
    };
    if (moves[event.key]) {
      event.preventDefault();
      setCentre(current => panCentre(current, moves[event.key], currentZoom.current));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      emit(centre);
    }
  };

  const tiles = visibleTiles({ centre, zoom, width: size.width, height: size.height });
  const marker = point ? pointToScreen(point, { centre, zoom, width: size.width, height: size.height }) : null;
  const markerVisible = marker && marker.left >= -12 && marker.left <= size.width + 12 && marker.top >= -12 && marker.top <= size.height + 12;
  const busy = locating || selfLocating;

  return (
    <div className={cx('location-picker', disabled && 'is-disabled')}>
      <div
        ref={surfaceRef}
        className={cx('location-picker-map', dragging && 'is-dragging')}
        style={{ height: `${height}px` }}
        role="application"
        aria-label={`${label}. Use the arrow keys to move the map, Enter to drop the pin where the crosshair is.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        onPointerLeave={event => { if (dragRef.current) endDrag(event); }}
        onKeyDown={onKeyDown}
      >
        {size.width > 0 && tiles.map(tile => (
          <img
            key={tile.key}
            className="location-picker-tile"
            src={tile.src}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading="lazy"
            style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
          />
        ))}
        {point && markerVisible && (
          <span className="location-picker-pin" style={{ left: `${marker.left}px`, top: `${marker.top}px` }} aria-hidden="true">
            <MapPin size={30} />
          </span>
        )}
        {!point && <span className="location-picker-hint">{label}</span>}
        <div className="location-picker-tools">
          <button type="button" onClick={() => setZoom(current => clampZoom(current + 1))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in"><Plus size={15} /></button>
          <button type="button" onClick={() => setZoom(current => clampZoom(current - 1))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out"><Minus size={15} /></button>
          <button type="button" onClick={() => { if (point) { setCentre(point); setZoom(PIN_ZOOM); } }} disabled={!point} aria-label="Recentre on the pin"><Crosshair size={15} /></button>
        </div>
        <span className="location-picker-attr">© OpenStreetMap</span>
      </div>

      <div className="location-picker-actions">
        <button type="button" className="location-picker-locate" onClick={locate} disabled={disabled || busy}>
          <LocateFixed size={14} /> {busy ? 'Finding you…' : locateLabel}
        </button>
        {point && (
          <button type="button" className="location-picker-clear" onClick={() => { emittedRef.current = null; onChange?.(null); }}>
            <Trash2 size={13} /> Clear pin
          </button>
        )}
        {point && <span className="location-picker-read">{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span>}
      </div>

      {(message || localError) && <p className="location-picker-error">{message || localError}</p>}
    </div>
  );
}

export default LocationPicker;
