//! OID computation and CDRO content-core projection.
//!
//! OID = "sha256:" + lowercase_hex(sha256(canonicalize(content))).
//!
//! This is DERIVED from the single normative source,
//! synoi-sraid/PROJECTION_SPEC.md (ADR_019 decisions 1-3), and matches the
//! reference implementation byte-for-byte:
//!   - `@synoi/sraid` `oidOf` / `cdroContentCore` (src/oid.ts)
//!   - `@synoi/gap`   `computeGapOid`             (src/oid.ts)
//!
//! There is exactly ONE content-core projection (`cdro_content_core`): it
//! strips the SIX detached-signature / envelope fields
//! {oid, signature, ml_dsa_signature, signature_key_id, signature_algorithm,
//! attestation} and KEEPS everything else, including `gap_version` (protocol
//! downgrade is OID-detectable) and `supersedes` (Merkle-DAG lineage edge is
//! tamper-evident). `compute_gap_oid` computes this ONE projection (same result
//! as `cdro_oid` for object inputs) and is kept under its historical name for
//! API stability; both yield the same OID a third party recomputes for a signed
//! (post-attestation) receipt. Both enforce the GAP number rule (floats
//! rejected). Used by `gap/oid.json` and `sraid/cdro-roundtrip.json`.
//!
//! The bare `sraid/oid.json` vectors hash the input value directly with no field
//! stripping (`oidOf`), which is `oid_of` here.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::canonicalize::{canonicalize, canonicalize_gap};

/// Compute `sha256:<hex>` over the canonical form of a value, with no field
/// stripping. Counterpart of `@synoi/sraid` `oidOf`.
pub fn oid_of(value: &Value) -> String {
    oid_of_canonical(&canonicalize(value))
}

/// Compute `sha256:<hex>` over already-canonicalized bytes. Counterpart of
/// `@synoi/sraid` `oidOfCanonical`.
pub fn oid_of_canonical(canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();
    format!("sha256:{}", hex::encode(digest))
}

/// The SIX detached-signature / envelope fields removed by the content-core
/// projection before hashing (ADR_019 decision 1; PROJECTION_SPEC.md §2).
/// gap_version and supersedes are deliberately NOT here -- they are KEPT in
/// identity. Mirrors `@synoi/sraid` `CDRO_ENVELOPE_FIELDS`.
const CDRO_ENVELOPE_FIELDS: &[&str] = &[
    "oid",
    "signature",
    "ml_dsa_signature",
    "signature_key_id",
    "signature_algorithm",
    "attestation",
];

/// Project a CDRO (or a pre-stripped OID payload) to its content core by
/// removing the six detached fields at the TOP LEVEL only. Non-object inputs
/// are returned unchanged, exactly as the TS reference does.
pub fn cdro_content_core_value(value: &Value) -> Value {
    strip_top_level(value, CDRO_ENVELOPE_FIELDS)
}

/// Compute the GAP CDRO OID: strip the six detached fields, then hash the
/// float-rejecting canonical form. Counterpart of `@synoi/gap` `computeGapOid`
/// / `@synoi/sraid` `cdroOid`. Kept under the historical name for API
/// stability; it computes the ONE normative content-core projection and
/// enforces the GAP number rule (ADR_019 decision 2).
///
/// A non-integer number is out-of-domain for a GAP CDRO (money is integer
/// minor units, time is integer milliseconds); it is rejected loud, matching
/// the TS/Python SDKs which throw. Use [`try_compute_gap_oid`] for a fallible
/// variant that returns the typed error instead of panicking.
pub fn compute_gap_oid(value: &Value) -> String {
    try_compute_gap_oid(value).unwrap_or_else(|e| panic!("compute_gap_oid: {e}"))
}

/// Fallible form of [`compute_gap_oid`]: returns the typed float-reject error
/// instead of panicking. Mirrors the GAP number rule (ADR_019 §3.1).
pub fn try_compute_gap_oid(value: &Value) -> Result<String, String> {
    let core = cdro_content_core_value(value);
    Ok(oid_of_canonical(&canonicalize_gap(&core)?))
}

/// Project a full CDRO to its content core by removing the six detached
/// fields at the top level. The argument MUST be a JSON object; mirrors the
/// `TypeError` the TS reference throws otherwise.
pub fn cdro_content_core(value: &Value) -> Result<Value, String> {
    if !value.is_object() {
        return Err("cdro_content_core: argument must be a CDRO object".to_string());
    }
    Ok(cdro_content_core_value(value))
}

/// Compute the OID of a full CDRO over its content core. Counterpart of
/// `@synoi/sraid` `cdroOid`. Identical result to `compute_gap_oid` for object
/// inputs; this variant errors on non-object input AND on any non-integer
/// number (ADR_019 §3.1), returning the typed error rather than panicking.
pub fn cdro_oid(value: &Value) -> Result<String, String> {
    let core = cdro_content_core(value)?;
    Ok(oid_of_canonical(&canonicalize_gap(&core)?))
}

fn strip_top_level(value: &Value, excluded: &[&str]) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if !excluded.contains(&k.as_str()) {
                    out.insert(k.clone(), v.clone());
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}
