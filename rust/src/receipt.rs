//! Decision-receipt content-core projection (v1).
//!
//! The v1 Decision Receipt is signed over a SCALAR PROJECTION of the receipt:
//! a flat object built from a fixed set of canonical field names, sorted, with
//! any field whose value is absent or `null` omitted. This is the exact
//! projection the cross-package `receipt-v1-canonical` conformance test builds
//! (`scalarProjection` in receipt-v1-canonical-conformance.test.ts), whose
//! output must equal the pinned `expected_canonical` bytes that both the signer
//! (`@synoi/sraid` canonicalize) and the offline verifier (`@synoi/verify`
//! canonicalPayload) agree on byte-for-byte.
//!
//! Given the same `canonical_fields` + `optional_canonical_fields` and the same
//! `receipt`, this function reproduces those canonical bytes.

use serde_json::{Map, Value};

use crate::canonicalize::canonicalize;

/// Build the sorted scalar projection of a receipt and return its canonical
/// (RFC 8785) string. `canonical_fields` and `optional_canonical_fields` are
/// merged, sorted (UTF-16 order via the canonicalizer's own key sort), and any
/// field that is missing or JSON `null` in `receipt` is omitted.
///
/// Mirrors the TS `scalarProjection` + `canonicalize` composition.
pub fn receipt_v1_canonical(
    receipt: &Map<String, Value>,
    canonical_fields: &[String],
    optional_canonical_fields: &[String],
) -> String {
    let mut projection = Map::new();
    for field in canonical_fields.iter().chain(optional_canonical_fields.iter()) {
        match receipt.get(field) {
            Some(v) if !v.is_null() => {
                projection.insert(field.clone(), v.clone());
            }
            _ => {}
        }
    }
    // Key ordering is handled by the canonicalizer (UTF-16 sort), so we do not
    // need to pre-sort here; inserting in any order yields identical bytes.
    canonicalize(&Value::Object(projection))
}
