/**
 * receipt.ts -- T22: the `receipt()` one-liner. Mass-market packaging around
 * the shipped GAP surface (CDRO envelope, `computeGapOid`, `canonicalize`).
 *
 * Design goal (THE_PLAN Section 2, rung 1): one import, one call, a first
 * signed receipt in under 60 seconds, with the operator's own key -- no
 * account, no network call, no managed custody.
 *
 * What this wraps, and nothing more:
 *   - `computeGapOid` / `canonicalize` (oid.ts / canonicalize.ts) for the
 *     content-addressed OID -- the SAME canonicalizer and exclusion set
 *     GapDecisionReceipt.oid already uses. No second canonicalizer.
 *   - A single Ed25519 signature (`@noble/curves`, already a declared
 *     dependency) over `canonicalize(envelope minus excluded fields)` --
 *     the identical exclusion set and signing surface `computeGapOid`
 *     already strips (`oid`, `gap_version`, `signature`, `signature_key_id`,
 *     `supersedes`). This mirrors the gateway's v1 signing shape
 *     (synoi-gateway/src/gap/receipt-sign.ts: signGapReceipt) at the
 *     single-Ed25519-key, self-custody tier; it does not attempt the
 *     gateway's ML-DSA-65 hybrid or KMS-backed oracle path, which require
 *     managed custody (T6/T14, PENDING) that this free/self-host tier does
 *     not have.
 *
 * What this explicitly does NOT do:
 *   - No network calls. `verifyUrlBase` only formats a string; nothing is
 *     fetched, posted, or phoned home. The default base documents that the
 *     path resolves once the neutral resolver ships (PENDING T15) rather
 *     than pretending it resolves today.
 *   - No managed key custody. The caller supplies (or this module generates
 *     locally, once, for convenience) their OWN Ed25519 key. This is a
 *     "self-signed with the operator's own key" receipt, per the Vocabulary
 *     Discipline in THE_PLAN Section 2.1: NOT a "test-key" transitional
 *     artifact, and NOT a claim of third-party-neutral verification.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { computeGapOid } from './oid.js'
import { canonicalize } from './canonicalize.js'
import type { GapCdroEnvelope } from './cdro.js'
import type { GapDecisionReceiptBody, DecisionStatus } from './receipts.js'

/**
 * Default verify-URL base. Honest today: this hostname does not resolve
 * anything yet. It becomes live once the neutral resolver (T15) deploys.
 * Callers who want no verify_url at all can pass `verifyUrlBase: null`.
 */
export const DEFAULT_VERIFY_URL_BASE = 'https://oid.synoi.systems'

/**
 * The `receipt_scheme` value `receipt()` stamps on every envelope it
 * produces. Consumed by @synoi/verify's fail-closed `verifyReceiptByScheme`
 * dispatcher to route to the matching single-Ed25519 self-sign verifier.
 * Bound into the signed bytes (not in EXCLUDED_FIELDS below), so a receipt
 * cannot claim this tier without actually being signed as one.
 */
export const RECEIPT_SCHEME_GAP_SELFSIGN = 'synoi.receipt/gap-selfsign'

/**
 * A locally generated or caller-supplied Ed25519 keypair used to self-sign
 * a receipt. `privateKey` never leaves the process; nothing here transmits
 * it anywhere.
 */
export interface ReceiptKeyPair {
  /** 32-byte Ed25519 private (seed) key. */
  privateKey: Uint8Array
  /** 32-byte Ed25519 public key, derived from `privateKey`. */
  publicKey: Uint8Array
  /**
   * Caller-chosen identifier for this key, written to the envelope's
   * `signature_key_id`. Defaults to a `key:` + hex-prefix of the public key
   * if not supplied, so a receipt is always self-describing about which key
   * signed it even with zero configuration.
   */
  keyId?: string
}

/**
 * Generate a fresh Ed25519 keypair for self-signing receipts. Purely local;
 * makes no network call. Callers who already operate a key (e.g. loaded
 * from their own secret store) should skip this and pass their own
 * `ReceiptKeyPair` to `receipt()` instead -- this helper exists only so a
 * brand-new caller can get a first signed receipt with zero setup.
 */
export function generateReceiptKeyPair(keyId?: string): ReceiptKeyPair {
  const privateKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  return { privateKey, publicKey, keyId }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function defaultKeyId(publicKey: Uint8Array): string {
  return 'key:' + bytesToHex(publicKey).slice(0, 16)
}

/** Fields excluded from the OID hash / signing payload, per GAP spec §2.1. */
const EXCLUDED_FIELDS = new Set(['oid', 'gap_version', 'signature', 'signature_key_id', 'supersedes'])

function signingPayload(envelope: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(envelope)) {
    if (!EXCLUDED_FIELDS.has(k)) out[k] = envelope[k]
  }
  return out
}

/** Minimal input shape accepted by `receipt()`: everything needed to build
 *  a `gap:decision_receipt` OID payload, minus the parts this function
 *  fills in for the caller (subject_oid, initiator, timing) if given.
 */
export interface ReceiptInput {
  /** Tenant scope. Defaults to `'self'` for a single-operator, self-hosted use. */
  tenantId?: string
  /** Actor OID that is emitting this receipt. Defaults to the signing key's id. */
  createdBy?: string
  /** What this receipt is a decision about. Required -- there is no honest default. */
  subjectKind: GapDecisionReceiptBody['subject_kind']
  /** OID (or any caller-chosen identifier string) of the thing decided upon. */
  subjectOid: string
  /** Who/what initiated the governed action. */
  initiator: GapDecisionReceiptBody['initiator']
  /** Decision outcome. Defaults to `'ok'`. */
  status?: DecisionStatus
  /** Free-text detail, e.g. an error code from ERROR_CODES.md. */
  detail?: string
  /** Server/local clock ms when the action was initiated. Defaults to Date.now(). */
  initiatedAtMs?: number
  /** Server/local clock ms when the action was resolved. Defaults to Date.now(). */
  resolvedAtMs?: number
}

/** The result of `receipt()`: a signed CDRO envelope plus its verify URL. */
export interface Receipt {
  /** The full signed `gap:decision_receipt` CDRO envelope. */
  envelope: GapCdroEnvelope<GapDecisionReceiptBody>
  /**
   * Where this receipt could be looked up by a third party, once the neutral
   * resolver is live. PENDING T15: this URL does not resolve anything today.
   * `null` if the caller passed `verifyUrlBase: null`.
   */
  verifyUrl: string | null
  /** The keypair used to sign, in case the caller wants to persist it for reuse. */
  keyPair: ReceiptKeyPair
}

export interface ReceiptOptions {
  /**
   * Existing keypair to self-sign with. If omitted, a fresh keypair is
   * generated locally (see `generateReceiptKeyPair`). Reuse a keypair across
   * calls if you want all your receipts to verify against the same
   * `signature_key_id`.
   */
  keyPair?: ReceiptKeyPair
  /**
   * Base URL used to build `verifyUrl` as `${verifyUrlBase}/r/<oid>`.
   * Defaults to `DEFAULT_VERIFY_URL_BASE`
   * ('https://oid.synoi.systems') -- documented as PENDING: this becomes a
   * live, resolvable link once the neutral resolver (T15) ships; today it is
   * a formatted string only, never fetched. Pass `null` to omit `verifyUrl`
   * entirely.
   */
  verifyUrlBase?: string | null
}

/**
 * Build and self-sign a `gap:decision_receipt` CDRO with the operator's own
 * key, in one call. No network call is made. This is the free, self-host
 * rung of the ladder (THE_PLAN Section 2.2, rung 1): the receipt verifies
 * against YOUR OWN key today; it does not yet verify at a neutral,
 * third-party-hosted resolver (PENDING T15, see `verifyUrl`).
 *
 * @example
 * ```ts
 * import { receipt } from '@synoi/gap'
 *
 * const r = receipt({
 *   subjectKind: 'capability_invocation',
 *   subjectOid: 'sha256:...',      // the invocation this receipt decides on
 *   initiator: { actor_oid: 'actor:me', actor_type: 'human_user' },
 * })
 *
 * console.log(r.envelope.oid)   // sha256:<hex> -- content-addressed
 * console.log(r.envelope.signature) // base64url Ed25519 signature
 * console.log(r.verifyUrl)      // https://oid.synoi.systems/r/sha256:... (PENDING T15)
 * ```
 */
export function receipt(input: ReceiptInput, options: ReceiptOptions = {}): Receipt {
  const keyPair = options.keyPair ?? generateReceiptKeyPair()
  const keyId = keyPair.keyId ?? defaultKeyId(keyPair.publicKey)

  const now = Date.now()
  const initiatedAtMs = input.initiatedAtMs ?? now
  const resolvedAtMs = input.resolvedAtMs ?? now

  const body: GapDecisionReceiptBody = {
    subject_kind: input.subjectKind,
    subject_oid: input.subjectOid,
    initiator: input.initiator,
    status: input.status ?? 'ok',
    initiated_at_ms: initiatedAtMs,
    resolved_at_ms: resolvedAtMs,
  }
  if (input.detail !== undefined) body.detail = input.detail

  // The OID content core is the full CDRO minus the six detached-signature
  // fields (see computeGapOid / PROJECTION_SPEC.md §2). gap_version is KEPT in
  // identity (ADR_019), so it MUST be present when the OID is computed -- the
  // stamped oid has to commit gap_version, or a third party recomputing the OID
  // of the signed envelope would get a different value.
  const contentCore = {
    type: 'gap:decision_receipt' as const,
    gap_version: '1.0' as const,
    receipt_scheme: RECEIPT_SCHEME_GAP_SELFSIGN,
    tenant_id: input.tenantId ?? 'self',
    created_at_ms: initiatedAtMs,
    created_by: input.createdBy ?? keyId,
    body,
  }

  const oid = computeGapOid(contentCore)

  const envelope: GapCdroEnvelope<GapDecisionReceiptBody> = {
    oid,
    type: contentCore.type,
    gap_version: contentCore.gap_version,
    receipt_scheme: contentCore.receipt_scheme,
    tenant_id: contentCore.tenant_id,
    created_at_ms: contentCore.created_at_ms,
    created_by: contentCore.created_by,
    body: contentCore.body,
  }

  const canonical = canonicalize(signingPayload(envelope as unknown as Record<string, unknown>))
  const signatureBytes = ed25519.sign(new TextEncoder().encode(canonical), keyPair.privateKey)
  envelope.signature = Buffer.from(signatureBytes).toString('base64url')
  envelope.signature_key_id = keyId

  const verifyUrlBase = options.verifyUrlBase === undefined ? DEFAULT_VERIFY_URL_BASE : options.verifyUrlBase
  const verifyUrl = verifyUrlBase === null ? null : `${verifyUrlBase}/r/${oid}`

  return { envelope, verifyUrl, keyPair: { ...keyPair, keyId } }
}

/**
 * Verify a receipt's Ed25519 signature against the given public key, AND
 * that envelope.oid is the correct content-addressed identity for this
 * receipt. Purely local; makes no network call. This checks "did this key
 * sign this envelope, and does its OID actually match its content," not "is
 * this key trustworthy to a third party" -- the latter is what the neutral
 * resolver (PENDING T15) will add.
 *
 * Security F2 (2026-07-12 quality gate): `oid`, `gap_version`, and
 * `supersedes` are all in EXCLUDED_FIELDS (the SIGNED payload projection,
 * signingPayload() above), because `oid` cannot sign itself and
 * `gap_version`/`supersedes` were carried along in that same exclusion set.
 * That meant the Ed25519 signature alone never actually bound `oid` (or
 * `gap_version` / `supersedes`) to the signed content: a validly-signed
 * envelope's `oid` (or `gap_version` / `supersedes`) could be swapped to any
 * other value and this function would still return true, breaking
 * content-addressing (a receipt could be re-labeled under a different
 * identity, silently claim a different protocol version, or forge a
 * `supersedes` lineage edge) without invalidating the signature.
 *
 * Fix: after the signature check passes, recompute the content-addressed OID
 * the SAME way receipt() originally computed it (computeGapOid, which KEEPS
 * gap_version and supersedes in its hash per ADR_019 / oid.ts's
 * CDRO_ENVELOPE_FIELDS, even though signingPayload's EXCLUDED_FIELDS strips
 * them from the signed bytes) and require it to equal envelope.oid. One
 * check closes all three fields at once, because all three are inputs to
 * computeGapOid even though none are inputs to the Ed25519 signature.
 */
export function verifyReceiptSignature(
  envelope: GapCdroEnvelope<GapDecisionReceiptBody>,
  publicKey: Uint8Array,
): boolean {
  if (!envelope.signature) return false
  const canonical = canonicalize(signingPayload(envelope as unknown as Record<string, unknown>))
  const sigBytes = Buffer.from(envelope.signature, 'base64url')
  let sigValid: boolean
  try {
    sigValid = ed25519.verify(sigBytes, new TextEncoder().encode(canonical), publicKey)
  } catch {
    return false
  }
  if (!sigValid) return false
  // oid/gap_version/supersedes rebind (Security F2): the signature alone
  // does not cover these fields; the content-addressed OID must still match.
  return computeGapOid(envelope) === envelope.oid
}
