import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandsStatus,
  matchesSearch,
  normalizeSearch,
  timeZoneGroups,
} from '../web/components/admin/format.js';

test('la recherche de modules ignore accents et majuscules, et lit mot par mot', () => {
  assert.equal(normalizeSearch('  Météo à l’Île-de-France '), 'meteo a l ile de france');
  const weather = ['Météo', 'météo temps prévisions', 'Météo Concept', 'Maison'];
  assert.equal(matchesSearch('meteo', ...weather), true);
  assert.equal(matchesSearch('METEO', ...weather), true);
  assert.equal(matchesSearch('météo maison', ...weather), true);
  assert.equal(matchesSearch('meteo bureau', ...weather), false);
  assert.equal(matchesSearch('prev', ...weather), true, 'début de mot');
  assert.equal(matchesSearch('teo', ...weather), false, 'pas au milieu d’un mot');
  assert.equal(matchesSearch('bus', 'Transports', 'transports bus train rer'), true);
  assert.equal(matchesSearch('', 'Heure'), true);
  assert.equal(matchesSearch('   ', 'Heure'), true);
  assert.equal(matchesSearch('heure', null, undefined, 'Heure'), true);
});

test('les fuseaux horaires sont rangés par région, Europe d’abord, valeur IANA gardée', () => {
  const groups = timeZoneGroups('Europe/Paris');
  assert.equal(groups[0]?.label, 'Europe');
  const europe = groups[0]!.zones;
  assert.deepEqual(
    europe.find((zone) => zone.value === 'Europe/Paris'),
    { value: 'Europe/Paris', label: 'Paris' },
  );
  const all = groups.flatMap((group) => group.zones);
  assert.ok(all.some((zone) => zone.value === 'UTC' && zone.label === 'UTC (temps universel)'));
  const america = groups.find((group) => group.label === 'Amériques')!.zones;
  assert.ok(america.some((zone) => zone.label === 'New York'));
  assert.ok(
    america.some((zone) => zone.label === 'Argentina / La Rioja'),
    'sous-région conservée',
  );
  // Une valeur enregistrée inconnue du navigateur reste choisie.
  assert.ok(
    timeZoneGroups('Etc/Inconnu')
      .flatMap((group) => group.zones)
      .some((zone) => zone.value === 'Etc/Inconnu'),
  );
});

test('le badge des commandes suit le modèle des modules', () => {
  const ready = { enabled: true, missingSecrets: [] };
  assert.deepEqual(commandsStatus([]), { label: 'À configurer', variant: 'outline' });
  assert.deepEqual(commandsStatus([ready]), { label: 'Prêt', variant: 'secondary' });
  assert.deepEqual(commandsStatus([{ ...ready, enabled: false }]), {
    label: 'Désactivé',
    variant: 'outline',
  });
  assert.deepEqual(commandsStatus([ready, { enabled: true, missingSecrets: ['CODE'] }]), {
    label: 'À corriger',
    variant: 'destructive',
  });
  assert.deepEqual(commandsStatus([ready], 2), { label: '2 à valider', variant: 'default' });
});
