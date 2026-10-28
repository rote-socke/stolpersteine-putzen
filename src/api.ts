// API logic, free of the bundled location data and the clock so tests can inject both.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ORGANIZER_CODE: string;
  INVITE_SECRET: string;
}

export interface ApiOptions {
  locationIds: ReadonlySet<string>;
  now?: () => number;
}

export const RESERVATION_MS = 45 * 60 * 1000;
const NOTE_MAX = 500;
const NAME_MAX = 40;
export const PRESENCE_MS = 10 * 60 * 1000;
const ACCURACY_CAP = 10000;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface Group {
  id: string;
  name: string;
}
interface GroupRow extends Group {
  token_version: number;
  token_hash: string;
}
interface AuthGroup extends Group {
  name_pending: number;
}
interface StateRow {
  location_id: string;
  status: 'open' | 'on_the_way' | 'cleaned';
  group_id: string | null;
  updated_at: number;
}
interface NoteRow {
  location_id: string;
  text: string;
  group_id: string | null;
  updated_at: number;
}

interface LocationState {
  status: 'open' | 'on_the_way' | 'cleaned';
  groupId?: string;
  groupName?: string;
  updatedAt?: number;
  expiresAt?: number;
  note?: string;
  noteUpdatedAt?: number;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  new HttpError(status, { error, ...extra });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomId = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** The group token is derived, so the organizer can always show the invite again. */
async function deriveToken(env: Env, groupId: string, version: number): Promise<string> {
  if (!env.INVITE_SECRET) throw new Error('INVITE_SECRET is not set');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.INVITE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${groupId}:${version}`));
  return base64url(new Uint8Array(mac));
}

/** Constant-time equality: compares fixed-length digests, so length and content do not leak. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da.charCodeAt(i) ^ db.charCodeAt(i);
  return diff === 0;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw fail(400, 'invalid');
}

export function createApi(opts: ApiOptions) {
  const now = opts.now ?? Date.now;

  async function authenticate(request: Request, env: Env): Promise<AuthGroup> {
    const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
    if (!m) throw fail(401, 'unauthorized');
    const group = await env.DB.prepare(
      'SELECT id, name, name_pending FROM groups WHERE token_hash = ? AND deleted_at IS NULL',
    )
      .bind(await sha256(m[1]))
      .first<AuthGroup>();
    if (!group) throw fail(401, 'unauthorized');
    return group;
  }

  function locationId(id: string): string {
    if (!opts.locationIds.has(id)) throw fail(404, 'not_found');
    return id;
  }

  /** Builds the state of a location from its rows; null if it has nothing to report. */
  function toState(
    row: StateRow | null | undefined,
    note: NoteRow | null | undefined,
    names: Map<string, string>,
    t: number,
  ): LocationState | null {
    const live = row && !(row.status === 'on_the_way' && row.updated_at + RESERVATION_MS <= t);
    if (!live && !note) return null;
    const s: LocationState = { status: live ? row.status : 'open' };
    if (live) {
      if (row.group_id) {
        s.groupId = row.group_id;
        s.groupName = names.get(row.group_id);
      }
      s.updatedAt = row.updated_at;
      if (row.status === 'on_the_way') s.expiresAt = row.updated_at + RESERVATION_MS;
    }
    if (note) {
      s.note = note.text;
      s.noteUpdatedAt = note.updated_at;
    }
    return s;
  }

  /** Names for the state; deleted groups stay visible on what they cleaned or noted. */
  const nameMap = (rows: (Group & { deleted_at: number | null })[]) =>
    new Map(rows.map((g) => [g.id, g.deleted_at === null ? g.name : `${g.name} (gelöscht)`]));

  async function groupNames(env: Env): Promise<Map<string, string>> {
    const { results } = await env.DB.prepare('SELECT id, name, deleted_at FROM groups').all<
      Group & { deleted_at: number | null }
    >();
    return nameMap(results);
  }

  async function locationState(env: Env, id: string): Promise<LocationState> {
    const [row, note, names] = await Promise.all([
      env.DB.prepare('SELECT * FROM location_state WHERE location_id = ?').bind(id).first<StateRow>(),
      env.DB.prepare('SELECT * FROM notes WHERE location_id = ?').bind(id).first<NoteRow>(),
      groupNames(env),
    ]);
    return toState(row, note, names, now()) ?? { status: 'open' };
  }

  async function getState(env: Env): Promise<Response> {
    const t = now();
    const [states, notes, groups] = await Promise.all([
      env.DB.prepare('SELECT * FROM location_state').all<StateRow>(),
      env.DB.prepare('SELECT * FROM notes').all<NoteRow>(),
      env.DB.prepare('SELECT id, name, name_pending, deleted_at FROM groups ORDER BY created_at').all<
        AuthGroup & { deleted_at: number | null }
      >(),
    ]);
    const names = nameMap(groups.results);
    const noteById = new Map(notes.results.map((n) => [n.location_id, n]));
    const rowById = new Map(states.results.map((r) => [r.location_id, r]));
    const locations: Record<string, LocationState> = {};
    for (const id of new Set([...rowById.keys(), ...noteById.keys()])) {
      const s = toState(rowById.get(id), noteById.get(id), names, t);
      if (s) locations[id] = s;
    }
    const live = groups.results.filter((g) => g.deleted_at === null).map((g) => ({ id: g.id, name: g.name, namePending: g.name_pending === 1 }));
    return json({ now: t, groups: live, locations });
  }

  async function requireOrganizer(request: Request, env: Env): Promise<void> {
    const code = request.headers.get('x-organizer-code');
    if (!code || !env.ORGANIZER_CODE || !(await safeEqual(code, env.ORGANIZER_CODE))) {
      throw fail(401, 'unauthorized');
    }
  }

  /** The trimmed name; '' when the body has none and `optional` is set. */
  async function readName(request: Request, optional = false): Promise<string> {
    const body = await readJson(request);
    if (optional && (body.name === undefined || body.name === null)) return '';
    if (typeof body.name !== 'string') throw fail(400, 'invalid');
    const name = body.name.trim();
    if (name.length > NAME_MAX || (name.length < 1 && !optional)) throw fail(400, 'invalid');
    return name;
  }

  const nameTaken = (e: unknown) => {
    if (/UNIQUE/i.test(String(e instanceof Error ? e.message : e))) return fail(409, 'name_taken');
    return e;
  };

  async function createGroup(request: Request, env: Env): Promise<Response> {
    await requireOrganizer(request, env);
    const given = await readName(request, true);
    const id = `g_${randomId(9)}`;
    const token = await deriveToken(env, id, 0);
    const tokenHash = await sha256(token);
    const insert = (name: string, pending: number) =>
      env.DB.prepare(
        'INSERT INTO groups (id, name, name_key, name_pending, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(id, name, name.toLowerCase(), pending, tokenHash, now())
        .run();
    if (given) {
      try {
        await insert(given, 0);
      } catch (e) {
        throw nameTaken(e);
      }
      return json({ id, name: given, namePending: false, token }, 201);
    }
    // Placeholder: the lowest free "Gruppe N". A concurrent insert may take it first, so retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { results } = await env.DB.prepare("SELECT name_key FROM groups WHERE name_key LIKE 'gruppe %'").all<{
        name_key: string;
      }>();
      const used = new Set(results.map((r) => r.name_key));
      let n = 1;
      while (used.has(`gruppe ${n}`)) n++;
      try {
        await insert(`Gruppe ${n}`, 1);
        return json({ id, name: `Gruppe ${n}`, namePending: true, token }, 201);
      } catch (e) {
        if (!/UNIQUE/i.test(String(e instanceof Error ? e.message : e))) throw e;
      }
    }
    throw fail(409, 'name_taken');
  }

  /** A group with a placeholder name chooses its own, once. */
  async function nameSelf(request: Request, env: Env, group: AuthGroup): Promise<Response> {
    const name = await readName(request);
    let res;
    try {
      res = await env.DB.prepare(
        'UPDATE groups SET name = ?, name_key = ?, name_pending = 0 WHERE id = ? AND name_pending = 1 AND deleted_at IS NULL',
      )
        .bind(name, name.toLowerCase(), group.id)
        .run();
    } catch (e) {
      throw nameTaken(e);
    }
    if (res.meta.changes === 0) {
      const cur = await env.DB.prepare('SELECT name FROM groups WHERE id = ? AND deleted_at IS NULL')
        .bind(group.id)
        .first<{ name: string }>();
      if (!cur) throw fail(401, 'unauthorized');
      throw fail(409, 'name_locked', { name: cur.name });
    }
    return json({ id: group.id, name, namePending: false });
  }

  // ---------- organizer ----------

  async function listGroups(env: Env): Promise<Response> {
    const t = now();
    const [groups, cleaned, reserved] = await Promise.all([
      env.DB.prepare('SELECT id, name, name_pending, created_at FROM groups WHERE deleted_at IS NULL ORDER BY created_at').all<
        AuthGroup & { created_at: number }
      >(),
      env.DB.prepare("SELECT group_id, COUNT(*) AS n FROM location_state WHERE status = 'cleaned' GROUP BY group_id").all<{
        group_id: string;
        n: number;
      }>(),
      env.DB.prepare(
        "SELECT group_id, location_id, updated_at FROM location_state WHERE status = 'on_the_way' AND updated_at > ?",
      )
        .bind(t - RESERVATION_MS)
        .all<{ group_id: string; location_id: string; updated_at: number }>(),
    ]);
    const counts = new Map(cleaned.results.map((r) => [r.group_id, Number(r.n)]));
    const live = new Map(reserved.results.map((r) => [r.group_id, r]));
    return json({
      groups: groups.results.map((g) => {
        const r = live.get(g.id);
        return {
          id: g.id,
          name: g.name,
          namePending: g.name_pending === 1,
          createdAt: g.created_at,
          cleanedCount: counts.get(g.id) ?? 0,
          reservation: r ? { locationId: r.location_id, expiresAt: r.updated_at + RESERVATION_MS } : null,
        };
      }),
    });
  }

  async function findGroup(env: Env, id: string): Promise<GroupRow> {
    const g = await env.DB.prepare(
      'SELECT id, name, token_version, token_hash FROM groups WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(id)
      .first<GroupRow>();
    if (!g) throw fail(404, 'not_found');
    return g;
  }

  // A legacy group (random token from before) switches to the derived token here, once.
  async function invite(env: Env, id: string): Promise<Response> {
    const g = await findGroup(env, id);
    const token = await deriveToken(env, g.id, g.token_version);
    const hash = await sha256(token);
    if (hash !== g.token_hash) {
      await env.DB.prepare('UPDATE groups SET token_hash = ? WHERE id = ?').bind(hash, g.id).run();
    }
    return json({ id: g.id, name: g.name, token });
  }

  async function rotate(env: Env, id: string): Promise<Response> {
    const g = await findGroup(env, id);
    const version = g.token_version + 1;
    const token = await deriveToken(env, g.id, version);
    await env.DB.batch([
      env.DB.prepare('UPDATE groups SET token_version = ?, token_hash = ? WHERE id = ?').bind(
        version,
        await sha256(token),
        g.id,
      ),
      env.DB.prepare('DELETE FROM presence WHERE group_id = ?').bind(g.id),
    ]);
    return json({ id: g.id, name: g.name, token });
  }

  async function rename(request: Request, env: Env, id: string): Promise<Response> {
    const g = await findGroup(env, id);
    const name = await readName(request);
    try {
      await env.DB.prepare('UPDATE groups SET name = ?, name_key = ?, name_pending = 0 WHERE id = ?')
        .bind(name, name.toLowerCase(), g.id)
        .run();
    } catch (e) {
      throw nameTaken(e);
    }
    return json({ id: g.id, name });
  }

  // Soft delete: location_state and notes keep referencing the group row.
  async function removeGroup(env: Env, id: string): Promise<Response> {
    const g = await findGroup(env, id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM location_state WHERE group_id = ? AND status = 'on_the_way'").bind(g.id),
      env.DB.prepare('DELETE FROM presence WHERE group_id = ?').bind(g.id),
      env.DB.prepare(
        "UPDATE groups SET deleted_at = ?, name_key = 'deleted:' || id, token_hash = 'deleted:' || id WHERE id = ?",
      ).bind(now(), g.id),
    ]);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  async function reserve(env: Env, group: Group, id: string): Promise<LocationState> {
    const t = now();
    // One conditional statement decides the race; the release of the previous
    // reservation rides in the same batch and only fires if the reserve won.
    const [res] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO location_state (location_id, status, group_id, updated_at)
         VALUES (?, 'on_the_way', ?, ?)
         ON CONFLICT(location_id) DO UPDATE SET
           status = 'on_the_way', group_id = excluded.group_id, updated_at = excluded.updated_at
         WHERE status = 'open'
            OR (status = 'on_the_way' AND (group_id = excluded.group_id OR updated_at <= ?))`,
      ).bind(id, group.id, t, t - RESERVATION_MS),
      env.DB.prepare(
        `DELETE FROM location_state
         WHERE group_id = ? AND status = 'on_the_way' AND location_id != ?
           AND EXISTS (SELECT 1 FROM location_state WHERE location_id = ? AND group_id = ? AND status = 'on_the_way')`,
      ).bind(group.id, id, id, group.id),
    ]);
    if (res.meta.changes === 0) {
      const row = await env.DB.prepare('SELECT * FROM location_state WHERE location_id = ?')
        .bind(id)
        .first<StateRow>();
      if (row?.status === 'cleaned') throw fail(409, 'cleaned');
      const names = await groupNames(env);
      throw fail(409, 'taken', {
        groupId: row?.group_id ?? null,
        groupName: (row?.group_id && names.get(row.group_id)) || null,
      });
    }
    return locationState(env, id);
  }

  async function release(env: Env, group: Group, id: string): Promise<LocationState> {
    const row = await env.DB.prepare('SELECT * FROM location_state WHERE location_id = ?')
      .bind(id)
      .first<StateRow>();
    const live = row && !(row.status === 'on_the_way' && row.updated_at + RESERVATION_MS <= now());
    if (live) {
      if (row.status !== 'on_the_way' || row.group_id !== group.id) throw fail(403, 'forbidden');
      await env.DB.prepare('DELETE FROM location_state WHERE location_id = ? AND group_id = ?')
        .bind(id, group.id)
        .run();
    }
    return locationState(env, id);
  }

  async function clean(env: Env, group: Group, id: string): Promise<LocationState> {
    await env.DB.prepare(
      `INSERT INTO location_state (location_id, status, group_id, updated_at) VALUES (?, 'cleaned', ?, ?)
       ON CONFLICT(location_id) DO UPDATE SET
         status = 'cleaned', group_id = excluded.group_id, updated_at = excluded.updated_at`,
    )
      .bind(id, group.id, now())
      .run();
    return locationState(env, id);
  }

  // Reopening a location that is not cleaned is a no-op that returns the current state.
  async function reopen(env: Env, id: string): Promise<LocationState> {
    await env.DB.prepare("DELETE FROM location_state WHERE location_id = ? AND status = 'cleaned'")
      .bind(id)
      .run();
    return locationState(env, id);
  }

  async function setNote(request: Request, env: Env, group: Group, id: string): Promise<LocationState> {
    const body = await readJson(request);
    if (typeof body.text !== 'string' || body.text.length > NOTE_MAX) throw fail(400, 'invalid');
    const text = body.text.trim();
    if (text === '') {
      await env.DB.prepare('DELETE FROM notes WHERE location_id = ?').bind(id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO notes (location_id, text, group_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(location_id) DO UPDATE SET
           text = excluded.text, group_id = excluded.group_id, updated_at = excluded.updated_at`,
      )
        .bind(id, text, group.id, now())
        .run();
    }
    return locationState(env, id);
  }

  // ---------- presence ----------
  // Latest position per device, opt-in. Never logged, never public, gone after PRESENCE_MS.

  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

  async function putPresence(request: Request, env: Env, group: Group): Promise<Response> {
    const body = await readJson(request);
    const lat = num(body.lat, -90, 90);
    const lon = num(body.lon, -180, 180);
    const accuracy = num(body.accuracy, 0, Number.MAX_VALUE);
    if (typeof body.deviceId !== 'string' || !DEVICE_ID.test(body.deviceId) || lat === null || lon === null || accuracy === null) {
      throw fail(400, 'invalid');
    }
    const t = now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM presence WHERE updated_at <= ?').bind(t - PRESENCE_MS),
      env.DB.prepare(
        `INSERT INTO presence (device_id, group_id, lat, lon, accuracy, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           group_id = excluded.group_id, lat = excluded.lat, lon = excluded.lon,
           accuracy = excluded.accuracy, updated_at = excluded.updated_at`,
      ).bind(body.deviceId, group.id, lat, lon, Math.min(accuracy, ACCURACY_CAP), t),
    ]);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  async function deletePresence(env: Env, group: Group, deviceId: string): Promise<Response> {
    await env.DB.prepare('DELETE FROM presence WHERE device_id = ? AND group_id = ?').bind(deviceId, group.id).run();
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  async function getPresence(request: Request, env: Env): Promise<Response> {
    if (request.headers.has('x-organizer-code')) await requireOrganizer(request, env);
    else await authenticate(request, env);
    const t = now();
    const { results } = await env.DB.prepare(
      `SELECT p.device_id, p.group_id, g.name, p.lat, p.lon, p.accuracy, p.updated_at
       FROM presence p JOIN groups g ON g.id = p.group_id
       WHERE p.updated_at > ? AND g.deleted_at IS NULL ORDER BY p.updated_at DESC`,
    )
      .bind(t - PRESENCE_MS)
      .all<{ device_id: string; group_id: string; name: string; lat: number; lon: number; accuracy: number; updated_at: number }>();
    return json({
      now: t,
      people: results.map((r) => ({
        deviceId: r.device_id,
        groupId: r.group_id,
        groupName: r.name,
        lat: r.lat,
        lon: r.lon,
        accuracy: r.accuracy,
        updatedAt: r.updated_at,
      })),
    });
  }

  async function route(request: Request, env: Env, path: string): Promise<Response> {
    const method = request.method;
    if (path === '/api/state' && method === 'GET') return getState(env);
    if (path === '/api/groups' && method === 'POST') return createGroup(request, env);
    if (path === '/api/groups/me' && method === 'GET') {
      const g = await authenticate(request, env);
      return json({ id: g.id, name: g.name, namePending: g.name_pending === 1 });
    }
    if (path === '/api/groups/me/name') {
      if (method !== 'PUT') throw fail(405, 'invalid');
      return nameSelf(request, env, await authenticate(request, env));
    }
    if (path === '/api/presence') {
      if (method === 'GET') return getPresence(request, env);
      if (method === 'PUT') return putPresence(request, env, await authenticate(request, env));
      throw fail(405, 'invalid');
    }
    const pr = /^\/api\/presence\/([^/]+)$/.exec(path);
    if (pr) {
      if (method !== 'DELETE') throw fail(405, 'invalid');
      return deletePresence(env, await authenticate(request, env), decodeURIComponent(pr[1]));
    }
    if (path.startsWith('/api/orga/')) {
      await requireOrganizer(request, env);
      if (path === '/api/orga/groups' && method === 'GET') return listGroups(env);
      const o = /^\/api\/orga\/groups\/([^/]+)(?:\/(invite|rotate))?$/.exec(path);
      if (o) {
        const id = decodeURIComponent(o[1]);
        if (o[2] === 'invite' && method === 'GET') return invite(env, id);
        if (o[2] === 'rotate' && method === 'POST') return rotate(env, id);
        if (!o[2] && method === 'PATCH') return rename(request, env, id);
        if (!o[2] && method === 'DELETE') return removeGroup(env, id);
        throw fail(405, 'invalid');
      }
      throw fail(404, 'not_found');
    }
    const m = /^\/api\/locations\/([^/]+)\/(reserve|release|clean|reopen|note)$/.exec(path);
    if (m) {
      const action = m[2];
      if (method !== (action === 'note' ? 'PUT' : 'POST')) throw fail(405, 'invalid');
      const group = await authenticate(request, env);
      const id = locationId(decodeURIComponent(m[1]));
      const location =
        action === 'reserve' ? await reserve(env, group, id)
        : action === 'release' ? await release(env, group, id)
        : action === 'clean' ? await clean(env, group, id)
        : action === 'reopen' ? await reopen(env, id)
        : await setNote(request, env, group, id);
      return json({ location });
    }
    throw fail(404, 'not_found');
  }

  return async function handle(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env, new URL(request.url).pathname);
    } catch (e) {
      if (e instanceof HttpError) return json(e.body, e.status);
      console.error(e);
      return json({ error: 'internal' }, 500);
    }
  };
}
