import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MemoryEdit } from '../shared/memory.js';
import { compile } from '../shared/validation.js';
import { MemoryError } from './memory-store.js';
import type { PersonalMemory } from './memory.js';
import type { SessionController } from './controller.js';
import type { PersonalDataEraser } from './backups.js';

const version = { type: 'integer', minimum: 0 };
const forgetSchema = compile<{ version: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: { version },
});
const policySchema = compile<{ enabled: boolean; version: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'version'],
  properties: { enabled: { type: 'boolean' }, version },
});
const editSchema = compile<MemoryEdit>({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'topic', 'fact', 'scope', 'expiresAt'],
  properties: {
    version,
    topic: { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' },
    fact: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
    scope: { enum: ['durable', 'temporary'] },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
  },
});
export function registerMemory(
  app: FastifyInstance,
  memory: PersonalMemory,
  controller: SessionController,
  requireAdmin: (request: FastifyRequest, reply: FastifyReply) => void | Promise<unknown>,
  eraser?: Pick<PersonalDataEraser, 'memoriesForgotten'>,
) {
  const options = { preHandler: requireAdmin };
  const changed = (profileId: string) => {
    memory.invalidate(profileId);
    // A recalled fact cannot be removed from a Live timeline: close the affected conversation.
    controller.memoryChanged(profileId);
    return memory.repository.view(profileId);
  };
  const handle = (reply: FastifyReply, run: () => unknown) => {
    try {
      return run();
    } catch (error) {
      if (error instanceof MemoryError)
        return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  };
  app.get<{ Params: { profileId: string } }>(
    '/api/admin/memory/:profileId',
    options,
    async (request, reply) => handle(reply, () => memory.repository.view(request.params.profileId)),
  );
  app.patch<{ Params: { profileId: string } }>(
    '/api/admin/memory/:profileId',
    options,
    async (request, reply) => {
      if (!policySchema(request.body))
        return reply.code(400).send({ error: 'Réglage mémoire invalide.' });
      const { enabled, version } = request.body;
      return handle(reply, () => {
        memory.repository.setEnabled(request.params.profileId, enabled, version);
        return changed(request.params.profileId);
      });
    },
  );
  app.put<{ Params: { profileId: string; id: string } }>(
    '/api/admin/memory/:profileId/:id',
    options,
    async (request, reply) => {
      if (!editSchema(request.body)) return reply.code(400).send({ error: 'Souvenir invalide.' });
      const edit = request.body;
      return handle(reply, () => {
        memory.repository.edit(request.params.profileId, request.params.id, edit);
        return changed(request.params.profileId);
      });
    },
  );
  for (const path of ['/api/admin/memory/:profileId', '/api/admin/memory/:profileId/:id']) {
    app.delete<{ Params: { profileId: string; id?: string } }>(
      path,
      options,
      async (request, reply) => {
        if (!forgetSchema(request.body))
          return reply.code(400).send({ error: 'Version mémoire invalide.' });
        const { version } = request.body;
        return handle(reply, () => {
          memory.repository.forget(request.params.profileId, request.params.id ?? null, version);
          // Un souvenir oublié disparaît aussi des copies de sécurité.
          eraser?.memoriesForgotten(request.params.profileId, request.params.id ?? null);
          return changed(request.params.profileId);
        });
      },
    );
  }
}
