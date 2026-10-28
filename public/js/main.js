// App controller: loads data, keeps state in sync and renders the sheet and dialogs.
/* global qrcode */
import {
  ApiError, createGroup, deletePresence, getMe, getPresence, getState, locationAction, orgaDelete, orgaGroups, orgaInvite, orgaRename,
  orgaRotate, putPresence, saveNote,
} from './api.js';
import {
  clearGroup, clearOrganizerCode, inviteLink, loadDeviceId, loadGroup, loadOrganizerCode, loadShareLocation,
  readJoinFragment, removeFragment, saveGroup, saveOrganizerCode, saveShareLocation,
} from './group.js';
import { createMap } from './map.js';
import { initSheetDrag } from './sheet.js';
import { distanceMeters, formatDayTime, formatDistance, h, navigationUrl } from './dom.js';

const POLL_MS = 15000;
const NEXT_COUNT = 10;
const NOTE_MAX = 500;
const SHARE_MS = 20000;         // at most one position upload per phone in this time
const GROUP_GONE = 'Deine Gruppe ist nicht mehr gültig (gelöscht oder neuer Link erzeugt). Bitte den aktuellen QR-Code deiner Gruppe scannen.';

// ---------- state ----------

let locations = [];             // from locations.json
const byId = new Map();
let server = { groups: [], locations: {} };
let clockOffset = 0;            // server time minus device time
let group = loadGroup();        // { groupId, groupName, token } or null
let organizerCode = loadOrganizerCode(); // set while organizer mode is on
let position = null;            // { lat, lon, accuracy }
let watchId = null;
let busy = false;
let view = { mode: 'home' };    // or { mode: 'detail', id }
let collapsed = false;
let connectionLost = false;
const deviceId = loadDeviceId();
let shareLocation = loadShareLocation(); // true, false, or null = not asked yet
let people = [];                // other phones, from GET /api/presence

const $ = (id) => document.getElementById(id);
const sheet = $('sheet');
const serverNow = () => Date.now() + clockOffset;

// ---------- toast ----------

let toastTimer = null;
function toast(message, { error = false } = {}) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('toast-error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3500);
}
$('toast').addEventListener('click', () => { $('toast').hidden = true; });

// ---------- status helpers ----------

function stateOf(id) {
  const s = server.locations[id];
  if (!s) return { status: 'open' };
  if (s.status === 'on_the_way' && s.expiresAt && s.expiresAt <= serverNow()) {
    return { ...s, status: 'open' };
  }
  return s;
}

function groupName(s) {
  return s.groupName ?? server.groups.find((g) => g.id === s.groupId)?.name ?? 'Eine Gruppe';
}

function kindOf(id) {
  const s = stateOf(id);
  if (s.status === 'cleaned') return 'cleaned';
  if (s.status === 'on_the_way') return group && s.groupId === group.groupId ? 'own' : 'other';
  return 'open';
}

const hasNote = (id) => Boolean(server.locations[id]?.note);

function ownReservation() {
  if (!group) return null;
  for (const [id, s] of Object.entries(server.locations)) {
    if (s.groupId === group.groupId && stateOf(id).status === 'on_the_way' && byId.has(id)) {
      return { id, state: s };
    }
  }
  return null;
}

function stonesSummary(loc) {
  const names = loc.stones.map((s) => s.name);
  if (names.length === 1) return names[0];
  return `${names.length} Steine · ${names.join(', ')}`;
}

// ---------- map ----------

const mapApi = createMap($('map'), { onSelect: (id) => openDetail(id) });

function renderMap() {
  mapApi.select(view.mode === 'detail' ? view.id : null);
  mapApi.update(kindOf, hasNote);
  renderPeople();
}

let moveTimer = null;
mapApi.map.on('moveend', () => {
  if (view.mode !== 'home' || position) return;
  clearTimeout(moveTimer);
  moveTimer = setTimeout(renderSheet, 250);
});

// Keep Leaflet's size in step with the sheet, which changes the map's height.
new ResizeObserver(() => mapApi.map.invalidateSize({ pan: false })).observe($('map'));
// The toast sits above the sheet; CSS reads the sheet height from --sheet-h.
new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`)).observe(sheet);

// ---------- geolocation ----------

const STALE_MS = 60000;         // no fix for this long: ask for a fresh one
const DENIED_HINT = 'Standort nicht erlaubt. Du kannst ihn in den Browser-Einstellungen freigeben.';
let centerOnNextFix = false;
let wantLocation = false;       // the user asked for location; restart when permission returns
let lastFixAt = 0;
let stale = false;
let staleTimer = null;
let searchToastShown = false;

function updateLocateButton() {
  const btn = $('locate-button');
  btn.classList.toggle('is-active', watchId !== null);
  btn.classList.toggle('is-searching', watchId !== null && (!position || stale));
}

function setStale(value) {
  if (stale === value) return;
  stale = value;
  mapApi.setUserStale(value);
  updateLocateButton();
  syncSharing();
  if (view.mode === 'home') renderSheet();
}

function stopLocating() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(staleTimer);
  staleTimer = null;
  updateLocateButton();
}

function onDenied() {
  stopLocating();
  if (position) setStale(true);
  toast(DENIED_HINT, { error: true });
}

/** Asks for one fresh fix: the watch may be silent after location was switched off. */
let rechecking = false;
function recheckPosition() {
  if (rechecking) return;
  rechecking = true;
  navigator.geolocation.getCurrentPosition((p) => {
    rechecking = false;
    onPosition(p);
  }, (err) => {
    rechecking = false;
    if (err.code === err.PERMISSION_DENIED) onDenied();
    else if (position) setStale(true);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}

function startLocating({ center }) {
  if (!('geolocation' in navigator)) {
    toast('Dein Gerät kann den Standort nicht bestimmen.', { error: true });
    return;
  }
  wantLocation = true;
  if (center && position) mapApi.map.setView([position.lat, position.lon], Math.max(mapApi.map.getZoom(), 17));
  centerOnNextFix = center && (!position || stale);
  if (watchId !== null) {
    if (stale) recheckPosition();
    return;
  }
  // Without Google location services (e.g. GrapheneOS) the first GPS fix can
  // take a minute or more, so the watch has no timeout and only a denied
  // permission stops it. A quick coarse request runs alongside for an early fix.
  navigator.geolocation.getCurrentPosition((p) => { if (!position) onPosition(p); }, () => {},
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onDenied();
        return;
      }
      if (position) {
        setStale(true);
        return;
      }
      if (!searchToastShown) {
        searchToastShown = true;
        toast('Standort wird gesucht …');
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
  // A phone standing still may send no updates, so a silent watch only asks
  // for a fresh fix; the position turns stale only if that fails.
  staleTimer = setInterval(() => {
    if (position && !stale && Date.now() - lastFixAt > STALE_MS) recheckPosition();
  }, 5000);
  if (!position && !searchToastShown) {
    searchToastShown = true;
    toast('Standort wird gesucht …');
  }
  updateLocateButton();
}

function onPosition(p) {
  const prev = position;
  const wasStale = stale;
  lastFixAt = Date.now();
  position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
  searchToastShown = false;
  stale = false;
  mapApi.setUserStale(false);
  mapApi.setUserPosition(position.lat, position.lon, position.accuracy);
  updateLocateButton();
  syncSharing();
  if (centerOnNextFix) {
    centerOnNextFix = false;
    mapApi.map.setView([position.lat, position.lon], Math.max(mapApi.map.getZoom(), 17));
  }
  if (!prev || wasStale || distanceMeters(prev, position) > 15) {
    if (view.mode === 'home' || shareAskWanted()) renderSheet();
  }
}
$('locate-button').addEventListener('click', () => startLocating({ center: true }));

// Location can be switched off in the system settings without the page noticing.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && watchId !== null) recheckPosition();
});
if (navigator.permissions?.query) {
  navigator.permissions.query({ name: 'geolocation' }).then((status) => {
    status.addEventListener('change', () => {
      if (status.state === 'denied') {
        if (watchId !== null || position) onDenied();
      } else if (status.state === 'granted' && wantLocation && watchId === null) {
        startLocating({ center: false });
      }
    });
  }).catch(() => {});
}

// ---------- sharing positions ----------
// Opt-in: while on, the phone is in a group and its position is fresh, the latest
// position goes to the server. It stops (and the server row is deleted) otherwise.

let sharing = false;            // the server may hold a row for this phone
let sharedToken = null;         // token that wrote it, kept so a delete still works after leaving
let lastSentAt = 0;

function syncSharing() {
  const want = shareLocation === true && group && position && !stale;
  if (want) {
    if (!sharing || Date.now() - lastSentAt >= SHARE_MS) sendPosition();
  } else if (sharing) {
    sharing = false;
    deletePresence(sharedToken, deviceId).catch(() => {}); // best effort; the server expires it anyway
  }
}

function sendPosition() {
  sharing = true;
  sharedToken = group.token;
  lastSentAt = Date.now();
  putPresence(group.token, { deviceId, lat: position.lat, lon: position.lon, accuracy: position.accuracy })
    .catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        sharing = false;
        dropGroup(GROUP_GONE);
        renderAll();
      }
    });
}
setInterval(syncSharing, 5000);

window.addEventListener('pagehide', () => {
  if (!sharing) return;
  sharing = false;
  try {
    fetch(`/api/presence/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${sharedToken}` }, keepalive: true,
    }).catch(() => {});
  } catch {
    /* best effort */
  }
});

function renderPeople() {
  const visible = group || organizerCode ? people.filter((p) => p.deviceId !== deviceId) : [];
  mapApi.setPeople(visible, group?.groupId ?? null, serverNow());
}

// ---------- legend ----------

$('legend-toggle').addEventListener('click', () => {
  const body = $('legend-body');
  body.hidden = !body.hidden;
  $('legend-toggle').setAttribute('aria-expanded', String(!body.hidden));
});

// ---------- sync ----------

let refreshSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  const presence = loadPeople();
  try {
    const data = await getState();
    if (seq !== refreshSeq) return;
    server = { groups: data.groups ?? [], locations: data.locations ?? {} };
    if (typeof data.now === 'number') clockOffset = data.now - Date.now();
    if (connectionLost) {
      connectionLost = false;
      toast('Wieder verbunden.');
    }
    if (group) {
      const g = server.groups.find((x) => x.id === group.groupId);
      if (g && g.name !== group.groupName) {
        group = { ...group, groupName: g.name };
        saveGroup(group);
        renderGroupButton();
      }
    }
  } catch {
    if (seq !== refreshSeq) return;
    if (!connectionLost) {
      connectionLost = true;
      toast('Keine Verbindung. Du siehst den letzten bekannten Stand.', { error: true });
    }
  }
  await presence;
  renderAll();
  // A group missing from the list was deleted (or its link replaced): let the token decide.
  if (group && !server.groups.some((x) => x.id === group.groupId)) await checkStoredGroup();
}

/** Other phones: only for members and the organizer; anyone else makes no request. */
async function loadPeople() {
  if (!group && !organizerCode) {
    people = [];
    return;
  }
  const token = group?.token;
  try {
    const data = await getPresence(token ? { token } : { organizerCode });
    people = Array.isArray(data.people) ? data.people : [];
  } catch (err) {
    // 401 with a group token: the regular check below decides if the group is gone.
    if (!(err instanceof ApiError && err.status === 401 && token)) return;
    people = [];
  }
}

setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

function applyLocation(id, loc) {
  if (!loc) return;
  if (loc.status === 'open' && !loc.note) delete server.locations[id];
  else server.locations[id] = loc;
}

// ---------- errors ----------

function dropGroup(message) {
  group = null;
  clearGroup();
  syncSharing();
  renderGroupButton();
  toast(message, { error: true });
}

function handleError(err) {
  if (!(err instanceof ApiError)) {
    console.error(err);
    toast('Etwas ist schiefgegangen. Bitte nochmal versuchen.', { error: true });
    return;
  }
  const { status, data } = err;
  if (status === 0) toast('Keine Verbindung. Bitte gleich nochmal versuchen.', { error: true });
  else if (status === 401) dropGroup(GROUP_GONE);
  else if (data.error === 'taken') toast(`${data.groupName ?? 'Eine andere Gruppe'} ist schon unterwegs dorthin.`, { error: true });
  else if (data.error === 'cleaned') toast('Schon geputzt.', { error: true });
  else if (data.error === 'name_taken') toast('Diesen Gruppennamen gibt es schon.', { error: true });
  else if (status === 403) toast('Das darf nur die Gruppe, die dorthin unterwegs ist.', { error: true });
  else if (status === 404) toast('Diesen Ort kennt der Server nicht.', { error: true });
  else if (status === 400) toast('Die Eingabe passt nicht. Bitte prüfen.', { error: true });
  else toast(`Fehler beim Server (${status}). Bitte nochmal versuchen.`, { error: true });
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('is-busy', value);
  for (const b of document.querySelectorAll('[data-action]')) b.disabled = value;
}

async function run(task) {
  if (busy) return;
  setBusy(true);
  try {
    await task();
  } catch (err) {
    handleError(err);
  } finally {
    setBusy(false);
  }
}

const SUCCESS = {
  reserve: 'Eingetragen: Ihr seid unterwegs.',
  release: 'Reservierung aufgehoben.',
  clean: 'Als geputzt eingetragen. Danke!',
  reopen: 'Wieder als offen eingetragen.',
};

function act(id, action) {
  if (!group) return;
  if (action === 'reserve') {
    const own = ownReservation();
    if (own && own.id !== id
      && !confirm(`Ihr seid schon unterwegs zu ${byId.get(own.id).address}. Stattdessen hierhin gehen?`)) return;
  }
  if (action === 'reopen' && !confirm('Diesen Ort wieder als offen eintragen?')) return;
  return run(async () => {
    try {
      const data = await locationAction(group.token, id, action);
      applyLocation(id, data.location);
      toast(SUCCESS[action]);
    } finally {
      await refresh();
    }
  });
}

// ---------- sheet ----------

function actionButton(label, onClick, cls = '') {
  return h('button', { type: 'button', class: `btn ${cls}`, 'data-action': '', disabled: busy, onclick: onClick }, label);
}

function navButton(loc, cls = '') {
  return h('a', {
    class: `btn ${cls}`, href: navigationUrl(loc.lat, loc.lon), target: '_blank', rel: 'noopener',
  }, 'Navigation');
}

function sheetHead(title, { onClose } = {}) {
  return h('div', { class: 'sheet-head' },
    h('button', {
      type: 'button', class: 'sheet-toggle', 'aria-expanded': String(!collapsed),
      'aria-label': `Liste ein-/ausklappen: ${title}`,
      onclick: () => { collapsed = !collapsed; renderSheet(); },
    }, h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }), h('span', { class: 'sheet-title' }, title)),
    onClose && h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Schließen', onclick: onClose }, '✕'),
  );
}

function setCollapsed(value) {
  collapsed = value;
  renderSheet();
}
initSheetDrag(sheet, { isCollapsed: () => collapsed, setCollapsed });

function renderSheet() {
  sheet.classList.toggle('is-collapsed', collapsed);
  if (view.mode === 'detail' && byId.has(view.id)) renderDetail(byId.get(view.id));
  else renderHome();
  if (shareAskWanted()) sheet.querySelector('.sheet-head')?.after(shareAsk());
}

// Asked once, when this phone is in a group and has a position and nothing was chosen yet.
function shareAskWanted() {
  return Boolean(group && position && shareLocation === null);
}

function setShareLocation(on) {
  shareLocation = on;
  saveShareLocation(on);
  if (on && watchId === null) startLocating({ center: false });
  syncSharing();
}

function shareAsk() {
  const choose = (on) => { setShareLocation(on); renderSheet(); };
  return h('div', { class: 'share-ask', role: 'group', 'aria-label': 'Standort teilen' },
    h('p', { class: 'share-ask-title' }, 'Standort mit den Gruppen teilen?'),
    h('p', { class: 'muted share-ask-text' }, 'Andere Gruppen sehen, wo ihr seid – nur solange die App offen ist.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => choose(true) }, 'Teilen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => choose(false) }, 'Nicht teilen')));
}

function renderHome() {
  const own = ownReservation();
  if (own) {
    const loc = byId.get(own.id);
    sheet.replaceChildren(
      sheetHead('Ihr seid unterwegs'),
      h('div', { class: 'sheet-body' },
        h('div', { class: 'reservation' },
          h('p', { class: 'reservation-text' }, 'Zu ',
            h('button', { type: 'button', class: 'linklike', onclick: () => openDetail(loc.id) }, loc.address)),
          h('p', { class: 'muted' }, stonesSummary(loc)),
          h('div', { class: 'actions' },
            actionButton('Geputzt', () => act(loc.id, 'clean'), 'btn-clean'),
            actionButton('Abbrechen', () => act(loc.id, 'release')),
            navButton(loc),
          ),
        ),
      ),
    );
    return;
  }

  const origin = position ?? (() => {
    try {
      const c = mapApi.map.getCenter();
      return { lat: c.lat, lon: c.lng };
    } catch {
      return { lat: 48.8045, lon: 9.2160 }; // map not placed yet: Bad Cannstatt
    }
  })();
  const next = locations
    .filter((l) => stateOf(l.id).status === 'open')
    .map((l) => ({ loc: l, d: distanceMeters(origin, l) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, NEXT_COUNT);

  sheet.replaceChildren(
    sheetHead('Nächste offene Steine'),
    h('div', { class: 'sheet-body' },
      !group && h('p', { class: 'hint' }, 'Zum Mitmachen den QR-Code deiner Gruppe scannen.'),
      h('div', { class: 'list-origin' },
        h('span', { class: 'muted' }, !position ? 'Nach Entfernung zur Kartenmitte' : stale ? 'Nach Entfernung zum letzten bekannten Standort' : 'Nach Entfernung zu dir'),
        (!position || stale) && h('button', { type: 'button', class: 'btn btn-small', onclick: () => startLocating({ center: false }) }, 'Meinen Standort nutzen'),
      ),
      next.length
        ? h('ol', { class: 'next-list' }, next.map(({ loc, d }) => h('li', {},
          h('button', { type: 'button', class: 'next-item', onclick: () => openDetail(loc.id) },
            h('span', { class: 'next-main' },
              h('span', { class: 'next-address' }, loc.address),
              h('span', { class: 'next-names' }, stonesSummary(loc))),
            h('span', { class: 'next-distance' }, formatDistance(d))))))
        : h('p', { class: 'muted' }, 'Keine offenen Steine mehr. Danke für eure Arbeit.'),
    ),
  );
}

function statusLine(s) {
  if (s.status === 'on_the_way') {
    const own = group && s.groupId === group.groupId;
    const who = own ? 'Ihr seid unterwegs' : `${groupName(s)} ist unterwegs`;
    return { cls: own ? 'status-own' : 'status-other', text: who };
  }
  if (s.status === 'cleaned') {
    return { cls: 'status-cleaned', text: `Geputzt von ${groupName(s)} am ${formatDayTime(s.updatedAt)}` };
  }
  return { cls: 'status-open', text: 'Offen' };
}

let noteEditing = null; // location id whose note editor is open

function renderDetail(loc) {
  const s = stateOf(loc.id);
  const status = statusLine(s);
  const own = s.status === 'on_the_way' && group && s.groupId === group.groupId;

  let actions = [];
  if (group) {
    if (s.status === 'open') {
      actions = [actionButton('Wir gehen hin', () => act(loc.id, 'reserve'), 'btn-way'),
        actionButton('Geputzt', () => act(loc.id, 'clean'))];
    } else if (s.status === 'on_the_way') {
      actions = own
        ? [actionButton('Geputzt', () => act(loc.id, 'clean'), 'btn-clean'), actionButton('Abbrechen', () => act(loc.id, 'release'))]
        : [actionButton('Geputzt', () => act(loc.id, 'clean'))];
    } else if (s.status === 'cleaned') {
      actions = [actionButton('Rückgängig', () => act(loc.id, 'reopen'))];
    }
  }

  // Keep an open note editor (and what was typed) across background refreshes.
  const existingEditor = noteEditing === loc.id ? sheet.querySelector('.note-editor') : null;
  if (existingEditor?.contains(document.activeElement)) {
    // Rebuilding would move the focused textarea and close the phone keyboard.
    const el = sheet.querySelector('.status');
    if (el) { el.className = `status ${status.cls}`; el.textContent = status.text; }
    return;
  }
  const note = server.locations[loc.id]?.note ?? '';

  sheet.replaceChildren(
    sheetHead(loc.address, { onClose: closeDetail }),
    h('div', { class: 'sheet-body' },
      h('p', { class: `status ${status.cls}` }, status.text),
      h('div', { class: 'actions' }, actions, navButton(loc, actions.length ? '' : 'btn-primary')),
      !group && h('p', { class: 'hint' }, 'Zum Mitmachen den QR-Code deiner Gruppe scannen.'),
      h('ul', { class: 'stones' }, loc.stones.map((st) => h('li', {},
        st.bioUrl
          ? h('a', { href: st.bioUrl, target: '_blank', rel: 'noopener' }, st.name)
          : h('span', {}, st.name),
        st.links?.length ? h('span', { class: 'extra-links' }, st.links.map((l) =>
          h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))) : null,
      ))),
      h('div', { class: 'note' },
        note ? h('p', { class: 'note-text' }, h('strong', {}, 'Notiz: '), note) : null,
        existingEditor ?? (group
          ? h('button', {
            type: 'button', class: 'btn btn-small',
            onclick: () => { noteEditing = loc.id; renderSheet(); sheet.querySelector('textarea')?.focus(); },
          }, note ? 'Notiz bearbeiten' : 'Notiz hinzufügen')
          : null),
      ),
    ),
  );
  if (!existingEditor && noteEditing === loc.id && group) {
    sheet.querySelector('.note').lastElementChild?.replaceWith(noteEditor(loc.id, note));
  }
}

function noteEditor(id, note) {
  const textarea = h('textarea', { maxlength: String(NOTE_MAX), rows: '3', 'aria-label': 'Notiz' });
  textarea.value = note;
  const counter = h('span', { class: 'muted' }, `${note.length}/${NOTE_MAX}`);
  textarea.addEventListener('input', () => { counter.textContent = `${textarea.value.length}/${NOTE_MAX}`; });
  const save = () => run(async () => {
    try {
      const data = await saveNote(group.token, id, textarea.value.trim().slice(0, NOTE_MAX));
      applyLocation(id, data.location);
      noteEditing = null;
      toast('Notiz gespeichert.');
    } finally {
      await refresh();
    }
  });
  return h('form', { class: 'note-editor', onsubmit: (e) => { e.preventDefault(); save(); } },
    textarea,
    h('div', { class: 'note-editor-row' },
      counter,
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { noteEditing = null; renderSheet(); } }, 'Verwerfen'),
      h('button', { type: 'submit', class: 'btn btn-small btn-primary', 'data-action': '', disabled: busy }, 'Speichern')));
}

function openDetail(id) {
  if (!byId.has(id)) return;
  if (view.mode !== 'detail' || view.id !== id) noteEditing = null;
  view = { mode: 'detail', id };
  collapsed = false;
  renderAll();
  sheet.scrollTop = 0;
  requestAnimationFrame(() => mapApi.reveal(id));
}

function closeDetail() {
  view = { mode: 'home' };
  noteEditing = null;
  renderAll();
}

function renderAll() {
  renderMap();
  renderSheet();
}

// ---------- group ----------

function renderGroupButton() {
  $('group-button-label').textContent = group ? group.groupName : 'Keiner Gruppe beigetreten';
  $('group-button').classList.toggle('has-group', Boolean(group));
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: 'QR-Code zum Beitreten' });
}

function inviteSection(target) {
  const link = inviteLink(target);
  const qr = h('div', { class: 'qr' });
  qr.innerHTML = qrSvg(link); // generated SVG from our own link, no user HTML
  const share = async () => {
    try {
      await navigator.share({ title: `Stolpersteine putzen: ${target.groupName}`, text: `Tritt der Gruppe ${target.groupName} bei:`, url: link });
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Teilen hat nicht geklappt. Nutze „Link kopieren“.', { error: true });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link kopiert.');
    } catch {
      linkField.select();
      toast('Bitte den Link markieren und kopieren.', { error: true });
    }
  };
  const linkField = h('input', { class: 'invite-link', readonly: true, value: link, 'aria-label': 'Einladungslink', onfocus: (e) => e.target.select() });
  return h('div', { class: 'invite' },
    h('p', {}, 'Andere scannen diesen Code mit der Handykamera und sind dann in eurer Gruppe.'),
    qr,
    h('div', { class: 'actions' },
      typeof navigator.share === 'function' && h('button', { type: 'button', class: 'btn btn-primary', onclick: share }, 'Link teilen'),
      h('button', { type: 'button', class: 'btn', onclick: copy }, 'Link kopieren')),
    linkField,
  );
}

function shareSwitch() {
  const input = h('input', {
    type: 'checkbox', role: 'switch', checked: shareLocation === true,
    onchange: (e) => {
      setShareLocation(e.target.checked);
      renderSheet(); // a pending question is settled
    },
  });
  return h('div', {},
    h('label', { class: 'share-row' }, input, 'Meinen Standort teilen'),
    h('p', { class: 'muted share-note' },
      'Deine Position ist nur für Mitglieder von Gruppen und die Orga sichtbar, solange die App geöffnet ist. '
      + 'Es wird nur die letzte Position gespeichert, höchstens 10 Minuten lang, ohne Verlauf.'));
}

function renderGroupDialog() {
  const body = $('group-dialog-body');
  if (group) {
    $('group-dialog-title').textContent = group.groupName;
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Du bist in dieser Gruppe.'),
      inviteSection(group),
      shareSwitch(),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: () => {
            if (!confirm(`Gruppe „${group.groupName}“ auf diesem Handy verlassen? Du kannst nur über den QR-Code bzw. Einladungslink wieder beitreten.`)) return;
            group = null;
            clearGroup();
            syncSharing();
            people = [];
            renderGroupButton();
            renderGroupDialog();
            renderAll();
            toast('Du hast die Gruppe verlassen.');
          },
        }, 'Gruppe verlassen')),
      orgaEntry(),
    );
  } else {
    $('group-dialog-title').textContent = 'Keiner Gruppe beigetreten';
    body.replaceChildren(
      h('p', { class: 'hint' }, 'Zum Mitmachen den QR-Code deiner Gruppe scannen.'),
      h('p', { class: 'muted' }, 'Ohne Gruppe kannst du die Karte nur ansehen. Den Code hat jemand aus deiner Gruppe oder die Orga.'),
      orgaEntry(),
    );
  }
  renderAll();
}

// ---------- organizer ----------

function orgaEntry() {
  return h('div', { class: 'create' },
    h('button', { type: 'button', class: 'btn', onclick: () => (organizerCode ? showOrga() : renderOrgaLogin()) }, 'Organisation'));
}

/** Runs an organizer request; a 401 means the code is gone, so forget it and ask again. */
function orgaTask(task) {
  return run(async () => {
    try {
      await task();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      organizerCode = null;
      clearOrganizerCode();
      toast('Der Orga-Code stimmt nicht (mehr). Bitte neu eingeben.', { error: true });
      renderOrgaLogin();
    }
  });
}

function orgaBack() {
  return h('button', { type: 'button', class: 'btn btn-small', onclick: renderGroupDialog }, '‹ Zurück');
}

function renderOrgaLogin() {
  $('group-dialog-title').textContent = 'Organisation';
  const code = h('input', { type: 'password', autocomplete: 'off', required: true, id: 'org-code' });
  const submit = (e) => {
    e.preventDefault();
    const value = code.value.trim();
    if (!value) return;
    orgaTask(async () => {
      const data = await orgaGroups(value);
      organizerCode = value;
      saveOrganizerCode(value);
      toast('Orga-Modus ist an.');
      renderOrga(data.groups);
      refresh();
    });
  };
  $('group-dialog-body').replaceChildren(
    h('p', { class: 'muted' }, 'Mit dem Orga-Code legst du Gruppen an und verwaltest ihre Einladungen.'),
    h('form', { class: 'form', onsubmit: submit },
      h('label', { for: 'org-code' }, 'Orga-Code'), code,
      h('button', { type: 'submit', class: 'btn btn-primary', 'data-action': '' }, 'Weiter')),
    h('div', { class: 'actions' }, orgaBack()),
  );
}

function showOrga() {
  return orgaTask(async () => {
    const data = await orgaGroups(organizerCode);
    renderOrga(data.groups);
    refresh();
  });
}

function progressLine(done, total, label) {
  return h('div', { class: 'progress' },
    h('p', { class: 'progress-text' }, h('strong', {}, `${done} von ${total}`), ` ${label} geputzt`),
    h('div', { class: 'progress-bar', 'aria-hidden': 'true' },
      h('div', { class: 'progress-fill', style: `width: ${total ? Math.round((done / total) * 100) : 0}%` })));
}

function renderOrga(groups) {
  $('group-dialog-title').textContent = 'Organisation';
  const cleaned = (list) => list.filter((l) => stateOf(l.id).status === 'cleaned').length;
  const cannstatt = locations.filter((l) => l.district === 'cannstatt');

  const nameInput = h('input', { type: 'text', maxlength: '40', required: true, id: 'group-name', placeholder: 'z. B. Gruppe A' });
  const create = (e) => {
    e.preventDefault();
    const n = nameInput.value.trim();
    if (!n) return;
    orgaTask(async () => {
      const g = await createGroup(organizerCode, n);
      toast(`Gruppe „${g.name}“ angelegt.`);
      showInvite({ groupId: g.id, groupName: g.name, token: g.token });
    });
  };

  $('group-dialog-body').replaceChildren(
    progressLine(cleaned(cannstatt), cannstatt.length, 'Cannstatter Adressen'),
    progressLine(cleaned(locations), locations.length, 'Adressen insgesamt'),
    groups.length
      ? h('ul', { class: 'orga-groups' }, groups.map((g) => orgaGroupItem(g)))
      : h('p', { class: 'muted' }, 'Noch keine Gruppen.'),
    h('details', { class: 'create' },
      h('summary', {}, 'Neue Gruppe anlegen'),
      h('form', { class: 'form', onsubmit: create },
        h('label', { for: 'group-name' }, 'Name der Gruppe'), nameInput,
        h('button', { type: 'submit', class: 'btn btn-primary', 'data-action': '' }, 'Gruppe anlegen'))),
    h('div', { class: 'actions' },
      orgaBack(),
      h('button', {
        type: 'button', class: 'btn btn-small',
        onclick: () => {
          organizerCode = null;
          clearOrganizerCode();
          renderGroupDialog();
          toast('Orga-Modus beendet.');
        },
      }, 'Orga-Modus beenden')),
  );
}

function orgaGroupItem(g) {
  const target = g.reservation && byId.get(g.reservation.locationId);
  const btn = (label, onClick, cls = '') =>
    h('button', { type: 'button', class: `btn btn-small ${cls}`, 'data-action': '', disabled: busy, onclick: onClick }, label);
  return h('li', { class: 'orga-group' },
    h('div', { class: 'orga-group-head' },
      h('strong', { class: 'orga-group-name' }, g.name),
      h('span', { class: 'muted' }, `${g.cleanedCount} geputzt`)),
    target && h('p', { class: 'muted orga-group-way' }, `unterwegs zu ${target.address}`),
    h('div', { class: 'actions' },
      btn('Einladen', () => orgaTask(async () => {
        const inv = await orgaInvite(organizerCode, g.id);
        showInvite({ groupId: inv.id, groupName: inv.name, token: inv.token });
      })),
      btn('Beitreten', () => orgaTask(async () => {
        const inv = await orgaInvite(organizerCode, g.id);
        group = { groupId: inv.id, groupName: inv.name, token: inv.token };
        saveGroup(group);
        renderGroupButton();
        toast(`Du bist jetzt in der Gruppe „${inv.name}“.`);
        refresh();
        await reloadOrga();
      })),
      btn('Umbenennen', () => {
        const name = prompt('Neuer Name der Gruppe', g.name)?.trim();
        if (!name || name === g.name) return;
        return orgaTask(async () => {
          const res = await orgaRename(organizerCode, g.id, name);
          if (group?.groupId === g.id) {
            group = { ...group, groupName: res.name };
            saveGroup(group);
            renderGroupButton();
          }
          toast('Gruppe umbenannt.');
          refresh();
          await reloadOrga();
        });
      }),
      btn('Neuen Link erzeugen', () => {
        if (!confirm(`Neuen Link für „${g.name}“ erzeugen? Alte QR-Codes funktionieren dann nicht mehr.`)) return;
        return orgaTask(async () => {
          const inv = await orgaRotate(organizerCode, g.id);
          // Keep this phone in the group if it was in it.
          if (group?.groupId === g.id) {
            group = { ...group, token: inv.token };
            saveGroup(group);
          }
          toast('Neuer Link erzeugt.');
          showInvite({ groupId: inv.id, groupName: inv.name, token: inv.token });
        });
      }),
      btn('Löschen', () => {
        const way = g.reservation ? ' Eine laufende Reservierung wird freigegeben.' : '';
        if (!confirm(`Gruppe „${g.name}“ löschen? Geputzte Steine bleiben markiert.${way}`)) return;
        return orgaTask(async () => {
          await orgaDelete(organizerCode, g.id);
          if (group?.groupId === g.id) {
            group = null;
            clearGroup();
            renderGroupButton();
          }
          toast(`Gruppe „${g.name}“ gelöscht.`);
          refresh();
          await reloadOrga();
        });
      }, 'btn-danger'),
    ),
  );
}

async function reloadOrga() {
  const data = await orgaGroups(organizerCode);
  renderOrga(data.groups);
}

function showInvite(target) {
  $('group-dialog-title').textContent = target.groupName;
  $('group-dialog-body').replaceChildren(
    inviteSection(target),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-small', onclick: showOrga }, '‹ Zurück zur Organisation')),
  );
}

const dialog = $('group-dialog');
$('group-button').addEventListener('click', () => {
  renderGroupDialog();
  dialog.showModal();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});

async function handleJoin() {
  const join = readJoinFragment(location.hash);
  if (!join) return;
  try {
    const me = await getMe(join.token);
    if (me.id !== join.groupId) throw new ApiError(401, { error: 'unauthorized' });
    group = { groupId: me.id, groupName: me.name, token: join.token };
    saveGroup(group);
    removeFragment();
    renderGroupButton();
    toast(`Du bist jetzt in der Gruppe „${me.name}“.`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      // Keep the fragment so a reload can try again.
      toast('Beitreten hat nicht geklappt: keine Verbindung. Lade die Seite gleich neu.', { error: true });
    } else {
      removeFragment();
      toast('Dieser Einladungslink ist nicht gültig. Bitte den QR-Code deiner Gruppe neu scannen.', { error: true });
    }
  }
}

async function checkStoredGroup() {
  if (!group || readJoinFragment(location.hash)) return;
  try {
    const me = await getMe(group.token);
    if (me.name !== group.groupName) {
      group = { ...group, groupName: me.name };
      saveGroup(group);
      renderGroupButton();
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      dropGroup(GROUP_GONE);
      renderAll();
    }
  }
}

// ---------- start ----------

async function loadLocations() {
  const res = await fetch('data/locations.json');
  if (!res.ok) throw new Error(`locations.json: ${res.status}`);
  const data = await res.json();
  return data.locations;
}

async function start() {
  renderGroupButton();
  try {
    locations = await loadLocations();
  } catch (err) {
    console.error(err);
    toast('Die Liste der Stolpersteine konnte nicht geladen werden. Bitte Seite neu laden.', { error: true });
    mapApi.fitTo([]);
    return;
  }
  for (const l of locations) byId.set(l.id, l);
  renderSheet(); // first, so the map has its final height before fitting
  mapApi.map.invalidateSize({ pan: false });
  mapApi.fitTo(locations.filter((l) => l.district === 'cannstatt'));
  mapApi.setLocations(locations);
  renderAll(); // the next-list depends on the map centre
  await Promise.all([handleJoin(), checkStoredGroup(), refresh()]);
  renderAll();
}

window.addEventListener('hashchange', () => {
  if (readJoinFragment(location.hash)) handleJoin().then(renderAll);
});

start();
