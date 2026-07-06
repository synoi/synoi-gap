# GAP Companion Profile: [Name]

**Draft:** gap-[slug]-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `[slug].*`
**Status:** Draft
**Authors:** [Your name / org]

---

## 1. Overview

[One paragraph: what this profile adds, who it is for, what existing tools or workflows it
replaces or complements.]

This profile composes freely with other profiles. The `[slug].*` namespace does not conflict
with any other registered profile namespace.

---

## 2. Capability Taxonomy

### 2.1 Safety class definitions for this profile

| Class | Definition in [sector] context |
|-------|-------------------------------|
| A     | [Read-only / non-mutating]     |
| B     | [Reversible mutations]         |
| C     | [Irreversible / high-stakes]   |

### 2.2 Capability names

| Capability name             | Class | require_signed_receipt | Notes |
|-----------------------------|-------|------------------------|-------|
| `[slug].[noun].[verb]`      | C     | true                   |       |
| `[slug].[noun].read`        | A     | false                  |       |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `[kind_name]`

**Evaluation timing:** `pre_invoke` | `post_invoke`

**Purpose:** [One sentence describing what this precondition gates and why.]

**Args schema:**

```json
{
  "type": "object",
  "required": ["[required_field]"],
  "properties": {
    "[required_field]": {
      "type": "[string|integer|boolean|array]",
      "description": "[What this field controls]"
    },
    "[optional_field]": {
      "type": "[type]",
      "description": "[What this field controls]"
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `[kind_name]` MUST:

1. [Step 1 of the evaluation algorithm]
2. [Step 2]
3. If [failure condition], deny with `precondition_failed` and
   `precondition_kind: "[kind_name]"` in the receipt.

**Cache behavior:** [N] seconds per `(actor_oid, capability_name, [key fields])`.

**Failure action:** `deny` | `hitl` | `provisional_block`

---

## 4. CDRO Type Registry

### 4.1 `[slug]:[type_name]`

**Purpose:** [One sentence describing what this object records and why.]

**Status:** Stable | Draft | Experimental

**Signing requirement:** MUST | SHOULD | MAY be signed.

**Body schema:**

| Field           | Type    | Required | Description                    |
|-----------------|---------|----------|--------------------------------|
| `actor_oid`     | string  | yes      | Actor this record concerns      |
| `grant_oid`     | string  | yes      | Grant that authorized the action|
| `[field]`       | [type]  | [yes/no] | [Description]                  |

**OID computation:** `sha256(canonical({[list of fields included in canonical payload]}))`.

**Chain requirements:** [None | MUST reference `[field]` of a `[prior_type]` CDRO.]

---

## 5. Conformance Requirements

A gateway claiming `gap-[slug]-00` profile support MUST:

1. Evaluate the `[kind_name]` precondition kind per Section 3.1.
2. Accept and validate `[slug]:[type_name]` CDRO bodies per Section 4.1.
3. Enforce `[slug].*` scope rules per Section 2.

A gateway claiming `gap-[slug]-00` profile support SHOULD:

4. [Optional but recommended behavior]

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-[slug]-00"]
}
```

---

## 6. Informative Examples

> **Legal `actor_type` values:** `skill` | `service` | `device` | `agent` | `mcp_server` | `gateway_subsystem` | `human_user`
> These are the only values accepted by the GAP validator. Do not use `ai_agent`, `human`, or any other value.

### 6.1 Declaration with [kind_name] precondition

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "[slug]-actor-identifier",
  "actor_type": "agent",
  "actor_name": "[Human-readable actor name]",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "[slug].[noun].[verb]",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "[kind_name]",
          "args": {
            "[required_field]": "[example_value]"
          }
        }
      ]
    }
  ]
}
```

### 6.2 [slug]:[type_name] CDRO

```json
{
  "oid": "sha256:<computed>",
  "type": "[slug]:[type_name]",
  "gap_version": "1.0",
  "tenant_id": "my-tenant",
  "created_at_ms": 1750000000000,
  "created_by": "sha256:<actor-oid>",
  "body": {
    "actor_oid": "sha256:...",
    "grant_oid": "sha256:...",
    "[field]": "[example_value]"
  }
}
```
