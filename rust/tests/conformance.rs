//! Cross-language conformance: run the SAME vectors the TypeScript and Python
//! GAP SDKs run, from the sibling `synoi-conformance` repo, and assert this
//! Rust implementation produces byte-identical canonical output + OIDs and the
//! same signature verdicts.
//!
//! This is the proof the crate is real, not a toy. Each `#[test]` names the
//! exact vector file it loads. If `synoi-conformance` is not checked out next
//! to this crate, the tests fail loudly (they do NOT silently pass) so a green
//! run always means the vectors were actually exercised.
//!
//! Vector files exercised:
//!   - vectors/sraid/canonicalize.json         (RFC 8785 canonical bytes)
//!   - vectors/sraid/canonicalize-edge.json    (UTF-16 key order, big integers)
//!   - vectors/sraid/canonicalize-reject.json  (NaN / Infinity + non-integer floats rejected, ADR_019)
//!   - vectors/sraid/oid.json                  (oid + oid_determinism)
//!   - vectors/gap/oid.json                  (GAP CDRO OIDs)
//!   - vectors/sraid/cdro-roundtrip.json       (CDRO content-core projection)
//!   - vectors/receipt-v1/canonical.json     (v1 receipt canonical projection)
//!   - vectors/sraid/signatures.json           (hybrid Ed25519 + ML-DSA-65 verify)

use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

use gap_core::{
    canonicalize, canonicalize_gap, cdro_oid, compute_gap_oid, oid_of, receipt_v1_canonical,
    try_compute_gap_oid, verify_hybrid, SignatureEnvelope,
};

/// Resolve `synoi-conformance/vectors/<rel>` by walking up the ancestors of
/// this crate's manifest dir until an `<ancestor>/synoi-conformance/vectors`
/// directory is found. This crate now lives at `synoi-gap/rust`, one level
/// deeper than the old standalone `synoi-gap-rust` repo, so a fixed
/// `parent()` no longer resolves; walking up a bounded number of levels finds
/// the sibling `synoi-conformance` checkout regardless of how deep this crate
/// is nested under the `synoi-*` workspace root.
///
/// Panics (fails the test) if no such directory is found within the bound, so
/// a pass always means the shared vectors were actually loaded.
fn vectors_path(rel: &str) -> PathBuf {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    const MAX_LEVELS: usize = 6;
    let mut dir = crate_dir.clone();
    for _ in 0..MAX_LEVELS {
        let candidate = dir.join("synoi-conformance").join("vectors");
        if candidate.is_dir() {
            let p = candidate.join(rel);
            assert!(
                p.exists(),
                "conformance vector not found: {} (found synoi-conformance at {})",
                p.display(),
                candidate.display()
            );
            return p;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
    panic!(
        "sibling synoi-conformance/vectors not found within {} levels above {} (expected the sibling synoi-conformance repo)",
        MAX_LEVELS,
        crate_dir.display()
    );
}

fn load(rel: &str) -> Value {
    let p = vectors_path(rel);
    let text = fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", p.display()))
}

fn arr(v: &Value) -> &Vec<Value> {
    v.as_array().expect("vector file is a JSON array")
}

#[test]
fn cof_canonicalize_vectors() {
    let mut n = 0;
    for file in ["sraid/canonicalize.json", "sraid/canonicalize-edge.json"] {
        let vectors = load(file);
        for vec in arr(&vectors) {
            if vec.get("kind").and_then(Value::as_str) != Some("canonicalize") {
                continue;
            }
            let name = vec["name"].as_str().unwrap();
            let input = &vec["input"];
            let expected = vec["expected_canonical"].as_str().unwrap();
            let got = canonicalize(input);
            assert_eq!(got, expected, "canonicalize mismatch for '{name}' in {file}");
            n += 1;
        }
    }
    assert!(n >= 13, "expected >=13 canonicalize vectors, ran {n}");
    println!("cof_canonicalize_vectors: {n} vectors passed");
}

#[test]
fn cof_canonicalize_reject_vectors() {
    // Two rejection classes (ADR_019 number rule + RFC 8785):
    //   * NaN / Infinity / -Infinity are not JSON values; a standards-conformant
    //     JSON parser MUST refuse them, so they reject at the parse boundary.
    //   * A finite non-integer (e.g. 3.14, 1e-10) IS a valid JSON value but is
    //     forbidden by the SynOI number rule (ADR_019 decision 2). It parses,
    //     then MUST be rejected by the float-rejecting canonical form
    //     (canonicalize_gap), matching the TS reference's `canonicalize throws`.
    let vectors = load("sraid/canonicalize-reject.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        let js = vec["js_eval"].as_str().unwrap();
        let parsed = gap_core::parse_json_strict(js);
        match parsed {
            Err(_) => {
                // Non-finite: rejected at the parse boundary.
            }
            Ok(v) => {
                // Finite value that parsed: it MUST be a non-integer number the
                // GAP number rule rejects before hashing.
                assert!(
                    canonicalize_gap(&v).is_err(),
                    "expected canonicalize_gap to reject non-integer '{name}' ({js}) but it accepted"
                );
            }
        }
        n += 1;
    }
    assert_eq!(n, 5, "expected 5 reject vectors, ran {n}");
    println!("cof_canonicalize_reject_vectors: {n} vectors passed");
}

#[test]
fn cof_oid_vectors() {
    let vectors = load("sraid/oid.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        match vec.get("kind").and_then(Value::as_str) {
            Some("oid") => {
                let got = oid_of(&vec["input"]);
                let expected = vec["expected_oid"].as_str().unwrap();
                assert_eq!(got, expected, "oid mismatch for '{name}'");
                n += 1;
            }
            Some("oid_determinism") => {
                let a = oid_of(&vec["input"]);
                let b = oid_of(&vec["input"]);
                assert_eq!(a, b, "oid not deterministic for '{name}'");
                assert_eq!(a, vec["expected_oid_1"].as_str().unwrap());
                assert_eq!(b, vec["expected_oid_2"].as_str().unwrap());
                n += 1;
            }
            _ => {}
        }
    }
    assert!(n >= 9, "expected >=9 oid vectors, ran {n}");
    println!("cof_oid_vectors: {n} vectors passed");
}

#[test]
fn gap_oid_vectors() {
    let vectors = load("gap/oid.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        if vec.get("kind").and_then(Value::as_str) != Some("oid") {
            continue;
        }
        let name = vec["name"].as_str().unwrap();
        let got = compute_gap_oid(&vec["input"]);
        let expected = vec["expected_oid"].as_str().unwrap();
        assert_eq!(got, expected, "gap oid mismatch for '{name}'");
        n += 1;
    }
    assert_eq!(n, 6, "expected 6 gap oid vectors, ran {n}");
    println!("gap_oid_vectors: {n} vectors passed");
}

#[test]
fn adr019_content_core_mixed_vectors() {
    // The shared ADR_019 mixed vectors carry gap_version + supersedes +
    // attestation. compute_gap_oid must reproduce the sraid-computed
    // expected_oid byte-for-byte (6-field strip, gap_version+supersedes KEPT).
    let vectors = load("adr019/cdro-contentcore-mixed.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        let got = compute_gap_oid(&vec["input"]);
        let expected = vec["expected_oid"].as_str().unwrap();
        assert_eq!(got, expected, "adr019 mixed oid mismatch for '{name}'");
        n += 1;
    }
    assert_eq!(n, 4, "expected 4 adr019 mixed vectors, ran {n}");
    println!("adr019_content_core_mixed_vectors: {n} vectors passed");
}

#[test]
fn adr019_float_reject_vectors() {
    // ADR_019 decision 2: every float-bearing input is rejected before hashing.
    let vectors = load("adr019/float-reject.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        let input = &vec["input"];
        assert!(
            canonicalize_gap(input).is_err(),
            "canonicalize_gap accepted a float for '{name}'"
        );
        // try_compute_gap_oid surfaces the same rejection for object inputs.
        if input.is_object() {
            assert!(
                try_compute_gap_oid(input).is_err(),
                "try_compute_gap_oid accepted a float for '{name}'"
            );
        }
        n += 1;
    }
    assert_eq!(n, 6, "expected 6 adr019 float-reject vectors, ran {n}");
    println!("adr019_float_reject_vectors: {n} vectors passed");
}

#[test]
fn cof_cdro_roundtrip_vectors() {
    let vectors = load("sraid/cdro-roundtrip.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        let cdro = &vec["cdro"];
        let core = gap_core::cdro_content_core(cdro).expect("cdro is an object");
        let canon = canonicalize(&core);
        if let Some(exp1) = vec.get("expected_content_core_1").and_then(Value::as_str) {
            assert_eq!(canon, exp1, "content core mismatch for '{name}'");
            // Determinism: canonicalize twice yields identical bytes.
            let canon2 = canonicalize(&gap_core::cdro_content_core(cdro).unwrap());
            assert_eq!(canon, canon2, "content core not deterministic for '{name}'");
        }
        if let Some(exp_oid) = vec.get("expected_oid").and_then(Value::as_str) {
            assert_eq!(cdro_oid(cdro).unwrap(), exp_oid, "cdro oid mismatch '{name}'");
        }
        n += 1;
    }
    assert!(n >= 1, "expected >=1 cdro roundtrip vector, ran {n}");
    println!("cof_cdro_roundtrip_vectors: {n} vectors passed");
}

#[test]
fn receipt_v1_canonical_vectors() {
    let vectors = load("receipt-v1/canonical.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        let name = vec["name"].as_str().unwrap();
        let canonical_fields: Vec<String> = vec["canonical_fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let optional_fields: Vec<String> = vec["optional_canonical_fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let receipt = vec["receipt"].as_object().unwrap();
        let got = receipt_v1_canonical(receipt, &canonical_fields, &optional_fields);
        let expected = vec["expected_canonical"].as_str().unwrap();
        assert_eq!(got, expected, "receipt v1 canonical mismatch for '{name}'");
        n += 1;
    }
    assert!(n >= 6, "expected >=6 receipt-v1 vectors, ran {n}");
    println!("receipt_v1_canonical_vectors: {n} vectors passed");
}

#[test]
fn cof_signature_vectors_hybrid() {
    let vectors = load("sraid/signatures.json");
    let mut n = 0;
    for vec in arr(&vectors) {
        if vec.get("kind").and_then(Value::as_str) != Some("signature") {
            continue;
        }
        let name = vec["name"].as_str().unwrap();
        let canonical = vec["canonical"].as_str().unwrap().as_bytes();
        let env = vec["envelope"].as_object().unwrap();
        let envelope = SignatureEnvelope {
            ed25519: env["ed25519"].as_str().unwrap().to_string(),
            ml_dsa_65: env["ml_dsa_65"].as_str().unwrap().to_string(),
            signer_kid: env["signer_kid"].as_str().unwrap().to_string(),
        };
        let ed_pub = STANDARD
            .decode(vec["ed25519_pub_b64"].as_str().unwrap())
            .unwrap();
        let ml_pub = STANDARD
            .decode(vec["ml_dsa_pub_b64"].as_str().unwrap())
            .unwrap();
        let expected_valid = vec["expected_valid"].as_bool().unwrap();

        let result = verify_hybrid(canonical, &envelope, &ed_pub, &ml_pub);
        assert_eq!(
            result.valid, expected_valid,
            "signature verdict mismatch for '{name}': got valid={} reasons={:?}",
            result.valid, result.reasons
        );
        n += 1;
    }
    assert_eq!(n, 5, "expected 5 signature vectors, ran {n}");
    println!("cof_signature_vectors_hybrid: {n} vectors passed (Ed25519 AND ML-DSA-65)");
}

#[test]
fn ed25519_sign_verify_roundtrip() {
    // No-vector-no-claim for the SIGN capability: prove we produce a signature
    // that verifies, and that a tampered message or wrong key fails. The golden
    // vectors above prove we VERIFY external signatures; this proves we SIGN.
    let seed = [7u8; 32];
    let pk = gap_core::ed25519_public_key(&seed);
    let msg = canonicalize(&serde_json::json!({"b": 2, "a": 1})).into_bytes();
    let sig = gap_core::ed25519_sign(&seed, &msg);

    assert!(gap_core::ed25519_verify(&sig, &msg, &pk), "own signature must verify");

    let mut tampered = msg.clone();
    tampered.push(b'!');
    assert!(!gap_core::ed25519_verify(&sig, &tampered, &pk), "tampered msg must fail");

    let wrong_pk = gap_core::ed25519_public_key(&[9u8; 32]);
    assert!(!gap_core::ed25519_verify(&sig, &msg, &wrong_pk), "wrong key must fail");
    println!("ed25519_sign_verify_roundtrip: sign+verify OK, tamper+wrong-key rejected");
}
