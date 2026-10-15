import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import OpenAI from 'openai';
import { createApp } from '../server/app.js';
import { ImageGeneration } from '../server/image-generation.js';
import {
  createOpenAIImageCreator,
  openAIImageError,
  type OpenAIImageRequest,
} from '../server/openai-images.js';
import { openDatabase } from '../server/storage.js';
import { validators } from '../shared/validation.js';

const scope = { interactionId: 'interaction', profileEpoch: 1, contextVersion: 2 };
const webp = Buffer.from('RIFF0000WEBPimage-openai-de-test');

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-openai-images-'));
  const requests: OpenAIImageRequest[] = [];
  const access = { key: true, blocked: false };
  let respond: (request: OpenAIImageRequest) => Promise<Buffer> = async () => webp;
  const generation = new ImageGeneration(db, true, () => {}, undefined, Date.now, directory);
  generation.useOpenAI({
    creator: () =>
      access.key
        ? (request) => {
            requests.push(request);
            return respond(request);
          }
        : null,
    blocked: () => access.blocked,
  });
  t.after(() => {
    generation.dispose();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const create = (prompt: string, signal = new AbortController().signal, automatic = false) =>
    generation.generate(scope, { prompt, seed: null }, signal, automatic);
  return {
    db,
    directory,
    generation,
    requests,
    access,
    create,
    respond: (next: typeof respond) => (respond = next),
  };
}

test('avec OpenAI, l’image est créée sans générateur local, avec le modèle et la qualité choisis', async (t) => {
  const f = fixture(t);
  f.generation.setEnabled(true);
  assert.equal(f.generation.snapshot().provider, 'local');
  f.generation.setProvider('openai');
  f.generation.setOpenAIModel('gpt-image-2.5-sunburst');
  f.generation.setOpenAIQuality('medium');
  assert.equal(f.generation.snapshot().openaiUnavailable, null);
  assert.match(String(f.generation.tools()[0]?.description), /avec OpenAI/);

  const result = await f.create('  Un phare dans la brume  ');
  assert.equal(result.tool.status, 'succeeded', result.tool.summary);
  assert.equal(result.card?.model, 'gpt-image-2.5-sunburst');
  assert.equal(result.card?.width, 1024);
  // La carte passe le contrôle du miroir, sinon elle n’est jamais affichée.
  assert.ok(validators.imageCard(result.card), JSON.stringify(validators.imageCard.errors));
  assert.equal(f.requests[0]?.prompt, 'Un phare dans la brume');
  assert.equal(f.requests[0]?.model, 'gpt-image-2.5-sunburst');
  assert.equal(f.requests[0]?.quality, 'medium');
  const file = f.generation.generatedFile(result.tool.snapshotId!);
  assert.ok(file);
  assert.deepEqual(readFileSync(file), webp);
  // L’image reste réaffichable comme une image locale.
  assert.equal(f.generation.recall({ position: 1, search: null }, null).tool.status, 'succeeded');

  const reloaded = new ImageGeneration(f.db, true, () => {}, undefined, Date.now, f.directory);
  assert.equal(reloaded.snapshot().provider, 'openai');
  assert.equal(reloaded.snapshot().openaiModel, 'gpt-image-2.5-sunburst');
  assert.equal(reloaded.snapshot().openaiQuality, 'medium');
  reloaded.dispose();
});

test('avec OpenAI, une clé absente ou des connexions bloquées empêchent la création', async (t) => {
  const f = fixture(t);
  f.generation.setEnabled(true);
  f.generation.setProvider('openai');
  f.generation.setIllustrateCards(true);
  assert.equal(f.generation.canIllustrateCards(), true);
  f.access.key = false;
  assert.match(f.generation.snapshot().openaiUnavailable ?? '', /Clé OpenAI absente/);
  assert.equal(f.generation.canIllustrateCards(), false);
  assert.match((await f.create('Un chat')).tool.summary, /Clé OpenAI absente/);
  f.access.key = true;
  f.access.blocked = true;
  assert.match((await f.create('Un chat')).tool.summary, /bloquées/);
  assert.equal(f.requests.length, 0);
});

test('avec OpenAI, une nouvelle demande coupe la requête en cours ; une erreur est expliquée', async (t) => {
  const f = fixture(t);
  f.generation.setEnabled(true);
  f.generation.setProvider('openai');
  const signals: AbortSignal[] = [];
  f.respond(
    (request) =>
      new Promise((_resolve, reject) => {
        signals.push(request.signal);
        request.signal.addEventListener('abort', () => reject(new OpenAI.APIUserAbortError()));
      }),
  );
  const first = f.create('Une forêt');
  await new Promise((resolve) => setImmediate(resolve));
  f.respond(async () => {
    throw OpenAI.APIError.generate(
      403,
      { error: { message: 'Your organization must be verified' } },
      undefined,
      new Headers(),
    );
  });
  const second = await f.create('Une montagne');
  assert.equal(signals[0]?.aborted, true);
  assert.match((await first).tool.summary, /remplacée/);
  assert.equal(second.tool.status, 'failed');
  assert.match(second.tool.summary, /vérifiée/);
  assert.equal(f.generation.snapshot().busy, false);
});

test('messages d’erreur OpenAI lisibles', () => {
  const error = (status: number, body: Record<string, unknown>) =>
    OpenAI.APIError.generate(status, { error: body }, undefined, new Headers());
  assert.match(openAIImageError(error(401, { message: 'bad key' })), /Clé OpenAI refusée/);
  assert.match(openAIImageError(error(429, { message: 'quota' })), /crédit/);
  assert.match(
    openAIImageError(error(400, { message: 'blocked', code: 'moderation_blocked' })),
    /filtre de sécurité/,
  );
  assert.match(openAIImageError(error(500, { message: 'oops' })), /erreur 500/);
  assert.match(openAIImageError(new OpenAI.APIUserAbortError()), /annulée/);
});

test('la requête envoyée à l’API d’images d’OpenAI', async () => {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response(
      JSON.stringify({ created: 1, data: [{ b64_json: webp.toString('base64') }] }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
  const creator = createOpenAIImageCreator('sk-test-images', fetch);
  const image = await creator({
    prompt: 'Un phare',
    model: 'gpt-image-2.5-flare',
    quality: 'low',
    signal: new AbortController().signal,
  });
  assert.deepEqual(image, webp);
  assert.match(calls[0]!.url, /\/images\/generations$/);
  assert.equal(calls[0]!.auth, 'Bearer sk-test-images');
  assert.deepEqual(calls[0]!.body, {
    model: 'gpt-image-2.5-flare',
    prompt: 'Un phare',
    n: 1,
    size: '1024x1024',
    quality: 'low',
    output_format: 'webp',
    output_compression: 85,
  });
});

test('l’administration choisit OpenAI pour les images, avec des réglages vérifiés', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-openai-images-app-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const keys: string[] = [];
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: 'mot-de-passe-images',
      origins: ['http://localhost'],
      secureCookies: false,
      openaiKey: 'sk-test-0123456789',
    },
    {
      timers: false,
      imageGenerationRoot: directory,
      openaiImageCreator: (key) => {
        keys.push(key);
        return async () => webp;
      },
    },
  );
  await services.app.ready();
  t.after(() => services.app.close());
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'mot-de-passe-images' },
  });
  const cookie = login.cookies.find((entry) => entry.name === 'cornelius_admin')!;
  const headers = { origin: 'http://localhost', cookie: `${cookie.name}=${cookie.value}` };
  const patch = (payload: Record<string, unknown>) =>
    services.app.inject({ method: 'PATCH', url: '/api/admin/image-generation', headers, payload });
  assert.equal((await patch({ provider: 'nuage' })).statusCode, 400);
  assert.equal((await patch({ openaiModel: 'dall-e-3' })).statusCode, 400);
  assert.equal((await patch({ openaiQuality: 'max' })).statusCode, 400);
  const saved = await patch({
    provider: 'openai',
    openaiModel: 'gpt-image-1-mini',
    openaiQuality: 'high',
    enabled: true,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const status = saved.json();
  assert.equal(status.provider, 'openai');
  assert.equal(status.openaiModel, 'gpt-image-1-mini');
  assert.equal(status.openaiQuality, 'high');
  assert.equal(status.openaiUnavailable, null);
  assert.deepEqual(keys, ['sk-test-0123456789']);
  // La clé ne revient jamais dans la réponse.
  assert.doesNotMatch(saved.body, /sk-test/);
});
