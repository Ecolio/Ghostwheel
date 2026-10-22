import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import { imageType, titleFromName } from '../server/screensaver.js';
import { screensaverCollection } from '../server/screensaver-collection.js';
import {
  DEFAULT_SCREENSAVER,
  isScreensaverSettings,
  type ScreensaverView,
} from '../shared/screensaver.js';
import type { StateEvent } from '../shared/types.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';
/** Plus petit en-tête JPEG reconnu : le serveur ne décode jamais l’image. */
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);

async function fixture(t: TestContext, fetcher?: typeof fetch) {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-screensaver-test-'));
  const images = mkdtempSync(join(tmpdir(), 'cornelius-screensaver-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'test-key',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
    },
    {
      timers: false,
      imageGenerationRoot: images,
      screensaverRoot: root,
      screensaverFetch: fetcher,
      modelLauncher: () =>
        spawn(
          process.execPath,
          ['-e', 'process.stdout.write(JSON.stringify({state:"ready"})+"\\n")'],
          { windowsHide: true },
        ),
    },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(images, { recursive: true, force: true });
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  const cookie = login.cookies.find((entry) => entry.name === 'cornelius_admin');
  assert.ok(cookie);
  const headers = { origin, cookie: `${cookie.name}=${cookie.value}` };
  const state = async () =>
    (await services.app.inject({ url: '/api/state' })).json<StateEvent>().state;
  return { ...services, root, headers, state };
}

test('formats reconnus aux premiers octets, réglages bornés', () => {
  assert.equal(imageType(jpeg), 'image/jpeg');
  assert.equal(imageType(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'image/png');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(titleFromName('vacances-2024_plage.JPG'), 'vacances 2024 plage');
  assert.ok(isScreensaverSettings(DEFAULT_SCREENSAVER));
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, intervalMs: 1000 }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, returnDelayMs: -1 }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, extra: true }), false);
});

test('écran de veille : réglages diffusés au miroir, images envoyées puis retirées', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.state()).screensaver, {
    ...DEFAULT_SCREENSAVER,
    imageCount: 0,
    revision: '',
  });
  const settings = { enabled: true, intervalMs: 60_000, returnDelayMs: 5_000 };
  const patch = (payload: Record<string, unknown>) =>
    f.app.inject({ method: 'PATCH', url: '/api/admin/screensaver', headers: f.headers, payload });
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url: '/api/admin/screensaver', payload: settings }))
      .statusCode,
    403,
    'sans origine',
  );
  assert.equal((await patch({ ...settings, intervalMs: 5 })).statusCode, 400);
  const saved = await patch(settings);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json<StateEvent>().state.screensaver?.enabled, true);

  const upload = (body: Buffer, type: string, name = encodeURIComponent('Plage d’été.jpg')) =>
    f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/images',
      headers: { ...f.headers, 'content-type': type, 'x-file-name': name },
      payload: body,
    });
  assert.equal((await upload(Buffer.from('<svg/>          '), 'image/png')).statusCode, 415);
  const wrongType = await upload(jpeg, 'text/plain');
  // Un autre type que JPEG, PNG ou WebP n’atteint jamais la bibliothèque.
  assert.ok(wrongType.statusCode >= 400, wrongType.body);
  assert.deepEqual(readdirSync(f.root), []);
  const added = await upload(jpeg, 'image/jpeg');
  assert.equal(added.statusCode, 200, added.body);
  const [image] = added.json<ScreensaverView>().images;
  assert.ok(image);
  assert.equal(image.title, 'Plage d’été');
  assert.equal(image.origin, 'upload');
  const state = await f.state();
  assert.equal(state.screensaver?.imageCount, 1);
  assert.notEqual(state.screensaver?.revision, '');

  // Le miroir lit la liste et le fichier ; l’envoi reste réservé à l’administration.
  const list = await f.app.inject({ url: '/api/screensaver' });
  assert.deepEqual(list.json().images, [image]);
  const file = await f.app.inject({ url: image.url });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.deepEqual(file.rawPayload, jpeg);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/screensaver/images',
        headers: { origin, 'content-type': 'image/jpeg' },
        payload: jpeg,
      })
    ).statusCode,
    401,
  );

  const removed = await f.app.inject({
    method: 'DELETE',
    url: `/api/admin/screensaver/images/${image.id}`,
    headers: f.headers,
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json<ScreensaverView>().images, []);
  assert.deepEqual(readdirSync(f.root), []);
  assert.equal((await f.app.inject({ url: image.url })).statusCode, 404);
  assert.equal((await f.state()).screensaver?.imageCount, 0);
});

test('collection : peintures téléchargées une fois, échecs signalés', async (t) => {
  const asked: string[] = [];
  let failing = true;
  const fetcher = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (failing && asked.length === 1) return new Response('absent', { status: 404 });
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const f = await fixture(t, fetcher);
  const install = async () => {
    const started = await f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/collection',
      headers: f.headers,
      payload: {},
    });
    assert.equal(started.statusCode, 200, started.body);
    for (let wait = 0; wait < 100; wait++) {
      const view = (
        await f.app.inject({ url: '/api/admin/screensaver', headers: f.headers })
      ).json<ScreensaverView>();
      if (!view.collection.downloading) return view;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Téléchargement sans fin.');
  };
  const first = await install();
  const total = screensaverCollection.length;
  assert.equal(first.collection.installed, total - 1);
  assert.match(first.collection.error ?? '', /Une peinture/u);
  assert.ok(asked.every((url) => url.startsWith('https://commons.wikimedia.org/')));
  assert.ok(first.images.every((image) => image.origin === 'collection' && image.credit));

  failing = false;
  const second = await install();
  assert.equal(second.collection.installed, total);
  assert.equal(second.collection.error, null);
  assert.equal(asked.length, total + 1, 'seule la peinture manquante est redemandée');
  assert.equal((await f.state()).screensaver?.imageCount, total);
});
