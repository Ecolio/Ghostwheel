import { createServer } from 'node:http';
import { once } from 'node:events';
export async function fakeHermes() {
  const token = 'hermes-fixture-secret';
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    key: string | undefined;
  }[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  const options = {
    initialStatus: 'running',
    initialOutput: 'Réponse Hermes de test.',
    failPost: false,
    failCatalog: false,
    failReads: false,
    redirect: false,
    unsupported: false,
    approval: true,
    steer: true,
    failSkills: false,
    gate: null as Promise<void> | null,
  };
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').replace(/^\/p\/[^/]+/, '');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let body: Record<string, unknown> = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    } catch {}
    calls.push({
      path,
      method: req.method ?? 'GET',
      body,
      key: req.headers['idempotency-key'] as string | undefined,
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer ' + token) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (options.redirect) {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/private' });
      res.end('{}');
      return;
    }
    if (path === '/v1/capabilities') {
      res.end(
        JSON.stringify({
          features: {
            run_submission: !options.unsupported,
            run_status: true,
            run_stop: true,
            run_approval_response: options.approval,
            run_steer: options.steer,
          },
        }),
      );
      return;
    }
    if (path === '/v1/toolsets') {
      if (options.failCatalog) {
        res.writeHead(503);
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          data: [
            {
              name: 'agenda',
              description: 'Consulter et organiser l’agenda.',
              enabled: true,
              configured: true,
              tools: ['calendar_read', 'calendar_create'],
            },
            {
              name: 'mail',
              description: 'Envoyer des messages.',
              enabled: true,
              configured: false,
              tools: ['mail_send'],
            },
            { name: 'terminal', enabled: false, configured: true, tools: ['terminal'] },
          ],
        }),
      );
      return;
    }
    if (path === '/v1/skills') {
      if (options.failSkills) {
        res.writeHead(500);
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          data: [
            { name: 'weekend', description: 'Préparer des sorties.' },
            { name: 'disabled-skill', description: 'Ne pas annoncer.', disabled: true },
          ],
        }),
      );
      return;
    }
    if (path === '/v1/runs' && req.method === 'POST') {
      const id = 'run_' + (runs.size + 1);
      runs.set(id, {
        run_id: id,
        session_id: body.session_id,
        status: options.initialStatus,
        output: options.initialStatus === 'completed' ? options.initialOutput : null,
      });
      if (options.gate) await options.gate;
      if (options.failPost) {
        req.destroy();
        return;
      }
      res.writeHead(202);
      res.end(JSON.stringify({ run_id: id, status: 'started' }));
      return;
    }
    const match = path.match(/^\/v1\/runs\/([^/]+)(?:\/(stop|approval|steer))?$/);
    if (match) {
      const run = runs.get(match[1]!);
      if (!run) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      if (match[2] === 'stop') {
        run.status = 'stopping';
        res.end(JSON.stringify({ status: 'stopping' }));
        return;
      }
      if (match[2] === 'approval') {
        const a = run.approval as { request_id: string } | undefined;
        if (a?.request_id !== body.request_id) {
          res.writeHead(409);
          res.end('{}');
          return;
        }
        run.status = body.choice === 'deny' ? 'cancelled' : 'running';
        delete run.approval;
        res.end(JSON.stringify({ resolved: 1 }));
        return;
      }
      if (match[2] === 'steer') {
        res.end(JSON.stringify({ accepted: true }));
        return;
      }
      if (options.failReads) {
        res.writeHead(503);
        res.end('{}');
        return;
      }
      res.end(JSON.stringify(run));
      return;
    }
    if (path.startsWith('/api/sessions/')) {
      res.end(
        JSON.stringify({
          data: [
            { role: 'user', content: 'Private input' },
            { role: 'assistant', content: 'Résultat conservé dans Hermes.' },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local port');
  return {
    url: 'http://127.0.0.1:' + address.port,
    token,
    calls,
    runs,
    options,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
