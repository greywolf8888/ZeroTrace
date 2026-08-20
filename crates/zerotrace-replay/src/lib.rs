//! Offline replay. Hash mismatch is a structured diff, never a silent rewrite.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zerotrace_types::{hash_payload, TypesError};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ReplayError {
    #[error(transparent)]
    Types(#[from] TypesError),
    #[error("raw artifact hash mismatch for {0}")]
    RawHashMismatch(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawArtifact {
    pub path: String,
    pub sha256: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDiff {
    pub path: String,
    pub expected: String,
    pub observed: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayReport {
    pub raw_hashes_valid: bool,
    pub result_hash_match: bool,
    pub expected_result_hash: String,
    pub observed_result_hash: String,
    pub diffs: Vec<ReplayDiff>,
}

pub fn verify_raw(artifacts: &[RawArtifact]) -> Result<(), ReplayError> {
    for artifact in artifacts {
        let observed = hash_payload(&artifact.payload)?;
        if observed != artifact.sha256 {
            return Err(ReplayError::RawHashMismatch(artifact.path.clone()));
        }
    }
    Ok(())
}

pub fn replay(
    artifacts: &[RawArtifact],
    expected_result_hash: &str,
    observed_payload: &serde_json::Value,
) -> Result<ReplayReport, ReplayError> {
    let mut diffs = Vec::new();
    let mut raw_hashes_valid = true;
    for artifact in artifacts {
        let observed = hash_payload(&artifact.payload)?;
        if observed != artifact.sha256 {
            raw_hashes_valid = false;
            diffs.push(ReplayDiff {
                path: artifact.path.clone(),
                expected: artifact.sha256.clone(),
                observed,
            });
        }
    }
    let observed_result_hash = hash_payload(observed_payload)?;
    let result_hash_match = observed_result_hash == expected_result_hash;
    if !result_hash_match {
        diffs.push(ReplayDiff {
            path: "result".into(),
            expected: expected_result_hash.into(),
            observed: observed_result_hash.clone(),
        });
    }
    Ok(ReplayReport {
        raw_hashes_valid,
        result_hash_match,
        expected_result_hash: expected_result_hash.into(),
        observed_result_hash,
        diffs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matching_hashes_pass() {
        let payload = json!({"block": "1"});
        let sha = hash_payload(&payload).unwrap();
        let report = replay(
            &[RawArtifact {
                path: "raw/block.json".into(),
                sha256: sha,
                payload: payload.clone(),
            }],
            &hash_payload(&json!({"ok": true})).unwrap(),
            &json!({"ok": true}),
        )
        .unwrap();
        assert!(report.raw_hashes_valid);
        assert!(report.result_hash_match);
        assert!(report.diffs.is_empty());
    }
}
