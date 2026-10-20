import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddonDefinition } from '../shared/addons.js';
import { createTestModule } from '../server/addons/testing.js';
import demoAddon from './helpers/demo-addon/index.js';

const demo = demoAddon as unknown as AddonDefinition;

test('createTestModule : source, réseau simulé, contrat vérifié en une ligne', async (t) => {
  const f = createTestModule(t, demo, {
    routes: { '/parkings/demo': { name: 'Gare', available: 4 } },
  });
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok && result.card.primaryValue, '4 places');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]?.url, 'https://parking.example.invalid/parkings/demo');
  assert.equal(f.ambient().content?.value, '4 places');
});

test('createTestModule : horloge, nouvelles réponses, réglages, réponse absente', async (t) => {
  const f = createTestModule(t, demo, {
    at: '2026-09-22T10:00:00Z',
    routes: { '/parkings/': { name: 'Gare', available: 4 } },
  });
  await f.read();
  f.route({ '/parkings/': { status: 503 } });
  f.advance(60_001);
  const stale = await f.read();
  assert.equal(stale.ok && stale.stale, true);
  assert.equal(f.now(), Date.parse('2026-09-22T10:01:00.001Z'));
  f.configure({ parkingId: 'absent' });
  f.route((request) => (request.url.endsWith('/absent') ? { status: 404 } : 'inutile'));
  const missing = await f.read();
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');
  assert.match(f.contract(missing).join(' '), /lecture en échec/u);
});

test('createTestModule : un écart au contrat est nommé', async (t) => {
  const broken: AddonDefinition = {
    ...demo,
    present(snapshot, context) {
      return { ...demo.present(snapshot, context), title: 'Parking '.repeat(20) };
    },
  };
  const f = createTestModule(t, broken, {
    routes: { '/parkings/': { name: 'Gare', available: 4 } },
  });
  const result = await f.read();
  // La carte trop longue est refusée par le cœur : la lecture échoue, et le contrôle le dit.
  assert.equal(result.ok, false);
  assert.notDeepEqual(f.contract(result), []);
});
