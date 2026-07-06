# GAP - Governed Action Protocol Specification

**Version:** 1.1
**Status:** Stable
**Last updated:** 2026-07-05
**License:** CC0 1.0 Universal - see section 11.
**Layer:** L3 of the SRAID Stack.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [SRAID Objects Used by GAP](#2-sraid-objects-used-by-gap)
3. [Capabilities](#3-capabilities)
4. [Workflows](#4-workflows)
5. [Channel Adapters](#5-channel-adapters)
6. [Revocation](#6-revocation)
7. [Cross-Trust-Boundary Federation](#7-cross-trust-boundary-federation)
8. [Decision Receipts](#8-decision-receipts)
9. [Worked Examples](#9-worked-examples)
10. [Conformance](#10-conformance)
11. [License + References](#11-license--references)

---

## 1. Introduction

### 1.1 What GAP is

GAP is the protocol that governs **every action taken on or about signed objects**:

- Whether an actor is authorized to invoke a capability
- Whether a request needs human approval before proceeding
- How multi-stage workflows orchestrate that approval across voice, SMS, mobile, in-app, smart-home, and game-engine channels
- How decisions are recorded, signed, and revoked

GAP is **one protocol with two interaction shapes**:

- **Capability shape** - a request to do something specific now, for example "invoke camera.read on device X".
- **Workflow shape** - a multi-stage state-machine choreography, for example "on critical physical action: pulse lights, ask by voice, wait for response, escalate to SMS, resolve".

Both shapes are first-class. A capability invocation can spawn a workflow when escalation is needed. A workflow stage can invoke a capability. They share the same SRAID object types, the same revocation semantics, the same channel adapters, and the same Decision Receipt schema.

### 1.2 What problems GAP solves

| Problem | How GAP addresses it |
|---|---|
| "Did I authorize this action?" | Capability grants + signed invocation receipts |
| "How was this action approved?" | Workflow trace + stage transitions, all signed |
| "Can I revoke this access?" | L1/L2/L3 revocation with explicit semantics + propagation rules |
| "What did the system tell the human?" | Channel adapter receipts capture every prompt + response |
| "Can two tenants share a capability safely?" | Cross-trust federation with an explicit handshake |
| "Can this be audited end to end?" | Every state transition is a Decision Receipt CDRO |

### 1.3 Position in the SRAID Stack

```
L4  Apps                                  -- Vault Browser, Identity, Quest, etc.
L3  GAP                  <-- this spec    -- Governed Action Protocol
L2  Inference Broker + Resonance          -- ML dispatch + similarity retrieval
L1  Vault + OID Resolver                  -- Storage + lookup
L0  SRAID                                 -- Signed, Resolvable, Auditable
                                             Identity for Data (the object format)
```

GAP **uses** SRAID (L0) for every signed object it produces (declarations, grants, workflows, receipts). GAP **uses** Vault (L1) for persistence and the OID Resolver (L1) for cross-deployment lookup. GAP **may** call the Inference Broker (L2) when a workflow stage requires ML, for example classification of the requested action. GAP **does not** require Resonance (L2) for its own operation, though apps consuming GAP often query Resonance for "find similar past workflows" patterns.

Acronyms used throughout: **CDRO** = Canonical Data-Referenced Object (a signed SRAID object); **OID** = Object IDentifier (the content address of a CDRO); **SRO** = Signed Receipt Object (a Decision Receipt CDRO); **DSSE** = Dead Simple Signing Envelope (the envelope format used for v2 receipt signatures).

### 1.4 Conformance requirements (overview)

A conformant GAP implementation MUST:

1. Parse and validate every object type defined in section 2 against the schema vectors in section 10.1.
2. Compute CDRO OIDs and canonicalization exactly as defined by the ONE normative projection referenced in section 2.2 (`@synoi/sraid` `PROJECTION_SPEC.md`). An implementation that produces a byte string different from the reference for the same input is non-conformant.
3. Implement the capability lifecycle in section 3 - declare, grant, invoke, revoke.
4. Implement the workflow state machine in section 4 - definition, instance, stage transitions, listen/action semantics.
5. Provide at least one channel adapter implementation conforming to section 5.
6. Enforce L1 revocation (section 6) immediately upon a revocation event.
7. Emit Decision Receipts per section 8 for every state transition, carrying the `receipt_scheme` discriminator and failing CLOSED on an unknown or missing scheme.

A conformant GAP implementation SHOULD:

- Support cross-trust federation (section 7) when deployed in a multi-tenant or multi-organization context.
- Support L2 and L3 revocation (section 6) when used for safety-critical decisions.
- Implement at least three of the standard channel adapters in section 5.2.

---

## 2. SRAID Objects Used by GAP

GAP defines no new wire format. Every GAP object is a SRAID CDRO with a specific `type` field. The OID format, canonical hashing, and signature scheme are inherited from SRAID (L0).

### 2.1 Object types

Every `type` uses the `gap:` prefix (the signed namespace).

| Type | Purpose | Lifetime |
|---|---|---|
| `gap:capability_declaration` | Declares an actor's capabilities + their scopes | Long-lived; superseded when the actor publishes a new version |
| `gap:capability_grant` | Authorizes a caller to invoke specific capabilities | Long-lived; explicitly revoked or expires |
| `gap:capability_invocation` | A single act of calling a capability | Short-lived (one event); never superseded |
| `gap:workflow_definition` | Operator-authored state machine template | Long-lived; new version = new OID |
| `gap:workflow_instance` | One execution of a definition | Long-lived during execution; immutable after termination |
| `gap:stage_transition` | A single workflow stage moving forward | Short-lived; never superseded |
| `gap:channel_event` | A prompt or response observed on a channel | Short-lived |
| `gap:decision_receipt` | The audit record for any GAP-governed action | Short-lived (one event); persists per retention policy |
| `gap:revocation_event` | A capability/grant/workflow/skill being revoked | Long-lived |
| `gap:federation_handshake` | Cross-tenant trust establishment | Long-lived until either party revokes |

### 2.2 Common envelope and the ONE normative projection

Every GAP CDRO carries this top-level shape:

```typescript
interface GapCdroEnvelope<T> {
  oid: string                    // "sha256:..." computed per PROJECTION_SPEC.md
  type: GapObjectType            // one of the types above
  gap_version: "1.0"             // signed byte; a downgrade is OID-detectable
  tenant_id: string              // owning tenant
  created_at_ms: number
  created_by: string             // actor OID
  body: T                        // type-specific payload
  supersedes?: string            // prior OID (long-lived types only)

  // Detached-signature / envelope fields, attached AFTER the OID is computed
  // and therefore NOT part of the content core (see below):
  signature?: SraidSignatureEnvelope       // legacy hybrid Ed25519 + ML-DSA-65
  ml_dsa_signature?: string                // detached ML-DSA-65 signature
  signature_key_id?: string
  signature_algorithm?: string
  attestation?: DsseAttestationEnvelope    // v2 DSSE envelope
}
```

The OID is computed as:

```
OID = "sha256:" + lowercase_hex( SHA-256( canonicalize( cdroContentCore(object) ) ) )
```

There is exactly ONE normative definition of `cdroContentCore`, `canonicalize`, and the number rule. It is `@synoi/sraid` `PROJECTION_SPEC.md`, and it is the single source every implementation MUST derive from. A separate summary here is informative only; on any conflict, `PROJECTION_SPEC.md` governs. In brief:

- **Content core.** `cdroContentCore(object)` removes EXACTLY six top-level fields before hashing: `oid`, `signature`, `ml_dsa_signature`, `signature_key_id`, `signature_algorithm`, `attestation`. Everything else is KEPT and hashed into identity, INCLUDING `gap_version` and `supersedes`. The strip-set is defined semantically ("every field the signer produces after canonicalization, plus the OID output itself"), never as a hand-listed enumeration per surface. `gap_version` is in identity so a protocol downgrade is OID-detectable. `supersedes` is in identity because the SRAID lineage edge must be tamper-evident (superseding mints a new object; it never mutates the old object's bytes).
- **Pre- versus post-attestation invariance.** Because the six detached fields are stripped, `cdroOid(object)` yields the SAME OID whether the object is pre-attestation (no signature fields) or post-attestation (signature fields attached). A third party who recomputes the OID of a signed receipt gets the byte-identical value the signer stamped. This invariance is the property the "portable, independently verifiable receipt" thesis depends on.
- **Number rule: finite integers only.** A JSON number is legal iff it is a finite integer. `NaN`, `+Infinity`, `-Infinity`, and any non-integer (for example `1.5`, `0.1`, `9.99`) are rejected with a typed error BEFORE hashing. All money MUST be expressed as integer minor units; all timestamps as integer milliseconds. A fractional quantity MUST be carried as an integer in declared minor units with a declared scale and unit (for example milli-degrees, fixed-point coordinates, basis-point ratios), quantized before signing. This removes the hardest RFC 8785 cross-language serialization trap from a signed byte string.
- **Canonicalization.** `canonicalize` is a strict subset of RFC 8785 (JCS): object keys sorted in ascending UTF-16 code-unit order, minimal JSON string escaping, no whitespace, `null`/`true`/`false` as literals, array order preserved. SRAID is RFC 8785 conformant on ordering and string escaping and intentionally stricter on numbers (see the number rule).

Signatures are computed over the same canonical bytes and attach AFTER hashing, so signing or rotating a signature never changes the OID.

Two adjacent identity contracts look similar and MUST NOT be merged into this projection (see `PROJECTION_SPEC.md` section 4 for the normative firewall): the legacy v1 flat-scalar receipt signing shape (section 8.2 below), and the Vault L1 binary-TLV canonical hash (a different-layer, deliberately frozen identity contract).

### 2.3 Object lifecycle

- **Creation.** The actor produces the body, computes the OID per the projection above, signs, and publishes.
- **Lookup.** Any party with the OID can resolve its location via the OID Resolver, fetch the object, and verify signatures.
- **Supersession.** Long-lived types create a new CDRO with `supersedes: oldOid`; the prior version stays retrievable but the Resolver routes to the new head.
- **Revocation.** A `gap:revocation_event` references the target OID. The Resolver reports it as revoked. The CDRO itself stays immutable; consumers MUST check revocation status before honoring it.
- **Persistence tier.** Definitions, grants, and workflow instances persist to the durable tier. Invocations, transitions, and channel events may use a faster tier with periodic anchoring to the durable tier.

---

## 3. Capabilities

### 3.1 Capability Declarations (`gap:capability_declaration`)

An actor publishes a declaration to advertise what it can do. The declaration is the contract; signing certifies it; the matchmaker uses it to route requests; the governance plane enforces it at runtime.

#### 3.1.1 Actor types

```typescript
type GapActorType =
  | 'skill'              // agent-generated code
  | 'service'            // long-lived service (Home Assistant, Stripe, etc.)
  | 'device'             // smart device, sensor, lock, light
  | 'agent'              // an AI agent persona
  | 'mcp_server'         // tool server exposed via MCP
  | 'gateway_subsystem'  // an internal gateway capability (PHI redact, HITL channel, etc.)
  | 'human_user'         // a person; their grants come from session auth + identity
```

#### 3.1.2 Declaration body

```typescript
interface CapabilityDeclarationBody {
  actor_type: GapActorType
  actor_id: string                    // stable identifier across versions
  actor_name: string                  // human-readable
  actor_version: string               // semver
  source_url?: string                 // where the code/spec lives
  parent_oid?: string                 // if derived from another actor

  capabilities: Capability[]

  // Resource limits the actor declares it will respect.
  declared_limits?: {
    max_invocations_per_minute?: number
    max_concurrent_invocations?: number
    max_payload_bytes?: number
    requires_network?: boolean
    requires_filesystem_read?: string[]
    requires_filesystem_write?: string[]
  }

  // Documentation pointers.
  human_summary?: string              // one-paragraph human description
  privacy_classification?: 'public' | 'restricted' | 'sensitive' | 'phi'
}

interface Capability {
  capability: string                  // dotted taxonomy: "home.lighting.control"
  scope?: Record<string, unknown>     // per-capability scope schema
  preconditions?: CapabilityPredicate[]
  safety_class?: 'A' | 'B' | 'C'      // matches skill risk_class
  physical_safety?: boolean           // forces L3 revocation per section 6
}

interface CapabilityPredicate {
  /** A predicate the gateway evaluates BEFORE allowing invocation.
   *  E.g. {kind: "time_window", args: {start: "06:00", end: "22:00"}}
   *  or {kind: "user_present", args: {sensor_oid: "..."}}. */
  kind: string
  args: Record<string, unknown>
}
```

#### 3.1.3 Capability taxonomy

The `capability` field uses a dotted-path taxonomy, published open under CC0.

Top-level domains in v1:

```
gap.*              GAP-internal (workflows, grants, etc.)
device.*           physical devices
home.*             smart home (lighting, climate, security, audio)
network.*          network services (read, write, restrict)
identity.*         Identity capabilities (verify, disclose, encounter)
inference.*        Inference Broker capabilities (run model X)
vault.*            Vault read/write operations
mcp.*              MCP tool capabilities
messaging.*        cross-channel messaging (SMS, push, voice, etc.)
financial.*        payment / transfer capabilities
physical.*         physical-safety-critical (locks, gates, valves, vehicles)
medical.*          medical-device capabilities
```

Implementations MAY define custom capabilities under a vendor prefix (for example `vendor.acme.specific_thing`) but SHOULD propose generally useful capabilities through the RFC process.

### 3.2 Capability Grants (`gap:capability_grant`)

A grant authorizes a caller to invoke specific capabilities on this tenant.

#### 3.2.1 Grant body

```typescript
interface CapabilityGrantBody {
  /** Who the grant authorizes. */
  grantee: {
    actor_type: GapActorType
    actor_oid: string               // OID of the grantee's declaration
    actor_session_id?: string       // optional: scope to one session
  }

  /** What capabilities are granted. */
  capability_scopes: GrantedCapabilityScope[]

  /** Time bounds. */
  granted_at_ms: number
  expires_at_ms: number | null      // null = until explicitly revoked

  /** Rate / volume limits the grant imposes (further restricting the actor's declared limits). */
  limits?: {
    max_invocations_per_minute?: number
    max_invocations_total?: number
    max_payload_bytes?: number
  }

  /** Provenance - who granted, why, with what evidence. */
  granted_by: string                // human or service actor OID
  reason?: string                   // free-form note for audit
  evidence_oids?: string[]          // OIDs of supporting artifacts (HITL receipts, etc.)

  /** Revocation policy override - see section 6. Defaults derive from capability_scopes.safety_class. */
  revocation_level_override?: 1 | 2 | 3
}

interface GrantedCapabilityScope {
  /** Reference to a capability declared in some declaration. */
  capability: string                // e.g. "home.lighting.control"
  capability_declaration_oid?: string  // optional: pin to a specific actor declaration

  /** Narrowing on top of the declaration's scope.
   *  E.g. declaration says rooms: ["any"], grant says rooms: ["studio", "kitchen"]. */
  scope_narrowing?: Record<string, unknown>

  /** Additional preconditions ON TOP of those in the declaration. */
  additional_preconditions?: CapabilityPredicate[]
}
```

#### 3.2.2 Grant evaluation

When a caller attempts an invocation, the gateway evaluates grants in this order:

1. Find all non-revoked, non-expired grants where `grantee.actor_oid` matches the caller AND the requested capability is in `capability_scopes[].capability`.
2. For each candidate grant, evaluate `scope_narrowing` against the requested invocation args. The invocation MUST satisfy ALL narrowings.
3. Evaluate `additional_preconditions` and the declaration's `preconditions`. ALL must pass.
4. Check `limits` against current usage counters. Reject if exceeded.
5. If multiple grants match, the **most restrictive applicable** narrowing set is enforced (an invocation must satisfy the narrowings of the grant that authorizes it). "Deny by default" is the safe failure mode: no matching grant means denied.
6. If no grant matches, the invocation is denied with reason `capability_denied`.

#### 3.2.3 Default grants

A tenant MAY define default grants, for example "all `human_user` actors of this tenant have `home.lighting.read` by default." These default grants are themselves GAP grants, issued by `system:tenant-defaults` at tenant creation.

### 3.3 Capability Invocations (`gap:capability_invocation`)

An invocation is the act of calling a capability. Most invocations are short-lived events; the receipt is the durable record.

#### 3.3.1 Invocation body

```typescript
interface CapabilityInvocationBody {
  caller: {
    actor_type: GapActorType
    actor_oid: string
    actor_session_id?: string
    grant_oid: string                 // which grant authorizes this
  }

  capability: string                  // dotted taxonomy
  capability_declaration_oid: string  // which actor's declaration we're invoking

  args: Record<string, unknown>       // invocation-specific args

  /** Bound to a workflow stage when the invocation is part of one. */
  workflow_context?: {
    workflow_instance_oid: string
    stage_id: string
  }

  /** SLA hint mirrors the Inference Broker's pattern. */
  sla_hint?: {
    max_latency_ms?: number
    deferrable?: boolean
  }

  /** Idempotency key - re-invoking with the same key returns the original receipt. */
  idempotency_key?: string

  invoked_at_ms: number
}
```

#### 3.3.2 Invocation dispatch

The gateway:

1. Validates the invocation against the grant (section 3.2.2).
2. Runs declared preconditions and additional preconditions.
3. Dispatches to the actor's adapter (HTTP call, Home Assistant publish, MCP tool call, etc.).
4. Awaits the result OR returns immediately with a workflow-tracking handle if the invocation triggers a workflow.
5. Emits a Decision Receipt regardless of outcome.

If any precondition fails, the receipt status is `denied` with the failing predicate identified. If the actor's adapter errors, the status is `failed` with the underlying error detail. If the invocation needs HITL escalation, a workflow is started and the invocation receipt references the workflow OID with status `pending`.

### 3.4 The Capability Registry

Implementations MUST maintain a queryable registry of:

- Active capability declarations (latest non-superseded, non-revoked) per actor
- Active grants per tenant
- Recent invocations (configurable retention; recommended at least 30 days)

The registry is implementation-defined but SHOULD support:

```
GET    /v1/gap/declarations?actor_type=X&capability=Y
GET    /v1/gap/declarations/:oid
GET    /v1/gap/grants?tenant_id=X&grantee_oid=Y
GET    /v1/gap/grants/:oid
POST   /v1/gap/grants                  -> issue a new grant
DELETE /v1/gap/grants/:oid             -> revoke (per section 6)
GET    /v1/gap/invocations?tenant_id=X&workflow_oid=Y
GET    /v1/gap/invocations/:oid
```

These endpoints are part of the conformance surface - see section 10.2.

### 3.5 Cross-Trust Federation

See section 7 for how grants and declarations work across trust boundaries (different tenants, different organizations, different SynOI deployments).

---

## 4. Workflows

Workflows are how GAP handles multi-stage, multi-channel, multi-modal orchestrations.

### 4.1 Workflow Definitions (`gap:workflow_definition`)

A definition is the template. It is operator-authored, signed, and reusable across many instances.

#### 4.1.1 Definition body

```typescript
interface WorkflowDefinitionBody {
  workflow_id: string                 // stable identifier
  workflow_name: string               // human-readable
  workflow_version: string            // semver

  description?: string

  /** What triggers a new instance. */
  trigger: WorkflowTrigger

  /** Stages, evaluated as a state machine. */
  stages: WorkflowStage[]

  /** Starting stage. */
  initial_stage_id: string

  /** Optional cleanup stage that runs on termination regardless of outcome. */
  cleanup_stage_id?: string

  /** Channels required for this workflow - must all be available or the workflow refuses to start. */
  required_channels: ChannelKind[]

  /** Optional channels - degrades gracefully if unavailable. */
  optional_channels?: ChannelKind[]

  /** Maximum total wall-clock time for an instance to live before forced termination. */
  max_total_duration_seconds: number
}

interface WorkflowTrigger {
  /** Triggers on risk-policy conditions OR explicit invocation. */
  kind: 'risk_policy' | 'capability_invocation' | 'explicit' | 'schedule'

  /** kind=risk_policy: */
  risk_class?: 'A' | 'B' | 'C'
  action_class?: string
  action_type_pattern?: string        // regex

  /** kind=capability_invocation: */
  capability_pattern?: string         // dotted with wildcards: "physical.unlock.*"

  /** kind=explicit: caller passes workflow_id directly. */

  /** kind=schedule: */
  cron?: string                       // cron expression
}
```

#### 4.1.2 Stage shape

```typescript
interface WorkflowStage {
  stage_id: string                    // unique within the workflow

  /** Optional time bound for this stage. */
  duration_seconds?: number

  /** Actions to emit when this stage begins. */
  actions?: StageAction[]

  /** Things to listen for. First match transitions. */
  listen?: StageListen[]

  /** Where to go on timeout. */
  on_timeout?: StageTransition

  /** Where to go if any action fails. */
  on_action_failure?: StageTransition

  /** Final stage marker - terminates the instance. */
  terminal?: boolean
  terminal_outcome?: 'approved' | 'denied' | 'timed_out' | 'withdrawn' | 'error'

  /** Optional capability invocation to run in this stage (the "capability shape"
   *  baked into a workflow stage). */
  invocation?: {
    capability: string
    args: Record<string, unknown>
    on_success?: StageTransition
    on_failure?: StageTransition
  }

  /** Optional precondition - only enter this stage if the predicate passes. */
  precondition?: CapabilityPredicate
}

interface StageAction {
  channel: ChannelKind                // see section 5
  method: string                      // channel-specific method name
  params: Record<string, unknown>     // channel-specific params
}

interface StageListen {
  channel: ChannelKind
  intent?: string                     // for intent-based channels (voice)
  pattern?: string                    // for free-form text channels (regex on response)
  event_kind?: string                 // for typed-event channels
  next: StageTransition
}

interface StageTransition {
  next_stage_id?: string              // jump to this stage
  bind?: Record<string, string>       // copy listen-output fields into workflow scope variables
}
```

### 4.2 Workflow Instances (`gap:workflow_instance`)

An instance is one execution of a definition.

```typescript
interface WorkflowInstanceBody {
  workflow_definition_oid: string
  workflow_id: string                 // copied from the definition for indexing
  trigger_event: {
    kind: WorkflowTrigger['kind']
    source_invocation_oid?: string    // if triggered by an invocation
    source_risk_policy_id?: string    // if triggered by risk policy
    source_actor_oid: string          // who/what fired the trigger
  }

  /** Workflow state. */
  current_stage_id: string
  scope_variables: Record<string, unknown>   // values bound from listen outputs

  /** Lifecycle timestamps. */
  started_at_ms: number
  last_transition_at_ms: number
  terminated_at_ms: number | null
  terminal_outcome: StageTransition['next_stage_id'] | null

  /** Channel adapter state. */
  active_channel_listeners: Array<{
    channel: ChannelKind
    listen_spec: StageListen
    started_at_ms: number
  }>

  /** Transition chain - references to all stage transitions in execution order. */
  transition_oids: string[]           // OIDs of gap:stage_transition CDROs

  /** Final receipt OID after termination. */
  final_receipt_oid?: string
}
```

### 4.3 Stage Transitions (`gap:stage_transition`)

Every transition produces a CDRO. Transitions chain via `previous_transition_oid` (a singly-linked list).

```typescript
interface StageTransitionBody {
  workflow_instance_oid: string
  previous_transition_oid: string | null   // null = first transition

  from_stage_id: string
  to_stage_id: string

  trigger_reason: 'listen_matched' | 'timeout' | 'action_completed'
                | 'action_failed' | 'precondition_passed' | 'precondition_failed'
                | 'invocation_succeeded' | 'invocation_failed'
                | 'external_signal' | 'cleanup'

  /** Bound variables produced by this transition. */
  bind_outputs: Record<string, unknown>

  /** Optional: the channel event that triggered this transition. */
  triggering_event_oid?: string       // OID of gap:channel_event

  /** Optional: the invocation result that triggered this transition. */
  triggering_invocation_oid?: string

  transitioned_at_ms: number
}
```

### 4.4 The state machine runner - semantics

A conformant runner MUST implement these semantics:

#### 4.4.1 Entering a stage

1. Persist the stage entry as a `gap:stage_transition` CDRO.
2. Evaluate the stage `precondition` if present. If it fails, transition to the precondition-failed path (typically `on_action_failure` or termination).
3. Fire all stage `actions` in parallel. Wait for action completions.
4. If any action fails AND `on_action_failure` is defined, transition there.
5. Arm all `listen` specs concurrently.
6. Arm the `duration_seconds` timeout if present.

#### 4.4.2 Transition firing rules

- **First listen match wins.** If two listens fire near-simultaneously, the first recorded by the runner wins; the loser is discarded with a logged note.
- **Timeout fires after `duration_seconds`** of wall-clock time from stage entry. The timeout is absolute (from stage entry), not "since last activity".
- **Action failure fires immediately** when any action's adapter returns an error.
- **Invocation outcomes** (when the stage has an `invocation`) fire on completion of the invocation.

#### 4.4.3 Terminal stages

A stage marked `terminal: true` MUST:

1. Cancel all active listeners.
2. Run the `cleanup_stage_id` if defined (a non-terminating helper stage).
3. Emit the final `gap:decision_receipt` with the `terminal_outcome`.
4. Mark the instance as `terminated_at_ms`.

#### 4.4.4 Concurrent workflows

Multiple instances of the same definition CAN run concurrently in the same tenant. Each has its own `scope_variables`. Tenants MAY define `max_concurrent_instances` at the definition level. If two workflows would race for the same capability invocation, the channel adapter serializes them in the order it received the calls (section 5).

### 4.5 Listen semantics - channels + intents

A workflow stage's `listen` block waits for one of several possible inputs. The shape depends on the channel:

```typescript
// Voice channel - intent-based
{ channel: 'voice', intent: 'approve', next: { next_stage_id: 'confirm_approve' } }

// SMS channel - pattern-based
{ channel: 'sms', pattern: '^(y|yes|approve)$', next: { next_stage_id: 'confirm_approve', bind: { sender: 'phone' } } }

// Mobile push channel - typed events
{ channel: 'mobile_push', event_kind: 'approval.tap', next: { next_stage_id: 'confirm_approve' } }

// Home Assistant - direct event
{ channel: 'home_assistant', event_kind: 'binary_sensor.front_door_opened', next: { next_stage_id: 'door_opened_path' } }
```

The channel adapter normalizes its native event shapes into GAP's listen schema. See section 5 for adapter responsibilities.

### 4.6 Scope variables

Stages can write to and read from a shared variable scope. Listen outputs can bind fields into scope; subsequent stages can reference them in action `params`.

```yaml
# Stage that captures the sender's phone number
- stage_id: receive_decision
  listen:
    - channel: sms
      pattern: '^(y|yes|n|no)$'
      next:
        next_stage_id: confirm
        bind:
          decision: matched_text
          sender_phone: sender

# Stage that uses the bound value
- stage_id: confirm
  actions:
    - channel: sms
      method: send
      params:
        to: '${scope.sender_phone}'
        body: 'You said ${scope.decision}. Confirm? (Y/N)'
```

Variable interpolation uses `${scope.var_name}` syntax. References to undefined variables cause stage entry to fail with `precondition_failed`.

---

## 5. Channel Adapters

A channel adapter is the bridge between GAP's abstract `actions`/`listen` model and a concrete delivery surface (Twilio SMS, Slack, Home Assistant, mobile push, voice, etc.).

### 5.1 The adapter interface

```typescript
interface ChannelAdapter {
  /** Channel kind this adapter handles. */
  kind: ChannelKind

  /** Adapter capabilities - which GAP listen/action shapes it supports. */
  supports: {
    actions: string[]                 // e.g. ['send', 'flash', 'tts.say', 'turn_on']
    listens: Array<'intent' | 'pattern' | 'event_kind'>
  }

  /** Execute an action. Returns when complete or errors. */
  performAction(spec: StageAction, context: AdapterContext): Promise<ActionResult>

  /** Arm a listener. Returns a handle that can be cancelled. */
  armListen(spec: StageListen, context: AdapterContext, onMatch: (event: ChannelEvent) => void): ListenHandle

  /** Health check. */
  health(): Promise<{ ok: boolean; detail?: string }>
}

interface AdapterContext {
  tenant_id: string
  workflow_instance_oid: string
  stage_id: string
  scope_variables: Record<string, unknown>
}

interface ActionResult {
  ok: boolean
  detail?: string
  /** Optional: a channel event spawned by the action (for actions that double as events). */
  spawned_event_oid?: string
}

interface ChannelEvent {
  channel: ChannelKind
  event_kind: string                  // adapter-defined
  payload: Record<string, unknown>
  observed_at_ms: number
}

interface ListenHandle {
  cancel(): void
}
```

### 5.2 Standard channels (v1)

A conformant implementation SHOULD provide adapters for these:

| Channel kind | Use | Listens | Actions |
|---|---|---|---|
| `voice` | TTS + STT for in-room ambient voice | intent | `tts.say`, `tts.broadcast` |
| `sms` | Twilio / Bandwidth | pattern | `send`, `mms` |
| `slack` | Slack workspace bot | event_kind (button click) | `post`, `dm`, `update` |
| `mobile_push` | iOS APNs + Android FCM via gateway | event_kind | `notify`, `silent_notify` |
| `home_assistant` | Home Assistant over WebSocket or MQTT | event_kind | `service_call` (any HA service) |
| `desktop_overlay` | OS-level overlay (Windows toast, macOS notification, Linux libnotify) | event_kind | `notify`, `prompt` |
| `email` | SMTP gateway | event_kind (magic-link click) | `send` |
| `in_app` | Within a SynOI app | event_kind | `present` |
| `game_engine` | Cross-reality (Unity, Unreal, Roblox webhook) | event_kind | `dispatch` |
| `webhook` | Generic HTTP POST in + out | event_kind | `post` |

Channel kinds are extensible - implementations MAY define vendor channels (for example `vendor.acme.smart_panel`) and propose additions to the standard set through the RFC process.

### 5.3 Adapter registration

Adapters register with the gateway at startup. Each registration is signed by the adapter's vendor and stored as a `gateway_subsystem` capability declaration (section 3.1.1). A workflow that refuses to start due to missing adapters logs a Decision Receipt with status `failed`, reason `missing_required_channels`, and the list of missing channels.

### 5.4 Adapter-specific concerns

#### 5.4.1 Voice channel

- The adapter MUST provide wake-word filtering - only listen during stages that have explicitly armed listens.
- Recording is NOT persisted by default. If recording is required for audit, the adapter MUST emit a `gap:channel_event` with `event_kind: 'voice.utterance'` whose `payload` references the recorded CDRO OID.
- TTS responses MAY be cached as CDROs to avoid re-synthesis cost.

#### 5.4.2 SMS channel

- All inbound replies are routed by inbound-phone-number to tenant mapping. A pre-shared mapping is required.
- Pattern matches are case-insensitive by default and anchored (`^...$`) unless the pattern explicitly does not anchor.
- A single phone number CAN belong to only one tenant at a time. Tenant handoffs require explicit re-mapping with the prior tenant's consent.

#### 5.4.3 Mobile push

- Push payloads include the workflow instance OID for in-app deep-linking.
- Silent notifications MAY be used to update in-app state without surfacing UI (for example revocation of a previously pending approval).

#### 5.4.4 Game engine

- The game-engine adapter speaks a generic HTTP + WebSocket protocol. Game vendors implement the protocol on their side.
- Cross-reality semantics (for example a quest mission stage triggering a real-world capability invocation) flow through the game-engine adapter naturally: the workflow stage's `invocation` block fires the capability call.

---

## 6. Revocation

### 6.1 Why tiered revocation

Not all capabilities deserve the same revocation friction. Revoking "Slack message permission" should be one click. Revoking "front-gate unlock permission" should require two operators plus a cooling-off period. Revoking "control of a medical device" should require multi-party approval plus public notice. Tiered revocation makes the friction match the stakes.

### 6.2 The three levels

#### 6.2.1 L1 - Single-operator immediate (default)

For capabilities with `safety_class: 'A'` or `'B'` and no `physical_safety: true`.

- One authorized operator clicks "revoke."
- Revocation effective immediately.
- Decision Receipt emitted.
- No cooling-off, no escalation.

#### 6.2.2 L2 - Two-person approval + cooling-off

For capabilities with `safety_class: 'C'` and no `physical_safety: true`.

- Operator A initiates revocation.
- Operator B (separate person, separate auth) approves within the cooling-off window.
- Default cooling-off: 1 hour (configurable per capability declaration).
- During cooling-off, the capability is provisionally blocked (section 6.2.4).
- After both approvals and the cooling-off elapses, revocation is final.

#### 6.2.3 L3 - Multi-party + impact assessment + public notice

For capabilities with `physical_safety: true` OR any capability the operator chooses to escalate.

- N-of-M operators (default 3-of-5) must approve.
- An impact-assessment document is required (cited by OID in the revocation event).
- External attestation may be required (regulatory filing, third-party audit, etc.).
- Public-notice window: default 24 hours during which the planned revocation is announced on the OID Resolver before taking effect.
- Final revocation requires all of: enough operator approvals, attestation received, and the public-notice window elapsed.

#### 6.2.4 Provisional Block (emergency path)

For when something is going wrong now and the L2/L3 process is too slow.

- Any L1 operator can initiate a Provisional Block.
- The capability is immediately blocked.
- A 72-hour window starts during which the full L2 or L3 process MUST be completed.
- If the process completes affirmatively, revocation becomes permanent.
- If the process completes negatively, the block is lifted and a Provisional Block Receipt is emitted with status `lifted`.
- If 72 hours elapse without process completion, the block is automatically lifted (fail-open) and an alert is emitted to all operators.

This prevents Provisional Block from being misused as an unaccountable indefinite suspension while still allowing emergency response.

### 6.3 Determining the required level

For any capability, the required level is the MAXIMUM of:

1. The level derived from `safety_class` (A -> L1, B -> L1, C -> L2).
2. L3 if `physical_safety: true`.
3. The level specified in `revocation_level_override` on the grant.

Operators CAN escalate (require more friction). Operators CANNOT de-escalate below the declared safety class.

### 6.4 The revocation event (`gap:revocation_event`)

```typescript
interface RevocationEventBody {
  /** What is being revoked. */
  target_kind: 'capability_declaration' | 'capability_grant' | 'workflow_definition' | 'workflow_instance' | 'skill'
  target_oid: string

  /** Why. */
  reason: string                      // free-form audit note
  evidence_oids?: string[]            // supporting documents

  /** Process. */
  required_level: 1 | 2 | 3
  provisional: boolean                // true = Provisional Block

  /** Approver list, in order of approval. */
  approvers: Array<{
    actor_oid: string
    approved_at_ms: number
    cooling_off_satisfied: boolean
    attestation_oid?: string
  }>

  /** Public notice. */
  public_notice_started_at_ms?: number
  public_notice_window_ms?: number

  /** Final state. */
  effective_at_ms: number | null      // null = not yet effective
  lifted_at_ms?: number | null        // for provisional blocks that ended without final revocation
}
```

### 6.5 Propagation

When a revocation becomes effective:

1. The OID Resolver MUST mark the target OID as revoked. Subsequent queries return `revoked: true`.
2. The gateway's capability registry MUST refresh and stop honoring the target.
3. In-flight invocations using a revoked grant MAY complete OR be cancelled (implementation choice). They SHOULD log a "completed under revoked grant" note if completing.
4. In-flight workflow instances using a revoked capability MUST transition to a `revoked` terminal stage as soon as the revocation is detected.

Propagation latency SHOULD be at most 5 seconds for L1 and at most 30 seconds for L2/L3.

### 6.6 Restoration

A revoked capability/grant/workflow CAN be restored, but restoration is a new authorization act: it creates a NEW grant CDRO with a new OID. The old (revoked) one stays revoked. Restoration requires the same level of approval as the original revocation, minimum L1.

---

## 7. Cross-Trust-Boundary Federation

When two SynOI tenants (or two separate SynOI deployments) want to share capabilities, federation provides the handshake.

### 7.1 Federation handshake (`gap:federation_handshake`)

```typescript
interface FederationHandshakeBody {
  /** The two parties. */
  initiator: {
    tenant_id: string
    deployment_origin: string         // hostname or org identifier
    public_key_oid: string            // SRAID public key OID
  }
  acceptor: {
    tenant_id: string
    deployment_origin: string
    public_key_oid: string
  }

  /** What is being federated. */
  shared_capabilities: string[]       // dotted-taxonomy capabilities

  /** Direction. */
  direction: 'initiator_to_acceptor' | 'bidirectional'

  /** Scope and limits. */
  scope_constraints: Record<string, unknown>
  per_minute_limit: number
  per_day_limit: number

  /** Time bounds. */
  valid_from_ms: number
  valid_until_ms: number | null

  /** Both parties sign. */
  initiator_signature: SraidSignatureEnvelope
  acceptor_signature: SraidSignatureEnvelope
}
```

### 7.2 Cross-tenant grant chains

When a cross-trust grant is invoked, the receipt MUST reference the federation handshake OID. This creates an auditable chain:

```
Invocation receipt
  -> References grant OID
       -> References capability declaration OID (of the acceptor's actor)
       -> References federation handshake OID
            -> References initiator's public key OID
            -> References acceptor's public key OID
```

Either party can revoke a federation handshake. Revocation follows the same L1/L2/L3 rules per section 6.

### 7.3 Trust transitivity

By default, trust does NOT transit. Tenant A trusting tenant B does NOT imply tenant A trusts whoever tenant B trusts. Each pair requires its own handshake. Implementations MAY support explicit "transitive trust" handshakes for federation hubs, but these MUST be marked `transitivity: 'explicit'` and require all-parties consent.

---

## 8. Decision Receipts

Every action GAP governs produces a receipt. Receipts are the audit substrate.

### 8.1 Receipt schema

```typescript
interface GapDecisionReceiptBody {
  /** What this is the receipt for. */
  subject_kind: 'capability_invocation' | 'stage_transition' | 'grant_issued'
              | 'grant_revoked' | 'workflow_started' | 'workflow_terminated'
              | 'revocation_initiated' | 'revocation_effective'
              | 'federation_handshake' | 'provisional_block'
  subject_oid: string

  /** Who initiated the subject action. */
  initiator: {
    actor_oid: string
    actor_type: GapActorType
  }

  /** Tenant scope. */
  tenant_id: string

  /** Outcome. See section 8.4 for the full status set. */
  status: 'ok' | 'denied' | 'failed' | 'deferred' | 'timed_out' | 'pending'
        | 'rate_limited' | 'refused_budget'
  detail?: string

  /** Cross-references. */
  capability_grant_oids?: string[]
  workflow_instance_oid?: string
  workflow_stage_id?: string

  /** Inference Broker integration - if the action involved ML, the broker receipt OID. */
  inference_receipt_oid?: string

  /** Channel events that contributed to this receipt. */
  channel_event_oids?: string[]

  /** Timestamps. */
  initiated_at_ms: number
  resolved_at_ms: number

  /** Performance + audit metadata. */
  metrics?: {
    latency_ms?: number
    channel_count?: number
    listen_match_count?: number
  }

  /** Compliance tags applied at receipt time. */
  compliance_tags?: string[]
}
```

### 8.2 Receipt signing and the receipt-scheme discriminator

Receipts are SRAID CDROs, signed over the canonical bytes of the content core (section 2.2). A decision-receipt CDRO carries a `receipt_scheme` discriminator so a verifier can dispatch to the correct verification path and **fail CLOSED on an unknown or missing scheme** rather than silently accepting a receipt it does not understand. The discriminator is stamped BEFORE signing, so it is bound into the signature and cannot be stripped or swapped without invalidating the seal.

Two schemes exist:

- **v2 (current, `synoi.receipt/v2`).** A DSSE attestation over the ONE normative content core defined in section 2.2 and `PROJECTION_SPEC.md`. This is the live path for all new receipts. The signer key generation is K1, with a defined cutover to K2 (a key rotation, not a scheme change); both K1 and K2 are v2 schemes and a verifier accepts either signing key while the scheme stays constant.
- **v1 (legacy flat).** A flat-scalar receipt signing shape that uses a DIFFERENT, larger strip-set (it additionally excludes `gap_version` and `supersedes` and folds the body to flat scalars). This is retained ONLY for receipts minted before v2. It is NOT the CDRO content core and MUST NOT be used to recompute a CDRO OID.

A verifier MUST select the verification path from `receipt_scheme` alone and MUST NOT infer the scheme from object shape. A receipt whose `receipt_scheme` is absent or is any value other than a scheme the verifier implements is REJECTED (fail-closed).

### 8.3 Receipt persistence

A conformant implementation MUST persist receipts for at least 90 days. Implementations targeting regulated industries (for example HIPAA or finance) typically persist 7 or more years.

### 8.4 Receipt status set

The status field records the outcome. Most values are self-explanatory. Two carry specific semantics:

- `refused_budget` is a **billing veto**, NOT a governance deny. It is emitted when a spend-cap or quota block stops an action for billing reasons. It maps to its own decision verb (`budget_refused`) so it never lands in the deny/authority corpus and never affects the authorized axis. A `refused_budget` receipt asserts "this was not billed/allowed to spend", not "this actor was denied authorization". Verifiers and auditors MUST treat it as distinct from `denied`.
- `rate_limited` records that a rate limit stopped the action. Like `refused_budget`, it is an operational stop, not an authorization decision.

### 8.5 Receipt query API

```
GET  /v1/gap/receipts/:oid                                  -> single receipt
GET  /v1/gap/receipts?tenant_id=X&subject_kind=Y            -> list with filter
GET  /v1/gap/receipts/by-workflow/:workflow_instance_oid    -> all receipts for a workflow
GET  /v1/gap/receipts/by-grant/:grant_oid                   -> invocation history for a grant
```

The receipt API surface is part of the GAP open spec - the same shape across implementations.

---

## 9. Worked Examples

### 9.1 Smart home - turn off cameras during a meeting

**Scenario:** the operator starts a video call and says "turn off the studio cameras while I am on this call."

```yaml
workflow_definition:
  workflow_id: temp_camera_off
  trigger:
    kind: explicit
  required_channels: [voice, home_assistant]
  initial_stage_id: confirm
  stages:
    - stage_id: confirm
      actions:
        - channel: voice
          method: tts.say
          params:
            text: "Turn off studio cameras for the duration of this meeting?"
      listen:
        - channel: voice
          intent: confirm_yes
          next: { next_stage_id: turn_off }
        - channel: voice
          intent: confirm_no
          next: { next_stage_id: cancel }
      on_timeout: { next_stage_id: cancel }
      duration_seconds: 10

    - stage_id: turn_off
      invocation:
        capability: home.security.camera_disable
        args: { targets: ["camera.studio_left", "camera.studio_right"], reason: "user-initiated meeting" }
        on_success: { next_stage_id: wait_meeting_end }
        on_failure: { next_stage_id: error }

    - stage_id: wait_meeting_end
      listen:
        - channel: home_assistant
          event_kind: meeting.ended
          next: { next_stage_id: turn_back_on }
      duration_seconds: 14400  # 4 hours max

    - stage_id: turn_back_on
      invocation:
        capability: home.security.camera_enable
        args: { targets: ["camera.studio_left", "camera.studio_right"] }
        on_success: { next_stage_id: done }
        on_failure: { next_stage_id: error }

    - stage_id: done
      terminal: true
      terminal_outcome: approved
    - stage_id: cancel
      terminal: true
      terminal_outcome: denied
    - stage_id: error
      terminal: true
      terminal_outcome: error
```

**Receipts emitted (in order):** workflow_started, stage_transition (initial to confirm), channel_event (voice prompt), channel_event (voice intent confirm_yes), stage_transition (confirm to turn_off), capability_invocation (camera_disable), stage_transition (turn_off to wait_meeting_end), and so on through workflow_terminated.

### 9.2 Quest game - mission stage

A quest mission has a stage where one player must intercept another's package. The workflow_instance is the quest mission; a supporting player exposes `home.cameras.public` scoped to a nearby grid. The mission engine fires a workflow stage:

```yaml
- stage_id: intercept_attempt
  actions:
    - channel: mobile_push
      method: notify
      params:
        actor_oid: player_d
        title: "Target is being followed"
        body: "Activate the 5th-and-Main camera to confirm."
  listen:
    - channel: mobile_push
      event_kind: player_d.activated_camera
      next:
        next_stage_id: camera_observation
        bind:
          camera_oid: payload.camera_oid

- stage_id: camera_observation
  invocation:
    capability: home.cameras.public
    args:
      target: "${scope.camera_oid}"
      session_actor: player_d
      duration_seconds: 30
    on_success: { next_stage_id: relay_intel }
```

The quest workflow naturally uses both shapes: a capability invocation (camera) interleaved with workflow choreography (a player's input).

### 9.3 Doctor + equipment operation

```yaml
- stage_id: confirm_patient
  actions:
    - channel: in_app
      method: present
      params:
        view: confirm-patient
        patient_id_field: scope.patient_id
  listen:
    - channel: in_app
      event_kind: patient.confirmed
      next: { next_stage_id: pre_op_check, bind: { patient_confirmed_by: payload.user_oid } }

- stage_id: pre_op_check
  invocation:
    capability: medical.equipment.self_test
    args: { equipment_oid: scope.equipment_oid }
    on_success: { next_stage_id: power_on }
    on_failure: { next_stage_id: alert_failure }

- stage_id: power_on
  invocation:
    capability: medical.equipment.power_on
    args: { equipment_oid: scope.equipment_oid, authorized_by: scope.patient_confirmed_by }
    on_success: { next_stage_id: ready }
    on_failure: { next_stage_id: alert_failure }
```

`medical.equipment.power_on` is declared with `physical_safety: true`, which forces L3 revocation per section 6.

### 9.4 Voice approval - critical action

```yaml
workflow_id: critical-physical-action-house
trigger:
  kind: risk_policy
  risk_class: C
  action_type_pattern: '^physical_unlock$'

stages:
  - stage_id: visual_alert
    duration_seconds: 3
    actions:
      - channel: home_assistant
        method: light.turn_on
        params: { targets: ["light.studio_main"], color: red, brightness: 255 }
    on_timeout: { next_stage_id: get_attention }

  - stage_id: get_attention
    duration_seconds: 10
    actions:
      - channel: home_assistant
        method: light.flash
        params: { targets: ["light.studio_main"], color: amber, count: 3, interval_ms: 500 }
    listen:
      - channel: voice
        intent: ask_what_is_it
        next: { next_stage_id: announce }
    on_timeout: { next_stage_id: escalate_sms }

  - stage_id: announce
    actions:
      - channel: voice
        method: tts.say
        params: { text: "A visitor wants to unlock the front gate. Say approve, deny, or details." }
    listen:
      - channel: voice
        intent: approve
        next: { next_stage_id: confirm_approve }
      - channel: voice
        intent: deny
        next: { next_stage_id: confirm_deny }
      - channel: voice
        intent: more_details
        next: { next_stage_id: explain }
    duration_seconds: 30
    on_timeout: { next_stage_id: escalate_sms }

  - stage_id: confirm_approve
    invocation:
      capability: physical.gate.unlock
      args: { gate_oid: "scope.gate_oid" }
      on_success: { next_stage_id: done_approved }
      on_failure: { next_stage_id: invocation_failed }

  - stage_id: done_approved
    terminal: true
    terminal_outcome: approved

  # (escalate_sms, confirm_deny, explain, etc. omitted for brevity)
```

### 9.5 Multi-agent household - non-owner agent requests a sensitive action

```yaml
trigger:
  kind: capability_invocation
  capability_pattern: '^home\.security\.camera_disable$'
  # AND policy: requester is a non-owner AND target is a sensitive room

stages:
  - stage_id: notify_owner
    actions:
      - channel: mobile_push
        method: notify
        params:
          actor_oid: owner_oid
          title: "Guest agent requests camera disable"
          body: "Agent ${scope.agent_name} wants to turn off ${scope.targets}. Allow?"
          actions: [Allow, Deny, AllowOnce]
    listen:
      - channel: mobile_push
        event_kind: approval.tap
        next:
          next_stage_id: decision
          bind:
            decision: payload.action

  - stage_id: decision
    precondition:
      kind: equals
      args: { field: 'scope.decision', value: 'Allow' }
    invocation:
      capability: home.security.camera_disable
      args: { targets: '${scope.targets}', reason: 'guest-agent-approved' }
      on_success: { next_stage_id: done }
      on_failure: { next_stage_id: error }

  - stage_id: done
    terminal: true
    terminal_outcome: approved
```

The same workflow can handle "AllowOnce" (a one-time grant scoped to this invocation only) by emitting a single-use grant via a stage action before the invocation fires.

---

## 10. Conformance

### 10.1 Test vectors

Reference vectors are published alongside this spec. Each object type in section 2 has:

- at least 5 valid examples (canonical JSON + computed OID + signature)
- at least 5 malformed examples that MUST be rejected
- at least 3 edge cases (boundary values, unicode, large payloads)

The projection vectors that define the cross-language OID ABI are GENERATED from the `@synoi/sraid` reference implementation and consumed byte-for-byte by every SDK, the signer, and the verifiers. Every projection vector carries `attestation`, `supersedes`, and `gap_version` so any strip-set divergence turns a vector red. A conformant implementation:

1. removes exactly the six content-core fields (section 2.2) and keeps all others,
2. produces `cdroOid(pre-attestation) == cdroOid(post-attestation)`,
3. rejects every float-bearing input,
4. changes the OID when `supersedes` or `gap_version` changes,
5. matches the RFC 8785 reference ordering and escaping vectors byte-for-byte.

Workflow execution vectors include a baseline single-stage happy path, a multi-stage definition covering each transition type, a workflow with all standard channel adapters mocked, an L2 revocation flow, an L3 revocation flow (with public notice and attestation), and a cross-trust federation flow.

### 10.2 Required vs optional features

**Required (MUST):**

- Section 2: all object types parseable and validatable; OID and canonicalization per `PROJECTION_SPEC.md`.
- Section 3: capability declaration, grant, invocation lifecycle.
- Sections 4.1 to 4.4: workflow definition, instance, transition state machine.
- Section 5.1: channel adapter interface.
- Section 6.2.1: L1 revocation.
- Section 8: Decision Receipt emission per state transition, with the `receipt_scheme` discriminator and fail-closed verification.

**Should (SHOULD):**

- Section 4.5: variable scope binding.
- Section 5.2: at least 3 of the standard channel adapters.
- Section 6.2.2: L2 revocation (in shared-credential or data-access contexts).
- Section 6.2.4: Provisional Block emergency path.
- Section 7: cross-trust federation (when deployed across tenants).
- Section 8.5: receipt query API.

**Optional (MAY):**

- Section 6.2.3: L3 revocation (only required if `physical_safety: true` capabilities are supported).
- Section 7.3: transitive trust.
- Section 9: anything in worked examples.

### 10.3 Versioning policy

GAP follows semver: `<major>.<minor>.<patch>`.

- **Patch** bumps for editorial or clarifying changes.
- **Minor** bumps for additive features (new object types, channel kinds, revocation provisions) that do not break v1 implementations.
- **Major** bumps for incompatible changes (renaming or removing fields, changing semantics).

Major version bumps require a 90-day deprecation notice on the OID Resolver's public-notice channel.

### 10.4 Deprecation cycle

Field deprecation:

1. Mark the field as deprecated in the spec with a target removal version.
2. Continue accepting the field for at least 2 minor versions.
3. Remove it in the next major version.

Capability deprecation:

1. Publish a new declaration version WITHOUT the capability, listing removed ones in `deprecated_capabilities`.
2. Existing grants referencing the deprecated capability continue to work until grant expiration or explicit revocation.
3. New grants for the deprecated capability are rejected with reason `capability_deprecated`.

---

## 11. License + References

### 11.1 License

This specification is published under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication). Anyone can implement GAP or fork this spec for any purpose, commercial or non-commercial, without an attribution requirement.

Hosted SynOI services and SynOI brand names are NOT covered by this CC0 dedication.

### 11.2 References

#### Normative

- **`@synoi/sraid` `PROJECTION_SPEC.md`** - the ONE normative source for the CDRO OID content-core projection, the finite-integer number rule, and the RFC 8785 (JCS) canonicalization rules. On any conflict with the summary in section 2.2, `PROJECTION_SPEC.md` governs.
- **ADR_019 (`docs/ADR_019_L0_NORMATIVE_PROJECTION.md`)** - the decision record establishing the single normative projection, the fail-closed scheme cutover, and the billing-versus-governance status separation.
- **RFC 8785** - JSON Canonicalization Scheme (JCS), the base SRAID canonicalization narrows.
- **RFC 8032** - Ed25519 signatures (legacy hybrid signature component).
- **FIPS 204** - ML-DSA (the post-quantum signature component).

#### Informative

- SRAID (L0) object format overview.
- Inference Broker (L2) ML dispatch surface that GAP workflows may invoke.

### 11.3 Change log (this version)

- 1.1 (2026-07-05): Renamed the layer from the COF Stack to the SRAID Stack and all object types from the `agp:` prefix to `gap:`. Replaced the inline OID/content-core definition with a pointer to the ONE normative projection (`@synoi/sraid` `PROJECTION_SPEC.md`): six-field content core keeping `gap_version` + `supersedes`, finite-integer number rule (fractional quantities carried as integer minor units with a declared scale), pre/post-attestation OID invariance. Documented the `receipt_scheme` discriminator (v1 flat legacy versus v2 `cdroContentCore` DSSE, fail-closed on unknown or missing scheme, K1 to K2 key cutover within v2). Added the `refused_budget` status as a billing refusal distinct from a governance deny. Expanded CDRO, OID, SRO, DSSE on first use. Removed internal document references so the spec stands alone.
