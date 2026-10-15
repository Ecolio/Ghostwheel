import type { Page } from '@playwright/test';

/**
 * Le serveur de test démarre sans jetons Météo Concept ni PRIM. Ce catalogue les déclare
 * présents (ou absents) pour tester les formulaires de source sans dépendre du fichier .env ;
 * aucune collecte réelle n’est faite par ces tests.
 */
export async function withModuleTokens(page: Page, configured = true): Promise<void> {
  await page.route('**/api/admin/addons', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const catalog = (await response.json()) as {
      definitions?: { secrets?: { configured: boolean }[] }[];
    };
    for (const definition of catalog.definitions ?? [])
      for (const secret of definition.secrets ?? []) secret.configured = configured;
    await route.fulfill({ response, json: catalog });
  });
}
