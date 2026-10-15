import { useEffect, useRef } from 'react';
import type { MirrorState } from '../../shared/types';
import { reportMeasure } from '../diagnostics';
import type { AudioLevels } from './session';
import { ConversationMeasures } from './measures';

/** Reports the recipe latencies and the display frame rate while a real session is ready. */
export function useMeasures(
  state: MirrorState | null,
  fresh: boolean,
  readAudio: () => AudioLevels,
) {
  const interactionId = state?.session.interactionId ?? undefined;
  const currentId = useRef(interactionId);
  currentId.current = interactionId;
  const measures = useRef<ConversationMeasures | null>(null);
  if (!measures.current)
    measures.current = new ConversationMeasures((name, value) =>
      reportMeasure(name, value, currentId.current),
    );
  const live = fresh;
  const phase = state?.voice.phase ?? 'idle';

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      measures.current?.sample(readAudio().output, Date.now());
    }, 50);
    return () => clearInterval(timer);
  }, [live, readAudio]);

  useEffect(() => {
    if (live) measures.current?.onPhase(phase, Date.now());
    else measures.current?.reset();
  }, [live, phase]);

  useEffect(() => {
    if (!live) return;
    let frames = 0;
    let last = performance.now();
    let handle = requestAnimationFrame(function loop(at) {
      frames++;
      if (at - last >= 5_000) {
        reportMeasure('images', Math.round((frames * 1000) / (at - last)), currentId.current);
        frames = 0;
        last = at;
      }
      handle = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(handle);
  }, [live]);
}
