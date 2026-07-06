# GAP Companion Profile: AI/ML Platforms and Agent Orchestration

**Draft:** gap-ai-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `ai.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol (GAP) for AI/ML platforms, inference APIs,
agent orchestration frameworks, model registries, and fine-tuning pipelines. It registers the
`ai.*` capability namespace, three normative precondition kinds (`model_policy`,
`output_consent`, `safety_eval_gate`), and three CDRO types for per-invocation inference
records, safety evaluation results, and data-use consent records.

An AI platform operator adopting this profile gets:

- Every inference call, agent spawn, and model deployment governed by a signed, immutable
  receipt chain, displacing bespoke logging sidecars and mutable audit tables that cannot
  prove after-the-fact what model was invoked, under which consent, or by which agent hop.
- Model allowlists and content-filter requirements enforced as a first-class grant precondition,
  not as application-layer guard-rails that can be bypassed by a misconfigured client.
- Data-use consent bound cryptographically to every inference invocation, producing the
  provenance trail needed to support audit obligations under regulatory frameworks such as the
  EU AI Act and aligned with the risk-management categories in NIST AI RMF. (This profile is
  designed to support those audit obligations; it does not constitute legal compliance
  certification, which requires independent review.)
- Safety evaluation results committed as signed CDROs that gates like `ai.model.deploy` can
  verify, replacing the informal "we ran evals" claim with a content-addressed evidence object
  whose age and scope the gateway checks automatically.
- Multi-hop agent governance: every agent spawned via `ai.agent.spawn` carries the parent
  grant OID in the core delegation chain, making the full orchestration lineage replayable
  without relying on application-layer logging.

**Status note:** All capability names, precondition kinds, and CDRO types in this profile carry
status [DESIGN]. No conformance vectors exist yet against a deployed implementation. The
wire formats and object model follow the shipped GAP core spec. Implementors MUST NOT claim
production conformance until a conformance test suite exists for this profile.

This profile composes freely with other profiles. A platform engineering team can activate
`gap-ai-00` and `gap-supply-chain-00` simultaneously; the namespaces do not conflict. The
`ai.*` namespace has no overlap with any core-spec reserved namespace.

---

## 2. Capability Taxonomy

Capability names use the `ai.` root. Sub-namespaces are open; operators may extend any
branch (e.g., `ai.inference.text.streaming`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for AI/ML context                                                                       |
|-------|----------------------------------------------------------------------------------------------------|
| A     | Read-only queries (model enumeration, model card read, capability metadata)                        |
| B     | Inference and reversible agent lifecycle actions (text/embed/image/code generation, agent spawn/terminate) |
| C     | Irreversible or high-stakes model lifecycle operations (fine-tune, deploy, weight export, adversarial evaluation, training data access, fleet spawn) |

### 2.2 Core capability names

| Capability name                   | Class | require_signed_receipt | Notes                                                               |
|-----------------------------------|-------|------------------------|---------------------------------------------------------------------|
| `ai.model.list`                   | A     | false                  | Enumerate available models and providers                            |
| `ai.model.metadata.read`          | A     | false                  | Read model card, capability spec, or provider documentation         |
| `ai.inference.text`               | B     | false                  | Standard text completion or chat inference                          |
| `ai.inference.embed`              | B     | false                  | Embed text into a vector representation                             |
| `ai.inference.image.generate`     | B     | false                  | Text-to-image generation                                            |
| `ai.inference.code.generate`      | B     | false                  | Code generation or completion                                       |
| `ai.agent.spawn`                  | B     | false                  | Spawn a child agent; subject to core delegation chain (see Section 5.1) |
| `ai.agent.terminate`              | B     | false                  | Terminate a running agent and release its resources                 |
| `ai.model.finetune.start`         | C     | true                   | Initiate a fine-tuning run against a base model                     |
| `ai.model.deploy`                 | C     | true                   | Deploy a model version to a production or staging endpoint          |
| `ai.model.weights.export`         | C     | true                   | Export model weights to an external destination                     |
| `ai.training.data.access`         | C     | true                   | Access raw training data (see Section 5.2 for rationale)            |
| `ai.evaluation.adversarial.run`   | C     | true                   | Execute an adversarial evaluation suite against a model             |
| `ai.agent.fleet.spawn`            | C     | true                   | Spawn N agents in parallel (see Section 5.1 for delegation limit)   |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `model_policy`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates inference capabilities on the requested model matching an operator-defined
allowlist, and optionally enforces content-filter availability before the grant is issued.

**Args schema:**

```json
{
  "type": "object",
  "required": ["allowed_models"],
  "properties": {
    "allowed_models": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "Allowlist of model_id strings or glob patterns (e.g. [\"claude-*\", \"gpt-4o\"]). The gateway matches the model_id in the invocation args against this list using glob semantics."
    },
    "blocked_models": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional blocklist. If present, a model matching any entry is denied even if it also matches allowed_models. Blocked list takes precedence."
    },
    "max_context_tokens": {
      "type": "integer",
      "minimum": 1,
      "description": "Optional upper bound on the combined input + output token count the gateway will allow in a single invocation. Enforcement uses the model provider's reported token count."
    },
    "require_content_filter": {
      "type": "boolean",
      "default": false,
      "description": "If true, the gateway MUST confirm that the selected model endpoint has content filtering active before issuing the grant. How the gateway verifies this is implementation-defined (provider capability metadata, admin configuration, or a preflight probe)."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `model_policy` MUST:

1. Extract the `model_id` from the invocation args.
2. If `args.blocked_models` is present, test `model_id` against each entry using glob
   semantics. If any entry matches, deny with `precondition_failed`,
   `precondition_kind: "model_policy"`, and `detail: "model_policy_violation"` in the receipt.
3. Test `model_id` against each entry in `args.allowed_models` using glob semantics. If no
   entry matches, deny with `precondition_failed`, `precondition_kind: "model_policy"`, and
   `detail: "model_policy_violation"` in the receipt.
4. If `args.max_context_tokens` is set, verify the invocation's reported token count does not
   exceed the limit. If it does, deny with `detail: "context_limit_exceeded"`.
5. If `args.require_content_filter` is true, verify that the model endpoint reports content
   filtering as active. If it cannot be confirmed, deny with
   `detail: "content_filter_unavailable"`.

**Cache behavior:** Per grant evaluation. Model lists are fetched at grant issuance and do not
require per-invocation re-fetch. If the operator changes the model allowlist, the affected
grants must be re-issued to pick up the new policy.

**Failure action:** `deny`.

---

### 3.2 `output_consent`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates capabilities that produce content which may be stored, reproduced, or used
to train further models, by verifying that the actor has an active consent record covering
the requested data uses and, if required, that the inference endpoint is in the declared data
residency region.

**Args schema:**

```json
{
  "type": "object",
  "required": ["permitted_uses"],
  "properties": {
    "permitted_uses": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["inference_only", "cache", "training", "analytics"]
      },
      "minItems": 1,
      "description": "Data use categories the operator requires consent for. All listed values must be covered by the actor's ai:consent_record. \"inference_only\" = ephemeral processing only, no persistence. \"cache\" = response may be cached. \"training\" = output may be used in further model training. \"analytics\" = output may be included in aggregate analytics."
    },
    "data_residency": {
      "type": "string",
      "description": "ISO 3166-1 alpha-2 country code (e.g. \"US\", \"DE\") or the string \"any\". If set to a country code, the gateway MUST verify the inference endpoint is in that country before routing. \"any\" imposes no geographic constraint."
    },
    "retention_days": {
      "type": "integer",
      "minimum": 0,
      "description": "Maximum number of days the output may be retained by the platform. 0 = no retention (inference_only). Must be consistent with the permitted_uses values."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `output_consent` MUST:

1. Retrieve the most recent `ai:consent_record` CDRO for the invoking actor OID in the tenant
   store. If none exists, deny with `precondition_failed`,
   `precondition_kind: "output_consent"`, and `detail: "no_consent_record"`.
2. Verify the `ai:consent_record` is signed and has not expired (`expires_at_ms` is null or
   greater than the current server time).
3. For each value in `args.permitted_uses`, verify that the same value appears in
   `consent_record.permitted_uses`. If any value is missing, deny with
   `detail: "consent_gap"` and include the list of missing uses in the receipt detail.
4. If `args.data_residency` is set to a country code, verify that the selected inference
   endpoint is located in the declared country. If it cannot be confirmed, deny with
   `detail: "residency_unverifiable"`.
5. If `args.retention_days` is set, verify it does not exceed `consent_record.retention_days`.
   If it does, deny with `detail: "retention_exceeds_consent"`.

**Cache behavior:** Invalidated whenever a new `ai:consent_record` supersedes the prior record
(detected by the `prior_consent_oid` chain or by `consented_at_ms` comparison). Between
invalidations, the pass result may be cached for 300 seconds per
`(actor_oid, permitted_uses, data_residency)`.

**Failure action:** `deny`.

---

### 3.3 `safety_eval_gate`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `ai.model.deploy` and `ai.evaluation.adversarial.run` on the existence of
a recent, signed safety evaluation result covering all required evaluation suites and meeting
minimum pass scores for each.

**Args schema:**

```json
{
  "type": "object",
  "required": ["required_eval_suites", "min_pass_score"],
  "properties": {
    "required_eval_suites": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "List of eval suite IDs that must each have a passing ai:safety_eval_result CDRO for the target model_id. Examples: \"HELM-v1.0\", \"MMLU-2024\", \"custom:red-team-v3\"."
    },
    "min_pass_score": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "Minimum overall_score (0-100) required for each suite in required_eval_suites. A single threshold applies to all suites; operators requiring per-suite thresholds should issue multiple grants with separate safety_eval_gate preconditions."
    },
    "max_eval_age_ms": {
      "type": "integer",
      "minimum": 0,
      "default": 604800000,
      "description": "Maximum age of an acceptable ai:safety_eval_result, measured from evaluated_at_ms to server receive time. Default is 604800000 ms (7 days). Set to 0 to require a result issued within this invocation's grant window."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `safety_eval_gate` MUST:

1. Extract `model_id` and `model_version_hash` from the invocation args.
2. For each suite ID in `args.required_eval_suites`, locate the most recent signed
   `ai:safety_eval_result` CDRO where `result.model_id == model_id`,
   `result.model_version_hash == model_version_hash`, and
   `result.eval_suite_id == suite_id`.
3. If any required suite has no matching result, deny with `precondition_failed`,
   `precondition_kind: "safety_eval_gate"`, and `detail: {"missing_evals": [...suite_ids]}`.
4. For each matched result, verify the result is signed by a recognized evaluator actor OID.
5. For each matched result, verify
   `(server_receive_time_ms - result.evaluated_at_ms) <= args.max_eval_age_ms`. If any result
   is too old, deny with `detail: {"stale_evals": [...suite_ids]}`.
6. For each matched result, verify `result.overall_score >= args.min_pass_score`. If any
   result is below threshold, deny with `detail: {"failing_evals": [...suite_ids]}`.
7. If all checks pass, allow.

**Cache behavior:** 3600 seconds per `(model_id, model_version_hash, eval_suite_set)`. The
eval_suite_set is the sorted, concatenated list of required suite IDs, forming a stable cache
key. A model version change or a new eval result invalidates the cache naturally via the OID.

**Failure action:** `deny`.

---

## 4. CDRO Type Registry

### 4.1 `ai:inference_record`

**Purpose:** Records a single inference invocation (the model used, token counts, latency,
whether content filtering triggered, and a hash of the output) without storing the raw
response text in the CDRO body.

**Status:** Stable

**Signing requirement:** SHOULD be signed at L2 or higher. Operators requiring full audit chains
for regulatory purposes (e.g., EU AI Act high-risk system logging) SHOULD require signing at L3.

**Body schema:**

| Field                      | Type    | Required | Description                                                                       |
|----------------------------|---------|----------|-----------------------------------------------------------------------------------|
| `actor_oid`                | string  | yes      | OID of the actor that invoked the inference capability                            |
| `grant_oid`                | string  | yes      | OID of the grant that authorized this invocation                                  |
| `model_id`                 | string  | yes      | Model identifier as provided by the inference endpoint (e.g. `claude-3-7-sonnet-20250219`) |
| `model_provider`           | string  | yes      | Provider identifier (e.g. `anthropic`, `openai`, `self-hosted`)                   |
| `input_token_count`        | integer | yes      | Number of input tokens as reported by the model provider                          |
| `output_token_count`       | integer | yes      | Number of output tokens as reported by the model provider                         |
| `cost_usd`                 | number  | no       | Estimated cost in USD at time of invocation; informative only                     |
| `latency_ms`               | integer | yes      | Wall-clock latency from invocation to first response byte, in milliseconds        |
| `content_filter_triggered` | boolean | yes      | Whether the model endpoint's content filter triggered on this invocation          |
| `content_filter_categories`| array   | no       | Category labels returned by the content filter; present only if triggered         |
| `output_hash`              | string  | yes      | `sha256:<hex>` of the canonical UTF-8 response text. Records what was generated without storing the content. |
| `invoked_at_ms`            | integer | yes      | Server time at invocation start, milliseconds since Unix epoch                    |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, model_id, model_provider, input_token_count, output_token_count, latency_ms, content_filter_triggered, output_hash, invoked_at_ms}))`.

The `cost_usd` and `content_filter_categories` fields are excluded from the canonical payload
because they are informative and may be computed or populated asynchronously.

**Chain requirements:** MUST reference `grant_oid`. When an `ai:consent_record` governs the
invocation, the `ai:inference_record` OID SHOULD be listed in the consent record's associated
invocation log (implementation-defined; this profile does not mandate the log format, only the
CDRO structure).

---

### 4.2 `ai:safety_eval_result`

**Purpose:** Records a completed safety evaluation run for a specific model version, signed by
the evaluator actor, and used as the evidence object consumed by the `safety_eval_gate`
precondition.

**Status:** Stable

**Signing requirement:** MUST be signed by the evaluator actor identified in `evaluator_actor_oid`.
Unsigned results MUST be rejected by any gateway enforcing `safety_eval_gate`.

**Body schema:**

| Field                  | Type    | Required | Description                                                                         |
|------------------------|---------|----------|-------------------------------------------------------------------------------------|
| `model_id`             | string  | yes      | Model identifier the evaluation covers                                              |
| `model_version_hash`   | string  | yes      | `sha256:<hex>` of the model weights or a provider-issued version hash, pinning the exact artifact evaluated |
| `eval_suite_id`        | string  | yes      | Identifier of the evaluation suite (e.g. `HELM-v1.0`, `MMLU-2024`, `custom:red-team-v3`) |
| `eval_suite_version`   | string  | yes      | Version string of the suite itself, to distinguish suite updates from model changes  |
| `overall_score`        | number  | yes      | Aggregate pass score, 0-100                                                         |
| `category_scores`      | object  | yes      | Map of category name to score (0-100). At minimum one entry required. Example: `{"toxicity": 97, "bias": 88}` |
| `pass_fail`            | boolean | yes      | `true` if the model passed all required categories for this suite; `false` otherwise |
| `evaluator_actor_oid`  | string  | yes      | OID of the actor that produced and signed this result                               |
| `evaluated_at_ms`      | integer | yes      | Time the evaluation completed, milliseconds since Unix epoch                        |
| `expires_at_ms`        | integer | yes      | Time after which this result must not be accepted by `safety_eval_gate`. Operators SHOULD set this to no longer than 30 days for high-risk capability gates. |
| `eval_framework`       | string  | yes      | Human-readable framework name (e.g. `HELM`, `MMLU`, `custom`). Informative.        |
| `methodology_hash`     | string  | yes      | `sha256:<hex>` of the canonical eval methodology document. Pins the methodology without including it in the CDRO body. |

**OID computation:** `sha256(canonical({model_id, model_version_hash, eval_suite_id, eval_suite_version, overall_score, category_scores, pass_fail, evaluator_actor_oid, evaluated_at_ms, expires_at_ms, methodology_hash}))`.

**Chain requirements:** None required by this profile. An evaluator SHOULD chain successive
evaluations of the same model by storing the prior result's OID in operator metadata, creating
an auditable evaluation history. This profile does not mandate the chaining mechanism.

---

### 4.3 `ai:consent_record`

**Purpose:** Records data-use consent for AI workloads, specifying which output uses the actor
has authorized, under which data residency constraints, and for how long, in a signed
content-addressed object that the `output_consent` precondition can verify.

**Status:** Stable

**Signing requirement:** MUST be signed. An unsigned `ai:consent_record` MUST NOT be accepted
by any gateway enforcing `output_consent`.

**Body schema:**

| Field                | Type    | Required | Description                                                                              |
|----------------------|---------|----------|------------------------------------------------------------------------------------------|
| `actor_oid`          | string  | yes      | OID of the actor whose consent this record captures                                      |
| `tenant_id`          | string  | yes      | Tenant under which this consent was captured                                             |
| `permitted_uses`     | array   | yes      | Data use categories the actor has consented to. Values: `inference_only`, `cache`, `training`, `analytics`. MUST NOT contain values the actor did not explicitly authorize. |
| `data_residency`     | string  | yes      | ISO 3166-1 alpha-2 country code or `"any"`. Matches the `output_consent` precondition arg of the same name. |
| `retention_days`     | integer | yes      | Maximum days the platform may retain outputs. 0 = no retention.                         |
| `consent_text_hash`  | string  | yes      | `sha256:<hex>` of the exact consent text presented to the user. Proves the text without storing it in the CDRO body. |
| `consented_by`       | string  | no       | OID of the human who provided consent. Null or absent if consent is applied as a system policy by the operator rather than collected from a natural person. |
| `consented_at_ms`    | integer | yes      | Time consent was captured or the system policy was applied, milliseconds since Unix epoch |
| `expires_at_ms`      | integer | no       | Time after which this record expires. Null = no expiry. Operators in regulated jurisdictions SHOULD set an expiry consistent with applicable data governance requirements. |
| `prior_consent_oid`  | string  | no       | OID of the `ai:consent_record` this record supersedes, if any. Forms a version chain that the gateway traverses to confirm no earlier record contradicts the current one. |

**OID computation:** `sha256(canonical({actor_oid, tenant_id, permitted_uses, data_residency, retention_days, consent_text_hash, consented_at_ms}))`.

The `expires_at_ms`, `consented_by`, and `prior_consent_oid` fields are excluded from the
canonical payload because they are mutable governance metadata, not the core consent
commitment. The canonical fields constitute the immutable consent fact.

**Chain requirements:** When a new consent record supersedes a prior one, `prior_consent_oid`
MUST be set. A gateway traversing the chain MUST apply the most recent unexpired record. If the
chain contains a later record that restricts uses granted by an earlier record (e.g., removes
`training`), the more restrictive record governs.

**Relationship to core `gap:consent_record`:** The `ai:consent_record` type adds the AI-specific
`permitted_uses` vocabulary to the consent model. Operators using both core consent and AI
output consent SHOULD keep them as separate CDROs linked by actor OID rather than attempting to
extend the core `gap:consent_record` body.

---

## 5. Conformance Requirements

A gateway claiming `gap-ai-00` profile support MUST:

1. Evaluate the `model_policy` precondition kind per Section 3.1 for any `ai.*` capability
   where the precondition is present in the grant.
2. Evaluate the `output_consent` precondition kind per Section 3.2, including residency
   verification where `data_residency` is a country code.
3. Evaluate the `safety_eval_gate` precondition kind per Section 3.3 for any invocation of
   `ai.model.deploy` or `ai.evaluation.adversarial.run` where the precondition is present.
4. Accept, validate the signature of, and store `ai:safety_eval_result` CDROs per Section 4.2.
   Reject unsigned results rather than downgrading to unsigned storage.
5. Accept, validate the signature of, and store `ai:consent_record` CDROs per Section 4.3.
   Traverse the `prior_consent_oid` chain when evaluating `output_consent` to confirm no
   later, more restrictive record supersedes the one on file.
6. Enforce the core delegation chain requirements for `ai.agent.spawn` and
   `ai.agent.fleet.spawn` per Section 5.1.

A gateway claiming `gap-ai-00` profile support SHOULD:

7. Issue `ai:inference_record` CDROs for every `ai.inference.*` invocation, signed at L2 or
   higher, to produce a complete per-call audit trail.
8. Expose a query interface (implementation-defined) that allows an authorized actor to retrieve
   all `ai:inference_record` CDROs for a given `grant_oid`, supporting token-usage accounting
   and billing reconciliation.

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-ai-00"]
}
```

### 5.1 Agent delegation and fleet spawn interaction rules

The `ai.*` profile and the core delegation chain together govern multi-hop agent networks. The
following rules apply whenever `ai.agent.spawn` or `ai.agent.fleet.spawn` appears in a grant:

- An agent spawned via `ai.agent.spawn` MUST carry the parent grant's `grant_oid` as the next
  entry in the core `gap:orchestration_chain`. The spawned agent's own declaration MUST NOT
  omit this chain entry. A gateway receiving a declaration from a spawned agent with a missing
  or broken chain MUST deny all grants to that agent until the chain is repaired.
- The core spec limits `gap:orchestration_chain` to 10 hops. A gateway MUST deny any
  `ai.agent.spawn` invocation that would cause the resulting agent's chain to exceed 10
  entries.
- `ai.agent.fleet.spawn` (class C) spawns N agents in parallel. Each spawned agent consumes
  one hop of the delegation chain. A fleet spawn where N would push any individual agent
  beyond the 10-hop limit MUST be denied in full; the gateway MUST NOT allow a partial
  fleet spawn. If N itself does not exhaust the limit but the fleet size exceeds the
  operator-configured HITL threshold, the gateway MUST require a HITL approval (L3 minimum)
  before issuing grants to any member of the fleet.
- Operator HITL threshold for fleet spawns is configured as an integer `max_fleet_no_hitl` in
  the grant's `scope_narrowing.fleet_policy` object. If absent, the default is 1 (every fleet
  spawn requires HITL). Operators MUST set this explicitly to enable unattended fleet spawns.

### 5.2 Training data access rationale

`ai.training.data.access` is class C with `require_signed_receipt: true` because access to
raw training data is a significant IP event and, when the data contains personal information, a
privacy event. The signed receipt chain (`ai:consent_record` establishing permitted use,
followed by `ai:inference_record` or an operator-defined training-run record) provides the
provenance trail designed to support audit obligations under frameworks such as the EU AI Act
(Article 10, data governance requirements for high-risk AI) and NIST AI RMF (GOVERN 1.4,
MAP 1.1). This is an informative note about design intent; satisfying any specific regulatory
requirement requires independent legal and compliance review.

---

## 6. Informative Examples

### 6.1 Declaration with model_policy and output_consent preconditions

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "inference-agent-a4f2",
  "actor_type": "agent",
  "actor_name": "Inference Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "ai.inference.text",
      "safety_class": "B",
      "require_signed_receipt": false,
      "preconditions": [
        {
          "kind": "model_policy",
          "args": {
            "allowed_models": ["claude-*", "gpt-4o"],
            "blocked_models": ["*-instruct-uncensored"],
            "max_context_tokens": 200000,
            "require_content_filter": true
          }
        },
        {
          "kind": "output_consent",
          "args": {
            "permitted_uses": ["inference_only"],
            "data_residency": "US",
            "retention_days": 0
          }
        }
      ]
    }
  ]
}
```

### 6.2 Declaration with safety_eval_gate on model deployment

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "model-deploy-agent-b3c1",
  "actor_type": "agent",
  "actor_name": "Model Deploy Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "ai.model.deploy",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "safety_eval_gate",
          "args": {
            "required_eval_suites": ["HELM-v1.0", "custom:red-team-v3"],
            "min_pass_score": 85,
            "max_eval_age_ms": 604800000
          }
        }
      ]
    }
  ]
}
```

### 6.3 ai:consent_record CDRO

```json
{
  "type": "ai:consent_record",
  "actor_oid": "sha256:a4f2...",
  "tenant_id": "tenant_acme_corp",
  "permitted_uses": ["inference_only", "cache"],
  "data_residency": "US",
  "retention_days": 7,
  "consent_text_hash": "sha256:9e3b1f...",
  "consented_by": "sha256:human_oid_77c4...",
  "consented_at_ms": 1750000000000,
  "expires_at_ms": 1781536000000,
  "prior_consent_oid": null
}
```

### 6.4 ai:safety_eval_result CDRO

```json
{
  "type": "ai:safety_eval_result",
  "model_id": "acme-llm-v2",
  "model_version_hash": "sha256:4d7a9c...",
  "eval_suite_id": "HELM-v1.0",
  "eval_suite_version": "1.0.3",
  "overall_score": 91,
  "category_scores": {
    "toxicity": 96,
    "bias": 88,
    "misinformation": 93,
    "instruction_following": 89
  },
  "pass_fail": true,
  "evaluator_actor_oid": "sha256:eval_actor_cc2d...",
  "evaluated_at_ms": 1749900000000,
  "expires_at_ms": 1752492000000,
  "eval_framework": "HELM",
  "methodology_hash": "sha256:f1e2b8..."
}
```

### 6.5 ai:inference_record CDRO

```json
{
  "type": "ai:inference_record",
  "actor_oid": "sha256:a4f2...",
  "grant_oid": "sha256:c9d4...",
  "model_id": "claude-3-7-sonnet-20250219",
  "model_provider": "anthropic",
  "input_token_count": 1842,
  "output_token_count": 317,
  "cost_usd": 0.0031,
  "latency_ms": 1240,
  "content_filter_triggered": false,
  "output_hash": "sha256:7b2e44...",
  "invoked_at_ms": 1750001000000
}
```

### 6.6 Agent spawn with delegation chain

An orchestrator agent (hop 1) spawning a child agent (hop 2) for a research sub-task:

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "child-agent-5f3a",
  "actor_type": "agent",
  "actor_name": "Research Sub-Agent",
  "actor_version": "1.0.0",
  "gap:orchestration_chain": [
    "sha256:parent_grant_oid_b8c7..."
  ],
  "capabilities": [
    {
      "capability": "ai.inference.text",
      "safety_class": "B",
      "require_signed_receipt": false,
      "preconditions": [
        {
          "kind": "model_policy",
          "args": {
            "allowed_models": ["claude-*"]
          }
        }
      ]
    }
  ]
}
```

The gateway verifies that `sha256:parent_grant_oid_b8c7...` is a valid, unexpired grant before
issuing a grant to the child agent. The chain length is 1 after this spawn; a further child
spawn from this agent would produce a chain of length 2, and so on up to the 10-hop limit.

### 6.7 Fleet spawn with HITL gate

A declaration requesting a fleet of 5 parallel analysis agents:

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "orchestrator-d1e2",
  "actor_type": "agent",
  "actor_name": "Fleet Orchestrator Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "ai.agent.fleet.spawn",
      "safety_class": "C",
      "require_signed_receipt": true,
      "scope_narrowing": {
        "fleet_policy": {
          "max_fleet_no_hitl": 3
        }
      },
      "preconditions": []
    }
  ]
}
```

Because the invoking actor requests a fleet of 5 and `max_fleet_no_hitl` is 3, the gateway
MUST route the grant decision through a HITL approval before issuing grants to any of the 5
agents. If the fleet size had been 3 or fewer, the gateway could issue the grants immediately.

---

## Appendix: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                        | Class | Notes                                                           |
|----------------------------------------|-------|-----------------------------------------------------------------|
| `ai.inference.audio.transcribe`        | B     | Audio-to-text transcription                                     |
| `ai.inference.audio.generate`          | B     | Text-to-audio synthesis                                         |
| `ai.inference.multimodal`              | B     | Combined image/text or video/text inference                     |
| `ai.model.checkpoint.save`             | B     | Save a training checkpoint                                      |
| `ai.model.finetune.cancel`             | B     | Cancel an in-progress fine-tune run                             |
| `ai.model.finetune.result.promote`     | C     | Promote a fine-tuned model to the model registry               |
| `ai.model.weights.import`              | C     | Import external model weights into the platform                 |
| `ai.evaluation.benchmark.run`          | B     | Run a standard benchmark (non-adversarial)                      |
| `ai.agent.pause`                       | B     | Pause a running agent pending a human decision                  |
| `ai.agent.memory.read`                 | A     | Read an agent's persisted memory store                          |
| `ai.agent.memory.write`                | B     | Write to an agent's persisted memory store                      |
| `ai.agent.tool.register`               | B     | Register a new tool available to spawned agents                 |
| `ai.pipeline.schedule`                 | B     | Schedule a recurring inference or training pipeline             |
| `ai.audit.log.export`                  | C     | Export the signed receipt log for a model or actor              |
