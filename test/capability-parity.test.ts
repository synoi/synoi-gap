/**
 * test/capability-parity.test.ts — capabilityMatches must equal sraid's
 * capabilityCovers, case for case.
 *
 * WHY. This was the FOURTH implementation of capability-pattern matching in
 * the stack (@synoi/sraid, synoi-portal, @synoi/gap-types, here), and the
 * second one found to have drifted. The GATEWAY enforces with sraid's matcher,
 * so every other copy is a prediction of what the gateway will do. A copy that
 * is looser grants what the gateway refuses; one that is stricter hides what a
 * caller really holds. Either way the answer depends on which package a code
 * path happened to call, which is a privilege decision made by accident.
 *
 * The drift this pins was a '.**' recursive wildcard that existed only here:
 *
 *   held='platform.**'  required='platform.impersonate.start'
 *     sraid  false      gap  true
 *
 * Near-omnipotent in one package, inert in the other. Nothing used it — a scan
 * of gap, gateway, portal, control, app and conformance found '.**' only in
 * the implementation and its own comments — so it was removed rather than
 * promoted. If a recursive level is ever needed it goes into @synoi/sraid
 * first, with vectors, and is adopted from there.
 */

import { capabilityMatches } from '../src/capabilities.js'
import { capabilityCovers } from '@synoi/sraid'

let passed = 0
let failed = 0
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log('OK  ', label); passed++ }
  else { console.error('FAIL', label, detail); failed++ }
}

/** [held, required, expected] — expected is sraid's answer, the normative one. */
const CASES: [string, string, boolean][] = [
  // exact
  ['skill.create', 'skill.create', true],
  ['skill.create', 'skill.update', false],

  // match-all
  ['*', 'anything.at.all', true],
  ['*', 'platform', true],

  // segment-boundary wildcard
  ['skill.*', 'skill.create', true],
  ['platform.*', 'platform.impersonate.start', true],
  ['email.*', 'email.bulk_delete', true],

  // wildcard does NOT cover the bare prefix
  ['platform.*', 'platform', false],
  ['skill.*', 'skill', false],

  // REGRESSION: the removed '.**' level. Under the normative rule a pattern
  // ending '.**' does not end with '.*', so it matches nothing but itself.
  ['platform.**', 'platform.impersonate.start', false],
  ['platform.**', 'platform', false],
  ['platform.**', 'platform.support.read', false],
  ['platform.**', 'platform.**', true],

  // escalation guard: the boundary is a literal '.'
  ['emai*', 'email.bulk_delete', false],
  ['admin.us*', 'admin.users.delete', false],
  ['platform.*', 'platformx.read', false],

  // no match / degenerate
  ['platform.*', 'tenant.governance.manage', false],
  ['', 'platform', false],
  ['platform', '', false],
]

console.log('\n── parity: gap vs @synoi/sraid ──')
for (const [held, required] of CASES) {
  const g = capabilityMatches(held, required)
  const s = capabilityCovers(held, required)
  ok(`covers(${JSON.stringify(held)}, ${JSON.stringify(required)}) — gap=${g} sraid=${s}`, g === s)
}

// Parity alone would pass if BOTH drifted the same way, so pin the values too.
console.log('\n── expected semantics (sraid is normative) ──')
for (const [held, required, expected] of CASES) {
  ok(
    `sraid covers(${JSON.stringify(held)}, ${JSON.stringify(required)}) === ${expected}`,
    capabilityCovers(held, required) === expected,
  )
}

// Stated separately so the intent survives a careless edit to the table.
console.log('\n── escalation guard ──')
for (const [held, required] of [
  ['emai*', 'email.bulk_delete'],
  ['admin.us*', 'admin.users.delete'],
  ['platform.*', 'platformx.read'],
] as [string, string][]) {
  ok(
    `non-boundary wildcard must NOT match: ${JSON.stringify(held)} -> ${JSON.stringify(required)}`,
    capabilityMatches(held, required) === false && capabilityCovers(held, required) === false,
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error(
    '\ncapabilityMatches has drifted from @synoi/sraid capabilityCovers. The\n' +
      'gateway enforces with sraid\'s matcher, so this one must mirror it exactly.\n' +
      'Do not "fix" this by changing the expected values — change the matcher,\n' +
      'or change sraid first and adopt it here.',
  )
}
process.exit(failed > 0 ? 1 : 0)
