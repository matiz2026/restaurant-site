interface ImportMeta {
  url: string;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: Uint8Array): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export const sep: string;
}
