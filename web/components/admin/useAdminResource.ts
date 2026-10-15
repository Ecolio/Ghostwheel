import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api';

/** Ressource lue au serveur ; voir ResourceState pour l’afficher. */
export interface AdminResource<T> {
  data: T | null;
  error: string | null;
  /** Vrai dès le premier rendu, jusqu’à la fin de la première lecture. */
  loading: boolean;
  reload: () => Promise<void>;
}

export function useAdminResource<T>(load: () => Promise<T>): AdminResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await load();
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (failure) {
      if (id === requestId.current) setError(errorMessage(failure));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
    return () => {
      requestId.current++;
    };
  }, [reload]);
  return { data, error, loading, reload };
}
