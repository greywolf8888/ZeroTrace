export function receiptIsCurrent(
  receipt: { exitCode: number; sourceFingerprint: string; sourceChangedDuringCheck: boolean },
  fingerprint: string,
): boolean {
  return (
    receipt.exitCode === 0 &&
    receipt.sourceFingerprint === fingerprint &&
    !receipt.sourceChangedDuringCheck
  );
}
