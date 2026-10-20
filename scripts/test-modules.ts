/**
 * Lance les tests des modules externes (`<dossier>/*\/*.test.ts`) avec la résolution
 * des alias `#cornelius/…` vers ce dépôt, même si le dépôt de modules a son propre
 * package.json. Le dossier est celui que charge le serveur (`CORNELIUS_MODULES_DIR`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { externalAddonsRoot } from '../server/addons/registry.js';

const root = externalAddonsRoot();
if (!existsSync(root)) {
  console.error(`Dossier des modules externes introuvable : ${root}`);
  process.exit(1);
}
// Le motif de --test veut des barres obliques, y compris sous Windows.
const pattern = `${relative(process.cwd(), root).split(sep).join('/') || '.'}/*/*.test.ts`;
const result = spawnSync(
  process.execPath,
  [
    // node:sqlite est encore « expérimental » : l'avertissement encombrerait chaque test.
    '--disable-warning=ExperimentalWarning',
    '--import',
    'tsx',
    '--import',
    './server/addons/core-imports.ts',
    '--test',
    pattern,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
