import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AgentConnectionInput } from '../shared/agents.js';
import { compile } from '../shared/validation.js';
import { Agents } from './agents.js';
import { HermesError } from './hermes-client.js';

const revision = { type: 'integer', minimum: 0 };
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,200}$' };
const connection = compile<AgentConnectionInput>({
  type: 'object',
  additionalProperties: false,
  required: ['url', 'enabled', 'description', 'revision'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    token: { type: 'string', maxLength: 4096, pattern: '^[^\\s]*$' },
    enabled: { type: 'boolean' },
    description: { type: 'string', maxLength: 2000 },
    revision,
  },
});
const remove = compile<{ revision: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['revision'],
  properties: { revision },
});
const message = compile<{ message: string; taskId: string | null }>({
  type: 'object',
  additionalProperties: false,
  required: ['message', 'taskId'],
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' },
    taskId: { anyOf: [id, { type: 'null' }] },
  },
});
const approval = compile<{ requestId: string; choice: 'once' | 'deny' }>({
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'choice'],
  properties: { requestId: id, choice: { type: 'string', enum: ['once', 'deny'] } },
});
export function registerAgents(
  app: FastifyInstance,
  agents: Agents,
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  const admin = { preHandler: requireAdmin };
  const guarded = async (reply: FastifyReply, work: () => unknown | Promise<unknown>) => {
    try {
      return await work();
    } catch (error) {
      return reply
        .code(
          error instanceof HermesError && [400, 403, 404, 409].includes(error.status)
            ? error.status
            : 502,
        )
        .send({
          error: error instanceof HermesError ? error.message : 'Connexion à Hermes indisponible.',
        });
    }
  };
  type ProfileParams = { Params: { profileId: string } };
  type TaskParams = { Params: { profileId: string; taskId: string } };
  const root = '/api/admin/agents/:profileId';
  app.get<ProfileParams>(root, admin, async (req, reply) =>
    guarded(reply, () => agents.admin(req.params.profileId)),
  );
  app.put<ProfileParams>(root, admin, async (req, reply) => {
    if (!connection(req.body))
      return reply.code(400).send({ error: 'Configuration Hermes invalide.' });
    const body = req.body;
    return guarded(reply, async () => {
      const result = await agents.configure(req.params.profileId, body);
      return result;
    });
  });
  app.delete<ProfileParams>(root, admin, async (req, reply) => {
    if (!remove(req.body)) return reply.code(400).send({ error: 'Révision manquante.' });
    const body = req.body;
    return guarded(reply, () => {
      const result = agents.disconnect(req.params.profileId, body.revision);
      return result;
    });
  });
  app.post<ProfileParams>(root + '/discover', admin, async (req, reply) =>
    guarded(reply, async () => {
      await agents.discover(req.params.profileId);
      return agents.admin(req.params.profileId);
    }),
  );
  app.post<ProfileParams>(root + '/refresh', admin, async (req, reply) =>
    guarded(reply, () => agents.refreshAdmin(req.params.profileId)),
  );
  app.post<ProfileParams>(root + '/message', admin, async (req, reply) => {
    if (!message(req.body)) return reply.code(400).send({ error: 'Message Hermes invalide.' });
    const body = req.body;
    return agents.run(
      {
        profileId: req.params.profileId,
        scope: { interactionId: 'admin-' + randomUUID(), profileEpoch: 0, contextVersion: 0 },
        callId: randomUUID(),
        signal: AbortSignal.timeout(20_000),
      },
      body.taskId ? 'agents__reply' : 'agents__start',
      body.taskId ? body : { message: body.message },
    );
  });
  app.post<TaskParams>(root + '/tasks/:taskId/stop', admin, async (req, reply) =>
    guarded(reply, () => agents.cancel(req.params.profileId, req.params.taskId)),
  );
  app.post<TaskParams>(root + '/tasks/:taskId/approval', admin, async (req, reply) => {
    if (!approval(req.body)) return reply.code(400).send({ error: 'Décision Hermes invalide.' });
    const body = req.body;
    return guarded(reply, () =>
      agents.approve(req.params.profileId, req.params.taskId, body.requestId, body.choice),
    );
  });
}
