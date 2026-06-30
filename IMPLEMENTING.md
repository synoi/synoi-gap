# Implementing GAP

This guide explains how to build a GAP-conformant server from scratch in any language. It covers the wire format, the four lifecycle phases, the HTTP surface, grant evaluation rules, receipts, and what each conformance tier requires.

If you are writing TypeScript, start with `@synoi/gap` (this package) for the type definitions and OID utilities. If you are using another language, this guide is your primary reference.

### Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they appear in all capitals, as shown here.

---

## Contents

1. [Concepts](#1-concepts)
2. [Wire Format](#2-wire-format)
3. [Authentication](#3-authentication)
4. [Phase 1: Declare](#4-phase-1-declare)
5. [Phase 2: Grant](#5-phase-2-grant)
6. [Phase 3: Invoke](#6-phase-3-invoke)
7. [Phase 4: Receipt](#7-phase-4-receipt)
8. [Workflows](#8-workflows)
9. [Revocation](#9-revocation)
10. [HTTP API Surface](#10-http-api-surface)
11. [Conformance Tiers](#11-conformance-tiers)
12. [Offline Operation](#12-offline-operation)
13. [Minimal L1 Walkthrough](#13-minimal-l1-walkthrough)

---

## 1. Concepts

GAP governs every action an AI agent takes by running it through a four-phase lifecycle:

```
Actor                Gateway / GAP Server              Operator
  |                         |                              |
  |--- declare capability ->|                              |
  |                         |<--- issue grant -------------|
  |--- invoke capability  ->|                              |
  |                         |-- evaluate grant             |
  |                         |-- run preconditions          |
  |                         |-- emit receipt               |
  |<-- receipt (allow/deny)-|                              |
```

Every step produces an immutable, content-addressed record called a **CDRO** (Content-addressed, Deterministic, Replayable Object). CDROs are how GAP ensures every action is auditable and every decision is traceable.

**Key invariants:**

- Every gate decision MUST produce a receipt, including denials.
- Receipts are append-only. Nothing is deleted; revocation events are themselves CDROs.
- OIDs are content-addressed: `sha256(canonical(payload))`. If an OID verifies, the content is authentic.
- The gateway is the sole signer of receipts. Actors do not self-certify their own invocations.

---

## 2. Wire Format

### 2.1 The CDRO Envelope

Every GAP object shares this top-level shape:

```json
{
  "oid": "sha256:a3f2...",
  "type": "gap:capability_grant",
  "gap_version": "1.0",
  "tenant_id": "tenant-abc",
  "created_at_ms": 1750000000000,
  "created_by": "sha256:actor-oid...",
  "body": { ... },
  "signature": "base64url...",
  "signature_key_id": "key-1",
  "supersedes": null
}
```

| Field | Required | Description |
|---|---|---|
| `oid` | yes | `sha256:<64 hex chars>`, computed before signing |
| `type` | yes | One of the `gap:*` type strings below |
| `gap_version` | yes | Always `"1.0"` for this spec version |
| `tenant_id` | yes | Owning tenant; CDROs never implicitly cross tenant boundaries |
| `created_at_ms` | yes | Unix epoch milliseconds |
| `created_by` | yes | OID of the actor creating this record |
| `body` | yes | Type-specific payload (see each phase below) |
| `signature` | no | Ed25519 over the canonical envelope, base64url |
| `signature_key_id` | no | Identifies the signing key |
| `supersedes` | no | OID of the prior version (long-lived types only) |

**Object types:**

| `type` value | Purpose |
|---|---|
| `gap:capability_declaration` | Actor advertising what it can do |
| `gap:capability_grant` | Operator authorizing an actor to invoke capabilities |
| `gap:capability_invocation` | A single act of calling a capability |
| `gap:workflow_definition` | Operator-authored multi-stage approval state machine |
| `gap:workflow_instance` | One execution of a definition |
| `gap:stage_transition` | A single stage advancing in a workflow |
| `gap:channel_event` | A prompt or response on a channel (SMS, voice, push, etc.) |
| `gap:decision_receipt` | The audit record for any gate decision |
| `gap:revocation_event` | A capability, grant, or workflow being revoked |
| `gap:federation_handshake` | Cross-tenant trust establishment (reserved for GAP 1.1 - not part of the active 1.0 conformance surface) |

### 2.2 OID Computation

The OID is the SHA-256 hash of the canonical form of the **payload**: the envelope with exactly these five fields removed before hashing: `oid`, `gap_version`, `signature`, `signature_key_id`, `supersedes`. No other fields are removed. This exclusion set is fixed for GAP 1.0; any change constitutes a protocol version bump.

**Step 1: Build the payload object.**

```json
{
  "type": "gap:capability_grant",
  "tenant_id": "tenant-abc",
  "created_at_ms": 1750000000000,
  "created_by": "sha256:actor...",
  "body": { ... }
}
```

Do NOT include `oid`, `gap_version`, `signature`, `signature_key_id`, or `supersedes` in the hashed content. `supersedes` is intentionally excluded so that superseding a CDRO does not change the superseded object's OID.

**Step 2: Canonicalize.**

Canonical JSON rules (RFC 8785 JCS):
- Object keys are sorted lexicographically (byte order, not locale).
- Recursively: nested objects also sort their keys.
- Arrays preserve their element order.
- `undefined` values (absent keys in JavaScript; keys not present in the dict in Python) are omitted. `null` is kept and serialized as JSON `null` (RFC 8785 JCS: null is a first-class JSON value).
- No extra whitespace.
- UTF-8 encoding (the canonical string is hashed as UTF-8 bytes).
- **Numbers:** Number values in any GAP-hashed field MUST be integers. Floats are not permitted. Money amounts MUST use integer minor units (e.g. whole cents). Implementations MUST reject float inputs with a clear error before canonicalization. All GAP timestamp fields (`created_at_ms`, `expires_at_ms`, etc.) MUST be non-negative integers. Integer values serialize as their JSON integer representation with no decimal point and no trailing zeros (`1`, not `1.0`). `NaN` and `Infinity` are not valid JSON and MUST be rejected before canonicalization. (Note: only the integer serialization rule from RFC 8785 JCS applies to GAP number values; RFC 8259 §6 float handling does not apply to GAP-hashed fields.)
- **Strings:** Serialized per RFC 8259 §7. Non-ASCII characters MUST be emitted as their UTF-8 byte sequences, not as `\uXXXX` escape sequences. (This matches the default output of JavaScript's `JSON.stringify` and Python's `json.dumps(ensure_ascii=False)`.) The only permitted `\uXXXX` escapes are for control characters U+0000-U+001F where required by JSON.
- **Booleans:** `true` / `false` (lowercase). No variation.

Example: this payload:

```json
{ "type": "gap:capability_declaration", "created_by": "sha256:abc", "tenant_id": "t1", "created_at_ms": 1, "body": { "z": 1, "a": 2 } }
```

Canonicalizes to:

```
{"body":{"a":2,"z":1},"created_at_ms":1,"created_by":"sha256:abc","tenant_id":"t1","type":"gap:capability_declaration"}
```

**Step 3: Hash.**

```
oid = "sha256:" + hex(sha256(utf8(canonical_json)))
```

The TypeScript helper `computeGapOid(payload)` from `@synoi/gap` does all three steps. For other languages, any SHA-256 library with the canonical JSON rules above produces identical OIDs.

### 2.3 Verification

To verify a CDRO you received:

1. Extract the `oid` field.
2. Remove `oid`, `gap_version`, `signature`, `signature_key_id`, and `supersedes` from the object.
3. Canonicalize and hash the remainder.
4. Compare to the extracted `oid`. If they differ, the object was tampered with.
5. (Optional) Verify the `signature` against the gateway's published public key.

### 2.4 Key Distribution

For step 5, the gateway exposes its current signing key at:

```
GET /v1/gap/keys/current
Authorization: Bearer synoi-sk-...
```

Response:

```json
{
  "key_id": "key-1",
  "algorithm": "Ed25519",
  "public_key_base64": "...",
  "public_key_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "valid_from_ms": 1750000000000,
  "expires_at_ms": null
}
```

For constrained devices (IoT, embedded) that cannot call the endpoint on every verification:

1. Fetch and cache the key at device provisioning time.
2. Store `key_id` alongside the cached key.
3. On verification, look up the key by `key_id` from the receipt's `signature_key_id`.
4. If `key_id` is not in cache, re-fetch from the gateway.

Key rotation: the gateway publishes a new key before retiring the old one. Old keys remain valid for verifying receipts signed under them. The current key is always the one returned by `GET /v1/gap/keys/current`.

---

## 3. Authentication

All `/v1/gap/*` endpoints require a Bearer token:

```
Authorization: Bearer synoi-sk-<48 hex chars>
```

The token identifies a tenant. Every object stored through the API is scoped to that tenant. An actor cannot read or write another tenant's objects.

When passing a grant OID in a request header, use:

```
X-GAP-Grant: sha256:<hex>
```

Or as an Authorization header variant:

```
Authorization: GAPGrant sha256:<hex>
```

---

## 4. Phase 1: Declare

Before any actor can be granted capabilities, it must publish a declaration.

### What a declaration contains

```json
{
  "actor_type": "skill",
  "actor_id": "skill:my-lighting-controller",
  "actor_name": "Lighting Controller",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "home.lighting.control",
      "safety_class": "B",
      "scope": { "rooms": ["any"] }
    },
    {
      "capability": "home.lighting.read",
      "safety_class": "A"
    }
  ],
  "human_summary": "Controls and reads smart lighting over the local network."
}
```

**Actor types:** `skill`, `service`, `device`, `agent`, `mcp_server`, `gateway_subsystem`, `human_user`

**Safety classes:**
- `A`: read-only or reversible with no physical risk
- `B`: state-changing but recoverable
- `C`: physical-safety-critical or irreversible (locks, valves, medical)

**`require_signed_receipt`** (optional boolean on each capability entry) controls whether the gateway attaches a cryptographic signature to decision receipts for that capability:

| Value | Gateway behavior |
|---|---|
| `true` | MUST sign every receipt for this capability, regardless of server tier |
| `false` | SHOULD omit the signature even on an L4 server (use for high-frequency trivial actions) |
| absent | Applies the server's configured default signing policy |

The operator may override this per grant scope via `GrantedCapabilityScope.require_signed_receipt`. The grant takes precedence over the declaration. This lets a compliance deployment require signed receipts for every action regardless of what actors declared.

**Capability taxonomy** uses dotted paths: `home.lighting.control`, `physical.lock.disengage`, `financial.transfer.initiate`. Top-level domains: `gap.*`, `device.*`, `home.*`, `network.*`, `identity.*`, `inference.*`, `vault.*`, `mcp.*`, `messaging.*`, `financial.*`, `physical.*`, `medical.*`. Custom capabilities use a vendor prefix: `vendor.acme.my-action`.

### Actor OID bootstrap

Every CDRO envelope requires a `created_by` field containing the actor's OID. For a new actor making its first declaration, there is no prior OID, but one is not needed from the server. **Actors compute their own OID client-side before POSTing.**

The OID of a declaration is deterministic: it is the SHA-256 of the canonical payload you are about to send. So the sequence is:

1. Build the declaration payload with a stable seed in `created_by`. For the first declaration from a new actor, `created_by` MUST be a seed identifier of the form `actor:<slug>` or `public_key:<hex>`. This is the one permitted exception to the `sha256:` OID requirement for `created_by`: the actor does not yet have an OID.
   ```json
   {
     "type": "gap:capability_declaration",
     "tenant_id": "my-tenant",
     "created_at_ms": 1750000000000,
     "created_by": "actor:my-skill",
     "body": { ... }
   }
   ```
2. Compute `oid = computeGapOid(payload)`. This is the actor's established OID.
3. POST this payload as-is (do NOT replace `created_by` with the computed OID; the seed stays). The gateway stores the declaration and the computed OID becomes the actor's canonical identifier.
4. All subsequent declarations from this actor MUST use `sha256:<oid>` as `created_by` and SHOULD include `supersedes` pointing to the prior declaration OID.

**Why the seed stays:** the OID is computed over the envelope including `created_by`. Replacing `created_by` with the OID would change the payload and invalidate the OID - a fixed-point that SHA-256 cannot satisfy. The seed is permanent in the first declaration; it is what gets hashed.

In TypeScript with `@synoi/gap`:

```typescript
import { computeGapOid } from '@synoi/gap'

const body = {
  actor_type: 'skill' as const,
  actor_id: 'skill:my-lighting-controller',
  actor_name: 'Lighting Controller',
  actor_version: '1.0.0',
  capabilities: [{ capability: 'home.lighting.control', safety_class: 'B' as const }],
}

// Build payload with stable seed in created_by
const payload = {
  type: 'gap:capability_declaration' as const,
  tenant_id: 'my-tenant',
  created_at_ms: Date.now(),
  created_by: 'actor:my-lighting-controller',  // seed: stays in the payload
  body,
}

// The OID is computed from the payload-with-seed and becomes the actor's identity
const oid = computeGapOid(payload)

// POST payload (the seed created_by, not the OID) to /v1/gap/declarations
// The gateway returns { oid, ...payload }
// oid is now the actor's canonical identifier for all future CDROs
```

For subsequent declarations (declaration supersession), use the OID returned from the prior POST as `created_by`.

### 4.2 Operator (human_user) bootstrap

An operator establishes their own actor OID using the same `computeGapOid` pattern:

```typescript
import { computeGapOid, GAP_VERSION } from '@synoi/gap'

const seed = 'operator:' + tenantId + ':' + operatorEmail  // stable seed

const provisional = {
  type: 'gap:capability_declaration' as const,
  tenant_id: tenantId,
  created_at_ms: Date.now(),
  created_by: seed,
  body: {
    actor_type: 'human_user' as const,
    actor_id: 'operator:' + operatorEmail,
    actor_name: 'Operator',
    actor_version: '1.0.0',
    capabilities: [],   // operators do not declare capabilities; they grant them
  },
}

const oid = computeGapOid(provisional)
const payload = { ...provisional, created_by: oid }
// POST payload to POST /v1/gap/declarations
// Use the gateway-returned OID as the authoritative operator OID
```

The operator OID appears in every grant's `granted_by` field. The gateway MUST verify at grant acceptance time that the Bearer token's associated operator OID matches `granted_by`. Grant issuance is restricted to operator-role actors.

### HTTP request

```
POST /v1/gap/declarations
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "created_by": "sha256:<actor-oid>",
  "body": {
    "actor_type": "skill",
    "actor_id": "skill:my-lighting-controller",
    "actor_name": "Lighting Controller",
    "actor_version": "1.0.0",
    "capabilities": [
      { "capability": "home.lighting.control", "safety_class": "B" }
    ]
  }
}
```

### Response

```json
{
  "oid": "sha256:d4e5...",
  "type": "gap:capability_declaration",
  "gap_version": "1.0",
  "tenant_id": "tenant-abc",
  "created_at_ms": 1750000000000,
  "created_by": "sha256:<actor-oid>",
  "body": { ... }
}
```

### Superseding a declaration

When an actor publishes a new version, include `supersedes` in the request:

```json
{
  "created_by": "sha256:<actor-oid>",
  "supersedes": "sha256:<prior-declaration-oid>",
  "body": { ... }
}
```

The prior declaration remains retrievable by OID but the gateway uses the new one for grant evaluation.

---

## 5. Phase 2: Grant

A grant is the operator's authorization for a specific actor to invoke specific capabilities. Nothing can be invoked without a matching, non-expired, non-revoked grant.

### What a grant contains

```json
{
  "grantee": {
    "actor_type": "skill",
    "actor_oid": "sha256:d4e5..."
  },
  "capability_scopes": [
    {
      "capability": "home.lighting.control",
      "capability_declaration_oid": "sha256:d4e5...",
      "scope_narrowing": { "rooms": ["studio", "kitchen"] }
    }
  ],
  "granted_at_ms": 1750000000000,
  "expires_at_ms": 1780000000000,
  "granted_by": "sha256:<operator-oid>",
  "reason": "Approved via HITL on 2026-06-24"
}
```

**`scope_narrowing`** restricts the actor's declared scope. If the declaration says `rooms: ["any"]`, the grant can narrow to `rooms: ["studio", "kitchen"]`. The invocation args must satisfy the narrowing. See the [scope_narrowing evaluation algorithm](#scope_narrowing-evaluation) below for exact semantics.

**`expires_at_ms`**: set to `null` for grants that are valid until explicitly revoked.

### Delegated grants

When an orchestrator actor delegates authority to a sub-agent, the sub-agent's grant includes a `parent_grant_oid` pointing back to the orchestrator's grant:

```json
{
  "grantee": { "actor_type": "agent", "actor_oid": "sha256:<sub-agent-oid>" },
  "capability_scopes": [{ "capability": "mcp.github.merge_pr" }],
  "granted_at_ms": 1750000000000,
  "expires_at_ms": 1750003600000,
  "granted_by": "sha256:<orchestrator-oid>",
  "parent_grant_oid": "sha256:<root-grant-oid>",
  "max_delegation_depth": 0
}
```

When `parent_grant_oid` is present, the gateway MUST:
1. Fetch the parent grant.
2. Verify the parent grant covers all `capability_scopes` in this grant (scope must be a subset).
3. Verify the parent grant has not expired or been revoked.
4. Verify `max_delegation_depth` in the parent grant is >= 1 (or absent, meaning unlimited depth).

Set `max_delegation_depth: 0` on a grant to prevent further sub-delegation.

### HTTP request

```
POST /v1/gap/grants
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "created_by": "sha256:<operator-oid>",
  "body": {
    "grantee": {
      "actor_type": "skill",
      "actor_oid": "sha256:d4e5..."
    },
    "capability_scopes": [
      { "capability": "home.lighting.control" }
    ],
    "granted_at_ms": 1750000000000,
    "expires_at_ms": null,
    "granted_by": "sha256:<operator-oid>"
  }
}
```

### Grant evaluation algorithm

The caller MUST supply `caller.grant_oid` in the invocation body. This OID is authoritative: the gateway evaluates only the named grant, not a search across all grants for the actor. This design gives deterministic results when an actor holds multiple grants covering the same capability.

When an invocation arrives, the gateway evaluates it in this order:

1. Look up the grant by `caller.grant_oid` within this tenant. If not found, deny with `capability_denied:no_grant`.
2. Verify `grant.grantee.actor_oid` matches `caller.actor_oid`. If not, deny with `capability_denied:grant_actor_mismatch`. (This prevents grant poaching: a caller cannot name a grant that was issued to a different actor.)
3. Verify the requested `capability` matches at least one entry in `grant.body.capability_scopes[].capability` using glob matching. If not, deny with `capability_denied:no_grant`.
4. Check expiry: if `expires_at_ms` is not null and is in the past, deny with `capability_denied:grant_expired`.
5. Check revocation: if any `gap:revocation_event` targets this grant OID, deny with `capability_denied:grant_revoked`.
6. Evaluate `scope_narrowing` (from the matching capability scope) against the invocation `args`. The invocation MUST satisfy ALL narrowing constraints (see scope_narrowing evaluation below). Deny with `capability_denied:scope_key_absent` if a narrowing key is absent from args; deny with `capability_denied:scope_value_mismatch` if a value does not satisfy its constraint; deny with `capability_denied:scope_unevaluable` if a constraint type is unrecognized.
7. Evaluate `additional_preconditions` (from the grant) and `preconditions` (from the declaration). ALL must pass. Deny with `capability_denied:precondition_failed` if any predicate returns false.
8. Check `limits` against current usage counters. Deny with `capability_denied:rate_limited` if per-minute or total invocation limits are exceeded; deny with `capability_denied:aggregate_limit_exceeded` if a rolling-window aggregate ceiling would be crossed.
9. If all checks pass, proceed to channel adapter dispatch and issue an `ok` receipt.

**Deny by default.** If grant evaluation encounters any error or ambiguity, it MUST deny. Never allow on uncertainty.

**Error code requirement.** The `detail` field in `GapDecisionReceipt.body` MUST contain the exact namespaced wire code from `ERROR_CODES.md` (e.g. `capability_denied:scope_key_absent`). Non-namespaced or freeform strings in `detail` are not conformant at L2+.

**Actor-token binding (MUST).** The gateway MUST bind each Bearer token to a specific actor OID at token issuance time. An invocation MUST be rejected with `capability_denied:grant_actor_mismatch` if `caller.actor_oid` does not match the actor OID bound to the presented Bearer token. Tenant-level authentication without per-actor token binding makes the `caller.actor_oid` check in step 2 ineffective for multi-actor tenants, because any actor holding a tenant token could claim any actor OID. This binding MUST be enforced at the gateway layer, not delegated to the SDK or the calling client.

### scope_narrowing evaluation

`scope_narrowing` is a `Record<string, unknown>`. The gateway evaluates it against the invocation `args` using these rules:

**For each key `K` in `scope_narrowing`:**

| Type of `scope_narrowing[K]` | Evaluation rule |
|---|---|
| `string` | `args[K]` must equal `scope_narrowing[K]` exactly (case-sensitive) |
| `boolean` | `args[K]` must equal `scope_narrowing[K]` |
| `number` | `args[K]` must be <= `scope_narrowing[K]` (upper bound). For minimum thresholds, use a key convention like `min_*`: `args[K]` >= `scope_narrowing[K]`. |
| `string[]` (array of strings) | `args[K]` must be one of the values in the array |
| `number[]` (array of numbers) | `args[K]` must be one of the values in the array |
| `object` | Recursively apply these rules to nested keys |

**Absent keys:** If `scope_narrowing` contains a key that is absent from `args`, the invocation is **denied**. Every narrowing constraint must be satisfiable from the invocation args.

**Non-negative integer requirement for upper-bound constraints.** For numeric upper-bound constraints (plain key name, no `min_` prefix), `args[K]` MUST be a non-negative integer. A negative value MUST result in `capability_denied:scope_value_mismatch` regardless of the numeric comparison. A negative amount on a physical-safety capability is a safety bypass attempt and MUST be denied.

**Unrecognized types:** If `scope_narrowing[K]` is not one of the types above (e.g. `null`, a mixed array), the gateway MUST deny. Never allow on an unevaluable constraint.

**Worked examples:**

```
# Example 1: array membership (rooms)
scope_narrowing: { "rooms": ["studio", "kitchen"] }
args:            { "room": "studio" }    -> PASS  (args.room is in the array)
args:            { "room": "bedroom" }   -> DENY
args:            {}                      -> DENY  (key absent)

# Example 2: numeric upper bound (financial threshold)
scope_narrowing: { "max_amount_usd": 10000 }
args:            { "amount_usd": 9999 }  -> PASS  (9999 <= 10000)
args:            { "amount_usd": 10001 } -> DENY
args:            {}                      -> DENY  (key absent)

# Example 3: exact string (topic)
scope_narrowing: { "topic": "game-achievements" }
args:            { "topic": "game-achievements" }  -> PASS
args:            { "topic": "general" }            -> DENY

# Example 4: negative value safety bypass (upper-bound constraint)
scope_narrowing: { "max_amount": 25 }
args:            { "max_amount": 25 }   -> PASS  (25 <= 25, non-negative)
args:            { "max_amount": -5 }   -> DENY  (capability_denied:scope_value_mismatch -- negative value not permitted on upper-bound constraint)
args:            { "max_amount": 26 }   -> DENY  (exceeds upper bound)
```

Note on key naming: `scope_narrowing` keys and `args` keys must match exactly. `rooms` (plural, array) is NOT automatically matched against `room` (singular, string). Convention: use plural keys in `scope_narrowing` for array constraints and expect the same plural key in `args`.

### Numeric lower bounds (min_* prefix convention)

A scope_narrowing key prefixed with `min_` is evaluated as a LOWER bound:
`args[K] >= scope_narrowing[K]`. All other numeric keys are upper bounds:
`args[K] <= scope_narrowing[K]`.

**Medical example: insulin dose delta (integer minor units):**
```json
// Grant scope_narrowing: allow dose deltas of -200 to +500 milliunits (integer minor units)
{
  "min_delta_milliunits": -200,
  "max_delta_milliunits": 500
}
// Invocation args (ACCEPTED)
{ "delta_milliunits": 300 }
// Invocation args (DENIED -- -800 < min -200)
{ "delta_milliunits": -800 }
// Invocation args (DENIED -- 600 > max 500)
{ "delta_milliunits": 600 }
```

> **Integer-only constraint:** All numeric values in `scope_narrowing` and invocation `args` MUST be integers. Floats are not permitted in any GAP-hashed field. Use integer minor units for fractional domains (milliunits, whole cents, tenths of a percent, etc.). A gateway MUST reject any invocation where a numeric arg value is a float.

**Critical (safety_class C) grant authoring rule:** For any scope_narrowing
key whose `min_*` sibling is absent, any negative args value will pass the
upper-bound check. For safety_class C or physical_safety=true capabilities,
the gateway MUST require both `min_*` and `max_*` forms when any numeric
constraint is present. A grant missing the `min_*` sibling for a physical
safety numeric constraint MUST be rejected at issuance time.

**OT example: valve opening percentage:**
```json
// Correct: both lower and upper bound
{ "min_open_pct": 0, "max_open_pct": 25 }
// Dangerous: upper bound only -- negative value passes!
{ "max_open_pct": 25 }  // DO NOT USE for physical safety capabilities
```

**Key name exact match:** scope_narrowing key names MUST exactly match the
invocation args key names. There is no normalization. `rooms` (plural) does
NOT automatically match `room` (singular). A scope_narrowing key absent from
invocation args causes an immediate deny. The denial receipt MUST name the
missing key in `detail`.

### Delegated Grant Scope Subset Rules

When a grant carries `parent_grant_oid`, the gateway MUST enforce that the child's `scope_narrowing` is at least as restrictive as the parent's at grant acceptance time:

| scope_narrowing value type | Subset rule |
|---|---|
| `string` | Child value must equal parent value exactly |
| `boolean` | Child value must equal parent value exactly |
| `number` (upper bound, plain key or `max_` prefix) | Child value must be <= parent value |
| `number` (lower bound, `min_` prefix) | Child value must be >= parent value |
| `string[]` | Every element in the child array must appear in the parent array (child is a strict subset) |
| Absent in child, present in parent | Gateway MUST deny: child cannot drop a constraint the parent set |
| Present in child, absent in parent | Permitted: child adds a constraint beyond the parent |

**Worked example: string array rejection:**
```json
// Parent grant scope_narrowing
{ "rooms": ["living_room", "kitchen"] }
// Child grant scope_narrowing (REJECTED -- hallway not in parent)
{ "rooms": ["living_room", "hallway"] }
// Child grant scope_narrowing (ACCEPTED -- strict subset)
{ "rooms": ["living_room"] }
```

**Worked example: numeric upper bound rejection:**
```json
// Parent: max $10,000 per invocation
{ "max_amount_usd": 10000 }
// Child (REJECTED -- 25000 > 10000)
{ "max_amount_usd": 25000 }
// Child (ACCEPTED)
{ "max_amount_usd": 5000 }
```

**Worked example: numeric lower bound:**
```json
// min_temp_c key uses >= rule (lower bound)
// Parent: min_temp_c 15 means "cannot set below 15 degrees"
{ "min_temp_c": 15, "max_temp_c": 30 }
// Child (REJECTED -- min_temp_c 10 < 15 widens the lower bound)
{ "min_temp_c": 10, "max_temp_c": 28 }
// Child (ACCEPTED)
{ "min_temp_c": 18, "max_temp_c": 25 }
```

---

## 6. Phase 3: Invoke

An invocation is the act of an actor requesting that the gateway execute a capability.

### HTTP request

```
POST /v1/gap/invocations
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "caller": {
    "actor_type": "skill",
    "actor_oid": "sha256:d4e5...",
    "grant_oid": "sha256:f6a7..."
  },
  "capability": "home.lighting.control",
  "args": {
    "rooms": "studio",
    "action": "dim",
    "level": 30
  },
  "idempotency_key": "req-2026-06-24-001"
}
```

**Required fields:** `caller.actor_type`, `caller.actor_oid`, `caller.grant_oid`, `capability`, `args`.

**`capability_declaration_oid`** is optional. If provided, the gateway MAY use it as a routing hint to skip the declaration lookup. If omitted, the gateway resolves the declaration from the grant's `capability_scopes`.

**`invoked_at_ms`** is server-stamped. Clients SHOULD omit this field; the gateway sets it to the time the invocation was received.

**Server-stamp rule:** Clients MUST omit `invoked_at_ms` for capabilities
with `physical_safety=true` or `safety_class='C'`. The gateway server-stamps
`initiated_at_ms` in the decision receipt unconditionally for those
capabilities. A client-supplied value is stored in `client_claimed_at_ms` on
the receipt for debugging only and MUST NOT appear in `initiated_at_ms`.

For all other capabilities, clients SHOULD omit `invoked_at_ms`; the gateway
MAY accept a client-supplied value but MUST reject any value more than 5
minutes in the future or more than 60 seconds in the past.

**SOC 2 / 21 CFR Part 11 note:** Receipt `initiated_at_ms` is always the
server-received timestamp. Client-supplied timestamps have no effect on the
tamper-evident audit record.

**`idempotency_key`** is optional. If provided and a prior invocation with the same key exists for this tenant, the gateway returns the original receipt without re-executing. The key is scoped per-tenant and valid for 24 hours.

### Invocation outcomes

The gateway responds with one of these outcomes:

| Outcome | HTTP status | Meaning |
|---|---|---|
| `ok` | 200 | Capability executed, receipt attached |
| `denied` | 403 | No matching grant, or precondition failed |
| `revoked` | 410 | A matching grant exists but has been revoked |
| `pending_workflow` | 202 | Capability requires HITL; workflow started |
| `timed_out` | 408 | Execution exceeded the SLA hint |
| `failed` | 500 | Actor adapter errored |
| `rate_limited` | 429 | Grant limits exceeded |

**`ok` response:**

```json
{
  "status": "ok",
  "receipt_oid": "sha256:c3d4...",
  "receipt": { ... }
}
```

**`denied` response:**

```json
{
  "reason": "capability_denied",
  "detail": "no matching grant found",
  "receipt_oid": "sha256:e7f8..."
}
```

**`pending_workflow` response:**

```json
{
  "status": "pending_workflow",
  "workflow_instance_oid": "sha256:b1c2...",
  "receipt_oid": "sha256:a9b0..."
}
```

The caller polls `GET /v1/gap/workflows/instances/:oid` to watch the workflow state.

**pending_workflow status rule:** An invocation that triggers a HITL workflow
MUST emit a `gap:decision_receipt` with `status='pending'` at the moment the
workflow is started. This pending receipt is NOT updated in place. When the
workflow reaches a terminal stage, a NEW receipt is emitted with the terminal
`status` (`ok`, `denied`, or `timed_out`). The `workflow_instance_oid` field
on both receipts links them. Auditors can retrieve both receipts to see the
full approval chain.

---

## 7. Phase 4: Receipt

Every gate decision produces a `gap:decision_receipt` CDRO. This is the audit trail. Implementors MUST emit a receipt for every invocation, including denials, timeouts, and errors.

### Receipt body

```json
{
  "subject_kind": "capability_invocation",
  "subject_oid": "sha256:<invocation-oid>",
  "initiator": {
    "actor_oid": "sha256:<caller-oid>",
    "actor_type": "skill"
  },
  "status": "ok",
  "detail": null,
  "capability_grant_oids": ["sha256:<grant-oid>"],
  "workflow_instance_oid": null,
  "initiated_at_ms": 1750000000000,
  "resolved_at_ms": 1750000000042,
  "metrics": {
    "latency_ms": 42
  }
}
```

**`subject_kind`** values: `capability_invocation`, `stage_transition`, `grant_issued`, `grant_revoked`, `workflow_started`, `workflow_terminated`, `revocation_initiated`, `revocation_effective`, `federation_handshake` (reserved for GAP 1.1), `provisional_block`

**`status`** values: `ok`, `denied`, `failed`, `deferred`, `timed_out`, `pending`

### Receipt requirements (all tiers)

- The receipt MUST be a valid `gap:decision_receipt` CDRO with a correct OID.
- `initiated_at_ms` is when the invocation was received. `resolved_at_ms` is when the decision was made.
- `capability_grant_oids` lists every grant that was evaluated (even if denied; list the candidates that were checked).
- The gateway MUST be able to return any receipt by OID via `GET /v1/gap/receipts/:oid`.

### compliance_tags vocabulary

`compliance_tags` on a `gap:decision_receipt` is populated by the gateway (not the caller). Callers MUST NOT set these; gateway-set values are authoritative. Tags are immutable post-issuance and are NOT included in the OID hash (they are gateway annotations, not part of the canonical body).

**Minimum gateway-set tags per safety class:**

| Tag | When set |
|---|---|
| `safety_class:A` | Any receipt for a safety_class A capability |
| `safety_class:B` | Any receipt for a safety_class B capability |
| `safety_class:C` | Any receipt for a safety_class C capability |
| `physical_safety` | Any receipt for a physical_safety=true capability |
| `hitl_approved` | Receipt from a workflow that reached terminal_outcome='approved' |
| `hitl_denied` | Receipt from a workflow that reached terminal_outcome='denied' |
| `idempotency_replay` | Receipt served from idempotency cache (is_idempotency_replay=true) |
| `rate_limited` | Receipt with status='rate_limited' |

**Sector-specific tags** (set when declaration body includes matching classification):

| Tag | Condition |
|---|---|
| `phi` | Declaration has privacy_classification='phi' |
| `21-cfr-11` | Deployment has asserted 21 CFR Part 11 mode (gateway config) |
| `iec-62443` | Deployment has asserted IEC 62443 mode (gateway config) |
| `soc2` | Deployment has asserted SOC 2 mode (gateway config) |

### Fetch a receipt

```
GET /v1/gap/receipts/sha256:c3d4...
Authorization: Bearer synoi-sk-...
```

---

## 8. Workflows

Workflows handle multi-stage approvals: pulse lights, send SMS, wait for yes/no, escalate to a second person on timeout. They are the mechanism for human-in-the-loop (HITL) decisions.

A workflow has two parts: a **definition** (the state machine template) and an **instance** (one execution).

### Define a workflow

```
POST /v1/gap/workflows/definitions
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "created_by": "sha256:<operator-oid>",
  "body": {
    "workflow_id": "physical-unlock-approval",
    "workflow_name": "Physical Lock Unlock Approval",
    "workflow_version": "1.0.0",
    "required_channels": ["sms"],
    "max_total_duration_seconds": 300,
    "initial_stage_id": "notify",
    "trigger": {
      "kind": "capability_invocation",
      "capability_pattern": "physical.lock.*"
    },
    "stages": [
      {
        "stage_id": "notify",
        "duration_seconds": 30,
        "actions": [
          {
            "channel": "sms",
            "method": "send",
            "params": {
              "to": "{{operator_phone}}",
              "body": "Approve unlock of {{device_name}}? Reply YES or NO."
            }
          }
        ],
        "listen": [
          {
            "channel": "sms",
            "pattern": "^YES$",
            "next": { "next_stage_id": "approved" }
          },
          {
            "channel": "sms",
            "pattern": "^NO$",
            "next": { "next_stage_id": "denied" }
          }
        ],
        "on_timeout": { "next_stage_id": "escalate" }
      },
      {
        "stage_id": "approved",
        "terminal": true,
        "terminal_outcome": "approved"
      },
      {
        "stage_id": "denied",
        "terminal": true,
        "terminal_outcome": "denied"
      },
      {
        "stage_id": "escalate",
        "terminal": true,
        "terminal_outcome": "timed_out"
      }
    ]
  }
}
```

### Start a workflow

```
POST /v1/gap/workflows/start
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "workflow_definition_oid": "sha256:<def-oid>",
  "trigger_event": {
    "kind": "capability_invocation",
    "source_invocation_oid": "sha256:<inv-oid>",
    "source_actor_oid": "sha256:<actor-oid>"
  }
}
```

### Linking a workflow to a capability invocation

Workflows are linked to invocations through a `capability_invocation` trigger kind on the workflow definition. The gateway auto-matches:

1. Operator registers a workflow definition with `trigger.kind = "capability_invocation"` and `trigger.capability_pattern = "physical.lock.*"`.
2. When an invocation arrives for `physical.lock.disengage`, the gateway looks for a matching workflow definition (capability pattern match against `trigger.capability_pattern`).
3. If found, the gateway starts a workflow instance automatically and returns `202 pending_workflow` to the caller.

The operator does NOT need to specify the workflow at grant time. The gateway matches by capability pattern at invocation time. Multiple workflow definitions may exist for the same pattern; the gateway selects the most recently registered active one.

To register a workflow that applies only under specific conditions, use `trigger.kind = "risk_policy"`; the gateway applies it only when the risk score exceeds a threshold, leaving normal invocations synchronous.

### Template variable interpolation

Workflow stage `params` support `{{variable}}` interpolation. The double-brace syntax resolves from the workflow's `scope_variables` map at stage execution time.

**Variable namespace:**

| Variable reference | Resolves to |
|---|---|
| `{{workflow_instance_oid}}` | OID of the current workflow instance |
| `{{actor_oid}}` | OID of the actor that triggered the workflow |
| `{{grant_oid}}` | OID of the grant used in the triggering invocation |
| `{{capability}}` | Capability name from the triggering invocation |
| `{{args.KEY}}` | Value of `args.KEY` from the triggering invocation |
| `{{scope.KEY}}` | Value of `scope_variables.KEY` set in this or a prior stage |
| `{{tenant_id}}` | Tenant identifier |
| `{{operator_phone}}` | Operator's registered phone number for SMS channels |

**Escaping:** Use `{{{{` and `}}}}` to produce a literal `{{` or `}}` in output.

**Missing variable behavior:** If a variable reference cannot be resolved, the gateway MUST abort stage execution and transition to `on_action_failure`. Silent empty-string substitution is not permitted.

### Poll instance state

```
GET /v1/gap/workflows/instances/sha256:<instance-oid>
Authorization: Bearer synoi-sk-...
```

The response includes `current_stage_id`, `terminal_outcome` (null while running), and `transition_oids`.

### Inject a channel signal

When a channel adapter receives a response (SMS reply, voice intent, push notification tap), signal the workflow:

```
POST /v1/gap/workflows/signal
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "workflow_instance_oid": "sha256:<instance-oid>",
  "channel": "sms",
  "event": {
    "kind": "message",
    "body": "YES",
    "from": "+18015550100"
  }
}
```

**Sender identity validation:** The gateway MUST verify that the channel
event's `from` field matches the operator's registered sender identity for
the specified channel before accepting the signal and advancing the workflow
stage. The exact form of the binding depends on the channel kind:

| Channel kind | `required_from_binding` format |
|---|---|
| `sms` | E.164 phone number registered for the tenant |
| `voice` | E.164 phone number |
| `email` | Email address |
| `slack` | Slack user ID |
| `mobile_push` | Actor OID |
| `sse` | Session token or actor OID |
| `webhook` | Expected sender identity string |
| `in_app` | Actor OID |
| `game_engine` | Actor OID |
| `local_terminal` | Actor OID (verified against locally-registered public key) |
| `hmi_panel` | Actor OID (verified against local roster CDRO) |
| `opc_ua_ack` | Actor OID (scoped to an authorized OPC-UA operator session) |
| `local_signed_token` | Actor OID (verified against locally-held root public key) |

Signals from unregistered senders MUST be rejected and MUST NOT advance the
workflow stage. A rejection does not terminate the workflow; it is silently
dropped while the stage timer continues.

For physical_safety=true or safety_class C capabilities, use
`StageListen.required_from_binding` to specify the exact expected sender
identity. Omitting this field means any tenant-authenticated caller can
advance the stage; only safe for class A capabilities.

**Physical-safety required_from_binding (MUST).** For any workflow stage that advances a `capability_invocation` with `physical_safety: true` or `safety_class: C`, the stage definition MUST include a non-empty `required_from_binding`. A gateway MUST reject registration of a `workflow_definition` that omits `required_from_binding` on such stages. This is enforced at definition registration time (`POST /v1/gap/workflows/definitions`) via `workflow_rejected:from_binding_required`.

> **SMS from-field warning.** SMS `from` fields are carrier-level spoofable and MUST NOT be used as the sole binding for class-C stages. Combine SMS with an `authorized_approvers` allowlist or use a channel kind whose sender identity is cryptographically verified (`mobile_push`, `local_signed_token`, `opc_ua_ack`).

### Available Channel Kinds

GAP ships with the following channel kinds. Connectivity column indicates
what infrastructure must be reachable at HITL time.

| Kind | Connectivity | Notes |
|---|---|---|
| `sms` | Internet | REQUIRED at L3. Baseline for all internet-connected deployments |
| `voice` | Internet | IVR response; good for operators without smartphones |
| `email` | Internet | Approve/deny link; longer latency acceptable |
| `slack` | Internet | Block Kit buttons |
| `mobile_push` | Internet | APNs / FCM |
| `sse` | LAN/Internet | Server-Sent Events to a connected dashboard |
| `webhook` | LAN/Internet | HTTP POST; any endpoint with inbound HTTP |
| `in_app` | Local | Overlay within the actor's own UI |
| `game_engine` | Local | Unity / Unreal / Godot hook |
| `local_terminal` | Air-gapped | Operator console; hardware token or biometric required |
| `hmi_panel` | Air-gapped | HMI touchscreen or physical operator panel |
| `opc_ua_ack` | Air-gapped | OPC-UA acknowledgement from SCADA/historian |
| `local_signed_token` | Air-gapped | QR code, smart card, or NFC token scanned at device |

Custom channel kinds MAY be registered using a reverse-domain prefix
(e.g. `com.example.pager`). They MUST implement the `ChannelAdapter` interface.

#### Wiring an execution backend (Composio example)

GAP governs whether an action is authorized; a separate execution backend carries out the approved action. The channel adapter boundary is where the two connect. An example using [Composio](https://composio.dev) (a third-party tool-execution platform) is available in the `synoi-demo/gap-demo/` repository. The pattern:

1. The gateway evaluates the invocation and emits an `ok` decision receipt.
2. The channel adapter receives the `ok` receipt and its `grant_oid`.
3. The adapter calls the execution backend (Composio, a webhook, a local function) with the approved args.
4. The execution result is NOT part of the GAP wire format; it is out-of-band. Only the authorization receipt is signed and stored.

Any execution backend can be wired this way. Composio, custom webhooks, local function calls, and hardware actuators all follow the same pattern. The protocol does not require or endorse any specific execution layer.

**Home-device adapters (Philips Hue, WLED, Home Assistant, etc.):** A hosted gateway typically ships integration-class adapters (webhook, Composio, Slack, SMS). For capabilities that target local-network devices such as `home.light.*`, `home.scene.*`, or `home.thermostat.*`, the recommended path is to run a local GAP runtime on the same network as the devices. [Gard](https://github.com/synoi/synoi-gard) is a lightweight single-tenant GAP server built for exactly this case: it ships native Hue, WLED, and Home Assistant adapters and runs without an account. A client configured to talk to Gard can point at a hosted gateway with no code changes when multi-tenant or federation is needed.

#### Air-gapped HITL example

```json
{
  "stage_id": "operator-ack",
  "channel": "hmi_panel",
  "action": {
    "display": "Authorize valve close on reactor-1 coolant loop?",
    "options": ["APPROVE", "DENY"]
  },
  "listen": {
    "event_type": "operator_selection",
    "required_from_binding": "did:gap:operator-oid-here"
  },
  "authorized_approvers": ["did:gap:operator-oid-here"],
  "duration_seconds": 120,
  "on_timeout": "deny"
}
```

The `hmi_panel` adapter verifies the operator's badge against the local roster CDRO
and produces a `gap:stage_transition` CDRO signed by the local gateway key.
On reconnection, this CDRO is synchronized and the complete receipt chain is established.

---

## 9. Revocation

GAP has three revocation levels. Higher levels require more process but provide stronger guarantees.

| Level | Use case | Effect |
|---|---|---|
| L1 | Routine: expired key, compromised credential | Immediate. All further invocations denied. |
| L2 | Policy change: removing an actor from a service | Multi-approver quorum before effective. |
| L3 | Safety-critical physical access | Emergency block (72hr provisional) + L2 process in parallel. |

**L1 revoke (immediate):**

```
POST /v1/gap/revoke
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "created_by": "sha256:<operator-oid>",
  "body": {
    "target_oid": "sha256:<grant-or-declaration-oid>",
    "target_type": "gap:capability_grant",
    "revocation_level": 1,
    "reason": "Credential rotation"
  }
}
```

**Emergency 72-hour block (L3):**

```
POST /v1/gap/revoke/provisional-block
Authorization: Bearer synoi-sk-...
Content-Type: application/json

{
  "created_by": "sha256:<operator-oid>",
  "body": {
    "target_oid": "sha256:<grant-or-declaration-oid>",
    "target_kind": "capability_grant",
    "reason": "Suspected compromised credential -- emergency lock",
    "provisional": true,
    "required_level": 3,
    "approvers": [],
    "effective_at_ms": null
  }
}
```

| Field | Description |
|---|---|
| `target_oid` | OID of the grant or declaration to block |
| `target_kind` | `"capability_grant"` or `"capability_declaration"` |
| `reason` | Human-readable reason (required for audit trail) |
| `provisional` | Always `true` for provisional blocks |
| `required_level` | `3` for L3 emergency block |
| `approvers` | Empty array on initiation; approver entries added via `POST /v1/gap/revoke/approve` |
| `effective_at_ms` | `null` on initiation; set when the permanent revocation is finalized |

A provisional block takes effect immediately and is valid for 72 hours. The L3 multi-approver process runs in parallel. If the L3 process completes within 72 hours, the provisional block is replaced by the permanent revocation. If not, the provisional block expires and the target is re-enabled until the process completes.

> **CRITICAL: physical_safety=true carve-out:** The default 72-hour
> expiry-to-re-enable behavior is dangerous for grants covering
> `physical_safety=true` or `safety_class='C'` capabilities. An attacker who
> can delay or suppress L3 approvers for 72 hours regains authority
> automatically.
>
> For physical safety grants, set `provisional_block_policy.on_expiry_without_quorum`
> to `'renew'` (the recommended default for physical safety). This causes the
> block to auto-renew rather than lapse. An approver must explicitly lift the
> block via `POST /v1/gap/revoke/approve` to re-enable the target.
>
> Never rely on automatic expiry as the re-enable mechanism for door locks,
> valve controllers, infusion pumps, or any capability that can change
> physical-world state.

Note: `revocation_level_override` on a grant does NOT prevent a provisional block. Provisional blocks bypass the grant's override level; they are an emergency operator action, not a normal revocation path.

### POST /v1/gap/revoke/provisional-block: response

Returns the created RevocationEvent CDRO envelope:

```json
{
  "oid": "sha256:<hex>",
  "type": "gap:revocation_event",
  "gap_version": "1.0",
  "tenant_id": "...",
  "created_at_ms": 1720000000000,
  "created_by": "sha256:<operator-oid>",
  "body": {
    "target_kind": "capability_grant",
    "target_oid": "sha256:<grant-oid>",
    "reason": "...",
    "required_level": 3,
    "provisional": true,
    "approvers": [],
    "effective_at_ms": null,
    "provisional_block_policy": { "on_expiry_without_quorum": "renew" }
  }
}
```

### POST /v1/gap/revoke/approve: request

```json
{
  "revocation_event_oid": "sha256:<revocation-event-oid>",
  "approver_actor_oid": "sha256:<approver-oid>",
  "attestation_oid": "sha256:<optional-attestation-cdro-oid>"
}
```

Response: the updated RevocationEvent CDRO with the new approver entry appended and `effective_at_ms` set if quorum is reached.

The gateway MUST reject: duplicate approvals from the same `actor_oid`; self-approval (approver OID equals the revocation event `created_by`).

---

## 10. HTTP API Surface

All routes are under `/v1/gap/`. Authentication: `Authorization: Bearer synoi-sk-...`.

### Declarations

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/gap/declarations` | Publish a new capability declaration |
| `GET` | `/v1/gap/declarations/:oid` | Fetch a declaration by OID |

### Grants

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/gap/grants` | Issue a new grant |
| `GET` | `/v1/gap/grants/:oid` | Fetch a grant by OID |
| `GET` | `/v1/gap/grants?actor_oid=&capability=&status=` | List active grants for an actor (query params: `actor_oid`, `capability`, `status=active\|revoked\|expired`) |
| `POST` | `/v1/gap/grants/:oid/update` | Update grant predicates (signed by operator) |

### Invocations

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/gap/invocations` | Invoke a capability |
| `GET` | `/v1/gap/invocations/:oid` | Fetch an invocation (via its receipt) |

### Workflows

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/gap/workflows/definitions` | Define a workflow |
| `GET` | `/v1/gap/workflows/definitions/:oid` | Fetch a definition |
| `POST` | `/v1/gap/workflows/start` | Start a workflow instance |
| `GET` | `/v1/gap/workflows/instances/:oid` | Fetch instance state |
| `GET` | `/v1/gap/workflows/instances/:oid/transitions` | List stage transitions |
| `POST` | `/v1/gap/workflows/signal` | Inject a channel event |

### Receipts

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/gap/receipts/:oid` | Fetch a receipt by OID |
| `GET` | `/v1/gap/receipts?actor_oid=&grant_oid=&capability=&from_ms=&to_ms=&status=&limit=&cursor=` | List receipts (paginated, all params optional; `status` = `ok\|denied\|deferred\|timed_out\|pending\|failed`) |

The list endpoint returns receipts in reverse-chronological order with cursor-based pagination. Use for audit queries: "show all actions taken by actor X under grant Y in the last 24 hours."

### Revocation

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/gap/revoke` | L1 immediate revocation |
| `POST` | `/v1/gap/revoke/l2/initiate` | Start L2 multi-approver process |
| `POST` | `/v1/gap/revoke/l3/initiate` | Start L3 safety-critical process |
| `POST` | `/v1/gap/revoke/provisional-block` | Emergency 72-hour block |
| `POST` | `/v1/gap/revoke/approve` | Add an approver to a pending revocation |
| `GET` | `/v1/gap/revocations/:oid` | Retrieve a RevocationEvent CDRO by OID. Returns 404 if not found or if the stored object's `tenant_id` does not match the authenticated tenant (never 403; do not confirm cross-tenant OID existence). |
| `GET` | `/v1/gap/revocations?grant_oid=&target_kind=&since_ms=` | List revocation events for a grant or declaration. Used by constrained IoT devices to maintain a local revocation cache. |

### Keys

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/gap/keys/current` | Fetch the current signing public key (Ed25519, JWK + base64url) |
| `GET` | `/v1/gap/keys/:key_id` | Fetch a specific historical signing key by ID |

### Channels

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/gap/channels` | List available channel adapters and their health |

### Error shape

All errors return:

```json
{
  "error": {
    "message": "human-readable description",
    "type": "capability_denied | not_found | invalid_request | auth_error | internal_error"
  }
}
```

---

## 11. Conformance Tiers

GAP defines four conformance tiers. Each tier is a strict superset of the previous. In a hosted deployment, each tier maps to a distinct service with its own infrastructure profile and cost model. Self-hosted deployments may colocate tiers in a single process.

```
Invocation request
        |
        v
  ┌─────────────────────────────────────────────────────┐
  │  Dispatcher (reads declaration require_signed_receipt │
  │  + checks for workflow trigger match)                 │
  └──────┬──────────────┬──────────────┬────────────────┘
         │              │              │
         v              v              v
    ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
    │   L1/L2  │   │   L2+    │   │   L3     │   │   L4     │
    │  Fast    │   │ Signing  │   │ Workflow │   │ PQ Sign  │
    │  Path    │   │  Path    │   │  Path    │   │  Path    │
    └─────────┘   └──────────┘   └──────────┘   └──────────┘
  unsigned receipt  Ed25519 signed   HITL state   ML-DSA-65
  OID integrity     receipt          machine      hybrid signed
  ~0.2ms            ~1ms             async        ~5ms
  scales to zero    warm instance    Step Fns/ECS  warm instance
```

The `require_signed_receipt` field on the capability declaration (and its grant-level override) is the routing signal. The dispatcher reads it once and hands off to the correct path. Authorization and receipt issuance happen in the fast path; signing is a separate step.

---

### L1: OID Receipts

**Minimum viable implementation. Fast path.**

An L1 server:

- Accepts and stores `gap:capability_declaration` CDROs.
- Accepts and stores `gap:capability_grant` CDROs.
- Accepts `gap:capability_invocation` requests.
- Evaluates grants (steps 1-3 of the grant evaluation algorithm above: find, filter expired, filter revoked).
- Emits a `gap:decision_receipt` for every invocation, including denials.
- Computes OIDs correctly per §2.2.
- Returns receipts by OID.
- Implements L1 revocation (`POST /v1/gap/revoke`).

An L1 server does NOT need to support workflows, channel adapters, signing, or multi-approver revocation.

**What a receipt proves at L1:** The OID (`sha256:...`) proves the content has not been altered since issuance. Anyone holding the OID can re-fetch the receipt and verify the hash. This is content-integrity, not authorship-integrity; it proves what was decided, not who decided it.

**Infrastructure profile:** Stateless. Scales to zero. No persistent connections. Suitable for serverless Lambda at minimum memory (128MB). Handles the majority of traffic volume: high-frequency game actions, IoT sensor readings, trivial API calls.

> **WARNING: L1 scope_narrowing gap:** An L1-conformant gateway evaluates
> only steps 1-3 of the grant evaluation algorithm (actor match, expiry check,
> revocation check). `scope_narrowing` constraints are step 4 and are NOT
> enforced at L1. Operators who deploy against an L1 gateway and rely on
> `scope_narrowing` for access control will find those constraints silently
> ignored. Use L2 or higher for any deployment that requires capability scope
> enforcement.

---

### L2: Grant Enforcement

**Full authorization. Still the fast path for unsigned receipts.**

Everything in L1, plus:

- Full grant evaluation (all 7 steps including scope_narrowing, preconditions, limits).
- `scope_narrowing` is evaluated against invocation args.
- Rate limit counters are maintained per grant.
- `GET /v1/gap/declarations`, `GET /v1/gap/grants` endpoints are implemented and queryable.
- Grant predicate updates (`POST /v1/gap/grants/:oid/update`) are supported.

**What a receipt proves at L2:** That the invocation passed all seven grant evaluation steps at the time of issuance. Scope, preconditions, rate limits, and expiry were all checked. The OID still provides content-integrity only.

**Infrastructure profile:** Stateless but requires a grant index (DynamoDB or equivalent) for fast lookup. Rate limit counters need atomic increment (DynamoDB conditional writes). Still Lambda-compatible. Slightly higher memory than L1 (256MB recommended) for predicate evaluation.

**Routing signal:** Invocations where `require_signed_receipt` is absent or `false` on the matched capability stop here. Receipt is written unsigned and returned immediately.

---

### L2+: Ed25519 Signing

**Signing path. Handles `require_signed_receipt: true` for standard deployments.**

This is not a separate conformance tier; it is an L2 server with signing enabled. It is split into a separate service in hosted deployments because signing has a different infrastructure profile than grant evaluation.

- Ed25519 signature over the canonical receipt body is attached to the `gap:decision_receipt`.
- The signing key is managed server-side (KMS or equivalent). Never exposed to clients.
- `GET /v1/gap/keys/current` returns the public key for independent verification.
- `GET /v1/gap/keys/:key_id` returns historical public keys (key rotation support).

**What a receipt proves at L2+:** That SynOI's gateway (or the operator's self-hosted gateway) issued this specific receipt with this specific content. Any party holding the public key can verify independently without contacting the gateway.

**Infrastructure profile:** Stateless but benefits from a warm instance to avoid cold-start latency on the signing operation. One provisioned-concurrency Lambda instance covers most deployments. Ed25519 signing is fast (~50k ops/sec per core); the overhead is the warm-start, not the crypto.

**Routing signal:** Invocations where `require_signed_receipt: true` on the capability declaration, and the grant does not override it to `false`, route here after L2 grant evaluation completes.

---

### L3: HITL Workflows

**Workflow path. Stateful. Long-lived.**

Everything in L2, plus:

- Workflow definitions, instances, and stage transitions are supported.
- At least one channel adapter is implemented (SMS recommended as the baseline).
- `POST /v1/gap/workflows/signal` is implemented for channel responses.
- Invocations that match a `capability_invocation` workflow trigger return `pending_workflow` and start an instance automatically.
- L2 revocation (`POST /v1/gap/revoke/l2/initiate`) is supported.

**What a receipt proves at L3:** The full approval chain. The initial `pending` receipt links to the workflow instance. The terminal receipt links back to the `pending` receipt and includes `hitl_approved` or `hitl_denied` in `compliance_tags`. An auditor can reconstruct the complete timeline: invoke → workflow started → human approved at timestamp T → action executed.

**Infrastructure profile:** Stateful. Workflow instances can run for minutes to hours waiting for human responses. Cannot be a short-timeout Lambda (15-minute max). Suitable for AWS Step Functions (native state machine + wait-for-task-token) or a persistent Fargate container. Much lower invocation volume than L1/L2; triggered only when a workflow definition matches an invocation.

**Routing signal:** Invocations where a `capability_invocation` workflow trigger matches the capability pattern route here regardless of `require_signed_receipt`. The workflow path issues a `pending` receipt immediately, then the terminal receipt (signed or unsigned per the capability's flag) when the workflow resolves.

---

### L4: Post-Quantum + Authorized Axis

**PQ signing path. Enterprise and regulated industries.**

Everything in L3, plus:

- Signatures use hybrid Ed25519 + ML-DSA-65 (both must verify, fail-closed).
- All receipts include the `authorized_axis` field classifying each decision as `AUTHORIZED` (matches a prior signed receipt) or `ORPHANED` (no prior signed receipt found).
- `gap:revocation_event` CDROs are signed and anchored in a hash-chained transparency log.
- L3 revocation and provisional block are supported.

**Federation (gap:federation_handshake): Reserved for GAP 1.1.** L4 conformance in GAP 1.0 does not require federation support. The `gap:federation_handshake` object type is registered in the type registry for forward compatibility but has no defined schema, endpoints, or state machine in this version. Implementations MUST NOT claim federation as part of their L4 conformance statement for GAP 1.0.

**Actor-token binding (MUST).** The gateway MUST bind each Bearer token to a specific actor OID at token issuance time. An invocation MUST be rejected if `caller.actor_oid` does not match the actor OID bound to the presented Bearer token. Tenant-level authentication without per-actor token binding makes the `caller.actor_oid` check ineffective for multi-actor tenants.

**What a receipt proves at L4:** Everything L2+ proves, plus quantum-resistance (ML-DSA-65 survives a quantum computer) and the authorized axis classification. `AUTHORIZED` means this action has a chain of signed receipts back to an initial operator authorization. `ORPHANED` means the action has no such chain; an anomaly signal even if the grant check passed.

**Infrastructure profile:** ML-DSA-65 signing is 5-10x more expensive than Ed25519. Provisioned concurrency is required to avoid cold-start latency. Higher memory (512MB+ recommended). This path handles a small fraction of total volume (enterprise and regulated-industry tenants only) but justifies dedicated compute. The authorized axis lookup requires an additional DynamoDB read per receipt to find the most recent prior signed receipt for the same actor+capability pair.

**Routing signal:** Tenants configured at L4 in the license record route here. The dispatcher checks the tenant's license tier before reading `require_signed_receipt`; an L4 tenant always gets PQ signing regardless of what the capability declaration says.

**L1 gateway scope enforcement gap (normative).** An L1 gateway MUST deny any invocation where the matching grant's `capability_scopes` contain non-empty `scope_narrowing` constraints. L1 gateways do not implement scope evaluation. Operators SHOULD include a `min_gateway_tier` annotation in capability declarations to signal the minimum tier required; gateway implementations SHOULD reject grant issuance for capabilities where `min_gateway_tier` exceeds the gateway's own tier. (`min_gateway_tier` is a convention annotation, not a required schema field in GAP 1.0; document it as a SHOULD, not a MUST schema field.)

---

## 12. Offline Operation

GAP supports three deployment profiles for environments without continuous gateway connectivity.

### 12.1 Offline Execution Profile (OEP)

Fetch an OEP bundle before going offline:

```
GET /v1/gap/offline-bundle?grant_oid=<oid>
Authorization: Bearer <token>
```

The bundle is a self-contained CDRO containing the grant, declaration, signing key bundle, revocation snapshot, and offline policy. Store it securely on the device. Use it to evaluate grants locally and issue provisional receipts.

On reconnection:
```
POST /v1/gap/offline-receipts
Content-Type: application/json

{ "receipts": [ ...provisionalReceiptCDROs ] }
```

### 12.2 Offline Key Verification

Fetch and cache the key bundle before deployment:

```
GET /v1/gap/keys/bundle
```

Store the bundle locally. On receipt verification, look up `signature_key_id` in the local bundle. If not found, treat the receipt as UNVERIFIABLE (not invalid) until a fresh bundle is obtained.

### 12.3 Revocation Bundle

Fetch a revocation snapshot periodically:

```
GET /v1/gap/revocations/bundle?since_ms=<last_snapshot_at_ms>
```

For `physical_safety: true` capabilities, devices MUST deny invocations if the revocation bundle is older than `max_revocation_bundle_age_ms` on the grant (default: 24 hours).

### 12.4 Sovereign Mode (fully air-gapped)

For classified or fully isolated deployments:
1. Generate a local root keypair (ML-DSA-65 for CNSA 2.0 compliance)
2. Run a locally-operated gateway instance (the open-source engine has zero SynOI server dependencies)
3. Distribute the root public key at device provisioning time (USB, QR code, or manufacturing-time injection)
4. All receipts, bundles, and OEP bundles are signed by the local root key
5. No external connectivity required at any point in the lifecycle

---

## 13. Minimal L1 Walkthrough

This is the minimum sequence to get from zero to a working L1 server. Each step shows the request, the expected response, and what your server must store.

### Step 1: Actor computes its OID and publishes a declaration

Before sending the declaration, the actor computes its own OID. The OID is deterministic; it is the SHA-256 of the canonical payload the actor is about to POST.

```typescript
// Client-side (TypeScript)
import { computeGapOid } from '@synoi/gap'

const body = {
  actor_type: 'skill',
  actor_id: 'skill:demo',
  actor_name: 'Demo Skill',
  actor_version: '1.0.0',
  capabilities: [{ capability: 'demo.action', safety_class: 'A' }],
}
const provisional = {
  type: 'gap:capability_declaration',
  tenant_id: 'my-tenant',
  created_at_ms: Date.now(),
  created_by: 'actor:skill:demo',  // stable seed for first declaration
  body,
}
const actorOid = computeGapOid(provisional)
const payload = { ...provisional, created_by: actorOid }
// POST payload to /v1/gap/declarations
```

```
POST /v1/gap/declarations
{
  "created_by": "sha256:<self-computed-actor-oid>",
  "body": {
    "actor_type": "skill",
    "actor_id": "skill:demo",
    "actor_name": "Demo Skill",
    "actor_version": "1.0.0",
    "capabilities": [
      { "capability": "demo.action", "safety_class": "A" }
    ]
  }
}
```

Your server:
1. Builds the payload: `{ type, tenant_id, created_at_ms, created_by, body }`
2. Computes OID: `sha256(canonical(payload))`
3. Stores the full CDRO.
4. Returns 201 with the CDRO.

The OID in the 201 response is the actor's identity OID for all subsequent operations (grants, invocations).

### Step 2: Operator issues a grant

```
POST /v1/gap/grants
{
  "created_by": "sha256:operator-oid",
  "body": {
    "grantee": {
      "actor_type": "skill",
      "actor_oid": "<declaration-oid-from-step-1>"
    },
    "capability_scopes": [
      { "capability": "demo.action" }
    ],
    "granted_at_ms": 1750000000000,
    "expires_at_ms": null,
    "granted_by": "sha256:operator-oid"
  }
}
```

Store the grant CDRO. Index it by `grantee.actor_oid` + capability for fast lookup.

### Step 3: Actor invokes the capability

```
POST /v1/gap/invocations
{
  "caller": {
    "actor_type": "skill",
    "actor_oid": "<declaration-oid-from-step-1>",
    "grant_oid": "<grant-oid-from-step-2>"
  },
  "capability": "demo.action",
  "args": { "param": "value" }
}
```

Your server:
1. Finds the grant (by `grantee.actor_oid` + `capability`).
2. Checks it is not expired and not revoked.
3. Builds and stores a `gap:capability_invocation` CDRO.
4. Executes the action (or returns `ok` immediately if L1).
5. Builds and stores a `gap:decision_receipt` CDRO.
6. Returns 200 with `{ status: "ok", receipt_oid: "sha256:...", receipt: {...} }`.

### Step 4: Verify the receipt

```
GET /v1/gap/receipts/<receipt-oid>
```

Any party who has the receipt OID can:
1. Fetch the receipt from your server.
2. Verify the OID by recomputing `sha256(canonical(envelope-minus-oid-and-signature))`.
3. Verify the signature against your server's published public key.

If OID verification passes, the receipt is authentic regardless of who provided it.

---

## Implementation Notes

**Storage.** CDROs are immutable once stored. A simple key-value store (OID → CDRO JSON) is sufficient for L1. L2+ need indexes: grants by grantee OID, invocations by tenant and workflow, receipts by subject OID.

**Clock.** `created_at_ms` values must be monotonically increasing within a tenant. A server SHOULD reject objects with timestamps more than 5 minutes in the future to prevent replay attacks.

**Tenant isolation.** Every query MUST filter by `tenant_id`. An actor with a valid Bearer token for tenant A MUST NOT be able to read or write tenant B's objects.

**Idempotency.** If an invocation includes an `idempotency_key` and a prior invocation with the same key exists for this tenant, return the original receipt without re-executing. Store a `(tenant_id, idempotency_key)` index.

**OID stability.** Never recompute an OID after storing a CDRO. Store it as returned. The OID IS the address. Any change to the body would produce a different OID and break all references.

---

## Appendix A: Wiring an Execution Backend (Channel Adapter)

GAP separates authorization (who is allowed, under what conditions) from execution (how the action is carried out). The `ChannelAdapter` interface is the seam between them. Every authorized invocation passes through the gateway's grant evaluation and receipt issuance before the adapter is called. Adapters handle delivery only.

### The ChannelAdapter interface

```typescript
// From @synoi/gap
export interface ChannelAdapter {
  kind: ChannelKind
  supports: {
    actions: string[]
    listens: Array<'intent' | 'pattern' | 'event_kind'>
  }
  performAction(spec: StageAction, context: AdapterContext): Promise<ActionResult>
  armListen(spec: StageListen, context: AdapterContext,
            onMatch: (event: ChannelEvent) => void): ListenHandle
  health(): Promise<{ ok: boolean; detail?: string }>
}
```

`performAction` is called ONLY after the gateway has:
1. Found a valid, non-expired, non-revoked grant matching the invocation.
2. Evaluated all `scope_narrowing` predicates against the invocation args.
3. Computed and signed the `gap:decision_receipt` with `status: "ok"`.

If any of those steps fail, the adapter is never reached. Authorization is complete before execution begins.

### Worked example: tool-integration backend (Composio)

The following adapter maps GAP capability invocations to Composio's `executeAction` API, giving agents access to 250+ pre-built integrations (GitHub, Slack, Jira, Terraform, etc.). The adapter knows nothing about grants or receipts; it receives a pre-authorized action spec and executes it.

```typescript
// src/channels/tool-integration.ts
import { ComposioToolSet } from 'composio-core'
import type {
  ActionResult, AdapterContext, ChannelAdapter,
  ChannelEvent, ListenHandle, StageAction, StageListen,
} from '@synoi/gap'

// Map GAP capability names to Composio action IDs.
// Extend this table as you wire up more integrations.
const CAPABILITY_ACTION_MAP: Record<string, string> = {
  'git.pr.merge':          'GITHUB_MERGE_PULL_REQUEST',
  'git.pr.create':         'GITHUB_CREATE_A_PULL_REQUEST',
  'git.issue.create':      'GITHUB_CREATE_AN_ISSUE',
  'messaging.slack.send':  'SLACK_SENDS_A_MESSAGE',
  'messaging.slack.react': 'SLACK_ADD_REACTION_TO_MESSAGE',
  'calendar.event.create': 'GOOGLECALENDAR_CREATE_EVENT',
  'file.upload':           'GDRIVE_UPLOAD_FILE',
}

export class ToolIntegrationAdapter implements ChannelAdapter {
  kind = 'webhook' as const  // reuses the open webhook kind slot

  supports = {
    actions: Object.keys(CAPABILITY_ACTION_MAP),
    listens: [] as Array<'intent' | 'pattern' | 'event_kind'>,
  }

  private toolset: ComposioToolSet

  constructor(apiKey: string) {
    // The API key is server-side only. It MUST NOT appear in receipts,
    // logs, or agent prompts.
    this.toolset = new ComposioToolSet({ apiKey })
  }

  async performAction(spec: StageAction, ctx: AdapterContext): Promise<ActionResult> {
    const composioAction = CAPABILITY_ACTION_MAP[spec.method]
    if (!composioAction) {
      return { ok: false, detail: `no mapping for capability: ${spec.method}` }
    }

    // Map GAP tenant to a Composio entity. The entity owns the connected
    // OAuth accounts for that tenant (GitHub, Slack, etc.). A tenant's
    // operator pre-connects those accounts in their Composio dashboard --
    // or via the /connect flow if using the bring-your-own-accounts mode.
    const entityId = ctx.tenant_id  // or look up a custom mapping table

    try {
      const result = await this.toolset.executeAction({
        action: composioAction,
        params: spec.params,
        entityId,
      })
      const ok = result?.successfull !== false
      return {
        ok,
        detail: ok ? undefined : JSON.stringify(result?.error ?? 'execution failed'),
      }
    } catch (err) {
      return { ok: false, detail: String(err) }
    }
  }

  // This adapter is action-only. Listen is not needed for outbound tool calls.
  armListen(_spec: StageListen, _ctx: AdapterContext,
            _onMatch: (event: ChannelEvent) => void): ListenHandle {
    throw new Error('ToolIntegrationAdapter does not support listen')
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // A lightweight check -- verify the API key is accepted.
      await this.toolset.getEntity('health-check')
      return { ok: true }
    } catch {
      return { ok: false, detail: 'Composio API unreachable or key invalid' }
    }
  }
}
```

Register the adapter in your gateway startup:

```typescript
import { ToolIntegrationAdapter } from './channels/tool-integration.js'

registry.register(new ToolIntegrationAdapter(process.env.TOOL_INTEGRATION_API_KEY!))
```

### Capability-to-action mapping

The table in `CAPABILITY_ACTION_MAP` is the integration layer. To add a new integration:
1. Find the Composio action ID in [their docs](https://docs.composio.dev/introduction/foundations/components/actions/action-guide).
2. Map it to a GAP capability name that matches your capability taxonomy.
3. Add the row to the map.

The gateway's authorization rules (grant scope, scope_narrowing predicates) govern which agents can invoke which capabilities. The adapter is called only for authorized invocations.

### Bring-your-own-accounts

For multi-tenant deployments where each tenant connects their own service accounts:

1. Tenant onboarding: direct the tenant to a `/connect` flow (Composio's OAuth initiation endpoint).
2. Composio issues the tenant a `entityId` tied to their connected accounts.
3. Store the mapping `tenant_id → entityId` in your gateway config.
4. The adapter reads this mapping at execution time instead of using `ctx.tenant_id` directly.

This keeps SynOI out of the credential path entirely. The operator's service accounts belong to the operator; the gateway holds only the mapping.

---

## Appendix B: Minimum Conformance Tier by Deployment Sector

| Deployment sector | Minimum tier | Notes |
|---|---|---|
| Consumer gaming, creative tools | L2 | scope_narrowing enforcement required; HITL optional |
| Enterprise workflow automation (SOC 2) | L2 | Receipt audit trail; L3 if HITL gates are used |
| Smart home / consumer IoT | L2 + offline revocation feed | Revocation feed required for constrained devices |
| Industrial automation / OT (IEC 62443) | L4 | Authorized axis (AUTHORIZED/ORPHANED) required for air-gap audit |
| Medical devices / clinical (21 CFR Part 11) | L4 | Signed receipts + authorized axis + Ed25519 required |
| Physical security / access control | L3 minimum, L4 recommended | HITL + leveled revocation required; authorized axis for audit |
| AI agent pipelines (MCP) | L2 | Delegation depth enforcement critical; L3 if any class C capability |
| Financial services | L3 | HITL for threshold amounts; aggregate limits (PC-24) required |

---

## Appendix C: Regulatory Coverage Summary

### 21 CFR Part 11 (FDA electronic records / signatures)

| Part 11 requirement | GAP coverage | Status |
|---|---|---|
| Audit trail with timestamp, operator ID, action | decision_receipt: initiated_at_ms, initiator.actor_oid, capability | Covered at L2+ |
| Tamper-evident records | Content-addressed OID (sha256) over canonical body | Covered |
| Electronic signature binding | Ed25519 signature on receipt (requires L4, gateway must be configured) | Partial; L4 only |
| Closed system access controls | Grant evaluation algorithm (expiry, revocation, scope_narrowing) | Covered at L2+ |
| Server-stamped timestamps | initiated_at_ms is server-stamped; client_claimed_at_ms is informational only | Covered |
| Sequential audit trail | transition_oids chain on WorkflowInstance; final_receipt_oid linkage | Covered at L3+ |
| PHI data minimization | NOT in current spec scope; operator must implement at adapter layer | Not covered |
| Export in human-readable format | NOT in current spec scope | Not covered |

### IEC 62443 (Industrial automation / OT security)

| IEC 62443 requirement | GAP coverage | Status |
|---|---|---|
| SR 1.1 Identification and authentication | Actor OID + tenant Bearer token | Covered at L1+ |
| SR 1.3 Authenticator management + two-person integrity | authorized_approvers on WorkflowStage; StageSafety.two_person | Partial; HTTP enforcement path for two-person requires L3 + authorized_approvers |
| SR 2.1 Authorization enforcement | Grant evaluation algorithm | Covered at L2+ |
| SR 2.8 Audit log events | decision_receipt for every gate decision | Covered at L2+ |
| SR 3.9 Protection of audit information | Tamper-evident OID + Ed25519 (L4) | Partial; Ed25519 requires L4 |
| SR 6.1 Audit log accessibility | GET /v1/gap/receipts + GET /v1/gap/revocations | Covered |
| Authorized axis (authorized-vs-orphaned) | L4 authorized_axis classification | L4 only |

### SOC 2 Type II (Trust Service Criteria)

| SOC 2 criterion | GAP coverage |
|---|---|
| CC6.1 Logical access controls | Grant + revocation lifecycle |
| CC6.3 Access removal | Leveled revocation (L1/L2/L3) + provisional block |
| CC7.2 Monitoring and anomaly detection | decision_receipt audit trail; capability= filter on GET /v1/gap/receipts |
| CC8.1 Change management | Workflow HITL gates for class B/C capabilities |
| A1.2 System availability | SLA hints on invocations; gateway-level rate limits |
