const baseUrl = (process.env.HEALTH_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS ?? 10_000);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const [live, ready] = await Promise.all([
    fetch(baseUrl + '/health/live', { signal: controller.signal }),
    fetch(baseUrl + '/health/ready', { signal: controller.signal }),
  ]);
  if (!live.ok || !ready.ok) {
    throw new Error('Health endpoints returned HTTP ' + live.status + '/' + ready.status + '.');
  }
  const livePayload = await live.json();
  const readyPayload = await ready.json();
  if (livePayload.readOnly !== true || readyPayload.readOnly !== true) {
    throw new Error('Read-only safety invariant is not present in health responses.');
  }
  process.stdout.write(
    JSON.stringify(
      {
        live: livePayload.status,
        ready: readyPayload.status,
        readOnly: true,
        providers: Array.isArray(readyPayload.providers) ? readyPayload.providers.length : 0,
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown health-check failure.';
  process.stderr.write('ZeroTrace health check failed: ' + message + '\n');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
