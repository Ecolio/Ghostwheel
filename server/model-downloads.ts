import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pythonCommand } from './python.js';
import {
  VISION_MODELS,
  type ModelDownload,
  type VisionDevice,
  type VisionModel,
} from '../shared/types.js';

interface ManifestModel {
  id?: VisionModel;
  name: string;
  shared?: { name: string }[];
  files?: { name: string }[];
  gpuFiles?: { name: string }[];
}
export type ModelLauncher = (model: VisionModel, device: VisionDevice) => ChildProcess;

/** One installer at a time. The Python CLI owns hashes, temporary files and pinned URLs. */
export class ModelDownloads {
  private process: ChildProcess | null = null;
  private active: { model: VisionModel; device: VisionDevice } | null = null;
  private stopped = false;
  private states: Record<VisionModel, ModelDownload>;
  constructor(
    private readonly changed: () => void,
    private readonly installed: (model: VisionModel) => void,
    root = resolve('.'),
    private readonly launch: ModelLauncher = (model, device) => {
      return spawn(
        // Le téléchargeur interroge ONNX Runtime : l’environnement de la perception d’abord.
        pythonCommand(root),
        [
          join(root, 'perception/download_models.py'),
          '--model',
          model,
          '--device',
          device,
          '--vision-only',
          '--json',
        ],
        {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUTF8: '1' },
        },
      );
    },
  ) {
    const manifest = JSON.parse(
      readFileSync(join(root, 'perception/models.json'), 'utf8'),
    ) as ManifestModel[];
    this.states = Object.fromEntries(
      VISION_MODELS.map((id) => {
        const model = manifest.find((entry) => entry.id === id)!;
        const variants = [
          { variant: 'gpu' as const, files: [...(model.shared ?? []), ...(model.gpuFiles ?? [])] },
          { variant: 'cpu' as const, files: [...(model.shared ?? []), ...(model.files ?? [])] },
        ];
        const installed = variants.find(
          (candidate) =>
            candidate.files.length > (model.shared?.length ?? 0) &&
            candidate.files.every((file) => {
              try {
                return statSync(join(root, 'models', model.name, file.name)).size > 0;
              } catch {
                return false;
              }
            }),
        );
        const files = installed?.files ?? variants[1]!.files;
        return [
          id,
          {
            state: installed ? 'present' : 'missing',
            file: null,
            completed: 0,
            files: files.length,
            received: 0,
            total: null,
            error: null,
            variant: installed?.variant ?? null,
          },
        ];
      }),
    ) as Record<VisionModel, ModelDownload>;
  }
  snapshot() {
    return structuredClone(this.states);
  }
  ensure(model: VisionModel, device: VisionDevice = 'auto') {
    if (this.stopped) throw new Error('Le serveur est en cours d’arrêt.');
    if (this.active?.model === model && this.active.device === device) return;
    if (this.active)
      throw new Error('Une installation est en cours. Attendez sa fin avant de changer de modèle.');
    this.active = { model, device };
    this.states[model] = {
      ...this.states[model],
      state: 'checking',
      file: null,
      completed: 0,
      received: 0,
      total: null,
      error: null,
      variant: device === 'auto' ? null : device,
    };
    this.changed();
    let child: ChildProcess;
    try {
      child = this.launch(model, device);
    } catch (error) {
      this.finish(model, String(error));
      return;
    }
    this.process = child;
    let stderr = '';
    let ready = false;
    const lines = child.stdout ? createInterface({ input: child.stdout }) : null;
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-1200);
    });
    lines?.on('line', (line) => {
      if (this.stopped || this.process !== child) return;
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
          completed: number(event.completed, 0),
          files: number(event.files, this.states[model].files),
          received: number(event.received, 0),
          total: event.total == null ? null : number(event.total, 0),
          variant:
            event.variant === 'cpu' || event.variant === 'gpu'
              ? event.variant
              : this.states[model].variant,
        };
        this.changed();
      } catch {
        /* Non-protocol output cannot change the installation state. */
      }
    });
    child.once('error', (error) => {
      lines?.close();
      if (this.process !== child) return;
      this.finish(model, 'Impossible de lancer Python : ' + error.message);
    });
    child.once('close', (code) => {
      lines?.close();
      if (this.process !== child) return;
      this.finish(
        model,
        code === 0 && ready
          ? null
          : stderr.trim() ||
              'Installation interrompue. Réessayez ; les fichiers vérifiés seront conservés.',
      );
    });
  }
  private finish(model: VisionModel, error: string | null) {
    if (this.stopped || this.active?.model !== model) return;
    this.active = null;
    this.process = null;
    this.states[model] = {
      ...this.states[model],
      state: error ? 'failed' : 'ready',
      error: error?.slice(0, 600) ?? null,
      file: null,
    };
    if (!error) this.installed(model);
    this.changed();
  }
  dispose() {
    this.stopped = true;
    this.process?.kill();
    this.process = null;
  }
}
