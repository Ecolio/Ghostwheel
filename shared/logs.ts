export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  source: string;
  event: string;
  details: Record<string, unknown>;
}
