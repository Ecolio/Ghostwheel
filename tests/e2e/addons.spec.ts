import { test, expect } from '@playwright/test';
import { withModuleTokens } from './module-tokens';

test('l’écran Modules propose la recherche d’arrêt et de direction sans soumettre le formulaire', async ({
  page,
}) => {
  await withModuleTokens(page);
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules' }).click();
  await page.locator('#module-transit > summary').click();
  await expect(page.getByText('Météo Concept')).toBeVisible();
  await expect(page.getByText('Île-de-France Mobilités')).toBeVisible();

  await page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Île-de-France Mobilités', { exact: true }) })
    .getByRole('button', { name: 'Ajouter une source' })
    .click();
  const stop = page.getByLabel('Arrêt');
  const direction = page.getByLabel('Direction');
  await expect(stop).toBeVisible();
  await expect(direction).toBeDisabled();
  await page.getByLabel('Nom affiché').fill('Bus test');

  const url = page.url();
  await stop.fill('Hôtel de Ville');
  await page.getByRole('button', { name: 'Chercher' }).first().click();
  // La recherche ne doit jamais soumettre le formulaire parent ni naviguer.
  await expect(page).toHaveURL(url);
  await expect(stop).toHaveValue('Hôtel de Ville');
  await expect(direction).toBeDisabled();
  // L'arrêt est obligatoire : impossible d'enregistrer sans sélection.
  await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toBeDisabled();
});
