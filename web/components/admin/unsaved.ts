import { createContext, useContext, useEffect, useId } from 'react';

export type RegisterUnsaved = (key: string, dirty: boolean) => void;

export const UnsavedChangesContext = createContext<RegisterUnsaved>(() => {});

/** Signale un brouillon non enregistré : l’admin demande confirmation avant de quitter la rubrique. */
export function useUnsavedChanges(dirty: boolean) {
  const register = useContext(UnsavedChangesContext);
  const key = useId();
  useEffect(() => {
    register(key, dirty);
    return () => register(key, false);
  }, [register, key, dirty]);
}
