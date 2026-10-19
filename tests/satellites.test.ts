import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { openDatabase, ProfileRepository } from '../server/storage.js';
import { SatelliteStore } from '../server/satellites-store.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';
const perceptionToken = 'p'.repeat(40);

async function fixture(t: TestContext) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-satellites-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'test-key',
      perceptionToken,
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
    },
    { timers: false, imageGenerationRoot: imageRoot },
  );
  await services.app.ready();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await setImmediate();
    await services.app.close();
    rmdirSync(imageRoot);
  });
  async function admin() {
    const response = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin },
      payload: { password },
    });
    const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
    return `${entry.name}=${entry.value}`;
  }
  /** Messages reçus par une connexion, texte décodé ou trame binaire. */
  function inbox(socket: WebSocket) {
    const received: unknown[] = [];
    const waiters: (() => void)[] = [];
    socket.on('message', (data, binary) => {
      received.push(binary ? Buffer.from(data as Buffer) : JSON.parse(String(data)));
      for (const wake of waiters.splice(0)) wake();
    });
    return {
      received,
      async next(predicate: (message: any) => boolean): Promise<any> {
        const deadline = Date.now() + 2000;
        for (;;) {
          const found = received.find(predicate);
          if (found !== undefined) return found;
          if (Date.now() > deadline) throw new Error('Message attendu non reçu.');
          await new Promise<void>((resolve) => {
            waiters.push(resolve);
            setTimeout(resolve, 50);
          });
        }
      },
    };
  }
  async function satellite(token: string) {
    const socket = await services.app.injectWS('/satellite', {
      headers: { host: 'localhost', authorization: 'Bearer ' + token },
    });
    sockets.push(socket);
    return { socket, ...inbox(socket) };
  }
  async function perception() {
    const socket = await services.app.injectWS('/perception', {
      headers: { host: 'localhost', origin, authorization: 'Bearer ' + perceptionToken },
    });
    sockets.push(socket);
    return { socket, ...inbox(socket) };
  }
  return { ...services, admin, satellite, perception };
}

test('registre : jeton montré une fois, empreinte seule gardée, révocation', () => {
  const db = openDatabase(':memory:');
  const profiles = new ProfileRepository(db);
  const store = new SatelliteStore(db, () => 1000);
  const { satellite, token } = store.create('Chambre');
  assert.deepEqual(satellite, {
    id: satellite.id,
    name: 'Chambre',
    profileId: null,
    volume: 70,
    createdAt: 1000,
    lastSeenAt: null,
  });
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM satellites').all()).includes(token), false);
  assert.equal(store.authenticate(token)?.id, satellite.id);
  assert.equal(store.authenticate(token + 'x'), null);
  assert.equal(store.authenticate(''), null);
  const renewed = store.renewToken(satellite.id)!;
  assert.equal(store.authenticate(token), null);
  assert.equal(store.authenticate(renewed)?.id, satellite.id);
  // Un profil supprimé détache le satellite sans le supprimer.
  const profile = profiles.create('Léa');
  store.update(satellite.id, { profileId: profile.id, volume: 40 });
  assert.equal(store.get(satellite.id)?.profileId, profile.id);
  profiles.delete(profile.id);
  assert.deepEqual(
    [store.get(satellite.id)?.profileId, store.get(satellite.id)?.volume],
    [null, 40],
  );
  assert.equal(store.remove(satellite.id), true);
  assert.equal(store.authenticate(renewed), null);
  db.close();
});

test('administration des satellites : réservée, validée, jeton renouvelable', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject('/api/admin/satellites')).statusCode, 401);
  const cookie = await f.admin();
  const headers = { cookie, origin };
  const invalid = await f.app.inject({
    method: 'POST',
    url: '/api/admin/satellites',
    headers,
    payload: { name: '   ' },
  });
  assert.equal(invalid.statusCode, 400);
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/admin/satellites',
    headers,
    payload: { name: ' Cuisine ' },
  });
  assert.equal(created.statusCode, 200, created.body);
  const { satellite, token } = created.json();
  assert.equal(satellite.name, 'Cuisine');
  assert.equal(satellite.online, false);
  assert.equal(typeof token, 'string');
  const listed = await f.app.inject({ url: '/api/admin/satellites', headers });
  assert.equal(listed.body.includes(token), false);
  const unknownProfile = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
    payload: { profileId: 'absent' },
  });
  assert.equal(unknownProfile.statusCode, 400);
  const changed = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
    payload: { volume: 35 },
  });
  assert.equal(changed.json().satellite.volume, 35);
  const renewed = await f.app.inject({
    method: 'POST',
    url: `/api/admin/satellites/${satellite.id}/token`,
    headers,
  });
  assert.notEqual(renewed.json().token, token);
  await assert.rejects(f.satellite(token), /403/u);
  const removed = await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
  });
  assert.equal(removed.statusCode, 200);
  await assert.rejects(f.satellite(renewed.json().token), /403/u);
});

test('connexion : hello obligatoire et protocole vérifié', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.satellite('inconnu'), /403/u);
  const cookie = await f.admin();
  const { token } = (
    await f.app.inject({
      method: 'POST',
      url: '/api/admin/satellites',
      headers: { cookie, origin },
      payload: { name: 'Salon' },
    })
  ).json();
  const early = await f.satellite(token);
  early.socket.send(Buffer.alloc(2560));
  const [code] = await once(early.socket, 'close');
  assert.equal(code, 1008);
  const future = await f.satellite(token);
  future.socket.send(JSON.stringify({ type: 'hello', protocol: 99, firmware: '9.0.0' }));
  const [, reason] = await once(future.socket, 'close');
  assert.match(String(reason), /Protocole/u);
});

test('veille : le son suit « listen », la détection revient au satellite', async (t) => {
  const f = await fixture(t);
  const cookie = await f.admin();
  const { token, satellite } = (
    await f.app.inject({
      method: 'POST',
      url: '/api/admin/satellites',
      headers: { cookie, origin },
      payload: { name: 'Bureau' },
    })
  ).json();
  const worker = await f.perception();
  worker.socket.send(JSON.stringify({ type: 'wake_status', ready: true, detail: null }));
  await setImmediate();
  const device = await f.satellite(token);
  device.socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.1.0' }));
  const welcome = await device.next((message) => message.type === 'welcome');
  assert.deepEqual(welcome, {
    type: 'welcome',
    protocol: 1,
    id: satellite.id,
    name: 'Bureau',
    volume: 70,
  });
  // Mot d’appel désactivé : le satellite n’envoie rien.
  assert.deepEqual(await device.next((message) => message.type === 'listen'), {
    type: 'listen',
    enabled: false,
  });
  f.controller.setWakeWordEnabled(true);
  await device.next((message) => message.type === 'listen' && message.enabled);
  const start = await worker.next((message) => message.type === 'wake_start');
  device.socket.send(Buffer.alloc(2560, 1));
  const frame: Buffer = await worker.next((message) => Buffer.isBuffer(message));
  assert.deepEqual([frame.length, frame[0], frame[1]], [2562, 0x57, start.slot]);
  worker.socket.send(
    JSON.stringify({ type: 'wake_detected', streamId: start.streamId, score: 0.873 }),
  );
  assert.deepEqual(await device.next((message) => message.type === 'wake'), {
    type: 'wake',
    score: 0.87,
  });
  const listed = await f.app.inject({
    url: '/api/admin/satellites',
    headers: { cookie, origin },
  });
  assert.deepEqual(
    [listed.json().satellites[0].online, listed.json().satellites[0].firmware],
    [true, '0.1.0'],
  );
  // Micro coupé : plus aucune trame n’atteint la perception.
  device.socket.send(JSON.stringify({ type: 'mic', muted: true }));
  await setImmediate();
  const before = worker.received.filter(Buffer.isBuffer).length;
  device.socket.send(Buffer.alloc(2560, 1));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(worker.received.filter(Buffer.isBuffer).length, before);
  device.socket.terminate();
  await worker.next((message) => message.type === 'wake_end');
});
