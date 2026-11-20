/**
 * test/receipt-versions-schema.test.ts -- hosted receipt version registry data.
 *
 * schemas/receipt-versions.json is the cross-repo source of truth for each
 * hosted (flat) Decision Receipt version's signed-field list, plus the
 * hosted-v1.2 `degraded_reason` codes and `integrity_grade` enum. synoi-gateway
 * (src/receipt-version.ts) and synoi-verify (src/receipt-versions.ts) vendor it
 * with drift tests, the same way canonical-receipt-fields.json is vendored.
 *
 * This file pins:
 *   - hosted-v1.0 / hosted-v1.1 are exactly canonical-receipt-fields.json
 *     (version 1), so the older lists cannot drift from the file every repo
 *     already checks against;
 *   - hosted-v1.2 = hosted-v1.1 + schema_version, integrity_grade (required),
 *     degraded_reason, agent_id, owner_oid (optional);
 *   - the reason codes, their grades, and the grade enum;
 *   - (F2) six reason codes, not seven, and hosted-v1.3 = hosted-v1.2 with
 *     grant_oid required;
 *   - (C1) hosted-v1.4 = hosted-v1.3's list + approver_oid (required), and
 *     approver_oid is refused when unsigned.
 *
 * Style copies the gateway test harness: standalone tsx script, manual ok().
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else       { failed++; process.stdout.write(`FAIL ${label}${detail !== undefined ? ' -- ' + JSON.stringify(detail) : ''}\n`) }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const versionsPath = join(root, 'schemas', 'receipt-versions.json')
const fieldsPath   = join(root, 'schemas', 'canonical-receipt-fields.json')

ok('schemas/receipt-versions.json exists', existsSync(versionsPath))
if (!existsSync(versionsPath)) {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  process.exit(1)
}

interface VersionEntry {
  id: string
  schema_version: string | null
  status: string
  required_fields: string[]
  optional_fields: string[]
  degraded_rule: string
}
const reg = JSON.parse(readFileSync(versionsPath, 'utf8')) as {
  format_version: number
  family: string
  versions: VersionEntry[]
  unversioned_order: string[]
  integrity_grades: string[]
  degraded_reason_codes: Record<string, string>
}
const v1 = JSON.parse(readFileSync(fieldsPath, 'utf8')) as {
  legacy_required_fields: string[]; optional_fields: string[]
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a]) === JSON.stringify([...b])
const sorted = (a: readonly string[]): boolean => same(a, [...a].sort())

ok('format_version is 1', reg.format_version === 1, reg.format_version)
ok('family is hosted-flat', reg.family === 'hosted-flat', reg.family)
ok('versions are hosted-v1.0, hosted-v1.1, hosted-v1.2, hosted-v1.3, hosted-v1.4 in order',
   same(reg.versions.map((v) => v.id), ['hosted-v1.0', 'hosted-v1.1', 'hosted-v1.2', 'hosted-v1.3', 'hosted-v1.4']),
   reg.versions.map((v) => v.id))
ok('unversioned receipts try hosted-v1.1 then hosted-v1.0',
   same(reg.unversioned_order, ['hosted-v1.1', 'hosted-v1.0']), reg.unversioned_order)

const byId = Object.fromEntries(reg.versions.map((v) => [v.id, v])) as Record<string, VersionEntry>
const v10 = byId['hosted-v1.0']!, v11 = byId['hosted-v1.1']!, v12 = byId['hosted-v1.2']!

for (const v of reg.versions) {
  ok(`${v.id}: required_fields sorted`, sorted(v.required_fields), v.required_fields)
  ok(`${v.id}: optional_fields sorted`, sorted(v.optional_fields), v.optional_fields)
  ok(`${v.id}: required and optional are disjoint`,
     v.required_fields.every((f) => !v.optional_fields.includes(f)))
}

// ── the legacy lists are exactly canonical-receipt-fields.json version 1 ─────
const v1OptionalNoDegraded = v1.optional_fields.filter((f) => f !== 'degraded')
ok('hosted-v1.0 is unversioned', v10.schema_version === null)
ok('hosted-v1.0 status legacy', v10.status === 'legacy', v10.status)
ok('hosted-v1.0 required == legacy_required_fields', same(v10.required_fields, v1.legacy_required_fields), v10.required_fields)
ok('hosted-v1.0 optional == optional_fields minus degraded', same(v10.optional_fields, v1OptionalNoDegraded), v10.optional_fields)
ok('hosted-v1.0 does not sign degraded', v10.degraded_rule === 'unsigned', v10.degraded_rule)

ok('hosted-v1.1 is unversioned', v11.schema_version === null)
ok('hosted-v1.1 status legacy (superseded by hosted-v1.2)', v11.status === 'legacy', v11.status)
ok('hosted-v1.1 required == legacy_required_fields + degraded',
   same(v11.required_fields, [...v1.legacy_required_fields, 'degraded'].sort()), v11.required_fields)
ok('hosted-v1.1 optional == optional_fields minus degraded', same(v11.optional_fields, v1OptionalNoDegraded), v11.optional_fields)
ok('hosted-v1.1 signs absent degraded as false', v11.degraded_rule === 'absent-is-false', v11.degraded_rule)
ok('hosted-v1.1 all fields == the 26 canonical-receipt-fields.json fields',
   same([...v11.required_fields, ...v11.optional_fields].sort(),
        [...v1.legacy_required_fields, ...v1.optional_fields].sort()))

// ── hosted-v1.2 ──────────────────────────────────────────────────────────────
ok('hosted-v1.2 schema_version is "hosted-v1.2"', v12.schema_version === 'hosted-v1.2', v12.schema_version)
ok('hosted-v1.2 status current', v12.status === 'current', v12.status)
ok('hosted-v1.2 degraded is required', v12.degraded_rule === 'required', v12.degraded_rule)
ok('hosted-v1.2 required == hosted-v1.1 required + integrity_grade + schema_version',
   same(v12.required_fields, [...v11.required_fields, 'integrity_grade', 'schema_version'].sort()), v12.required_fields)
ok('hosted-v1.2 optional == hosted-v1.1 optional + agent_id + degraded_reason + owner_oid',
   same(v12.optional_fields, [...v11.optional_fields, 'agent_id', 'degraded_reason', 'owner_oid'].sort()), v12.optional_fields)
ok('hosted-v1.2 signs 31 fields', v12.required_fields.length + v12.optional_fields.length === 31)
for (const f of ['schema_version', 'integrity_grade', 'degraded_reason', 'agent_id', 'owner_oid']) {
  ok(`neither legacy version signs ${f}`,
     ![...v10.required_fields, ...v10.optional_fields, ...v11.required_fields, ...v11.optional_fields].includes(f))
}

// ── hosted-v1.3 (F2): grant-bound ────────────────────────────────────────────
// grant_oid was already an optional signed field of every version. hosted-v1.3
// is the hosted-v1.2 field set with grant_oid REQUIRED; a receipt carrying a
// grant (A2A delegation) uses it, every other receipt stays hosted-v1.2.
const v13 = byId['hosted-v1.3']
ok('hosted-v1.3 exists', v13 !== undefined)
if (v13) {
  ok('hosted-v1.3 schema_version is "hosted-v1.3"', v13.schema_version === 'hosted-v1.3', v13.schema_version)
  ok('hosted-v1.3 status current', v13.status === 'current', v13.status)
  ok('hosted-v1.3 degraded is required', v13.degraded_rule === 'required', v13.degraded_rule)
  ok('hosted-v1.3 required == hosted-v1.2 required + grant_oid',
     same(v13.required_fields, [...v12.required_fields, 'grant_oid'].sort()), v13.required_fields)
  ok('hosted-v1.3 optional == hosted-v1.2 optional minus grant_oid',
     same(v13.optional_fields, v12.optional_fields.filter((f) => f !== 'grant_oid')), v13.optional_fields)
  ok('hosted-v1.3 signs the same 31 fields as hosted-v1.2',
     same([...v13.required_fields, ...v13.optional_fields].sort(), [...v12.required_fields, ...v12.optional_fields].sort()))
  ok('grant_oid is optional in every earlier version (signed when present since T14)',
     [v10, v11, v12].every((v) => v.optional_fields.includes('grant_oid')))
}

// ── hosted-v1.4 (C1): approver-bound ─────────────────────────────────────────
// Desk spec v1 section 9: the human approver is inside the signed bytes.
// hosted-v1.4 = the hosted-v1.3 field list + approver_oid (REQUIRED). grant_oid
// is optional again (ASSUMED: most approval receipts carry no grant).
// approver_oid is signed by no earlier version, and a receipt carrying it
// under an earlier version is refused (refused_when_unsigned), not warned.
const v14 = byId['hosted-v1.4']
const reg14 = reg as unknown as { refused_when_unsigned?: string[] }
ok('hosted-v1.4 exists', v14 !== undefined)
if (v14 && v13) {
  ok('hosted-v1.4 schema_version is "hosted-v1.4"', v14.schema_version === 'hosted-v1.4', v14.schema_version)
  ok('hosted-v1.4 status current', v14.status === 'current', v14.status)
  ok('hosted-v1.4 degraded is required', v14.degraded_rule === 'required', v14.degraded_rule)
  ok('hosted-v1.4 required == hosted-v1.2 required + approver_oid',
     same(v14.required_fields, [...v12.required_fields, 'approver_oid'].sort()), v14.required_fields)
  ok('hosted-v1.4 optional == hosted-v1.2 optional (grant_oid optional)',
     same(v14.optional_fields, v12.optional_fields), v14.optional_fields)
  ok('hosted-v1.4 signs the hosted-v1.3 field list + approver_oid (32 fields)',
     same([...v14.required_fields, ...v14.optional_fields].sort(),
          [...v13.required_fields, ...v13.optional_fields, 'approver_oid'].sort()) &&
     v14.required_fields.length + v14.optional_fields.length === 32)
  ok('no earlier version signs approver_oid',
     [v10, v11, v12, v13].every((v) => ![...v.required_fields, ...v.optional_fields].includes('approver_oid')))
  const notes = (v14 as unknown as { field_notes?: Record<string, string> }).field_notes ?? {}
  ok('hosted-v1.4 field_notes define approver_oid as the enrolled operator OID',
     /operator/.test(notes['approver_oid'] ?? '') && /oid-/.test(notes['approver_oid'] ?? ''), notes['approver_oid'])
}
ok('refused_when_unsigned == ["approver_oid"]',
   same(reg14.refused_when_unsigned ?? [], ['approver_oid']), reg14.refused_when_unsigned)

// ── enums ────────────────────────────────────────────────────────────────────
ok('integrity_grades == A, B, C, D', same(reg.integrity_grades, ['A', 'B', 'C', 'D']), reg.integrity_grades)
// F2 (Joshua, Oct 31): six codes. trust_token_unverified is folded into
// trust_token_absent (same grade B). Unreleased v1.2 vocabulary, not a version.
const EXPECTED_CODES: Record<string, string> = {
  manifest_missing:       'D',
  modified_code:          'D',
  resilience_fallback:    'D',
  trust_token_absent:     'B',
  trust_token_expired:    'B',
  trust_token_flagged:    'C',
}
ok('degraded_reason_codes == the six hosted-v1.2 codes and grades',
   JSON.stringify(reg.degraded_reason_codes) === JSON.stringify(EXPECTED_CODES), reg.degraded_reason_codes)
ok('trust_token_unverified is not a code (folded into trust_token_absent)',
   !Object.prototype.hasOwnProperty.call(reg.degraded_reason_codes, 'trust_token_unverified'))
ok('degraded_reason_codes keys sorted', sorted(Object.keys(reg.degraded_reason_codes)))
ok('no code grades A (A means not degraded)', Object.values(reg.degraded_reason_codes).every((g) => g !== 'A'))

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
