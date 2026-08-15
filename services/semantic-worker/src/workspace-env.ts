import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseDotenv } from 'dotenv';

/** Load repository-root .env values when npm executes this workspace directly. */
export function loadWorkspaceEnv(cwd = process.cwd()): void {
  const candidates = [
    resolve(cwd, '.env'),
    resolve(cwd, '..', '.env'),
    resolve(cwd, '..', '..', '.env'),
    resolve(cwd, '..', '..', '..', '.env'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const values = parseDotenv(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
    break;
  }
}
