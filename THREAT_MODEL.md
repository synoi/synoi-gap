# GAP Threat Model

**Date:** 2026-06-24
**Protocol version:** 1.0
**Methodology:** STRIDE

This threat model covers the Governed Action Protocol (GAP), the open Universal Action Coordination Fabric (CC0 spec, Apache-2.0 reference code at `synoi-gap/`). It analyzes the wire format (CDRO envelope), the HTTP surface defined in `IMPLEMENTING.md`, the type system in `src/`, and the gateway enforcement obligations ratified in ADR_006. It cross-references the 8 P0 attacks (B1 through B8) and the 25 protocol changes (PC-01 through PC-25) from the 7-sector review.

A note on status: GAP 1.0 ships as a type-system and protocol-specification layer. Many safety invariants are expressed in the types and JSDoc but their load-bearing enforcement is gateway code that is PENDING per ADR_006. Where a threat's mitigation lives only in PENDING gateway code, the Status column reflects PARTIAL, not MITIGATED. A type field that is not yet enforced is not a mitigation.

---

## 1. Assets and trust boundaries

The assets GAP exists to protect, in priority order:

| Asset | What it is | Why it matters |
|---|---|---|
| Authorization decision integrity | The grant evaluation outcome (allow / deny / hold) for a given invocation | The whole point of GAP. A wrong allow is an unauthorized physical or financial action. |
| Receipt authenticity | The `gap:decision_receipt` CDRO and its OID / signature | The audit trail. Regulated sectors (21 CFR Part 11, IEC 62443, SOC 2) depend on it being tamper-evident and non-repudiable. |
| Grant scope fidelity | `scope_narrowing`, `limits`, `aggregate_limits`, declaration pin | The operator consented to a bounded authority. Any widening of that bound is privilege escalation. |
| Approval-chain integrity | Workflow stage advancement, approver identity, two-person disjointness | HITL is the last line for class C / physical-safety actions. A spoofed YES unlocks a door. |
| Revocation effectiveness | That a revoked grant actually stops working, on time, including offline | Revocation latency and fail-open on a provisional block is a life-safety exposure. |
| Tenant isolation | That tenant A cannot read or write tenant B objects | Cross-tenant leakage breaks the multi-tenant contract entirely. |
| Signing key custody | The gateway Ed25519 (and L4 ML-DSA-65) private key(s) | The gateway is the sole signer of receipts. Key compromise forges the entire audit trail. |
| OID determinism | That `sha256(canonical(payload))` is identical across all conformant implementations | If two implementations canonicalize differently, signatures and content-addressing diverge: signature confusion. |

## 2. Actors and roles

| Actor | Trust level | Capabilities |
|---|---|---|
| Operator (`human_user`) | Trusted root of authority | Issues grants, defines workflows, initiates revocations, approves stages. Identified by an actor OID bound to a Bearer token. |
| Gateway / GAP server | Trusted enforcement point and sole signer | Evaluates grants, runs preconditions, emits and signs receipts, runs workflows, holds the signing key. |
| Skill / service / device / mcp_server (`agent` class) | Semi-trusted, scoped by grant | Publishes declarations, invokes capabilities under a grant, may delegate (sub-grant) within bounds. The presumed-compromisable actor in most threats. |
| Sub-agent (delegated) | Lower trust than its delegator | Holds a grant carrying `parent_grant_oid`. The deep-chain leaf is the assumed compromise point for delegation attacks. |
| Channel adapter | Trust depends on transport | Bridges abstract listen/action to SMS, webhook, push, voice. Sender authenticity is only as strong as the transport (PC-04). |
| External party (attacker) | Untrusted | May hold a stolen Bearer token, spoof an SMS `from`, hit a webhook, replay a captured receipt, or front-run a revocation. |
| Auditor / verifier | Trusted reader | Fetches receipts by OID, recomputes OIDs, verifies signatures against the published key. |

## 3. Trust boundaries

1. **Network boundary (client to gateway).** All `/v1/gap/*` traffic. Crossed by every request. Authenticated only by the Bearer token (`synoi-sk-<48 hex>`), which identifies a tenant, not a specific client identity. This is the primary attack surface.
2. **Tenant boundary.** Inside the gateway, between tenant A's CDRO store and tenant B's. Every query MUST filter by `tenant_id`. The `GET /v1/gap/revocations/:oid` route deliberately returns 404 (not 403) on cross-tenant OIDs to avoid confirming existence.
3. **Authority boundary (operator vs actor).** Grant issuance is restricted to operator-role actors; the gateway MUST verify the Bearer token's operator OID matches `granted_by` (`IMPLEMENTING.md` §4.2). Actors declare and invoke; operators grant and approve.
4. **Delegation boundary.** Between a parent grant and a child grant carrying `parent_grant_oid`. The child must be a strict scope subset, bounded by `max_delegation_depth` (default 0 for physical-safety, hard cap 10).
5. **Channel / transport boundary.** Between the gateway and an external responder (operator's phone, a webhook caller). The adapter is the trust translator; the gateway must not trust a `from` the adapter cannot authenticate (PC-04).
6. **Online / offline boundary.** Between a network-connected gateway and a constrained device verifying a signed receipt offline with no revocation feed. Bounded by `max_offline_ttl_ms` (PC-13).
7. **Signing boundary.** Between the gateway's private signing key and everyone else. The gateway is the sole signer; actors never self-certify (`IMPLEMENTING.md` §1).

---

## 4. Threat analysis (STRIDE per component)

### 4.1 POST /v1/gap/grants

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Non-operator actor issues a grant for itself (self-grant escalation) | M | H | Gateway MUST verify Bearer-token operator OID matches `granted_by`; grant issuance restricted to operator-role (`IMPLEMENTING.md` §4.2). B6. | PARTIAL |
| Spoofing | `granted_by` set to an arbitrary operator OID the caller does not control | M | H | B6 (granted_by unbound): gateway must bind `granted_by` to the authenticated principal. Type field exists; binding enforcement PENDING. | PARTIAL |
| Tampering | Grant body altered in flight to widen `scope_narrowing` or `limits` | L | H | OID is `sha256(canonical(body))`; any change yields a different OID. Optional Ed25519 signature. | MITIGATED |
| Tampering | Class-C grant issued with no `capability_declaration_oid` pin, then declaration superseded to widen terms | M | H | PC-05/PC-06: gateway MUST reject class-C / physical-safety grants lacking the pin at issuance. B4 (declaration supersession). Type + JSDoc done; issuance rejection PENDING. | PARTIAL |
| Repudiation | Operator denies issuing a grant | L | M | Grant is a signed CDRO with `granted_by`; `grant_issued` receipt emitted. | MITIGATED |
| Information disclosure | Grant enumeration reveals which actors hold which capabilities | L | M | Tenant-scoped store; Bearer token gates all reads. | MITIGATED |
| DoS | Flood of grant issuances exhausts store | M | L | Tenant-scoped rate limiting (operational, gateway config). | ACCEPTED |
| Elevation of privilege | Child grant (`parent_grant_oid`) widens scope beyond parent | M | H | B3 (delegation subset): subset rules defined in `IMPLEMENTING.md` §5 + JSDoc. Gateway parent-coverage check PENDING (PC-23). | PARTIAL |
| Elevation of privilege | Negative numeric bound passes an upper-bound-only constraint (e.g. `max_open_pct` with no `min_`) on a physical-safety grant | M | H | B7 (negative numeric bounds): gateway MUST require both `min_*` and `max_*` for physical-safety numeric constraints at issuance. Authoring rule documented; enforcement PENDING. | PARTIAL |
| Elevation of privilege | Aggregate / salami spend: per-invocation cap of $9,999 used 1,000 times | M | H | PC-24: `aggregate_limits` rolling-window sum. Type field done; gateway accounting PENDING. | PARTIAL |
| Elevation of privilege | Unbounded delegation depth lets a deep leaf inherit root authority | M | H | PC-23: `max_delegation_depth` default 0 for physical-safety, hard cap 10. Type + JSDoc done; depth counting PENDING. | PARTIAL |

### 4.2 POST /v1/gap/invocations

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Caller claims an `actor_oid` it does not own to use another actor's grant | M | H | Gateway MUST bind each Bearer token to a specific actor OID at token issuance time; step 2 of the grant evaluation algorithm MUST reject any invocation where `caller.actor_oid` does not match the token-bound actor OID, emitting `capability_denied:grant_actor_mismatch`. This MUST be enforced at the gateway layer, not the SDK layer. Tenant-level authentication without per-actor token binding renders the step-2 check ineffective for multi-actor tenants (`IMPLEMENTING.md` §5). Enforcement PENDING. | PARTIAL |
| Tampering | `args` altered to escape `scope_narrowing` after the grant check | L | H | Invocation is a CDRO; args are hashed into the OID and evaluated atomically against narrowing at gate time. | MITIGATED |
| Tampering | Client backdates `invoked_at_ms` to extend validity or alter audit time | M | M | PC-13: server always stamps `initiated_at_ms`; client value stored only as `client_claimed_at_ms`; MUST omit for class C / physical-safety. | PARTIAL |
| Repudiation | Actor denies invoking | L | M | Every invocation produces a `gap:decision_receipt`, including denials (`IMPLEMENTING.md` §7). | MITIGATED |
| Information disclosure | Denial detail leaks scope internals (which key was missing) | L | L | Denial receipt names the missing key in `detail` by design (audit value); tenant-scoped. Accept as intended. | ACCEPTED |
| Information disclosure | PHI in `args` logged in cleartext into the receipt | M | H | PC-18: `privacy_classification='phi'` drives handling obligations (no cleartext receipt logging). Gateway/adapter enforcement PENDING. | PARTIAL |
| DoS | High-volume invocation flood, or deep-delegation chain walk on every call | M | M | Grant `limits` + `rate_limited` status (PC-10); delegation cap stored on grant to avoid per-call chain walk (PC-23 rationale). Counter enforcement PENDING. | PARTIAL |
| Elevation of privilege | scope_narrowing silently ignored on an L1 gateway | M | H | Documented L1 gap (`IMPLEMENTING.md` §11): step 4 not enforced at L1. Operators MUST use L2+ for scope enforcement. Documented, not eliminated. | ACCEPTED |
| Elevation of privilege | Invocation `capability_declaration_oid` (routing hint) overrides the grant's authority pin | M | H | PC-07: invocation field is a routing hint only and MUST NOT override the grant pin. JSDoc done; resolution-precedence enforcement PENDING. | PARTIAL |

### 4.3 POST /v1/gap/workflows/signal

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Attacker spoofs SMS `from` or hits the webhook to supply a YES that approves a door unlock | H | H | B2 + PC-02: `StageListen.required_from_binding`; gateway MUST verify event `from` against it. Type field done; `from`-verification enforcement PENDING. | PARTIAL |
| Spoofing | Any tenant-authenticated principal approves a high-risk stage (no approver allow-list) | H | H | PC-09: `WorkflowStage.authorized_approvers`; gateway MUST resolve approver identity to the allow-list. Type field done; identity resolution PENDING. | PARTIAL |
| Tampering | Replayed signal advances a stage twice | M | M | Stage transitions are append-only CDROs; gateway must dedupe per stage. Dedup enforcement is gateway code. | PARTIAL |
| Repudiation | Approver denies sending the approval signal | M | M | `channel_event` CDRO + `stage_transition` CDRO record the signal and the advancement; `required_from_binding` ties it to a sender identity. | PARTIAL |
| Information disclosure | Signal endpoint confirms a workflow instance OID exists (enumeration) | M | M | Tenant-scoped; reject unregistered senders silently (drop, do not error) so the stage timer continues (`IMPLEMENTING.md` §8). | PARTIAL |
| DoS | Flood of bogus signals keeps the gateway busy but stage timer continues | L | L | Unregistered-sender signals are silently dropped without resetting the timer; rate limiting operational. | PARTIAL |
| Elevation of privilege | One person supplies two approvals to satisfy a two-person rule | M | H | B8 + PC-09: `authorized_approvers` disjointness + `StageSafety.two_person.require_disjoint_groups`. Disjointness enforcement PENDING; full two-person HTTP path is ACCEPTED gap. | ACCEPTED |
| Elevation of privilege | Sub-agent learns a workflow instance OID and injects a signal it should not see | M | H | Workflow instance OID leakage to sub-agents enables signal injection; mitigated only when `required_from_binding` + `authorized_approvers` are enforced. Until then, instance-OID confidentiality is the only barrier. | PARTIAL |

### 4.4 POST /v1/gap/declarations

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Actor declares a `created_by` OID it did not compute (self-reference forgery) | L | M | `created_by` is the self-computed declaration OID; OID is deterministic over the payload, so a forged self-reference does not verify. | MITIGATED |
| Tampering | Declaration body altered to claim broader capabilities | L | M | OID over canonical body; tampering changes the OID. | MITIGATED |
| Tampering | Declaration supersession silently widens a capability's terms under a live grant | M | H | B4 + PC-05/06/07: class-C grants pin the declaration OID; gateway evaluates against the pin not the live declaration. Pin enforcement PENDING. | PARTIAL |
| Repudiation | Actor denies publishing a declaration | L | L | Declaration is an immutable CDRO retrievable by OID. | MITIGATED |
| Information disclosure | Declaration enumeration reveals an actor's full capability surface | L | L | Tenant-scoped reads behind Bearer token. | MITIGATED |
| DoS | Declaration spam inflates the store | M | L | Tenant-scoped; operational rate limiting. | ACCEPTED |
| Elevation of privilege | Third party redefines a reserved well-known capability name to shadow a platform subsystem | M | M | PC-20: reserved OID exclusion set enumerated normatively; gateway rejects colliding declarations. Constants + JSDoc done; gateway rejection PENDING. | PARTIAL |

### 4.5 GET endpoints (receipts, grants, declarations by OID)

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Caller without a valid token reads a receipt | L | M | Bearer token required on all `/v1/gap/*` routes. | MITIGATED |
| Tampering | Reader cannot tell a returned object was altered | L | H | Verifier recomputes `sha256(canonical(envelope minus oid/gap_version/signature/signature_key_id/supersedes))` and compares to `oid` (`IMPLEMENTING.md` §2.3); optional signature check. | MITIGATED |
| Repudiation | Gateway serves a different receipt than the one originally minted | L | M | OID is content-addressed; a substituted body produces a different OID, detectable by any holder of the original OID. | MITIGATED |
| Information disclosure | Cross-tenant OID fetch confirms an object exists in another tenant | M | M | `GET /v1/gap/revocations/:oid` returns 404 (not 403) on tenant mismatch; same pattern MUST apply to all GET-by-OID routes. | PARTIAL |
| Information disclosure | Declaration / grant OID enumeration via timing (existence oracle) | M | M | Declaration OID enumeration via timing: constant-time tenant-scoped lookup + uniform 404 needed. Not specified; timing uniformity PENDING. | ACCEPTED |
| DoS | Unbounded receipt-list query (`GET /v1/gap/receipts?...`) scans the whole store | M | M | Cursor-based pagination with `limit` (`IMPLEMENTING.md` §10). Bound enforcement is gateway code. | PARTIAL |
| Elevation of privilege | List query without tenant filter returns another tenant's receipts | L | H | Every query MUST filter by `tenant_id` (`IMPLEMENTING.md` Implementation Notes). | PARTIAL |

### 4.6 POST /v1/gap/revoke / provisional-block / approve

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Non-operator initiates or approves a revocation | M | H | Operator-role restriction + Bearer binding; `approve` MUST reject self-approval (approver OID equals event `created_by`) and duplicate approvers (`revocations.ts` lines 55-62). Duplicate / self-approval rejection PENDING in gateway. | PARTIAL |
| Tampering | Approver list altered to forge quorum | L | H | RevocationEvent is a CDRO; approver entries hashed into OID. Append via `approve` re-issues a new state object. | MITIGATED |
| Repudiation | Operator denies revoking, or denies the timing of effect | M | M | PC-16: distinct `revocation_initiated` and `revocation_effective` receipts capture the propagation window. Both-emission PENDING. | PARTIAL |
| Information disclosure | Revocation-by-OID confirms a grant exists cross-tenant | L | M | `GET /v1/gap/revocations/:oid` returns 404 on tenant mismatch by design. | MITIGATED |
| DoS | Attacker delays / suppresses L3 approvers for 72h so a provisional block lapses and a physical-safety grant auto-re-enables | H | H | B1 + PC-01: `provisional_block_policy.on_expiry_without_quorum='renew'` for physical-safety / class C (`revocations.ts` lines 38-54). Gateway expiry-handling enforcement PENDING. | PARTIAL |
| Elevation of privilege | `revocation_level_override` on a grant used to dodge a provisional block | L | H | Provisional blocks bypass the grant override; they are an emergency operator action (`IMPLEMENTING.md` §9). | MITIGATED |
| Elevation of privilege | Revocation never propagates to a child grant in a delegation chain | M | H | PC-15: deterministic revocation propagation level resolution. Gateway implementation PENDING. | PARTIAL |

### 4.7 OID computation (sha256 canonical hash)

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Two implementations canonicalize differently and produce different OIDs for the same body (signature confusion) | M | H | Canonical JSON rules fixed in `IMPLEMENTING.md` §2.2 (lexicographic byte-order key sort, recursive, undefined/absent keys dropped, null kept as JSON null per RFC 8785 JCS, no whitespace, UTF-8). In-repo TS and Python byte-parity suites (`test/oid.test.ts`, `python/tests/test_oid.py`) including null/absent regression guards are passing. Cross-repo vector in `synoi-conformance` (PC-25) deferred. | PARTIAL |
| Tampering | Attacker finds a second body hashing to the same OID (collision) | L | H | SHA-256 collision resistance (2^128). No length-extension exposure: the OID is consumed as a whole hex digest, not as a MAC over attacker-controlled suffix. | MITIGATED |
| Tampering | Exclusion-set ambiguity: a field is hashed by one impl and excluded by another | M | H | Five excluded fields fixed: `oid`, `gap_version`, `signature`, `signature_key_id`, `supersedes` (`cdro.ts` lines 31-38). Any change to the set is a version bump. Both the OID-compute path and the verify path strip the same five fields. Cross-impl conformance vector in `synoi-conformance` (PC-25) deferred. | PARTIAL |
| Repudiation | OID recomputed after storage diverges from stored value | L | M | "Never recompute an OID after storing" (`IMPLEMENTING.md` Implementation Notes). Store-as-returned. | MITIGATED |
| Information disclosure | Timing side-channel on OID string comparison reveals OID bytes | L | L | Timing side-channel on OID comparison: OID equality on a public content address is low-value (OIDs are not secrets), but verifiers SHOULD use length-then-constant-time compare. Not specified. | ACCEPTED |
| DoS | Adversary submits deeply nested body to blow up canonicalization | L | M | Payload-size and nesting-depth bounds (gateway config). Not specified in protocol. | ACCEPTED |
| Elevation of privilege | `supersedes` excluded from hash lets an attacker re-point an object's predecessor without changing its OID | M | M | CDRO store injection via crafted `supersedes`: gateway MUST validate `supersedes` points to a same-tenant, same-type, actually-prior CDRO before honoring it for grant evaluation. Exclusion is intentional (§2.2) but validation of the pointer is gateway code, PENDING. | PARTIAL |

### 4.8 Ed25519 signature on receipts

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Actor self-signs a receipt to fake an authorization | L | H | Gateway is the sole signer; receipts verify against the gateway's published key only (`IMPLEMENTING.md` §1, §2.4). | MITIGATED |
| Spoofing | Old signing key reused after rotation; verifier accepts a signature from a retired key with no expiry check | M | H | Ed25519 key rotation attack: `GET /v1/gap/keys/:key_id` carries `valid_from_ms` / `expires_at_ms`, but verifiers are not REQUIRED to check expiry, and `expires_at_ms` is nullable. Key-lifecycle gap. KMS-backed key with published last-known-good and a MUST on verifier expiry-check is needed. | ACCEPTED |
| Tampering | Receipt body altered after signing | L | H | Signature is over the canonical envelope; alteration breaks both OID and signature. | MITIGATED |
| Repudiation | Gateway denies signing a receipt | L | H | Signature binds the receipt to the gateway key (non-repudiation), pending L4 hybrid for PQ durability. | MITIGATED |
| Information disclosure | Signature scheme leaks key material via faulty RNG / nonce reuse | L | H | Ed25519 is deterministic (no per-signature nonce RNG); no nonce-reuse class exists. | MITIGATED |
| DoS | Verifier forced to fetch the key on every receipt | L | L | Key cached by `key_id`; re-fetch only on cache miss (`IMPLEMENTING.md` §2.4). | MITIGATED |
| Elevation of privilege | Quantum adversary forges Ed25519 signatures | L | H | L4 hybrid Ed25519 + ML-DSA-65 (both MUST verify, fail-closed) per `IMPLEMENTING.md` §11 L4. Not active below L4. | PARTIAL |
| Elevation of privilege | Ephemeral / per-process signing key on the audit path | M | H | Signing keys MUST be KMS-backed with a published last-known-good pubkey; no ephemeral signing keys on an audit path. Not specified in the protocol; deployment obligation. | ACCEPTED |

### 4.9 Idempotency cache

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Attacker guesses another tenant's `idempotency_key` to retrieve their receipt | L | M | Key is scoped per-tenant `(tenant_id, idempotency_key)` (`IMPLEMENTING.md` Implementation Notes). | MITIGATED |
| Tampering | Same key reused with different `args` returns the original receipt, masking a different action | M | H | B5 (idempotency replay): gateway returns the original receipt without re-executing. PC-14: replay MUST be flagged `is_idempotency_replay=true`. Flagging is the load-bearing part and is PENDING. | PARTIAL |
| Repudiation | Cached `ok` returned after the grant was revoked, making a now-unauthorized action look freshly approved (confused deputy) | M | H | B5 + PC-14: replay flag forces the consumer to treat it as a cached prior decision, not a fresh gate. Flag enforcement PENDING. | PARTIAL |
| Information disclosure | Idempotency key collision reveals another caller's prior result | L | M | Per-tenant scoping; 24h TTL bounds the window. | MITIGATED |
| DoS | Cache flooded with unique keys to exhaust memory | M | L | 24h TTL + per-tenant scoping; size bound is gateway config. | ACCEPTED |
| Elevation of privilege | Replay of a cached `ok` substitutes for a fresh authorization on a class-C action | M | H | Class-C / physical-safety actions SHOULD NOT be idempotency-cached as fresh authorizations; replay flag + re-evaluation required. Enforcement PENDING. | PARTIAL |

### 4.10 Delegation chain evaluation

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | Child grant claims a `parent_grant_oid` it was never delegated | L | H | Gateway MUST fetch the parent and verify it covers all child scopes (`IMPLEMENTING.md` §5). Parent-coverage check PENDING. | PARTIAL |
| Tampering | Child widens scope beyond parent (adds a room, raises a cap) | M | H | B3 + delegation subset rules (`IMPLEMENTING.md` §5 table). Subset enforcement PENDING. | PARTIAL |
| Repudiation | No record of which grant authorized a delegated action | L | M | Receipt `capability_grant_oids` lists every grant evaluated; chain is reconstructable. | MITIGATED |
| Information disclosure | Walking the chain reveals upstream grant structure to a leaf | L | L | Tenant-scoped; chain walk is gateway-internal. | MITIGATED |
| DoS | Deep chain forces an expensive walk on every invocation | M | M | PC-23: cap stored on the grant (checked cheaply), hard cap 10 backstop. Depth counting PENDING. | PARTIAL |
| Elevation of privilege | Unbounded sub-delegation lets a compromised leaf inherit root authority | M | H | B3 + PC-23: `max_delegation_depth` default 0 for physical-safety, hard cap 10. Enforcement PENDING. | PARTIAL |

### 4.11 scope_narrowing evaluation algorithm

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Tampering | `args` key named to dodge a narrowing key (`room` vs `rooms`) | M | H | Exact key-name match, no normalization; absent narrowing key causes immediate deny, names the missing key in `detail` (`IMPLEMENTING.md` §5). | MITIGATED |
| Tampering | Negative value passes an upper-bound-only numeric constraint | M | H | B7: physical-safety numeric constraints MUST carry both `min_*` and `max_*`; grant rejected at issuance otherwise. Issuance rejection PENDING. | PARTIAL |
| Information disclosure | Denial detail enumerates narrowing keys | L | L | Intended audit behavior; tenant-scoped. | ACCEPTED |
| DoS | Deeply nested `scope_narrowing` object forces expensive recursion | L | L | Nesting-depth bound (gateway config). Not specified. | ACCEPTED |
| Elevation of privilege | Unevaluable constraint type (`null`, mixed array) treated as pass | L | H | "Unrecognized types MUST deny" + "deny by default on any error or ambiguity" (`IMPLEMENTING.md` §5). Fail-closed by spec. | MITIGATED |
| Elevation of privilege | scope_narrowing silently unenforced at L1 | M | H | Documented L1 gap; L2+ required for scope enforcement. | ACCEPTED |

### 4.12 Provisional block expiry mechanism

| STRIDE category | Threat | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| Tampering | Block `effective_at_ms` or policy altered to force early lapse | L | H | RevocationEvent CDRO; fields hashed into OID. | MITIGATED |
| Repudiation | No record of why a block lapsed vs was lifted | L | M | `lifted_at_ms`, `effective_at_ms`, and `provisional_block_policy` on the event; receipts for initiate/effective (PC-16). Both-receipt emission PENDING. | PARTIAL |
| DoS | Attacker suppresses approvers to run out the 72h clock on a physical-safety block (fail-open re-enable) | H | H | B1 + PC-01: `on_expiry_without_quorum='renew'` is the MUST default for physical-safety / class C (`revocations.ts` lines 38-54); only an explicit approver lift re-enables. Gateway expiry enforcement PENDING. | PARTIAL |
| Elevation of privilege | `revocation_level_override` used to weaken a block | L | H | Provisional blocks bypass the override (`IMPLEMENTING.md` §9). | MITIGATED |
| Elevation of privilege | Block auto-lapses for a class-C target because policy defaulted to `revert` | M | H | Absent policy MUST default to `renew` for physical-safety targets (`revocations.ts` lines 49-51). Gateway defaulting PENDING. | PARTIAL |

---

## 5. Attack surface summary

Ten highest-risk attack paths, ranked by likelihood x impact. Every top-tier path resolves to a PARTIAL: the type field exists, the gateway enforcement is PENDING per ADR_006. This is the central finding of this model: GAP 1.0's safety contract is expressed but not yet enforced.

| Rank | Attack path | L x I | Component | Tracking | Status |
|---|---|---|---|---|---|
| 1 | Provisional-block fail-open: suppress L3 approvers 72h, physical-safety grant auto-re-enables | H x H | 4.6 / 4.12 | B1, PC-01 | PARTIAL |
| 2 | Workflow signal injection: spoof SMS `from` / hit webhook to approve a door unlock | H x H | 4.3 | B2, PC-02/03/04 | PARTIAL |
| 3 | Any-approver escalation: any tenant-authenticated principal approves a class-C stage | H x H | 4.3 | PC-09 | PARTIAL |
| 4 | Delegation widening / unbounded depth: compromised leaf inherits root authority | M x H | 4.1 / 4.10 | B3, PC-23 | PARTIAL |
| 5 | Declaration supersession: re-declare a pinned capability with broader terms under a live class-C grant | M x H | 4.1 / 4.4 | B4, PC-05/06/07 | PARTIAL |
| 6 | Salami spend: per-invocation cap evaded by aggregate volume | M x H | 4.1 | PC-24 | PARTIAL |
| 7 | Negative-bound bypass: upper-bound-only numeric constraint passes a negative physical-safety value | M x H | 4.1 / 4.11 | B7 | PARTIAL |
| 8 | Idempotency replay confused-deputy: cached `ok` after revocation looks freshly authorized | M x H | 4.9 | B5, PC-14 | PARTIAL |
| 9 | Canonical JSON divergence: two implementations hash the same body differently (signature confusion) | M x H | 4.7 | PC-25 | PARTIAL |
| 10 | Ed25519 key-rotation / ephemeral-key acceptance: retired or per-process key forges audit trail | M x H | 4.8 | (new) | ACCEPTED |

## 6. Mitigations index

| STRIDE finding | Spec section | ADR_006 PC | Implementation status |
|---|---|---|---|
| Operator binds `granted_by` (B6) | §4.2 | (operator bootstrap) | PARTIAL (binding enforcement PENDING) |
| Class-C declaration pin (B4) | §5 | PC-05, PC-06, PC-07 | PARTIAL (issuance/resolution PENDING) |
| Delegation subset + depth (B3) | §5 | PC-23 | PARTIAL (chain check PENDING) |
| Negative numeric bound (B7) | §5 (min_* rule) | PC-08, PC-19 | PARTIAL (issuance rejection PENDING) |
| Aggregate / salami spend | §5 | PC-24 | PARTIAL (rolling accounting PENDING) |
| Sender-identity binding (B2) | §8 | PC-02, PC-03, PC-04 | PARTIAL (`from`-verification PENDING) |
| Approver allow-list + disjointness (B8) | §8 | PC-09 | ACCEPTED / PARTIAL (identity resolution PENDING) |
| Fail-closed physical-safety timeout | §8 | PC-11, PC-12 | PARTIAL (registration rejection PENDING) |
| Provisional-block fail-open (B1) | §9 | PC-01 | PARTIAL (expiry handling PENDING) |
| Idempotency replay flag (B5) | §6 | PC-14 | PARTIAL (flagging PENDING) |
| Rate-limited as distinct status | §6 | PC-10 | MITIGATED (type) |
| Revocation phase receipts | §9 | PC-15, PC-16 | PARTIAL (emission PENDING) |
| PHI handling obligations | §7 | PC-18 | PARTIAL (enforcement PENDING) |
| Reserved OID exclusion set | §2 | PC-20 | PARTIAL (gateway rejection PENDING) |
| Offline receipt TTL | §7 | PC-13 | PARTIAL (device verifier PENDING) |
| Destructive-stage safety pipeline | §8 | PC-21 | PARTIAL (pipeline routing PENDING) |
| Optional-effect isolation | §8 | PC-22 | PARTIAL (gateway PENDING) |
| OID determinism / canonical JSON | §2.2 | PC-25 | PARTIAL (in-repo TS+Python byte-parity suites pass; cross-repo vector in synoi-conformance deferred) |
| Ed25519 signature, sole-signer | §1, §2.4 | (L4 hybrid) | MITIGATED (Ed25519) / PARTIAL (PQ at L4) |
| Tenant isolation | Impl Notes, §10 | (tenant boundary) | PARTIAL (per-query filter is gateway code) |
| Server-stamped timestamps | §6 | PC-13 | PARTIAL (enforcement PENDING) |
| `supersedes` pointer validation | §2.2 | (new, this model) | PARTIAL (validation PENDING) |
| Key rotation / expiry verifier check | §2.4 | (new, this model) | ACCEPTED |
| Bearer token binding to client | §3 | (new, this model) | ACCEPTED (deployment) |

## 7. Residual risks

What GAP 1.0 explicitly does NOT mitigate, and why:

1. **Bearer token theft.** The token (`synoi-sk-<48 hex>`) identifies a tenant, not a specific client, and is a bearer credential with no token binding to client identity (no mTLS, no DPoP-style proof-of-possession). A stolen token grants the thief the tenant's full authority. This is mitigated by operator deployment practices (secret storage, TLS, rotation), not by the protocol. Adding token-to-client binding is a candidate for a future version.

2. **Ed25519 key-rotation acceptance.** Verifiers are not REQUIRED to check `expires_at_ms`, and the field is nullable. A retired key can still verify old signatures by design (so historical receipts remain checkable), but nothing in the protocol forces a verifier to reject a signature from a key that should no longer be trusted for fresh receipts. Recommendation outside this model: KMS-backed signing keys with a published last-known-good pubkey, a MUST on verifier expiry-checking for fresh receipts, and no ephemeral signing keys on any audit path.

3. **Canonical JSON implementation divergence.** The canonical rules are specified (§2.2). The integer-only constraint (no floats permitted in any GAP-hashed field; money amounts in integer minor units) eliminates one class of numeric serialization divergence between JCS and RFC 8259 §6. In-repo byte-parity suites (`test/oid.test.ts`, `python/tests/test_oid.py`) verify the TypeScript and Python SDKs produce byte-identical OIDs for all GAP-legal inputs, including null/absent regression guards. A cross-repo vector in `synoi-conformance` (PC-25) covering third-party implementations is deferred for 1.0. Until PC-25 is met, cross-implementation OID stability is internally verified but not externally certified.

4. **Timing side-channels (OID comparison, declaration enumeration).** OIDs are public content addresses, not secrets, so OID-comparison timing is low value. Declaration / grant existence enumeration via timing is a real but low-impact information-disclosure path; uniform 404 timing is not specified. Accepted at low severity for 1.0.

5. **The entire PENDING gateway enforcement layer.** Every PARTIAL above shares one root cause: the type system and JSDoc express the safety invariant, but the load-bearing gateway code that rejects the unsafe configuration at registration / issuance / invocation time is not yet written (ADR_006 PENDING items). GAP 1.0 is safe to claim at the type and wire layer; it is NOT yet safe to claim L2+ enforcement for any high-risk capability until the corresponding PC-25 conformance vector passes. Per CLAIMS_DISCIPLINE: no enforcement claim without a vector.

6. **Receipt replay against a disconnected device beyond intent.** `max_offline_ttl_ms` (PC-13) bounds the window, but the constrained-device verifier that honors the TTL is downstream SDK work, not gateway. A device that ignores the TTL will honor a captured signed receipt indefinitely. Mitigated by device-profile conformance, not by the gateway alone.

7. **Whole-receipt replay (no CDRO-level TTL by default).** Outside the physical-safety `max_offline_ttl_ms` carve-out, a signed receipt is valid forever: the OID and signature verify regardless of age. Online consumers must check revocation and freshness themselves; the protocol does not stamp a general-purpose expiry on every receipt. Accepted for 1.0; revisit if a non-physical-safety replay vector is found.

8. **Federation trust-domain policy.** Cross-tenant `gap:federation_handshake` is L4 and its trust-domain inputs (which gateway trusts which, for what scope) are out of scope for this model and for GAP 1.0 enforcement (PC-17 PENDING).
