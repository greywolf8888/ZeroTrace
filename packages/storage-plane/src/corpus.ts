import type { CorpusTokenMetrics, MetadataStore } from './types.js';

export const CORPUS_CHECKPOINT_KEY = 'corpus/checkpoint';

export interface CorpusCheckpoint {
  index: number;
  completed: string[];
  metrics: CorpusTokenMetrics[];
  updatedAt: string;
}

export async function readCorpusCheckpoint(
  metadata: MetadataStore,
): Promise<CorpusCheckpoint | undefined> {
  const raw = await metadata.get(CORPUS_CHECKPOINT_KEY);
  if (raw === undefined) return undefined;
  return JSON.parse(raw) as CorpusCheckpoint;
}

export async function writeCorpusCheckpoint(
  metadata: MetadataStore,
  checkpoint: CorpusCheckpoint,
): Promise<void> {
  await metadata.put(CORPUS_CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

export function resumeTokens(all: readonly string[], checkpoint: CorpusCheckpoint | undefined): string[] {
  if (checkpoint === undefined) return [...all];
  const done = new Set(checkpoint.completed.map((item) => item.toLowerCase()));
  return all.filter((token) => !done.has(token.toLowerCase()));
}
