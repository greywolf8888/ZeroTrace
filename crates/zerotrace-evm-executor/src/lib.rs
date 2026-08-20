//! Integer AMM kernels. Exact VM execution fails closed without a pinned archive fork.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_protocol_sdk::Capability;
use zerotrace_types::{parse_atomic, TypesError};

const Q96: u128 = 1u128 << 96;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ExecutorError {
    #[error(transparent)]
    Types(#[from] TypesError),
    #[error("exact VM execution requires pinned archive state; refusing formula fallback")]
    MissingArchiveFork,
    #[error("isolated per-address RV must not be summed")]
    IsolatedRvSum,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwapResult {
    pub amount_out: String,
    pub base_reserve: String,
    pub quote_reserve: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct V3Approximation {
    pub amount_out: String,
    pub next_sqrt_price_x96: String,
    pub capability: Capability,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExactExecutionEvidence {
    pub pinned_archive_fork: bool,
    pub bytecode_verified: bool,
    pub replay_hash_match: bool,
}

pub fn execute_constant_product(
    base_reserve: u128,
    quote_reserve: u128,
    amount_in: u128,
    fee_bps: u128,
) -> SwapResult {
    if amount_in == 0 {
        return SwapResult {
            amount_out: "0".into(),
            base_reserve: base_reserve.to_string(),
            quote_reserve: quote_reserve.to_string(),
        };
    }
    let effective = (amount_in * (10_000 - fee_bps)) / 10_000;
    let out = (quote_reserve * effective) / (base_reserve + effective);
    let capped = out.min(quote_reserve);
    SwapResult {
        amount_out: capped.to_string(),
        base_reserve: (base_reserve + amount_in).to_string(),
        quote_reserve: (quote_reserve - capped).to_string(),
    }
}

/// Research-only virtual-reserve estimate.
///
/// This does not traverse the Tick bitmap or apply `liquidityNet`, so it must never be exposed as
/// exact concentrated-liquidity execution or participate in a COMPLETE realizable-value result.
pub fn estimate_concentrated_v3_virtual_reserves(
    liquidity: u128,
    sqrt_price_x96: u128,
    amount_in: u128,
    fee_bps: u128,
) -> Result<V3Approximation, ExecutorError> {
    let fee_adj = (amount_in * (10_000 - fee_bps)) / 10_000;
    if liquidity == 0 || fee_adj == 0 {
        return Ok(V3Approximation {
            amount_out: "0".into(),
            next_sqrt_price_x96: sqrt_price_x96.to_string(),
            capability: Capability::ApproximationResearchOnly,
        });
    }
    let virtual_base = (liquidity * Q96) / sqrt_price_x96;
    let virtual_quote = (liquidity * sqrt_price_x96) / Q96;
    let swapped = execute_constant_product(virtual_base, virtual_quote, fee_adj, 0);
    let out = parse_atomic(&swapped.amount_out, "amountOut")?;
    let next_base = parse_atomic(&swapped.base_reserve, "base")?;
    let next_sqrt = (liquidity * Q96)
        .checked_div(next_base)
        .unwrap_or(sqrt_price_x96);
    Ok(V3Approximation {
        amount_out: out.to_string(),
        next_sqrt_price_x96: next_sqrt.to_string(),
        capability: Capability::ApproximationResearchOnly,
    })
}

pub fn execute_stableswap(
    x: u128,
    y: u128,
    amount_in: u128,
    amplification: u128,
    fee_bps: u128,
) -> SwapResult {
    let n = 2u128;
    let sum = x + y;
    let mut d = sum;
    let ann = amplification * n;
    for _ in 0..32 {
        let mut dp = d;
        dp = (dp * d) / (n * x);
        dp = (dp * d) / (n * y);
        let next = ((ann * sum + dp * n) * d) / ((ann - 1) * d + (n + 1) * dp);
        let delta = next.abs_diff(d);
        d = next;
        if delta <= 1 {
            break;
        }
    }
    let x_after = x + (amount_in * (10_000 - fee_bps)) / 10_000;
    let mut y_out = y;
    for _ in 0..32 {
        let y_prev = y_out;
        let c = (d * d / (n * x_after) * d) / (n * y_out);
        let b = x_after + d / ann;
        y_out = (d * d + c * y_out) / (2 * y_out + b - d);
        let delta = y_out.abs_diff(y_prev);
        if delta <= 1 {
            break;
        }
    }
    let out = y.saturating_sub(y_out);
    SwapResult {
        amount_out: out.to_string(),
        base_reserve: x_after.to_string(),
        quote_reserve: (y - out).to_string(),
    }
}

pub fn reject_isolated_rv_sum(values: &[u128]) -> Result<(), ExecutorError> {
    if values.len() > 1 {
        Err(ExecutorError::IsolatedRvSum)
    } else {
        Ok(())
    }
}

pub fn exact_vm_capability(evidence: &ExactExecutionEvidence) -> Result<Capability, ExecutorError> {
    if evidence.pinned_archive_fork && evidence.bytecode_verified && evidence.replay_hash_match {
        Ok(Capability::ReadyExact)
    } else {
        Err(ExecutorError::MissingArchiveFork)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_product_matches_integer_identity() {
        let result = execute_constant_product(1000, 1000, 10, 25);
        assert_eq!(result.base_reserve, "1010");
        let out: u128 = result.amount_out.parse().unwrap();
        assert!(out > 0 && out < 1000);
    }

    #[test]
    fn isolated_sum_is_illegal() {
        assert!(reject_isolated_rv_sum(&[1, 2]).is_err());
    }

    #[test]
    fn exact_vm_fails_closed_without_fork() {
        assert!(exact_vm_capability(&ExactExecutionEvidence {
            pinned_archive_fork: false,
            bytecode_verified: true,
            replay_hash_match: true,
        })
        .is_err());
    }

    #[test]
    fn virtual_reserve_v3_is_never_exact() {
        let result = estimate_concentrated_v3_virtual_reserves(1_000_000, Q96, 100, 30).unwrap();
        assert_eq!(result.capability, Capability::ApproximationResearchOnly);
    }

    #[test]
    fn exact_vm_requires_the_full_evidence_triplet() {
        assert_eq!(
            exact_vm_capability(&ExactExecutionEvidence {
                pinned_archive_fork: true,
                bytecode_verified: true,
                replay_hash_match: true,
            })
            .unwrap(),
            Capability::ReadyExact
        );
        assert!(exact_vm_capability(&ExactExecutionEvidence {
            pinned_archive_fork: true,
            bytecode_verified: false,
            replay_hash_match: true,
        })
        .is_err());
    }
}
