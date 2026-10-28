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
