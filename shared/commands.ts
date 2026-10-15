import { compile } from './validation.js';
import type { MirrorCommand, PerceptionObservation } from './types.js';

const id = { type: 'string', minLength: 1, maxLength: 128 };
function command(type: string, properties = {}, required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', ...required],
    properties: { type: { const: type }, ...properties },
  };
}
export const validateMirrorCommand = compile<MirrorCommand>({
  oneOf: [
    command('start'),
    command('stop'),
    command('select_profile', { profileId: { anyOf: [id, { type: 'null' }] } }, ['profileId']),
    command('dismiss_card', { cardId: id }, ['cardId']),
  ],
});
export const validateObservation = compile<PerceptionObservation>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'producerBootId',
    'sequence',
    'observedAt',
    'health',
    'presence',
    'engaged',
    'people',
  ],
  properties: {
    schemaVersion: { const: 1 },
    producerBootId: id,
    sequence: { type: 'integer', minimum: 0 },
    observedAt: { type: 'integer', minimum: 0 },
    health: { enum: ['ok', 'unavailable'] },
    presence: { type: 'boolean' },
    engaged: { type: 'boolean' },
    people: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['trackId', 'profileId'],
        properties: { trackId: id, profileId: { anyOf: [id, { type: 'null' }] } },
      },
    },
  },
});
