/**
 * test/reserved-mcp-name.test.ts -- canonical MCP namespace-pollution guard.
 *
 * F2: the reserved-name predicate + NORMATIVE_CAPABILITY_NAMES were duplicated
 * in the gateway MCP adapter. They now live here as the single source of truth
 * so every enforcing consumer imports the same rule and it cannot drift. This
 * vector pins the exact reserved set and the predicate's behaviour.
 *
 * Style copies the gateway test harness: standalone tsx script, manual ok().
 */

import {
  NORMATIVE_CAPABILITY_NAMES,
  reservedMcpNameReason,
  isReservedMcpName,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else       { failed++; process.stdout.write(`FAIL ${label}${detail ? ' -- ' + detail : ''}\n`) }
}

// ── the normative set is exactly the documented eight ────────────────────────
const EXPECTED = [
  'email.send', 'sms.send', 'memory.write', 'memory.read',
  'grant.issue', 'grant.revoke', 'capability.declare', 'workflow.start',
]
ok('normative set size is 8', NORMATIVE_CAPABILITY_NAMES.size === 8)
for (const name of EXPECTED) {
  ok(`normative set contains ${name}`, NORMATIVE_CAPABILITY_NAMES.has(name))
}

// ── gap: prefix is reserved (case-insensitive) ───────────────────────────────
ok('gap: prefix reserved', reservedMcpNameReason('gap:decision_receipt') !== null)
ok('GAP: prefix reserved (case-insensitive)', reservedMcpNameReason('GAP:foo') !== null)
ok('gap:-prefixed reason mentions prefix', (reservedMcpNameReason('gap:x') ?? '').includes('gap:'))

// ── normative collision reserved ─────────────────────────────────────────────
ok('email.send reserved', reservedMcpNameReason('email.send') !== null)
ok('collision reason names the capability', (reservedMcpNameReason('grant.revoke') ?? '').includes('grant.revoke'))

// ── empty / whitespace reserved ──────────────────────────────────────────────
ok('empty name reserved', reservedMcpNameReason('') !== null)
ok('whitespace-only name reserved', reservedMcpNameReason('   ') !== null)

// ── safe names pass ──────────────────────────────────────────────────────────
ok('search_tickets is safe', reservedMcpNameReason('search_tickets') === null)
ok('mcp.acme.search is safe', reservedMcpNameReason('mcp.acme.search') === null)
ok('email.sendmail (not exact) is safe', reservedMcpNameReason('email.sendmail') === null)

// ── boolean convenience form agrees with the reason form ─────────────────────
ok('isReservedMcpName true for gap:', isReservedMcpName('gap:x') === true)
ok('isReservedMcpName true for collision', isReservedMcpName('memory.read') === true)
ok('isReservedMcpName false for safe', isReservedMcpName('search_tickets') === false)

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
