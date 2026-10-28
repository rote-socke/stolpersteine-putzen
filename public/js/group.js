// The group this phone belongs to, kept in localStorage.

const KEY = 'stolpersteine-putzen.group';

export function loadGroup() {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (g && typeof g.groupId === 'string' && typeof g.token === 'string') return g;
  } catch {
    /* storage blocked or corrupt: no group */
  }
  return null;
}

export function saveGroup(group) {
  try {
    localStorage.setItem(KEY, JSON.stringify(group));
  } catch {
    /* private mode: the group lives only for this page view */
  }
}

export function clearGroup() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Opt-in sharing of this phone's position with the other groups' members. Default off.
const SHARE_KEY = 'stolpersteine-putzen.share-location';

export function loadShareLocation() {
  try {
    return localStorage.getItem(SHARE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveShareLocation(on) {
  try {
    if (on) localStorage.setItem(SHARE_KEY, '1');
    else localStorage.removeItem(SHARE_KEY);
  } catch {
    /* private mode: the choice lasts only for this page view */
  }
}

// A random id per phone, so the map shows one dot per phone. Not tied to a person.
const DEVICE_KEY = 'stolpersteine-putzen.device-id';

export function loadDeviceId() {
  try {
    const id = localStorage.getItem(DEVICE_KEY);
    if (id && /^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
  } catch {
    /* storage blocked: a new id per page view */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* see above */
  }
  return id;
}

// The organizer code, kept on this phone while organizer mode is on.
const CODE_KEY = 'stolpersteine-putzen.organizer';

export function loadOrganizerCode() {
  try {
    return localStorage.getItem(CODE_KEY) || null;
  } catch {
    return null; // storage blocked: organizer mode lasts only for this page view
  }
}

export function saveOrganizerCode(code) {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    /* private mode: the code lives only for this page view */
  }
}

export function clearOrganizerCode() {
  try {
    localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
}

/** Reads `#join=<groupId>.<token>` from the address; null if absent or malformed. */
export function readJoinFragment(hash) {
  const m = /^#join=([^.]+)\.(.+)$/.exec(hash ?? '');
  if (!m) return null;
  return { groupId: decodeURIComponent(m[1]), token: decodeURIComponent(m[2]) };
}

export function inviteLink(group) {
  const base = location.origin + location.pathname;
  return `${base}#join=${encodeURIComponent(group.groupId)}.${encodeURIComponent(group.token)}`;
}

export function removeFragment() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    location.hash = '';
  }
}
