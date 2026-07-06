# GAP Companion Profile: Gaming

**Draft:** gap-gaming-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `game.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol for games, game economies, esports, and
live-ops platforms. It registers the `game.*` capability namespace, two normative precondition
kinds (`anti_cheat_clean`, `live_ops_segment`), and three CDRO types for anti-cheat evidence
chains, loot table commits, and economy velocity events.

A game studio adopting this profile gets:

- Every in-game economy action governed by a signed, immutable receipt (displaces mutable SQL
  ban databases and custom audit tables)
- Anti-cheat attestations bound cryptographically to the grant chain: the signed evidence
  package a publisher needs to survive a ban dispute or esports arbitration hearing
- Live-ops rollouts governed and audited per-player, replacing untracked feature flags
- Loot table commits that prove the outcome was drawn from the declared table before the player
  saw it (commit-reveal integrity)

This profile composes freely with other profiles. A game studio running a CI/CD pipeline can
activate `gap-gaming-00` and `gap-supply-chain-00` simultaneously; the namespaces do not
conflict.

---

## 2. Capability Taxonomy

Capability names use the `game.` root. Sub-namespaces are open; operators may extend any
branch (e.g., `game.economy.crafting.recipe.execute`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for game context                                                  |
|-------|------------------------------------------------------------------------------|
| A     | Read-only queries (leaderboard read, inventory read, match history fetch)    |
| B     | Reversible mutations (cosmetic equip, chat send, match join/leave)           |
| C     | Economy mutations, ranked/competitive actions, tournament entry, item trade  |

### 2.2 Core capability names

| Capability name                     | Class | require_signed_receipt | Notes                                    |
|-------------------------------------|-------|------------------------|------------------------------------------|
| `game.economy.item.transfer`        | C     | true                   | Player-to-player item transfer           |
| `game.economy.item.trade`           | C     | true                   | Marketplace listing or trade completion  |
| `game.economy.currency.purchase`    | C     | true                   | In-game currency purchase (IAP)          |
| `game.economy.currency.spend`       | C     | true                   | In-game currency spend                   |
| `game.economy.loot.open`            | C     | true                   | Loot box or reward open                  |
| `game.match.ranked.join`            | C     | true                   | Ranked queue entry                       |
| `game.match.ranked.result.submit`   | C     | true                   | Ranked match result submission           |
| `game.tournament.entry`             | C     | true                   | Tournament or esports event entry        |
| `game.account.ban.issue`            | C     | true                   | Player ban issuance                      |
| `game.account.ban.appeal.resolve`   | C     | true                   | Ban appeal resolution                    |
| `game.liveops.segment.activate`     | B     | false                  | Live-ops rollout activation for a player |
| `game.inventory.read`               | A     | false                  | Inventory read                           |
| `game.leaderboard.read`             | A     | false                  | Leaderboard read                         |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `anti_cheat_clean`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates any `game.*` class C capability on the actor having a current, clean
anti-cheat attestation. Ensures economy actions, ranked play, and tournament entry are blocked
for actors whose client integrity cannot be verified.

**Args schema:**

```json
{
  "type": "object",
  "required": ["max_assertion_age_ms"],
  "properties": {
    "max_assertion_age_ms": {
      "type": "integer",
      "minimum": 1,
      "description": "Maximum age of the most recent gaming:anti_cheat_assertion CDRO for this actor, measured from assertion.attested_at_ms to server receive time."
    },
    "accepted_providers": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional allowlist of attestation provider identifiers. If omitted, any provider is accepted."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `anti_cheat_clean` MUST:

1. Locate the most recent `gaming:anti_cheat_assertion` CDRO for the invoking actor OID in the
   tenant receipt store.
2. Verify the assertion CDRO's `gateway_signature` (the gateway's own re-signature over the
   attestation body, issued at grant time) using the gateway's published signing key.
3. Verify that `(server_receive_time_ms - assertion.attested_at_ms) <= args.max_assertion_age_ms`.
4. If `args.accepted_providers` is present, verify that `assertion.provider` is in the list.
5. Verify that `assertion.verdict == "clean"`.

If any check fails, the gateway MUST deny the invocation with `precondition_failed` and
`precondition_kind: "anti_cheat_clean"` in the receipt.

The gateway MUST NOT call the external attestation provider synchronously on every invocation.
The assertion CDRO serves as the cached, signed result. Re-assertion frequency is controlled by
`max_assertion_age_ms`.

**Cache behavior:** The pass result is valid until `assertion.attested_at_ms + max_assertion_age_ms`.
No additional cache layer is required.

**Failure action:** `deny` (not `hitl`; a suspicious client should not receive an approval
prompt that reveals the gate exists).

---

### 3.2 `live_ops_segment`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates a capability on the invoking actor falling within a declared rollout cohort.
Enables governed, audited live-ops rollouts (A/B tests, VIP early access, regional activations,
seasonal events) where every per-player allow/deny produces a signed receipt.

**Args schema:**

```json
{
  "type": "object",
  "required": ["segment_definition_oid", "rollout_percentage", "rollout_seed"],
  "properties": {
    "segment_definition_oid": {
      "type": "string",
      "description": "OID of a gap:operator_document CDRO encoding the segment definition (cohort rules, tier filters, regional rules). Fetched at evaluation time if not cached."
    },
    "rollout_percentage": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "Percentage of actors in the cohort who receive the capability. Evaluated deterministically."
    },
    "rollout_seed": {
      "type": "string",
      "description": "Stable salt ensuring the same actor is always in the same bucket for this rollout. Rotate to re-randomize."
    },
    "not_before_ms": {
      "type": "integer",
      "description": "Earliest server time at which the rollout is active."
    },
    "not_after_ms": {
      "type": "integer",
      "description": "Latest server time at which the rollout is active. Composes with the shipped time_window precondition."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `live_ops_segment` MUST:

1. Verify current server time is within `[not_before_ms, not_after_ms]` if those fields are
   present. Deny with `outside_activation_window` if not.
2. Evaluate segment membership as:
   `sha256(actor_oid + ":" + rollout_seed)[0] % 100 < rollout_percentage`
   using the first byte of the hash as a uint8 value.
3. If the actor is not in the cohort, deny with `precondition_failed` and
   `precondition_kind: "live_ops_segment"`.

**Cache behavior:** 300 seconds per `(actor_oid, segment_definition_oid, rollout_seed)` tuple.
The `segment_definition_oid` itself is content-addressed, so a changed segment definition
produces a new OID and invalidates the cache naturally.

**Failure action:** `deny`.

---

## 4. CDRO Type Registry

### 4.1 `gaming:anti_cheat_assertion`

**Purpose:** Binds a third-party anti-cheat verdict to an actor OID at the moment of grant
issuance, producing a signed, content-addressed evidence record that survives appeals.

**Signing requirement:** MUST be signed by the gateway at issuance. The assertion body carries
both the external provider's own signature (over their native format) and the gateway's
re-signature over the canonical body below.

**Body schema:**

| Field                    | Type      | Required | Description                                                    |
|--------------------------|-----------|----------|----------------------------------------------------------------|
| `actor_oid`              | string    | yes      | OID of the actor being attested                                |
| `provider`               | string    | yes      | Attestation provider identifier (e.g. `battleye`, `eac`, `hyperion`) |
| `provider_version`       | string    | yes      | Provider agent version string at attestation time              |
| `client_build_hash`      | string    | yes      | `sha256:<hex>` of the game client binary at attestation time   |
| `boot_counter`           | integer   | yes      | Monotonic boot counter from the provider agent                 |
| `verdict`                | string    | yes      | `"clean"` or `"flagged"` or `"inconclusive"`                   |
| `verdict_code`           | string    | no       | Provider-specific code for the verdict (informative)           |
| `attested_at_ms`         | integer   | yes      | Server receive time of the attestation, milliseconds since epoch |
| `provider_signature`     | string    | yes      | Provider's own signature over their native attestation payload, base64url |
| `provider_signature_alg` | string    | yes      | Algorithm identifier for `provider_signature`                  |
| `grant_oid`              | string    | yes      | OID of the grant this assertion was issued alongside           |

**OID computation:** `sha256(canonical({actor_oid, provider, client_build_hash, boot_counter, verdict, attested_at_ms, grant_oid}))`. The `provider_signature` field is excluded from the gateway's canonical payload to avoid double-encoding.

**Chain requirements:** MUST reference `grant_oid`. When a ban is issued, the ban CDRO MUST reference the `anti_cheat_assertion` OID that triggered it (forming the evidence chain: assertion -> grant -> invocations -> ban).

---

### 4.2 `gaming:loot_table_commit`

**Purpose:** Commits to a loot table and the RNG draw result before revealing the outcome to
the player, enabling cryptographic proof that the result was not altered post-draw.

**Status:** DRAFT; the commit-reveal scheme requires a normative hash-then-reveal sequence.
Implementers MUST NOT claim regulatory compliance (Belgium, Netherlands, UK) based solely on
this CDRO without independent legal review.

**Signing requirement:** MUST be signed.

**Body schema:**

| Field              | Type      | Required | Description                                                         |
|--------------------|-----------|----------|---------------------------------------------------------------------|
| `actor_oid`        | string    | yes      | Player actor OID                                                    |
| `grant_oid`        | string    | yes      | Grant that authorized `game.economy.loot.open`                      |
| `loot_table_oid`   | string    | yes      | OID of the `gap:operator_document` CDRO encoding the loot table     |
| `draw_commitment`  | string    | yes      | `sha256(<nonce> + ":" + <outcome_index>)` committed before reveal   |
| `nonce`            | string    | yes      | Random nonce used in the commitment (revealed post-draw)            |
| `outcome_index`    | integer   | yes      | Index into the loot table that was drawn (revealed post-draw)       |
| `committed_at_ms`  | integer   | yes      | Milliseconds since epoch when commitment was issued                 |
| `revealed_at_ms`   | integer   | no       | Milliseconds since epoch when nonce and index were revealed         |

**Commit-reveal sequence (normative):**

1. Gateway issues the `gaming:loot_table_commit` CDRO with `nonce` and `outcome_index` set,
   but returns only `draw_commitment` to the client.
2. Client displays the draw animation.
3. Gateway reveals `nonce` and `outcome_index` via a second call, which the client can verify
   against `draw_commitment`.
4. The reveal is recorded as an update to the original CDRO (the OID of the commit is stable;
   the gateway records the reveal in its own store with a reference to the commit OID).

---

### 4.3 `gaming:economy_velocity_event`

**Purpose:** Records when an actor crosses an economy velocity threshold, producing a signed
event that can be used as evidence in a real-money trading (RMT) investigation or account
review.

**Status:** DRAFT; intended to compose with the shipped `aggregate_limit_group` mechanism.

**Signing requirement:** MUST be signed.

**Body schema:**

| Field                   | Type    | Required | Description                                          |
|-------------------------|---------|----------|------------------------------------------------------|
| `actor_oid`             | string  | yes      | Actor who crossed the threshold                      |
| `threshold_kind`        | string  | yes      | Which limit was crossed (e.g., `max_transactions_per_hour`) |
| `pool_id`               | string  | yes      | The `aggregate_limit_group` pool ID                  |
| `threshold_value`       | number  | yes      | The configured limit value                           |
| `observed_value`        | number  | yes      | The value at the time of the event                   |
| `window_start_ms`       | integer | yes      | Start of the rolling window                          |
| `window_end_ms`         | integer | yes      | End of the rolling window                            |
| `triggering_receipt_oid`| string  | yes      | OID of the invocation receipt that crossed the threshold |

---

## 5. Conformance Requirements

A gateway claiming `gap-gaming-00` profile support MUST:

1. Evaluate the `anti_cheat_clean` precondition kind per Section 3.1 for any capability in
   the `game.*` namespace where the precondition is present in the grant.
2. Evaluate the `live_ops_segment` precondition kind per Section 3.2.
3. Accept, validate, and store `gaming:anti_cheat_assertion` CDROs per Section 4.1.
4. Issue `gaming:loot_table_commit` CDROs on demand for `game.economy.loot.open` invocations
   when the operator has enabled commit-reveal mode (Section 4.2).

A gateway claiming `gap-gaming-00` profile support SHOULD:

5. Emit `gaming:economy_velocity_event` CDROs when an actor crosses an `aggregate_limit_group`
   threshold on a `game.economy.*` capability (Section 4.3).

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-gaming-00"]
}
```

### 5.1 Anti-cheat provider integration note

The gateway does not communicate directly with BattlEye, EAC, Hyperion, or other providers.
The provider agent runs on the player's client and delivers its signed assertion to the game
server, which forwards it to the gateway at grant issuance time. The gateway re-signs the
canonical body and stores the assertion CDRO. This keeps the provider's proprietary protocol
off the GAP trust path while producing a gateway-attested evidence record.

---

## 6. Informative Examples

### 6.1 Declaration with anti-cheat precondition on ranked play

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "player-a3f1",
  "actor_type": "human_user",
  "actor_name": "Player One",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "game.match.ranked.join",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "anti_cheat_clean",
          "args": {
            "max_assertion_age_ms": 3600000,
            "accepted_providers": ["battleye", "eac"]
          }
        }
      ]
    }
  ]
}
```

### 6.2 Grant with live-ops segment for seasonal event

```json
{
  "type": "gap:capability_grant",
  "declaration_oid": "sha256:b9c2...",
  "granted_capabilities": [
    {
      "name": "game.liveops.segment.activate",
      "scope_narrowing": {
        "event_id": "winter_2026"
      },
      "preconditions": [
        {
          "kind": "live_ops_segment",
          "args": {
            "segment_definition_oid": "sha256:d4e5...",
            "rollout_percentage": 10,
            "rollout_seed": "winter2026-early-access",
            "not_before_ms": 1767225600000,
            "not_after_ms": 1767484800000
          }
        }
      ]
    }
  ]
}
```

### 6.3 Anti-cheat assertion CDRO issued at grant time

```json
{
  "type": "gaming:anti_cheat_assertion",
  "actor_oid": "sha256:a3f1...",
  "provider": "battleye",
  "provider_version": "3.4.1",
  "client_build_hash": "sha256:77f3a1...",
  "boot_counter": 42,
  "verdict": "clean",
  "attested_at_ms": 1750000000000,
  "provider_signature": "MEYCIQDx...",
  "provider_signature_alg": "ES256",
  "grant_oid": "sha256:c8d9..."
}
```

### 6.4 Economy action receipt with velocity gate

A `game.economy.item.transfer` receipt where the transfer was allowed but a velocity event was
also emitted (the actor is approaching the hourly limit):

```json
{
  "oid": "sha256:<computed>",
  "type": "gap:decision_receipt",
  "gap_version": "1.0",
  "tenant_id": "my-tenant",
  "created_at_ms": 1750000000000,
  "created_by": "sha256:<gateway-actor-oid>",
  "body": {
    "subject_kind": "capability_invocation",
    "subject_oid": "sha256:e1f2...",
    "initiator": { "actor_oid": "sha256:a3f1...", "actor_type": "human_user" },
    "status": "ok",
    "initiated_at_ms": 1750000000000,
    "resolved_at_ms": 1750000000038
  }
}
```

Where `sha256:v3e1...` is the OID of the `gaming:economy_velocity_event` CDRO emitted alongside
the allow decision. Velocity events are linked in the operator's receipt store; they are not
embedded in the `gap:decision_receipt` body.

---

## Appendix: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                       | Class | Notes                                      |
|---------------------------------------|-------|--------------------------------------------|
| `game.tournament.result.certify`      | C     | Esports result certification               |
| `game.account.ban.dispute.open`       | B     | Player initiates ban dispute               |
| `game.economy.marketplace.list`       | C     | List item on marketplace                   |
| `game.economy.marketplace.delist`     | B     | Remove listing                             |
| `game.social.chat.moderation.mute`    | B     | Mute player in chat                        |
| `game.social.chat.moderation.ban`     | C     | Ban player from chat                       |
| `game.matchmaking.priority.adjust`    | C     | Adjust player matchmaking priority (staff) |
