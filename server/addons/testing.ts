/**
 * Ce dont les tests d'un module ont besoin, exposé par l'alias `#cornelius/testing` :
 * la validation du contrat, une base en mémoire et l'exécution réelle du cœur. Un
 * module externe s'y teste donc comme un module livré, sans chemin vers `server/`.
 */
export { AddonRuntime } from './runtime.js';
export { validateAddonDefinition } from './registry.js';
export { AddonRepository, openDatabase } from '../storage.js';
