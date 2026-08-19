use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{self, Read};
use zerotrace_campaign::detect_change_points;
use zerotrace_evm_executor::execute_constant_product;
use zerotrace_types::hash_payload;

#[derive(Deserialize)]
struct Request {
    op: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn dispatch(request: Request) -> Response {
    match request.op.as_str() {
        "hash" => match hash_payload(&request.payload) {
            Ok(hash) => Response {
                ok: true,
                result: Some(json!({ "sha256": hash })),
                error: None,
            },
            Err(err) => Response {
                ok: false,
                result: None,
                error: Some(err.to_string()),
            },
        },
        "constant_product" => {
            let base = request.payload["baseReserve"].as_str().unwrap_or("0");
            let quote = request.payload["quoteReserve"].as_str().unwrap_or("0");
            let amount = request.payload["amountIn"].as_str().unwrap_or("0");
            let fee = request.payload["feeBps"].as_str().unwrap_or("0");
            let result = execute_constant_product(
                base.parse().unwrap_or(0),
                quote.parse().unwrap_or(0),
                amount.parse().unwrap_or(0),
                fee.parse().unwrap_or(0),
            );
            Response {
                ok: true,
                result: Some(serde_json::to_value(result).unwrap_or(json!({}))),
                error: None,
            }
        }
        "pelt" => {
            let values: Vec<f64> = request.payload["values"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_f64())
                .collect();
            let penalty = request.payload["penalty"].as_f64().unwrap_or(3.0);
            Response {
                ok: true,
                result: Some(json!({ "changePoints": detect_change_points(&values, penalty) })),
                error: None,
            }
        }
        other => Response {
            ok: false,
            result: None,
            error: Some(format!("unsupported op {other}")),
        },
    }
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("stdin");
    let request: Request = serde_json::from_str(&raw).unwrap_or(Request {
        op: "invalid".into(),
        payload: json!({}),
    });
    let response = dispatch(request);
    println!("{}", serde_json::to_string(&response).expect("json"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_op_is_deterministic() {
        let response = dispatch(Request {
            op: "hash".into(),
            payload: json!({"a": 1}),
        });
        assert!(response.ok);
        assert_eq!(
            response.result.unwrap()["sha256"],
            hash_payload(&json!({"a": 1})).unwrap()
        );
    }
}
