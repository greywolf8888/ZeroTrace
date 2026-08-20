import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { MetadataStore } from './types.js';

export class JsonFileMetadataStore implements MetadataStore {
  constructor(private readonly rootDir: string) {}

  #path(key: string): string {
    const parts = key.split('/').filter((part) => part.length > 0).map((part) =>
      part.replaceAll(':', '_').replaceAll('?', '_').replaceAll('*', '_'),
    );
    return join(this.rootDir, 'control', ...parts) + '.json';
  }

  async get(key: string): Promise<string | undefined> {
    try {
      return readFileSync(this.#path(key), 'utf8');
    } catch {
      return undefined;
    }
  }

  async put(key: string, value: string): Promise<void> {
    const path = this.#path(key);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, value);
    renameSync(temp, path);
  }

  async list(prefix: string): Promise<string[]> {
    const root = join(this.rootDir, 'control');
    const out: string[] = [];
    const walk = (dir: string, rel: string): void => {
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
      } catch {
        return;
      }
      for (const entry of entries) {
        const nextRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, nextRel);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const key = nextRel.replace(/\.json$/, '');
        if (key.startsWith(prefix)) out.push(key);
      }
    };
    walk(root, '');
    return out.sort();
  }
}
