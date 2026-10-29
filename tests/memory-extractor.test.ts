import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryExtractor } from '../server/memory-extractor.js';

test('Responses extrait sans stockage distant ni outils, avec schéma strict et modèle configuré', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const extract = createMemoryExtractor('test-key-not-real', async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: 'response-fixture',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          id: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: '{"schemaVersion":1,"changes":[]}', annotations: [] },
          ],
        },
      ],
    });
  });
  const result = await extract(
    { now: new Date().toISOString(), turns: [], memories: [] },
    new AbortController().signal,
  );
  assert.deepEqual(result, { schemaVersion: 1, changes: [] });
  assert.equal(requestBody!.model, 'gpt-5.6-luna');
  assert.equal(requestBody!.store, false);
  assert.equal(requestBody!.tools, undefined);
  assert.deepEqual(requestBody!.reasoning, { effort: 'none' });
  const text = requestBody!.text as {
    format: { strict: boolean; schema: { additionalProperties: boolean } };
  };
  assert.equal(text.format.strict, true);
  assert.equal(text.format.schema.additionalProperties, false);
  const instructions = requestBody!.instructions as string;
  assert.match(instructions, /Cornelius est le nom de l’assistant/u);
  assert.match(instructions, /« Ghostwheel » est le mot d’appel/u);
  assert.match(instructions, /la personne s’adresse à Cornelius/u);
});
test('une réponse incomplète, un refus et une erreur fournisseur ne deviennent pas des propositions', async () => {
  for (const body of [
    { status: 'incomplete', output: [] },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }],
    },
  ]) {
    const extract = createMemoryExtractor('test-key-not-real', async () =>
      Response.json({ ...body, object: 'response' }),
    );
    await assert.rejects(
      extract(
        { now: new Date().toISOString(), turns: [], memories: [] },
        new AbortController().signal,
      ),
      /incomplète/,
    );
  }
  let calls = 0;
  const extract = createMemoryExtractor('test-key-not-real', async () => {
    calls++;
    return Response.json({ error: { message: 'Fixture error' } }, { status: 500 });
  });
  await assert.rejects(
    extract(
      { now: new Date().toISOString(), turns: [], memories: [] },
      new AbortController().signal,
    ),
  );
  assert.equal(calls, 1);
});
