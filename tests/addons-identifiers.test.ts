import assert from 'node:assert/strict';
import test from 'node:test';
import { REF_PATTERN, refFromLabel } from '../shared/addons.js';
import { duplicateRef, slug, spokenPhrase, typingSlug } from '../web/components/admin/format.js';

const pattern = new RegExp(REF_PATTERN, 'u');

test('slug() garde les lettres accentuées, les tirets et les espaces sous une forme valide', () => {
  assert.equal(slug('entrée'), 'entree');
  assert.equal(slug('Entrée principale'), 'entree-principale');
  assert.equal(slug('porte-garage'), 'porte-garage');
  assert.equal(slug('  Météo   à la Maison  '), 'meteo-a-la-maison');
  assert.equal(slug('Cœur de Ville'), 'coeur-de-ville');
  assert.equal(slug('ÉTÉ Ça Œuvre'), 'ete-ca-oeuvre');
  assert.equal(slug('lampe_salon'), 'lampe_salon');
  assert.equal(slug('a - b'), 'a-b');
  assert.equal(slug('-_début-'), 'debut');
  assert.equal(slug('!!!'), '');
  assert.equal(slug('x'.repeat(80)).length, 64);
  for (const value of ['entrée', 'Bus n°42 → gare', 'Météo 2', '_x_'])
    assert.match(slug(value), pattern, value);
});

test('pendant la saisie, le tiret final et les espaces restent tapables', () => {
  // Bogue d’origine : slug() à chaque frappe effaçait le tiret et l’espace aussitôt tapés.
  assert.equal(typingSlug('porte-'), 'porte-');
  assert.equal(typingSlug('Porte '), 'porte-');
  assert.equal(typingSlug('Porte garage'), 'porte-garage');
  // Les accents ne sont retirés qu’à la perte de focus : « entrée » ne devient pas « entre ».
  assert.equal(typingSlug('entrée'), 'entrée');
  assert.equal(slug(typingSlug('entrée')), 'entree');
});

test('un identifiant déduit du nom évite ceux déjà pris', () => {
  assert.equal(refFromLabel('Maison', new Set()), 'maison');
  assert.equal(refFromLabel('Maison', new Set(['maison'])), 'maison-2');
  assert.equal(refFromLabel('Maison', new Set(['maison', 'maison-2'])), 'maison-3');
  assert.equal(refFromLabel('???', new Set()), 'source');
  const long = refFromLabel('a'.repeat(80), new Set(['a'.repeat(60)]));
  assert.equal(long, 'a'.repeat(60) + '-2');
  assert.match(long, pattern);
});

test('un doublon n’est signalé que pour le même propriétaire, hors de l’élément modifié', () => {
  const entries = [
    { id: '1', ref: 'maison', profileId: null, label: 'Maison' },
    { id: '2', ref: 'travail', profileId: 'alice', label: 'Travail' },
  ];
  assert.equal(duplicateRef('Maison', null, entries, null)?.id, '1');
  assert.equal(duplicateRef('maison', null, entries, '1'), null);
  assert.equal(duplicateRef('travail', null, entries, null), null);
  assert.equal(duplicateRef('travail', 'alice', entries, null)?.label, 'Travail');
  assert.equal(duplicateRef('', null, entries, null), null);
});

test('la phrase à prononcer reprend l’identifiant sans répéter le nom du module', () => {
  assert.equal(spokenPhrase('weather', 'maison'), 'la météo de maison');
  assert.equal(spokenPhrase('weather', 'meteo-a-la-maison'), 'la météo de maison');
  assert.equal(spokenPhrase('clock', 'heure-de-paris'), 'l’heure de paris');
  assert.equal(spokenPhrase('clock', 'atelier'), 'l’heure d’atelier');
  assert.equal(spokenPhrase('transit', 'bus-pour-le-travail'), 'les prochains passages de travail');
  assert.equal(spokenPhrase('autre', 'maison-2'), 'la source de maison 2');
  assert.equal(spokenPhrase('weather', null), null);
  assert.equal(spokenPhrase('weather', ''), null);
});

test('la phrase à prononcer reprend les mots du nom affiché quand ils correspondent', () => {
  assert.equal(spokenPhrase('clock', 'heure-de-paris', 'Heure de Paris'), 'l’heure de Paris');
  assert.equal(spokenPhrase('clock', 'l-heure-d-ete', 'L’heure d’Été'), 'l’heure d’Été');
  assert.equal(spokenPhrase('weather', 'meteo-de-lyon', 'Météo de Lyon'), 'la météo de Lyon');
  assert.equal(
    spokenPhrase('weather', 'saint-etienne', 'Saint-Étienne'),
    'la météo de Saint Étienne',
  );
  // Suffixe ajouté pour éviter un doublon : le début suit le nom, la suite l’identifiant.
  assert.equal(spokenPhrase('autre', 'maison-2', 'Maison'), 'la source de Maison 2');
  // Identifiant choisi à la main, sans rapport avec le nom : l’identifiant seul.
  assert.equal(spokenPhrase('weather', 'maison', 'Météo de Lyon'), 'la météo de maison');
  assert.equal(spokenPhrase('weather', 'lyon', null), 'la météo de lyon');
  assert.equal(spokenPhrase('weather', null, 'Météo de Lyon'), null);
});
