//! Supply conservation. Unknown remainder is explicit, never invented as zero inventory.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_types::{parse_atomic, TypesError};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum LedgerError {
    #[error(transparent)]
    Types(#[from] TypesError),
    #[error("supply cell {0} would double-count the same quantity")]
    DuplicateCell(String),
    #[error("supply cell token does not match the report subject")]
    TokenMismatch,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupplyCell {
    pub id: String,
    pub owner: String,
    pub custody_type: String,
    pub economic_controller: String,
    pub liquidity_status: String,
    pub amount_atomic: String,
    pub chain_id: String,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_bridge_cell_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupplyConservation {
    pub protocol_supply_atomic: String,
    pub explained_supply_atomic: String,
    pub unknown_difference_atomic: String,
    pub burn_already_reflected_in_supply: bool,
    pub matched_bridge_dedup_atomic: String,
    pub identity_holds: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableBuckets {
    pub sellable_now_atomic: String,
    pub transferable_no_route_atomic: String,
    pub unlock_dependent_atomic: String,
    pub lp_withdrawal_required_atomic: String,
    pub claim_required_atomic: String,
    pub frozen_or_blacklisted_atomic: String,
    pub unspendable_atomic: String,
    pub unknown_sellability_atomic: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupplyReality {
    pub conservation: SupplyConservation,
    pub executable: ExecutableBuckets,
}

pub fn materialize_supply(
    protocol_supply_atomic: &str,
    burn_already_reflected: bool,
    subject_chain: &str,
    subject_token: &str,
    cells: &[SupplyCell],
) -> Result<SupplyReality, LedgerError> {
    let protocol = parse_atomic(protocol_supply_atomic, "protocolSupplyAtomic")?;
    let mut seen = std::collections::HashSet::new();
    let mut skipped_bridge = std::collections::HashSet::new();
    for cell in cells {
        if cell.chain_id != subject_chain || cell.token != subject_token {
            return Err(LedgerError::TokenMismatch);
        }
        let key = format!(
            "{}:{}:{}:{}:{}:{}",
            cell.id,
            cell.owner,
            cell.custody_type,
            cell.economic_controller,
            cell.liquidity_status,
            cell.matched_bridge_cell_id.clone().unwrap_or_default()
        );
        if !seen.insert(key) || !seen.insert(cell.id.clone()) {
            return Err(LedgerError::DuplicateCell(cell.id.clone()));
        }
        if let Some(matched) = &cell.matched_bridge_cell_id {
            skipped_bridge.insert(matched.clone());
        }
    }

    let mut explained: u128 = 0;
    let mut matched_bridge_dedup: u128 = 0;
    for cell in cells {
        let amount = parse_atomic(&cell.amount_atomic, "amountAtomic")?;
        if burn_already_reflected && cell.custody_type == "BURN_PROVABLE" {
            continue;
        }
        if skipped_bridge.contains(&cell.id) {
            matched_bridge_dedup += amount;
            continue;
        }
        explained += amount;
    }
    let unknown = protocol.saturating_sub(explained);
    let identity_holds = protocol >= explained;

    let sum = |status: &str| -> Result<u128, LedgerError> {
        let mut total = 0u128;
        for cell in cells {
            if skipped_bridge.contains(&cell.id) {
                continue;
            }
            if burn_already_reflected && cell.custody_type == "BURN_PROVABLE" {
                continue;
            }
            if cell.liquidity_status == status {
                total += parse_atomic(&cell.amount_atomic, "amountAtomic")?;
            }
        }
        Ok(total)
    };

    Ok(SupplyReality {
        conservation: SupplyConservation {
            protocol_supply_atomic: protocol.to_string(),
            explained_supply_atomic: explained.to_string(),
            unknown_difference_atomic: unknown.to_string(),
            burn_already_reflected_in_supply: burn_already_reflected,
            matched_bridge_dedup_atomic: matched_bridge_dedup.to_string(),
            identity_holds,
        },
        executable: ExecutableBuckets {
            sellable_now_atomic: sum("SELLABLE_NOW")?.to_string(),
            transferable_no_route_atomic: sum("TRANSFERABLE_NO_ROUTE")?.to_string(),
            unlock_dependent_atomic: sum("UNLOCK_REQUIRED")?.to_string(),
            lp_withdrawal_required_atomic: sum("LP_WITHDRAWAL_REQUIRED")?.to_string(),
            claim_required_atomic: sum("CLAIM_REQUIRED")?.to_string(),
            frozen_or_blacklisted_atomic: (sum("FROZEN")? + sum("BLACKLISTED")?).to_string(),
            unspendable_atomic: sum("UNSPENDABLE")?.to_string(),
            unknown_sellability_atomic: sum("UNKNOWN")?.to_string(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(id: &str, owner: &str, amount: &str, custody: &str, status: &str) -> SupplyCell {
        SupplyCell {
            id: id.into(),
            owner: owner.into(),
            custody_type: custody.into(),
            economic_controller: "UNKNOWN".into(),
            liquidity_status: status.into(),
            amount_atomic: amount.into(),
            chain_id: "eip155:56".into(),
            token: "0xabc".into(),
            matched_bridge_cell_id: None,
        }
    }

    #[test]
    fn conserves_and_keeps_unknown_remainder() {
        let report = materialize_supply(
            "1000",
            true,
            "eip155:56",
            "0xabc",
            &[
                cell("c1", "controller", "400", "WALLET", "SELLABLE_NOW"),
                cell(
                    "c2",
                    "pool",
                    "300",
                    "POOL_RESERVE",
                    "LP_WITHDRAWAL_REQUIRED",
                ),
                cell("c3", "dead", "100", "BURN_PROVABLE", "UNSPENDABLE"),
            ],
        )
        .unwrap();
        assert_eq!(report.conservation.explained_supply_atomic, "700");
        assert_eq!(report.conservation.unknown_difference_atomic, "300");
        assert!(report.conservation.identity_holds);
        assert_eq!(report.executable.sellable_now_atomic, "400");
        assert_eq!(report.executable.unspendable_atomic, "0");
    }
}
