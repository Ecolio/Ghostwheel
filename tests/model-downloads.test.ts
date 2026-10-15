import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ModelDownloads } from '../server/model-downloads.js';

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
test('les téléchargements sont exclusifs, progressent et reprennent après erreur sans événement ancien', () => {
  const children: ReturnType<typeof child>[] = [];
  const installed: string[] = [];
  const launched: { model: string; device: string }[] = [];
  const downloads = new ModelDownloads(
    () => {},
    (model) => installed.push(model),
    undefined,
    (model, device) => {
      launched.push({ model, device });
      const value = child();
      children.push(value);
      return value as unknown as ChildProcess;
    },
  );
  try {
    downloads.ensure('1.6b');
    downloads.ensure('1.6b');
    assert.equal(children.length, 1);
    assert.deepEqual(launched[0], { model: '1.6b', device: 'auto' });
    assert.throws(() => downloads.ensure('3b'), /en cours/);
    children[0]!.stdout.write(
      JSON.stringify({
        state: 'downloading',
        file: 'weights',
        completed: 1,
        files: 2,
        received: 1024,
        total: 4096,
      }) + '\n',
    );
    assert.equal(downloads.snapshot()['1.6b'].received, 1024);
    children[0]!.emit('error', new Error('réseau indisponible'));
    assert.equal(downloads.snapshot()['1.6b'].state, 'failed');
    downloads.ensure('1.6b');
    children[0]!.emit('close', 1);
    assert.equal(downloads.snapshot()['1.6b'].state, 'checking');
    children[1]!.stdout.write('{"state":"ready"}\n');
    assert.deepEqual(installed, []);
    children[1]!.emit('close', 0);
    assert.deepEqual(installed, ['1.6b']);
    assert.equal(downloads.snapshot()['1.6b'].state, 'ready');
    downloads.ensure('3b', 'cpu');
    assert.deepEqual(launched[2], { model: '3b', device: 'cpu' });
    downloads.dispose();
    assert.equal(children[2]!.killed, true);
    children[2]!.stdout.write('{"state":"ready"}\n');
    children[2]!.emit('close', 0);
    assert.deepEqual(installed, ['1.6b']);
  } finally {
    downloads.dispose();
  }
});

test('le vrai installateur Python vérifie les poids et conserve les fichiers entre deux installations', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-model-test-'));
  const data = Buffer.from('poids de test déterministes');
  let requests = 0;
  const server = createServer((_req, response) => {
    requests++;
    response.writeHead(200, { 'content-length': data.length });
    response.end(data);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  mkdirSync(join(root, 'perception'));
  copyFileSync(
    resolve('perception/download_models.py'),
    join(root, 'perception/download_models.py'),
  );
  const entry = {
    name: 'weights.onnx',
    url: `http://127.0.0.1:${address.port}/weights`,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  writeFileSync(
    join(root, 'perception/models.json'),
    JSON.stringify(
      ['450m', '1.6b', '3b'].map((id) => ({
        id,
        name: `lfm-${id}`,
        shared: [],
        files: [entry],
        gpuFiles: [entry],
        license: entry.url,
      })),
    ),
  );
  // L’installateur n’utilise que la bibliothèque standard : sans .venv (CI), le Python du système suffit.
  const localPython = resolve(
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  );
  const python = existsSync(localPython)
    ? localPython
    : process.platform === 'win32'
      ? 'python'
      : 'python3';
  const downloads = new ModelDownloads(
    () => {},
    () => {},
    root,
    (model, device) =>
      spawn(
        python,
        [
          join(root, 'perception/download_models.py'),
          '--vision-only',
          '--json',
          '--model',
          model,
          '--device',
          device,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      ),
  );
  t.after(async () => {
    downloads.dispose();
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  });
  async function install(model: '1.6b' | '3b', device: 'auto' | 'gpu' | 'cpu' = 'auto') {
    downloads.ensure(model, device);
    const deadline = Date.now() + 10_000;
    while (['checking', 'downloading'].includes(downloads.snapshot()[model].state)) {
      if (Date.now() > deadline) throw new Error('Installateur bloqué');
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.equal(
      downloads.snapshot()[model].state,
      'ready',
      downloads.snapshot()[model].error ?? '',
    );
    assert.deepEqual(readFileSync(join(root, 'models', `lfm-${model}`, 'weights.onnx')), data);
  }
  await install('1.6b');
  await install('3b');
  const previous = requests;
  await install('1.6b');
  assert.equal(
    requests,
    previous,
    'aucun téléchargement si poids et licence sont présents et vérifiés',
  );
});
