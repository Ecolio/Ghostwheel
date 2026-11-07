import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pythonCommand, venvPython } from './python.js';
import { createInterface } from 'node:readline';
import {
  IMAGE_GENERATION_MODELS,
  type ImageGenerationModel,
  type ModelDownload,
} from '../shared/types.js';
import type { ImageGeneration } from './image-generation.js';

export type ImageInstallerLauncher = (model: ImageGenerationModel) => ChildProcess;
export type ImageWorkerLauncher = (token: string, origin: string) => ChildProcess;

/** Installe les modèles et garde le worker Diffusers vivant sans commande manuelle. */
export class ImageGenerationRuntime {
  private installer: ChildProcess | null = null;
  private worker: ChildProcess | null = null;
  private active: ImageGenerationModel | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly states: Record<ImageGenerationModel, ModelDownload>;

  constructor(
    private readonly generation: ImageGeneration,
    private readonly changed: () => void,
    private readonly token: string,
    private readonly origin: string,
    private readonly root = resolve('.'),
    private readonly launchInstaller: ImageInstallerLauncher = (model) =>
      spawn(
        pythonCommand(root, { preferEnv: true }),
        [join(root, 'image_generation/install.py'), '--model', model, '--json'],
        {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUTF8: '1' },
        },
      ),
    private readonly launchWorker: ImageWorkerLauncher = (workerToken, workerOrigin) => {
      const python = venvPython(root, '.venv-image');
      return spawn(python, [join(root, 'image_generation/worker.py'), '--origin', workerOrigin], {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          CORNELIUS_IMAGE_GENERATION_TOKEN: workerToken,
        },
      });
    },
  ) {
    this.states = Object.fromEntries(
      IMAGE_GENERATION_MODELS.map((model) => [
        model,
        {
          state: this.installed(model) ? 'present' : 'missing',
          file: null,
          completed: 0,
          files: 2,
          received: 0,
          total: null,
          error: null,
        },
      ]),
    ) as Record<ImageGenerationModel, ModelDownload>;
    queueMicrotask(() => this.sync());
  }

  snapshot() {
    return structuredClone(this.states);
  }

  ensure(model: ImageGenerationModel) {
    if (this.stopped) throw new Error('Le serveur est en cours d’arrêt.');
    const unavailable = this.generation.snapshot().localUnavailable;
    if (unavailable) throw new Error(unavailable);
    if (this.active === model) return;
    if (this.active)
      throw new Error(
        'Une installation est déjà en cours. Attendez sa fin avant de changer de modèle.',
      );
    this.active = model;
    this.states[model] = {
      ...this.states[model],
      state: 'checking',
      file: 'Environnement Python isolé',
      completed: 0,
      files: 2,
      received: 0,
      total: null,
      error: null,
    };
    this.changed();
    let child: ChildProcess;
    try {
      child = this.launchInstaller(model);
    } catch (error) {
      this.finish(model, String(error));
      return;
    }
    this.installer = child;
    let stderr = '';
    let ready = false;
    const lines = child.stdout ? createInterface({ input: child.stdout }) : null;
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000);
    });
    lines?.on('line', (line) => {
      if (this.stopped || this.installer !== child) return;
      try {
        const event = JSON.parse(line) as Partial<ModelDownload>;
        if (!['checking', 'downloading', 'ready'].includes(event.state ?? '')) return;
        if (event.state === 'ready') {
          ready = true;
          return;
        }
        const number = (value: unknown, fallback: number) =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
        this.states[model] = {
          ...this.states[model],
          state: event.state!,
          file: typeof event.file === 'string' ? event.file.slice(0, 180) : null,
          completed: number(event.completed, this.states[model].completed),
          files: number(event.files, 2),
          received: number(event.received, 0),
          total: event.total == null ? null : number(event.total, 0),
          error: null,
        };
        this.changed();
      } catch {
        /* Seules les lignes JSON du protocole pilotent l’interface. */
      }
    });
    child.once('error', (error) => {
      lines?.close();
      if (this.installer !== child) return;
      this.finish(model, 'Impossible de lancer Python : ' + error.message);
    });
    child.once('close', (code) => {
      lines?.close();
      if (this.installer !== child) return;
      this.finish(
        model,
        code === 0 && ready && this.installed(model)
          ? null
          : stderr.trim() ||
              'Installation interrompue. Réessayez ; les fichiers déjà téléchargés sont conservés.',
      );
    });
  }

  /** Applique activation/modèle : coupe la VRAM si désactivé, démarre si tout est prêt. */
  sync(restart = false) {
    if (this.stopped) return;
    const status = this.generation.snapshot();
    const ready = ['present', 'ready'].includes(this.states[status.model].state);
    // Images confiées à OpenAI : le générateur local s’arrête et libère la mémoire graphique.
    if (!status.enabled || !ready || status.provider === 'openai') {
      this.stopWorker();
      return;
    }
    if (restart) this.stopWorker();
    if (this.worker || this.restartTimer) return;
    this.states[status.model].error = null;
    try {
      const child = this.launchWorker(this.token, this.origin);
      this.worker = child;
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-1200);
      });
      child.once('error', () => {
        if (this.worker === child) this.worker = null;
      });
      child.once('close', () => {
        if (this.worker !== child) return;
        this.worker = null;
        if (stderr.trim()) this.states[status.model].error = stderr.trim().slice(-1200);
        this.changed();
        if (!this.stopped && this.generation.snapshot().enabled) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.sync();
          }, 2000);
          this.restartTimer.unref();
        }
      });
    } catch (error) {
      this.states[status.model].error = String(error).slice(0, 600);
      this.changed();
    }
  }

  private installed(model: ImageGenerationModel) {
    const python = venvPython(this.root, '.venv-image');
    return (
      existsSync(python) &&
      existsSync(join(this.root, 'models', 'image-generation', model, '.cornelius-ready'))
    );
  }

  private finish(model: ImageGenerationModel, error: string | null) {
    if (this.stopped || this.active !== model) return;
    this.active = null;
    this.installer = null;
    this.states[model] = {
      ...this.states[model],
      state: error ? 'failed' : 'ready',
      file: null,
      completed: error ? this.states[model].completed : 2,
      // La fin de la sortie porte l’exception Python : c’est elle que « Voir les détails » montre.
      error: error?.slice(-2000) ?? null,
    };
    this.changed();
    if (!error && this.generation.snapshot().model === model) this.sync(true);
  }

  private stopWorker() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
  }

  dispose() {
    this.stopped = true;
    this.installer?.kill();
    this.installer = null;
    this.stopWorker();
  }
}
