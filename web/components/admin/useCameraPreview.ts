import { useEffect, useState } from 'react';

/**
 * Aperçu local de la caméra du miroir, image par image, seulement tant qu’il est affiché et
 * que l’onglet est visible. Aucune image n’est conservée.
 */
export function useCameraPreview(enabled: boolean) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const [frame, setFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(
    () => () => {
      if (frame) URL.revokeObjectURL(frame);
    },
    [frame],
  );
  useEffect(() => {
    setFrame(null);
    setError(null);
    if (!enabled || !visible) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = async () => {
      let retry = 250;
      try {
        const response = await fetch('/api/admin/camera/frame', {
          signal: abort.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setError('Reconnectez l’administration pour voir la caméra.');
            return;
          }
          throw new Error('Aucune image récente. Vérifiez que la caméra est disponible.');
        }
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        setFrame(URL.createObjectURL(blob));
        setError(null);
      } catch {
        if (abort.signal.aborted) return;
        setFrame(null);
        setError('Aucune image récente. Vérifiez que la caméra est disponible.');
        retry = 1000;
      }
      if (!abort.signal.aborted)
        timer = setTimeout(() => {
          void next();
        }, retry);
    };
    void next();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [enabled, visible]);
  return { frame, error, visible };
}
