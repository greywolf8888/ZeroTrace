//! Read-only desktop host. Signing, broadcasting, and private keys are forbidden.

use serde_json::json;
use zerotrace_desktop_core::web_desktop_hash_parity;

fn main() {
    let demo = json!({"readOnly": true});
    assert!(web_desktop_hash_parity(&demo, &demo));
    println!(
        "{}",
        serde_json::to_string(&json!({ "mode": "readonly-host" })).unwrap()
    );
}
