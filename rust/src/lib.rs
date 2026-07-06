//! gap-core: the Rust core of the GAP (Governed-Action Protocol) SDK.
//!
//! GAP is the CC0 governed-action protocol. This crate implements the four
//! correctness-critical primitives that every GAP SDK must reproduce
//! byte-for-byte, matching the TypeScript reference (`@synoi/gap`,
//! `@synoi/sraid`) and the Python SDK:
//!
//!   * [`canonicalize`] — RFC 8785 (JCS) canonical JSON.
//!   * [`oid_of`] / [`compute_gap_oid`] / [`cdro_oid`] — content-addressed OID.
//!   * [`ed25519_sign`] / [`ed25519_verify`] / [`verify_hybrid`] — Ed25519 and
//!     hybrid Ed25519 + ML-DSA-65 signatures.
//!   * [`receipt_v1_canonical`] — v1 decision-receipt content-core projection.
//!
//! Conformance is proven, not asserted: `tests/conformance.rs` loads the SAME
//! vectors used by the TypeScript and Python SDKs (from the sibling
//! `synoi-conformance` repo) and checks byte-identical canonical output, OIDs,
//! and signature verdicts. See the README for which vector files run and the
//! pass counts.

mod canonicalize;
mod oid;
mod receipt;
mod signature;

pub use canonicalize::{canonicalize, canonicalize_gap};
pub use oid::{
    cdro_content_core, cdro_content_core_value, cdro_oid, compute_gap_oid, oid_of, oid_of_canonical,
    try_compute_gap_oid,
};
pub use receipt::receipt_v1_canonical;
pub use signature::{
    ed25519_public_key, ed25519_sign, ed25519_verify, ml_dsa65_verify, verify_hybrid,
    SignatureEnvelope, VerifyResult,
};

/// Parse a JSON document with the RFC 8785 reject-loud contract: non-finite
/// numbers (NaN, Infinity, -Infinity) are not JSON values and are rejected.
/// `serde_json` already refuses them in standard parsing, so this is a thin,
/// explicit wrapper that names the contract at the boundary. Downstream
/// canonicalization therefore never sees a non-finite number.
pub fn parse_json_strict(s: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str::<serde_json::Value>(s).map_err(|e| e.to_string())
}
