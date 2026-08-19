import type { Registry } from 'prom-client';

import type { AppConfig } from '../config.js';
import type { AppRuntime } from '../runtime.js';
import type { ForensicReportStore } from '../plugins/market-structure.js';
import type { createHealthProbes } from './health.js';

export interface AppHttpContext extends ReturnType<typeof createHealthProbes> {
  runtime: AppRuntime;
  config: AppConfig;
  metricsRegistry: Registry;
  forensicReports?: ForensicReportStore;
}
