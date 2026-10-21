import { ExternalLink, MapPin } from 'lucide-react';
import { formatCoordinates, mapsUrl, openStreetMapEmbedUrl, toPoint } from '../lib/geo';

/**
 * LocationMap — the salon portal's read-only map preview.
 *
 * The admin panel and the distributor portal render an interactive Leaflet
 * map (they *place* pins). This portal only ever *confirms* a point: the
 * salon's own location, and the delivery point a shop order was snapped to.
 * A plain OpenStreetMap embed is enough for that, and it keeps the PWA free of
 * a map SDK: no API key, no billing account, no extra bundle weight on a
 * phone that may be on a slow connection.
 *
 * If the embed cannot load, the surrounding card still shows the coordinates
 * and the "Open in Maps" link, so the information is never trapped behind an
 * iframe.
 */
export function LocationMap({ value, height = 200, ariaLabel = 'Location map', className = '' }) {
  const point = toPoint(value);
  const src = point ? openStreetMapEmbedUrl(point) : '';
  if (!src) {
    return (
      <div className={`location-map location-map-empty ${className}`} style={{ minHeight: `${Math.round(height * 0.6)}px` }}>
        <MapPin size={20} />
        <span>No location saved yet</span>
        <small>Save the salon GPS location so delivery partners can find you.</small>
      </div>
    );
  }
  return (
    <div className={`location-map ${className}`} style={{ height: `${height}px` }}>
      <iframe
        title={ariaLabel}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ border: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}

/**
 * The card a partner reads: where the point is, how precise it is, and a way
 * into a full map app (turn-by-turn lives there, not here).
 */
export function LocationPreview({
  value,
  title = 'Location',
  caption = '',
  height = 190,
  className = '',
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
      <LocationMap value={point} height={height} ariaLabel={`${title} map`} />
    </section>
  );
}

export default LocationMap;
