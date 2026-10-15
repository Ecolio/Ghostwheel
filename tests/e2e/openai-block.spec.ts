import { test, expect } from '@playwright/test';

test('le bouton bloque OpenAI, conserve son état après rechargement et permet de débloquer', async ({
  page,
}) => {
  // Le panneau complet, avec « Bloquer OpenAI », est celui de « Quand il écoute ».
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Bloquer OpenAI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autoriser OpenAI', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Autoriser OpenAI', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Autoriser OpenAI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bloquer OpenAI', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
