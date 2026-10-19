import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { compile } from '../shared/validation.js';
import type { ProfileRepository } from './storage.js';
import { SATELLITE_NAME_MAX, type Satellite, type SatelliteStore } from './satellites-store.js';
import type { SatelliteHub } from './satellites.js';

const name = { type: 'string', minLength: 1, maxLength: SATELLITE_NAME_MAX, pattern: '\\S' };
const createSchema = compile<{ name: string }>({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name },
});
const updateSchema = compile<{ name?: string; profileId?: string | null; volume?: number }>({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name,
    profileId: { type: ['string', 'null'], minLength: 1, maxLength: 128 },
    volume: { type: 'integer', minimum: 0, maximum: 100 },
  },
});

/** Jeton présenté par un satellite : `Authorization: Bearer <jeton>`. */
function bearer(request: FastifyRequest): string {
  const header = String(request.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function registerSatellites(
  app: FastifyInstance,
  services: {
    store: SatelliteStore;
    hub: SatelliteHub;
    profiles: ProfileRepository;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  },
) {
  const { store, hub, profiles, requireAdmin } = services;
  const view = (satellite: Satellite) => ({ ...satellite, ...hub.status(satellite.id) });

  app.get(
    '/satellite',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (!store.authenticate(bearer(request)))
          return reply.code(403).send({ error: 'Satellite non autorisé.' });
      },
    },
    (socket, request) => {
      // Révoqué entre la vérification et l’ouverture : refusé quand même.
      const satellite = store.authenticate(bearer(request));
      if (!satellite) return socket.close(1008, 'Satellite non autorisé.');
      hub.connect(socket, satellite);
    },
  );

  app.get('/api/admin/satellites', { preHandler: requireAdmin }, async () => ({
    satellites: store.list().map(view),
  }));
  app.post('/api/admin/satellites', { preHandler: requireAdmin }, async (request, reply) => {
    if (!createSchema(request.body)) return reply.code(400).send({ error: 'Nom invalide.' });
    const { satellite, token } = store.create(request.body.name.trim());
    return { satellite: view(satellite), token };
  });
  app.patch<{ Params: { id: string } }>(
    '/api/admin/satellites/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = request.body;
      if (!updateSchema(body)) return reply.code(400).send({ error: 'Réglages invalides.' });
      if (body.profileId && !profiles.get(body.profileId))
        return reply.code(400).send({ error: 'Profil introuvable.' });
      const satellite = store.update(request.params.id, {
        ...body,
        ...(body.name === undefined ? {} : { name: body.name.trim() }),
      });
      if (!satellite) return reply.code(404).send({ error: 'Satellite introuvable.' });
      hub.refresh(satellite);
      return { satellite: view(satellite) };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/admin/satellites/:id/token',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const token = store.renewToken(request.params.id);
      if (!token) return reply.code(404).send({ error: 'Satellite introuvable.' });
      hub.disconnect(request.params.id, 'Jeton renouvelé.');
      return { token };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/satellites/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!store.remove(request.params.id))
        return reply.code(404).send({ error: 'Satellite introuvable.' });
      hub.disconnect(request.params.id, 'Satellite retiré.');
      return { ok: true };
    },
  );
}
