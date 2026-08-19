//! Desktop case core. No simplified formulas; replay uses the same hashes as web.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_replay::{replay, RawArtifact, ReplayError, ReplayReport};
use zerotrace_types::hash_payload;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DesktopError {
    #[error(transparent)]
    Replay(#[from] ReplayError),
    #[error("case store is encrypted and the key is missing from secure storage")]
    MissingSecureKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineCase {
    pub case_id: String,
    pub snapshot_captured_at: String,
    pub synced_at: String,
    pub encrypted: bool,
    pub artifacts: Vec<RawArtifact>,
    pub expected_result_hash: String,
    pub observed_payload: serde_json::Value,
}

pub fn open_case(
    case: &OfflineCase,
    secure_key_present: bool,
) -> Result<ReplayReport, DesktopError> {
    if case.encrypted && !secure_key_present {
        return Err(DesktopError::MissingSecureKey);
    }
    Ok(replay(
        &case.artifacts,
        &case.expected_result_hash,
        &case.observed_payload,
    )?)
}

pub fn web_desktop_hash_parity(
    web_payload: &serde_json::Value,
    desktop_payload: &serde_json::Value,
) -> bool {
    hash_payload(web_payload).ok() == hash_payload(desktop_payload).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use zerotrace_types::hash_payload;

    #[test]
    fn encrypted_case_fails_closed_without_key() {
        let payload = json!({"v": 1});
        let case = OfflineCase {
            case_id: "cse_1".into(),
            snapshot_captured_at: "2026-08-20T00:00:00.000Z".into(),
            synced_at: "2026-08-20T00:00:00.000Z".into(),
            encrypted: true,
            artifacts: vec![],
            expected_result_hash: hash_payload(&payload).unwrap(),
            observed_payload: payload,
        };
        assert!(matches!(
            open_case(&case, false),
            Err(DesktopError::MissingSecureKey)
        ));
    }

    #[test]
    fn identical_payloads_have_hash_parity() {
        let payload = json!({"status": "PARTIAL"});
        assert!(web_desktop_hash_parity(&payload, &payload));
    }
}
