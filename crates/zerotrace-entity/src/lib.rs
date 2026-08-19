//! Role confirmation. Evidence scores are not calibrated probabilities.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoleFeatures {
    pub insider_access_score: f64,
    pub common_control_score: f64,
    pub coordination_score: f64,
    pub benefit_return_score: f64,
    pub independence_score: f64,
    pub service_hub_score: f64,
    pub market_maker_score: f64,
    pub bot_score: f64,
    pub forbidden_single_factors: Vec<String>,
    pub positive_independence_evidence: bool,
}

pub fn confirm_hidden_affiliate(features: &RoleFeatures) -> bool {
    if features
        .forbidden_single_factors
        .iter()
        .any(|item| item == "early")
        && features.insider_access_score < 40.0
    {
        return false;
    }
    if features
        .forbidden_single_factors
        .iter()
        .any(|item| item == "small_balance")
        && features.common_control_score < 40.0
    {
        return false;
    }
    let control_or_coord =
        features.common_control_score >= 50.0 || features.coordination_score >= 50.0;
    features.insider_access_score >= 50.0
        && control_or_coord
        && features.benefit_return_score >= 50.0
}

pub fn confirm_retail(features: &RoleFeatures, service_hub: bool) -> bool {
    if service_hub {
        return false;
    }
    if !features.positive_independence_evidence {
        return false;
    }
    if features.market_maker_score >= 50.0
        || features.bot_score >= 50.0
        || features.service_hub_score >= 50.0
    {
        return false;
    }
    features.independence_score >= 50.0 && features.common_control_score < 30.0
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HiddenAffiliateBounds {
    pub lower_atomic: String,
    pub scenario_atomic: String,
    pub upper_atomic: String,
    pub unknown_atomic: String,
}

pub fn hidden_affiliate_bounds(
    confirmed_atomic: u128,
    scenario_atomic: u128,
    upper_atomic: u128,
    unknown_atomic: u128,
) -> HiddenAffiliateBounds {
    HiddenAffiliateBounds {
        lower_atomic: confirmed_atomic.to_string(),
        scenario_atomic: scenario_atomic.to_string(),
        upper_atomic: upper_atomic.to_string(),
        unknown_atomic: unknown_atomic.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> RoleFeatures {
        RoleFeatures {
            insider_access_score: 0.0,
            common_control_score: 0.0,
            coordination_score: 0.0,
            benefit_return_score: 0.0,
            independence_score: 0.0,
            service_hub_score: 0.0,
            market_maker_score: 0.0,
            bot_score: 0.0,
            forbidden_single_factors: vec![],
            positive_independence_evidence: false,
        }
    }

    #[test]
    fn early_alone_is_not_hidden_affiliate() {
        let mut features = base();
        features.forbidden_single_factors = vec!["early".into()];
        features.insider_access_score = 10.0;
        assert!(!confirm_hidden_affiliate(&features));
    }

    #[test]
    fn service_hub_is_not_retail() {
        let mut features = base();
        features.positive_independence_evidence = true;
        features.independence_score = 90.0;
        assert!(!confirm_retail(&features, true));
    }

    #[test]
    fn calibrated_conjunction_can_confirm_hidden() {
        let features = RoleFeatures {
            insider_access_score: 60.0,
            common_control_score: 55.0,
            coordination_score: 10.0,
            benefit_return_score: 70.0,
            independence_score: 0.0,
            service_hub_score: 0.0,
            market_maker_score: 0.0,
            bot_score: 0.0,
            forbidden_single_factors: vec![],
            positive_independence_evidence: false,
        };
        assert!(confirm_hidden_affiliate(&features));
    }
}
