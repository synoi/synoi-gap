# GAP Companion Profile: Legal

**Draft:** gap-legal-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `legal.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol for law firms, legal operations platforms,
eDiscovery tooling, contract lifecycle management (CLM) systems, and regulatory compliance
workflows. It registers the `legal.*` capability namespace, three normative precondition kinds
(`privilege_review`, `court_deadline_gate`, `conflict_check`), and three CDRO types for
attorney privilege determinations, contract execution records, and eDiscovery production audits.

A legal operator adopting this profile gets:

- Every class C action (document production, contract execution, court filing, settlement
  authorization) backed by a content-addressed, signed receipt that satisfies the evidentiary
  requirements of downstream dispute resolution
- Privilege review bound cryptographically to the production chain, so no document reaches
  opposing counsel without a signed attorney determination on record
- Conflict-of-interest checks enforced at the gateway before any matter or document access is
  granted to a cross-matter actor
- Court-deadline gating that denies a filing submission when lead time falls below a configurable
  floor, reducing last-minute filing failures to a detectable, auditable event

Privacy note: legal matters involve attorney-client privilege, personal data protected under
applicable law, trade secrets, and confidential settlement figures. This profile is designed so
that CDRO bodies in the public receipt chain NEVER contain raw document text, party names,
attorney names, or dollar amounts. All identifiers are hashed with HMAC using tenant-scoped
keys. A party that holds both the HMAC key and the receipt chain can reconstruct the full
audit trail. A third party with access to only the receipts learns nothing about the matter,
the parties, or the amounts involved. This property is load-bearing: implementers MUST NOT
store unmasked identifiers in any CDRO field.

This profile composes freely with other profiles. The `legal.*` namespace does not conflict
with any other registered profile namespace. A platform running eDiscovery alongside supply-chain
custody tracking can activate `gap-legal-00` and `gap-supply-chain-00` simultaneously.

---

## 2. Capability Taxonomy

Capability names use the `legal.` root. Sub-namespaces are open; operators may extend any
branch (e.g., `legal.document.review.queue.assign`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for legal context                                                              |
|-------|------------------------------------------------------------------------------------------|
| A     | Read-only queries (matter status, document search, timeline reads); no mutation           |
| B     | Reversible mutations (annotations, draft creation, redaction marks, privilege flags)      |
| C     | Irreversible or externally visible actions (production, filing, execution, waiver)        |

### 2.2 Core capability names

| Capability name                    | Class | require_signed_receipt | Notes                                                        |
|------------------------------------|-------|------------------------|--------------------------------------------------------------|
| `legal.matter.read`                | A     | false                  | Read matter details, parties list, and status                |
| `legal.document.search`            | A     | false                  | Search document repository by query or filter                |
| `legal.document.read`              | A     | false                  | Read a specific document by OID                              |
| `legal.timeline.read`              | A     | false                  | Read case timeline, deadlines, and court dates               |
| `legal.document.annotate`          | B     | false                  | Add annotations or tags to a document                        |
| `legal.document.draft`             | B     | false                  | Draft a new document from a template                         |
| `legal.document.redact`            | B     | false                  | Apply redaction marks to a document                          |
| `legal.privilege.flag`             | B     | false                  | Flag a document as potentially privileged for attorney review |
| `legal.document.produce`           | C     | true                   | Produce documents to opposing party in discovery             |
| `legal.contract.execute`           | C     | true                   | Execute a contract via e-signature workflow                   |
| `legal.filing.court.submit`        | C     | true                   | Submit a court filing to a filing system or court portal     |
| `legal.privilege.waive`            | C     | true                   | Explicitly waive privilege on a document                     |
| `legal.settlement.authorize`       | C     | true                   | Authorize a settlement offer or acceptance                   |
| `legal.compliance.report.file`     | C     | true                   | File a regulatory report with a government authority         |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `privilege_review`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `legal.document.produce` on the existence of a signed attorney privilege
determination for each document in the production set, ensuring no document reaches opposing
counsel without a qualified review on record.

**Args schema:**

```json
{
  "type": "object",
  "required": ["reviewing_attorney_oid"],
  "properties": {
    "require_privilege_cleared": {
      "type": "boolean",
      "default": true,
      "description": "When true, deny if the privilege determination is not cleared_for_production. When false, allow redact_and_produce determinations to pass."
    },
    "reviewing_attorney_oid": {
      "type": "string",
      "description": "OID of the actor who performed privilege review. MUST have a professional_license identity_binding with jurisdiction matching the matter."
    },
    "max_review_age_ms": {
      "type": "integer",
      "minimum": 1,
      "default": 604800000,
      "description": "Maximum age of the privilege review record in milliseconds, measured from reviewed_at_ms to server receive time. Default is 7 days (604800000 ms)."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `privilege_review` MUST:

1. For each `document_oid` in the invocation args, locate the most recent
   `legal:privilege_review_record` CDRO in the tenant receipt store that references that
   `document_oid`.
2. Verify the `legal:privilege_review_record` CDRO is signed by the actor identified by
   `reviewing_attorney_oid` in the precondition args.
3. Verify that the `reviewing_attorney_oid` actor has a `professional_license` identity binding
   whose `jurisdiction` field matches the `jurisdiction` recorded on the matter. If the actor
   does not have this binding, deny.
4. Verify that `(server_receive_time_ms - review_record.reviewed_at_ms) <= args.max_review_age_ms`.
   If the review is stale, deny with `privilege_review_expired` in the receipt detail.
5. If `args.require_privilege_cleared` is `true`, verify that
   `review_record.cleared_for_production == true`. If `cleared_for_production` is `false`, deny
   with `privilege_hold` in the receipt detail and include the `privilege_determination` value
   from the review record.
6. If any document in the set lacks a qualifying review record, deny the entire invocation.
   Partial production is not permitted under this precondition.

If any check fails, the gateway MUST deny the invocation with `precondition_failed` and
`precondition_kind: "privilege_review"` in the receipt.

This precondition requires L3 minimum (HITL). When the precondition fails, the denial receipt
MUST be routed to the attorney identified by `reviewing_attorney_oid` for confirmation before
a re-invocation is attempted.

**Cache behavior:** No caching. Every production invocation MUST re-evaluate freshly against
the current review record, because privilege determinations can be revised.

**Failure action:** `deny` with `privilege_hold` detail. At L3+, a `hitl` escalation to the
reviewing attorney SHOULD be emitted alongside the denial.

---

### 3.2 `court_deadline_gate`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `legal.filing.court.submit` on the filing being submitted with sufficient
lead time before the court deadline, preventing inadvertent late filings and creating an
auditable record when emergency overrides are invoked.

**Args schema:**

```json
{
  "type": "object",
  "required": ["calendar_endpoint"],
  "properties": {
    "min_lead_time_ms": {
      "type": "integer",
      "minimum": 0,
      "default": 3600000,
      "description": "Minimum milliseconds of lead time required before the deadline. Default is 1 hour (3600000 ms). A value of 0 means the deadline itself is the floor."
    },
    "calendar_endpoint": {
      "type": "string",
      "description": "PIP endpoint for the court calendar service. The gateway calls this endpoint with filing_type and jurisdiction from the invocation args to retrieve the deadline."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `court_deadline_gate` MUST:

1. Call `args.calendar_endpoint` with the `filing_type` and `jurisdiction` fields from the
   invocation args to retrieve the deadline timestamp (`deadline_ms`) for this filing.
2. If the calendar endpoint is unreachable, deny with `calendar_unavailable` and do NOT
   fall through to allow. A filing submitted without verified deadline data is inadmissible
   under this precondition.
3. If `server_receive_time_ms >= deadline_ms`, deny unconditionally with `deadline_passed` and
   `time_past_deadline_ms: (server_receive_time_ms - deadline_ms)` in the receipt detail. No
   override is available for a missed deadline.
4. If `(deadline_ms - server_receive_time_ms) < args.min_lead_time_ms`:
   a. If the grant carries `emergency_override: true` in its scope narrowing, allow and record
      `emergency_override_invoked: true` in the receipt detail.
   b. Otherwise, deny with `insufficient_lead_time` and
      `time_remaining_ms: (deadline_ms - server_receive_time_ms)` in the receipt detail.
5. If all checks pass, allow and include `deadline_ms` and `time_remaining_ms` in the receipt
   detail for the filing record.

**Cache behavior:** 60 seconds per `(filing_type, jurisdiction, calendar_endpoint)` tuple.
Deadline data is authoritative at submission time; short caching is acceptable only for
high-frequency checks against the same filing type.

**Failure action:** `deny` (steps 3 and 4b) or `hitl` when the grant carries
`hitl_on_late_filing: true` and the denial would be `insufficient_lead_time` only (not
`deadline_passed`, which is unconditional).

---

### 3.3 `conflict_check`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `legal.matter.read` and `legal.document.read` for cross-matter access on
the invoking actor having no conflict of interest with the parties or adverse matters in the
target matter, blocking inadvertent or unauthorized access to matters where the actor is
conflicted.

**Args schema:**

```json
{
  "type": "object",
  "required": ["conflict_db_endpoint"],
  "properties": {
    "conflict_db_endpoint": {
      "type": "string",
      "description": "PIP endpoint for the conflict-of-interest database. The gateway calls this endpoint with the actor's credential_identifier and the matter's parties list."
    },
    "check_scope": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["parties", "counsel", "adverse_matters"]
      },
      "default": ["parties"],
      "description": "Which conflict dimensions to evaluate. 'parties' checks the actor against named parties; 'counsel' checks against opposing counsel relationships; 'adverse_matters' checks against matters where the actor represented an adverse party."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `conflict_check` MUST:

1. Retrieve the invoking actor's `credential_identifier` from the actor's `identity_binding`
   in the grant. If no identity binding is present, deny with `actor_unidentified`.
2. Call `args.conflict_db_endpoint` with the actor's `credential_identifier`, the target matter's
   parties list (as hashed identifiers; MUST NOT transmit raw party names over the PIP
   channel unless the conflict service is the same tenant), and the dimensions in `check_scope`.
3. If the conflict database returns any conflict for any requested dimension, deny with
   `conflict_found` and include `conflict_dimensions` (the array of dimensions that triggered)
   in the receipt detail. The receipt MUST NOT include party names or conflict reasons.
4. If the conflict database endpoint is unreachable, deny with `conflict_check_unavailable`.
   Cross-matter access without a verified conflict check is not permitted under this precondition.
5. If no conflict is found for all requested dimensions, allow.

**Cache behavior:** 300 seconds per `(actor_oid, matter_id)` tuple. If a matter's parties list
changes (new party added mid-matter), the operator MUST invalidate the cache for all actors
associated with that matter. The conflict database is the system of record; the cache is for
latency only.

**Failure action:** `deny`.

---

## 4. CDRO Type Registry

### 4.1 `legal:privilege_review_record`

**Purpose:** Records an attorney's privilege determination for a specific document, producing
a signed, content-addressed evidence record that gates production and survives privilege
dispute proceedings.

**Status:** Stable

**Signing requirement:** MUST be signed by the reviewing attorney's actor key. The gateway
MUST verify the signature before accepting the record into the tenant store.

**Body schema:**

| Field                    | Type    | Required | Description                                                                      |
|--------------------------|---------|----------|----------------------------------------------------------------------------------|
| `reviewing_attorney_oid` | string  | yes      | OID of the attorney actor who performed the review (MUST have `professional_license` identity_binding) |
| `matter_id_hash`         | string  | yes      | HMAC-SHA256 of the matter identifier, key = `(tenant_id \|\| "matter")`          |
| `document_oid`           | string  | yes      | OID of the document CDRO being reviewed                                          |
| `privilege_determination`| string  | yes      | One of: `"privileged"`, `"not_privileged"`, `"redact_and_produce"`               |
| `privilege_basis`        | array   | yes      | Array of applicable bases: `"attorney_client"`, `"work_product"`, `"other"`      |
| `cleared_for_production` | boolean | yes      | True only when `privilege_determination` is `"not_privileged"` or `"redact_and_produce"` and the attorney affirmatively clears the document |
| `review_notes_hash`      | string  | no       | `sha256` of the attorney's review notes. MUST NOT contain the raw notes text     |
| `reviewed_at_ms`         | integer | yes      | Milliseconds since epoch when the review was completed and signed                |

**OID computation:** `sha256(canonical({reviewing_attorney_oid, matter_id_hash, document_oid, privilege_determination, privilege_basis, cleared_for_production, reviewed_at_ms}))`. The `review_notes_hash` is excluded from the canonical payload because it is informative only.

**Chain requirements:** MUST reference `document_oid`. When a production event occurs, the
`legal:ediscovery_production_record` MUST reference the OIDs of all privilege review records
covering the produced set.

**Privacy constraint:** The `privilege_basis` array MUST NOT include the specific legal theory
in textual form beyond the enumerated values above. Free-text privilege reasoning belongs in
the attorney's own notes, referenced here only by hash.

---

### 4.2 `legal:contract_execution_record`

**Purpose:** Records a contract execution event (e-signature completion) as a content-addressed,
signed receipt, providing a durable audit record that can be verified without access to the
underlying contract text.

**Status:** Stable

**Signing requirement:** MUST be signed by the gateway at issuance. Each co-signing counterparty
whose `actor_oid` appears in `counterparty_oids` SHOULD also countersign their own execution
receipt and reference this record's OID.

**Body schema:**

| Field                  | Type    | Required | Description                                                                           |
|------------------------|---------|----------|---------------------------------------------------------------------------------------|
| `actor_oid`            | string  | yes      | OID of the actor who executed (signed) the contract                                   |
| `grant_oid`            | string  | yes      | OID of the grant that authorized `legal.contract.execute`                             |
| `contract_id_hash`     | string  | yes      | HMAC-SHA256 of the contract identifier, key = `(tenant_id \|\| "contract")`          |
| `contract_version_hash`| string  | yes      | `sha256` of the canonical contract text at execution time                             |
| `parties_count`        | integer | yes      | Number of signing parties. MUST NOT be replaced with party names or identifiers       |
| `signing_mechanism`    | string  | yes      | One of: `"esign_platform"`, `"wet_ink"`, `"notarized"`                               |
| `jurisdiction`         | string  | yes      | Governing jurisdiction for the contract (ISO 3166-2 or similar)                      |
| `executed_at_ms`       | integer | yes      | Milliseconds since epoch when execution completed                                     |
| `expiry_at_ms`         | integer | no       | Milliseconds since epoch when the contract expires. Null if perpetual                 |
| `counterparty_oids`    | array   | yes      | Array of OIDs for co-signing actors. Each MUST have an `identity_binding`. May be empty for single-party attestations |
| `prior_version_oid`    | string  | no       | OID of the prior `legal:contract_execution_record` this supersedes, if applicable    |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, contract_id_hash, contract_version_hash, parties_count, signing_mechanism, jurisdiction, executed_at_ms, counterparty_oids}))`.

**Chain requirements:** When this record supersedes a prior execution (e.g., an amendment or
renewal), `prior_version_oid` MUST reference the OID of the prior
`legal:contract_execution_record`. Implementations MUST NOT allow a contract amendment to
break the chain by omitting this reference.

**Privacy constraint:** Party names, dollar amounts, and contract terms MUST NOT appear in any
field. The `contract_version_hash` enables a holder of both the HMAC key and the contract text
to verify integrity without exposing content to the receipt chain.

---

### 4.3 `legal:ediscovery_production_record`

**Purpose:** Records an eDiscovery document production event as a tamper-evident audit record,
suitable for use as evidence in sanctions proceedings under applicable discovery rules and for
privilege-log reconstruction.

**Status:** Stable

**Signing requirement:** MUST be signed. For L2+ gateways, the gateway signs. For L4 gateways
(cross-tenant), both the producing-party gateway and the receiving-party gateway SHOULD
countersign, creating a bilateral receipt of transmission and acknowledgment.

**Body schema:**

| Field                   | Type    | Required | Description                                                                          |
|-------------------------|---------|----------|--------------------------------------------------------------------------------------|
| `actor_oid`             | string  | yes      | OID of the actor who authorized the production                                       |
| `grant_oid`             | string  | yes      | OID of the grant that authorized `legal.document.produce`                            |
| `matter_id_hash`        | string  | yes      | HMAC-SHA256 of the matter identifier, key = `(tenant_id \|\| "matter")`             |
| `document_count`        | integer | yes      | Number of documents in this production set                                           |
| `total_size_bytes`      | integer | yes      | Total uncompressed size of the production set in bytes                               |
| `production_set_hash`   | string  | yes      | `sha256` of the canonical manifest of produced document OIDs (sorted, newline-joined)|
| `privilege_review_oid`  | string  | yes      | Merkle root of the OIDs of all `legal:privilege_review_record` CDROs covering the produced set. A holder of the full set can verify completeness |
| `produced_to`           | string  | yes      | HMAC-SHA256 of the opposing counsel identifier, key = `(tenant_id \|\| "counsel")`. MUST NOT be raw name or email |
| `produced_at_ms`        | integer | yes      | Milliseconds since epoch when the production was transmitted                         |
| `bates_range_hash`      | string  | yes      | HMAC-SHA256 of the Bates number range string, key = `(tenant_id \|\| "bates")`. MUST NOT be the raw range |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, matter_id_hash, document_count, total_size_bytes, production_set_hash, privilege_review_oid, produced_to, produced_at_ms, bates_range_hash}))`.

**Chain requirements:** The `privilege_review_oid` field MUST be a valid Merkle root over the
set of `legal:privilege_review_record` OIDs for every document in the production set. A gateway
MUST reject an `legal:ediscovery_production_record` submission where `privilege_review_oid`
cannot be verified against the review records in the tenant store.

**Privacy constraint:** Raw document content, party names, attorney names, Bates numbers, and
the identity of opposing counsel MUST NOT appear in any field. All identifiers use HMAC with
tenant-scoped keys. A third party with access only to the receipts learns the count, size, and
timing of productions but nothing about the matter or the parties.

---

## 5. Conformance Requirements

A gateway claiming `gap-legal-00` profile support MUST:

1. Evaluate the `privilege_review` precondition kind per Section 3.1 for any invocation of
   `legal.document.produce`.
2. Evaluate the `court_deadline_gate` precondition kind per Section 3.2 for any invocation of
   `legal.filing.court.submit`.
3. Evaluate the `conflict_check` precondition kind per Section 3.3 for any cross-matter
   invocation of `legal.matter.read` or `legal.document.read` where the precondition is present
   in the grant.
4. Accept, validate, and store `legal:privilege_review_record` CDROs per Section 4.1, and
   verify the reviewing attorney's signature before admission.
5. Issue `legal:contract_execution_record` CDROs on completion of `legal.contract.execute`
   invocations per Section 4.2.
6. Issue `legal:ediscovery_production_record` CDROs on completion of `legal.document.produce`
   invocations per Section 4.3, and verify the `privilege_review_oid` Merkle root before
   signing.
7. Enforce minimum core tier requirements per Section 5.1.
8. Enforce the privacy constraints in Section 4 (no raw identifiers in CDRO fields).

A gateway claiming `gap-legal-00` profile support SHOULD:

9. Emit a `hitl` escalation to the reviewing attorney when a `privilege_review` denial is
   issued, so the attorney can revise the determination and re-authorize if appropriate.
10. Surface `time_remaining_ms` from `court_deadline_gate` receipts to the operator UI to
    support deadline dashboards.
11. Retain `legal:privilege_review_record` CDROs for the retention period applicable to the
    matter under the operator's data governance policy, and MUST NOT delete them while any
    `legal:ediscovery_production_record` that references them is within its retention window.

### 5.1 Minimum core tier requirements

| Capability group                                                                                          | Minimum tier |
|-----------------------------------------------------------------------------------------------------------|--------------|
| All `legal.*` capabilities                                                                                | L2           |
| `legal.document.produce`, `legal.contract.execute`, `legal.filing.court.submit`                           | L3 (HITL required before any class C action) |
| `legal.privilege.waive`, `legal.settlement.authorize`                                                     | L4 (cross-tenant receipt verification required) |

Gateways supporting the `privilege_review` precondition MUST enforce that the actor identified
by `reviewing_attorney_oid` holds a `professional_license` identity binding whose `jurisdiction`
matches the matter jurisdiction recorded in the tenant store. A gateway that cannot verify
this binding MUST deny the production and MUST NOT issue the `legal:ediscovery_production_record`.

### 5.2 Cross-tenant receipt verification at L4

For `legal.privilege.waive` and `legal.settlement.authorize`, the receipt MUST be verifiable
by a party outside the producing tenant (e.g., opposing counsel, a court, or a regulator)
using only the public signing key of the issuing gateway. The gateway MUST publish its signing
key at a well-known endpoint (`/.well-known/gap-keys.json`) in a form compatible with the
core spec's key discovery mechanism.

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L3",
  "profiles": ["gap-legal-00"]
}
```

---

## 6. Informative Examples

### 6.1 Declaration with privilege review precondition on document production

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "ediscovery-agent-c3a1",
  "actor_type": "agent",
  "actor_name": "eDiscovery Production Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "legal.document.produce",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "privilege_review",
          "args": {
            "require_privilege_cleared": true,
            "reviewing_attorney_oid": "sha256:f7d2...",
            "max_review_age_ms": 604800000
          }
        }
      ]
    }
  ]
}
```

### 6.2 Grant with court deadline gate and emergency override capability

```json
{
  "type": "gap:capability_grant",
  "declaration_oid": "sha256:a4b9...",
  "granted_capabilities": [
    {
      "name": "legal.filing.court.submit",
      "scope_narrowing": {
        "filing_type": "motion_for_summary_judgment",
        "jurisdiction": "US-CA-ND",
        "hitl_on_late_filing": true
      },
      "preconditions": [
        {
          "kind": "court_deadline_gate",
          "args": {
            "min_lead_time_ms": 3600000,
            "calendar_endpoint": "https://pip.example.legal/court-calendar"
          }
        }
      ]
    }
  ]
}
```

### 6.3 Conflict check on cross-matter document access

```json
{
  "type": "gap:capability_grant",
  "declaration_oid": "sha256:b2e1...",
  "granted_capabilities": [
    {
      "name": "legal.document.read",
      "scope_narrowing": {
        "matter_id_context": "cross_matter"
      },
      "preconditions": [
        {
          "kind": "conflict_check",
          "args": {
            "conflict_db_endpoint": "https://pip.example.legal/conflicts",
            "check_scope": ["parties", "adverse_matters"]
          }
        }
      ]
    }
  ]
}
```

### 6.4 Privilege review record CDRO issued by reviewing attorney

```json
{
  "type": "legal:privilege_review_record",
  "reviewing_attorney_oid": "sha256:f7d2...",
  "matter_id_hash": "hmac-sha256:9a3c...",
  "document_oid": "sha256:e8b4...",
  "privilege_determination": "not_privileged",
  "privilege_basis": [],
  "cleared_for_production": true,
  "review_notes_hash": "sha256:1d72...",
  "reviewed_at_ms": 1751000000000
}
```

### 6.5 eDiscovery production record CDRO issued at production time

```json
{
  "type": "legal:ediscovery_production_record",
  "actor_oid": "sha256:c3a1...",
  "grant_oid": "sha256:d5f0...",
  "matter_id_hash": "hmac-sha256:9a3c...",
  "document_count": 847,
  "total_size_bytes": 2304819200,
  "production_set_hash": "sha256:7c11...",
  "privilege_review_oid": "sha256:3b90...",
  "produced_to": "hmac-sha256:6e44...",
  "produced_at_ms": 1751003600000,
  "bates_range_hash": "hmac-sha256:2a17..."
}
```

### 6.6 Receipt for a denied production (privilege hold)

A `legal.document.produce` invocation denied because a document in the set was marked
`cleared_for_production: false` by the reviewing attorney:

```json
{
  "oid": "sha256:<computed>",
  "type": "gap:decision_receipt",
  "gap_version": "1.0",
  "tenant_id": "my-tenant",
  "created_at_ms": 1751003500000,
  "created_by": "sha256:<gateway-actor-oid>",
  "body": {
    "subject_kind": "capability_invocation",
    "subject_oid": "sha256:f1a3...",
    "initiator": { "actor_oid": "sha256:c3a1...", "actor_type": "agent" },
    "status": "denied",
    "initiated_at_ms": 1751003500000,
    "resolved_at_ms": 1751003500009,
    "detail": "precondition_failed: privilege_review; reason=privilege_hold, privilege_determination=privileged, document_oid=sha256:e8b4..."
  }
}
```

---

## 7. Informative References

The following standards and rules are informative only. This profile does not make normative
legal conclusions and does not constitute legal advice. Operators and implementers are
responsible for their own legal compliance assessments.

- **FRCP Rules 26, 34, 37** (US Federal Rules of Civil Procedure): the `legal:ediscovery_production_record`
  and `privilege_review` precondition are designed to support audit obligations aligned with
  the evidentiary and proportionality requirements of Rule 26 and the production and sanctions
  framework of Rules 34 and 37.
- **EU GDPR Article 9** (special categories of personal data): the privacy-by-construction
  approach in Section 4 (HMAC masking, no raw identifiers in receipt chain) is aligned with
  data minimization and purpose limitation principles applicable to legal matter data in EU
  jurisdictions.
- **EU AI Act** (high-risk AI systems, Article 6 and Annex III): legal interpretation and
  justice administration are listed as high-risk AI use cases. This profile's HITL requirements
  at L3+ and L4 are designed to support human oversight obligations consistent with the EU AI
  Act's high-risk framework.
- **Attorney-client privilege doctrine** (common law and civil law variants): the
  `privilege_review` precondition and `legal:privilege_review_record` CDRO type are designed
  to support privilege log construction and privilege dispute resolution. They do not establish
  privilege as a matter of law.

---

## Appendix: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                        | Class | Notes                                                    |
|----------------------------------------|-------|----------------------------------------------------------|
| `legal.matter.create`                  | C     | Open a new matter in the matter management system        |
| `legal.matter.close`                   | C     | Close a matter (irreversible billing/archive event)      |
| `legal.document.version.lock`          | B     | Lock a document version (prevent further edits)          |
| `legal.billing.entry.submit`           | B     | Submit a time or expense entry                           |
| `legal.billing.invoice.send`           | C     | Send a client invoice                                    |
| `legal.deposition.schedule`            | B     | Schedule a deposition                                    |
| `legal.deposition.transcript.certify`  | C     | Certify a deposition transcript                          |
| `legal.arbitration.award.record`       | C     | Record an arbitration award (requires signed receipt)    |
| `legal.compliance.policy.update`       | B     | Update a compliance policy document                      |
| `legal.compliance.audit.trigger`       | C     | Trigger a compliance audit (external notification)       |
