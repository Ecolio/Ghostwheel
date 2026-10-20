/**
 * Module d'essai des parcours navigateur : un dossier de modules externes à lui seul
 * (CORNELIUS_MODULES_DIR de playwright.config.ts). Il exerce les champs du formulaire :
 * liste déroulante, choix facultatif, liste répétée d'objets.
 */
import type { AddonDefinition } from '#cornelius/addons';

type Bac = { bac: 'verre' | 'emballages'; jours: string };
type FormulaireConfig = { jour: 'lundi' | 'mardi'; carburant: string | null; bacs: Bac[] };

const addon: AddonDefinition<FormulaireConfig, { bacs: number }> = {
  id: 'formulaire',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Formulaire d’essai',
  display: {
    name: 'Formulaire d’essai',
    description: 'Module des parcours navigateur : listes déroulantes et listes répétées.',
    icon: 'package',
    group: 'home',
    example: { label: 'Essai', ref: 'essai' },
  },
  configVersion: 1,
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['jour', 'carburant', 'bacs'],
    properties: {
      jour: {
        title: 'Jour',
        type: 'string',
        oneOf: [
          { const: 'lundi', title: 'Lundi' },
          { const: 'mardi', title: 'Mardi' },
        ],
      },
      carburant: {
        title: 'Carburant',
        type: ['string', 'null'],
        oneOf: [
          { const: null, title: 'Tous' },
          { const: 'gazole', title: 'Gazole' },
          { const: 'sp98', title: 'SP98' },
        ],
      },
      bacs: {
        title: 'Bacs',
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['bac', 'jours'],
          properties: {
            bac: { title: 'Bac', type: 'string', enum: ['verre', 'emballages'] },
            jours: { title: 'Jours', type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
  },
  configDefaults: { jour: 'lundi', carburant: null, bacs: [{ bac: 'verre', jours: 'lundi' }] },
  dataVersion: 1,
  dataSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bacs'],
    properties: { bacs: { type: 'integer', minimum: 0 } },
  },
  freshMs: 60_000,
  tools: [
    {
      name: 'read',
      description: 'Lire le formulaire d’essai.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    return {
      data: { bacs: context.config.bacs.length },
      source: { provider: 'essai', sourceId: 'formulaire' },
    };
  },
  present(snapshot) {
    return {
      title: 'Formulaire d’essai',
      primaryValue: `${snapshot.data?.bacs ?? 0} bacs`,
      subtitle: null,
      description: null,
      items: [],
      summary: 'Formulaire d’essai.',
      sources: ['formulaire'],
    };
  },
};

export default addon;
