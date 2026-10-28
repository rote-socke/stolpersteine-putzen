// App controller: loads data, keeps state in sync and renders the sheet and dialogs.
/* global qrcode */
import {
  ApiError, createGroup, deletePresence, getMe, getPresence, getState, locationAction, nameGroup, orgaDelete, orgaGroups, orgaInvite,
  orgaRename, orgaRotate, putPresence, saveNote,
} from './api.js';
import {
  clearGroup, clearOrganizerCode, inviteLink, loadDeviceId, loadGroup, loadOrganizerCode, loadShareLocation,
  readJoinFragment, removeFragment, saveGroup, saveOrganizerCode, saveShareLocation,
} from './group.js';
import { renderHelp } from './help.js';
import { createMap } from './map.js';
import { initSheetDrag } from './sheet.js';
import { getLang, onLangChange, setLang, t } from './i18n.js';
import { distanceMeters, formatDayTime, formatDistance, h, navigationUrl, setChildren } from './dom.js';

const POLL_MS = 15000;
const NEXT_COUNT = 10;
const NOTE_MAX = 500;
const SHARE_MS = 20000;         // at most one position upload per phone in this time
const searchToast = () => t('toast.searching');
const groupGone = () => t('toast.groupGone');

// ---------- state ----------

let locations = [];             // from locations.json
const byId = new Map();
let server = { groups: [], locations: {} };
let clockOffset = 0;            // server time minus device time
let group = loadGroup();        // { groupId, groupName, namePending, token } or null
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
const dialog = $('group-dialog');
const serverNow = () => Date.now() + clockOffset;

// ---------- toast ----------

let toastTimer = null;
let toastMessage = null;
function toast(message, { error = false } = {}) {
  const el = $('toast');
  toastMessage = message;
  el.textContent = message;
  el.classList.toggle('toast-error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3500);
}
/** Hides the toast, but only while it still shows this message. */
function hideToast(message) {
  if (toastMessage !== message) return;
  clearTimeout(toastTimer);
  $('toast').hidden = true;
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
  return s.groupName ?? server.groups.find((g) => g.id === s.groupId)?.name ?? t('group.fallbackName');
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
  return t('stones.summary', { count: names.length, names: names.join(', ') });
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
  toast(t('toast.denied'), { error: true });
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
    toast(t('toast.noGeolocation'), { error: true });
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
        toast(searchToast());
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
    toast(searchToast());
  }
  updateLocateButton();
}

function onPosition(p) {
  const prev = position;
  const wasStale = stale;
  lastFixAt = Date.now();
  position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
  searchToastShown = false;
  hideToast(searchToast());
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
        dropGroup(groupGone());
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
      toast(t('toast.reconnected'));
    }
    if (group) {
      const g = server.groups.find((x) => x.id === group.groupId);
      if (g) adoptGroupInfo(g.name, g.namePending === true);
    }
  } catch {
    if (seq !== refreshSeq) return;
    if (!connectionLost) {
      connectionLost = true;
      toast(t('toast.offline'), { error: true });
    }
  }
  await presence;
  renderAll();
  maybeAskName();
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
    toast(t('toast.wrong'), { error: true });
    return;
  }
  const { status, data } = err;
  if (status === 0) toast(t('toast.network'), { error: true });
  else if (status === 401) dropGroup(groupGone());
  else if (data.error === 'taken') toast(t('toast.taken', { name: data.groupName ?? t('group.otherName') }), { error: true });
  else if (data.error === 'cleaned') toast(t('toast.alreadyCleaned'), { error: true });
  else if (data.error === 'name_taken') toast(t('toast.nameTaken'), { error: true });
  else if (status === 403) toast(t('toast.forbidden'), { error: true });
  else if (status === 404) toast(t('toast.notFound'), { error: true });
  else if (status === 400) toast(t('toast.badInput'), { error: true });
  else toast(t('toast.serverError', { status }), { error: true });
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

function act(id, action) {
  if (!group) return;
  if (action === 'reserve') {
    const own = ownReservation();
    if (own && own.id !== id
      && !confirm(t('confirm.switch', { address: byId.get(own.id).address }))) return;
  }
  if (action === 'reopen' && !confirm(t('confirm.reopen'))) return;
  return run(async () => {
    try {
      const data = await locationAction(group.token, id, action);
      applyLocation(id, data.location);
      toast(t(`success.${action}`));
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
  }, t('btn.navigation'));
}

function helpIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  })) svg.setAttribute(k, v);
  for (const [tag, attrs] of [
    ['circle', { cx: '12', cy: '12', r: '9.5' }],
    ['path', { d: 'M9.2 9.3a2.9 2.9 0 1 1 4.4 2.5c-1 .6-1.6 1.2-1.6 2.4' }],
    ['path', { d: 'M12 17.2v.1' }],
  ]) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

const helpDialog = $('help-dialog');
function renderHelpDialog() {
  $('help-dialog-title').textContent = t('help.title');
  renderHelp($('help-dialog-body'));
}
function openHelp() {
  renderHelpDialog();
  helpDialog.showModal();
}
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog || e.target.closest('[data-close]')) helpDialog.close();
});

function sheetHead(title, { onClose } = {}) {
  return h('div', { class: 'sheet-head' },
    h('button', {
      type: 'button', class: 'sheet-toggle', 'aria-expanded': String(!collapsed),
      'aria-label': t('sheet.toggleAria', { title }),
      onclick: () => { collapsed = !collapsed; renderSheet(); },
    }, h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }), h('span', { class: 'sheet-title' }, title)),
    h('button', {
      type: 'button', class: 'icon-button help-button', 'aria-haspopup': 'dialog',
      'aria-label': t('help.button'), title: t('help.button'), onclick: openHelp,
    }, helpIcon()),
    onClose && h('button', { type: 'button', class: 'icon-button', 'aria-label': t('common.close'), onclick: onClose }, '✕'),
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
  return h('div', { class: 'share-ask', role: 'group', 'aria-label': t('share.askAria') },
    h('p', { class: 'share-ask-title' }, t('share.askTitle')),
    h('p', { class: 'muted share-ask-text' }, t('share.askText')),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => choose(true) }, t('btn.share')),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => choose(false) }, t('btn.dontShare'))));
}

function renderHome() {
  const own = ownReservation();
  if (own) {
    const loc = byId.get(own.id);
    setChildren(sheet, 
      sheetHead(t('home.onTheWay')),
      h('div', { class: 'sheet-body' },
        h('div', { class: 'reservation' },
          h('p', { class: 'reservation-text' }, t('home.to'),
            h('button', { type: 'button', class: 'linklike', onclick: () => openDetail(loc.id) }, loc.address)),
          h('p', { class: 'muted' }, stonesSummary(loc)),
          h('div', { class: 'actions' },
            actionButton(t('btn.cleaned'), () => act(loc.id, 'clean'), 'btn-clean'),
            actionButton(t('btn.cancel'), () => act(loc.id, 'release')),
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

  setChildren(sheet, 
    sheetHead(t('home.next')),
    h('div', { class: 'sheet-body' },
      !group && h('p', { class: 'hint' }, t('home.joinHint')),
      h('div', { class: 'list-origin' },
        h('span', { class: 'muted' }, !position ? t('home.originCenter') : stale ? t('home.originStale') : t('home.originYou')),
        (!position || stale) && h('button', { type: 'button', class: 'btn btn-small', onclick: () => startLocating({ center: false }) }, t('btn.useLocation')),
      ),
      next.length
        ? h('ol', { class: 'next-list' }, next.map(({ loc, d }) => h('li', {},
          h('button', { type: 'button', class: 'next-item', onclick: () => openDetail(loc.id) },
            h('span', { class: 'next-main' },
              h('span', { class: 'next-address' }, loc.address),
              h('span', { class: 'next-names' }, stonesSummary(loc))),
            h('span', { class: 'next-distance' }, formatDistance(d))))))
        : h('p', { class: 'muted' }, t('home.none')),
    ),
  );
}

function statusLine(s) {
  if (s.status === 'on_the_way') {
    const own = group && s.groupId === group.groupId;
    const who = own ? t('status.own') : t('status.other', { name: groupName(s) });
    return { cls: own ? 'status-own' : 'status-other', text: who };
  }
  if (s.status === 'cleaned') {
    return { cls: 'status-cleaned', text: t('status.cleaned', { name: groupName(s), when: formatDayTime(s.updatedAt) }) };
  }
  return { cls: 'status-open', text: t('status.open') };
}

let noteEditing = null; // location id whose note editor is open

function renderDetail(loc) {
  const s = stateOf(loc.id);
  const status = statusLine(s);
  const own = s.status === 'on_the_way' && group && s.groupId === group.groupId;

  let actions = [];
  if (group) {
    if (s.status === 'open') {
      actions = [actionButton(t('btn.going'), () => act(loc.id, 'reserve'), 'btn-way'),
        actionButton(t('btn.cleaned'), () => act(loc.id, 'clean'))];
    } else if (s.status === 'on_the_way') {
      actions = own
        ? [actionButton(t('btn.cleaned'), () => act(loc.id, 'clean'), 'btn-clean'), actionButton(t('btn.cancel'), () => act(loc.id, 'release'))]
        : [actionButton(t('btn.cleaned'), () => act(loc.id, 'clean'))];
    } else if (s.status === 'cleaned') {
      actions = [actionButton(t('btn.undo'), () => act(loc.id, 'reopen'))];
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

  setChildren(sheet, 
    sheetHead(loc.address, { onClose: closeDetail }),
    h('div', { class: 'sheet-body' },
      h('p', { class: `status ${status.cls}` }, status.text),
      h('div', { class: 'actions' }, actions, navButton(loc, actions.length ? '' : 'btn-primary')),
      !group && h('p', { class: 'hint' }, t('home.joinHint')),
      h('ul', { class: 'stones' }, loc.stones.map((st) => h('li', {},
        st.bioUrl
          ? h('a', { href: st.bioUrl, target: '_blank', rel: 'noopener' }, st.name)
          : h('span', {}, st.name),
        st.links?.length ? h('span', { class: 'extra-links' }, st.links.map((l) =>
          h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))) : null,
      ))),
      h('div', { class: 'note' },
        note ? h('p', { class: 'note-text' }, h('strong', {}, t('note.label')), note) : null,
        existingEditor ?? (group
          ? h('button', {
            type: 'button', class: 'btn btn-small',
            onclick: () => { noteEditing = loc.id; renderSheet(); sheet.querySelector('textarea')?.focus(); },
          }, note ? t('btn.editNote') : t('btn.addNote'))
          : null),
      ),
    ),
  );
  if (!existingEditor && noteEditing === loc.id && group) {
    sheet.querySelector('.note').lastElementChild?.replaceWith(noteEditor(loc.id, note));
  }
}

function noteEditor(id, note) {
  const textarea = h('textarea', { maxlength: String(NOTE_MAX), rows: '3', 'aria-label': t('note.aria') });
  textarea.value = note;
  const counter = h('span', { class: 'muted' }, `${note.length}/${NOTE_MAX}`);
  textarea.addEventListener('input', () => { counter.textContent = `${textarea.value.length}/${NOTE_MAX}`; });
  const save = () => run(async () => {
    try {
      const data = await saveNote(group.token, id, textarea.value.trim().slice(0, NOTE_MAX));
      applyLocation(id, data.location);
      noteEditing = null;
      toast(t('toast.noteSaved'));
    } finally {
      await refresh();
    }
  });
  return h('form', { class: 'note-editor', onsubmit: (e) => { e.preventDefault(); save(); } },
    textarea,
    h('div', { class: 'note-editor-row' },
      counter,
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { noteEditing = null; renderSheet(); } }, t('btn.discardNote')),
      h('button', { type: 'submit', class: 'btn btn-small btn-primary', 'data-action': '', disabled: busy }, t('btn.saveNote'))));
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

/** Takes over a name or naming state that changed on the server. */
function adoptGroupInfo(name, namePending) {
  if (!group || (name === group.groupName && namePending === Boolean(group.namePending))) return;
  group = { ...group, groupName: name, namePending };
  saveGroup(group);
  renderGroupButton();
  if (dialog.open && dialogView === 'group') renderGroupDialog();
}

function renderGroupButton() {
  $('group-button-label').textContent = group ? group.groupName : t('group.none');
  $('group-button').classList.toggle('has-group', Boolean(group));
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: t('invite.qrAlt') });
}

function inviteSection(target) {
  const link = inviteLink(target);
  const qr = h('div', { class: 'qr' });
  qr.innerHTML = qrSvg(link); // generated SVG from our own link, no user HTML
  const share = async () => {
    try {
      await navigator.share({ title: t('invite.shareTitle', { name: target.groupName }), text: t('invite.shareText', { name: target.groupName }), url: link });
    } catch (err) {
      if (err?.name !== 'AbortError') toast(t('toast.shareFailed'), { error: true });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('toast.copied'));
    } catch {
      linkField.select();
      toast(t('toast.copyManually'), { error: true });
    }
  };
  const linkField = h('input', { class: 'invite-link', readonly: true, value: link, 'aria-label': t('invite.linkAria'), onfocus: (e) => e.target.select() });
  return h('div', { class: 'invite' },
    h('p', {}, t('invite.text')),
    qr,
    h('div', { class: 'actions' },
      typeof navigator.share === 'function' && h('button', { type: 'button', class: 'btn btn-primary', onclick: share }, t('invite.share')),
      h('button', { type: 'button', class: 'btn', onclick: copy }, t('invite.copy'))),
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
    h('label', { class: 'share-row' }, input, t('share.switch')),
    h('p', { class: 'muted share-note' },
      t('share.note')));
}

// ---------- install ----------

let installEvent = null;        // Chromium's beforeinstallprompt, kept until used
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPadOS reports itself as a Mac, so a touch-capable "Mac" counts as iOS too.
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIosSafari = () => isIos() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (dialog.open && dialogView === 'group') renderGroupDialog();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  if (dialog.open && dialogView === 'group') renderGroupDialog();
});

function installSection() {
  if (isStandalone()) return null;
  if (installEvent) {
    return h('div', { class: 'actions' },
      h('button', {
        type: 'button', class: 'btn',
        onclick: async () => {
          const e = installEvent;
          installEvent = null; // a prompt can be used once
          e.prompt();
          await e.userChoice;
          renderGroupDialog();
        },
      }, t('install.button')));
  }
  // No install prompt (iOS, Firefox …): a button that reveals the browser's own steps.
  const steps = isIosSafari() ? 'install.stepsIosSafari'
    : isIos() ? 'install.stepsIosOther'
    : navigator.maxTouchPoints > 0 ? 'install.stepsOther'
    : null;
  if (!steps) return null;
  const hint = h('p', { class: 'hint', hidden: true }, t(steps));
  return h('div', {},
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', class: 'btn', 'aria-expanded': 'false',
        onclick: (e) => {
          hint.hidden = !hint.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!hint.hidden));
        },
      }, t('install.button'))),
    hint);
}

const LANG_NAMES = { de: 'Deutsch', en: 'English' };

function languageSwitch() {
  const current = getLang();
  return h('fieldset', { class: 'lang-switch' },
    h('legend', {}, t('lang.label')),
    h('div', { class: 'segments' }, Object.entries(LANG_NAMES).map(([code, name]) => h('label', { class: 'segment', lang: code },
      h('input', {
        type: 'radio', name: 'lang', value: code, checked: code === current,
        onchange: () => setLang(code),
      }),
      h('span', {}, name)))));
}

/** The language changed: redraw everything that is on screen, keeping the dialog open. */
onLangChange(() => {
  if (helpDialog.open) renderHelpDialog();
  renderGroupButton();
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', t('meta.appTitle'));
  if (dialog.open) {
    if (dialogView === 'group') renderGroupDialog();
    else if (dialogView === 'naming') renderNaming();
    else renderAll();
    $('group-dialog-body').querySelector('input[name="lang"]:checked')?.focus();
  } else {
    renderAll();
  }
});

function renderGroupDialog() {
  const body = $('group-dialog-body');
  if (group) {
    dialogView = 'group';
    $('group-dialog-title').textContent = group.groupName;
    setChildren(body, 
      h('p', { class: 'muted' }, t('dialog.member')),
      group.namePending && h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderNaming() }, t('dialog.setName'))),
      inviteSection(group),
      shareSwitch(),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: () => {
            if (!confirm(t('confirm.leave', { name: group.groupName }))) return;
            group = null;
            clearGroup();
            syncSharing();
            people = [];
            renderGroupButton();
            renderGroupDialog();
            renderAll();
            toast(t('toast.left'));
          },
        }, t('dialog.leave'))),
      languageSwitch(),
      installSection(),
      orgaEntry(),
    );
  } else {
    dialogView = 'group';
    $('group-dialog-title').textContent = t('group.none');
    setChildren(body, 
      h('p', { class: 'hint' }, t('home.joinHint')),
      h('p', { class: 'muted' }, t('dialog.viewOnly')),
      languageSwitch(),
      installSection(),
      orgaEntry(),
    );
  }
  renderAll();
}

// ---------- group naming ----------
// A group named by the organizer with a placeholder may choose its own name, once.

let dialogView = 'group';       // what the group dialog shows; sync only redraws it while it is 'group'
let nameAsked = false;          // asked in this session; reset by a new join

/** Asks for the name when this phone's group still has a placeholder and the dialog is free. */
function maybeAskName() {
  if (!group?.namePending || nameAsked || dialog.open) return;
  renderNaming();
  dialog.showModal();
}

function renderNaming() {
  nameAsked = true;
  dialogView = 'naming';
  $('group-dialog-title').textContent = t('naming.title');
  const input = h('input', { type: 'text', maxlength: '40', required: true, id: 'self-name', autocomplete: 'off', placeholder: t('naming.placeholder') });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true }, t('naming.taken'));
  const submit = async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    error.hidden = true;
    await run(async () => {
      try {
        const res = await nameGroup(group.token, name);
        group = { ...group, groupName: res.name, namePending: false };
        saveGroup(group);
        renderGroupButton();
        renderGroupDialog();
        toast(t('toast.nowNamed', { name: res.name }));
        refresh();
      } catch (err) {
        if (err instanceof ApiError && err.data.error === 'name_taken') {
          error.hidden = false;
          input.focus();
        } else if (err instanceof ApiError && err.data.error === 'name_locked') {
          group = { ...group, groupName: err.data.name, namePending: false };
          saveGroup(group);
          renderGroupButton();
          renderGroupDialog();
          toast(t('toast.alreadyNamed', { name: err.data.name }));
        } else {
          throw err;
        }
      }
    });
  };
  setChildren($('group-dialog-body'), 
    h('form', { class: 'form', onsubmit: submit },
      h('label', { for: 'self-name' }, t('naming.label')), input, error,
      h('p', { class: 'hint name-warning' }, t('naming.warning')),
      h('button', { type: 'submit', class: 'btn btn-primary', 'data-action': '' }, t('naming.submit')),
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('naming.later'))),
  );
  input.focus();
}

// ---------- organizer ----------

function orgaEntry() {
  return h('div', { class: 'create' },
    h('button', { type: 'button', class: 'btn', onclick: () => (organizerCode ? showOrga() : renderOrgaLogin()) }, t('orga.title')));
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
      toast(t('toast.orgaCodeWrong'), { error: true });
      renderOrgaLogin();
    }
  });
}

function orgaBack() {
  return h('button', { type: 'button', class: 'btn btn-small', onclick: renderGroupDialog }, t('common.back'));
}

function renderOrgaLogin() {
  dialogView = 'orga';
  $('group-dialog-title').textContent = t('orga.title');
  const code = h('input', { type: 'password', autocomplete: 'off', required: true, id: 'org-code' });
  const submit = (e) => {
    e.preventDefault();
    const value = code.value.trim();
    if (!value) return;
    orgaTask(async () => {
      const data = await orgaGroups(value);
      organizerCode = value;
      saveOrganizerCode(value);
      toast(t('toast.orgaOn'));
      renderOrga(data.groups);
      refresh();
    });
  };
  setChildren($('group-dialog-body'), 
    h('p', { class: 'muted' }, t('orga.intro')),
    h('form', { class: 'form', onsubmit: submit },
      h('label', { for: 'org-code' }, t('orga.code')), code,
      h('button', { type: 'submit', class: 'btn btn-primary', 'data-action': '' }, t('orga.continue'))),
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

function progressLine(done, total, labelKey) {
  return h('div', { class: 'progress' },
    h('p', { class: 'progress-text' }, h('strong', {}, t('orga.progressCount', { done, total })), ` ${t(labelKey)}`),
    h('div', { class: 'progress-bar', 'aria-hidden': 'true' },
      h('div', { class: 'progress-fill', style: `width: ${total ? Math.round((done / total) * 100) : 0}%` })));
}

function renderOrga(groups) {
  dialogView = 'orga';
  $('group-dialog-title').textContent = t('orga.title');
  const cleaned = (list) => list.filter((l) => stateOf(l.id).status === 'cleaned').length;
  const cannstatt = locations.filter((l) => l.district === 'cannstatt');

  const nameInput = h('input', { type: 'text', maxlength: '40', id: 'group-name', placeholder: t('orga.groupPlaceholder') });
  const create = (e) => {
    e.preventDefault();
    const n = nameInput.value.trim();
    orgaTask(async () => {
      const g = await createGroup(organizerCode, n);
      toast(t('toast.groupCreated', { name: g.name }));
      showInvite({ groupId: g.id, groupName: g.name, token: g.token });
    });
  };

  setChildren($('group-dialog-body'), 
    progressLine(cleaned(cannstatt), cannstatt.length, 'orga.progressCannstatt'),
    progressLine(cleaned(locations), locations.length, 'orga.progressAll'),
    groups.length
      ? h('ul', { class: 'orga-groups' }, groups.map((g) => orgaGroupItem(g)))
      : h('p', { class: 'muted' }, t('orga.noGroups')),
    h('details', { class: 'create' },
      h('summary', {}, t('orga.newGroup')),
      h('form', { class: 'form', onsubmit: create },
        h('label', { for: 'group-name' }, t('orga.groupName')), nameInput,
        h('p', { class: 'muted form-hint' }, t('orga.nameHint')),
        h('button', { type: 'submit', class: 'btn btn-primary', 'data-action': '' }, t('orga.createGroup')))),
    h('div', { class: 'actions' },
      orgaBack(),
      h('button', {
        type: 'button', class: 'btn btn-small',
        onclick: () => {
          organizerCode = null;
          clearOrganizerCode();
          renderGroupDialog();
          toast(t('toast.orgaOff'));
        },
      }, t('orga.end'))),
  );
}

function orgaGroupItem(g) {
  const target = g.reservation && byId.get(g.reservation.locationId);
  const btn = (label, onClick, cls = '') =>
    h('button', { type: 'button', class: `btn btn-small ${cls}`, 'data-action': '', disabled: busy, onclick: onClick }, label);
  return h('li', { class: 'orga-group' },
    h('div', { class: 'orga-group-head' },
      h('strong', { class: 'orga-group-name' }, g.name),
      h('span', { class: 'muted' }, t('orga.cleanedCount', { count: g.cleanedCount }))),
    target && h('p', { class: 'muted orga-group-way' }, t('orga.wayTo', { address: target.address })),
    h('div', { class: 'actions' },
      btn(t('orga.invite'), () => orgaTask(async () => {
        const inv = await orgaInvite(organizerCode, g.id);
        showInvite({ groupId: inv.id, groupName: inv.name, token: inv.token });
      })),
      btn(t('orga.join'), () => orgaTask(async () => {
        const inv = await orgaInvite(organizerCode, g.id);
        group = { groupId: inv.id, groupName: inv.name, namePending: g.namePending === true, token: inv.token };
        saveGroup(group);
        renderGroupButton();
        toast(t('toast.joined', { name: inv.name }));
        refresh();
        nameAsked = false;
        if (group.namePending) renderNaming();
        else await reloadOrga();
      })),
      btn(t('orga.rename'), () => {
        const name = prompt(t('prompt.rename'), g.name)?.trim();
        if (!name || name === g.name) return;
        return orgaTask(async () => {
          const res = await orgaRename(organizerCode, g.id, name);
          if (group?.groupId === g.id) {
            group = { ...group, groupName: res.name, namePending: false };
            saveGroup(group);
            renderGroupButton();
          }
          toast(t('toast.renamed'));
          refresh();
          await reloadOrga();
        });
      }),
      btn(t('orga.rotate'), () => {
        if (!confirm(t('confirm.rotate', { name: g.name }))) return;
        return orgaTask(async () => {
          const inv = await orgaRotate(organizerCode, g.id);
          // Keep this phone in the group if it was in it.
          if (group?.groupId === g.id) {
            group = { ...group, token: inv.token };
            saveGroup(group);
          }
          toast(t('toast.newLink'));
          showInvite({ groupId: inv.id, groupName: inv.name, token: inv.token });
        });
      }),
      btn(t('orga.delete'), () => {
        const way = g.reservation ? t('confirm.deleteWay') : '';
        if (!confirm(t('confirm.delete', { name: g.name }) + way)) return;
        return orgaTask(async () => {
          await orgaDelete(organizerCode, g.id);
          if (group?.groupId === g.id) {
            group = null;
            clearGroup();
            renderGroupButton();
          }
          toast(t('toast.groupDeleted', { name: g.name }));
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
  dialogView = 'orga';
  $('group-dialog-title').textContent = target.groupName;
  setChildren($('group-dialog-body'), 
    inviteSection(target),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-small', onclick: showOrga }, t('orga.backToOrga'))),
  );
}

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
    group = { groupId: me.id, groupName: me.name, namePending: me.namePending === true, token: join.token };
    saveGroup(group);
    removeFragment();
    renderGroupButton();
    toast(t('toast.joined', { name: me.name }));
    nameAsked = false;
    maybeAskName();
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      // Keep the fragment so a reload can try again.
      toast(t('toast.joinOffline'), { error: true });
    } else {
      removeFragment();
      toast(t('toast.joinInvalid'), { error: true });
    }
  }
}

async function checkStoredGroup() {
  if (!group || readJoinFragment(location.hash)) return;
  try {
    const me = await getMe(group.token);
    adoptGroupInfo(me.name, me.namePending === true);
    maybeAskName();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      dropGroup(groupGone());
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
    toast(t('toast.loadFailed'), { error: true });
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.error('sw', err));
}

start();
