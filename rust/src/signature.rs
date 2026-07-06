//! Signature primitives.
//!
//! Two surfaces, matching the TypeScript reference:
//!
//!   * Ed25519 detached sign + verify over canonical bytes. This is the
//!     self-custody single-key receipt signing surface of `@synoi/gap`
//!     `receipt()` / `verifyReceiptSignature` (src/receipt.ts). We can both
//!     PRODUCE and VERIFY here; the conformance suite proves a sign->verify
//!     round trip and independently verifies the golden Ed25519 leg of the
//!     `sraid/signatures.json` vectors.
//!
//!   * Hybrid Ed25519 + ML-DSA-65 verify, `valid` only when BOTH legs verify,
//!     over the same canonical bytes. This is the `@synoi/sraid`
//!     `verifySignature` surface (src/signature.ts). The message is the
//!     canonical string encoded as UTF-8, signed directly (NOT pre-hashed),
//!     with an empty signing context. Verified byte-for-byte against the
//!     `@noble/post-quantum` ml_dsa65 golden signatures in
//!     `sraid/signatures.json`.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{
    Signature as EdSignature, Signer, SigningKey, Verifier as EdVerifier, VerifyingKey,
};
use ml_dsa::signature::Verifier as MlVerifier;
use ml_dsa::{EncodedVerifyingKey, MlDsa65, Signature as MlSignature, VerifyingKey as MlVerifyingKey};

/// Sign `message` bytes with a 32-byte Ed25519 seed (private key), returning
/// the 64-byte detached signature. Mirrors `ed25519.sign(msg, priv)` in the
/// `@synoi/gap` receipt signer.
pub fn ed25519_sign(seed: &[u8; 32], message: &[u8]) -> [u8; 64] {
    let signing = SigningKey::from_bytes(seed);
    let sig: EdSignature = signing.sign(message);
    sig.to_bytes()
}

/// Derive the 32-byte Ed25519 public key from a 32-byte seed.
pub fn ed25519_public_key(seed: &[u8; 32]) -> [u8; 32] {
    SigningKey::from_bytes(seed).verifying_key().to_bytes()
}

/// Verify a 64-byte Ed25519 signature over `message` against a 32-byte public
/// key. Returns false on any malformed input rather than panicking, matching
/// the reference verifier's clean boolean contract.
pub fn ed25519_verify(sig: &[u8], message: &[u8], public_key: &[u8]) -> bool {
    let pk: [u8; 32] = match public_key.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let sig_arr: [u8; 64] = match sig.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let vk = match VerifyingKey::from_bytes(&pk) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let signature = EdSignature::from_bytes(&sig_arr);
    vk.verify(message, &signature).is_ok()
}

/// Verify a raw ML-DSA-65 signature (3309 bytes) over `message` against a raw
/// ML-DSA-65 public key (1952 bytes), empty context. Returns false on any
/// malformed input. Byte-compatible with `@noble/post-quantum` ml_dsa65 and
/// with the OpenSSL 3.5 native path used by `@synoi/sraid`.
pub fn ml_dsa65_verify(sig: &[u8], message: &[u8], public_key: &[u8]) -> bool {
    let ek: EncodedVerifyingKey<MlDsa65> = match public_key.try_into() {
        Ok(e) => e,
        Err(_) => return false,
    };
    let vk = MlVerifyingKey::<MlDsa65>::decode(&ek);
    let sig_arr: [u8; 3309] = match sig.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let signature = match MlSignature::<MlDsa65>::decode(&sig_arr.into()) {
        Some(s) => s,
        None => return false,
    };
    vk.verify(message, &signature).is_ok()
}

/// A hybrid signature envelope: base64-encoded Ed25519 and ML-DSA-65
/// signatures plus a signer key id. Mirrors `@synoi/sraid` `SignatureEnvelope`.
pub struct SignatureEnvelope {
    pub ed25519: String,
    pub ml_dsa_65: String,
    pub signer_kid: String,
}

/// Result of a hybrid verify. `valid` is true only when BOTH legs verify.
pub struct VerifyResult {
    pub valid: bool,
    pub reasons: Vec<String>,
}

/// Hybrid verify: `valid` only when the Ed25519 AND the ML-DSA-65 signatures
/// both verify against the supplied public keys and canonical bytes. Reasons
/// accumulate across both legs in one pass. Counterpart of `@synoi/sraid`
/// `verifySignature` (src/signature.ts).
pub fn verify_hybrid(
    canonical: &[u8],
    envelope: &SignatureEnvelope,
    ed25519_pub: &[u8],
    ml_dsa_pub: &[u8],
) -> VerifyResult {
    let mut reasons: Vec<String> = Vec::new();

    let ed_sig = match STANDARD.decode(&envelope.ed25519) {
        Ok(b) => Some(b),
        Err(_) => {
            reasons.push("ed25519-malformed".to_string());
            None
        }
    };
    let ml_sig = match STANDARD.decode(&envelope.ml_dsa_65) {
        Ok(b) => Some(b),
        Err(_) => {
            reasons.push("ml-dsa-malformed".to_string());
            None
        }
    };

    let mut ed_ok = false;
    let mut ml_ok = false;

    if let Some(ref s) = ed_sig {
        ed_ok = ed25519_verify(s, canonical, ed25519_pub);
        if !ed_ok {
            reasons.push("ed25519-invalid".to_string());
        }
    }
    if let Some(ref s) = ml_sig {
        ml_ok = ml_dsa65_verify(s, canonical, ml_dsa_pub);
        if !ml_ok {
            reasons.push("ml-dsa-invalid".to_string());
        }
    }

    VerifyResult {
        valid: ed_ok && ml_ok,
        reasons,
    }
}
