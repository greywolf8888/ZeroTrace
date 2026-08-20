//! Shared forensic types. Unknown is never coerced to numeric zero.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TypesError {
    #[error("{0} must be a non-negative integer string")]
    InvalidAtomic(&'static str),
    #[error("value is not JSON serializable")]
    NotSerializable,
    #[error("forensic ID prefix must be three lowercase letters")]
    InvalidPrefix,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state")]
pub enum Observation<T> {
    #[serde(rename = "known")]
    Known { value: T },
    #[serde(rename = "unknown")]
    Unknown { reason: String },
    #[serde(rename = "unavailable")]
    Unavailable { reason: String },
    #[serde(rename = "stale")]
    Stale { reason: String },
    #[serde(rename = "provider_down")]
    ProviderDown { reason: String },
}

impl<T> Observation<T> {
    pub fn known(value: T) -> Self {
        Self::Known { value }
    }

    pub fn unknown(reason: impl Into<String>) -> Self {
        Self::Unknown {
            reason: reason.into(),
        }
    }

    pub fn as_known(&self) -> Option<&T> {
        match self {
            Self::Known { value } => Some(value),
            _ => None,
        }
    }
}

pub fn parse_atomic(value: &str, field: &'static str) -> Result<u128, TypesError> {
    if value != "0" && value.starts_with('0') {
        return Err(TypesError::InvalidAtomic(field));
    }
    if !value.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(TypesError::InvalidAtomic(field));
    }
    value
        .parse::<u128>()
        .map_err(|_| TypesError::InvalidAtomic(field))
}

pub fn canonical_json(value: &serde_json::Value) -> Result<String, TypesError> {
    match value {
        serde_json::Value::Null => Ok("null".to_string()),
        serde_json::Value::Bool(flag) => Ok(if *flag {
            "true".to_string()
        } else {
            "false".to_string()
        }),
        serde_json::Value::Number(number) => Ok(number.to_string()),
        serde_json::Value::String(text) => {
            serde_json::to_string(text).map_err(|_| TypesError::NotSerializable)
        }
        serde_json::Value::Array(items) => {
            let mut encoded = String::from("[");
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    encoded.push(',');
                }
                encoded.push_str(&canonical_json(item)?);
            }
            encoded.push(']');
            Ok(encoded)
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut encoded = String::from("{");
            let mut first = true;
            for key in keys {
                let item = map.get(key).ok_or(TypesError::NotSerializable)?;
                if item.is_null() {
                    // Keep explicit JSON null; skip only missing keys, matching TS undefined skip.
                }
                if !first {
                    encoded.push(',');
                }
                first = false;
                encoded.push_str(
                    &serde_json::to_string(key).map_err(|_| TypesError::NotSerializable)?,
                );
                encoded.push(':');
                encoded.push_str(&canonical_json(item)?);
            }
            encoded.push('}');
            Ok(encoded)
        }
    }
}

pub fn hash_payload(value: &serde_json::Value) -> Result<String, TypesError> {
    let encoded = canonical_json(value)?;
    let digest = Sha256::digest(encoded.as_bytes());
    Ok(hex::encode(digest))
}

pub fn content_addressed_id(prefix: &str, value: &serde_json::Value) -> Result<String, TypesError> {
    if prefix.len() != 3 || !prefix.chars().all(|ch| ch.is_ascii_lowercase()) {
        return Err(TypesError::InvalidPrefix);
    }
    let hash = hash_payload(value)?;
    Ok(format!("{prefix}_{}", &hash[..24]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_is_not_numeric_zero() {
        let value: Observation<String> = Observation::unknown("NOT_QUERIED");
        assert!(value.as_known().is_none());
        assert_ne!(serde_json::to_string(&value).unwrap(), "\"0\"");
    }

    #[test]
    fn canonical_json_sorts_object_keys() {
        let value = json!({"b": 1, "a": {"z": true, "m": [2, 1]}});
        assert_eq!(
            canonical_json(&value).unwrap(),
            r#"{"a":{"m":[2,1],"z":true},"b":1}"#
        );
    }

    #[test]
    fn content_id_uses_first_24_hex() {
        let id = content_addressed_id("lot", &json!({"k": "v"})).unwrap();
        assert!(id.starts_with("lot_"));
        assert_eq!(id.len(), 28);
    }
}
