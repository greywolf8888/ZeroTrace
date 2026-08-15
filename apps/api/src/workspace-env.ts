import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseDotenv } from 'dotenv';

/**
 * npm workspace scripts run with the package directory as cwd, while local
 * ZeroTrace configuration lives at the repository root. Load the nearest
 * .env from the current directory upward without overriding explicit process
 * environment variables or merging unrelated parent-directory settings.
 */
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
