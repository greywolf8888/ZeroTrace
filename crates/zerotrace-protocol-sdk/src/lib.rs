//! Adapter capability. Unknown bytecode is fail-closed.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Capability {
    ReadyExact,
    ReadyBounded,
    ApproximationResearchOnly,
    ProvenancePending,
    Unsupported,
    Conflict,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterIdentity {
    pub chain: String,
    pub protocol: String,
    pub deployment: String,
    pub bytecode_hash: String,
    pub capability: Capability,
}

pub fn classify_unknown_bytecode(has_safe_call_path: bool) -> Capability {
    if has_safe_call_path {
        Capability::ReadyBounded
    } else {
        Capability::Unsupported
    }
}

pub fn complete_rv_allowed(capability: Capability) -> bool {
    matches!(capability, Capability::ReadyExact)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_without_path_is_unsupported() {
        assert_eq!(classify_unknown_bytecode(false), Capability::Unsupported);
        assert!(!complete_rv_allowed(Capability::ReadyBounded));
        assert!(complete_rv_allowed(Capability::ReadyExact));
    }
}
