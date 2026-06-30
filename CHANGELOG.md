# Changelog

All notable changes to `@synoi/gap` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

## [Unreleased]

No unreleased changes.

## [0.1.0] - 2026-06-24

### Added

**Core types and utilities**
- `CapabilityDeclaration`, `CapabilityGrant`, `CapabilityInvocation`, `GapDecisionReceipt`, `RevocationEvent`, `WorkflowDefinition`, `WorkflowInstance`, `StageTransition`, `ChannelEvent` CDRO types
- `computeGapOid` content-addressed OID computation (sha256 over canonical JSON)
- `canonicalize` canonical JSON serialization (exported for cross-language implementors)
- `capabilityMatches` dotted-taxonomy pattern matching
- `validateCapabilityDeclaration`, `validateCapabilityGrant`, `validateCapabilityInvocation` validators
- `isGapFailure` type guard

**Protocol fields (physical-safety hardening)**
- `provisional_block_policy` on `RevocationEventBody`: fail-closed expiry semantics for provisional blocks (PC-01)
- `required_from_binding` on `StageListen`: trusted sender validation for workflow signals (PC-02)
- `is_idempotency_replay`, `client_claimed_at_ms`, `max_offline_ttl_ms` on `GapDecisionReceiptBody` (PC-06, PC-13)
- `rate_limited` added to `DecisionStatus` union (PC-10)
- `min_approvers` on `RevocationEventBody`: L3 quorum threshold
- `authorized_approvers` on `WorkflowStage`: two-person integrity enforcement (PC-09)
- `aggregate_limits` on `CapabilityGrantBody.limits`: rolling-window financial controls (PC-24)
- `requires_operator_approval` on `WorkflowDefinitionBody`: operator gate for physical-safety workflow registration (PC-12)
- OID hash exclusion set enumerated in `GapCdroEnvelope` JSDoc (PC-20)

**Protocol rules clarified**
- `capability_declaration_oid` on `GrantedCapabilityScope`: REQUIRED for safety_class C or physical_safety=true (PC-05)
- `max_delegation_depth` default documented as 0 for physical_safety=true grants (PC-23)
- scope_narrowing `min_*` lower-bound rule documented and enforced (PC-08)

**Documentation**
- `IMPLEMENTING.md`: full protocol implementation guide with RFC 2119 conventions, conformance tier matrix, and regulatory appendix (21 CFR Part 11, IEC 62443, SOC 2)
- `USE_CASES.md`: cross-sector scenario reference (gaming, industrial, healthcare, AI pipelines, smart home, physical security)
- `OPTIONAL_CAPABILITIES_SPEC.md`: normative spec for optional ambient effects
- `CAPABILITY_TAXONOMY.md`: canonical dotted-taxonomy names for well-known capabilities across 9 domains
- `openapi.yaml`: OpenAPI 3.1.0 spec for the full GAP HTTP surface
- `ERROR_CODES.md`: machine-readable error code registry with conformance tier annotations
- `THREAT_MODEL.md`: STRIDE threat model across 12 protocol components

**Conformance**
- `test/conformance.test.ts`: 60 protocol conformance vectors (OID computation, scope_narrowing evaluation, delegation subset, idempotency behavior) with pinned cross-run hash assertions

**Python SDK** (`python/`)
- `synoi_gap.oid`: `compute_gap_oid`, `canonicalize` matching TypeScript behavior
- `synoi_gap.validate`: shape validators for CDRO envelopes, declarations, grants, invocations
- `synoi_gap.client`: `GapClient` async HTTP wrapper covering all HTTP surface endpoints

**Security**
- P0 blocker mitigations B1-B8 from cross-sector safety review (ADR-006, filed as GitHub Discussion)
- `SECURITY.md` vulnerability disclosure policy

### Security

- B1: provisional block fail-open: `provisional_block_policy.on_expiry_without_quorum` field added; physical_safety=true grants treated as `'renew'` by default
- B2: workflow signal injection: `required_from_binding` field added for sender identity pinning
- B3: delegation subset undefined: algorithm fully specified in IMPLEMENTING.md Section 5
- B4: declaration supersession downgrade: `supersedes` pointer validation rules documented
- B5: idempotency replay without re-validation: `is_idempotency_replay` field + re-validation rules in IMPLEMENTING.md Section 6
- B6: `granted_by` unbound: binding rules documented in IMPLEMENTING.md Section 4.2
- B7: negative numeric bounds bypass: scope evaluation rule documented; negative values MUST be denied for physical_safety=true
- B8: two-person integrity with no HTTP path: `authorized_approvers` field added; `/revoke/approve` endpoint documented
