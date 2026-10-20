import { registerHooks } from 'node:module';

/**
 * Les modules importent le contrat par `#cornelius/addons` (champ `imports` du
 * package.json). Node résout ces alias depuis le package.json le plus proche du
 * fichier importateur : un module externe, hors du dépôt ou dans un dépôt doté de
 * son propre package.json, ne les trouverait pas. On les résout donc depuis le cœur.
 * Importé par le registre, et par `--import` pour les tests des modules externes.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier.startsWith('#cornelius/')
      ? nextResolve(specifier, { ...context, parentURL: import.meta.url })
      : nextResolve(specifier, context);
  },
});
