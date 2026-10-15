/** Hermes owns execution; Cornelius keeps only connection settings and task references. */
export interface AgentCapability {
  name: string;
  description: string;
  kind: 'toolset' | 'skill';
  tools: string[];
}

export interface AgentDiscovery {
  checkedAt: number;
  available: boolean;
  error: string | null;
  capabilities: AgentCapability[];
  catalogComplete: boolean;
  issues?: { kind: 'toolset' | 'skill'; message: string }[];
  approval: boolean;
  steer: boolean;
}

export interface AgentConnectionInput {
  url: string;
  token?: string;
  enabled: boolean;
  description: string;
  revision: number;
}

export interface AgentConnectionView {
  profileId: string;
  url: string;
  hasToken: boolean;
  enabled: boolean;
  description: string;
  revision: number;
  discovery: AgentDiscovery | null;
}

export type AgentTaskStatus =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

export interface AgentApproval {
  id: string;
  description: string;
}

export interface AgentTaskView {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: AgentTaskStatus;
  persistent: boolean;
  output: string | null;
  approval: AgentApproval | null;
  error: string | null;
}

export interface AgentAdminView {
  connection: AgentConnectionView;
  tasks: AgentTaskView[];
}

export const agentTaskLabels: Record<AgentTaskStatus, string> = {
  submitting: 'Envoi en cours',
  queued: 'En attente',
  running: 'En cours',
  waiting_for_approval: 'Accord demandé par Hermes',
  stopping: 'Arrêt demandé',
  completed: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
  unknown: 'État à vérifier',
};
