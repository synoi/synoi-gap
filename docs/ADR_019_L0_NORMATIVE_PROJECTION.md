# ADR_019 - One Normative L0 Projection for the CDRO OID

Status: Accepted
Date: 2026-07-05
Deciders: Architect (lead), Founder (number-rule ratification, Wave 2)
Supersedes: the implicit per-surface projection conventions previously embedded in each SDK and in IMPLEMENTING.md 2.2/2.3.
Related: ADR_007 (the `gap:` signed namespace and payloadType split), ADR_008 (decision-receipt immutability and the K1/K2 receipt-scheme). This ADR does not change ADR_007 or ADR_008; it makes the shipped code conform to them from one source.
License: CC0-1.0 (public domain), consistent with the GAP spec.

## Context

A 2026-07-05 whole-stack review found the architecture sound but blocked on ONE root cause: the L0 object identity contract (how a CDRO's OID is projected before hashing) existed as several by-shape copies with no single normative source. Grounded in the code, the copies were:

- The OID content-core projection existed in FOUR mutually incompatible strip-sets across seven surfaces. The SRAID reference stripped 3 fields and kept `gap_version` + `supersedes`; the GAP TypeScript, Python, and Rust SDKs stripped 5 (dropping `gap_version` + `supersedes`); the GAP Go SDK stripped 6; the gateway v1 flat signer excluded 8; the live v2 signer used the SRAID 3-strip.
- The divergence was invisible in CI because the single conformance vector carried none of `{gap_version, supersedes, attestation}`, so a 3-strip and a 6-strip produced byte-identical cores on it. In production the gateway always stamps `gap_version` and often `supersedes`, so the live signer hashed them into the OID while a third party following the SDK strip-set recomputed a DIFFERENT OID and would conclude that a valid receipt had been tampered. That breaks the core promise: "approved before it runs, provable after."
- The number rule diverged too. Some surfaces permitted floats, others forbade them, so a float-bearing receipt was declared malformed by some verifiers before it was ever hashed.

These are not five bugs. They are one missing thing: a single written source of the projection, the number rule, and the canonicalization rules, plus machine-checkable vectors so no surface can drift from it silently.

Two adjacent identity contracts are explicitly OUT OF SCOPE and firewalled, not merged:

- the gateway's v1 flat-scalar receipt signing shape (a legacy, separate strip-set gated behind the `receipt_scheme` discriminator), and
- the Vault L1 binary-TLV `canonical_hash` (a deliberately frozen, different-layer identity contract).

## Decision

Establish ONE normative L0 projection and collapse every downstream copy onto it.

1. One content-core projection. `cdroContentCore(object)` removes EXACTLY six top-level fields: `oid`, `signature`, `ml_dsa_signature`, `signature_key_id`, `signature_algorithm`, `attestation`. Everything else is KEPT and hashed into identity, including `gap_version` and `supersedes`. The strip-set is defined SEMANTICALLY ("every field the signer produces after canonicalization, plus the OID output itself"), not as a hand-listed enumeration per surface. `supersedes` stays in identity because the SRAID Merkle-DAG "head proves history" property requires every lineage edge inside the hash (superseding mints a new object, it never mutates the old object's bytes, so keeping the pointer in identity is safe and makes the edge tamper-evident). `gap_version` stays in identity so a protocol downgrade is OID-detectable. This matches the shipped live v2 signer; the SDKs and the prose are what change.

2. One number rule: forbid non-integer numbers everywhere before canonicalization. A number is legal iff it is a finite integer. `NaN`, `+Infinity`, `-Infinity`, and any non-integer are rejected with a typed error before hashing. Justification: the product is settlement-grade signed receipts, all money is integer minor units, and no conformant object legitimately carries a float. Forbidding floats removes the single hardest RFC 8785 cross-language trap (shortest-round-trip float serialization) from a signed byte string, with near-zero blast radius. `-0` is an integer and serializes as `"0"` through the ordinary integer path; there is no bespoke `-0` branch.

3. Two-layer single source across languages. Layer A is a normative prose spec, `@synoi/sraid` `PROJECTION_SPEC.md` (CC0), that every SDK header and the GAP spec point to instead of re-deriving. Layer B is conformance vectors GENERATED from the `@synoi/sraid` reference implementation and consumed byte-for-byte by all four SDKs, the gateway signer, and the verifiers in CI. The vectors are the cross-language ABI: a divergent strip-set, number rule, or canonicalize turns a vector red. Every projection vector MUST carry `attestation`, `supersedes`, and `gap_version` so any strip-set divergence is caught (the old single vector carried none, which is why the copies coexisted green).

4. Fail-closed scheme cutover. Decision-receipt CDROs carry a `receipt_scheme` discriminator so a verifier fails CLOSED on an unknown or missing scheme rather than silently accepting a receipt it does not understand. The discriminator is stamped BEFORE signing, so it is bound into both the v1 signature and the v2 attestation content core and cannot be stripped or swapped without invalidating the seals. The live path is v2 (DSSE over the `cdroContentCore` above, signer key-generation K1 with cutover to K2). The v1 flat-scalar scheme is retained only for objects minted before v2 and is never confused for a content core.

5. Refused-budget is a billing status, not a governance deny. A spend-cap block terminates with status `refused_budget`, which maps to its own decision verb (`budget_refused`) so it never lands in the deny/authority corpus and never pollutes the authorized axis. It is a billing veto, not an authorization decision.

## Consequences

- Every projection surface changes; none keeps its former strip-set. That is expected: there was no correct list before, so the change is correct-by-source replacing correct-by-luck. The GAP SDKs (TypeScript, Python, Rust, Go) become thin aliases of the SRAID projection or conform their local strip-set to the six-field set.
- No live-path receipt re-signing. The live v2 signer already keeps `gap_version` + `supersedes`, so expanding the SRAID SDK strip-sets from 3/5/6 to the one six-field set is a no-op that becomes correct-by-source. The v1 flat 8-field signing shape stays a v1-only shape, gated behind `receipt_scheme`, never confused for a content core.
- CI gains a cross-language, cross-verifier vector gate on every PR to any affected repo. The projection can no longer be edited on one surface without reddening the others.
- Vault L1 identity and the v1 flat receipt projection are firewalled with an explicit note in `PROJECTION_SPEC.md`; they are NOT merged.
- Observation and sensor ingest paths that legitimately carry real-world floats (for example a raw sensor value) MUST quantize to integers with a declared scale and unit (milli-degrees, fixed-point coordinates, basis-point ratios) BEFORE signing. This preserves the cross-language OID guarantee rather than reopening the float hazard the number rule just closed.

## Rejected alternatives

- Strip `supersedes` to match the three SDKs. Rejected: it silently breaks the Merkle-DAG "head proves history" property, contradicts the live signer, and would force re-signing every v2 receipt while weakening the DAG.
- Permit floats with pinned `-0` and exponent conformance vectors. Rejected: it keeps the hardest RFC 8785 serialization hazard alive forever on a signed byte string, to support a value class the product never legitimately emits.
- Keep multiple projections and sync them by hand. Rejected: by-shape copies that "happen to agree" are exactly the disease. Only a shared reference plus shared vectors mechanically cannot disagree.

## References

- `@synoi/sraid` `PROJECTION_SPEC.md` (normative prose for the projection, the number rule, and the JCS rules).
- `@synoi/sraid` `src/oid.ts`, `src/canonicalize.ts` (the reference implementation the vectors are generated from).
- ADR_007 (the `gap:` signed namespace), ADR_008 (decision-receipt immutability, K1/K2 receipt-scheme).
- `GAP_SPEC.md` (this repo) - the CC0 protocol spec that now points to `PROJECTION_SPEC.md` for the single normative projection.
