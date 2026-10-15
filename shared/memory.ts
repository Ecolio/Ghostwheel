export interface MemoryFact {
  id: string;
  profileId: string;
  topic: string;
  fact: string;
  scope: 'durable' | 'temporary';
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  evidence: { turnId: string; interactionId: string; startMs: number; endMs: number }[];
  origin: 'conversation' | 'admin';
}

export interface MemoryChange {
  operation: 'add' | 'update' | 'forget';
  memoryId: string | null;
  topic: string;
  fact: string | null;
  evidenceTurnIds: string[];
  scope: 'durable' | 'temporary';
  expiresAt: string | null;
}
export interface MemoryProposal {
  schemaVersion: 1;
  changes: MemoryChange[];
}
export interface MemoryTurn {
  id: string;
  profileId: string;
  version: number;
  text: string;
  startMs: number;
  endMs: number;
  /** Dernière phrase de Cornelius juste avant ce tour : contexte, jamais une preuve. */
  precededBy?: string;
}
export interface MemoryBatch {
  id: string;
  interactionId: string;
  profileId: string;
  version: number;
  status: 'extracting' | 'applied' | 'rejected' | 'failed' | 'cancelled';
  reason: string | null;
  createdAt: number;
}
export interface MemoryView {
  profileId: string;
  enabled: boolean;
  version: number;
  memories: MemoryFact[];
  batches: MemoryBatch[];
}
export interface MemoryEdit {
  version: number;
  topic: string;
  fact: string;
  scope: 'durable' | 'temporary';
  expiresAt: string | null;
}
