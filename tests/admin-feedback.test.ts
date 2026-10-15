import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceState, SaveBar } from '../web/components/admin/shared.js';
import type { AdminResource } from '../web/components/admin/useAdminResource.js';

function resource<T>(partial: Partial<AdminResource<T>>): AdminResource<T> {
  return { data: null, error: null, loading: false, reload: async () => {}, ...partial };
}

function state<T>(
  value: AdminResource<T>,
  extra: { isEmpty?: (data: T) => boolean; empty?: { title: string; action?: ReactNode } } = {},
) {
  return renderToStaticMarkup(
    createElement(ResourceState<T>, {
      resource: value,
      loadingLabel: 'Lecture des sources…',
      ...extra,
      children: (data: T) => createElement('p', null, 'Contenu : ' + String(data)),
    }),
  );
}

test('ResourceState : chargement, erreur avec « Réessayer », vide avec action, contenu', () => {
  const loading = state(resource<string[]>({ loading: true }));
  assert.match(loading, /role="status">Lecture des sources…</u);
  assert.match(loading, /aria-busy="true"/u);

  // Une lecture en échec n’affiche pas en même temps « Lecture… ».
  const failed = state(resource<string[]>({ error: 'Serveur injoignable.' }));
  assert.match(failed, /role="alert"/u);
  assert.match(failed, /Lecture impossible : Serveur injoignable\./u);
  assert.match(failed, />Réessayer</u);
  assert.doesNotMatch(failed, /Lecture des sources/u);

  const retrying = state(resource<string[]>({ error: 'Serveur injoignable.', loading: true }));
  assert.match(retrying, /disabled="".*Nouvel essai…/u);

  const empty = state(resource<string[]>({ data: [] }), {
    isEmpty: (data) => data.length === 0,
    empty: { title: 'Aucune source', action: createElement('button', null, 'Ajouter') },
  });
  assert.match(empty, /Aucune source/u);
  assert.match(empty, /<button>Ajouter<\/button>/u);
  assert.doesNotMatch(empty, /Contenu/u);

  // Des données déjà lues restent affichées quand l’actualisation échoue.
  const stale = state(resource({ data: 'météo', error: 'Délai dépassé.' }));
  assert.match(stale, /Actualisation impossible : Délai dépassé\./u);
  assert.match(stale, /Contenu : météo/u);
});

test('SaveBar : « n modifications · Enregistrer · Annuler », absente sans modification', () => {
  const render = (count: number, saving = false) =>
    renderToStaticMarkup(
      createElement(SaveBar, { count, saving, onSave: () => {}, onCancel: () => {} }),
    );
  assert.equal(render(0), '');
  const bar = render(2);
  assert.match(bar, /role="region" aria-label="Modifications non enregistrées"/u);
  assert.match(bar, />2 modifications non enregistrées</u);
  assert.match(bar, />Enregistrer</u);
  assert.match(bar, />Annuler</u);
  assert.match(render(1), />1 modification non enregistrée</u);
  assert.match(render(3, true), /disabled="">Enregistrement…/u);
});

test('SaveBar d’une valeur chiffrée : zone nommée, saisie invalide expliquée et non enregistrable', () => {
  const bar = renderToStaticMarkup(
    createElement(SaveBar, {
      count: 1,
      label: 'Délais de présence',
      error: 'Indiquez un délai de 0 à 30 s.',
      onSave: () => {},
      onCancel: () => {},
    }),
  );
  // Nom fixe : il ne dépend pas du nombre de modifications.
  assert.match(bar, /aria-label="Délais de présence : modifications non enregistrées"/u);
  assert.match(bar, /disabled="">Enregistrer</u);
  assert.match(bar, /text-destructive">Indiquez un délai de 0 à 30 s\.</u);
});
