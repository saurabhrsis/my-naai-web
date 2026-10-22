import { ExternalLink, MapPin } from 'lucide-react';
import { formatCoordinates, mapsUrl, openStreetMapEmbedUrl, toPoint } from '../lib/geo';

/**
 * LocationMap — the portal's read-only map preview.
 *
 * The admin panel and the distributor portal render an interactive Leaflet
 * map (they *place* pins). This portal confirms a point: the salon's own
 * location, and the delivery point a shop order was snapped to. A plain
 * OpenStreetMap embed is enough for that, and it keeps the PWA free of a map
 * SDK: no API key, no billing account (the one interactive surface — dropping
 * a pin — is `LocationPicker`, which draws its own tiles).
 *
 * An EMPTY map is not a grey box any more. When there is no pin but the caller
 * knows roughly where the person is (`fallbackPoint` — the device location, or
 * the city the portal starts in), the map is drawn there with no marker and a
 * "no pin saved" badge, so the next tap is "set my location" instead of a dead
 * end. A marker is never drawn on a fallback: a pin in the middle of Nagpur
 * would claim the salon is already there.
 *
 * If the embed cannot load, the surrounding card still shows the coordinates
 * and the "Open in Maps" link, so the information is never trapped behind an
 * iframe.
 */
export function LocationMap({
  value,
  fallbackPoint = null,
  height = 200,
  ariaLabel = 'Location map',
  className = '',
  emptyTitle = 'No location saved yet',
  emptyHint = 'Save the salon GPS location so delivery partners can find you.',
}) {
  const point = toPoint(value);
  const fallback = point ? null : toPoint(fallbackPoint);

  if (!point && !fallback) {
    return (
      <div className={`location-map location-map-empty ${className}`} style={{ minHeight: `${Math.round(height * 0.6)}px` }}>
        <MapPin size={20} />
        <span>{emptyTitle}</span>
        <small>{emptyHint}</small>
      </div>
    );
  }

  const src = point
    ? openStreetMapEmbedUrl(point)
    // A wider box: this is "the area", not "the gate".
    : openStreetMapEmbedUrl(fallback, { span: 0.12, marker: false });

  return (
    <div className={`location-map ${point ? '' : 'location-map-unpinned'} ${className}`} style={{ height: `${height}px` }}>
      <iframe
        title={ariaLabel}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ border: 0, width: '100%', height: '100%' }}
      />
      {!point && (
        <span className="location-map-badge">
          <MapPin size={12} /> {emptyTitle}
        </span>
      )}
    </div>
  );
}

/**
 * The card a partner reads: where the point is, how precise it is, and a way
 * into a full map app (turn-by-turn lives there, not here).
 */
export function LocationPreview({
  value,
  fallbackPoint = null,
  title = 'Location',
  caption = '',
  height = 190,
  className = '',
  emptyTitle = 'No pin saved yet',
  emptyHint = '',
  action = null, // optional extra button (e.g. "Update pin")
}) {
  const point = toPoint(value);
  const url = mapsUrl(point);
  return (
    <section className={`location-preview ${className}`}>
      <div className="location-preview-head">
        <h3><MapPin size={15} /> {title}</h3>
        {url && (
          <a className="location-preview-link" href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> Open in Maps
          </a>
        )}
      </div>
      {point && <p className="location-preview-coords">{formatCoordinates(point)}</p>}
      {caption && <p className="location-preview-caption">{caption}</p>}
      {action}
      <LocationMap
        value={point}
        fallbackPoint={fallbackPoint}
        height={height}
        ariaLabel={`${title} map`}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
      />
    </section>
  );
}

export default LocationMap;
