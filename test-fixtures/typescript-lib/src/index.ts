export interface Logger {
  level: LogLevel;
  prefix?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export enum Color {
  Red,
  Green,
  Blue,
}

export interface Result<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export function makeLogger(level: LogLevel, prefix?: string): Logger {
  return { level, prefix };
}

export const log = (logger: Logger, message: string): void => {
  console.log(`[${logger.level}] ${logger.prefix ?? ""} ${message}`);
};

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Cache<V> {
  size: number = 0;
  private store: Map<string, V> = new Map();

  get(key: string): V | undefined {
    return this.store.get(key);
  }

  set(key: string, value: V): void {
    this.store.set(key, value);
    this.size = this.store.size;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.size = 0;
  }
}
