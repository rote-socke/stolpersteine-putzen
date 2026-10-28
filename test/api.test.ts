import { beforeEach, describe, expect, it } from 'vitest';
import { createApi, PRESENCE_MS, RESERVATION_MS, type Env } from '../src/api.ts';
import { createTestDb } from './d1-sqlite.ts';

const CODE = 'organizer-secret';
let t: number;
let env: Env;
let handle: (r: Request, e: Env) => Promise<Response>;

beforeEach(() => {
  t = 1_800_000_000_000;
  env = { DB: createTestDb(), ASSETS: {} as Fetcher, ORGANIZER_CODE: CODE, INVITE_SECRET: 'invite-secret' };
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
  return { status: res.status, cache: res.headers.get('cache-control'), body: (res.status === 204 ? null : await res.json()) as any };
}

async function orga(method: string, path: string, body?: unknown) {
  return call(method, `/api/orga${path}`, { code: CODE, body });
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

describe('organizer', () => {
  it('requires the organizer code on every endpoint', async () => {
    const g = await newGroup('A');
    for (const [method, path] of [
      ['GET', '/api/orga/groups'],
      ['GET', `/api/orga/groups/${g.id}/invite`],
      ['POST', `/api/orga/groups/${g.id}/rotate`],
      ['PATCH', `/api/orga/groups/${g.id}`],
      ['DELETE', `/api/orga/groups/${g.id}`],
    ]) {
      expect((await call(method, path)).status).toBe(401);
      expect((await call(method, path, { code: 'nope' })).status).toBe(401);
    }
  });

  it('lists groups with cleaned count and live reservation only', async () => {
    const a = await newGroup('A');
    t += 1000;
    const b = await newGroup('B');
    await call('POST', '/api/locations/loc1/clean', { token: a.token });
    await call('POST', '/api/locations/loc2/reserve', { token: b.token });
    const r = await orga('GET', '/groups');
    expect(r.status).toBe(200);
    expect(r.body.groups).toEqual([
      { id: a.id, name: 'A', createdAt: t - 1000, cleanedCount: 1, reservation: null },
      { id: b.id, name: 'B', createdAt: t, cleanedCount: 0, reservation: { locationId: 'loc2', expiresAt: t + RESERVATION_MS } },
    ]);
    t += RESERVATION_MS;
    expect((await orga('GET', '/groups')).body.groups[1].reservation).toBeNull();
  });

  it('derives a stable invite token that works as Bearer', async () => {
    const g = await newGroup('A');
    const i1 = await orga('GET', `/groups/${g.id}/invite`);
    const i2 = await orga('GET', `/groups/${g.id}/invite`);
    expect(i1.body).toEqual({ id: g.id, name: 'A', token: g.token });
    expect(i2.body.token).toBe(g.token);
    expect((await call('GET', '/api/groups/me', { token: i1.body.token })).body).toEqual({ id: g.id, name: 'A' });
  });

  it('answers 404 for unknown groups', async () => {
    expect((await orga('GET', '/groups/g_nope/invite')).body.error).toBe('not_found');
    expect((await orga('POST', '/groups/g_nope/rotate')).status).toBe(404);
    expect((await orga('PATCH', '/groups/g_nope', { name: 'X' })).status).toBe(404);
    expect((await orga('DELETE', '/groups/g_nope')).status).toBe(404);
  });

  it('rotates the token and invalidates the old one', async () => {
    const g = await newGroup('A');
    const r = await orga('POST', `/groups/${g.id}/rotate`);
    expect(r.status).toBe(200);
    expect(r.body.token).not.toBe(g.token);
    expect((await call('GET', '/api/groups/me', { token: g.token })).status).toBe(401);
    expect((await call('GET', '/api/groups/me', { token: r.body.token })).status).toBe(200);
    expect((await orga('GET', `/groups/${g.id}/invite`)).body.token).toBe(r.body.token);
  });

  it('renames with the creation rules', async () => {
    const a = await newGroup('A');
    await newGroup('B');
    const ok = await orga('PATCH', `/groups/${a.id}`, { name: ' Neu ' });
    expect(ok.body).toEqual({ id: a.id, name: 'Neu' });
    expect((await call('GET', '/api/groups/me', { token: a.token })).body.name).toBe('Neu');
    expect((await orga('PATCH', `/groups/${a.id}`, { name: 'neu' })).status).toBe(200);
    const dup = await orga('PATCH', `/groups/${a.id}`, { name: 'b' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('name_taken');
    expect((await orga('PATCH', `/groups/${a.id}`, { name: ' ' })).status).toBe(400);
    expect((await orga('PATCH', `/groups/${a.id}`, { name: 'x'.repeat(41) })).status).toBe(400);
  });

  it('deletes softly: releases the reservation, keeps cleaned rows and notes, frees the name', async () => {
    const a = await newGroup('A');
    await call('POST', '/api/locations/loc1/clean', { token: a.token });
    await call('PUT', '/api/locations/loc1/note', { token: a.token, body: { text: 'Hallo' } });
    await call('POST', '/api/locations/loc2/reserve', { token: a.token });
    const d = await handle(
      new Request(`https://x.test/api/orga/groups/${a.id}`, { method: 'DELETE', headers: { 'x-organizer-code': CODE } }),
      env,
    );
    expect(d.status).toBe(204);
    expect((await call('GET', '/api/groups/me', { token: a.token })).status).toBe(401);
    expect((await call('POST', '/api/locations/loc2/reserve', { token: a.token })).status).toBe(401);
    const s = (await call('GET', '/api/state')).body;
    expect(s.groups).toEqual([]);
    expect(s.locations.loc2).toBeUndefined();
    expect(s.locations.loc1).toMatchObject({ status: 'cleaned', groupName: 'A (gelöscht)', note: 'Hallo' });
    expect((await orga('GET', '/groups')).body.groups).toEqual([]);
    expect((await orga('GET', `/groups/${a.id}/invite`)).status).toBe(404);
    expect((await orga('DELETE', `/groups/${a.id}`)).status).toBe(404);
    expect((await call('POST', '/api/groups', { code: CODE, body: { name: 'a' } })).status).toBe(201);
  });

  it('heals the token hash of a legacy group on invite', async () => {
    const legacy = 'legacy-random-token';
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacy)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await env.DB.prepare('INSERT INTO groups (id, name, name_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('g_old', 'Alt', 'alt', hash, t)
      .run();
    expect((await call('GET', '/api/groups/me', { token: legacy })).status).toBe(200);
    const i = await orga('GET', '/groups/g_old/invite');
    expect(i.status).toBe(200);
    expect(i.body.token).not.toBe(legacy);
    expect((await call('GET', '/api/groups/me', { token: legacy })).status).toBe(401);
    expect((await call('GET', '/api/groups/me', { token: i.body.token })).body).toEqual({ id: 'g_old', name: 'Alt' });
  });
});

describe('presence', () => {
  const pos = { deviceId: 'device-aaaa1111', lat: 48.8, lon: 9.2, accuracy: 12 };

  it('requires auth to read and write', async () => {
    expect((await call('GET', '/api/presence')).status).toBe(401);
    expect((await call('GET', '/api/presence', { token: 'wrong' })).status).toBe(401);
    expect((await call('GET', '/api/presence', { code: 'nope' })).status).toBe(401);
    expect((await call('PUT', '/api/presence', { body: pos })).status).toBe(401);
    expect((await call('DELETE', '/api/presence/device-aaaa1111')).status).toBe(401);
  });

  it('stores the latest position and reads it back with token or organizer code', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    expect((await call('PUT', '/api/presence', { token: a.token, body: pos })).status).toBe(204);
    await call('PUT', '/api/presence', { token: a.token, body: { ...pos, lat: 48.9 } });
    const r = await call('GET', '/api/presence', { token: b.token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      now: t,
      people: [{ deviceId: pos.deviceId, groupId: a.id, groupName: 'A', lat: 48.9, lon: 9.2, accuracy: 12, updatedAt: t }],
    });
    expect((await call('GET', '/api/presence', { code: CODE })).body.people).toHaveLength(1);
  });

  it('moves a device to the group that sends it', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('PUT', '/api/presence', { token: a.token, body: pos });
    await call('PUT', '/api/presence', { token: b.token, body: pos });
    const people = (await call('GET', '/api/presence', { code: CODE })).body.people;
    expect(people.map((p: any) => p.groupId)).toEqual([b.id]);
  });

  it('ignores positions older than 10 minutes and deletes them on the next write', async () => {
    const a = await newGroup('A');
    await call('PUT', '/api/presence', { token: a.token, body: pos });
    t += PRESENCE_MS - 1;
    expect((await call('GET', '/api/presence', { token: a.token })).body.people).toHaveLength(1);
    t += 1;
    expect((await call('GET', '/api/presence', { token: a.token })).body.people).toEqual([]);
    const row = () => env.DB.prepare('SELECT COUNT(*) AS n FROM presence').first<{ n: number }>();
    expect((await row())?.n).toBe(1);
    await call('PUT', '/api/presence', { token: a.token, body: { ...pos, deviceId: 'device-bbbb2222' } });
    expect((await row())?.n).toBe(1);
  });

  it('deletes only the own group row', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('PUT', '/api/presence', { token: a.token, body: pos });
    expect((await call('DELETE', `/api/presence/${pos.deviceId}`, { token: b.token })).status).toBe(204);
    expect((await call('GET', '/api/presence', { code: CODE })).body.people).toHaveLength(1);
    expect((await call('DELETE', `/api/presence/${pos.deviceId}`, { token: a.token })).status).toBe(204);
    expect((await call('GET', '/api/presence', { code: CODE })).body.people).toEqual([]);
  });

  it('drops presence when the group is deleted or its link rotated', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    await call('PUT', '/api/presence', { token: a.token, body: pos });
    await call('PUT', '/api/presence', { token: b.token, body: { ...pos, deviceId: 'device-bbbb2222' } });
    await orga('POST', `/groups/${b.id}/rotate`);
    expect((await call('GET', '/api/presence', { code: CODE })).body.people.map((p: any) => p.groupId)).toEqual([a.id]);
    await handle(
      new Request(`https://x.test/api/orga/groups/${a.id}`, { method: 'DELETE', headers: { 'x-organizer-code': CODE } }),
      env,
    );
    expect((await call('GET', '/api/presence', { code: CODE })).body.people).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM presence').first<{ n: number }>())?.n).toBe(0);
  });

  it('rejects an invalid body and caps absurd accuracy', async () => {
    const a = await newGroup('A');
    const bad = [
      { ...pos, deviceId: 'short' },
      { ...pos, deviceId: 'has spaces here' },
      { ...pos, deviceId: 'x'.repeat(65) },
      { ...pos, lat: 91 },
      { ...pos, lon: -181 },
      { ...pos, lat: '48' },
      { ...pos, lat: null },
      { ...pos, accuracy: -1 },
      { ...pos, accuracy: 'x' },
      { deviceId: pos.deviceId },
    ];
    for (const body of bad) expect((await call('PUT', '/api/presence', { token: a.token, body })).status).toBe(400);
    await call('PUT', '/api/presence', { token: a.token, body: { ...pos, accuracy: 1e9 } });
    expect((await call('GET', '/api/presence', { token: a.token })).body.people[0].accuracy).toBe(10000);
  });
});
