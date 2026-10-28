// Leaflet map: one circle marker per location, styled by its status.
/* global L */

// Marker colours mirror the --mk-* tokens in app.css (tiles stay light in dark
// mode, so there is no dark variant). Open = tarnished grey with a strong dark
// outline, on the way = blue (filled for us, ring for others), cleaned = brass.
// Cleaned is smaller and drawn below the rest so open stones stay visible.
const STYLES = {
  open: { radius: 8, color: '#1c1812', weight: 3, fillColor: '#8c867b', fillOpacity: 1 },
  own: { radius: 11, color: '#06183a', weight: 3, fillColor: '#1a5fc0', fillOpacity: 1 },
  other: { radius: 9, color: '#1a5fc0', weight: 4, fillColor: '#ffffff', fillOpacity: 1 },
  cleaned: { radius: 5.5, color: '#4a3300', weight: 2, fillColor: '#e3b92d', fillOpacity: 1 },
};

export function createMap(el, { onSelect }) {
  const renderer = L.canvas({ padding: 0.3, tolerance: 10 });
  const map = L.map(el, { renderer, zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  const markers = new Map(); // id -> { marker, kind, note, noteMarker }
  let selectedId = null;
  let userDot = null;
  let userHalo = null;
  let selRing = null; // black ring with white halo around the selected marker

  const noteIcon = L.divIcon({ className: 'note-dot', iconSize: [10, 10], iconAnchor: [-4, 14] });

  function styleFor(kind, selected) {
    const s = { ...STYLES[kind] };
    if (selected) {
      s.radius += 3;
    }
    return s;
  }

  function setLocations(locations) {
    for (const loc of locations) {
      const marker = L.circleMarker([loc.lat, loc.lon], { ...styleFor('open', false), renderer });
      marker.on('click', () => onSelect(loc.id));
      marker.addTo(map);
      markers.set(loc.id, { marker, kind: 'open', note: false, noteMarker: null, loc });
    }
  }

  /** kindOf(id) -> 'open' | 'own' | 'other' | 'cleaned'; hasNote(id) -> boolean */
  function update(kindOf, hasNote) {
    for (const [id, m] of markers) {
      const kind = kindOf(id);
      const selected = id === selectedId;
      if (kind !== m.kind || selected !== m.selected) {
        m.marker.setStyle(styleFor(kind, selected));
        if (kind !== 'cleaned' || selected) m.marker.bringToFront();
        m.kind = kind;
        m.selected = selected;
      }
      const note = hasNote(id);
      if (note && !m.noteMarker) {
        m.noteMarker = L.marker([m.loc.lat, m.loc.lon], { icon: noteIcon, interactive: false, keyboard: false }).addTo(map);
      } else if (!note && m.noteMarker) {
        m.noteMarker.remove();
        m.noteMarker = null;
      }
    }
    updateSelection();
  }

  function updateSelection() {
    const m = selectedId && markers.get(selectedId);
    if (!m) {
      if (selRing) { selRing.remove(); selRing = null; }
      return;
    }
    const radius = STYLES[m.kind].radius + 3 + 6;
    const style = { radius, color: '#000000', weight: 3, fill: false, interactive: false };
    if (!selRing) selRing = L.circleMarker(m.marker.getLatLng(), { ...style, renderer }).addTo(map);
    else selRing.setLatLng(m.marker.getLatLng()).setStyle(style);
    selRing.bringToFront();
  }

  function select(id) {
    selectedId = id;
  }

  /** Pans so the location is comfortably inside the visible map. */
  function reveal(id) {
    const m = markers.get(id);
    if (!m) return;
    const ll = m.marker.getLatLng();
    const inner = map.getBounds().pad(-0.15);
    if (!inner.contains(ll)) map.panTo(ll);
    if (map.getZoom() < 15) map.setView(ll, 16);
  }

  function setUserPosition(lat, lon, accuracy) {
    if (!userDot) {
      userHalo = L.circle([lat, lon], {
        radius: accuracy, color: '#CC79A7', weight: 1, opacity: 0.6, fillColor: '#CC79A7', fillOpacity: 0.12, interactive: false,
      }).addTo(map);
      userDot = L.circleMarker([lat, lon], {
        radius: 9, color: '#ffffff', weight: 3, fillColor: '#CC79A7', fillOpacity: 1, interactive: false,
      }).addTo(map);
    } else {
      userDot.setLatLng([lat, lon]);
      userHalo.setLatLng([lat, lon]).setRadius(accuracy);
    }
    userDot.bringToFront();
  }

  function fitTo(locations) {
    if (!locations.length) {
      map.setView([48.8045, 9.2160], 15);
      return;
    }
    // Fit the dense core: drop the outer 5 % on each axis so a few outliers don't zoom out.
    const q = (vals, p) => vals.sort((a, b) => a - b)[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const lats = locations.map((l) => l.lat);
    const lons = locations.map((l) => l.lon);
    const bounds = L.latLngBounds([q(lats, 0.05), q(lons, 0.05)], [q(lats, 0.95), q(lons, 0.95)]);
    map.fitBounds(bounds, { padding: [16, 16] });
  }

  return { map, setLocations, update, select, reveal, setUserPosition, fitTo };
}
