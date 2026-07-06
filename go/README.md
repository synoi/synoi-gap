# gapcore — GAP core SDK for Go

Location: `synoi-gap/go`, a reference implementation alongside the canonical
TypeScript implementation at the repo root (`src/`) and the Python SDK
(`python/`), all validated against this repo's conformance vectors.

`gapcore` is a Go implementation of the **GAP (Governed Action Protocol)** core
primitives: RFC 8785 JCS canonical JSON, content-addressed OID computation,
Ed25519 detached signatures (including the DSSE attestation surface), and the
CDRO / decision-receipt content-core projection.

It is a **byte-for-byte port** of the shipped TypeScript reference at the
`synoi-gap` repo root and is proven against the **same cross-language
conformance vectors** in `synoi-conformance` that the TypeScript and Python
SDKs run against. There is no second, divergent canonicalizer or signature
path here: every rule is anchored to an executable vector.

The GAP protocol specification is published CC0; this SDK, like the TypeScript
reference `@synoi/gap`, is licensed **Apache-2.0** (see `LICENSE`).

## What is implemented (and vector-backed)

| Capability | Function(s) | Conformance vectors it passes |
| --- | --- | --- |
| RFC 8785 JCS canonical JSON (SRAID profile, non-signing) | `Canonicalize` | `sraid/canonicalize.json`, `sraid/canonicalize-edge.json` (13/13) |
| JCS canonical JSON (GAP number rule, floats rejected) | `CanonicalizeGAP` | `adr019/float-reject.json` (6/6), `TestCanonicalizeRejectFloatGAP` |
| Content-addressed OID (`sha256:` + hex) | `OIDOf` | `sraid/oid.json` (9/9 + determinism vector) |
| GAP CDRO OID (six-field content-core strip, float-rejecting) | `ComputeGapOid`, `CdroOid` | `gap/oid.json` (6/6), `adr019/cdro-contentcore-mixed.json` (4/4) |
| CDRO / receipt content-core projection | `CdroContentCore` | `sraid/receipt-v2.json` canonical mode (1/1) |
| Ed25519 detached sign + verify | `SignDetached`, `VerifyDetached`, `PublicFromSeed` | `sraid/signatures.json` ed25519 leg (5/5) |
| DSSE Pre-Authentication Encoding + attestation verify | `PAE`, `VerifyAttestationEd25519` | `wasm-shell/governed-action-receipt-xlang.json` golden receipts (2/2) |

The canonicalizer matches the reference on every JCS corner the vectors cover:
lexicographic key sorting by **UTF-16 code units** (an astral/emoji key sorts
after ASCII, per RFC 8785 §3.2.3), ECMAScript number-to-string (integers
without exponent, small floats in exponential form such as `1e-10`), minimal
JSON string escaping, and `null` retained as a first-class value.

The `ed25519_pub_hex` derived from the documented xlang test seed
(`[7,0,…,0,7]`) is reproduced exactly by `PublicFromSeed`, and re-signing under
that seed round-trips (`TestSelfSignRoundTrip`), so the **sign** path is proven,
not only verify.

## What is NOT implemented (honest status)

### Post-quantum status: ML-DSA-65 is PENDING (not faked)

The GAP attestation profile is **hybrid**: a conformant verifier checks an
Ed25519 signature **AND** an ML-DSA-65 (FIPS 204) signature over the same DSSE
PAE. This SDK implements and verifies the **Ed25519 leg only**. The ML-DSA-65
leg is **not implemented** here.

Reason: there is no vetted, readily available pure-Go ML-DSA-65 signing/
verification dependency to reuse at the time of writing, and this SDK will not
hand-roll lattice cryptography. The conformance tests therefore verify the
Ed25519 leg of the hybrid vectors and explicitly do **not** assert the ML-DSA-65
leg. Where a hybrid vector is expected to fail solely on its PQ leg
(`sraid/signatures.json` "ml-dsa-65 only…"), the test recognizes that its Ed25519
leg is valid and does not miscount it.

**Consequence:** a receipt verified by `gapcore` today is verified on its
classical (Ed25519) leg. It is NOT a full hybrid verification. Do not represent
a `gapcore`-verified receipt as post-quantum verified. ML-DSA-65 is tracked as a
follow-up; when a trustworthy Go ML-DSA-65 dependency is adopted, a
`VerifyAttestationHybrid` will be added and the PQ leg of the existing vectors
will be asserted.

### Not in scope for this core

- Higher GAP layers (lineage/`latest-wins`, authority/grant verification,
  sensitivity carry-forward) — the conformance suite has vectors for these, but
  they are out of scope for the L0 core SDK and are not implemented here.
- Full CDRO type schemas / validators (the `validate` vectors) — this SDK ships
  canonicalization, OID, content-core, and signatures; typed envelope
  validation is a follow-up.

## Usage

```go
import "github.com/synoi/synoi-gap/go/gapcore"

// Canonicalize + OID
node, _ := gapcore.DecodeCanonicalInput([]byte(`{"b":1,"a":"hi"}`))
canon, _ := gapcore.Canonicalize(node)         // {"a":"hi","b":1}
oid, _   := gapcore.OIDOf(node)                // sha256:<hex>

// CDRO OID from its content core (strips oid/attestation/signature fields)
receipt, _ := gapcore.DecodeCanonicalInput(receiptJSON)
rOid, _    := gapcore.CdroOid(receipt.(map[string]interface{}))

// Ed25519 detached signature over the canonical bytes
canonical, sig, _ := gapcore.SignCanonical(seed32, node)

// DSSE attestation (payloadType bound into the signed bytes)
sig, _ := gapcore.SignDetached(seed32, gapcore.PAE(payloadType, payload))
ok     := gapcore.VerifyAttestationEd25519(pub32, payloadType, payload, sig)
```

## Running the conformance tests

The tests load the real vectors from a sibling `synoi-conformance` checkout
(auto-discovered relative to this repo) or from the directory named by the
`GAP_CONFORMANCE_VECTORS` environment variable.

```sh
go build ./...
go test ./gapcore/ -v
# or, explicit vector dir:
GAP_CONFORMANCE_VECTORS=/path/to/synoi-conformance/vectors go test ./gapcore/ -v
```

If the vectors cannot be found the conformance tests **fail** (`t.Fatalf`),
matching the Rust SDK's panic-on-missing behavior: a green run always means
the shared vectors were actually loaded, never silently skipped.
