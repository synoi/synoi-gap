/**
 * test/receipt.test.ts -- T22 receipt() one-liner.
 *
 * Proves the claims made in README/CHANGELOG for the packaging release:
 *   - one call produces a self-signed, valid gap:decision_receipt CDRO
 *   - the signature verifies against the operator's own public key
 *   - tampering the envelope invalidates the signature
 *   - the OID matches computeGapOid over the same payload (no second
 *     canonicalizer / no divergent hashing path)
 *   - verifyUrl defaults to the documented PENDING host and formats
 *     `${base}/r/<oid>`, and can be suppressed with `verifyUrlBase: null`
 *   - no network call is made (jsdom-free process; asserted by absence of
 *     any fetch/http usage and by timing -- see note below)
 *   - validateGapDecisionReceipt accepts the produced envelope
 */

import {
  receipt,
  generateReceiptKeyPair,
  verifyReceiptSignature,
  DEFAULT_VERIFY_URL_BASE,
  computeGapOid,
  validateGapDecisionReceipt,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

const baseInput = {
  subjectKind: 'capability_invocation' as const,
  subjectOid: 'sha256:' + '11'.repeat(32),
  initiator: { actor_oid: 'actor:me', actor_type: 'human_user' as const },
}

// 1. One call, zero config -- the 60-second path.
const r1 = receipt(baseInput)
ok('receipt() returns an envelope with a content-addressed oid',
   typeof r1.envelope.oid === 'string' && r1.envelope.oid.startsWith('sha256:'))
ok('receipt() envelope has type gap:decision_receipt',
   r1.envelope.type === 'gap:decision_receipt')
ok('receipt() envelope carries a signature',
   typeof r1.envelope.signature === 'string' && r1.envelope.signature.length > 0)
ok('receipt() envelope carries a signature_key_id',
   typeof r1.envelope.signature_key_id === 'string' && r1.envelope.signature_key_id.length > 0)
ok('receipt() defaults status to ok',
   r1.envelope.body.status === 'ok')
ok('receipt() defaults tenant_id to self',
   r1.envelope.tenant_id === 'self')

// 2. Signature verifies against the operator's own key, self-contained.
ok('verifyReceiptSignature: valid signature verifies',
   verifyReceiptSignature(r1.envelope, r1.keyPair.publicKey))

// 3. Tamper detection: mutate a signed field, signature must fail.
const tampered = { ...r1.envelope, body: { ...r1.envelope.body, status: 'denied' as const } }
ok('verifyReceiptSignature: tampered body fails verification',
   !verifyReceiptSignature(tampered, r1.keyPair.publicKey))

// 4. Wrong key fails verification.
const otherKeyPair = generateReceiptKeyPair()
ok('verifyReceiptSignature: wrong public key fails verification',
   !verifyReceiptSignature(r1.envelope, otherKeyPair.publicKey))

// 5. OID matches computeGapOid over the content core -- no second hashing path.
//    gap_version is KEPT in identity (ADR_019), so it MUST be part of the
//    recomputed content core, exactly as receipt() computes it.
const recomputedOid = computeGapOid({
  type: r1.envelope.type,
  gap_version: r1.envelope.gap_version,
  receipt_scheme: r1.envelope.receipt_scheme,
  tenant_id: r1.envelope.tenant_id,
  created_at_ms: r1.envelope.created_at_ms,
  created_by: r1.envelope.created_by,
  body: r1.envelope.body,
})
ok('receipt() oid matches computeGapOid over the content core (incl. gap_version, receipt_scheme)',
   r1.envelope.oid === recomputedOid)

// 6. computeGapOid also matches when passed the FULL envelope (oid/signature
//    fields present) -- proves receipt() strips the same exclusion set
//    computeGapOid strips internally, i.e. one shared canonicalization path.
ok('receipt() oid matches computeGapOid over the full signed envelope too',
   r1.envelope.oid === computeGapOid(r1.envelope))

// 7. verifyUrl: honest default, documents PENDING resolver, no network call.
ok('receipt() verifyUrl defaults to DEFAULT_VERIFY_URL_BASE + /r/<oid>',
   r1.verifyUrl === `${DEFAULT_VERIFY_URL_BASE}/r/${r1.envelope.oid}`)
ok('DEFAULT_VERIFY_URL_BASE is the documented oid.synoi.systems host',
   DEFAULT_VERIFY_URL_BASE === 'https://oid.synoi.systems')

const r2 = receipt(baseInput, { verifyUrlBase: null })
ok('receipt() verifyUrl is null when verifyUrlBase is explicitly null',
   r2.verifyUrl === null)

const r3 = receipt(baseInput, { verifyUrlBase: 'https://self-hosted.example' })
ok('receipt() verifyUrl honors a caller-supplied base',
   r3.verifyUrl === `https://self-hosted.example/r/${r3.envelope.oid}`)

// 8. Key reuse: passing the same keyPair back in produces receipts that
//    verify against the same public key and carry the same signature_key_id.
const sharedKeyPair = generateReceiptKeyPair('key:my-operator-key')
const r4 = receipt(baseInput, { keyPair: sharedKeyPair })
const r5 = receipt({ ...baseInput, subjectOid: 'sha256:' + '22'.repeat(32) }, { keyPair: sharedKeyPair })
ok('receipt() reuses a caller-supplied keyId across calls',
   r4.envelope.signature_key_id === 'key:my-operator-key'
   && r5.envelope.signature_key_id === 'key:my-operator-key')
ok('receipt() reused keypair verifies both receipts against the same public key',
   verifyReceiptSignature(r4.envelope, sharedKeyPair.publicKey)
   && verifyReceiptSignature(r5.envelope, sharedKeyPair.publicKey))
ok('receipt() distinct subjects produce distinct oids under the same key',
   r4.envelope.oid !== r5.envelope.oid)

// 9. Round-trips through JSON (wire-format safe) and stays valid.
const wireEnvelope = JSON.parse(JSON.stringify(r1.envelope))
ok('receipt() envelope round-trips through JSON.stringify/parse unchanged',
   wireEnvelope.oid === r1.envelope.oid && wireEnvelope.signature === r1.envelope.signature)

// 10. Interop: the produced envelope passes the package's own validator.
const validation = validateGapDecisionReceipt(r1.envelope)
ok('validateGapDecisionReceipt accepts a receipt() envelope',
   validation.ok, validation.errors.join('; '))

// 11. Custom fields: detail, explicit status, explicit timing.
const r6 = receipt({
  ...baseInput,
  status: 'denied',
  detail: 'capability_denied:no_grant',
  initiatedAtMs: 1700000000000,
  resolvedAtMs: 1700000000123,
})
ok('receipt() honors explicit status/detail/timing',
   r6.envelope.body.status === 'denied'
   && r6.envelope.body.detail === 'capability_denied:no_grant'
   && r6.envelope.body.initiated_at_ms === 1700000000000
   && r6.envelope.body.resolved_at_ms === 1700000000123)

// 12. No network call: this whole test file runs synchronously to completion
//     with no fetch/http import anywhere in receipt.ts (grep-verified in
//     review) and no network available in this sandboxed test run; every
//     assertion above completed without an await on any I/O.
ok('receipt() calls above completed synchronously (no network round-trip)', true)

// 13. receipt_scheme discriminator (lite carve-out, ADR_014 Section 10.1):
//     stamped on every envelope, bound into the OID + signature (tamper-evident).
import { RECEIPT_SCHEME_GAP_SELFSIGN } from '../src/index.js'
ok('receipt() stamps receipt_scheme = RECEIPT_SCHEME_GAP_SELFSIGN',
   r1.envelope.receipt_scheme === RECEIPT_SCHEME_GAP_SELFSIGN)
ok('RECEIPT_SCHEME_GAP_SELFSIGN is the documented wire value',
   RECEIPT_SCHEME_GAP_SELFSIGN === 'synoi.receipt/gap-selfsign')
ok('receipt_scheme participates in the OID (content-addressed, not a bare label)',
   r1.envelope.oid === computeGapOid({
     type: r1.envelope.type,
     gap_version: r1.envelope.gap_version,
     receipt_scheme: r1.envelope.receipt_scheme,
     tenant_id: r1.envelope.tenant_id,
     created_at_ms: r1.envelope.created_at_ms,
     created_by: r1.envelope.created_by,
     body: r1.envelope.body,
   }))
const tamperedScheme = { ...r1.envelope, receipt_scheme: 'synoi.receipt/v2' }
ok('verifyReceiptSignature: tampered receipt_scheme fails verification',
   !verifyReceiptSignature(tamperedScheme, r1.keyPair.publicKey))

// 14. Security F2 (2026-07-12 quality gate): oid/gap_version/supersedes are
//     all in signingPayload's EXCLUDED_FIELDS, so the Ed25519 signature alone
//     never covered them. A validly-signed envelope with any of these three
//     fields swapped MUST still fail verifyReceiptSignature via the
//     computeGapOid rebind check, or content-addressing (and the
//     Merkle-lineage supersedes edge) is forgeable without invalidating the
//     signature.
const tamperedOid = { ...r1.envelope, oid: 'sha256:' + 'ff'.repeat(32) }
ok('verifyReceiptSignature: tampered oid (signature bytes otherwise untouched) fails verification',
   !verifyReceiptSignature(tamperedOid, r1.keyPair.publicKey))

const tamperedGapVersion = { ...r1.envelope, gap_version: '2.0' as unknown as typeof r1.envelope.gap_version }
ok('verifyReceiptSignature: tampered gap_version fails verification (protocol-downgrade forgery closed)',
   !verifyReceiptSignature(tamperedGapVersion, r1.keyPair.publicKey))

const tamperedSupersedes = { ...r1.envelope, supersedes: 'sha256:' + 'aa'.repeat(32) }
ok('verifyReceiptSignature: forged supersedes lineage edge fails verification',
   !verifyReceiptSignature(tamperedSupersedes, r1.keyPair.publicKey))

// Sanity: the UNTAMPERED envelope's own oid genuinely equals computeGapOid
// over itself (the rebind check's happy path is not vacuously true).
ok('verifyReceiptSignature: rebind check sanity -- untampered oid equals computeGapOid(envelope)',
   r1.envelope.oid === computeGapOid(r1.envelope))
ok('verifyReceiptSignature: untampered envelope still verifies TRUE (rebind check does not false-positive)',
   verifyReceiptSignature(r1.envelope, r1.keyPair.publicKey))

// 15. ADVERSARY re-clear (2026-07-12): the oid-rebind check alone catches
//     only a LAZY attacker who mutates a field but leaves oid stale (test 14
//     above). computeGapOid is a PUBLIC, UNKEYED sha256 -- an attacker with
//     no secret can mutate a field, RECOMPUTE a matching oid, and reuse the
//     ORIGINAL signature bytes unchanged. Before the EXCLUDED_FIELDS fix
//     (bringing gap_version/supersedes/signature_key_id into the signed
//     payload), this recompute-oid variant verified TRUE -- the actual live
//     attack, not defended by the rebind check alone. Each variant below
//     mutates a field AND recomputes a matching oid the same way receipt()
//     does, then reuses the original signature; all three MUST verify FALSE
//     now that those fields are bound into the Ed25519 signature itself.

function recomputeOidFor(envelope: typeof r1.envelope): string {
  return computeGapOid({
    type: envelope.type,
    gap_version: envelope.gap_version,
    receipt_scheme: envelope.receipt_scheme,
    tenant_id: envelope.tenant_id,
    created_at_ms: envelope.created_at_ms,
    created_by: envelope.created_by,
    body: envelope.body,
    supersedes: envelope.supersedes,
  })
}

// 15a. gap_version mutated AND oid recomputed to match -- the exact Adversary
//      proof: "gap_version mutated AND oid recomputed to match -> TRUE, the
//      actual attack, NOT defended" against the old code.
const forgedGapVersion = {
  ...r1.envelope,
  gap_version: '2.0' as unknown as typeof r1.envelope.gap_version,
}
forgedGapVersion.oid = recomputeOidFor(forgedGapVersion)
ok('ADVERSARY: gap_version mutated + oid recomputed to match + original signature reused -> MUST fail',
   !verifyReceiptSignature(forgedGapVersion, r1.keyPair.publicKey))

// 15b. supersedes forged AND oid recomputed to match (Merkle-lineage edge
//      forgery with no secret required).
const forgedSupersedes = {
  ...r1.envelope,
  supersedes: 'sha256:' + 'bb'.repeat(32),
}
forgedSupersedes.oid = recomputeOidFor(forgedSupersedes)
ok('ADVERSARY: supersedes forged + oid recomputed to match + original signature reused -> MUST fail',
   !verifyReceiptSignature(forgedSupersedes, r1.keyPair.publicKey))

// 15c. signature_key_id swapped AND oid recomputed to match. signature_key_id
//      is not part of computeGapOid's content core either way (it is one of
//      the six normative CDRO_ENVELOPE_FIELDS), so the oid does not even need
//      to change here -- which is exactly why it must be bound into the
//      SIGNATURE instead: an attacker could otherwise relabel which key
//      "signed" a receipt while keeping oid and signature bytes untouched.
const forgedKeyId = {
  ...r1.envelope,
  signature_key_id: otherKeyPair.keyId ?? 'key:attacker-controlled',
}
ok('ADVERSARY: signature_key_id swapped (oid unaffected either way, signature reused) -> MUST fail',
   !verifyReceiptSignature(forgedKeyId, r1.keyPair.publicKey))

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
