/**
 * perimeter.ts -- the Perimeter Declaration (`synoi.perimeter.v1`).
 *
 * WHAT THIS IS. A signed statement of what a deployment's governance actually
 * covers: which chokepoints are active and at what enforcement quality, and,
 * just as load-bearing, which surfaces are NOT covered. A completeness
 * assertion whose scope is unstated is a completeness assertion about nothing,
 * so this object is what gives `synoi.completeness.v1` a scope to be complete
 * WITHIN. The gateway's completeness engine already states this limit in a code
 * comment; this promotes it to a signed, falsifiable object.
 *
 * WHY THE BLIND-SPOT LIST IS A FEATURE. Every competitor leaves scope implicit,
 * so "full visibility" survives exactly until a buyer probes it. An enumerated,
 * signed blind-spot list is checkable, and an action arriving from a surface
 * that is in neither `chokepoints_active` nor `blind_spots` is a DETECTABLE
 * divergence rather than a silent gap (see `classifySurface`).
 *
 * BINDING DIRECTION, WHICH IS NOT OPTIONAL. This object references nothing.
 * `synoi.reconciliation.v1` will reference BOTH `synoi.completeness.v1` and this
 * one; `synoi.completeness.v1` references NEITHER. A required new field on the
 * frozen completeness body would break its null-OMIT canonical bytes and make
 * every previously signed assertion unverifiable. If a perimeter reference on
 * completeness is genuinely wanted later it is `synoi.completeness.v2` with a
 * stated migration, never a v1 amendment.
 *
 * WHAT LIVES HERE VERSUS IN THE GATEWAY. This package is Apache-2.0 and carries
 * the WIRE FORMAT plus anything a third party needs to check one without asking
 * SynOI: the types, the validator (see validate.ts), the chain rules, and the
 * human-readable renderer. Minting and signing live in the gateway, because
 * they need the signing oracle.
 *
 * NOT YET IN THE ENUM: the proposed C0 ingress class. It is unratified and
 * uncosted, and widening a shipped enum makes older verifiers reject newer
 * objects, so it is a deliberate open question rather than a silent inclusion.
 *
 * No em dashes. No AI attribution.
 */

import type { GapCdroEnvelope } from './cdro.js'

/** GAP object type for the perimeter-declaration CDRO. */
export const PERIMETER_DECLARATION_OBJECT_TYPE = 'gap:perimeter_declaration' as const

/**
 * Self-identifying KIND for the perimeter body, bound into the signed bytes as
 * `schema` so a verifier knows what it is looking at before it trusts any field.
 * Versioned: a future body-shape change ships as `synoi.perimeter.v2`, never a
 * silent mutation of v1, or an already-signed declaration stops verifying.
 */
export const PERIMETER_DECLARATION_SCHEMA = 'synoi.perimeter.v1' as const

/**
 * The chokepoint taxonomy. Ordered by strength, not by ease. Every interception
 * opportunity in any host platform falls into one of these.
 *
 *   C1 Credential deprivation      the workload never holds the credential
 *   C2 Counterparty requirement    the far end refuses the call without a receipt
 *   C3 Sealed-workload egress      no NIC; the only path out is the parent-side gate
 *   C4 Platform egress policy      the host enforces a proxy, firewall, or netpolicy
 *   C5 Protocol chokepoint         a named endpoint the workload is configured to call
 *   C6 In-process wrapper          an SDK or run-command wrapper inside the workload
 *   C7 Post-hoc event ingest       webhooks, audit streams. Never a gate.
 */
export const CHOKEPOINT_CLASSES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const
export type ChokepointClass = typeof CHOKEPOINT_CLASSES[number]

/**
 * How strongly a chokepoint actually holds.
 *
 *   structural     the workload cannot route around it, because there is
 *                  nothing to route around
 *   cooperative    it holds only while the workload cooperates; it shares a
 *                  trust domain with the thing it governs
 *   observational  it cannot stop anything, and it can be starved
 */
export const ENFORCEMENT_QUALITIES = ['structural', 'cooperative', 'observational'] as const
export type EnforcementQuality = typeof ENFORCEMENT_QUALITIES[number]

/**
 * The strongest enforcement each class can honestly claim. A declaration may
 * claim WEAKER than its class ceiling (a C5 channel the workload can trivially
 * swap away from is cooperative in practice), but never stronger: C7 is
 * observational by construction, and C6 lives in the workload's own trust
 * domain. Enforced by `validatePerimeterDeclarationBody`, so the most likely
 * overclaim is refused by the object itself rather than caught in review.
 */
export const CHOKEPOINT_CLASS_ENFORCEMENT_CEILING: Readonly<Record<ChokepointClass, EnforcementQuality>> = {
  C1: 'structural',
  C2: 'structural',
  C3: 'structural',
  C4: 'structural',
  C5: 'structural',
  C6: 'cooperative',
  C7: 'observational',
}

/** structural > cooperative > observational. Higher rank is stronger. */
export const ENFORCEMENT_RANK: Readonly<Record<EnforcementQuality, number>> = {
  observational: 0,
  cooperative:   1,
  structural:    2,
}

/**
 * True when `claimed` is no stronger than the class allows. The one integrity
 * rule this object enforces about its own content.
 */
export function enforcementWithinCeiling(cls: ChokepointClass, claimed: EnforcementQuality): boolean {
  return ENFORCEMENT_RANK[claimed] <= ENFORCEMENT_RANK[CHOKEPOINT_CLASS_ENFORCEMENT_CEILING[cls]]
}

/** What the perimeter is declared ABOUT. */
export interface PerimeterGovernedSubject {
  /** Host platform identifier, e.g. 'replit', 'cursor', 'vercel', 'self-hosted'. */
  platform: string
  /** Workspace / org / project scope within that platform. */
  workspace_id: string
  /** Optional finer subject: a specific repl. */
  repl_id?: string
  /** Optional finer subject: a specific deployment. */
  deployment_id?: string
}

/** One active chokepoint and how strongly it actually holds. */
export interface PerimeterChokepoint {
  /** Taxonomy class. */
  class: ChokepointClass
  /**
   * The concrete surface this chokepoint sits on, e.g.
   * 'mcp:https://gw.example/mcp/proxy' or 'cursor:beforeShellExecution'.
   * Free-form but stable: `classifySurface` matches an observed surface
   * against these strings, so a churning value defeats divergence detection.
   */
  surface: string
  /** How strongly it holds. Never stronger than the class ceiling. */
  enforcement: EnforcementQuality
  /**
   * OPTIONAL OID of the object evidencing that this chokepoint is live: a
   * configuration record, an installer result, a receipt from a test call.
   * Omitted (never null) when there is nothing to cite. `sha256:<hex>` form.
   */
  evidence_ref?: string
}

/** One surface that is NOT governed, named rather than left implicit. */
export interface PerimeterBlindSpot {
  /** The uncovered surface, e.g. 'replit:agent-shell' or 'replit:static-deployment'. */
  surface: string
  /** Why it is uncovered, in plain words. This is read by a compliance officer. */
  reason: string
  /**
   * The chokepoint class that WOULD have covered it and is unavailable here.
   * Naming it turns each blind spot into a specific missing mechanism rather
   * than a vague disclaimer, and it is what a purchasable upgrade is priced
   * against.
   */
  class_unavailable: ChokepointClass
}

/**
 * The sequence range and populations this perimeter's completeness claim is
 * scoped to. `populations` names the record populations covered (the same
 * population vocabulary the completeness engine counts over).
 */
export interface PerimeterCompletenessScope {
  populations: string[]
  from_seq: number
  to_seq: number
}

/**
 * The frozen `synoi.perimeter.v1` body.
 *
 * NULL-OMIT CONVENTION, adopted from `synoi.completeness.v1` before this format
 * has any signed instances to protect: an optional field that does not apply is
 * OMITTED entirely, never set to null. A null key changes the JCS canonical
 * bytes; an absent key does not.
 *
 * `tenant_id` is deliberately NOT here: it is on the CDRO envelope, and it is
 * part of the OID content core, so duplicating it into the body would create
 * two places for one fact to disagree.
 */
export interface PerimeterDeclarationBody {
  schema: typeof PERIMETER_DECLARATION_SCHEMA
  governed_subject: PerimeterGovernedSubject
  /** Active chokepoints. MAY be empty: a deployment governing nothing is a
   *  legitimate and honest declaration, and is the correct starting state. */
  chokepoints_active: PerimeterChokepoint[]
  /** Named uncovered surfaces. MAY be empty, but an empty list on a real
   *  deployment is the claim a reviewer will probe first. */
  blind_spots: PerimeterBlindSpot[]
  completeness_scope: PerimeterCompletenessScope
  /** Window opens (ms). */
  effective_from_ms: number
  /** Window closes (ms). OMITTED for an open-ended current declaration. */
  effective_to_ms?: number
  /** OID of the prior declaration in this subject's chain. OMITTED on the
   *  genesis declaration. `sha256:<hex>` form. */
  prev?: string
}

/** A perimeter declaration CDRO: the standard GAP envelope over the v1 body. */
export type PerimeterDeclaration = GapCdroEnvelope<PerimeterDeclarationBody>

// ── Surface classification (the divergence detector) ────────────────────────

/**
 * What a declaration says about an observed surface.
 *
 *   governed             the surface is in `chokepoints_active`
 *   declared_blind_spot  the surface is in `blind_spots`. Activity here is
 *                        outside the coverage claim and was disclosed
 *   undeclared           the surface is in NEITHER list. This is the
 *                        detectable divergence: the customer widened their
 *                        agent's reach without updating the declaration
 */
export type SurfaceClassification = 'governed' | 'declared_blind_spot' | 'undeclared'

/**
 * Classify an observed surface against a declaration. Exact string match, on
 * purpose: a prefix or fuzzy match would let a declared surface silently
 * absorb a neighbouring undeclared one, which is the exact failure this
 * object exists to make visible.
 */
export function classifySurface(
  body: PerimeterDeclarationBody,
  surface: string,
): SurfaceClassification {
  for (const c of body.chokepoints_active) if (c.surface === surface) return 'governed'
  for (const b of body.blind_spots) if (b.surface === surface) return 'declared_blind_spot'
  return 'undeclared'
}

// ── Chain rules ─────────────────────────────────────────────────────────────

/** A machine-readable reason a perimeter chain does not hold. */
export type PerimeterChainReason =
  | 'empty-chain'
  | 'genesis-carries-prev'
  | 'broken-prev-link'
  | 'tenant-mismatch'
  | 'subject-mismatch'
  | 'window-not-advancing'
  | 'window-overlap'
  | 'window-inverted'

export interface PerimeterChainResult {
  ok: boolean
  reasons: PerimeterChainReason[]
}

function sameSubject(a: PerimeterGovernedSubject, b: PerimeterGovernedSubject): boolean {
  return a.platform === b.platform
    && a.workspace_id === b.workspace_id
    && a.repl_id === b.repl_id
    && a.deployment_id === b.deployment_id
}

/**
 * Verify a perimeter chain, oldest first.
 *
 * This checks the STRUCTURE of the chain only. It says nothing about whether
 * any link is validly signed: signature verification is a separate step, and
 * a caller must do both. A structurally perfect chain of unsigned objects
 * proves nothing.
 *
 * Rules, all required:
 *   1. The chain is non-empty and its first element carries no `prev` (it is
 *      the genesis declaration for this subject).
 *   2. Every later element's `prev` is the previous element's `oid`.
 *   3. Every element carries the same `tenant_id` and the same
 *      `governed_subject`. A chain that changes subject is two chains.
 *   4. `effective_from_ms` strictly increases. Two declarations opening at the
 *      same instant leave the effective perimeter ambiguous.
 *   5. A closed window (`effective_to_ms` present) is not inverted, and does
 *      not extend past its successor's opening. Overlapping windows would let
 *      two different perimeters both claim to be in force at one moment, which
 *      is precisely the ambiguity a signed scope statement exists to remove.
 */
export function verifyPerimeterChain(chain: readonly PerimeterDeclaration[]): PerimeterChainResult {
  const reasons: PerimeterChainReason[] = []
  if (chain.length === 0) return { ok: false, reasons: ['empty-chain'] }

  const first = chain[0]!
  if (first.body.prev !== undefined) reasons.push('genesis-carries-prev')

  for (let i = 1; i < chain.length; i++) {
    const prevLink = chain[i - 1]!
    const link = chain[i]!

    if (link.body.prev !== prevLink.oid) reasons.push('broken-prev-link')
    if (link.tenant_id !== prevLink.tenant_id) reasons.push('tenant-mismatch')
    if (!sameSubject(link.body.governed_subject, prevLink.body.governed_subject)) {
      reasons.push('subject-mismatch')
    }
    if (link.body.effective_from_ms <= prevLink.body.effective_from_ms) {
      reasons.push('window-not-advancing')
    }
    if (prevLink.body.effective_to_ms !== undefined) {
      if (prevLink.body.effective_to_ms < prevLink.body.effective_from_ms) {
        reasons.push('window-inverted')
      }
      if (prevLink.body.effective_to_ms > link.body.effective_from_ms) {
        reasons.push('window-overlap')
      }
    }
  }

  const last = chain[chain.length - 1]!
  if (last.body.effective_to_ms !== undefined
      && last.body.effective_to_ms < last.body.effective_from_ms) {
    reasons.push('window-inverted')
  }

  return { ok: reasons.length === 0, reasons }
}

// ── Human-readable rendering ────────────────────────────────────────────────

const CLASS_LABEL: Readonly<Record<ChokepointClass, string>> = {
  C1: 'C1 credential deprivation',
  C2: 'C2 counterparty receipt requirement',
  C3: 'C3 sealed-workload egress',
  C4: 'C4 platform egress policy',
  C5: 'C5 protocol chokepoint',
  C6: 'C6 in-process wrapper',
  C7: 'C7 post-hoc event ingest',
}

function formatMs(ms: number): string {
  try { return new Date(ms).toISOString() } catch { return String(ms) }
}

function subjectLine(s: PerimeterGovernedSubject): string {
  const parts = [`platform ${s.platform}`, `workspace ${s.workspace_id}`]
  if (s.repl_id !== undefined) parts.push(`repl ${s.repl_id}`)
  if (s.deployment_id !== undefined) parts.push(`deployment ${s.deployment_id}`)
  return parts.join(', ')
}

/**
 * Render a declaration as plain text for a human reader.
 *
 * The blind-spot list is the point of this function. Handed to a compliance
 * officer, the enumerated list of what is NOT covered is the thing that makes
 * them willing to believe the rest of the document, so it is rendered in full
 * and never truncated or summarized to a count. When the list is empty the
 * renderer says so explicitly rather than omitting the section, because a
 * missing section reads as "nothing to report" and an empty blind-spot list on
 * a real deployment is a claim, not an absence.
 */
export function renderPerimeterDeclaration(decl: PerimeterDeclaration): string {
  const b = decl.body
  const lines: string[] = []

  lines.push('SynOI perimeter declaration')
  lines.push(`  schema:    ${b.schema}`)
  lines.push(`  oid:       ${decl.oid}`)
  lines.push(`  tenant:    ${decl.tenant_id}`)
  lines.push(`  subject:   ${subjectLine(b.governed_subject)}`)
  lines.push(`  effective: ${formatMs(b.effective_from_ms)} to ` +
    (b.effective_to_ms === undefined ? 'open-ended' : formatMs(b.effective_to_ms)))
  lines.push(`  prev:      ${b.prev ?? 'none (genesis declaration)'}`)
  lines.push('')

  lines.push(`GOVERNED (${b.chokepoints_active.length})`)
  if (b.chokepoints_active.length === 0) {
    lines.push('  Nothing. No chokepoint is active, so no action on this subject is governed.')
  } else {
    for (const c of b.chokepoints_active) {
      lines.push(`  [${c.enforcement}] ${CLASS_LABEL[c.class]}`)
      lines.push(`      surface:  ${c.surface}`)
      if (c.evidence_ref !== undefined) lines.push(`      evidence: ${c.evidence_ref}`)
    }
  }
  lines.push('')

  lines.push(`NOT GOVERNED (${b.blind_spots.length})`)
  if (b.blind_spots.length === 0) {
    lines.push('  This declaration names no blind spots. That is a positive claim that every')
    lines.push('  surface on this subject is covered, and it should be checked before it is')
    lines.push('  relied on.')
  } else {
    for (const s of b.blind_spots) {
      lines.push(`  ${s.surface}`)
      lines.push(`      reason:      ${s.reason}`)
      lines.push(`      would need:  ${CLASS_LABEL[s.class_unavailable]}, unavailable here`)
    }
  }
  lines.push('')

  lines.push('COMPLETENESS SCOPE')
  lines.push(`  populations: ${b.completeness_scope.populations.join(', ') || 'none'}`)
  lines.push(`  sequence:    ${b.completeness_scope.from_seq} to ${b.completeness_scope.to_seq}`)
  lines.push('')
  lines.push('Any completeness claim made against this subject covers the governed list and')
  lines.push('the sequence range above, and nothing else. Activity on a surface named under')
  lines.push('NOT GOVERNED leaves no record here, and its absence from the record is not')
  lines.push('evidence that it did not happen.')

  return lines.join('\n')
}
