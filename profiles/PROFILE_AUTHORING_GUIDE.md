# GAP Companion Profile Authoring Guide

A companion profile extends the Governed Action Protocol (GAP) for a specific sector or
deployment context. Profiles add vocabulary (capability namespaces, precondition kinds, CDRO
types) without modifying the core spec. A conformant GAP gateway only needs to implement the
core; profile support is declared and opt-in.

## Who can author a profile

Anyone. SynOI publishes first-party profiles under CC0. Third parties (standards bodies,
platform vendors, open-source projects, enterprise operators) can publish profiles independently.
A profile does not require SynOI approval; it only requires a unique namespace prefix and
conformance to the extension contracts below.

## What a profile can add

| Extension point       | Mechanism                                    | Constraint                                    |
|-----------------------|----------------------------------------------|-----------------------------------------------|
| Capability namespace  | Dot-path prefix registration (`game.*`)      | Must not start with `gap:` (reserved for core)|
| Precondition kinds    | New `kind` values in the precondition registry | Must define normative evaluation semantics  |
| CDRO types            | New `type` values in the CDRO envelope       | Must define canonical body schema             |
| Conformance tiers     | Profile-level tier requirements              | Must build on, not replace, core tiers        |
| Informative examples  | JSON blocks                                  | No constraints                                |

## What a profile cannot do

- Redefine or override core CDRO types (`gap:decision_receipt`, `gap:capability_grant`, `gap:capability_declaration`, etc.)
- Override the four-phase lifecycle (Declare, Grant, Invoke, Receipt)
- Override OID computation (`sha256(canonical(payload))`)
- Override core signature verification rules
- Claim conformance levels below L1

## Namespace registration

Every profile registers a root namespace prefix. All capability names, precondition kinds, and
CDRO types introduced by the profile MUST be contained within that prefix or namespaced with a
profile-specific string that cannot collide with `gap:` core types.

Recommended convention for CDRO types in profiles: use the profile namespace as a prefix
(`gaming:anti_cheat_assertion`, `hc:clinical_order`) rather than `gap:`, reserving `gap:` for
core-spec types. Alternatively, register with SynOI to get a `gap-[profile]:` prefix for
official first-party profiles.

## Profile document structure

```
# GAP Companion Profile: [Human Name]
Draft: gap-[slug]-[version].md
Base spec: draft-shovan-gap-[version] or later
Namespace: [slug].*
Status: Draft | Proposed | Community | Official

## 1. Overview
## 2. Capability Taxonomy
## 3. Precondition Kind Registry
## 4. CDRO Type Registry
## 5. Conformance Requirements
## 6. Informative Examples
```

## Section 2: Capability Taxonomy

Define every capability name the profile introduces. Each entry specifies:

| Field               | Required | Description                                          |
|---------------------|----------|------------------------------------------------------|
| `name`              | yes      | Full dot-path name (`game.economy.item.transfer`)    |
| `safety_class`      | yes      | A / B / C (same classification as core spec)         |
| `default_require_signed_receipt` | yes | bool |                                      |
| `default_pii_args`  | no       | Array of arg paths treated as PII                    |
| `notes`             | no       | Informative usage note                               |

## Section 3: Precondition Kind Registry

For each new precondition kind:

| Field               | Required | Description                                                      |
|---------------------|----------|------------------------------------------------------------------|
| `kind`              | yes      | String identifier (no spaces, snake_case)                        |
| `args_schema`       | yes      | JSON Schema for the `args` object                                |
| `evaluation`        | yes      | Normative description of pass/fail condition (MUST language)     |
| `evaluation_timing` | yes      | `pre_invoke` or `post_invoke`                                    |
| `cache_ttl_seconds` | yes      | How long a pass result may be cached per (actor, capability)     |
| `gateway_requirement` | yes   | `MUST evaluate server-side` or `MAY delegate to actor`           |
| `failure_action`    | yes      | `deny` or `hitl` or `provisional_block`                          |

## Section 4: CDRO Type Registry

For each new CDRO type:

| Field               | Required | Description                                                      |
|---------------------|----------|------------------------------------------------------------------|
| `type`              | yes      | String value for the `type` field of the CDRO envelope           |
| `body_schema`       | yes      | JSON Schema for the body                                         |
| `oid_computation`   | yes      | What fields are included in the canonical payload for OID        |
| `chain_requirements`| no       | Any required predecessor or successor OID references             |
| `signing_requirement`| yes    | `MUST` / `SHOULD` / `MAY` be signed                              |

## Section 5: Conformance Requirements

State what a gateway must implement to claim support for this profile. Use the form:

> A gateway claiming `gap-[slug]` profile support MUST:
> - Evaluate the `[kind]` precondition kind per Section 3.
> - Accept and validate `[cdro_type]` CDRO bodies per Section 4.
> - Enforce `[capability_namespace].*` scope rules per Section 2.

Profile conformance is declared in the gateway discovery endpoint alongside core tier:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-gaming-00", "gap-supply-chain-00"]
}
```

## Versioning

Profile documents are versioned independently of the core spec. A profile references the minimum
core spec version it requires. Breaking changes to a profile increment the major version (e.g.,
`gap-gaming-01.md`). Additive changes increment the minor version in the document header without
renaming the file.

## Publishing

- SynOI-maintained profiles live in `synoi-gap/profiles/`
- Community profiles are linked from the GAP protocol site under a community registry
- A profile is considered stable when it has at least one independent conformant implementation
---

See `gap-gaming-00.md` in this directory for a complete worked example.
