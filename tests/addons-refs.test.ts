import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import clock from '../addons/clock/index.js';
import { createApp } from '../server/app.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { AddonRepository, migrations, openDatabase } from '../server/storage.js';
import { refFromLabel } from '../shared/addons.js';

/** Indépendant du nombre de migrations : on repère la migration par son contenu. */
function before(fragment: string): number {
  const index = migrations.findIndex((sql) => sql.includes(fragment));
  assert.ok(index >= 0, 'Migration introuvable : ' + fragment);
  return index;
}

const clockConfig = { timeZone: 'Europe/Paris', showDate: true, showSeconds: false };

/** Base arrêtée juste avant la migration des identifiants, avec des sources sans identifiant. */
function legacy(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  const index = before('addon_ref_plan');
  for (const migration of migrations.slice(0, index)) db.exec(migration);
  db.prepare('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)').run(
    'alice',
    'Alice',
    1,
  );
  let order = 0;
  const add = (addonId: string, label: string, ref: string | null, profileId: string | null) =>
    db
      .prepare(
        'INSERT INTO addon_instances (id, addon_id, profile_id, ref, label, enabled, config, config_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)',
      )
      .run(`${addonId}-${++order}`, addonId, profileId, ref, label, '{}', order, order);
  const migrate = () => {
    for (const migration of migrations.slice(index)) db.exec(migration);
  };
  const refs = () =>
    Object.fromEntries(
      (
        db.prepare('SELECT id, ref FROM addon_instances ORDER BY id').all() as {
          id: string;
          ref: string | null;
        }[]
      ).map((row) => [row.id, row.ref]),
    );
  return { db, add, migrate, refs, index };
}

test('la migration donne aux sources sans identifiant celui de leur nom, sans doublon', (t) => {
  const f = legacy(t);
  f.add('weather', 'Maison', null, null);
  f.add('weather', 'Maison', null, 'alice');
  f.add('weather', 'Entrée principale', null, null);
  f.add('weather', 'Bureau', 'maison-2', null);
  f.add('weather', '— ? —', null, null);
  f.add('transit', 'Maison', null, null);
  f.add('transit', 'Œuvre  d’art à Saint-Étienne', null, null);
  f.add('clock', 'Heure', 'paris', null);
  f.migrate();
  assert.deepEqual(f.refs(), {
    'weather-1': 'maison',
    // « maison-2 » appartient déjà à une autre source du module.
    'weather-2': 'maison-3',
    'weather-3': 'entree-principale',
    'weather-4': 'maison-2',
    'weather-5': 'source',
    // Chaque module a ses propres identifiants.
    'transit-6': 'maison',
    'transit-7': 'oeuvre-d-art-a-saint-etienne',
    // Un identifiant existant n’est jamais remplacé.
    'clock-8': 'paris',
  });
  // Mêmes résultats que l’identifiant calculé par l’administration.
  assert.equal(
    refFromLabel('Œuvre  d’art à Saint-Étienne', new Set()),
    'oeuvre-d-art-a-saint-etienne',
  );
  assert.equal(refFromLabel('Entrée principale', new Set()), 'entree-principale');
});

test('la migration est rejouable et départage un nom qui ressemble à un identifiant attribué', (t) => {
  const f = legacy(t);
  f.add('weather', 'Maison', null, null);
  f.add('weather', 'Maison', null, null);
  f.add('weather', 'Maison 2', null, null);
  f.add('weather', 'x'.repeat(80), null, null);
  f.migrate();
  const first = f.refs();
  assert.equal(first['weather-1'], 'maison');
  const second = new Set([first['weather-2'], first['weather-3']]);
  assert.equal(second.size, 2, 'aucun doublon');
  assert.ok(second.has('maison-2'));
  assert.ok([...second].every((ref) => ref && /^maison-2(-2)?$/u.test(ref)));
  assert.equal(first['weather-4'], 'x'.repeat(60));
  for (const ref of Object.values(first)) assert.match(ref ?? '', /^[a-z0-9][a-z0-9_-]{0,63}$/u);
  // Rejouée, elle ne touche plus aux identifiants attribués.
  f.db.exec(migrations[f.index]!);
  assert.deepEqual(f.refs(), first);
  // Une source ajoutée sans identifiant plus tard en reçoit un à la prochaine application.
  f.add('weather', 'Maison', null, null);
  f.db.exec(migrations[f.index]!);
  assert.equal(f.refs()['weather-5'], 'maison-3');
});

test('une base existante est migrée au démarrage et garde ses sources', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-addon-refs-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    const repository = new AddonRepository(db);
    const source = repository.createInstance({
      addonId: 'weather',
      profileId: null,
      ref: null,
      label: 'Météo du jardin',
      config: {},
      configVersion: 1,
    });
    assert.equal(repository.getInstance(source.id)?.ref, null);
    db.exec(`PRAGMA user_version = ${before('addon_ref_plan')}`);
    db.close();
    db = openDatabase(path);
    const migrated = new AddonRepository(db).getInstance(source.id);
    assert.equal(migrated?.ref, 'meteo-du-jardin');
    assert.equal(migrated?.label, 'Météo du jardin');
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('non-régression : avec deux sources sans identifiant, la voix peut choisir', async (t) => {
  const f = legacy(t);
  f.db
    .prepare(
      'INSERT INTO addon_instances (id, addon_id, profile_id, ref, label, enabled, config, config_version, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, 1, ?, 1, ?, ?)',
    )
    .run('paris', 'clock', 'Heure de Paris', JSON.stringify(clockConfig), 1, 1);
  f.db
    .prepare(
      'INSERT INTO addon_instances (id, addon_id, profile_id, ref, label, enabled, config, config_version, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, 1, ?, 1, ?, ?)',
    )
    .run(
      'tokyo',
      'clock',
      'Heure de Tokyo',
      JSON.stringify({ ...clockConfig, timeZone: 'Asia/Tokyo' }),
      2,
      2,
    );
  const runtime = new AddonRuntime({
    addons: [clock],
    instances: new AddonRepository(f.db),
    http: { fetch: () => Promise.reject(new Error('aucun réseau')) },
  });
  const signal = new AbortController().signal;
  // Avant : aucune source ne pouvait être désignée.
  const ambiguous = await runtime.read('clock', null, null, signal);
  assert.equal(ambiguous.ok, false);
  assert.equal(runtime.tools()[0]?.description.includes('heure-de-tokyo'), false);
  f.migrate();
  const description = runtime.tools()[0]?.description ?? '';
  assert.match(
    description,
    /heure-de-paris \(Heure de Paris\), heure-de-tokyo \(Heure de Tokyo\)/u,
  );
  const tokyo = await runtime.read('clock', null, 'heure-de-tokyo', signal);
  assert.equal(tokyo.ok, true);
  if (tokyo.ok) assert.equal(tokyo.instance.id, 'tokyo');
});

async function api(t: TestContext) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-addon-refs-api-'));
  const origin = 'http://localhost';
  const password = 'mot-de-passe-identifiants-1234';
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
    },
    {
      timers: false,
      imageGenerationRoot: imageRoot,
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
    await setImmediate();
    await services.app.close();
    rmSync(imageRoot, { recursive: true, force: true });
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const headers = { origin, cookie: `${entry.name}=${entry.value}` };
  return (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
    services.app.inject({ method, url, headers, payload });
}

test('une source créée sans identifiant reçoit celui de son nom, et « -2 » en cas de doublon', async (t) => {
  const inject = await api(t);
  const create = (label: string, ref: string | null = null) =>
    inject('POST', '/api/admin/addons/instances', {
      addonId: 'clock',
      profileId: null,
      ref,
      label,
      config: clockConfig,
    });
  const first = await create('Maison');
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json<{ ref: string }>().ref, 'maison');
  const second = await create('Maison');
  assert.equal(second.json<{ ref: string }>().ref, 'maison-2');
  assert.equal((await create('Entrée', 'porte')).json<{ ref: string }>().ref, 'porte');
  // Vidé lors d’une modification, l’identifiant est à nouveau tiré du nom.
  const cleared = await inject(
    'PATCH',
    '/api/admin/addons/instances/' + second.json<{ id: string }>().id,
    { ref: null, label: 'Salon' },
  );
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json<{ ref: string }>().ref, 'salon');
});
