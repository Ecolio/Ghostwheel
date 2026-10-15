import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Interpréteur d’un environnement virtuel créé à la racine du projet. */
export function venvPython(root: string, name: string, platform = process.platform): string {
  return join(root, name, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

/**
 * Python pour lancer un script d’installation. Debian, Ubuntu et Arch n’installent pas de
 * commande `python` : seulement `python3`. L’environnement de la perception (Python 3.12) est
 * préféré, puis `CORNELIUS_PYTHON`, puis le Python du système. `preferEnv` donne la priorité à
 * la variable : l’installateur d’images n’utilise que la bibliothèque standard.
 */
export function pythonCommand(
  root: string,
  options: {
    preferEnv?: boolean;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
  } = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const configured = env.CORNELIUS_PYTHON?.trim() || null;
  if (options.preferEnv && configured) return configured;
  const local = venvPython(root, '.venv', platform);
  if (exists(local)) return local;
  if (configured) return configured;
  return platform === 'win32' ? 'python' : 'python3';
}
