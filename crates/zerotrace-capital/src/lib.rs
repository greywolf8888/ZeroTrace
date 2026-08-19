//! Capital ledger. Internal transfers inherit cost and never create profit.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_types::{parse_atomic, TypesError};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CapitalError {
    #[error(transparent)]
    Types(#[from] TypesError),
    #[error("insufficient lots to transfer; cannot invent cost-zero inventory")]
    InsufficientLots,
    #[error("CEX deposit is not confirmed realization")]
    CexIsNotSale,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum LotPolicy {
    Fifo,
    Lifo,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lot {
    pub id: String,
    pub owner: String,
    pub original_amount_atomic: String,
    pub remaining_amount_atomic: String,
    pub acquisition_cost_u: Option<String>,
    pub origin_block: String,
}

pub fn sort_lots(lots: &[Lot], policy: LotPolicy) -> Vec<Lot> {
    let mut copy = lots.to_vec();
    copy.sort_by(|left, right| match policy {
        LotPolicy::Fifo => left.origin_block.cmp(&right.origin_block),
        LotPolicy::Lifo => right.origin_block.cmp(&left.origin_block),
    });
    copy
}

pub fn transfer_lots(
    lots: &mut Vec<Lot>,
    from_owner: &str,
    to_owner: &str,
    amount_atomic: &str,
    policy: LotPolicy,
    new_id_prefix: &str,
) -> Result<Vec<Lot>, CapitalError> {
    let mut remaining = parse_atomic(amount_atomic, "amountAtomic")?;
    let owned: Vec<Lot> = sort_lots(
        &lots
            .iter()
            .filter(|lot| lot.owner == from_owner)
            .cloned()
            .collect::<Vec<_>>(),
        policy,
    );
    let mut created = Vec::new();
    for source in owned {
        if remaining == 0 {
            break;
        }
        let Some(target) = lots.iter_mut().find(|lot| lot.id == source.id) else {
            continue;
        };
        let available = parse_atomic(&target.remaining_amount_atomic, "remaining")?;
        if available == 0 {
            continue;
        }
        let take = available.min(remaining);
        target.remaining_amount_atomic = (available - take).to_string();
        let parent_cost = match source.acquisition_cost_u.as_deref() {
            Some(cost) => {
                let original = parse_atomic(&source.original_amount_atomic, "original")?;
                Some((parse_atomic(cost, "cost")? * take) / original)
            }
            None => None,
        };
        created.push(Lot {
            id: format!("{new_id_prefix}{}", created.len()),
            owner: to_owner.into(),
            original_amount_atomic: take.to_string(),
            remaining_amount_atomic: take.to_string(),
            acquisition_cost_u: parent_cost.map(|value| value.to_string()),
            origin_block: source.origin_block,
        });
        remaining -= take;
    }
    if remaining > 0 {
        return Err(CapitalError::InsufficientLots);
    }
    lots.extend(created.clone());
    Ok(created)
}

pub fn proportional_haircut(amount: u128, take: u128, node_balance: u128) -> u128 {
    amount
        .checked_mul(take)
        .and_then(|value| value.checked_div(node_balance))
        .unwrap_or(0)
}

pub fn max_flow(
    capacity: &[(usize, usize, u128)],
    source: usize,
    sink: usize,
    nodes: usize,
) -> u128 {
    let mut cap = vec![vec![0u128; nodes]; nodes];
    for &(from, to, weight) in capacity {
        cap[from][to] += weight;
    }
    let mut flow = 0u128;
    loop {
        let mut parent = vec![None; nodes];
        let mut seen = vec![false; nodes];
        let mut queue = std::collections::VecDeque::new();
        queue.push_back(source);
        seen[source] = true;
        while let Some(node) = queue.pop_front() {
            for next in 0..nodes {
                if !seen[next] && cap[node][next] > 0 {
                    parent[next] = Some(node);
                    seen[next] = true;
                    queue.push_back(next);
                }
            }
        }
        if !seen[sink] {
            break;
        }
        let mut add = u128::MAX;
        let mut node = sink;
        while node != source {
            let prev = parent[node].unwrap();
            add = add.min(cap[prev][node]);
            node = prev;
        }
        node = sink;
        while node != source {
            let prev = parent[node].unwrap();
            cap[prev][node] -= add;
            cap[node][prev] += add;
            node = prev;
        }
        flow += add;
    }
    flow
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfitReport {
    pub realized_net_profit_u: String,
    pub venue_boundary_upper_u: String,
}

pub fn realize_profit(
    proceeds_u: u128,
    fee_income_u: u128,
    lot_cost_u: u128,
    gas_u: u128,
    venue_boundary_u: u128,
) -> ProfitReport {
    ProfitReport {
        realized_net_profit_u: (proceeds_u + fee_income_u)
            .saturating_sub(lot_cost_u)
            .saturating_sub(gas_u)
            .to_string(),
        venue_boundary_upper_u: venue_boundary_u.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifo_inherits_cost_and_rejects_shortage() {
        let mut lots = vec![Lot {
            id: "a".into(),
            owner: "ctl".into(),
            original_amount_atomic: "10".into(),
            remaining_amount_atomic: "10".into(),
            acquisition_cost_u: Some("100".into()),
            origin_block: "1".into(),
        }];
        let created = transfer_lots(&mut lots, "ctl", "other", "4", LotPolicy::Fifo, "n").unwrap();
        assert_eq!(created[0].acquisition_cost_u.as_deref(), Some("40"));
        assert!(transfer_lots(&mut lots, "ctl", "other", "9", LotPolicy::Fifo, "x").is_err());
    }

    #[test]
    fn max_flow_respects_capacity() {
        let flow = max_flow(&[(0, 1, 5), (1, 2, 3), (0, 2, 2)], 0, 2, 3);
        assert_eq!(flow, 5);
    }
}
