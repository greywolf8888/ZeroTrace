import type { FlapLifetimeWorkerConfig } from './lifetime-config.js';
import { loadFlapLifetimeWorkerConfig } from './lifetime-config.js';
import { integer } from './config.js';

export interface FlapLifetimeHeadWorkerConfig extends FlapLifetimeWorkerConfig {
  requiredSources: number;
  intervalMs: number;
  maxCycles?: number;
}

interface HeadArguments {
  intervalMs?: string;
  maxCycles?: string;
  lifetimeArgs: string[];
}

function splitArguments(args: readonly string[]): HeadArguments {
  const lifetimeArgs: string[] = [];
  const result: HeadArguments = { lifetimeArgs };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument ?? ''}.`);
    }
    index += 1;
    if (argument === '--interval-ms') result.intervalMs = value;
    else if (argument === '--max-cycles') result.maxCycles = value;
    else lifetimeArgs.push(argument ?? '', value);
  }
  return result;
}

export function loadFlapLifetimeHeadWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): FlapLifetimeHeadWorkerConfig {
  const parsed = splitArguments(args);
  const lifetime = loadFlapLifetimeWorkerConfig(env, parsed.lifetimeArgs);
  if (lifetime.targetBlock !== undefined) {
    throw new Error('Continuous Flap lifetime heads may not pin --target.');
  }
  const requiredSources = integer(
    env.DATA_QUALITY_MIN_SOURCES,
    'DATA_QUALITY_MIN_SOURCES',
    2,
    2,
    20,
  );
  if (lifetime.bscRpcUrls.length < requiredSources) {
    throw new Error('Continuous Flap lifetime heads require enough distinct BSC RPC URLs.');
  }
  const intervalMs = integer(
    parsed.intervalMs ?? env.FLAP_LIFETIME_HEAD_INTERVAL_MS,
    '--interval-ms',
    60_000,
    1_000,
    86_400_000,
  );
  const maxCyclesInput =
    parsed.maxCycles ?? (env.FLAP_LIFETIME_HEAD_MAX_CYCLES?.trim() || undefined);
  const maxCycles =
    maxCyclesInput === undefined
      ? undefined
      : integer(maxCyclesInput, '--max-cycles', undefined, 1, 1_000_000);
  return {
    ...lifetime,
    requiredSources,
    intervalMs,
    ...(maxCycles === undefined ? {} : { maxCycles }),
  };
}
