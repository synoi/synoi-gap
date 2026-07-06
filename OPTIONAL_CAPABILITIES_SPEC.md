# Optional Capabilities Specification

This document specifies the behavior of `optional_effects` in GAP workflow
stage definitions. It is normative for L3 gateway implementors. The
`OptionalEffect` shape is defined in `src/workflows.ts`.

---

## Contents

1. [What optional_effects are](#1-what-optional_effects-are)
2. [Evaluation algorithm](#2-evaluation-algorithm)
3. [Security constraints](#3-security-constraints)
4. [Authoring guide](#4-authoring-guide)
5. [Conformance](#5-conformance)

---

## 1. What optional_effects are

An `optional_effect` is an ambient side action attached to a workflow stage.
It fires if the operator's environment has a matching, active, granted
capability. It is silently skipped if no such capability exists. The stage's
core outcome is not affected by whether any optional_effect fires, fails, or
is skipped.

The word "ambient" is intentional: optional_effects express environmental
enrichment, not required behavior. A door-unlock workflow that optionally dims
the lights is defined the same way whether or not the operator has smart
lighting. The workflow does not fail if lighting is absent. It does not error
if the lighting adapter is offline. The unlock proceeds regardless.

This is different from a stage `action`, which is part of the mandatory
choreography. If a required action fails, the stage transitions to
`on_action_failure`. If an optional_effect fails, the stage transitions
normally.

Optional_effects appear in the `WorkflowStage.optional_effects` array. Each
element is an `OptionalEffect` object:

```typescript
interface OptionalEffect {
  requires_capability: string   // dotted-taxonomy name or wildcard pattern
  action: StageAction           // channel action to invoke if matched
  label?: string                // optional label for audit logs and portal UI
}
```

A stage may have zero or more optional_effects. They are evaluated in array
order. Each is evaluated independently.

---

## 2. Evaluation algorithm

The following steps are normative. Implementations MUST follow them exactly.
Steps use MUST/MUST NOT per RFC 2119.

For each `OptionalEffect` in a stage's `optional_effects` array:

**Step 1: Resolve candidate declarations.**

The gateway MUST query `gap:capability_declaration` records in the current
tenant that satisfy all three conditions simultaneously:

- (a) Not revoked. A declaration is revoked if any `gap:revocation_event`
  targets its OID and that event has no superseding reinstatement.
- (b) Granted to this workflow's invoking actor. There MUST exist at least one
  active (not expired, not revoked) `gap:capability_grant` whose
  `grantee.actor_oid` matches the invoking actor's OID and whose
  `capability_scopes` covers the `requires_capability` value.
- (c) Visible per the operator's sharing policy. If the tenant has a sharing
  policy restricting capability visibility (for example, a policy that hides
  capabilities tagged `internal` from `service`-type actors), declarations that
  do not pass the policy filter MUST be excluded from candidates.

**Step 2: Match against `requires_capability`.**

The gateway MUST apply `capabilityMatches(requires_capability, candidate.body.capability_name)`
for each candidate declaration collected in Step 1. The matching rules are the
same rules used by `trigger.capability_pattern` matching throughout the
protocol (exact match or dotted-wildcard with `*` at any segment).

If zero candidate declarations match: skip this optional_effect silently.
Proceed to Step 5 with `status = 'denied'` for the receipt.

If one or more candidate declarations match: continue to Step 3.

**Step 3: Select the matching declaration.**

The gateway MUST select the single declaration with the earliest `created_at_ms`
among all matches that are not superseded. A declaration is superseded if
another declaration in the same tenant has a `supersedes` field pointing to its
OID. If all matches are superseded, use the most recent superseding declaration.

**Step 4: Invoke the action.**

The gateway MUST invoke the `action` specified in the `OptionalEffect` through
the named channel adapter, exactly as it would invoke a required stage action,
except:

- The invocation is best-effort. The gateway MUST NOT retry beyond the
  channel adapter's default single-attempt behavior unless the operator has
  configured explicit retry for optional_effects at the gateway level.
- Adapter errors, timeouts, and channel unavailability MUST NOT propagate to
  the stage's primary outcome. The stage transitions normally regardless.

**Step 5: Emit a receipt.**

The gateway MUST emit a `gap:decision_receipt` for every optional_effect
evaluation, including silent skips. The receipt MUST have:

- `subject_kind`: `'capability_invocation'`
- `status`:
  - `'ok'`: the action was invoked and the adapter confirmed delivery
  - `'denied'`: no matching, active, granted capability was found (skipped)
  - `'failed'`: a matching capability was found and the action was attempted
    but the adapter returned an error or timed out
- `detail`: a human-readable string explaining the outcome. For `'denied'`,
  MUST state that no matching grant was found (without naming which
  capabilities exist). For `'failed'`, MUST include the adapter error
  summary.
- `workflow_instance_oid`: the OID of the current workflow instance.
- `initiated_at_ms`: server-stamped timestamp when the optional_effect
  evaluation began.
- `resolved_at_ms`: server-stamped timestamp when the outcome was determined.

The receipt for a silent skip (status `'denied'`) MUST be emitted even though
no action was taken. This maintains a complete audit record of every
optional_effect evaluation for every stage execution.

**Step 6: Continue.**

Regardless of the outcome of this optional_effect, proceed to the next element
in `optional_effects`. After all optional_effects have been evaluated, continue
with the stage's normal transition logic.

---

## 3. Security constraints

### Grant scope enforcement

Optional_effect capability matching MUST be restricted to capabilities for
which the invoking actor has an active, non-revoked grant (Step 1b above). An
actor MUST NOT be able to trigger optional_effect evaluation for capabilities
it has no grant to invoke.

This constraint exists because optional_effect evaluation could otherwise be
used as a probe: an actor could define a workflow that enumerates which
capabilities exist in the environment by observing which optional_effects fire
and which are skipped.

### Topology enumeration oracle closure

The gateway MUST NOT reveal whether a capability exists in the tenant through
the optional_effect evaluation path. Specifically:

- The receipt for a skipped optional_effect MUST use `status = 'denied'` and
  MUST NOT distinguish between "capability exists but actor has no grant" and
  "capability does not exist at all." Both cases MUST produce identical receipt
  bodies from the actor's perspective.
- The receipt detail string MUST NOT name capabilities that exist in the
  environment but were not matched.
- The latency of the optional_effect evaluation MUST NOT leak information about
  whether a capability record exists (for example, a capability that exists but
  is ungrantable MUST NOT produce a measurably longer evaluation time than one
  that does not exist).

Implementations that store capabilities in a separate index from grants MUST
NOT short-circuit the grant check to return a faster "not found" response.
Always evaluate both conditions and return the same response shape.

### Receipt visibility

Optional_effect receipts are tenant-scoped CDROs. They are accessible via
`GET /v1/gap/receipts/:oid` and the receipts list endpoint with the same
access controls as all other receipts. The actor that triggered the workflow
instance MUST be able to retrieve these receipts.

---

## 4. Authoring guide

### When to use optional_effects vs required actions

Use a required stage `action` when the stage's purpose depends on the action
completing. Use an `optional_effect` when the action enriches the experience
but the workflow's goal is achieved regardless.

| Scenario | Use |
|---|---|
| Send approval SMS to operator | Required action (the stage cannot complete without it) |
| Dim lights when a door unlocks | Optional effect (the unlock succeeds whether or not lights dim) |
| Pulse haptic on mission complete | Optional effect (the workflow completes regardless) |
| Record invocation in audit ledger | Required action (audit completeness is not optional) |
| Play ambient audio during approval wait | Optional effect |
| Notify secondary approver on timeout | Required action on the escalation stage |

A common mistake is placing an action in `optional_effects` when a failure
would leave the system in an inconsistent state. If the action is load-bearing,
put it in `actions`.

### The `requires_capability` wildcard syntax

`requires_capability` uses the same dotted-taxonomy wildcard pattern as
`trigger.capability_pattern` and `capabilityMatches`. A `*` in any segment
matches any single segment value.

```
home.lighting.*       matches home.lighting.dim, home.lighting.on, home.lighting.off
home.*                matches home.lighting.dim, home.lock.engage, home.thermostat.set
*.lighting.dim        matches home.lighting.dim, commercial.lighting.dim
*                     matches any capability (use with caution)
home.lighting.dim     exact match only
```

Use the most specific pattern that covers the capabilities you want. Broad
wildcards may fire for capabilities the operator has granted for unrelated
purposes.

### Worked example: door-unlock with optional light dimming

This workflow triggers on `home.lock.disengage`, asks for SMS approval, and
optionally dims the lights when the unlock is approved.

```json
{
  "workflow_id": "front-door-unlock-with-ambiance",
  "workflow_name": "Front Door Unlock",
  "workflow_version": "1.0.0",
  "trigger": {
    "kind": "capability_invocation",
    "capability_pattern": "home.lock.disengage"
  },
  "required_channels": ["sms"],
  "max_total_duration_seconds": 120,
  "initial_stage_id": "ask",
  "stages": [
    {
      "stage_id": "ask",
      "duration_seconds": 60,
      "actions": [
        {
          "channel": "sms",
          "method": "send",
          "params": {
            "to": "{{operator_phone}}",
            "body": "Unlock front door for {{args.visitor_name}}? Reply YES or NO."
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
      "on_timeout": { "next_stage_id": "denied" }
    },
    {
      "stage_id": "approved",
      "terminal": true,
      "terminal_outcome": "approved",
      "optional_effects": [
        {
          "requires_capability": "home.lighting.*",
          "label": "dim entryway lights on unlock",
          "action": {
            "channel": "home_automation",
            "method": "invoke",
            "params": {
              "capability": "home.lighting.dim",
              "args": {
                "room": "entryway",
                "brightness_pct": 40
              }
            }
          }
        },
        {
          "requires_capability": "home.lighting.*",
          "label": "dim living room lights on unlock",
          "action": {
            "channel": "home_automation",
            "method": "invoke",
            "params": {
              "capability": "home.lighting.dim",
              "args": {
                "room": "living-room",
                "brightness_pct": 60
              }
            }
          }
        }
      ]
    },
    {
      "stage_id": "denied",
      "terminal": true,
      "terminal_outcome": "denied"
    }
  ]
}
```

When an operator who has `home.lighting.dim` granted fires this workflow and
approves, the gateway:

1. Transitions to the `approved` terminal stage.
2. Evaluates the first optional_effect: matches `home.lighting.dim` under
   `home.lighting.*`, finds an active grant, invokes the home automation
   channel, emits a receipt with `status = 'ok'`.
3. Evaluates the second optional_effect: same capability, same result.
4. Closes the workflow instance normally.

When an operator who does not have any `home.lighting.*` grant fires the same
workflow and approves, the gateway:

1. Transitions to the `approved` terminal stage.
2. Evaluates the first optional_effect: no matching grant found, emits a
   receipt with `status = 'denied'`.
3. Evaluates the second optional_effect: same result.
4. Closes the workflow instance normally.

In both cases, the door unlocks. The lights are a bonus.

---

## 5. Conformance

**L3 gateways** MUST implement `optional_effects` per this specification,
including the receipt requirement for every evaluation (Steps 1 through 5
above) and both security constraints in Section 3.

**L1 and L2 gateways** MUST silently skip all `optional_effects` arrays in
stage definitions without error. An L1/L2 gateway MUST NOT reject a workflow
definition that includes `optional_effects`. It MUST store the definition
without modification and execute stages without evaluating the
`optional_effects` array. It MUST NOT emit optional_effect receipts.

A workflow definition authored for an L3 gateway is forward-compatible: it
registers and runs on L1/L2 gateways with optional_effects silently suppressed.
The gateway tier determines whether ambient enrichment fires, not the workflow
definition itself.
