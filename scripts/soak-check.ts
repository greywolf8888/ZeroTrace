if (process.env.ZERO_TRACE_SOAK !== '1') {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'NOT_RUN',
        reason: '24h Soak 需要固定硬件与 ZERO_TRACE_SOAK=1。未运行不得记 PASS。',
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
  process.exit();
}

process.stderr.write('Soak runner is not wired to a 24h harness in this SHA.\n');
process.exitCode = 2;
