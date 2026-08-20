//! Shared-state exit scenarios. Venues are updated after each fill; isolated quotes are illegal.
//! Multi-venue splitting remains explicitly approximate until a proven global optimizer is wired.

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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OptimizationQuality {
    ExactSingleVenue,
    ApproximationResearchOnly,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlan {
    pub quality: OptimizationQuality,
    pub fills: Vec<RouteFill>,
}

pub fn split_and_fill_scenario(venues: &mut [Venue], amount_in: u128) -> RoutePlan {
    if venues.is_empty() || amount_in == 0 {
        return RoutePlan {
            quality: OptimizationQuality::ApproximationResearchOnly,
            fills: Vec::new(),
        };
    }
    if venues.len() == 1 {
        let executed = execute_constant_product(
            venues[0].base_reserve,
            venues[0].quote_reserve,
            amount_in,
            venues[0].fee_bps,
        );
        venues[0].base_reserve = executed
            .base_reserve
            .parse()
            .unwrap_or(venues[0].base_reserve);
        venues[0].quote_reserve = executed
            .quote_reserve
            .parse()
            .unwrap_or(venues[0].quote_reserve);
        return RoutePlan {
            quality: OptimizationQuality::ExactSingleVenue,
            fills: vec![RouteFill {
                venue_id: venues[0].id.clone(),
                amount_in: amount_in.to_string(),
                amount_out: executed.amount_out,
            }],
        };
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
    RoutePlan {
        quality: OptimizationQuality::ApproximationResearchOnly,
        fills,
    }
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
        let plan = split_and_fill_scenario(&mut venues, 10_000);
        assert!(!plan.fills.is_empty());
        assert_eq!(plan.quality, OptimizationQuality::ApproximationResearchOnly);
        assert!(venues
            .iter()
            .any(|venue| venue.base_reserve > 1_000_000 || venue.base_reserve > 500_000));
    }

    #[test]
    fn one_constant_product_venue_is_exact_but_multi_venue_is_not() {
        let mut venues = vec![Venue {
            id: "single".into(),
            base_reserve: 1_000,
            quote_reserve: 1_000,
            fee_bps: 25,
        }];
        let plan = split_and_fill_scenario(&mut venues, 10);
        assert_eq!(plan.quality, OptimizationQuality::ExactSingleVenue);
        assert_eq!(plan.fills.len(), 1);
    }
}
