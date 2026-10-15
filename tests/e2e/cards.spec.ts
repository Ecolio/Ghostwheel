import { expect, test } from '@playwright/test';
import { origin } from './env';

test('le module Cartes règle le nombre de cartes, leur durée et leur taille', async ({ page }) => {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  try {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    const summary = page.locator('#module-cards > summary');
    await expect(summary).toContainText('3 cartes · 1 minute');
    await summary.click();
    await page.getByLabel('Cartes à l’écran').selectOption('2');
    await expect(summary).toContainText('2 cartes · 1 minute');
    await page.getByLabel('Disparition après').selectOption('300000');
    await expect(summary).toContainText('2 cartes · 5 minutes');
    const compact = page.getByRole('switch', { name: 'Raccourcir les cartes au second plan' });
    await expect(compact).toBeChecked();
    await compact.click();
    await expect(compact).not.toBeChecked();
    await page.getByLabel('Cartes à l’écran').selectOption('1');
    await expect(compact).toBeDisabled();
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(page.locator('#module-cards > summary')).toContainText('1 carte · 5 minutes');
  } finally {
    await page.request.patch('/api/admin/cards', {
      headers: { origin },
      data: { maxCards: 3, compactSecondary: true, lifetimeMs: 60_000 },
    });
  }
});
