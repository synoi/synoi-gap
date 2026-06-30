# GAP Companion Profile: Supply Chain / DevOps

**Draft:** gap-supply-chain-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `ci.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol (GAP) for enterprise DevOps, CI/CD pipelines,
platform engineering teams, and software supply chain security programs. It registers the `ci.*`
capability namespace, three normative precondition kinds (`build_provenance`, `vulnerability_scan`,
`change_approval`), and three CDRO types for build provenance chains, vulnerability scan results,
and secret access audit records.

A platform engineering team adopting this profile gets:

- Every build, artifact promotion, deploy, and rollback action governed by a signed, immutable
  receipt that forms a continuous chain from source commit to production workload.
- Build provenance attestations bound cryptographically to the grant chain, meeting SLSA (Supply
  chain Levels for Software Artifacts) Level 1 through Level 3 verification requirements without
  custom infrastructure.
- Vulnerability scan verdicts that must be satisfied before any artifact can reach production.
  The signed scan CDRO cannot be forged or replayed from a different artifact.
- Secret access events that produce a non-repudiable audit trail without ever storing the secret
  value or the raw secret path in any CDRO.
- Human-approval quorums for production deploys, infrastructure destruction, and access grants,
  using the shipped GAP HITL workflow with multi-approver semantics.

This profile composes freely with other profiles. A team running a gaming platform can activate
`gap-gaming-00` and `gap-supply-chain-00` simultaneously; the namespaces do not conflict. The
`ci.*` namespace has no overlap with any core-spec reserved namespace.

**Status note:** All precondition kinds, CDRO types, and conformance requirements in this profile
are tagged [DESIGN]. The wire format and object model follow the shipped core spec. Implementors
MUST NOT claim production conformance until a conformance test suite exists for this profile.

---

## 2. Capability Taxonomy

Capability names use the `ci.` root. Sub-namespaces are open; operators may extend any branch
(e.g., `ci.deploy.canary.advance`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for CI/CD context                                                                  |
|-------|-----------------------------------------------------------------------------------------------|
| A     | Read-only queries (pipeline status, artifact metadata, scan report fetch)                     |
| B     | Reversible or low-blast-radius mutations (build triggers, config changes, SBOM attestations)  |
| C     | Irreversible or high-blast-radius actions (production deploys, rollbacks, infra destroy, secret rotate, access grant) |

### 2.2 Core capability names

| Capability name              | Class | require_signed_receipt | pii_args         | Notes                                              |
|------------------------------|-------|------------------------|------------------|----------------------------------------------------|
| `ci.build.trigger`           | B     | false                  |                  | Trigger a pipeline build                           |
| `ci.artifact.sign`           | C     | true                   |                  | Sign an artifact (cryptographic signing step)      |
| `ci.artifact.promote`        | C     | true                   |                  | Promote artifact to next environment stage         |
| `ci.artifact.publish`        | C     | true                   |                  | Publish artifact to a registry or distribution point |
| `ci.deploy.staging`          | B     | true                   |                  | Deploy to a non-production environment             |
| `ci.deploy.production`       | C     | true                   |                  | Deploy to production                               |
| `ci.deploy.rollback`         | C     | true                   |                  | Roll back a production deployment                  |
| `ci.secret.read`             | C     | true                   | `["secret_path"]`| Read a secret from a secrets manager               |
| `ci.secret.rotate`           | C     | true                   |                  | Rotate a secret in a secrets manager               |
| `ci.config.change`           | B     | true                   |                  | Change a platform or service configuration value   |
| `ci.infra.provision`         | C     | true                   |                  | Provision infrastructure resources                 |
| `ci.infra.destroy`           | C     | true                   |                  | Destroy infrastructure resources (irreversible)    |
| `ci.access.grant`            | C     | true                   |                  | Grant access to a resource or system               |
| `ci.scan.sbom.attest`        | B     | true                   |                  | Attest a Software Bill of Materials for an artifact|

The `pii_args: ["secret_path"]` on `ci.secret.read` instructs the gateway to replace the raw
secret path with a keyed HMAC token before constructing the invocation CDRO and receipt body.
See Section 4.3 for the corresponding `ci:secret_access` CDRO and Section 5 for the conformance
requirement on the HMAC key.

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `build_provenance` [DESIGN]

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates any `ci.artifact.*` or `ci.deploy.*` capability on the artifact having a
verifiable SLSA provenance attestation at or above the required level, issued by a builder in the
operator-configured allowlist. Ensures that artifacts without a verified build origin cannot be
promoted or deployed.

**Args schema:**

```json
{
  "type": "object",
  "required": ["slsa_level", "provenance_oid", "builder_allowlist"],
  "properties": {
    "slsa_level": {
      "type": "integer",
      "enum": [1, 2, 3],
      "description": "Minimum required SLSA provenance level. The gateway MUST deny if the provenance CDRO records a level below this value."
    },
    "provenance_oid": {
      "type": "string",
      "description": "OID of the ci:build_provenance CDRO that covers the artifact being promoted or deployed. The gateway fetches and verifies this CDRO at evaluation time."
    },
    "builder_allowlist": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "Array of allowed builder identifiers (e.g. 'github-actions/runner@v2', 'tekton/pipeline@sha256:...'). The gateway verifies that the provenance CDRO's builder_id is in this list."
    }
  }
}
```

**Normative evaluation (MUST):** [DESIGN]

A gateway evaluating `build_provenance` MUST:

1. Fetch the `ci:build_provenance` CDRO identified by `args.provenance_oid` from the tenant
   receipt store. If no such CDRO exists or belongs to a different tenant, MUST deny with
   `provenance_not_found`.
2. Verify the CDRO signature against the gateway's current signing key.
3. Verify that `provenance_cdro.body.artifact_digest` matches the `artifact_digest` arg in the
   invoking invocation. If the provenance covers a different artifact, MUST deny with
   `provenance_artifact_mismatch`.
4. Verify that `provenance_cdro.body.slsa_level >= args.slsa_level`. If below the required
   level, MUST deny with `provenance_level_insufficient`.
5. Verify that `provenance_cdro.body.builder_id` is present in `args.builder_allowlist`
   (exact-match, case-sensitive). If not in the list, MUST deny with `builder_not_allowed`.
6. On pass, write a signed `gap:pip_response` CDRO recording the verification result and cache it
   per `(tenant_id, provenance_oid, artifact_digest)` for `cache_ttl_seconds` (3600 seconds).
   The `pip_response_oid` in the grant's precondition field references this CDRO, making the
   cached result ENFORCING per the core spec Signed PIP Response contract.

If any check fails, the gateway MUST deny the invocation with `precondition_failed` and
`precondition_kind: "build_provenance"` in the receipt, including the specific failure code in
the `detail` field.

The gateway MUST NOT re-verify the full provenance chain on every invocation. The signed
`gap:pip_response` is the cached, re-signable verification result. Cache invalidation occurs
naturally when the `provenance_oid` changes (the OID is content-addressed, so a changed
provenance document produces a new OID).

**Cache behavior:** 3600 seconds per `(tenant_id, provenance_oid, artifact_digest)` tuple.
Content-addressed OIDs provide natural cache invalidation on any provenance change.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny`.

---

### 3.2 `vulnerability_scan` [DESIGN]

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `ci.artifact.promote` and `ci.deploy.production` on the artifact having a
passing vulnerability scan result, issued by an accepted scanner, within a maximum age, with
critical and high counts within operator-configured limits. Ensures that no artifact with known
critical or high severity vulnerabilities can be promoted or deployed to production.

**Args schema:**

```json
{
  "type": "object",
  "required": ["scanner_allowlist", "scan_max_age_ms"],
  "properties": {
    "scanner_allowlist": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "Array of accepted scanner identifiers (e.g. 'grype@0.74.0', 'trivy@0.50.0', 'snyk@1.1234.0'). The gateway verifies that the scan result CDRO's scanner_id is in this list."
    },
    "max_critical": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Maximum number of critical severity findings permitted. Default is 0."
    },
    "max_high": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Maximum number of high severity findings permitted. Default is 0."
    },
    "scan_max_age_ms": {
      "type": "integer",
      "minimum": 1,
      "description": "Maximum age of the scan result in milliseconds, measured from scanned_at_ms to server receive time. Ensures scan results do not become stale relative to the vulnerability database."
    }
  }
}
```

**Normative evaluation (MUST):** [DESIGN]

A gateway evaluating `vulnerability_scan` MUST:

1. Locate the most recent `ci:vulnerability_scan_result` CDRO for the artifact digest in the
   invoking invocation within the tenant receipt store. If no such CDRO exists, MUST deny with
   `scan_result_not_found`.
2. Verify the scan result CDRO signature against the gateway's current signing key.
3. Verify that `scan_result_cdro.body.artifact_digest` matches the `artifact_digest` arg in the
   invoking invocation. If the scan covers a different artifact, MUST deny with
   `scan_artifact_mismatch`.
4. Verify that `scan_result_cdro.body.scanner_id` is present in `args.scanner_allowlist`
   (exact-match, case-sensitive). If not, MUST deny with `scanner_not_allowed`.
5. Verify that `(server_receive_time_ms - scan_result_cdro.body.scanned_at_ms) <= args.scan_max_age_ms`.
   If the scan result is too old, MUST deny with `scan_result_expired`.
6. Verify that `scan_result_cdro.body.critical_count <= args.max_critical` and
   `scan_result_cdro.body.high_count <= args.max_high`. If either limit is exceeded, MUST deny
   with `vulnerability_threshold_exceeded`, including `critical_count` and `high_count` in the
   receipt `detail` field.
7. Verify that `scan_result_cdro.body.result == "pass"`. If `"fail"`, MUST deny with
   `scan_result_failed`.

If any check fails, the gateway MUST deny the invocation with `precondition_failed` and
`precondition_kind: "vulnerability_scan"` in the receipt.

**Cache behavior:** No additional cache layer. The most recent `ci:vulnerability_scan_result`
CDRO for the artifact is the authoritative result. Scan freshness is controlled by
`scan_max_age_ms`.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny`.

---

### 3.3 `change_approval` [DESIGN]

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `ci.deploy.production`, `ci.infra.destroy`, and `ci.access.grant` on a human
approval quorum being reached within a configured time window. Uses the shipped GAP HITL
workflow with multi-approver semantics. Ensures that high-blast-radius actions require explicit
human authorization from multiple parties.

**Args schema:**

```json
{
  "type": "object",
  "required": ["required_approvers", "approver_group", "approval_window_ms"],
  "properties": {
    "required_approvers": {
      "type": "integer",
      "minimum": 1,
      "description": "Minimum number of distinct approvers required. The gateway verifies that this many unique actor OIDs from approver_group have submitted approval signals before allowing invocation."
    },
    "approver_group": {
      "type": "string",
      "description": "String identifier for the approval group. The gateway resolves this to a set of actor OIDs eligible to approve. Resolution is implementation-defined; RECOMMENDED to use a gap:operator_document CDRO encoding the group membership."
    },
    "approval_window_ms": {
      "type": "integer",
      "minimum": 30000,
      "description": "Time window in milliseconds within which the required approvals must be collected. Per core spec Section 8: timeout MUST NOT produce approval for safety_class C capabilities. On timeout without quorum, the gateway MUST produce a denial receipt."
    }
  }
}
```

**Normative evaluation (MUST):** [DESIGN]

A gateway evaluating `change_approval` MUST:

1. On invocation, immediately instantiate a GAP workflow (per core spec Section 8: Workflows)
   with `status: pending` and emit a pending receipt. The workflow is the normative mechanism
   for collecting approvals; the `change_approval` precondition does not define a separate
   approval state machine.
2. Deliver approval requests to all eligible members of `approver_group` via the configured
   channel adapters (per core spec Section 8.2: Defined Channel Kinds). RECOMMENDED channels:
   `slack`, `email`, `mobile_push`, `sse`.
3. Accept approval signals from actors whose OID resolves to the `approver_group` membership.
   The same actor OID MUST NOT be counted as more than one approval (no duplicate counting).
4. The invoking actor MUST NOT serve as an approver for their own invocation (no self-approval,
   per core spec Two-Person Integrity requirements).
5. When `required_approvers` distinct approvals are collected within `approval_window_ms`, the
   gateway MUST emit a terminal receipt with `status: ok` and `compliance_tags: ['hitl_approved']`.
6. If `approval_window_ms` elapses without `required_approvers` approvals, the gateway MUST
   emit a terminal receipt with `status: denied` and `compliance_tags: ['hitl_denied']`. Per
   core spec Section 8.3 (Safety Constraints on Workflow Definitions), timeout MUST NOT produce
   `terminal_outcome: approved` for any `safety_class: C` capability.

The gateway MUST include the OIDs of all collected approval signals in the terminal receipt's
`evidence_oids` array.

**Cache behavior:** No cache. Each invocation triggers a fresh approval workflow. The workflow
instance OID serves as the idempotency anchor.

**Gateway requirement:** MUST evaluate server-side. MUST use the core spec HITL workflow
mechanism (not a custom approval path).

**Failure action:** `hitl` (transitions to pending workflow on invocation; see evaluation above).

---

## 4. CDRO Type Registry

### 4.1 `ci:build_provenance` [DESIGN]

**Purpose:** Anchors a build artifact to its full provenance chain, recording the builder
identity, source commit, SLSA level, and a hash of the full SLSA provenance document. Forms the
evidentiary root for the `build_provenance` precondition kind (Section 3.1) and for downstream
artifact promotion and deploy decisions.

**Signing requirement:** MUST be signed by the gateway at issuance.

**Body schema:**

| Field                   | Type    | Required | Description                                                                         |
|-------------------------|---------|----------|-------------------------------------------------------------------------------------|
| `artifact_digest`       | string  | yes      | `sha256:<hex>` of the artifact (OCI image digest, tarball hash, or equivalent)     |
| `artifact_name`         | string  | yes      | Human-readable artifact name (e.g. `myorg/myservice:v1.2.3`)                       |
| `build_id`              | string  | yes      | Stable identifier for this build run (e.g. GitHub Actions run ID, Tekton PipelineRun name) |
| `builder_id`            | string  | yes      | Identifier for the builder entity (e.g. `github-actions/runner@v2`, `tekton/pipeline@sha256:...`) |
| `build_trigger_actor_oid` | string | yes   | OID of the actor that triggered the build (the invoking actor's OID for `ci.build.trigger`) |
| `source_repo_hash`      | string  | yes      | `sha256:<hex>` of the source commit that produced this artifact                     |
| `build_started_at_ms`   | integer | yes      | Unix epoch milliseconds when the build started                                      |
| `build_finished_at_ms`  | integer | yes      | Unix epoch milliseconds when the build finished                                     |
| `slsa_level`            | integer | yes      | SLSA provenance level achieved: `1`, `2`, or `3`                                   |
| `provenance_doc_hash`   | string  | yes      | `sha256:<hex>` of the full SLSA provenance document (e.g. the in-toto attestation) |
| `grant_oid`             | string  | yes      | OID of the grant that authorized the build action that produced this CDRO           |

**OID computation:** `sha256(canonical({artifact_digest, build_id, builder_id, source_repo_hash, build_trigger_actor_oid, build_started_at_ms, build_finished_at_ms, slsa_level, provenance_doc_hash, grant_oid}))`.

The `artifact_name` field is excluded from OID computation to allow human-readable name changes
without invalidating the provenance chain. The artifact digest is the stable identity.

**Chain requirements:** MUST reference `grant_oid`. When an artifact is promoted or deployed,
the promotion or deploy invocation MUST reference this CDRO's OID via the `build_provenance`
precondition's `provenance_oid` arg, forming the chain: build -> provenance -> promotion -> deploy.

---

### 4.2 `ci:vulnerability_scan_result` [DESIGN]

**Purpose:** Records the result of a vulnerability scan for an artifact at a point in time,
including the scanner identity, finding counts by severity, and a hash of the full scan report.
Forms the evidentiary basis for the `vulnerability_scan` precondition kind (Section 3.2).

**Signing requirement:** MUST be signed by the gateway at issuance.

**Body schema:**

| Field               | Type    | Required | Description                                                                                          |
|---------------------|---------|----------|------------------------------------------------------------------------------------------------------|
| `artifact_digest`   | string  | yes      | `sha256:<hex>` of the scanned artifact, matching the artifact the scan was performed against         |
| `scanner_id`        | string  | yes      | Scanner identifier including version (e.g. `grype@0.74.0`, `trivy@0.50.0`)                          |
| `scanner_version`   | string  | yes      | Scanner version string (for display and audit; the version is also embedded in `scanner_id`)        |
| `scanned_at_ms`     | integer | yes      | Unix epoch milliseconds when the scan was performed                                                  |
| `critical_count`    | integer | yes      | Number of critical severity findings (non-negative)                                                  |
| `high_count`        | integer | yes      | Number of high severity findings (non-negative)                                                      |
| `medium_count`      | integer | yes      | Number of medium severity findings (non-negative, informative only)                                  |
| `result`            | string  | yes      | `"pass"` or `"fail"`. Pass/fail is determined by the scanning integration, not by this CDRO alone. The `vulnerability_scan` precondition also applies its own threshold checks. |
| `scan_report_hash`  | string  | yes      | `sha256:<hex>` of the full scan report (e.g. JSON output from the scanner). The raw report is stored separately; this hash anchors the CDRO to the full report without embedding it. |
| `grant_oid`         | string  | yes      | OID of the grant that authorized the scan action                                                     |

**OID computation:** `sha256(canonical({artifact_digest, scanner_id, scanned_at_ms, critical_count, high_count, medium_count, result, scan_report_hash, grant_oid}))`.

The `scanner_version` field is excluded from OID computation because it is already embedded in
`scanner_id`. Excluding it prevents OID divergence in implementations that populate both fields
differently.

**Chain requirements:** MUST reference `grant_oid`. When the `vulnerability_scan` precondition
evaluates this CDRO, the precondition receipt MUST include this CDRO's OID in `evidence_oids`.

---

### 4.3 `ci:secret_access` [DESIGN]

**Purpose:** Records a secrets manager access event without exposing the secret value or the raw
secret path. The secret path is replaced with a keyed HMAC token using a per-tenant KMS-backed
key, ensuring that the audit trail is non-repudiable and the path is correlatable by authorized
parties with key access, but the raw path never appears in any CDRO, receipt, or log.

**Signing requirement:** MUST be signed by the gateway at issuance.

**Body schema:**

| Field                  | Type    | Required | Description                                                                                                                                                     |
|------------------------|---------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `secret_path_hmac`     | string  | yes      | Keyed HMAC of the secret path using a per-tenant KMS-backed key. MUST be computed as `HMAC-SHA256(kms_key, secret_path)`, encoded as hex. The raw path MUST NEVER appear in this field or any other field of this CDRO. |
| `secret_manager`       | string  | yes      | One of: `aws_secrets_manager`, `hashicorp_vault`, `azure_keyvault`, `gcp_secret_manager`                                                                       |
| `accessor_actor_oid`   | string  | yes      | OID of the actor that accessed the secret                                                                                                                       |
| `accessed_at_ms`       | integer | yes      | Unix epoch milliseconds when the secret was accessed                                                                                                            |
| `grant_oid`            | string  | yes      | OID of the grant that authorized the `ci.secret.read` invocation                                                                                               |
| `purpose`              | string  | yes      | Human-readable, non-sensitive description of why the secret was accessed (e.g. `"deploy-time DB credentials for staging environment"`). MUST NOT contain the secret value or any portion of the path. |

**OID computation:** `sha256(canonical({secret_path_hmac, secret_manager, accessor_actor_oid, accessed_at_ms, grant_oid, purpose}))`.

**Chain requirements:** MUST reference `grant_oid`. This CDRO MUST be created at the same time
as the invocation receipt for `ci.secret.read`. The receipt's `evidence_oids` MUST include the
OID of this CDRO.

**Security note on the HMAC pattern:**

The raw secret path is never stored in any CDRO because secret paths frequently encode sensitive
topology information: paths such as `prod/payments/stripe/api_key` reveal both the environment
and the service dependency graph. Storing paths in receipts or invocation CDROs would create an
audit trail that itself becomes an attack surface.

The keyed HMAC pattern provides four properties simultaneously:

1. Correlation: authorized parties holding the KMS key can re-derive the HMAC from any known
   path and confirm whether it was accessed, enabling targeted investigation.
2. Non-repudiation: the HMAC is deterministic and gateway-signed, so it cannot be fabricated
   without the KMS key.
3. Irreversibility: the HMAC cannot be reversed to recover the path without the KMS key.
4. Auditability: the signed CDRO chain establishes who accessed what (by HMAC), when, under
   which grant, and for what stated purpose, without requiring the path to be readable from
   the CDRO alone.

A gateway MUST use a KMS-backed key for this HMAC (not an in-memory or config-file key) so
that the key is never exposed in plaintext and access to the key itself is auditable.

---

## 5. Conformance Requirements

A gateway claiming `gap-supply-chain-00` profile support MUST:

1. **Build provenance on artifact promotion:** Evaluate the `build_provenance` precondition kind
   per Section 3.1 for any `ci.artifact.promote` capability invocation where the precondition
   is present in the grant.

2. **Build provenance on production deploy:** Evaluate the `build_provenance` precondition kind
   per Section 3.1 for any `ci.deploy.production` capability invocation where the precondition
   is present in the grant.

3. **Vulnerability scan on production deploy:** Evaluate the `vulnerability_scan` precondition
   kind per Section 3.2 for any `ci.deploy.production` capability invocation where the
   precondition is present in the grant.

4. **Change approval on production deploy, infra destroy, and access grant:** Evaluate the
   `change_approval` precondition kind per Section 3.3 for `ci.deploy.production`,
   `ci.infra.destroy`, and `ci.access.grant` capability invocations where the precondition is
   present in the grant.

5. **Secret path HMAC:** Store `ci:secret_access` CDROs with the `secret_path_hmac` field
   populated using a keyed HMAC per Section 4.3. The raw secret path MUST NEVER appear in any
   field of the CDRO, the invocation CDRO, or the decision receipt.

6. **KMS-backed HMAC key:** Use a KMS-backed key (AWS KMS, HashiCorp Vault Transit, Azure Key
   Vault, or GCP Cloud KMS) for computing the `secret_path_hmac`. In-memory or plaintext
   config-file keys MUST NOT be used.

7. **Accept and validate profile CDRO types:** Accept, validate, and store `ci:build_provenance`,
   `ci:vulnerability_scan_result`, and `ci:secret_access` CDRO bodies per Section 4.

8. **Enforce `ci.*` scope rules:** Enforce capability safety class and `require_signed_receipt`
   settings per Section 2 for all `ci.*` capabilities.

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L3",
  "profiles": ["gap-supply-chain-00"]
}
```

**Minimum required core tier:** L3. The `change_approval` precondition requires HITL workflow
support, which is an L3 feature. Gateways at L1 or L2 MUST NOT claim `gap-supply-chain-00`
conformance.

### 5.1 Precondition composition note

The `build_provenance` and `vulnerability_scan` preconditions are independent and SHOULD be
composed together on `ci.deploy.production`. A grant may require both:

```json
{
  "additional_preconditions": [
    { "kind": "build_provenance", "args": { ... } },
    { "kind": "vulnerability_scan", "args": { ... } },
    { "kind": "change_approval", "args": { ... } }
  ]
}
```

When multiple preconditions are present, the gateway MUST evaluate all of them before allowing
the invocation. Failure of any one precondition MUST deny the invocation. The denial receipt
MUST identify which precondition failed in the `detail` field.

---

## 6. Informative Examples

### 6.1 Production deploy declaration with all three preconditions

A full `gap:capability_declaration` (shown as a grant `capability_scopes` fragment for brevity)
with `build_provenance`, `vulnerability_scan`, and `change_approval` preconditions on
`ci.deploy.production`:

```json
{
  "type": "gap:capability_grant",
  "grantee": {
    "actor_oid": "sha256:d3a9...",
    "actor_type": "agent"
  },
  "capability_scopes": [
    {
      "capability": "ci.deploy.production",
      "capability_declaration_oid": "sha256:f1b2...",
      "additional_preconditions": [
        {
          "kind": "build_provenance",
          "args": {
            "slsa_level": 2,
            "provenance_oid": "sha256:a7c4...",
            "builder_allowlist": [
              "github-actions/runner@v2",
              "internal-ci/tekton-pipeline@sha256:99fa..."
            ]
          }
        },
        {
          "kind": "vulnerability_scan",
          "args": {
            "scanner_allowlist": ["grype@0.74.0", "trivy@0.50.0"],
            "max_critical": 0,
            "max_high": 0,
            "scan_max_age_ms": 86400000
          }
        },
        {
          "kind": "change_approval",
          "args": {
            "required_approvers": 2,
            "approver_group": "platform-leads",
            "approval_window_ms": 3600000
          }
        }
      ]
    }
  ]
}
```

### 6.2 ci:build_provenance CDRO

A `ci:build_provenance` CDRO issued at the completion of a GitHub Actions build:

```json
{
  "oid": "sha256:a7c4...",
  "type": "ci:build_provenance",
  "gap_version": "1.0",
  "tenant_id": "tenant_acme_platform",
  "created_at_ms": 1750001200000,
  "created_by": "sha256:d3a9...",
  "body": {
    "artifact_digest": "sha256:3b9f8c2d1e4a7b6c0d5e2f1a8b3c9d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a0b",
    "artifact_name": "myorg/myservice:v2.4.1",
    "build_id": "github-actions-run-12345678",
    "builder_id": "github-actions/runner@v2",
    "build_trigger_actor_oid": "sha256:d3a9...",
    "source_repo_hash": "sha256:7f3a1b9c2d4e6f8a0b2c4d6e8f0a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f",
    "build_started_at_ms": 1750000800000,
    "build_finished_at_ms": 1750001200000,
    "slsa_level": 2,
    "provenance_doc_hash": "sha256:9d2e4a6b8c0f2d4e6a8b0c2d4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f",
    "grant_oid": "sha256:c8b7..."
  },
  "signature": "base64url...",
  "signature_key_id": "gateway-key-2026-06",
  "signature_algorithm": "Ed25519"
}
```

### 6.3 ci:secret_access CDRO (HMAC pattern, no raw path)

A `ci:secret_access` CDRO recorded when a deploy agent reads a database credential. The raw
secret path (`prod/payments/postgresql/app_user`) never appears in the CDRO:

```json
{
  "oid": "sha256:8e1f...",
  "type": "ci:secret_access",
  "gap_version": "1.0",
  "tenant_id": "tenant_acme_platform",
  "created_at_ms": 1750002000000,
  "created_by": "sha256:d3a9...",
  "body": {
    "secret_path_hmac": "b4c9d2e1f3a5b7c0d2e4f6a8b0c1d3e5f7a9b2c4d6e8f0a1b3c5d7e9f0a1b3",
    "secret_manager": "aws_secrets_manager",
    "accessor_actor_oid": "sha256:d3a9...",
    "accessed_at_ms": 1750002000000,
    "grant_oid": "sha256:f2d1...",
    "purpose": "deploy-time PostgreSQL credentials for payments service production environment"
  },
  "signature": "base64url...",
  "signature_key_id": "gateway-key-2026-06",
  "signature_algorithm": "Ed25519"
}
```

The raw path `prod/payments/postgresql/app_user` is computable by any authorized party with
access to the tenant KMS key: `HMAC-SHA256(kms_key, "prod/payments/postgresql/app_user")`.
Without the KMS key, the path cannot be recovered from the HMAC.

---

## Appendix A: Relationship to the core-spec `build_provenance` precondition kind

The core spec (draft-shovan-gap-00) precondition kind registry defines a set of built-in kinds
(`time_window`, `rate_limit`, `sanctions_screening`, `external_pip`, `inventory_check`,
`token_budget`, `consent_current`). It does not define a `build_provenance` kind.

The `build_provenance` precondition kind introduced in Section 3.1 of this profile IS the
normative definition of that kind for the GAP ecosystem. If a future revision of the core spec
absorbs `build_provenance` into the core precondition registry, this profile's Section 3.1 will
be superseded by the core-spec definition, and a `gap-supply-chain-01.md` will note the change.

Until that absorption occurs: any gateway wishing to implement build provenance verification
MUST use the `build_provenance` kind as defined in this profile, not an ad hoc custom kind.
Third-party profiles that also need build provenance gating SHOULD reference this profile's
`build_provenance` kind directly (by name, citing `gap-supply-chain-00`) rather than defining
their own variant, to ensure interoperability.

There is no conflict between this profile's `build_provenance` kind and the core spec's
`external_pip` kind. A gateway MAY implement build provenance verification as an `external_pip`
pointing to a SLSA verifier endpoint, but this is ADVISORY (unsigned external reads) unless the
verifier returns a signed `gap:pip_response`. The `build_provenance` kind in this profile
defines the ENFORCING path with its own normative evaluation semantics and signed
`gap:pip_response` caching.

---

## Appendix B: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                         | Class | Notes                                                         |
|-----------------------------------------|-------|---------------------------------------------------------------|
| `ci.deploy.canary.advance`              | C     | Advance a canary deployment to a higher traffic percentage    |
| `ci.deploy.canary.abort`               | C     | Abort a canary deployment and revert to stable               |
| `ci.deploy.feature_flag.enable`        | B     | Enable a feature flag in production                          |
| `ci.deploy.feature_flag.disable`       | B     | Disable a feature flag in production                         |
| `ci.artifact.quarantine`               | C     | Mark an artifact as quarantined (block all promotions)       |
| `ci.artifact.unquarantine`             | C     | Lift a quarantine on an artifact                             |
| `ci.pipeline.disable`                  | C     | Disable a CI/CD pipeline (stops all new runs)                |
| `ci.pipeline.enable`                   | B     | Re-enable a disabled pipeline                                |
| `ci.secret.create`                     | C     | Create a new secret in a secrets manager                     |
| `ci.secret.delete`                     | C     | Delete a secret (irreversible)                               |
| `ci.access.revoke`                     | C     | Revoke access to a resource or system                        |
| `ci.scan.dependency.check`             | A     | Query dependency scan results for an artifact                |
| `ci.scan.sast.run`                     | B     | Trigger a static analysis security scan                      |
| `ci.scan.dast.run`                     | C     | Trigger a dynamic analysis security scan against production  |
| `ci.infra.scale`                       | B     | Scale infrastructure resources up or down                    |
| `ci.infra.patch`                       | C     | Apply a patch or upgrade to infrastructure resources         |
| `ci.registry.mirror`                   | B     | Mirror an artifact between registries                        |
| `ci.registry.delete`                   | C     | Delete an artifact from a registry (may be irreversible)     |
| `ci.signing.key.rotate`                | C     | Rotate an artifact signing key                               |
| `ci.attestation.policy.update`         | C     | Update a SLSA or in-toto attestation policy                  |
