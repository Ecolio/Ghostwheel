import assert from 'node:assert/strict';
import test from 'node:test';
import type { LunaCardRequest } from '../shared/types.js';
import { illustrationPrompt } from '../server/image-illustration.js';

const card: LunaCardRequest = {
  schemaVersion: 1,
  cardType: 'luna',
  title: 'Les aurores boréales',
  primaryValue: null,
  subtitle: null,
  description: 'Des lumières colorées apparaissent dans le ciel nocturne près des pôles.',
  items: [],
  sources: [],
};

test('une carte descriptive fournit un prompt sans texte à incruster', () => {
  const prompt = illustrationPrompt({ content: card });
  assert.match(prompt ?? '', /aurores boréales/u);
  assert.match(prompt ?? '', /no writing/u);
  assert.ok((prompt?.length ?? 0) <= 1000);
});

test('les cartes chiffrées seules et les résultats périmés ne sont pas illustrés', () => {
  assert.equal(
    illustrationPrompt({
      content: { ...card, title: 'Heure actuelle', primaryValue: '13:42', description: null },
    }),
    null,
  );
  assert.equal(illustrationPrompt({ content: card, stale: true }), null);
});
