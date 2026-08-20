//! Provider scheduler. Business code must not call providers except through this crate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use zerotrace_types::canonical_json;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SchedulerError {
    #[error("rate limited")]
    RateLimited,
    #[error("verification reserve exhausted")]
    VerificationReserveExhausted,
    #[error("budget exhausted")]
    BudgetExhausted,
    #[error("circuit open")]
    CircuitOpen,
    #[error("two URLs are not independent operators")]
    NotIndependent,
    #[error("canonicalization failed")]
    Canonical,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRecord {
    pub operator_id: String,
    pub endpoint_id: String,
    pub chain_id: String,
    pub methods: Vec<String>,
    pub archive_capability: bool,
    pub finality_semantics: String,
    pub independence_group: String,
    pub terms_reference: String,
}

#[derive(Clone, Debug)]
pub struct TokenBucket {
    pub tokens: f64,
    pub capacity: f64,
    pub refill_per_sec: f64,
    last_ms: u64,
}

impl TokenBucket {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            tokens: capacity,
            capacity,
            refill_per_sec,
            last_ms: 0,
        }
    }

    pub fn try_take(&mut self, now_ms: u64, cost: f64) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_ms) as f64 / 1000.0;
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        self.last_ms = now_ms;
        if self.tokens >= cost {
            self.tokens -= cost;
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Debug)]
pub struct Aimd {
    pub concurrency: u32,
    pub min: u32,
    pub max: u32,
    pub additive: u32,
    pub multiplicative: f64,
}

impl Aimd {
    pub fn low_cost() -> Self {
        Self {
            concurrency: 1,
            min: 1,
            max: 1,
            additive: 1,
            multiplicative: 0.5,
        }
    }

    pub fn new() -> Self {
        Self {
            concurrency: 1,
            min: 1,
            max: 32,
            additive: 1,
            multiplicative: 0.5,
        }
    }

    pub fn on_success(&mut self) {
        self.concurrency = (self.concurrency + self.additive).min(self.max);
    }

    pub fn on_throttle(&mut self) {
        let next = (self.concurrency as f64 * self.multiplicative).floor() as u32;
        self.concurrency = next.max(self.min);
    }
}

impl Default for Aimd {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct Ewma {
    pub alpha: f64,
    pub value: Option<f64>,
}

impl Ewma {
    pub fn new(alpha: f64) -> Self {
        Self { alpha, value: None }
    }

    pub fn observe(&mut self, sample: f64) -> f64 {
        let next = match self.value {
            None => sample,
            Some(prev) => self.alpha * sample + (1.0 - self.alpha) * prev,
        };
        self.value = Some(next);
        next
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleKey {
    pub chain: String,
    pub block_hash: String,
    pub method: String,
    pub canonical_params: String,
    pub adapter_version: String,
}

#[derive(Clone, Debug)]
pub struct ProviderScheduler {
    pub providers: Vec<ProviderRecord>,
    buckets: HashMap<String, TokenBucket>,
    pub aimd: Aimd,
    pub ewma_latency: Ewma,
    coalesced: HashMap<String, u64>,
    pub budget_remaining: f64,
    pub verification_reserve_ratio: f64,
    in_flight: u32,
    circuit_open: bool,
}

impl ProviderScheduler {
    pub fn new(providers: Vec<ProviderRecord>, budget: f64) -> Self {
        Self {
            providers,
            buckets: HashMap::new(),
            aimd: Aimd::new(),
            ewma_latency: Ewma::new(0.2),
            coalesced: HashMap::new(),
            budget_remaining: budget,
            verification_reserve_ratio: 0.2,
            in_flight: 0,
            circuit_open: false,
        }
    }

    pub fn independent_operator_count(&self) -> usize {
        let mut groups = std::collections::HashSet::new();
        for provider in &self.providers {
            groups.insert(provider.independence_group.as_str());
        }
        groups.len()
    }

    pub fn require_quorum(&self, load_bearing: bool) -> Result<(), SchedulerError> {
        if load_bearing && self.independent_operator_count() < 2 {
            return Err(SchedulerError::NotIndependent);
        }
        Ok(())
    }

    pub fn coalesce_key(key: &ScheduleKey) -> Result<String, SchedulerError> {
        let value = serde_json::json!({
            "adapterVersion": key.adapter_version,
            "blockHash": key.block_hash,
            "chain": key.chain,
            "canonicalParams": key.canonical_params,
            "method": key.method,
        });
        canonical_json(&value).map_err(|_| SchedulerError::Canonical)
    }

    pub fn admit(
        &mut self,
        now_ms: u64,
        key: &ScheduleKey,
        cost: f64,
        verification: bool,
    ) -> Result<bool, SchedulerError> {
        if self.circuit_open {
            return Err(SchedulerError::CircuitOpen);
        }
        let coalesced = Self::coalesce_key(key)?;
        if self.coalesced.contains_key(&coalesced) {
            return Ok(false);
        }
        if verification {
            let reserve = self.budget_remaining * self.verification_reserve_ratio
                / (1.0 - self.verification_reserve_ratio).max(0.01);
            if cost > reserve + self.budget_remaining * self.verification_reserve_ratio {
                return Err(SchedulerError::VerificationReserveExhausted);
            }
        }
        if cost > self.budget_remaining {
            return Err(SchedulerError::BudgetExhausted);
        }
        if self.in_flight >= self.aimd.concurrency {
            return Err(SchedulerError::RateLimited);
        }
        let bucket = self
            .buckets
            .entry(format!("{}|{}|{}", key.chain, key.method, "unknown-public"))
            .or_insert_with(|| TokenBucket::new(8.0, 4.0));
        if !bucket.try_take(now_ms, cost) {
            return Err(SchedulerError::RateLimited);
        }
        self.budget_remaining -= cost;
        self.in_flight += 1;
        self.coalesced.insert(coalesced, now_ms);
        Ok(true)
    }

    pub fn complete(&mut self, latency_ms: f64, throttled: bool) {
        self.in_flight = self.in_flight.saturating_sub(1);
        self.ewma_latency.observe(latency_ms);
        if throttled {
            self.aimd.on_throttle();
        } else {
            self.aimd.on_success();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(operator: &str, group: &str, endpoint: &str) -> ProviderRecord {
        ProviderRecord {
            operator_id: operator.into(),
            endpoint_id: endpoint.into(),
            chain_id: "eip155:56".into(),
            methods: vec!["eth_getLogs".into()],
            archive_capability: true,
            finality_semantics: "finalized".into(),
            independence_group: group.into(),
            terms_reference: "bnbchain-docs".into(),
        }
    }

    #[test]
    fn two_urls_same_group_are_not_independent() {
        let scheduler = ProviderScheduler::new(
            vec![
                provider("a", "bnbchain", "https://a.example"),
                provider("a", "bnbchain", "https://b.example"),
            ],
            100.0,
        );
        assert_eq!(scheduler.independent_operator_count(), 1);
        assert!(scheduler.require_quorum(true).is_err());
    }

    #[test]
    fn coalesces_identical_historical_reads() {
        let mut scheduler = ProviderScheduler::new(
            vec![
                provider("bnb", "bnbchain", "https://bsc-dataseed.bnbchain.org"),
                provider("nodereal", "nodereal", "https://bsc.nodereal.io"),
            ],
            100.0,
        );
        let key = ScheduleKey {
            chain: "eip155:56".into(),
            block_hash: "0xabc".into(),
            method: "eth_getLogs".into(),
            canonical_params: "[]".into(),
            adapter_version: "evm-v1".into(),
        };
        assert!(scheduler.admit(1, &key, 1.0, false).unwrap());
        assert!(!scheduler.admit(2, &key, 1.0, false).unwrap());
    }

    #[test]
    fn aimd_multiplies_down_on_throttle() {
        let mut aimd = Aimd::new();
        aimd.concurrency = 8;
        aimd.on_throttle();
        assert_eq!(aimd.concurrency, 4);
        aimd.on_success();
        assert_eq!(aimd.concurrency, 5);
    }

    #[test]
    fn low_cost_aimd_never_exceeds_one() {
        let mut aimd = Aimd::low_cost();
        for _ in 0..8 {
            aimd.on_success();
        }
        assert_eq!(aimd.concurrency, 1);
        assert_eq!(aimd.max, 1);
    }
}
