# GAP Companion Profile: Healthcare

**Draft:** gap-healthcare-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `hc.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol (GAP) for healthcare, medical devices,
clinical trials, electronic health record (EHR) systems, and telehealth platforms. It registers
the `hc.*` capability namespace, two normative precondition kinds (`prescriber_credential`,
`clinical_cosign_required`), and two CDRO types for clinical order chains and adverse event
records.

A healthcare operator adopting this profile gets:

- Every medication order, lab request, and clinical procedure governed by a signed, immutable
  receipt chain, displacing mutable audit tables and paper co-signature logs that cannot prove
  after-the-fact what credential backed an order
- Prescriber credential verification bound cryptographically to the grant chain: the evidence
  package needed to satisfy audit obligations under 21 CFR Part 11 and the DEA Practitioner's
  Manual without storing raw license numbers in CDRO bodies
- Clinical cosignature enforced as a first-class HITL workflow stage before an order is allowed,
  with a signed receipt of who co-signed and when
- Adverse event reports chained to the original care-action grant and patient token, making the
  full governance lineage replayable independently of any mutable database
- Medical device commands governed at L4 minimum per core spec section Conformance by Sector,
  with mandatory signed receipts on every command invocation

**Status note:** All capability names, precondition kinds, and CDRO types in this profile carry
status [DESIGN]. No conformance vectors exist yet against a deployed implementation. The
credential verification and cosign workflow semantics are derived from the core spec's HITL and
identity-binding mechanisms and are normatively specifiable, but have not been independently
tested in a production clinical environment.

This profile composes freely with other profiles. An EHR vendor running a CI/CD pipeline can
activate `gap-healthcare-00` and `gap-supply-chain-00` simultaneously; the namespaces do not
conflict. The `consent_current` precondition from the core spec composes directly with
`hc.patient.consent.record` (see Section 6.3 for a composed example).

---

## 2. Capability Taxonomy

Capability names use the `hc.` root. Sub-namespaces are open; operators may extend any
branch (e.g., `hc.order.medication.titrate`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition for healthcare context                                                         |
|-------|-------------------------------------------------------------------------------------------|
| A     | Read-only queries (patient record read, device status poll, trial enrollment status read) |
| B     | State-changing but reversible or lower-acuity actions (lab request, imaging request, telehealth session start, device alert acknowledge) |
| C     | Irreversible or high-acuity actions (medication prescribe/dispense, cosign, patient consent record, trial enrollment approve, adverse event report, device command issue) |

### 2.2 Core capability names

| Capability name                     | Class | require_signed_receipt | Notes                                                        |
|-------------------------------------|-------|------------------------|--------------------------------------------------------------|
| `hc.order.medication.prescribe`     | C     | true                   | Prescriber issues a medication order                         |
| `hc.order.medication.dispense`      | C     | true                   | Pharmacy dispenses a medication against a prescriber order   |
| `hc.order.lab.request`              | B     | false                  | Clinician requests a laboratory test                         |
| `hc.order.imaging.request`          | B     | false                  | Clinician requests a diagnostic imaging study                |
| `hc.order.cosign`                   | C     | true                   | Supervisory provider co-signs a resident or NP order         |
| `hc.patient.record.read`            | A     | false                  | Read patient record (EHR access); PHI, use `pii_args`        |
| `hc.patient.record.amend`           | B     | true                   | Amend a patient record entry with reason and attribution     |
| `hc.patient.consent.record`         | C     | true                   | Record patient consent or consent withdrawal                 |
| `hc.trial.enrollment.approve`       | C     | true                   | Approve a subject's enrollment in a clinical trial           |
| `hc.trial.data.submit`              | B     | true                   | Submit trial observation data for a subject                  |
| `hc.device.command.issue`           | C     | true                   | Issue a command to a medical device (pump, ventilator, etc.) |
| `hc.device.alert.acknowledge`       | B     | false                  | Acknowledge a device-generated clinical alert                |
| `hc.telehealth.session.start`       | B     | false                  | Start a telehealth session between clinician and patient     |
| `hc.adverse_event.report`           | C     | true                   | Report a serious adverse event (SAE) or adverse device effect |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

**PHI handling:** Capabilities in this namespace that carry patient identifiers MUST list those
arg keys in `pii_args` on the declaration so the gateway tokenizes them before constructing
CDROs. The canonical JSON used for OID computation is taken from unencrypted args before
tokenization so OID integrity is maintained. The raw patient identifier is available only via
`GET /v1/gap/receipts/:oid?include_pii=true` with elevated authorization.

---

## 3. Precondition Kind Registry

### 3.1 `prescriber_credential` [DESIGN]

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates any `hc.order.*` capability on the invoking actor having a current, verified
prescriber credential of the required kind (National Provider Identifier, Drug Enforcement
Administration schedule authorization, or state license). Ensures medication orders, lab
requests, and imaging orders are blocked for actors whose credential cannot be verified or has
expired.

The credential is not transmitted raw. The grant carries a hash of the credential number so
the gateway can compare against the hash embedded in the actor's `identity_binding` (see core
spec Section Identity Binding) without storing the credential number in any CDRO body.

**Args schema:**

```json
{
  "type": "object",
  "required": [
    "required_credential_kind",
    "credential_identifier_hash",
    "issuing_authority",
    "valid_as_of_ms"
  ],
  "properties": {
    "required_credential_kind": {
      "type": "string",
      "enum": ["npi", "dea", "state_license"],
      "description": "The class of credential required. 'npi' = National Provider Identifier (United States); 'dea' = DEA schedule authorization; 'state_license' = state professional license."
    },
    "credential_identifier_hash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$",
      "description": "SHA-256 hash of the credential number string (UTF-8 encoded, no surrounding whitespace). The gateway compares this against the hash in the actor's identity_binding."
    },
    "issuing_authority": {
      "type": "string",
      "description": "Human-readable issuing authority identifier (e.g. 'CMS', 'DEA', 'UT-DOPL'). Informative for audit display; not used in hash comparison."
    },
    "valid_as_of_ms": {
      "type": "integer",
      "minimum": 1,
      "description": "Unix epoch ms. The credential's expires_at_ms in the identity_binding MUST be greater than or equal to this value. Typically set to grant issuance time."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `prescriber_credential` MUST:

1. Locate the active `identity_binding` on the CapabilityDeclaration for the invoking actor
   OID within the tenant.
2. Verify that `identity_binding.credential_kind` equals `professional_license`.
3. Compute `sha256(identity_binding.credential_identifier)` using the UTF-8 encoding of the
   credential_identifier string with no surrounding whitespace, and verify that the result
   equals `args.credential_identifier_hash`.
4. Verify that `identity_binding.expires_at_ms` is present and greater than or equal to
   `args.valid_as_of_ms`.
5. Verify that `identity_binding.binding_signature` is valid per the core spec Identity Binding
   verification rules.

If any check fails, the gateway MUST deny the invocation with `precondition_failed` and
`precondition_kind: "prescriber_credential"` in the receipt.

The gateway MUST NOT contact an external credential verification registry synchronously on
every invocation. The `identity_binding` on the actor's declaration serves as the cached,
signed result. Re-verification frequency is the operator's responsibility through the
declaration supersession mechanism (see core spec Phase 1: Declare, Supersession).

**Cache behavior:** The pass result is valid for the duration of the active declaration's
`identity_binding.expires_at_ms`. No additional cache layer is required beyond the declaration
store.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny`.

---

### 3.2 `clinical_cosign_required` [DESIGN]

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates an `hc.order.*` capability on a supervisory provider co-signing the order
before it is allowed. Intended for orders placed by residents, nurse practitioners, and
physician assistants operating under a supervising physician or attending clinician.

When this precondition is present on a grant, the gateway does not immediately allow the
invocation. Instead, it instantiates an HITL workflow stage targeted at the cosigning provider.
The order is held pending until the cosigner approves (allow) or the cosign window expires
(deny).

**Args schema:**

```json
{
  "type": "object",
  "required": ["cosigner_role", "cosign_window_ms"],
  "properties": {
    "cosigner_role": {
      "type": "string",
      "description": "The role identifier of the required cosigning provider (e.g. 'attending_physician', 'supervising_md', 'clinical_pharmacist'). The gateway resolves the cosigner actor OID from the tenant's role registry. Role registry configuration is implementation-defined."
    },
    "cosign_window_ms": {
      "type": "integer",
      "minimum": 30000,
      "description": "Maximum duration in milliseconds between order submission and cosignature before the order expires. Minimum 30,000 ms (30 seconds) per core spec workflow minimum. Clinical deployments SHOULD set this to a value appropriate to care setting urgency."
    },
    "notify_channel": {
      "type": "string",
      "description": "Optional channel kind (see core spec Channel Adapters) to use for cosigner notification. If absent, the gateway applies its configured default notification channel."
    },
    "escalation_actor_oid": {
      "type": "string",
      "description": "Optional actor OID to receive a secondary notification if the cosign_window_ms is 50% elapsed without a cosigner response."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `clinical_cosign_required` MUST:

1. Resolve the cosigning provider actor OID from the tenant's role registry using
   `args.cosigner_role`. If no actor is registered for that role, MUST deny with
   `precondition_failed` and detail `cosigner_role_unresolved`.
2. Instantiate an HITL workflow stage with:
   - `authorized_approvers`: `[cosigner_actor_oid]`
   - `duration_seconds`: `ceil(args.cosign_window_ms / 1000)`
   - `on_timeout.action`: `deny` (timeout MUST NOT approve per core spec Safety Constraints on
     Workflow Definitions for safety_class C)
3. Deliver a cosign request notification to the cosigning provider via `args.notify_channel`
   (or the gateway default if absent).
4. If `args.escalation_actor_oid` is present and 50% of `cosign_window_ms` has elapsed without
   response, deliver a secondary notification to `escalation_actor_oid`.
5. On cosigner approval: issue the `hc.order.cosign` receipt with `status: ok` and
   `compliance_tags: ['hitl_approved', 'safety_class:C']`, then allow the original order
   invocation.
6. On cosigner denial or timeout: issue a `status: denied` receipt with
   `precondition_kind: "clinical_cosign_required"` in the detail.

The same actor OID MUST NOT serve as both the order submitter and the cosigner (no
self-approval, per core spec Two-Person Integrity).

**Cache behavior:** 0 seconds. Every order invocation subject to this precondition MUST
initiate a fresh HITL workflow stage. The `consent_current` no-cache rule applies
analogously here.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `hitl`.

---

## 4. CDRO Type Registry

### 4.1 `hc:clinical_order_chain` [DESIGN]

**Purpose:** Links the consent, prescriber credential verification, formulary check, order, and
pharmacy/lab/imaging verification CDROs into a single auditable chain. Each node in the chain
references its predecessor via `prior_node_oid`, making the full governance lineage replayable
from any node.

This type is the primary audit artifact for an `hc.order.medication.prescribe` +
`hc.order.medication.dispense` workflow. It is also used for lab and imaging order chains where
fewer steps apply.

**Signing requirement:** MUST be signed.

**Body schema:**

| Field                    | Type    | Required | Description                                                                              |
|--------------------------|---------|----------|------------------------------------------------------------------------------------------|
| `patient_oid`            | string  | yes      | Tokenized patient identifier (HMAC token; the raw MRN or patient ID MUST NOT appear here) |
| `order_type`             | string  | yes      | One of: `medication`, `lab`, `imaging`, `procedure`                                      |
| `prescriber_actor_oid`   | string  | yes      | Actor OID of the prescriber or ordering clinician                                        |
| `encounter_id_hash`      | string  | yes      | `sha256:<hex>` of the encounter or visit identifier                                      |
| `chain_root_oid`         | string  | yes      | OID of the first node in this chain (equals own OID for step 0)                         |
| `chain_step`             | integer | yes      | Zero-based step index within the chain                                                   |
| `formulary_check_oid`    | string  | no       | OID of the formulary check CDRO or external PIP response, if applicable                 |
| `prior_node_oid`         | string  | no       | OID of the preceding chain node (absent for step 0)                                     |

**OID computation:** `sha256(canonical({patient_oid, order_type, prescriber_actor_oid, encounter_id_hash, chain_step}))`.
The `formulary_check_oid` and `prior_node_oid` fields are excluded from the OID hash. They are
structural links and must not alter the content-addressed identity of the chain node itself.

**Chain requirements:** Step 0 MUST have `chain_root_oid` equal to its own OID and no
`prior_node_oid`. Every subsequent step MUST set `prior_node_oid` to the OID of the previous
step and `chain_root_oid` to the step-0 OID. The dispense or fulfillment node is the terminal
step and MUST reference the order node as `prior_node_oid`.

**Typical chain for a medication order:**

| Step | chain_step | Node represents          | Key prior_node_oid target |
|------|------------|--------------------------|---------------------------|
| 0    | 0          | Consent record           | (none; chain root)        |
| 1    | 1          | Prescriber credential check | step 0 OID            |
| 2    | 2          | Formulary/drug check     | step 1 OID                |
| 3    | 3          | Medication order (prescribe) | step 2 OID            |
| 4    | 4          | Cosign (if required)     | step 3 OID                |
| 5    | 5          | Dispense                 | step 3 or 4 OID           |

---

### 4.2 `hc:adverse_event` [DESIGN]

**Purpose:** Records a serious adverse event (SAE) or adverse device effect with the full
governance chain. The report chains back to the original grant that authorized the care action
being reported, making it possible to reconstruct the complete authority lineage from report
back to prescriber credential.

This type is intended to support audit obligations under 21 CFR Part 803 (medical device
adverse event reporting) and FDA MedWatch workflows. It does not replace regulatory submission;
it provides the governance-chain artifact that supports the submission.

**Signing requirement:** MUST be signed.

**Body schema:**

| Field               | Type    | Required | Description                                                                                      |
|---------------------|---------|----------|--------------------------------------------------------------------------------------------------|
| `patient_oid`       | string  | yes      | Tokenized patient identifier (HMAC token; raw identifier MUST NOT appear here)                   |
| `event_code`        | string  | yes      | MedDRA code (e.g. `10053692`) or equivalent controlled vocabulary code identifying the event type |
| `severity`          | string  | yes      | One of: `mild`, `moderate`, `severe`, `life_threatening`, `fatal`                               |
| `reporter_actor_oid`| string  | yes      | Actor OID of the clinician or device submitting the report                                       |
| `reported_at_ms`    | integer | yes      | Unix epoch ms when the event was reported (not when it occurred)                                 |
| `trial_oid`         | string  | no       | OID of the clinical trial grant or trial enrollment CDRO, for trial-context events              |
| `device_oid`        | string  | no       | OID of the device declaration or device command receipt, for device-related events              |
| `prior_event_oid`   | string  | no       | OID of a prior `hc:adverse_event` CDRO this record updates or follows up (follow-up report)    |

**OID computation:** `sha256(canonical({patient_oid, event_code, severity, reporter_actor_oid, reported_at_ms}))`.
The optional fields `trial_oid`, `device_oid`, and `prior_event_oid` are excluded from the OID
hash to allow follow-up reports to carry new chain references without altering the canonical
identity of the original event.

**Chain requirements:** When `prior_event_oid` is present, the referenced CDRO MUST be an
`hc:adverse_event` for the same `patient_oid`. The gateway SHOULD verify this constraint at
acceptance time. The adverse event CDRO SHOULD be linked to the `hc:clinical_order_chain` node
for the care action being reported (via the `device_oid` or `trial_oid` fields, or by operator
convention in the invocation args).

---

## 5. Conformance Requirements

A gateway claiming `gap-healthcare-00` profile support MUST:

1. Evaluate the `prescriber_credential` precondition kind per Section 3.1 for any capability in
   the `hc.order.*` namespace where the precondition is present in the grant.
2. Evaluate the `clinical_cosign_required` precondition kind per Section 3.2 and instantiate
   the required HITL workflow stage before allowing the order invocation.
3. Accept, validate, and store `hc:clinical_order_chain` CDROs per Section 4.1, including
   verifying that step-0 `chain_root_oid` equals the step-0 OID and that each subsequent step
   carries a valid `prior_node_oid`.
4. Enforce L4 MINIMUM for the `hc.device.command.issue` capability, per core spec Conformance
   by Sector (Medical device / clinical, 21 CFR Part 11). An L3 deployment is non-conformant
   for device command governance.
5. Enforce L2 MINIMUM for all other `hc.*` capabilities.

A gateway claiming `gap-healthcare-00` profile support SHOULD:

6. Accept and store `hc:adverse_event` CDROs per Section 4.2.
7. Emit a compliance tag of `phi` on every receipt for a capability where
   `privacy_classification: phi` is declared, per core spec Compliance Tags.
8. Populate `signer_identity` on every receipt for an `hc.order.*` class C capability
   (core spec GapDecisionReceiptBody), to support audit obligations under 21 CFR Part 11
   Section 11.50 electronic signature display requirements.

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L4",
  "profiles": ["gap-healthcare-00"]
}
```

A gateway MAY claim `gap-healthcare-00` at core tier L2 for deployments that exclude
`hc.device.command.issue` from their granted capability set. In that case, the profile
declaration SHOULD note the exclusion:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-healthcare-00"],
  "profile_notes": {
    "gap-healthcare-00": "hc.device.command.issue excluded; L4 requirement does not apply"
  }
}
```

### 5.1 PHI tokenization note

Every `hc.*` capability that carries a patient identifier in invocation args MUST list those
arg keys in `pii_args` on the CapabilityDeclaration (core spec Phase 1: Declare). The gateway
tokenizes listed arg values before constructing the invocation CDRO and receipt body.
`hc:clinical_order_chain` and `hc:adverse_event` CDROs carry `patient_oid` which is the
tokenized form; the gateway MUST verify that the `patient_oid` in these CDROs matches the
token it would produce for the patient identifier in the originating invocation.

### 5.2 Break-glass for clinical emergencies

The core spec break-glass mechanism (Revocation section, Break-Glass Grants) applies directly
to emergency clinical scenarios (e.g., device command when gateway is unreachable during a
code). Break-glass grants for `hc.device.command.issue` MUST set `break_glass_requires_reason:
true` so the invoking clinician's emergency rationale is captured in the provisional receipt.
The `break_glass_ttl_ms` RECOMMENDED value for clinical device break-glass is 4 hours (core
spec default), not to be extended without operator policy justification.

---

## 6. Informative Examples

### 6.1 Declaration with prescriber_credential precondition on medication order

```json
{
  "type": "gap:capability_declaration",
  "actor_type": "human_user",
  "actor_id": "md-jane-smith-npi-1234567890",
  "actor_name": "Dr. Jane Smith",
  "actor_version": "1.0.0",
  "identity_binding": {
    "credential_kind": "professional_license",
    "credential_identifier": "1234567890",
    "binding_signature": "MEYCIQDx...",
    "binding_alg": "Ed25519",
    "bound_at_ms": 1750000000000,
    "issuer": "CMS/NPPES",
    "expires_at_ms": 1781536000000
  },
  "capabilities": [
    {
      "capability": "hc.order.medication.prescribe",
      "safety_class": "C",
      "physical_safety": false,
      "require_signed_receipt": true,
      "privacy_classification": "phi",
      "pii_args": ["patient_id", "medication_name", "patient_dob"],
      "description": "Prescribe a medication order for a patient"
    }
  ]
}
```

Grant with prescriber_credential precondition:

```json
{
  "type": "gap:capability_grant",
  "grantee": {
    "actor_oid": "sha256:a3f1...",
    "actor_type": "human_user"
  },
  "capability_scopes": [
    {
      "capability": "hc.order.medication.prescribe",
      "capability_declaration_oid": "sha256:b9c2...",
      "additional_preconditions": [
        {
          "kind": "prescriber_credential",
          "args": {
            "required_credential_kind": "npi",
            "credential_identifier_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
            "issuing_authority": "CMS/NPPES",
            "valid_as_of_ms": 1750000000000
          }
        }
      ]
    }
  ],
  "granted_at_ms": 1750000000000,
  "granted_by": "sha256:operator-oid...",
  "expires_at_ms": 1781536000000
}
```

### 6.2 Clinical order chain CDRO (medication order, step 3 of 5)

This is the order node in a five-step chain (consent, credential check, formulary check, order,
dispense). The consent node (step 0) is the chain root.

```json
{
  "type": "hc:clinical_order_chain",
  "patient_oid": "hmac:sha256:patient-token-f3a9...",
  "order_type": "medication",
  "prescriber_actor_oid": "sha256:a3f1...",
  "encounter_id_hash": "sha256:e8d4a5...",
  "chain_root_oid": "sha256:c0001...",
  "chain_step": 3,
  "formulary_check_oid": "sha256:fc002...",
  "prior_node_oid": "sha256:fc002..."
}
```

The chain root (step 0, consent record) would be a `gap:consent_record` CDRO with
`context: "clinical.medication_order"` referencing this patient and encounter.

### 6.3 Telehealth session start with time_window precondition (composed)

This example composes the shipped `time_window` precondition from the core spec (Section
Precondition Kind Registry) with the `hc.telehealth.session.start` capability. Telehealth
sessions are restricted to clinic hours (Monday to Friday, 08:00 to 20:00 UTC).

```json
{
  "type": "gap:capability_grant",
  "grantee": {
    "actor_oid": "sha256:telehealth-platform-oid...",
    "actor_type": "service"
  },
  "capability_scopes": [
    {
      "capability": "hc.telehealth.session.start",
      "capability_declaration_oid": "sha256:d4e5...",
      "additional_preconditions": [
        {
          "kind": "time_window",
          "args": {
            "days_of_week": [1, 2, 3, 4, 5],
            "start_hour_utc": 8,
            "end_hour_utc": 20
          }
        }
      ],
      "scope_narrowing": {
        "session_type": ["video", "audio"],
        "max_duration_minutes": 60
      }
    }
  ],
  "granted_at_ms": 1750000000000,
  "granted_by": "sha256:operator-oid...",
  "expires_at_ms": 1757862400000
}
```

For emergency telehealth outside clinic hours, a separate break-glass grant with
`break_glass: true` and `break_glass_requires_reason: true` covers the after-hours pathway.

---

## Appendix: Suggested capability taxonomy extensions (non-normative)

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                          | Class | Notes                                                              |
|------------------------------------------|-------|--------------------------------------------------------------------|
| `hc.order.medication.discontinue`        | C     | Discontinue an active medication order                             |
| `hc.order.medication.refill.authorize`   | C     | Authorize a refill on an existing prescription                     |
| `hc.order.procedure.schedule`            | B     | Schedule a clinical procedure                                      |
| `hc.order.referral.issue`               | B     | Issue a referral to a specialist or facility                       |
| `hc.device.firmware.update`             | C     | Authorize a firmware update on an implanted or connected device    |
| `hc.device.calibration.initiate`        | B     | Initiate a calibration cycle on a connected device                 |
| `hc.device.alarm.suppress`              | C     | Suppress a device alarm (requires signed receipt + audit reason)   |
| `hc.trial.protocol.amend`               | C     | Amend an active clinical trial protocol                            |
| `hc.trial.subject.withdraw`             | B     | Record withdrawal of a trial subject                               |
| `hc.trial.data.lock`                    | C     | Lock a trial dataset for regulatory submission                     |
| `hc.patient.identity.verify`            | B     | Verify patient identity before care action (HITL biometric match)  |
| `hc.prescription.eprescribe.transmit`   | C     | Transmit an e-prescription to a pharmacy via NCPDP SCRIPT          |
| `hc.prior_auth.submit`                  | B     | Submit a prior authorization request to a payer                    |
| `hc.prior_auth.approve`                 | C     | Approve a prior authorization (payer-side actor)                   |
| `hc.diagnosis.code`                     | B     | Assign a diagnostic code (ICD-10 or equivalent) to an encounter    |
