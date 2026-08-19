# ADR 0003 — ForensicFinding 与 ReportEnvelope

- Status: Accepted
- Date: 2026-08-19

所有盘面结构结论进入 `ReportEnvelope`：Snapshot、CoverageVector、sourceSet、sourceIndependence、evidenceClosure、model/policy version、replayRef。发现区分 ONCHAIN_FACT / DETERMINISTIC_DERIVATION / MODEL_HYPOTHESIS / ANALYST_FINDING。分析员认定只追加新版本。PostgreSQL `037_forensic_reports.sql` 以证据存在性守卫持久化不可变报告。
