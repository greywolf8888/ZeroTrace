//! Query planner: local index first, RPC only for gaps and load-bearing quorum.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_provider_scheduler::{ProviderScheduler, ScheduleKey, SchedulerError};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PlanError {
    #[error(transparent)]
    Scheduler(#[from] SchedulerError),
    #[error("direct provider access is forbidden outside the scheduler")]
    DirectProviderForbidden,
    #[error("estimated RPC cost exceeds admission budget")]
    AdmissionDenied,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceKind {
    LocalIndex,
    ContentCache,
    ArchiveNode,
    IndependentOperator,
    BulkDataset,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub source: SourceKind,
    pub method: String,
    pub estimated_rpc_cost: f64,
    pub load_bearing: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryPlan {
    pub steps: Vec<PlanStep>,
    pub estimated_rpc_cost: f64,
    pub local_index_first: bool,
}

pub fn plan_token_scan(has_local_index: bool, needs_quorum: bool) -> QueryPlan {
    let mut steps = Vec::new();
    if has_local_index {
        steps.push(PlanStep {
            id: "local-index".into(),
            source: SourceKind::LocalIndex,
            method: "index.scan".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        });
        steps.push(PlanStep {
            id: "cache".into(),
            source: SourceKind::ContentCache,
            method: "cache.get".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        });
    }
    if !has_local_index {
        steps.push(PlanStep {
            id: "archive-gap".into(),
            source: SourceKind::ArchiveNode,
            method: "eth_getLogs".into(),
            estimated_rpc_cost: 12.0,
            load_bearing: needs_quorum,
        });
    }
    if needs_quorum {
        steps.push(PlanStep {
            id: "independent-verify".into(),
            source: SourceKind::IndependentOperator,
            method: "eth_getBlockByHash".into(),
            estimated_rpc_cost: 2.0,
            load_bearing: true,
        });
    }
    let estimated_rpc_cost = steps.iter().map(|step| step.estimated_rpc_cost).sum();
    QueryPlan {
        steps,
        estimated_rpc_cost,
        local_index_first: has_local_index,
    }
}

pub fn plan_corpus_discovery(bulk_available: bool, token_count: u32) -> QueryPlan {
    let mut steps = vec![
        PlanStep {
            id: "local-index".into(),
            source: SourceKind::LocalIndex,
            method: "index.scan".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        },
        PlanStep {
            id: "cache".into(),
            source: SourceKind::ContentCache,
            method: "cache.get".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        },
    ];
    if bulk_available {
        steps.push(PlanStep {
            id: "bulk-dataset".into(),
            source: SourceKind::BulkDataset,
            method: format!("dataset.scan:{token_count}"),
            estimated_rpc_cost: 1.0,
            load_bearing: false,
        });
    }
    steps.push(PlanStep {
        id: "rpc-code-verify".into(),
        source: SourceKind::IndependentOperator,
        method: "eth_getCode".into(),
        estimated_rpc_cost: 2.0,
        load_bearing: true,
    });
    let estimated_rpc_cost = steps.iter().map(|step| step.estimated_rpc_cost).sum();
    QueryPlan {
        steps,
        estimated_rpc_cost,
        local_index_first: true,
    }
}

pub fn plan_lifetime_history(coverage_complete: bool, bulk_available: bool) -> QueryPlan {
    let mut steps = vec![
        PlanStep {
            id: "local-index".into(),
            source: SourceKind::LocalIndex,
            method: "index.scan".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        },
        PlanStep {
            id: "cache".into(),
            source: SourceKind::ContentCache,
            method: "cache.get".into(),
            estimated_rpc_cost: 0.0,
            load_bearing: false,
        },
    ];
    if !coverage_complete && bulk_available {
        steps.push(PlanStep {
            id: "bulk-dataset".into(),
            source: SourceKind::BulkDataset,
            method: "dataset.scan".into(),
            estimated_rpc_cost: 1.0,
            load_bearing: false,
        });
    }
    let estimated_rpc_cost = steps.iter().map(|step| step.estimated_rpc_cost).sum();
    QueryPlan {
        steps,
        estimated_rpc_cost,
        local_index_first: true,
    }
}

pub fn admit_plan(
    scheduler: &mut ProviderScheduler,
    plan: &QueryPlan,
    now_ms: u64,
) -> Result<(), PlanError> {
    scheduler.require_quorum(plan.steps.iter().any(|step| step.load_bearing))?;
    if plan.estimated_rpc_cost > scheduler.budget_remaining {
        return Err(PlanError::AdmissionDenied);
    }
    for step in &plan.steps {
        if step.estimated_rpc_cost == 0.0 {
            continue;
        }
        let key = ScheduleKey {
            chain: "eip155:56".into(),
            block_hash: "local-or-pinned".into(),
            method: step.method.clone(),
            canonical_params: step.id.clone(),
            adapter_version: "planner-v1".into(),
        };
        let _ = scheduler.admit(now_ms, &key, step.estimated_rpc_cost, step.load_bearing)?;
    }
    Ok(())
}

/// Columnar in-memory batch used until DataFusion SessionContext is wired to Parquet.
#[derive(Clone, Debug)]
pub struct ColumnBatch {
    pub block_number: Vec<u64>,
    pub address_id: Vec<u32>,
}

impl ColumnBatch {
    pub fn filter_address(&self, address_id: u32) -> ColumnBatch {
        let mut block_number = Vec::new();
        let mut ids = Vec::new();
        for (index, id) in self.address_id.iter().enumerate() {
            if *id == address_id {
                block_number.push(self.block_number[index]);
                ids.push(*id);
            }
        }
        ColumnBatch {
            block_number,
            address_id: ids,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoverageSpan {
    pub start_block: u64,
    pub end_block: u64,
}

pub fn merge_spans(spans: &[CoverageSpan]) -> Vec<CoverageSpan> {
    let mut ordered = spans.to_vec();
    ordered.sort_by_key(|span| (span.start_block, span.end_block));
    let mut merged: Vec<CoverageSpan> = Vec::new();
    for span in ordered {
        match merged.last_mut() {
            Some(last) if span.start_block <= last.end_block.saturating_add(1) => {
                last.end_block = last.end_block.max(span.end_block);
            }
            _ => merged.push(span),
        }
    }
    merged
}

pub fn coverage_gaps(spans: &[CoverageSpan], start: u64, end: u64) -> Vec<CoverageSpan> {
    if end < start {
        return Vec::new();
    }
    let merged = merge_spans(spans);
    let mut gaps = Vec::new();
    let mut cursor = start;
    for span in merged {
        if span.end_block < cursor {
            continue;
        }
        if span.start_block > cursor {
            gaps.push(CoverageSpan {
                start_block: cursor,
                end_block: span.start_block.saturating_sub(1),
            });
        }
        cursor = cursor.max(span.end_block.saturating_add(1));
        if cursor > end {
            break;
        }
    }
    if cursor <= end {
        gaps.push(CoverageSpan {
            start_block: cursor,
            end_block: end,
        });
    }
    gaps
}

pub fn coverage_complete(spans: &[CoverageSpan], start: u64, end: u64) -> bool {
    coverage_gaps(spans, start, end).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use zerotrace_provider_scheduler::ProviderRecord;

    #[test]
    fn lifetime_history_is_local_when_coverage_complete() {
        let plan = plan_lifetime_history(true, true);
        assert_eq!(plan.estimated_rpc_cost, 0.0);
        assert!(!plan.steps.iter().any(|step| step.method == "eth_getLogs"));
        let gap = plan_lifetime_history(false, true);
        assert!(gap
            .steps
            .iter()
            .any(|step| step.source == SourceKind::BulkDataset));
        assert!(!gap.steps.iter().any(|step| step.method == "eth_getLogs"));
    }

    #[test]
    fn local_index_avoids_genesis_rpc() {
        let plan = plan_token_scan(true, true);
        assert!(plan.local_index_first);
        assert!(plan
            .steps
            .iter()
            .any(|step| step.source == SourceKind::LocalIndex));
        assert!(!plan.steps.iter().any(|step| step.id == "archive-gap"));
    }

    #[test]
    fn corpus_discovery_uses_bulk_dataset_not_public_logs() {
        let with_bulk = plan_corpus_discovery(true, 50);
        assert!(with_bulk
            .steps
            .iter()
            .any(|step| step.source == SourceKind::BulkDataset));
        assert!(!with_bulk
            .steps
            .iter()
            .any(|step| step.method == "eth_getLogs"));
        let without_bulk = plan_corpus_discovery(false, 50);
        assert!(!without_bulk
            .steps
            .iter()
            .any(|step| step.method == "eth_getLogs"));
        assert!(without_bulk.local_index_first);
    }

    #[test]
    fn vectorized_filter_keeps_matching_rows() {
        let batch = ColumnBatch {
            block_number: vec![1, 2, 3],
            address_id: vec![9, 4, 9],
        };
        let filtered = batch.filter_address(9);
        assert_eq!(filtered.block_number, vec![1, 3]);
    }

    #[test]
    fn admission_requires_two_independence_groups() {
        let mut scheduler = ProviderScheduler::new(
            vec![ProviderRecord {
                operator_id: "a".into(),
                endpoint_id: "https://a".into(),
                chain_id: "eip155:56".into(),
                methods: vec!["eth_getBlockByHash".into()],
                archive_capability: true,
                finality_semantics: "finalized".into(),
                independence_group: "one".into(),
                terms_reference: "x".into(),
            }],
            100.0,
        );
        let plan = plan_token_scan(true, true);
        assert!(admit_plan(&mut scheduler, &plan, 1).is_err());
    }

    #[test]
    fn unindexed_range_is_a_gap_not_an_empty_result() {
        let spans = [CoverageSpan {
            start_block: 10,
            end_block: 20,
        }];
        assert!(!coverage_complete(&spans, 10, 40));
        assert_eq!(
            coverage_gaps(&spans, 10, 40),
            vec![CoverageSpan {
                start_block: 21,
                end_block: 40
            }]
        );
    }
}
