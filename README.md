# @synoi/gap

**GAP (Governed Action Protocol)** is the open wire protocol for a **Universal Action Coordination Fabric**, a single governed layer that connects AI agents, smart devices, industrial systems, games, medical devices, automation pipelines, and anything else that can declare what it does.

---

## The Universal Action Coordination Fabric

Today every environment that involves AI or automated action builds its own integration layer: the smart home hub has a proprietary device SDK, the industrial automation system has a proprietary command channel, the AI agent framework has its own tool-calling convention, the game engine has its own NPC action system. Each is siloed. None of them share an audit trail. None of them share a revocation mechanism. None of them speak to each other.

GAP is the fabric underneath all of them. Any actor (an AI agent, a smart lock, a game engine, a SCADA valve controller, an MCP tool server, a medical device) speaks the same four-phase lifecycle:

1. **Declare**: the actor publishes a `CapabilityDeclaration`: what it can do, under what safety class, with what scope.
2. **Grant**: an operator issues a `CapabilityGrant`: who is allowed to invoke it, under what conditions, with what limits and expiry.
3. **Invoke**: an actor calls the capability. The fabric evaluates the grant, enforces preconditions, and routes to a human-approval workflow if required.
4. **Receipt**: every gate decision (allow, deny, defer, timeout) produces a content-addressed `GapDecisionReceipt`. L2+ conformant gateways sign receipts (Ed25519) and L4 gateways add a hybrid ML-DSA-65 signature. This package provides the receipt type definitions and OID computation; signature enforcement is a gateway implementation responsibility (see IMPLEMENTING.md).

The same grant that lets a game engine dim your lights also governs an industrial AI requesting a valve close. The same revocation call that removes a contractor's building access simultaneously revokes their AI agent's tool access. A conformant gateway's receipt log is structurally suitable as audit evidence in SOC 2, HIPAA, and similar review contexts. What you get from this package alone are the wire types and OID helpers; the guarantee requires a compliant gateway implementation.

The capability names, safety classes, and channel adapters change per environment. The protocol does not.

For concrete scenarios across gaming, industrial automation, healthcare, AI agent pipelines, smart home, physical security, and cross-environment coordination, see [USE_CASES.md](USE_CASES.md).

All four record types are **CDROs**: Content-addressed, Deterministic, Replayable Objects. Each CDRO has a content-addressed OID (`sha256:<hex>`) computed over its canonical JSON body. Any party can independently verify an OID.

---

## Object model

Every top-level record is a `GapCdroEnvelope<TBody>`:

```typescript
interface GapCdroEnvelope<TBody> {
  oid: string            // "sha256:<hex>" -- content-addressed
  type: GapObjectType    // e.g. "gap:capability_grant"
  gap_version: '1.0'
  tenant_id: string
  created_at_ms: number
  created_by: string     // actor OID
  body: TBody            // type-specific payload
  signature?: string     // optional Ed25519, base64
  signature_key_id?: string
  supersedes?: string    // OID of replaced CDRO
}
```

Object types and their body shapes:

| `type`                        | Body type                   |
|-------------------------------|-----------------------------|
| `gap:capability_declaration`  | `CapabilityDeclarationBody` |
| `gap:capability_grant`        | `CapabilityGrantBody`       |
| `gap:capability_invocation`   | `CapabilityInvocationBody`  |
| `gap:workflow_definition`     | `WorkflowDefinitionBody`    |
| `gap:workflow_instance`       | `WorkflowInstanceBody`      |
| `gap:stage_transition`        | `StageTransitionBody`       |
| `gap:channel_event`           | `ChannelEventBody`          |
| `gap:decision_receipt`        | `GapDecisionReceiptBody`    |
| `gap:revocation_event`        | `RevocationEventBody`       |
| `gap:federation_handshake`    | (reserved for GAP 1.1)      |

---

## Conformance tiers

GAP implementations declare a conformance tier:

| Tier | Requirements |
|------|-------------|
| **L1** | Validate CDRO envelopes. Compute and verify content-addressed OIDs. |
| **L2** | L1 + evaluate capability grants (expiry, scope, preconditions). Produce decision receipts for every gate decision. |
| **L3** | L2 + orchestrate multi-stage HITL workflows via channel adapters (SMS, push, overlay, webhook). |
| **L4** | L3 + leveled revocation (L1/L2/L3), hybrid ML-DSA-65 post-quantum signing, authorized-axis classification (AUTHORIZED/ORPHANED). (Federation reserved for 1.1: `gap:federation_handshake` is not required for L4 conformance in GAP 1.0.) |

---

## Installation

```bash
npm install @synoi/gap
```

Node >= 18 required (uses `TextEncoder` and `@noble/hashes`).

---

## Your first receipt in under 60 seconds

`receipt()` is the free, self-host entry point: one import, one call, a self-signed
`gap:decision_receipt` with your own Ed25519 key. No account, no config file, and
**no network call** -- everything happens locally in the process.

```typescript
import { receipt } from '@synoi/gap'

const r = receipt({
  subjectKind: 'capability_invocation',
  subjectOid: 'sha256:...',            // the action this receipt decides on
  initiator: { actor_oid: 'actor:me', actor_type: 'human_user' },
})

console.log(r.envelope.oid)        // sha256:<hex> -- content-addressed
console.log(r.envelope.signature)  // base64url Ed25519 signature, your key
console.log(r.verifyUrl)           // https://oid.synoi.systems/r/sha256:... (PENDING, see below)
```

If you don't pass a `keyPair`, `receipt()` generates one locally on first call via
`generateReceiptKeyPair()`. Reuse a keypair across calls (pass it back in via
`{ keyPair }`) so all of your receipts verify against the same
`signature_key_id`; verify any receipt locally with `verifyReceiptSignature()`.

**What "self-signed" honestly means here:** this receipt is signed with a key you
generated and hold. It proves the receipt came from whoever holds that key. It does
**not** yet prove anything to a third party who doesn't already trust your key out
of band -- that is the "second party must trust your receipt" wall described in the
project roadmap, and it is exactly what the neutral resolver and managed key custody
(below) are for.

### The `verify_url` field, honestly

By default, `receipt()` fills in a `verifyUrl` pointing at
`https://oid.synoi.systems/r/<oid>`. **This hostname does not resolve anything
today.** `receipt()` never calls it, never calls any network endpoint at all, and
the field is nothing more than a formatted string until the neutral resolver
(`oid.synoi.systems`) ships. Treat every `verifyUrl` as **PENDING** until then.

- To omit the field entirely: `receipt(input, { verifyUrlBase: null })`
- To point it at your own self-hosted resolver instead: `receipt(input, { verifyUrlBase: 'https://verify.mycompany.example' })`

### Vocabulary: self-signed vs. managed custody

"Self-signed with your own key" (what `receipt()` does) and "signed with SynOI-managed
KMS custody" are different trust models and are not interchangeable:

| | Self-signed (`receipt()`, this package) | Managed KMS custody (future, hosted) |
|---|---|---|
| Key holder | You | SynOI-operated KMS |
| Network calls | None | Yes (hosted signing + resolver) |
| Verifies against | Your own public key, out of band | The neutral resolver, `oid.synoi.systems` |
| Cost | Free, forever, self-host | Paid tier (managed custody + hosted resolver) |
| Status | **SHIPPED** (this package, `receipt()`) | **PENDING** |

---

## Usage

### Compute a content-addressed OID

```typescript
import { computeGapOid } from '@synoi/gap'

const payload = {
  type: 'gap:capability_declaration',
  tenant_id: 'my-tenant',
  created_at_ms: Date.now(),
  created_by: 'actor:my-skill',
  body: {
    actor_type: 'skill',
    actor_id: 'skill:my-skill',
    actor_name: 'My Skill',
    actor_version: '1.0.0',
    capabilities: [{ capability: 'my.action', safety_class: 'A' }],
  },
}

const oid = computeGapOid(payload)
// => "sha256:..."
```

### Build and validate a declaration envelope

```typescript
import {
  GAP_VERSION,
  computeGapOid,
  validateCapabilityDeclaration,
  type CapabilityDeclaration,
  type CapabilityDeclarationBody,
} from '@synoi/gap'

const body: CapabilityDeclarationBody = {
  actor_type: 'skill',
  actor_id: 'skill:my-skill',
  actor_name: 'My Skill',
  actor_version: '1.0.0',
  capabilities: [
    { capability: 'my.action', safety_class: 'B' },
  ],
}

const payload = {
  type: 'gap:capability_declaration' as const,
  tenant_id: 'my-tenant',
  created_at_ms: Date.now(),
  created_by: 'actor:operator',
  body,
}

const decl: CapabilityDeclaration = {
  ...payload,
  oid: computeGapOid(payload),
  gap_version: GAP_VERSION,
}

const result = validateCapabilityDeclaration(decl)
if (!result.ok) {
  console.error(result.errors)
}
```

### Check if an actor's result is a failure

```typescript
import { isGapFailure, type GapFailure } from '@synoi/gap'

function handleResult(r: MyResult | GapFailure) {
  if (isGapFailure(r)) {
    console.error('gate denied:', r.reason, r.detail)
    return
  }
  // r is MyResult
}
```

### Match capability patterns

```typescript
import { capabilityMatches } from '@synoi/gap'

capabilityMatches('skill.*', 'skill.create')   // true
capabilityMatches('skill.*', 'agent.create')   // false
capabilityMatches('*',       'anything')       // true
```

---

## Wire format stability

OIDs are computed over a **canonical JSON** form: keys sorted lexicographically, `undefined` values (absent keys in JavaScript) dropped from objects, `null` values kept as JSON `null`, arrays order-preserved. The `canonicalize` function is exported for implementors who need to reproduce OIDs outside this package.

The test vectors in `test/oid.test.ts` pin the canonical hashes against the gateway implementation. Any drift in canonical form will break those tests.

### Canonicalization constraints

Common implementation gotchas when reproducing OIDs in another language or runtime:

- **Integers only for numeric fields**: any number value in the hashed body must be an integer. Floats (e.g. `1.0` instead of `1`) are rejected and will produce a different OID.
- **UTF-8 byte sequences for strings**: string values must be serialized as raw UTF-8 bytes. Unicode escape sequences (`\uXXXX`) in the JSON encoding produce a different hash.
- **Keys sorted lexicographically at every nesting level**: this applies recursively to nested objects, not just the top-level envelope fields.
- **`null` is kept; absent keys are dropped**: serialize `null` values as JSON `null`. Keys with `undefined` values (or absent keys) must be omitted entirely, not written as `null`.
- **Five fields are stripped before hashing**: `oid`, `gap_version`, `signature`, `signature_key_id`, and `supersedes` are excluded from the canonical body. Do not include them when computing the OID.

For the full normative specification of the canonicalization algorithm, see [IMPLEMENTING.md](https://github.com/synoi/synoi-gap/blob/main/IMPLEMENTING.md).

---

## Documentation

| Document | What it covers |
|---|---|
| [IMPLEMENTING.md](https://github.com/synoi/synoi-gap/blob/main/IMPLEMENTING.md) | How to build a GAP-conformant server from scratch in any language: wire format, OID computation, HTTP surface, grant evaluation, receipts, conformance tiers, and wiring execution backends via channel adapters (RFC 2119 conventions) |
| [USE_CASES.md](https://github.com/synoi/synoi-gap/blob/main/USE_CASES.md) | Concrete scenarios across gaming, industrial automation, healthcare, AI agent pipelines, smart home, physical security, and cross-environment coordination |
| [openapi.yaml](https://github.com/synoi/synoi-gap/blob/main/openapi.yaml) | OpenAPI 3.1.0 specification for the full GAP HTTP surface (25+ endpoints, all schemas) |
| [ERROR_CODES.md](https://github.com/synoi/synoi-gap/blob/main/ERROR_CODES.md) | Machine-readable error code registry with conformance tier annotations |
| [CAPABILITY_TAXONOMY.md](https://github.com/synoi/synoi-gap/blob/main/CAPABILITY_TAXONOMY.md) | Canonical dotted-taxonomy capability names across 9 domains (home, industrial, medical, physical, financial, MCP, game, gap, messaging) |
| [OPTIONAL_CAPABILITIES_SPEC.md](https://github.com/synoi/synoi-gap/blob/main/OPTIONAL_CAPABILITIES_SPEC.md) | Normative spec for optional ambient effects: evaluation algorithm, security constraints, conformance |
| [THREAT_MODEL.md](https://github.com/synoi/synoi-gap/blob/main/THREAT_MODEL.md) | STRIDE threat model: 12 protocol components, ranked attack surface, mitigations index |
| [CONTRIBUTING.md](https://github.com/synoi/synoi-gap/blob/main/CONTRIBUTING.md) | How to contribute: dev setup, spec change process, capability taxonomy additions, security reporting |
| [profiles/](https://github.com/synoi/synoi-gap/tree/main/profiles) | Companion profiles extending GAP for specific sectors: gaming (`game.*`), healthcare (`hc.*`), supply chain/DevOps (`ci.*`), financial services (`fin.*`), AI/ML platforms (`ai.*`), legal (`legal.*`), consumer/household (`consumer.*`). Authoring guide and blank template included. |
| [python/](https://github.com/synoi/synoi-gap/tree/main/python) | Python SDK: `compute_gap_oid`, validators, `GapClient` async HTTP wrapper |
| [rust/](https://github.com/synoi/synoi-gap/tree/main/rust) | Rust reference SDK (`gap-core`): canonicalize, OID, Ed25519 + hybrid ML-DSA-65 verify, receipt v1 canonical projection. Validated against this repo's conformance vectors. |
| [go/](https://github.com/synoi/synoi-gap/tree/main/go) | Go reference SDK (`gapcore`, module `github.com/synoi/synoi-gap/go`): canonicalize, OID, Ed25519 sign/verify, DSSE attestation. Ed25519 leg only for hybrid signatures (ML-DSA-65 pending); validated against this repo's conformance vectors. |
| [synoi-gard](https://github.com/synoi/synoi-gard) | Lightweight local single-tenant GAP runtime: SQLite grant and receipt stores, channel adapters (Hue, WLED, Home Assistant), desktop HITL toast. No account required. Graduates to the SynOI hosted gateway for multi-house or federation use. |

---

## License

Code (`src/`, `dist/`, `python/`, `rust/`, `go/`, test files): Apache-2.0. See [LICENSE](https://github.com/synoi/synoi-gap/blob/main/LICENSE).

Protocol specification (`IMPLEMENTING.md`, `openapi.yaml`, `ERROR_CODES.md`, `CAPABILITY_TAXONOMY.md`, `OPTIONAL_CAPABILITIES_SPEC.md`): CC0 1.0 Universal (public domain dedication). Any implementation may speak the GAP wire format without restriction, attribution, or royalty. See [LICENSE-CC0.md](https://github.com/synoi/synoi-gap/blob/main/LICENSE-CC0.md).
