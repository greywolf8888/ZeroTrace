import { probeProvider, type ProbeTransport } from './probe.js';
import type { BoundEndpoint, ProviderCapabilitySnapshot } from './types.js';

export class ProviderCapabilityProbe {
  constructor(private readonly transport: ProbeTransport) {}

  async snapshot(
    binding: BoundEndpoint,
    input: {
      chainId: string;
      timeoutMs: number;
      maxResponseBytes: number;
      logsPolicyDenied: boolean;
      traceConfigured: boolean;
    },
  ): Promise<ProviderCapabilitySnapshot> {
    return probeProvider(binding, this.transport, input);
  }
}
