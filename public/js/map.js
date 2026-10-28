// Leaflet map: one circle marker per location, styled by its status.
/* global L */

// Marker colours mirror the --mk-* tokens in app.css (tiles stay light in dark
// mode, so there is no dark variant). Open and cleaned share one size and swap
// their colours: open = dark with a brass edge, cleaned = brass with a dark edge.
// On the way = blue (filled for us, ring for others).
const STYLES = {
  open: { radius: 7, color: '#e3b92d', weight: 2, fillColor: '#4a3300', fillOpacity: 1 },
  own: { radius: 11, color: '#06183a', weight: 3, fillColor: '#1a5fc0', fillOpacity: 1 },
  other: { radius: 9, color: '#1a5fc0', weight: 4, fillColor: '#ffffff', fillOpacity: 1 },
  cleaned: { radius: 7, color: '#4a3300', weight: 2, fillColor: '#e3b92d', fillOpacity: 1 },
};

// Other phones (opt-in). Own group = green, other groups = purple, both with a dark edge;
// distinct from the stone colours (grey/brass/blue) and the pink own dot. Mirrors --mk-mate/--mk-peer.
const PEOPLE = {
  mate: { color: '#0b2a1a', fillColor: '#1f9d55' },
  peer: { color: '#26103a', fillColor: '#8a4fd0' },
};
const PERSON_FRESH_MS = 2 * 60 * 1000;
const LABEL_ZOOM = 16;

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
    raise();
  }

  // Order from the bottom: stones, other phones, own dot.
  function raise() {
    for (const p of people.values()) p.marker.bringToFront();
    if (userHalo && map.hasLayer(userHalo)) userHalo.bringToFront();
    if (userDot && map.hasLayer(userDot)) userDot.bringToFront();
  }

  const people = new Map(); // deviceId -> { marker, name }

  function labelPerson(p) {
    p.marker.unbindTooltip();
    p.marker.bindTooltip(p.name, {
      permanent: map.getZoom() >= LABEL_ZOOM, direction: 'top', offset: [0, -7], className: 'person-label',
    });
  }
  map.on('zoomend', () => { for (const p of people.values()) labelPerson(p); });

  /** list: [{deviceId, groupId, groupName, lat, lon, updatedAt}]; now: server time in ms. */
  function setPeople(list, ownGroupId, now) {
    const seen = new Set();
    for (const person of list) {
      seen.add(person.deviceId);
      const base = person.groupId === ownGroupId ? PEOPLE.mate : PEOPLE.peer;
      const faded = now - person.updatedAt > PERSON_FRESH_MS;
      const style = { ...base, weight: 2.5, opacity: faded ? 0.45 : 1, fillOpacity: faded ? 0.4 : 1 };
      let p = people.get(person.deviceId);
      if (!p) {
        // Not interactive: members stand at the stones, and taps must reach the stone below.
        const marker = L.circleMarker([person.lat, person.lon], { radius: 7, renderer, interactive: false, ...style })
          .addTo(map);
        p = { marker, name: null };
        people.set(person.deviceId, p);
      } else {
        p.marker.setLatLng([person.lat, person.lon]).setStyle(style);
      }
      if (p.name !== person.groupName) {
        p.name = person.groupName;
        labelPerson(p);
      }
    }
    for (const [id, p] of people) {
      if (!seen.has(id)) {
        p.marker.remove();
        people.delete(id);
      }
    }
    raise();
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

  let userStale = false;

  const LIVE_DOT = { color: '#ffffff', weight: 3, fillColor: '#CC79A7', fillOpacity: 1 };
  // Stale: hollow, grey, dashed, no accuracy halo.
  const STALE_DOT = { color: '#6b6b6b', weight: 3, dashArray: '3 4', fillColor: '#ffffff', fillOpacity: 0.35 };

  function setUserPosition(lat, lon, accuracy) {
    if (!userDot) {
      userHalo = L.circle([lat, lon], {
        radius: accuracy, color: '#CC79A7', weight: 1, opacity: 0.6, fillColor: '#CC79A7', fillOpacity: 0.12, interactive: false,
      });
      userDot = L.circleMarker([lat, lon], { radius: 9, interactive: false, ...LIVE_DOT });
    } else {
      userDot.setLatLng([lat, lon]);
      userHalo.setLatLng([lat, lon]).setRadius(accuracy);
    }
    if (!userStale && !map.hasLayer(userHalo)) userHalo.addTo(map);
    if (!map.hasLayer(userDot)) userDot.addTo(map);
    raise();
  }

  function setUserStale(value) {
    if (userStale === value) return;
    userStale = value;
    if (!userDot) return;
    if (value) {
      userHalo.remove();
      userDot.setStyle({ ...STALE_DOT, dashArray: STALE_DOT.dashArray });
    } else {
      userHalo.addTo(map);
      userDot.setStyle({ ...LIVE_DOT, dashArray: null });
      userDot.bringToFront();
    }
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

  return { map, setLocations, setPeople, update, select, reveal, setUserPosition, setUserStale, fitTo };
}
