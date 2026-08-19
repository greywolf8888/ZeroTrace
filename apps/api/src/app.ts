import type { FastifyInstance } from 'fastify';

import { createApp as createAppImpl } from './create-app-impl.js';
import type { CreateAppOptions } from './create-app-impl.js';

export type { CreateAppOptions } from './create-app-impl.js';

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  return createAppImpl(options);
}
