import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openDatabase, ProfileRepository } from '../server/storage.js';
import { AgentRepository } from '../server/agents-store.js';
import { Agents } from '../server/agents.js';
import { HermesClient } from '../server/hermes-client.js';
import { createHttpClient } from '../server/addons/http.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { fakeHermes } from './helpers/hermes.js';
async function fixture(t: TestContext, now = Date.now) {
  const fake = await fakeHermes(),
    db = openDatabase(':memory:');
  const profiles = new ProfileRepository(db),
    alice = profiles.create('Alice'),
    bob = profiles.create('Bob');
  const repo = new AgentRepository(db, now),
    client = new HermesClient(createHttpClient(), now),
    agents = new Agents(repo, client, now);
  t.after(async () => {
    await agents.dispose();
    db.close();
    await fake.close();
  });
  await agents.configure(alice.id, {
    url: fake.url,
    token: fake.token,
    enabled: true,
    description: 'Mon assistant personnel',
    revision: 0,
  });
  const input = (profileId: string | null = alice.id, callId = randomUUID()) => ({
    profileId,
    callId,
    scope: { interactionId: 'interaction-alice', profileEpoch: 1, contextVersion: 1 },
    signal: new AbortController().signal,
  });
  const start = async (message = 'Recherche privée Alice') => {
    const result = await agents.run(input(), 'agents__start', { message });
    return { result, id: String(result.result?.taskId) };
  };
  return { fake, db, profiles, alice, bob, repo, client, agents, input, start };
}
test('Hermes : découverte filtrée et capacités réelles transmises à Luna', async (t) => {
  const f = await fixture(t),
    view = f.agents.admin(f.alice.id);
  assert.equal(view.connection.discovery?.available, true);
  assert.deepEqual(
    view.connection.discovery?.capabilities.map((c) => c.name),
    ['agenda', 'weekend'],
  );
  const tools = f.agents.tools(f.alice.id),
    description = tools.find((t) => t.name === 'agents__start')!.description;
  assert.match(description, /calendar_create/);
  assert.match(description, /weekend/);
  assert.doesNotMatch(description, /mail_send|disabled-skill|hermes-fixture-secret/);
  assert.deepEqual(f.agents.tools(f.bob.id), []);
  assert.deepEqual(f.agents.tools(null), []);
  const config = liveConfiguration(tools);
  assert.match(config.instructions ?? '', /Agent personnel/);
  assert.match(
    config.delegation?.type === 'responses' ? (config.delegation.responses.instructions ?? '') : '',
    /catalogue/,
  );
  assert.ok(!JSON.stringify(view).includes(f.fake.token));
  assert.equal(f.fake.calls.filter((c) => c.method === 'POST').length, 0);
});
test('Hermes : catalogue partiel et refus de connexion ne deviennent pas de fausses capacités', async (t) => {
  const f = await fixture(t);
  f.fake.options.failCatalog = true;
  await f.agents.discover(f.alice.id);
  assert.equal(f.agents.admin(f.alice.id).connection.discovery?.catalogComplete, false);
  assert.deepEqual(
    f.agents.admin(f.alice.id).connection.discovery?.capabilities.map((c) => c.name),
    ['weekend'],
  );
  f.fake.options.unsupported = true;
  await f.agents.discover(f.alice.id);
  assert.equal(f.agents.admin(f.alice.id).connection.discovery?.available, false);
  const { result } = await f.start();
  assert.equal(result.status, 'failed');
  assert.equal(f.fake.runs.size, 0);
});
test('Hermes : tâches isolées, validation locale et identifiants non choisis par le modèle', async (t) => {
  const f = await fixture(t),
    { id } = await f.start();
  await f.agents.configure(f.bob.id, {
    url: f.fake.url + '/p/bob',
    token: f.fake.token,
    enabled: true,
    description: 'Agent Bob',
    revision: 0,
  });
  const before = f.fake.calls.length;
  assert.equal(
    (await f.agents.run(f.input(f.bob.id), 'agents__status', { taskId: id })).status,
    'failed',
  );
  assert.equal(
    (await f.agents.run(f.input(null), 'agents__start', { message: 'test' })).status,
    'failed',
  );
  assert.equal(
    (await f.agents.run(f.input(), 'agents__start', { message: 'test', profileId: f.bob.id }))
      .status,
    'failed',
  );
  assert.equal(
    (await f.agents.run(f.input(), 'agents__start', { message: '   ' })).status,
    'failed',
  );
  assert.equal(
    (await f.agents.run(f.input(), 'agents__status', { taskId: '../secret' })).status,
    'failed',
  );
  assert.equal(f.fake.calls.length, before);
  const sent = f.fake.calls.find((c) => c.path === '/v1/runs' && c.method === 'POST')!;
  assert.match(String(sent.body.session_id), /^cornelius-/);
  assert.ok(sent.key);
  assert.equal(sent.body.profileId, undefined);
});
test('Hermes : déduplication, continuité après départ et résultat accessible au retour', async (t) => {
  const f = await fixture(t),
    input = f.input();
  const first = await f.agents.run(input, 'agents__start', { message: 'Ma demande' });
  const id = String(first.result?.taskId),
    stored = f.repo.find(id)!;
  await f.agents.run(input, 'agents__start', { message: 'Ma demande' });
  assert.equal(f.fake.runs.size, 1);
  const run = f.fake.runs.get(stored.runId!)!;
  run.status = 'completed';
  run.output = 'Trois sorties possibles.';
  await f.agents.refreshAdmin(f.alice.id);
  assert.equal(f.agents.pendingDelivery(f.bob.id), null);
  const delivery = f.agents.pendingDelivery(f.alice.id)!;
  assert.equal(delivery.output, 'Trois sorties possibles.');
  f.agents.markDelivered(delivery);
  assert.equal(f.agents.pendingDelivery(f.alice.id), null);
  assert.equal(
    f.fake.calls.some((c) => c.path.endsWith('/stop')),
    false,
  );
  const rows = JSON.stringify(f.db.prepare('SELECT * FROM agent_tasks').all());
  assert.doesNotMatch(rows, /Ma demande|Trois sorties/);
  const reply = await f.agents.run(f.input(), 'agents__reply', {
    taskId: id,
    message: 'Développe la deuxième',
  });
  assert.equal(reply.status, 'succeeded');
  const starts = f.fake.calls.filter((c) => c.path === '/v1/runs' && c.method === 'POST');
  assert.equal(starts[0]!.body.session_id, starts[1]!.body.session_id);
});
test('Hermes : POST incertain conservé sans répétition automatique, même après redémarrage', async (t) => {
  const f = await fixture(t);
  f.fake.options.failPost = true;
  const input = f.input();
  assert.equal(
    (await f.agents.run(input, 'agents__start', { message: 'Action peut-être envoyée' })).status,
    'failed',
  );
  assert.equal(f.repo.tasks(f.alice.id)[0]!.status, 'unknown');
  await f.agents.run(input, 'agents__start', { message: 'Action peut-être envoyée' });
  assert.equal(f.fake.runs.size, 1);
  await f.agents.dispose();
  const restarted = new Agents(f.repo, f.client);
  t.after(() => restarted.dispose());
  await restarted.refreshAdmin(f.alice.id);
  assert.equal(f.fake.runs.size, 1);
  assert.equal(restarted.admin(f.alice.id).tasks[0]!.status, 'unknown');
});
test('Hermes : redémarrer Cornelius retrouve une tâche distante sans recréer son exécution', async (t) => {
  const f = await fixture(t),
    { id } = await f.start(),
    stored = f.repo.find(id)!;
  await f.agents.dispose();
  const run = f.fake.runs.get(stored.runId!)!;
  run.status = 'completed';
  run.output = 'Terminé pendant votre absence.';
  const restarted = new Agents(f.repo, f.client);
  t.after(() => restarted.dispose());
  await restarted.refreshAdmin(f.alice.id);
  assert.equal(restarted.admin(f.alice.id).tasks[0]!.output, 'Terminé pendant votre absence.');
  assert.equal(f.fake.runs.size, 1);
  restarted.markDelivered(restarted.admin(f.alice.id).tasks[0]!);
  await restarted.dispose();
  const twice = new Agents(f.repo, f.client);
  t.after(() => twice.dispose());
  await twice.refreshAdmin(f.alice.id);
  assert.equal(twice.pendingDelivery(f.alice.id), null);
});
test('Hermes : accords exacts, périmés refusés et aucune approbation par un outil Luna', async (t) => {
  const f = await fixture(t),
    { id } = await f.start(),
    stored = f.repo.find(id)!;
  const run = f.fake.runs.get(stored.runId!)!;
  run.status = 'waiting_for_approval';
  run.approval = { request_id: 'approval-a', command: 'Créer le rendez-vous' };
  await f.agents.refreshAdmin(f.alice.id);
  assert.equal(
    (await f.agents.run(f.input(), 'agents__reply', { taskId: id, message: 'Oui' })).status,
    'failed',
  );
  assert.equal((await f.agents.run(f.input(), 'agents__approve', { taskId: id })).status, 'failed');
  run.approval = { request_id: 'approval-b', command: 'Nouvelle opération' };
  await assert.rejects(f.agents.approve(f.alice.id, id, 'approval-a', 'once'), /changé ou expiré/);
  assert.equal(f.fake.calls.filter((c) => c.path.endsWith('/approval')).length, 0);
  await f.agents.approve(f.alice.id, id, 'approval-b', 'once');
  const call = f.fake.calls.find((c) => c.path.endsWith('/approval'))!;
  assert.deepEqual(call.body, { request_id: 'approval-b', choice: 'once' });
  assert.equal(run.status, 'running');
  await assert.rejects(f.agents.approve(f.alice.id, id, 'approval-b', 'once'));
});
test('Hermes : demander l’arrêt ne prétend pas annuler un effet déjà exécuté', async (t) => {
  const f = await fixture(t),
    { id } = await f.start();
  const stopped = await f.agents.cancel(f.alice.id, id);
  assert.equal(stopped.status, 'stopping');
  assert.equal(f.repo.find(id)!.status, 'stopping');
  assert.equal(f.fake.calls.filter((c) => c.path.endsWith('/stop')).length, 1);
});
test('Hermes : historique distant récupéré uniquement pour un résultat déjà confirmé', async (t) => {
  const f = await fixture(t);
  f.fake.options.initialStatus = 'completed';
  const { id } = await f.start();
  f.fake.runs.delete(f.repo.find(id)!.runId!);
  await f.agents.refreshAdmin(f.alice.id);
  assert.equal(f.agents.admin(f.alice.id).tasks[0]!.output, 'Résultat conservé dans Hermes.');
  f.fake.options.initialStatus = 'running';
  const next = await f.start();
  f.fake.runs.clear();
  await f.agents.refreshAdmin(f.alice.id);
  assert.equal(f.agents.admin(f.alice.id).tasks.find((t) => t.id === next.id)!.output, null);
});
test('Hermes : changement d’adresse, secret, révision et déconnexion', async (t) => {
  const f = await fixture(t);
  await f.start();
  await assert.rejects(
    f.agents.configure(f.alice.id, {
      url: f.fake.url + '/p/new',
      enabled: true,
      description: '',
      revision: 1,
    }),
    /jeton/,
  );
  await assert.rejects(
    f.agents.configure(f.alice.id, {
      url: f.fake.url,
      token: f.fake.token,
      enabled: true,
      description: '',
      revision: 0,
    }),
    /modifiée/,
  );
  await f.agents.configure(f.alice.id, {
    url: f.fake.url + '/p/new',
    token: f.fake.token,
    enabled: true,
    description: '',
    revision: 1,
  });
  assert.equal(f.repo.tasks(f.alice.id).length, 0);
  const view = f.agents.disconnect(f.alice.id, 2);
  assert.equal(view.connection.hasToken, false);
  assert.deepEqual(f.agents.tools(f.alice.id), []);
  assert.equal(f.fake.runs.size, 1);
});
test('Hermes : réponses tardives invalidées quand la connexion change', async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  f.fake.options.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = f.start();
  while (f.fake.runs.size === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await f.agents.configure(f.alice.id, {
    url: f.fake.url + '/p/new',
    token: f.fake.token,
    enabled: true,
    description: '',
    revision: 1,
  });
  release();
  assert.equal((await pending).result.status, 'failed');
  assert.equal(f.repo.tasks(f.alice.id).length, 0);
});
test('Hermes : un ancien client ne peut pas interroger une tâche de la nouvelle connexion', async (t) => {
  const f = await fixture(t),
    old = f.repo.get(f.alice.id)!;
  await f.agents.configure(f.alice.id, {
    url: f.fake.url + '/p/replacement',
    token: f.fake.token,
    enabled: true,
    description: '',
    revision: 1,
  });
  const { id } = await f.start(),
    task = f.repo.find(id)!;
  const before = f.fake.calls.length;
  const result = await f.agents.refresh(old, task);
  assert.equal(result.output, null);
  assert.match(result.error!, /modifiée/);
  assert.equal(f.fake.calls.length, before);
});

test('Hermes : un échec distant confirmé est notifiable, une panne de suivi ne l’est pas', async (t) => {
  const f = await fixture(t),
    { id } = await f.start(),
    run = f.fake.runs.get(f.repo.find(id)!.runId!)!;
  f.fake.options.failReads = true;
  await f.agents.refreshAdmin(f.alice.id);
  assert.equal(f.agents.pendingDelivery(f.alice.id), null);
  f.fake.options.failReads = false;
  run.status = 'failed';
  await f.agents.refreshAdmin(f.alice.id);
  const result = f.agents.pendingDelivery(f.alice.id)!;
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /pas abouti/);
  f.agents.markDelivered(result);
  assert.equal(f.agents.pendingDelivery(f.alice.id), null);
});

test('Hermes : redirections refusées et absence de secret dans les erreurs', async (t) => {
  const f = await fixture(t);
  f.fake.options.redirect = true;
  await f.agents.discover(f.alice.id);
  const view = f.agents.admin(f.alice.id);
  assert.equal(view.connection.discovery?.available, false);
  assert.ok(!JSON.stringify(view).includes(f.fake.token));
});

test('Hermes : retour deux heures après avec un cache expiré, sans nouvel envoi', async (t) => {
  let now = Date.now();
  const f = await fixture(t, () => now);
  f.fake.options.initialStatus = 'completed';
  const { id } = await f.start();
  const stored = f.repo.find(id)!;
  f.fake.runs.get(stored.runId!)!.output = 'Résultat relu au retour.';
  now += 2 * 60 * 60_000;
  // Resume happens before tick has removed the expired cache entry.
  f.agents.resume(f.alice.id, 'retour-apres-deux-heures');
  for (let i = 0; i < 100 && !f.agents.pendingDelivery(f.alice.id); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.agents.pendingDelivery(f.alice.id)?.output, 'Résultat relu au retour.');
  assert.equal(f.fake.calls.filter((c) => c.path === '/v1/runs' && c.method === 'POST').length, 1);
  f.agents.markDelivered(f.agents.pendingDelivery(f.alice.id)!);
  assert.equal(f.agents.pendingDelivery(f.alice.id), null);
});

test('Hermes : une lecture échouée est retentée à la session suivante', async (t) => {
  const f = await fixture(t);
  f.fake.options.initialStatus = 'completed';
  const { id } = await f.start();
  const c = f.repo.get(f.alice.id)!;
  f.fake.options.failReads = true;
  await f.agents.refresh(c, f.repo.find(id)!);
  assert.equal(f.agents.pendingDelivery(f.alice.id), null);
  f.fake.options.failReads = false;
  f.agents.resume(f.alice.id, 'retour-apres-panne');
  for (let i = 0; i < 100 && !f.agents.pendingDelivery(f.alice.id); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.agents.pendingDelivery(f.alice.id)?.status, 'completed');
  assert.equal(f.fake.runs.size, 1);
});

test('Hermes : une API de compétences en erreur reste un diagnostic partiel précis', async (t) => {
  const f = await fixture(t);
  f.fake.options.failSkills = true;
  await f.agents.discover(f.alice.id);
  const d = f.agents.admin(f.alice.id).connection.discovery!;
  assert.equal(d.available, true);
  assert.equal(d.catalogComplete, false);
  assert.deepEqual(d.issues, [{ kind: 'skill', message: 'Hermes est indisponible (HTTP 500).' }]);
  assert.equal(d.capabilities.filter((a) => a.kind === 'toolset').length, 1);
  assert.equal(d.capabilities.filter((a) => a.kind === 'skill').length, 0);
  assert.doesNotMatch(JSON.stringify(d), new RegExp(f.fake.token));
});

test('Hermes : changement des droits de suivi transmis à Luna même avec un catalogue identique', async (t) => {
  const f = await fixture(t);
  let updates = 0;
  f.agents.onCapabilitiesChanged = () => updates++;
  f.fake.options.approval = false;
  f.fake.options.steer = false;
  await f.agents.discover(f.alice.id);
  assert.equal(updates, 1);
  const d = f.agents.admin(f.alice.id).connection.discovery!;
  assert.equal(d.approval, false);
  assert.equal(d.steer, false);
  await f.agents.discover(f.alice.id);
  assert.equal(updates, 1);
});
