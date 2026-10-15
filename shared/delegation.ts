export const DELEGATION_MODES = ['normal', 'fast', 'ultrafast'] as const;
export type DelegationMode = (typeof DELEGATION_MODES)[number];
export const DEFAULT_DELEGATION_MODE: DelegationMode = 'fast';

export function isDelegationMode(value: unknown): value is DelegationMode {
  return DELEGATION_MODES.some((mode) => mode === value);
}
