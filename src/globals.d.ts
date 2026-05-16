// ─── Ambient declarations for utilities-library ──────────────
// The git-installed package may not have .d.ts files available.
// This provides type coverage for the imports we use.

declare module "@rodrigo-barraza/utilities-library/node" {
  export interface Logger {
    info(...args: unknown[]): void;
    success(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  }

  export function createLogger(namespace: string): Logger;
}
