# gap-core (Rust)

Location: `synoi-gap/rust`, a reference implementation alongside the canonical
TypeScript implementation at the repo root (`src/`) and the Python SDK
(`python/`), all validated against this repo's conformance vectors.

A Rust core SDK for **GAP**, the CC0 Governed-Action Protocol. It implements the
four correctness-critical primitives every GAP SDK must reproduce
**byte-for-byte**, matching the shipped TypeScript reference (`@synoi/gap`,
`@synoi/sraid`) and the Python SDK:

- **RFC 8785 (JCS) canonical JSON** — `canonicalize`
- **Content-addressed OID** — `oid_of`, `compute_gap_oid`, `cdro_oid`
  (`OID = "sha256:" + hex(sha256(canonicalize(content_core)))`)
- **Ed25519 sign + verify** and **hybrid Ed25519 + ML-DSA-65 verify** —
  `ed25519_sign`, `ed25519_verify`, `verify_hybrid`
- **v1 decision-receipt content-core projection** — `receipt_v1_canonical`

It does **not** hand-roll a second canonicalizer or a divergent signing path;
it reproduces the one normative canonical form the existing SDKs already sign
and hash against, and it is checked against the shared conformance vectors.

## What is implemented vs not

| Capability | Status | Proof |
| --- | --- | --- |
| RFC 8785 JCS canonicalization | **Implemented** | `sraid/canonicalize.json`, `sraid/canonicalize-edge.json` |
| Non-finite reject (NaN / Infinity) | **Implemented** (at the parse boundary) | `sraid/canonicalize-reject.json` |
| OID over canonical bytes | **Implemented** | `sraid/oid.json` |
| GAP CDRO OID (5-field strip) | **Implemented** | `gap/oid.json` |
| SRAID CDRO content-core OID (`oid`/`signature`/`attestation` strip) | **Implemented** | `sraid/cdro-roundtrip.json` |
| v1 receipt canonical projection | **Implemented** | `receipt-v1/canonical.json` |
| Ed25519 verify (golden signatures) | **Implemented** | `sraid/signatures.json` (Ed25519 leg) |
| Ed25519 sign (produce a verifying signature) | **Implemented** | `ed25519_sign_verify_roundtrip` (own-signature round trip + tamper/wrong-key reject) |
| **ML-DSA-65 (post-quantum) verify** | **Implemented** | `sraid/signatures.json` (ML-DSA-65 leg), verified against the `@noble/post-quantum` golden signatures |

### Post-quantum (ML-DSA-65) status: IMPLEMENTED for verify

The hybrid verifier requires **both** the Ed25519 and the ML-DSA-65 signature
to check out before returning `valid: true`, mirroring `@synoi/sraid`
`verifySignature`. The ML-DSA-65 leg is verified with the RustCrypto
[`ml-dsa`](https://crates.io/crates/ml-dsa) crate (FIPS 204 final) and is proven
byte-compatible with the `@noble/post-quantum` `ml_dsa65` signatures pinned in
`sraid/signatures.json` (1952-byte public key, 3309-byte signature, empty signing
context, message signed directly — not pre-hashed).

**Honest scope limit:** this crate implements ML-DSA-65 **verification** only.
It does **not** implement ML-DSA-65 **signing** or key generation. GAP objects
that carry a hybrid envelope are minted by the gateway signer (KMS / OpenSSL
oracle path); this SDK is a verifier for that leg. Ed25519 is the only algorithm
this crate can both **produce and verify**, matching the self-custody receipt
signing surface of `@synoi/gap` `receipt()`. There is no faked PQ signing path
here.

## Conformance is proven, not asserted

`tests/conformance.rs` loads the **same** vector files the TypeScript and Python
SDKs run, from the sibling `synoi-conformance` repo checked out next to the
`synoi-gap` repo (resolved by walking up from this crate's manifest dir to find
`synoi-conformance/vectors`). If that repo is absent the tests **fail loudly**
rather than silently passing, so a green run always means the shared vectors
were actually exercised.

Vector files and assertion counts (from `cargo test -- --nocapture`):

| Vector file | Assertions |
| --- | --- |
| `sraid/canonicalize.json` + `sraid/canonicalize-edge.json` | 15 |
| `sraid/canonicalize-reject.json` | 3 |
| `sraid/oid.json` (oid + oid_determinism) | 10 |
| `gap/oid.json` | 6 |
| `sraid/cdro-roundtrip.json` | 2 |
| `receipt-v1/canonical.json` | 6 |
| `sraid/signatures.json` (hybrid Ed25519 + ML-DSA-65) | 5 |
| local Ed25519 sign→verify round trip (tamper + wrong-key reject) | 1 |
| **Total** | **48** |

## Build and test

```sh
cargo build
cargo test
```

`Cargo.lock` is committed on purpose: the crypto and canonicalization
dependencies are correctness-critical, so their exact versions are pinned.

## License

CC0-1.0, matching the GAP protocol.
