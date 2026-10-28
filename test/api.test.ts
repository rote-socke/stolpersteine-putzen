import { beforeEach, describe, expect, it } from 'vitest';
import { createApi, RESERVATION_MS, type Env } from '../src/api.ts';
import { createTestDb } from './d1-sqlite.ts';

const CODE = 'organizer-secret';
let t: number;
let env: Env;
let handle: (r: Request, e: Env) => Promise<Response>;

beforeEach(() => {
  t = 1_800_000_000_000;
  env = { DB: createTestDb(), ASSETS: {} as Fetcher, ORGANIZER_CODE: CODE };
  handle = createApi({ locationIds: new Set(['loc1', 'loc2']), now: () => t });
});

async function call(method: string, path: string, opts: { token?: string; code?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.code) headers['x-organizer-code'] = opts.code;
  const res = await handle(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  );
  return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as any };
}

async function newGroup(name: string) {
  const r = await call('POST', '/api/groups', { code: CODE, body: { name } });
  expect(r.status).toBe(201);
  return r.body as { id: string; name: string; token: string };
}

describe('auth and groups', () => {
  it('rejects a wrong or missing organizer code', async () => {
    expect((await call('POST', '/api/groups', { body: { name: 'A' } })).status).toBe(401);
    expect((await call('POST', '/api/groups', { code: 'nope', body: { name: 'A' } })).status).toBe(401);
  });

  it('creates a group, trims the name, rejects case-insensitive duplicates', async () => {
    const g = await newGroup('  Gruppe A ');
    expect(g.name).toBe('Gruppe A');
    expect(g.id).toMatch(/^g_/);
    expect(g.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dup = await call('POST', '/api/groups', { code: CODE, body: { name: 'gruppe a' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('name_taken');
    expect((await call('POST', '/api/groups', { code: CODE, body: { name: '  ' } })).status).toBe(400);
    expect((await call('POST', '/api/groups', { code: CODE, body: { name: 'x'.repeat(41) } })).status).toBe(400);
  });

  it('requires a valid token for writes and /groups/me', async () => {
    const g = await newGroup('A');
    expect((await call('POST', '/api/locations/loc1/reserve')).status).toBe(401);
    expect((await call('POST', '/api/locations/loc1/reserve', { token: 'wrong' })).status).toBe(401);
    expect((await call('GET', '/api/groups/me', { token: g.token })).body).toEqual({ id: g.id, name: 'A' });
  });

  it('answers 404 for unknown location ids', async () => {
    const g = await newGroup('A');
    const r = await call('POST', '/api/locations/nope/reserve', { token: g.token });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });
});

describe('reservation', () => {
  it('lets only one of two groups take a location', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    expect((await call('POST', '/api/locations/loc1/reserve', { token: a.token })).status).toBe(200);
    const r = await call('POST', '/api/locations/loc1/reserve', { token: b.token });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'taken', groupId: a.id, groupName: 'A' });
  });

  it('allows taking over after the reservation expired, and reports it open before', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    t += RESERVATION_MS - 1;
    expect((await call('GET', '/api/state')).body.locations.loc1.status).toBe('on_the_way');
    t += 1;
    expect((await call('GET', '/api/state')).body.locations).toEqual({});
    const r = await call('POST', '/api/locations/loc1/reserve', { token: b.token });
    expect(r.status).toBe(200);
    expect(r.body.location).toMatchObject({ status: 'on_the_way', groupId: b.id, expiresAt: t + RESERVATION_MS });
  });

  it('releases the previous reservation when reserving another location', async () => {
    const a = await newGroup('A');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    await call('POST', '/api/locations/loc2/reserve', { token: a.token });
    const locs = (await call('GET', '/api/state')).body.locations;
    expect(Object.keys(locs)).toEqual(['loc2']);
  });

  it('keeps the previous reservation when the new reserve fails', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    await call('POST', '/api/locations/loc2/reserve', { token: b.token });
    expect((await call('POST', '/api/locations/loc2/reserve', { token: a.token })).status).toBe(409);
    expect((await call('GET', '/api/state')).body.locations.loc1.groupId).toBe(a.id);
  });

  it('release only works on the own reservation', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    expect((await call('POST', '/api/locations/loc1/release', { token: b.token })).status).toBe(403);
    const r = await call('POST', '/api/locations/loc1/release', { token: a.token });
    expect(r.body.location.status).toBe('open');
  });
});

describe('clean, reopen, notes, state', () => {
  it('cleans from any status, blocks reserving, and reopens', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    const c = await call('POST', '/api/locations/loc1/clean', { token: b.token });
    expect(c.body.location).toMatchObject({ status: 'cleaned', groupId: b.id, groupName: 'B' });
    expect(c.body.location.expiresAt).toBeUndefined();
    const r = await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    expect(r.body).toEqual({ error: 'cleaned' });
    const o = await call('POST', '/api/locations/loc1/reopen', { token: a.token });
    expect(o.body.location.status).toBe('open');
  });

  it('sets, validates and clears a note independent of status', async () => {
    const a = await newGroup('A');
    const s = await call('PUT', '/api/locations/loc1/note', { token: a.token, body: { text: 'Stein fehlt' } });
    expect(s.body.location).toMatchObject({ status: 'open', note: 'Stein fehlt', noteUpdatedAt: t });
    expect((await call('GET', '/api/state')).body.locations.loc1.note).toBe('Stein fehlt');
    expect((await call('PUT', '/api/locations/loc1/note', { token: a.token, body: { text: 'x'.repeat(501) } })).status).toBe(400);
    await call('PUT', '/api/locations/loc1/note', { token: a.token, body: { text: '' } });
    expect((await call('GET', '/api/state')).body.locations).toEqual({});
  });

  it('serves the state shape without tokens, uncached', async () => {
    const a = await newGroup('A');
    await call('POST', '/api/locations/loc1/reserve', { token: a.token });
    const r = await call('GET', '/api/state');
    expect(r.cache).toBe('no-store');
    expect(r.body).toEqual({
      now: t,
      groups: [{ id: a.id, name: 'A' }],
      locations: {
        loc1: { status: 'on_the_way', groupId: a.id, groupName: 'A', updatedAt: t, expiresAt: t + RESERVATION_MS },
      },
    });
    expect(JSON.stringify(r.body)).not.toContain(a.token);
  });
});
