/**
 * test/perimeter.test.ts -- the `synoi.perimeter.v1` wire surface.
 *
 * Covers the four things a third party has to be able to do with a perimeter
 * declaration without asking SynOI anything: validate one, read the blind-spot
 * list, tell a governed surface from an undeclared one, and check a chain.
 *
 * Style copies test/validate.test.ts: standalone tsx script, manual counter.
 */

import {
  CHOKEPOINT_CLASSES,
  CHOKEPOINT_CLASS_ENFORCEMENT_CEILING,
  ENFORCEMENT_QUALITIES,
  PERIMETER_DECLARATION_OBJECT_TYPE,
  PERIMETER_DECLARATION_SCHEMA,
  classifySurface,
  enforcementWithinCeiling,
  renderPerimeterDeclaration,
  validatePerimeterDeclaration,
  validatePerimeterDeclarationBody,
  verifyPerimeterChain,
} from '../src/index.js'
import type {
  PerimeterDeclaration,
  PerimeterDeclarationBody,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

const OID_A = 'sha256:' + 'a'.repeat(64)
const OID_B = 'sha256:' + 'b'.repeat(64)
const OID_C = 'sha256:' + 'c'.repeat(64)

function goodBody(over: Partial<PerimeterDeclarationBody> = {}): PerimeterDeclarationBody {
  return {
    schema: PERIMETER_DECLARATION_SCHEMA,
    governed_subject: {
      platform: 'replit',
      workspace_id: 'ws-1',
      deployment_id: 'dep-9',
    },
    chokepoints_active: [
      {
        class: 'C1',
        surface: 'gateway:brokered-credential:stripe',
        enforcement: 'structural',
        evidence_ref: OID_C,
      },
      {
        class: 'C5',
        surface: 'mcp:https://gw.example/mcp/proxy',
        enforcement: 'structural',
      },
    ],
    blind_spots: [
      {
        surface: 'replit:agent-shell',
        reason: 'The workspace shell tab runs commands with no pre-execution hook a third party can register.',
        class_unavailable: 'C4',
      },
      {
        surface: 'replit:static-deployment',
        reason: 'A static deployment has no env vars and no run command, so no credential can be brokered and no wrapper can be installed.',
        class_unavailable: 'C1',
      },
    ],
    completeness_scope: {
      populations: ['action_log', 'receipts'],
      from_seq: 1,
      to_seq: 4096,
    },
    effective_from_ms: 1_750_000_000_000,
    ...over,
  }
}

function envelope(body: PerimeterDeclarationBody, oid = OID_A, tenant = 'tenant:acme'): PerimeterDeclaration {
  return {
    oid,
    type: PERIMETER_DECLARATION_OBJECT_TYPE,
    gap_version: '1.0',
    tenant_id: tenant,
    created_at_ms: body.effective_from_ms,
    created_by: 'actor:gateway',
    body,
  } as PerimeterDeclaration
}

// ── 1. Validation ───────────────────────────────────────────────────────────

function testValidation(): void {
  ok('validate: well-formed body', validatePerimeterDeclarationBody(goodBody()).ok)
  ok('validate: well-formed envelope', validatePerimeterDeclaration(envelope(goodBody())).ok)

  ok('validate: empty chokepoints and blind spots is legal',
    validatePerimeterDeclarationBody(goodBody({ chokepoints_active: [], blind_spots: [] })).ok,
    'a deployment governing nothing must be declarable, or operators will declare a chokepoint they do not have')

  const wrongSchema = validatePerimeterDeclarationBody({ ...goodBody(), schema: 'synoi.perimeter.v2' })
  ok('validate: wrong schema rejected', !wrongSchema.ok)

  const noSubject = { ...goodBody() } as Record<string, unknown>
  delete noSubject['governed_subject']
  ok('validate: missing governed_subject rejected', !validatePerimeterDeclarationBody(noSubject).ok)

  const badClass = validatePerimeterDeclarationBody(goodBody({
    chokepoints_active: [{ class: 'C9' as never, surface: 's', enforcement: 'structural' }],
  }))
  ok('validate: unknown chokepoint class rejected', !badClass.ok)

  const badOid = validatePerimeterDeclarationBody(goodBody({
    chokepoints_active: [{ class: 'C1', surface: 's', enforcement: 'structural', evidence_ref: 'not-an-oid' }],
  }))
  ok('validate: non-OID evidence_ref rejected', !badOid.ok)

  const badPrev = validatePerimeterDeclarationBody(goodBody({ prev: 'sha256:short' }))
  ok('validate: non-OID prev rejected', !badPrev.ok)

  const invertedWindow = validatePerimeterDeclarationBody(goodBody({
    effective_from_ms: 2000, effective_to_ms: 1000,
  }))
  ok('validate: inverted effective window rejected', !invertedWindow.ok)

  const invertedSeq = validatePerimeterDeclarationBody(goodBody({
    completeness_scope: { populations: ['action_log'], from_seq: 90, to_seq: 10 },
  }))
  ok('validate: from_seq > to_seq rejected', !invertedSeq.ok)

  const blindSpotNoReason = validatePerimeterDeclarationBody(goodBody({
    blind_spots: [{ surface: 's', reason: '', class_unavailable: 'C4' }],
  }))
  ok('validate: blind spot with an empty reason rejected', !blindSpotNoReason.ok,
    'an unexplained blind spot is a disclaimer, not a disclosure')

  const wrongEnvelopeType = validatePerimeterDeclaration({
    ...envelope(goodBody()), type: 'gap:decision_receipt',
  })
  ok('validate: wrong envelope type rejected', !wrongEnvelopeType.ok)
}

// ── 2. The enforcement ceiling (the overclaim guard) ────────────────────────

function testEnforcementCeiling(): void {
  ok('ceiling: C7 cannot claim structural', !enforcementWithinCeiling('C7', 'structural'))
  ok('ceiling: C7 cannot claim cooperative', !enforcementWithinCeiling('C7', 'cooperative'))
  ok('ceiling: C7 may claim observational', enforcementWithinCeiling('C7', 'observational'))
  ok('ceiling: C6 cannot claim structural', !enforcementWithinCeiling('C6', 'structural'))
  ok('ceiling: C6 may claim cooperative', enforcementWithinCeiling('C6', 'cooperative'))
  ok('ceiling: C1 may claim structural', enforcementWithinCeiling('C1', 'structural'))
  ok('ceiling: C1 may claim weaker than its ceiling', enforcementWithinCeiling('C1', 'observational'),
    'a chokepoint that exists but is not trusted must be declarable as weaker')

  // Every class has a ceiling, and every ceiling is a real quality.
  ok('ceiling: every class has a declared ceiling',
    CHOKEPOINT_CLASSES.every(c => (ENFORCEMENT_QUALITIES as readonly string[])
      .includes(CHOKEPOINT_CLASS_ENFORCEMENT_CEILING[c])))

  const overclaim = validatePerimeterDeclarationBody(goodBody({
    chokepoints_active: [{ class: 'C7', surface: 'github:webhook', enforcement: 'structural' }],
  }))
  ok('ceiling: validator refuses "C7, structural"', !overclaim.ok)
  ok('ceiling: the refusal names the ceiling',
    overclaim.errors.some(e => e.includes('exceeds the ceiling for C7')),
    overclaim.errors.join(' / '))

  const honest = validatePerimeterDeclarationBody(goodBody({
    chokepoints_active: [{ class: 'C7', surface: 'github:webhook', enforcement: 'observational' }],
  }))
  ok('ceiling: validator accepts "C7, observational"', honest.ok, honest.errors.join(' / '))
}

// ── 3. Surface classification (divergence detection) ────────────────────────

function testClassifySurface(): void {
  const b = goodBody()
  ok('classify: an active chokepoint surface is governed',
    classifySurface(b, 'mcp:https://gw.example/mcp/proxy') === 'governed')
  ok('classify: a named blind spot is declared',
    classifySurface(b, 'replit:agent-shell') === 'declared_blind_spot')
  ok('classify: an unlisted surface is undeclared',
    classifySurface(b, 'replit:scheduled-job') === 'undeclared',
    'this is the detectable divergence the declaration exists to produce')
  ok('classify: matching is exact, not prefix',
    classifySurface(b, 'replit:agent-shell-v2') === 'undeclared',
    'a prefix match would let a declared surface silently absorb an undeclared neighbour')
}

// ── 4. Chain rules ──────────────────────────────────────────────────────────

function testChain(): void {
  const genesis = envelope(goodBody({ effective_from_ms: 1000, effective_to_ms: 2000 }), OID_A)
  const second  = envelope(goodBody({ effective_from_ms: 2000, prev: OID_A }), OID_B)

  ok('chain: a single genesis declaration is a valid chain',
    verifyPerimeterChain([genesis]).ok)
  ok('chain: genesis then successor verifies',
    verifyPerimeterChain([genesis, second]).ok,
    verifyPerimeterChain([genesis, second]).reasons.join(','))

  ok('chain: empty chain rejected',
    verifyPerimeterChain([]).reasons.includes('empty-chain'))

  const genesisWithPrev = envelope(goodBody({ effective_from_ms: 1000, prev: OID_C }), OID_A)
  ok('chain: genesis carrying prev rejected',
    verifyPerimeterChain([genesisWithPrev]).reasons.includes('genesis-carries-prev'))

  const wrongPrev = envelope(goodBody({ effective_from_ms: 2000, prev: OID_C }), OID_B)
  ok('chain: broken prev link rejected',
    verifyPerimeterChain([genesis, wrongPrev]).reasons.includes('broken-prev-link'))

  const otherTenant = envelope(goodBody({ effective_from_ms: 2000, prev: OID_A }), OID_B, 'tenant:other')
  ok('chain: tenant change rejected',
    verifyPerimeterChain([genesis, otherTenant]).reasons.includes('tenant-mismatch'))

  const otherSubject = envelope(goodBody({
    effective_from_ms: 2000,
    prev: OID_A,
    governed_subject: { platform: 'replit', workspace_id: 'ws-2' },
  }), OID_B)
  ok('chain: subject change rejected',
    verifyPerimeterChain([genesis, otherSubject]).reasons.includes('subject-mismatch'),
    'a chain that changes subject is two chains')

  const notAdvancing = envelope(goodBody({ effective_from_ms: 1000, prev: OID_A }), OID_B)
  ok('chain: non-advancing window rejected',
    verifyPerimeterChain([genesis, notAdvancing]).reasons.includes('window-not-advancing'))

  const overlapGenesis = envelope(goodBody({ effective_from_ms: 1000, effective_to_ms: 5000 }), OID_A)
  ok('chain: overlapping windows rejected',
    verifyPerimeterChain([overlapGenesis, second]).reasons.includes('window-overlap'),
    'two perimeters in force at one instant is the ambiguity this object removes')

  const openGenesis = envelope(goodBody({ effective_from_ms: 1000 }), OID_A)
  ok('chain: an open-ended predecessor is allowed to be superseded',
    verifyPerimeterChain([openGenesis, second]).ok,
    verifyPerimeterChain([openGenesis, second]).reasons.join(','))
}

// ── 5. Human-readable rendering ─────────────────────────────────────────────

function testRender(): void {
  const text = renderPerimeterDeclaration(envelope(goodBody()))

  ok('render: names the schema', text.includes(PERIMETER_DECLARATION_SCHEMA))
  ok('render: names the subject', text.includes('platform replit') && text.includes('deployment dep-9'))
  ok('render: has a NOT GOVERNED section', text.includes('NOT GOVERNED (2)'))
  ok('render: prints every blind spot surface',
    text.includes('replit:agent-shell') && text.includes('replit:static-deployment'),
    'the blind-spot list is never truncated to a count')
  ok('render: prints each blind spot reason in full',
    text.includes('no pre-execution hook a third party can register'))
  ok('render: names the missing class for each blind spot',
    text.includes('C4 platform egress policy') && text.includes('C1 credential deprivation'))
  ok('render: labels enforcement quality on each chokepoint',
    text.includes('[structural] C1 credential deprivation'))
  ok('render: states the scope limit in plain words',
    text.includes('its absence from the record is not'))
  ok('render: marks a genesis declaration', text.includes('none (genesis declaration)'))

  const openEnded = renderPerimeterDeclaration(envelope(goodBody()))
  ok('render: an omitted effective_to_ms reads as open-ended', openEnded.includes('open-ended'))

  const noBlindSpots = renderPerimeterDeclaration(envelope(goodBody({ blind_spots: [] })))
  ok('render: an empty blind-spot list is called out, not omitted',
    noBlindSpots.includes('NOT GOVERNED (0)') && noBlindSpots.includes('positive claim'),
    'a missing section reads as nothing to report')

  const nothingGoverned = renderPerimeterDeclaration(envelope(goodBody({ chokepoints_active: [] })))
  ok('render: an empty chokepoint list says nothing is governed',
    nothingGoverned.includes('no action on this subject is governed'))
}

function main(): void {
  testValidation()
  testEnforcementCeiling()
  testClassifySurface()
  testChain()
  testRender()
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
