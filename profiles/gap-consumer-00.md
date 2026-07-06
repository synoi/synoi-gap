# GAP Companion Profile: Consumer and Household AI

**Draft:** gap-consumer-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `consumer.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol for AI agents operating in household and
personal environments: smart home assistants, family scheduling tools, household spending
agents, and parental oversight of AI interactions involving minor actors. It registers the
`consumer.*` capability namespace, three normative precondition kinds (`parental_approval`,
`spend_velocity`, `content_rating`), and three CDRO types for spending records, parental
approval events, and location disclosure records.

A household platform adopting this profile gets:

- Every spending action governed by a signed, content-addressed receipt, with a chained
  daily spending ledger that makes velocity checking verifiable rather than probabilistic
- Parental oversight delivered through any HITL channel (SMS, push, email, or overlay)
  without the protocol hard-coding a specific vendor or delivery mechanism
- Minor actor grants that are traceable to a specific guardian who accepted accountability,
  creating a verifiable chain from guardian identity to child capability
- Location disclosure events that prove consent existed and the disclosure happened, while
  keeping coordinates and address data entirely out of the CDRO body
- Content rating gates for media capabilities that operate as a no-op for adult actors
  and engage automatically for any actor identified as a minor

This profile introduces one normative actor subtype: the **minor actor** (Section 1.1). The
subtype does not require a new `actor_type` value in the core spec; it is identified by a
field in the grant body. Profiles governing health, enterprise identity, or financial services
can compose freely with this profile. The `consumer.*` namespace does not conflict with any
other registered profile namespace.

This profile is designed to support compliance with laws and regulations governing child
privacy and parental consent (such as COPPA in the United States and GDPR-K in the European
Union) in an informative sense only. Operators are responsible for independent legal review of
their compliance obligations. Nothing in this profile constitutes legal advice.

### 1.1 Minor actor subtype (normative)

A minor actor is any actor whose `CapabilityGrantBody` carries a non-null `guardian_oid`
field. The guardian named in that field MUST have a verified `identity_binding` at the time
the grant is issued. Gateways MUST refuse to issue a grant with `guardian_oid` set unless the
referenced guardian actor has a valid `identity_binding`.

The minor actor designation is inherited from the grant, not from the invocation. Once a grant
is issued with `guardian_oid` set, every invocation under that grant is treated as a minor
actor invocation for all `parental_approval` and `content_rating` precondition evaluations,
regardless of what the actor asserts about itself at invocation time.

This design creates a verifiable accountability chain: every minor actor's capability is
traceable to a specific guardian OID, which is traceable to a verified identity binding, which
produces a signed receipt at issuance time. An auditor or regulator can traverse the chain
entirely from content-addressed objects.

---

## 2. Capability Taxonomy

Capability names use the `consumer.` root. Sub-namespaces are open; operators may extend any
branch (e.g., `consumer.home.device.control.hvac.schedule`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for consumer/household context                                           |
|-------|-------------------------------------------------------------------------------------|
| A     | Read-only queries; no mutation of state, settings, or external systems              |
| B     | Reversible or low-stakes mutations; spending within configured daily limits; parental approval required when the invoking actor is a minor |
| C     | Irreversible or high-stakes actions; external communications; location disclosure; spending above limits or to new merchants; settings changes |

### 2.2 Core capability names

| Capability name                       | Class | require_signed_receipt | Notes                                                                 |
|---------------------------------------|-------|------------------------|-----------------------------------------------------------------------|
| `consumer.home.device.status.read`    | A     | false                  | Read smart home device status (lights, thermostat, locks, sensors)    |
| `consumer.home.media.read`            | A     | false                  | Read media library or viewing history                                 |
| `consumer.schedule.read`              | A     | false                  | Read household calendar or schedule entries                           |
| `consumer.home.device.control`        | B     | false                  | Control smart home devices (lights, thermostat, interior locks); excludes external door locks |
| `consumer.home.media.play`            | B     | false                  | Start media playback; subject to `content_rating` for minor actors    |
| `consumer.home.media.purchase`        | B     | false                  | Purchase media (in-app or subscription); requires parental approval if actor is a minor |
| `consumer.schedule.modify`            | B     | false                  | Create or modify household calendar entries                           |
| `consumer.spend.household`            | B     | false                  | Household spending up to the operator-configured daily limit; subject to `spend_velocity` |
| `consumer.spend.purchase`             | C     | true                   | Purchase above the configured limit or to a first-time merchant        |
| `consumer.home.lock.external`         | C     | true                   | Control external door lock; MUST always route to HITL                 |
| `consumer.location.share`             | C     | true                   | Share the actor's location with a third party                         |
| `consumer.contact.message`            | C     | true                   | Send a message to an external contact                                 |
| `consumer.account.settings.modify`    | C     | true                   | Modify account or subscription settings                               |
| `consumer.parental.control.modify`    | C     | true                   | Modify parental control settings; MUST require guardian `identity_binding` |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `parental_approval`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates class B and C capabilities when the invoking actor is a minor, by routing
the invocation to a guardian via a HITL approval request on a configured notification channel.

**Args schema:**

```json
{
  "type": "object",
  "required": ["require_for_classes", "notification_channels", "guardian_oids"],
  "properties": {
    "require_for_classes": {
      "type": "array",
      "items": { "type": "string", "enum": ["B", "C"] },
      "minItems": 1,
      "description": "Safety classes for which guardian approval is required when the invoking actor is a minor. Typically [\"B\", \"C\"] for full coverage or [\"C\"] for high-stakes-only coverage."
    },
    "notification_channels": {
      "type": "array",
      "items": { "type": "string", "enum": ["sms", "push", "email"] },
      "minItems": 1,
      "description": "Ordered list of HITL channel types the gateway will attempt, in order. The gateway's HITL channel adapter resolves the actual delivery mechanism for each type; no specific vendor is implied."
    },
    "auto_approve_after_ms": {
      "type": ["integer", "null"],
      "minimum": 1,
      "description": "If a non-null integer, the gateway MAY approve the invocation after this many milliseconds with no guardian response. If null, the gateway MUST deny on timeout. Null is the secure default."
    },
    "guardian_oids": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "OIDs of actors who may approve this invocation. Each listed actor MUST have a verified identity_binding. The gateway MUST validate identity_binding at evaluation time, not only at grant issuance."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `parental_approval` MUST:

1. Determine whether the invoking actor's grant was issued with a non-null `guardian_oid`.
   If `guardian_oid` is null or absent, this precondition evaluates to pass without further
   checks (the actor is not treated as a minor).
2. If the actor is a minor, determine the `safety_class` of the capability being invoked.
   If the safety class is not in `args.require_for_classes`, evaluate to pass.
3. Verify that each OID in `args.guardian_oids` has a valid `identity_binding` in the
   gateway's identity store. If any guardian OID is missing a valid `identity_binding`,
   deny with `guardian_identity_invalid`.
4. Dispatch a HITL approval request to all channels listed in `args.notification_channels`,
   targeting all actors listed in `args.guardian_oids`. The HITL request MUST include:
   - The capability name
   - A human-readable description of what the action will do
   - The spending amount in USD, if the capability is a `consumer.spend.*` capability
   - The minor actor's display name or a pseudonym consistent with the grant
5. Hold the invocation pending the first guardian response. If any guardian in
   `args.guardian_oids` approves, allow. If any guardian denies, deny and do not re-prompt
   remaining channels.
6. On timeout: if `args.auto_approve_after_ms` is non-null, MAY allow. If null, MUST deny
   with `parental_approval_timeout`.

When a guardian approves or denies, the gateway MUST produce a `consumer:parental_approval_event`
CDRO (Section 4.2) via the HITL channel adapter. This CDRO MUST NOT be produced by the minor
actor or the capability implementor.

**Channel-agnostic design note:** The protocol does not specify or imply any particular SMS
provider, push notification service, or email vendor. The `notification_channels` arg selects
channel types; the gateway's HITL channel adapter resolves the actual delivery mechanism. A
gateway operator may route "sms" through Twilio, MessageBird, or an in-house SMSC; the
protocol is indifferent. Changing the underlying delivery mechanism does not require amending
this profile or the grant.

**Gateway requirement:** MUST evaluate server-side. The minor actor MUST NOT be able to
self-certify that parental approval was obtained.

**Cache behavior:** No caching. Every invocation under a minor actor's grant MUST trigger a
fresh evaluation against the minor status and safety class. A prior approval for one
invocation does NOT carry over to a subsequent invocation of the same capability.

**Failure action:** `hitl` (for initial dispatch); `deny` on timeout when
`auto_approve_after_ms` is null.

**Minimum gateway tier:** L3. This precondition requires a HITL channel adapter.

---

### 3.2 `spend_velocity`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `consumer.spend.household` and `consumer.spend.purchase` against configured
daily and per-transaction spending limits, with optional merchant allowlist and guardian
escalation for large amounts.

**Args schema:**

```json
{
  "type": "object",
  "required": ["daily_limit_usd", "per_transaction_limit_usd"],
  "properties": {
    "daily_limit_usd": {
      "type": "number",
      "exclusiveMinimum": 0,
      "description": "Maximum total settled spending across all consumer.spend.* capabilities for this actor within the prior 24 hours. Computed in real time from chained consumer:spend_record CDROs."
    },
    "per_transaction_limit_usd": {
      "type": "number",
      "exclusiveMinimum": 0,
      "description": "Maximum amount for a single transaction. Evaluated before summing into the daily total."
    },
    "merchant_allowlist": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional list of permitted merchant_id values (operator-assigned identifiers). If this array is non-empty, any transaction whose merchant_id is not in the list is denied. If the array is empty or absent, all merchants are permitted."
    },
    "require_guardian_above_usd": {
      "type": "number",
      "exclusiveMinimum": 0,
      "description": "Optional. If present, any transaction at or above this amount is routed to HITL guardian approval regardless of whether the invoking actor is a minor. Applies to all actors."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `spend_velocity` MUST:

1. Retrieve the `amount_usd` field from the invocation args. If absent, deny with
   `spend_velocity_missing_amount`.
2. If `amount_usd > args.per_transaction_limit_usd`, deny with `spend_velocity_per_transaction`.
3. Retrieve the `merchant_id` field from the invocation args. If `args.merchant_allowlist` is
   non-empty and `merchant_id` is not in the list, deny with `spend_velocity_merchant_blocked`.
4. Sum the `amount_usd` values of all `consumer:spend_record` CDROs for this `actor_oid`
   where `transacted_at_ms` is within the prior 24 hours (relative to the current invocation
   time). Do NOT use cached totals; sum from the chain in real time.
5. If the sum of prior settled amounts plus the current `amount_usd` exceeds
   `args.daily_limit_usd`, deny with `spend_velocity_daily_limit`.
6. If `args.require_guardian_above_usd` is present and `amount_usd >= require_guardian_above_usd`,
   route to HITL regardless of whether the invoking actor is a minor. If the guardian
   approves, the invocation may proceed.

**Cache behavior:** None. The sum MUST be computed from the settled receipt chain in real
time. The chained structure of `consumer:spend_record` (Section 4.1) makes the prior-day
total reconstructable from a single traversal anchored at the current actor OID and date.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny` for limit and merchant violations; `hitl` when
`require_guardian_above_usd` triggers.

---

### 3.3 `content_rating`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `consumer.home.media.play` and `consumer.home.media.purchase` for minor
actors, by checking the content's rating against a configured maximum via a Policy Information
Point (PIP) endpoint.

**Args schema:**

```json
{
  "type": "object",
  "required": ["max_rating", "rating_system", "rating_db_endpoint"],
  "properties": {
    "max_rating": {
      "type": "string",
      "enum": ["G", "PG", "PG-13", "R", "NC-17", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"],
      "description": "The most permissive rating the minor actor may access. Ratings above this value in the ordering defined by the rating_system are denied."
    },
    "rating_system": {
      "type": "string",
      "enum": ["MPAA", "TV_Parental_Guidelines", "ESRB", "PEGI"],
      "description": "The rating system against which max_rating is interpreted. The ordering of values within each system is defined by the system's published specification."
    },
    "rating_db_endpoint": {
      "type": "string",
      "format": "uri",
      "description": "PIP endpoint the gateway calls with content_id to retrieve the current rating. The gateway passes content_id from the invocation args; the endpoint returns a rating and rating_system."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `content_rating` MUST:

1. Determine whether the invoking actor's grant was issued with a non-null `guardian_oid`.
   If the actor is not a minor, this precondition is a no-op: evaluate to pass without
   calling the PIP endpoint.
2. For a minor actor: retrieve `content_id` from the invocation args. If absent, deny with
   `content_rating_missing_content_id`.
3. Call `args.rating_db_endpoint` with `content_id` and `args.rating_system`. If the endpoint
   returns an error or is unreachable, deny with `content_rating_pip_unavailable`. The gateway
   MUST NOT allow playback to proceed when the rating cannot be confirmed.
4. Compare the returned rating to `args.max_rating` using the ordinal ordering of the
   specified rating system. If the returned rating exceeds `max_rating`, deny with
   `content_rating_exceeded`.

**Cache behavior:** 3600 seconds per `(content_id, rating_system)` tuple. The cache key does
not include `actor_oid` because a content item's rating is not actor-specific. A cached pass
for a given `(content_id, rating_system)` pair is valid for 3600 seconds regardless of which
minor actor invokes.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny`.

---

## 4. CDRO Type Registry

### 4.1 `consumer:spend_record`

**Purpose:** Records a single spending transaction, forming a content-addressed chain that
enables real-time velocity checking without a mutable ledger.

**Status:** Stable

**Signing requirement:** MUST be signed at L2 or above.

**Body schema:**

| Field                    | Type    | Required | Description                                                                              |
|--------------------------|---------|----------|------------------------------------------------------------------------------------------|
| `actor_oid`              | string  | yes      | OID of the actor who made the purchase                                                   |
| `grant_oid`              | string  | yes      | OID of the grant that authorized the spending capability                                  |
| `guardian_oid`           | string  | no       | OID of the guardian actor, if the invoking actor is a minor or if guardian approval was obtained via `require_guardian_above_usd`; null otherwise |
| `capability_name`        | string  | yes      | Full capability name (e.g., `consumer.spend.household`)                                   |
| `merchant_id_hash`       | string  | yes      | `HMAC-SHA256(key=(tenant_id + "merchant"), data=merchant_id)`; the raw merchant name MUST NOT appear in this field or anywhere in the CDRO body |
| `amount_usd`             | number  | yes      | Transaction amount in USD                                                                |
| `currency`               | string  | yes      | ISO 4217 currency code of the original transaction (e.g., `USD`, `EUR`)                  |
| `category`               | string  | yes      | One of: `media`, `retail`, `food`, `subscription`, `other`                               |
| `guardian_approved`      | boolean | yes      | True if a guardian explicitly approved this transaction via HITL; false otherwise         |
| `approval_receipt_oid`   | string  | no       | OID of the `consumer:parental_approval_event` CDRO if `guardian_approved` is true; null otherwise |
| `transacted_at_ms`       | integer | yes      | Milliseconds since epoch when the transaction was authorized                              |
| `prior_daily_record_oid` | string  | no       | OID of the most recent prior `consumer:spend_record` for this `actor_oid` within the same calendar day (UTC); null for the first transaction of the day |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, guardian_oid, capability_name, merchant_id_hash, amount_usd, currency, category, guardian_approved, approval_receipt_oid, transacted_at_ms, prior_daily_record_oid}))`.

**Chain requirements:** MUST reference `prior_daily_record_oid` when a prior same-day record
exists. This forms a per-actor, per-day linked list. A velocity checker walks the chain from
the current record backward until a record outside the 24-hour window is found, summing
`amount_usd` values. A null `prior_daily_record_oid` terminates the walk.

**Privacy constraint:** MUST NOT store raw merchant names, item descriptions, or any
free-text purchase description in the body. The `merchant_id_hash` field HMAC-masks the
merchant identifier so a leak of the CDRO body does not directly expose merchant identity.
The HMAC key (tenant_id + "merchant") is known to the tenant and gateway, enabling internal
lookups, but is not derivable by a third party who obtains only the CDRO.

---

### 4.2 `consumer:parental_approval_event`

**Purpose:** Records a guardian's decision on a HITL approval request, producing a signed,
content-addressed object that can be referenced by a spend record or receipt as evidence of
informed consent.

**Status:** Stable

**Signing requirement:** MUST be signed.

**Body schema:**

| Field                      | Type    | Required | Description                                                                                   |
|----------------------------|---------|----------|-----------------------------------------------------------------------------------------------|
| `guardian_oid`             | string  | yes      | OID of the guardian actor who responded; MUST have a verified `identity_binding`               |
| `minor_actor_oid`          | string  | yes      | OID of the minor actor whose invocation triggered this request                                 |
| `capability_name`          | string  | yes      | Full capability name for which approval was requested                                          |
| `decision`                 | string  | yes      | One of: `approved`, `denied`                                                                   |
| `channel_used`             | string  | yes      | One of: `sms`, `push`, `email`                                                                 |
| `decision_at_ms`           | integer | yes      | Milliseconds since epoch when the guardian responded                                           |
| `request_id`               | string  | yes      | UUID of the HITL workflow instance; correlates the approval event to the pending invocation    |
| `action_description_hash`  | string  | yes      | `sha256` of the human-readable action description that was shown to the guardian; ensures the guardian saw the same description that was used to obtain consent |

**OID computation:** `sha256(canonical({guardian_oid, minor_actor_oid, capability_name, decision, channel_used, decision_at_ms, request_id, action_description_hash}))`.

**Chain requirements:** None. This CDRO is referenced by `consumer:spend_record.approval_receipt_oid`
and MAY be referenced in `gap:decision_receipt.evidence_oids` for any capability that required
guardian approval.

**Authorship constraint:** This CDRO MUST be produced by the HITL channel adapter within the
gateway, not by the minor actor, the capability implementor, or any client-side component. A
`consumer:parental_approval_event` produced outside the gateway's HITL adapter MUST be
rejected.

---

### 4.3 `consumer:location_disclosure_record`

**Purpose:** Records that an actor's location was shared with a third party, under a named
consent record, without storing any location data in the CDRO body.

**Status:** Stable

**Signing requirement:** MUST be signed at L2 or above.

**Body schema:**

| Field                  | Type    | Required | Description                                                                                       |
|------------------------|---------|----------|---------------------------------------------------------------------------------------------------|
| `actor_oid`            | string  | yes      | OID of the actor whose location was shared                                                        |
| `grant_oid`            | string  | yes      | OID of the grant that authorized `consumer.location.share`                                        |
| `recipient_id_hash`    | string  | yes      | `HMAC-SHA256(key=tenant_id, data=recipient_identifier)`; the raw recipient identifier MUST NOT appear in the CDRO body |
| `location_precision`   | string  | yes      | One of: `exact`, `neighborhood`, `city`; indicates the precision of data shared, not the data itself |
| `disclosure_purpose`   | string  | yes      | One of: `emergency`, `family_check_in`, `delivery`, `service_provider`, `other`                   |
| `consent_record_oid`   | string  | yes      | OID of the `gap:consent_record` CDRO that authorizes this disclosure; MUST be present and valid   |
| `disclosed_at_ms`      | integer | yes      | Milliseconds since epoch when the location data was transmitted                                   |
| `expires_at_ms`        | integer | yes      | Milliseconds since epoch after which the disclosure is considered expired; the gateway MUST NOT transmit further location updates under the same record after this time |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, recipient_id_hash, location_precision, disclosure_purpose, consent_record_oid, disclosed_at_ms, expires_at_ms}))`.

**Chain requirements:** MUST reference `consent_record_oid`. A disclosure record without a
valid referenced `gap:consent_record` MUST be rejected at validation time.

**Privacy constraint:** MUST NOT store coordinates, address, postal code, or any geospatial
information in the CDRO body. The CDRO proves that a disclosure happened, at what precision,
for what purpose, and under what consent. The actual location data travels out-of-band via the
capability implementation. A party who obtains only the CDRO body cannot reconstruct where the
actor was.

---

## 5. Conformance Requirements

A gateway claiming `gap-consumer-00` profile support MUST:

1. Identify minor actors by the presence of a non-null `guardian_oid` in the
   `CapabilityGrantBody`, and apply minor actor status to all `parental_approval` and
   `content_rating` precondition evaluations for that grant (Section 1.1).
2. Refuse to issue a grant with `guardian_oid` set unless the referenced guardian actor has a
   verified `identity_binding` at issuance time.
3. Evaluate the `parental_approval` precondition kind per Section 3.1 for any `consumer.*`
   capability where the precondition is present in the grant, when the invoking actor is a
   minor.
4. Evaluate the `spend_velocity` precondition kind per Section 3.2 for `consumer.spend.*`
   capabilities, counting from the settled `consumer:spend_record` chain in real time.
5. Evaluate the `content_rating` precondition kind per Section 3.3 for
   `consumer.home.media.play` and `consumer.home.media.purchase`, applying the no-op rule for
   non-minor actors.
6. Issue `consumer:spend_record` CDROs at L2 or above per Section 4.1 for every settled
   `consumer.spend.*` invocation, chaining `prior_daily_record_oid` correctly.
7. Issue `consumer:parental_approval_event` CDROs via the HITL channel adapter (not the
   client) per Section 4.2 for every guardian decision.
8. Issue `consumer:location_disclosure_record` CDROs at L2 or above per Section 4.3 for
   every `consumer.location.share` invocation, with a valid `consent_record_oid` reference.
9. Route `consumer.home.lock.external` to HITL on every invocation, regardless of actor type.
10. Require that `consumer.parental.control.modify` invocations are authorized by an actor
    with a verified `identity_binding`, and deny invocations that cannot satisfy this
    requirement.

A gateway claiming `gap-consumer-00` profile support SHOULD:

11. Emit `consumer:spend_record` CDROs in `gap:decision_receipt.evidence_oids` for `consumer.spend.*`
    receipts, so that an auditor traversing the receipt chain encounters the spend record
    without a separate lookup.
12. Include the `consumer:parental_approval_event` OID in `gap:decision_receipt.evidence_oids` for any
    invocation that required and received guardian approval.

### 5.1 Tier requirements

| Capability or precondition                    | Minimum tier |
|-----------------------------------------------|--------------|
| All `consumer.*` capabilities                 | L2           |
| `parental_approval` precondition              | L3           |
| `consumer.home.lock.external`                 | L3           |
| `consumer.location.share`                     | L3           |
| `consumer.contact.message`                    | L3           |
| `consumer.parental.control.modify`            | L4           |

L3 is required for any capability gated by `parental_approval` because the precondition
requires a functioning HITL channel adapter. L4 is required for
`consumer.parental.control.modify` because modifications to parental controls may affect
grants issued by other tenants (cross-tenant receipt verification is required to confirm that
existing minor actor grants are not silently invalidated).

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L3",
  "profiles": ["gap-consumer-00"]
}
```

---

## 6. Informative Examples

### 6.1 Grant for a minor actor with parental approval on class B and C capabilities

```json
{
  "type": "gap:capability_grant",
  "declaration_oid": "sha256:a1b2...",
  "guardian_oid": "sha256:c3d4...",
  "granted_capabilities": [
    {
      "name": "consumer.home.media.play",
      "safety_class": "B",
      "preconditions": [
        {
          "kind": "parental_approval",
          "args": {
            "require_for_classes": ["B", "C"],
            "notification_channels": ["push", "sms"],
            "auto_approve_after_ms": null,
            "guardian_oids": ["sha256:c3d4..."]
          }
        },
        {
          "kind": "content_rating",
          "args": {
            "max_rating": "PG",
            "rating_system": "MPAA",
            "rating_db_endpoint": "https://pip.example.internal/ratings"
          }
        }
      ]
    },
    {
      "name": "consumer.spend.household",
      "safety_class": "B",
      "preconditions": [
        {
          "kind": "parental_approval",
          "args": {
            "require_for_classes": ["B", "C"],
            "notification_channels": ["push", "sms"],
            "auto_approve_after_ms": null,
            "guardian_oids": ["sha256:c3d4..."]
          }
        },
        {
          "kind": "spend_velocity",
          "args": {
            "daily_limit_usd": 20.00,
            "per_transaction_limit_usd": 10.00,
            "merchant_allowlist": ["merchant_approved_001", "merchant_approved_002"]
          }
        }
      ]
    }
  ]
}
```

### 6.2 Parental approval event CDRO (guardian approved via push)

```json
{
  "type": "consumer:parental_approval_event",
  "guardian_oid": "sha256:c3d4...",
  "minor_actor_oid": "sha256:e5f6...",
  "capability_name": "consumer.spend.household",
  "decision": "approved",
  "channel_used": "push",
  "decision_at_ms": 1750000123000,
  "request_id": "7f3a1b22-4e5d-4f00-a0c1-123456789abc",
  "action_description_hash": "sha256:9a1b2c..."
}
```

### 6.3 Spend record CDRO chained to a prior daily transaction

```json
{
  "type": "consumer:spend_record",
  "actor_oid": "sha256:e5f6...",
  "grant_oid": "sha256:g7h8...",
  "guardian_oid": "sha256:c3d4...",
  "capability_name": "consumer.spend.household",
  "merchant_id_hash": "hmac-sha256:3f9a2c...",
  "amount_usd": 7.99,
  "currency": "USD",
  "category": "food",
  "guardian_approved": true,
  "approval_receipt_oid": "sha256:i9j0...",
  "transacted_at_ms": 1750000125000,
  "prior_daily_record_oid": "sha256:k1l2..."
}
```

### 6.4 Declaration for an adult actor with spend velocity and no parental controls

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "household-ai-agent-m3n4",
  "actor_type": "agent",
  "actor_name": "Household Assistant Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "consumer.spend.household",
      "safety_class": "B",
      "require_signed_receipt": false,
      "preconditions": [
        {
          "kind": "spend_velocity",
          "args": {
            "daily_limit_usd": 150.00,
            "per_transaction_limit_usd": 75.00,
            "require_guardian_above_usd": 100.00
          }
        }
      ]
    },
    {
      "capability": "consumer.home.device.control",
      "safety_class": "B",
      "require_signed_receipt": false
    },
    {
      "capability": "consumer.home.lock.external",
      "safety_class": "C",
      "require_signed_receipt": true
    }
  ]
}
```

### 6.5 Location disclosure record CDRO

```json
{
  "type": "consumer:location_disclosure_record",
  "actor_oid": "sha256:m3n4...",
  "grant_oid": "sha256:o5p6...",
  "recipient_id_hash": "hmac-sha256:7d2e1f...",
  "location_precision": "neighborhood",
  "disclosure_purpose": "family_check_in",
  "consent_record_oid": "sha256:q7r8...",
  "disclosed_at_ms": 1750001000000,
  "expires_at_ms": 1750087400000
}
```

### 6.6 Receipt referencing parental approval and spend evidence

```json
{
  "oid": "sha256:<computed>",
  "type": "gap:decision_receipt",
  "gap_version": "1.0",
  "tenant_id": "my-tenant",
  "created_at_ms": 1750000125000,
  "created_by": "sha256:<gateway-actor-oid>",
  "body": {
    "subject_kind": "capability_invocation",
    "subject_oid": "sha256:s9t0...",
    "initiator": { "actor_oid": "sha256:e5f6...", "actor_type": "agent" },
    "status": "ok",
    "initiated_at_ms": 1750000125000,
    "resolved_at_ms": 1750000125042,
    "capability_grant_oids": [
      "sha256:i9j0...",
      "sha256:i9j1..."
    ]
  }
}
```

Where `sha256:i9j0...` is the OID of the `consumer:parental_approval_event` CDRO and
`sha256:i9j1...` is the OID of the `consumer:spend_record` CDRO emitted alongside the allow
decision. These evidence references are carried in `capability_grant_oids` or as linked objects
in the operator's receipt store; the CDRO body above records the governed decision.

---

## Appendix: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                              | Class | Notes                                                              |
|----------------------------------------------|-------|--------------------------------------------------------------------|
| `consumer.home.device.automation.create`     | B     | Create a home automation routine                                   |
| `consumer.home.device.automation.delete`     | C     | Delete or disable a home automation routine                        |
| `consumer.home.energy.report.read`           | A     | Read household energy usage reports                                |
| `consumer.home.security.camera.read`         | B     | View security camera feed (live or recorded)                       |
| `consumer.vehicle.status.read`               | A     | Read connected vehicle status (charge level, location locked)      |
| `consumer.vehicle.control`                   | C     | Remote vehicle commands (climate, lock, charge start)              |
| `consumer.health.device.read`                | A     | Read from a connected health device (scale, glucose monitor)       |
| `consumer.schedule.share`                    | C     | Share a household calendar entry with a third party                |
| `consumer.home.media.download`               | C     | Download media for offline playback                                |
| `consumer.spend.recurring.modify`            | C     | Modify or cancel a recurring subscription charge                   |
