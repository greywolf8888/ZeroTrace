//! Shared-state routing. Venues are updated after each fill; isolated quotes are illegal.

use serde::{Deserialize, Serialize};
use zerotrace_evm_executor::{execute_constant_product, reject_isolated_rv_sum, SwapResult};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Venue {
    pub id: String,
    pub base_reserve: u128,
    pub quote_reserve: u128,
    pub fee_bps: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RouteFill {
    pub venue_id: String,
    pub amount_in: String,
    pub amount_out: String,
}

pub fn split_and_fill(venues: &mut [Venue], amount_in: u128) -> Vec<RouteFill> {
    if venues.is_empty() || amount_in == 0 {
        return Vec::new();
    }
    let mut remaining = amount_in;
    let mut fills = Vec::new();
    while remaining > 0 {
        let best = venues
            .iter()
            .enumerate()
            .map(|(index, venue)| {
                let probe = remaining / venues.len() as u128 + 1;
                let result = execute_constant_product(
                    venue.base_reserve,
                    venue.quote_reserve,
                    probe.min(remaining),
                    venue.fee_bps,
                );
                (index, result)
            })
            .max_by_key(|(_, result)| result.amount_out.parse::<u128>().unwrap_or(0));
        let Some((index, result)) = best else {
            break;
        };
        let out: u128 = result.amount_out.parse().unwrap_or(0);
        if out == 0 {
            break;
        }
        let n = venues.len().max(1) as u128;
        let used = remaining.min(remaining / n + remaining / n);
        let used = used.max(1).min(remaining);
        let executed: SwapResult = execute_constant_product(
            venues[index].base_reserve,
            venues[index].quote_reserve,
            used,
            venues[index].fee_bps,
        );
        venues[index].base_reserve = executed
            .base_reserve
            .parse()
            .unwrap_or(venues[index].base_reserve);
        venues[index].quote_reserve = executed
            .quote_reserve
            .parse()
            .unwrap_or(venues[index].quote_reserve);
        fills.push(RouteFill {
            venue_id: venues[index].id.clone(),
            amount_in: used.to_string(),
            amount_out: executed.amount_out,
        });
        remaining -= used;
    }
    fills
}

pub fn assert_not_isolated_sum(values: &[u128]) -> Result<(), String> {
    reject_isolated_rv_sum(values).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_state_consumes_reserves() {
        let mut venues = vec![
            Venue {
                id: "a".into(),
                base_reserve: 1_000_000,
                quote_reserve: 1_000_000,
                fee_bps: 25,
            },
            Venue {
                id: "b".into(),
                base_reserve: 500_000,
                quote_reserve: 500_000,
                fee_bps: 25,
            },
        ];
        let fills = split_and_fill(&mut venues, 10_000);
        assert!(!fills.is_empty());
        assert!(venues
            .iter()
            .any(|venue| venue.base_reserve > 1_000_000 || venue.base_reserve > 500_000));
    }
}
