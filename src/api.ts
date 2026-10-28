// API logic, free of the bundled location data and the clock so tests can inject both.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ORGANIZER_CODE: string;
}

export interface ApiOptions {
  locationIds: ReadonlySet<string>;
  now?: () => number;
}

export const RESERVATION_MS = 45 * 60 * 1000;
const NOTE_MAX = 500;
const NAME_MAX = 40;

interface Group {
  id: string;
  name: string;
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

  async function authenticate(request: Request, env: Env): Promise<Group> {
    const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
    if (!m) throw fail(401, 'unauthorized');
    const group = await env.DB.prepare('SELECT id, name FROM groups WHERE token_hash = ?')
      .bind(await sha256(m[1]))
      .first<Group>();
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

  async function groupNames(env: Env): Promise<Map<string, string>> {
    const { results } = await env.DB.prepare('SELECT id, name FROM groups').all<Group>();
    return new Map(results.map((g) => [g.id, g.name]));
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
      env.DB.prepare('SELECT id, name FROM groups ORDER BY created_at').all<Group>(),
    ]);
    const names = new Map(groups.results.map((g) => [g.id, g.name]));
    const noteById = new Map(notes.results.map((n) => [n.location_id, n]));
    const rowById = new Map(states.results.map((r) => [r.location_id, r]));
    const locations: Record<string, LocationState> = {};
    for (const id of new Set([...rowById.keys(), ...noteById.keys()])) {
      const s = toState(rowById.get(id), noteById.get(id), names, t);
      if (s) locations[id] = s;
    }
    return json({ now: t, groups: groups.results, locations });
  }

  async function createGroup(request: Request, env: Env): Promise<Response> {
    const code = request.headers.get('x-organizer-code');
    if (!code || !env.ORGANIZER_CODE || !(await safeEqual(code, env.ORGANIZER_CODE))) {
      throw fail(401, 'unauthorized');
    }
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > NAME_MAX) throw fail(400, 'invalid');
    const id = `g_${randomId(9)}`;
    const token = randomId(32);
    try {
      await env.DB.prepare(
        'INSERT INTO groups (id, name, name_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, name, name.toLowerCase(), await sha256(token), now())
        .run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e instanceof Error ? e.message : e))) throw fail(409, 'name_taken');
      throw e;
    }
    return json({ id, name, token }, 201);
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

  async function route(request: Request, env: Env, path: string): Promise<Response> {
    const method = request.method;
    if (path === '/api/state' && method === 'GET') return getState(env);
    if (path === '/api/groups' && method === 'POST') return createGroup(request, env);
    if (path === '/api/groups/me' && method === 'GET') {
      const g = await authenticate(request, env);
      return json({ id: g.id, name: g.name });
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
