import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLog } from '../server/logs.js';

test('logs mask secrets and sensitive fields in errors, nested details and files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-logs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'test.log');
  const logs = new DiagnosticLog({ file, secrets: ['private-local-key'] });
  logs.write('error', 'openai', 'failure', {
    error: Object.assign(new Error('private-local-key sk-example Bearer abcdef'), {
      status: 401,
      request_id: 'req-123',
    }),
    nested: { token: 'hidden-token', sdp: 'hidden-sdp', transcript: 'hidden-words' },
  });
  const output = JSON.stringify(logs.snapshot()) + readFileSync(file, 'utf8');
  for (const secret of [
    'private-local-key',
    'sk-example',
    'abcdef',
    'hidden-token',
    'hidden-sdp',
    'hidden-words',
  ])
    assert.ok(!output.includes(secret), secret);
  assert.match(output, /req-123/);
  assert.match(output, /401/);
});

test('logs bound memory and rotate files, while disk errors preserve diagnostics', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-rotation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const logs = new DiagnosticLog({ file: join(directory, 'test.log'), maxBytes: 300 });
  for (let i = 0; i < 1010; i++) logs.write('info', 'local', 'event', { i });
  assert.equal(logs.snapshot().entries.length, 1000);
  assert.equal(readdirSync(directory).length, 4);
  writeFileSync(join(directory, 'blocked'), 'file');
  const broken = new DiagnosticLog({ file: join(directory, 'blocked', 'test.log') });
  assert.doesNotThrow(() => broken.write('info', 'local', 'start'));
  assert.equal(broken.snapshot().diskAvailable, false);
  assert.equal(broken.snapshot().entries.at(-1)?.level, 'error');
});
