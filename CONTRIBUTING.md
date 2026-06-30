# Contributing to GAP

Thank you for your interest in contributing to the Governed Action Protocol.
GAP is an open protocol under CC0. The reference TypeScript package is
Apache-2.0.

---

## Code of conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/),
version 2.1. By participating you agree to uphold its standards. Reports of
unacceptable behavior may be sent to the maintainers.

---

## Ways to contribute

**Bug reports.** If you find incorrect behavior in the reference implementation,
a misspecified type, or a discrepancy between `IMPLEMENTING.md` and the code,
open a GitHub issue. Include: what you expected, what you observed, and the
minimal reproduction steps or test vector.

**Spec clarifications.** If `IMPLEMENTING.md`, `OPTIONAL_CAPABILITIES_SPEC.md`,
or any other protocol document is ambiguous or contradicts the code, open an
issue describing the ambiguity. Spec issues that involve normative behavior
changes require an ADR (see [Protocol spec governance](#protocol-spec-governance)).

**Capability taxonomy additions.** If you are implementing GAP for a domain
not yet covered in `CAPABILITY_TAXONOMY.md`, you may propose new entries via a
pull request. One PR per domain prefix. Include a worked example showing the
capability in a real workflow. See [For capability taxonomy additions](#for-capability-taxonomy-additions).

**Gateway implementations.** If you have built a GAP-conformant server in
another language, open an issue or PR linking to it. We maintain a list of
known implementations in `IMPLEMENTING.md`.

**Language SDKs.** The reference package (`@synoi/gap`) is TypeScript. If you
are building an SDK for another language that produces identical OIDs and
validates CDRO envelopes, open an issue first to discuss the OID test vector
format before writing the implementation.

---

## Reporting security vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's [private vulnerability reporting](../../security/advisories/new)
or the form at [synoi.systems/security](https://synoi.systems/security) with
a description of the vulnerability, the affected component, and steps to
reproduce it. You will receive an acknowledgment within 72 hours.

We follow responsible disclosure. We will work with you to understand and
address the issue before any public disclosure. We will credit researchers who
report valid vulnerabilities, unless they prefer to remain anonymous.

---

## Development setup

Requirements:

- Node.js >= 18 (uses `TextEncoder` and native `crypto`)
- npm >= 9

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the TypeScript type checker:

```bash
npm run typecheck
```

The test suite includes OID test vectors that pin the canonical hash against
the gateway implementation. Any change to the canonical JSON rules or the OID
computation will fail these tests. This is intentional: OID stability is a
protocol guarantee.

**Platform note:** `node_modules` contains platform-specific esbuild binaries. If you switch between Windows and WSL (or vice versa), run `npm ci` to reinstall the correct binary. Symptoms of a mismatch: `tsx` not found or esbuild exits with format errors.

---

## Submitting changes

### Fork and branch

Fork the repository and create a branch from `main`. Branch names should
describe the change: `fix/oid-canonical-null-handling`,
`feat/capability-taxonomy-industrial`, `docs/implementing-scope-narrowing`.

### Tests

`npm test` MUST pass before you submit a pull request. If you are fixing a
bug, add a test that fails before your fix and passes after. If you are adding
a capability taxonomy entry, no code test is needed, but include a JSON example
in the PR description showing a declaration using the new capability.

### Type checking

`npm run typecheck` MUST pass. The TypeScript configuration is strict. New
exported types require JSDoc comments.

### For spec changes (IMPLEMENTING.md)

Changes to normative protocol behavior in `IMPLEMENTING.md`,
`OPTIONAL_CAPABILITIES_SPEC.md`, or any file that defines wire format,
evaluation algorithms, or conformance requirements MUST be accompanied by a
reference to an existing ADR or an open discussion issue proposing the change.

If you are uncertain whether your change is normative, open a discussion first.
Non-normative changes (fixing typos, clarifying examples, adding appendix
material that does not change MUST/MUST NOT requirements) do not require an
ADR.

ADRs are filed as GitHub Discussions in this repository (label: `adr`). The
protocol team reviews and ratifies ADRs before the corresponding spec change
is merged.

### For capability taxonomy additions

Capability taxonomy PRs follow these conventions:

- One PR per top-level domain prefix (`industrial.*`, `medical.*`, etc.).
  Mixing unrelated domains in one PR makes review harder.
- Each new row in `CAPABILITY_TAXONOMY.md` requires: the capability name,
  `safety_class`, `physical_safety` flag, key args with types, and a one-line
  description.
- Include a worked example in the PR description: a minimal workflow definition
  or invocation JSON that uses at least one of the new capabilities.
- If you are proposing a new top-level domain (a prefix not yet in the file),
  open a discussion issue first. New domains are accepted when they represent a
  coherent deployment environment with at least three distinct capabilities and
  a plausible independent implementor.

### Commit style

This repository uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add industrial.estop.* capabilities to taxonomy
fix: correct scope_narrowing evaluation for numeric lower bound
docs: clarify optional_effects receipt requirement for silent skips
test: add OID test vector for canonical null omission
refactor: extract capabilityMatches to shared utility
```

Scopes are optional but helpful for larger changes:
`feat(taxonomy)`, `fix(oid)`, `docs(implementing)`.

Commit messages MUST be in English. Use the imperative mood in the subject
line. Limit the subject line to 72 characters.

---

## Protocol spec governance

The GAP protocol spec is CC0. Anyone may implement it without restriction.

Changes to the normative spec (evaluation algorithms, wire format, conformance
tier requirements) are managed by the SynOI protocol team. The process:

1. Open a discussion issue describing the proposed change and the motivation.
2. The protocol team reviews and either files an ADR or requests revisions.
3. Once an ADR is ratified (GitHub Discussion marked "ratified"), the
   corresponding spec change may be submitted as a PR.
4. The PR is reviewed for consistency with the ADR and merged by a maintainer.

Non-normative spec changes (examples, appendix material, editorial fixes) may
be submitted directly as PRs without an ADR.

The CDRO wire format (`oid`, `type`, `gap_version`, `tenant_id`,
`created_at_ms`, `created_by`, `body`, `signature`, `supersedes`) is
version-locked in `gap_version: "1.0"`. Breaking changes to the wire format
require a major version bump and a new `gap_version` value. The protocol team
does not take breaking changes lightly.

---

## Publishing

npm publish is gated to project maintainers. If you are a maintainer:

- Bump the version in `package.json` following semver.
- Update `CHANGELOG.md` with the changes since the prior release.
- Open a PR for the version bump. Get a second maintainer review.
- The first push to a new major version tag (`v2.0.0`) is a human gate: a
  maintainer must execute it manually. Automated release pipelines do not
  execute this step.

Contributors who are not maintainers do not need to worry about publishing.
Merged PRs are batched into releases by the maintainers on a regular cadence.
