import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pythonCommand, venvPython } from '../server/python.js';

const root = '/opt/cornelius';
const local = join(root, '.venv', 'bin/python');

test('Linux : python3 du système à défaut d’environnement, jamais une commande python absente', () => {
  assert.equal(pythonCommand(root, { env: {}, platform: 'linux', exists: () => false }), 'python3');
  assert.equal(pythonCommand(root, { env: {}, platform: 'win32', exists: () => false }), 'python');
});

test('l’environnement de la perception passe avant la variable, sauf pour l’installateur d’images', () => {
  const exists = (path: string) => path === local;
  const env = { CORNELIUS_PYTHON: '/usr/bin/python3.12' };
  assert.equal(pythonCommand(root, { env, platform: 'linux', exists }), local);
  assert.equal(
    pythonCommand(root, { env, platform: 'linux', exists, preferEnv: true }),
    '/usr/bin/python3.12',
  );
  assert.equal(
    pythonCommand(root, { env, platform: 'linux', exists: () => false }),
    '/usr/bin/python3.12',
  );
  assert.equal(
    venvPython(root, '.venv-image', 'win32'),
    join(root, '.venv-image', 'Scripts/python.exe'),
  );
});
