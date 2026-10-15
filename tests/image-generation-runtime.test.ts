import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { ImageGenerationRuntime } from '../server/image-generation-runtime.js';
import type { ImageGeneration } from '../server/image-generation.js';

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
  });
}

test('l’admin installe un modèle puis le worker démarre et s’arrête automatiquement', () => {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-image-runtime-'));
  const installers: ReturnType<typeof child>[] = [];
  const workers: ReturnType<typeof child>[] = [];
  const status = { enabled: true, model: 'flux2-klein-4b', provider: 'local' };
  const generation = { snapshot: () => status } as unknown as ImageGeneration;
  const runtime = new ImageGenerationRuntime(
    generation,
    () => {},
    'secret',
    'http://127.0.0.1:3000',
    root,
    () => {
      const value = child();
      installers.push(value);
      return value as unknown as ChildProcess;
    },
    (token, origin) => {
      assert.equal(token, 'secret');
      assert.equal(origin, 'http://127.0.0.1:3000');
      const value = child();
      workers.push(value);
      return value as unknown as ChildProcess;
    },
  );
  try {
    assert.equal(runtime.snapshot()['flux2-klein-4b'].state, 'missing');
    runtime.ensure('flux2-klein-4b');
    assert.equal(runtime.snapshot()['flux2-klein-4b'].state, 'checking');
    assert.throws(() => runtime.ensure('z-image-turbo'), /déjà en cours/);
    installers[0]!.stdout.write(
      JSON.stringify({
        state: 'downloading',
        file: 'Modèle FLUX',
        completed: 1,
        files: 2,
        received: 0,
        total: null,
      }) + '\n',
    );
    assert.equal(runtime.snapshot()['flux2-klein-4b'].file, 'Modèle FLUX');
    const python = join(
      root,
      '.venv-image',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    mkdirSync(join(python, '..'), { recursive: true });
    writeFileSync(python, 'test');
    const model = join(root, 'models', 'image-generation', 'flux2-klein-4b');
    mkdirSync(model, { recursive: true });
    writeFileSync(join(model, '.cornelius-ready'), 'test');
    installers[0]!.stdout.write('{"state":"ready"}\n');
    installers[0]!.emit('close', 0);
    assert.equal(runtime.snapshot()['flux2-klein-4b'].state, 'ready');
    assert.equal(workers.length, 1);
    // Images confiées à OpenAI : le générateur local s’arrête et libère la carte graphique.
    status.provider = 'openai';
    runtime.sync();
    assert.equal(workers[0]!.killed, true);
    assert.equal(workers.length, 1);
    status.provider = 'local';
    runtime.sync();
    assert.equal(workers.length, 2);
  } finally {
    runtime.dispose();
    assert.equal(workers[0]?.killed, true);
    rmSync(root, { recursive: true, force: true });
  }
});

test('un échec d’installation garde la fin de la sortie Python, celle qui porte l’erreur', () => {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-image-runtime-'));
  const installers: ReturnType<typeof child>[] = [];
  const generation = {
    snapshot: () => ({ enabled: false, model: 'sdxl-turbo' }),
  } as unknown as ImageGeneration;
  const runtime = new ImageGenerationRuntime(
    generation,
    () => {},
    'secret',
    'http://127.0.0.1:3000',
    root,
    () => {
      const value = child();
      installers.push(value);
      return value as unknown as ChildProcess;
    },
    () => child() as unknown as ChildProcess,
  );
  try {
    runtime.ensure('sdxl-turbo');
    const traceback = 'Traceback (most recent call last):\n' + '  File "install.py"\n'.repeat(80);
    installers[0]!.stderr.write(traceback + 'OSError: [Errno 28] No space left on device');
    installers[0]!.emit('close', 1);
    const state = runtime.snapshot()['sdxl-turbo'];
    assert.equal(state.state, 'failed');
    assert.ok(state.error!.endsWith('OSError: [Errno 28] No space left on device'));
    assert.ok(state.error!.length <= 2000);
  } finally {
    runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
