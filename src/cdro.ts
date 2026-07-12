/**
 * cdro.ts -- GAP CDRO envelope.
 *
 * CDRO = Content-addressed, Deterministic, Replayable Object. Every GAP
 * top-level record sits inside a `GapCdroEnvelope<TBody>`. The shape mirrors
 * the GAP gateway reference implementation wire types.
 *
 * NOTE: this envelope shape is locally redeclared in @synoi/gap rather
 * than imported from @synoi/sraid (which is being built in parallel). The two
 * packages will be wired together in a follow-up. The wire format is
 * identical, so cross-package compatibility is by-shape.
 */

export type GapObjectType =
  // -- v1 REFERENCE IMPLEMENTATION TYPES (conformance-backed) --
  // These 10 types are emitted by the v1 reference implementation and have
  // conformance vectors in synoi-conformance. They are the only types that
  // are considered SHIPPED for interoperability purposes.
  | 'gap:capability_declaration'
  | 'gap:capability_grant'
  | 'gap:capability_invocation'
  | 'gap:workflow_definition'
  | 'gap:workflow_instance'
  | 'gap:stage_transition'
  | 'gap:channel_event'
  | 'gap:decision_receipt'
  | 'gap:revocation_event'
  | 'gap:federation_handshake' // reserved for GAP 1.1 - not part of the active 1.0 conformance surface
  // -- DRAFT TYPES (defined in spec; not yet emitted by the v1 reference
  //    implementation; no conformance vector yet) --
  // Do NOT rely on these for interoperability. They will graduate to the
  // conformance-backed set when the reference implementation ships them and
  // vectors are added to synoi-conformance.
  | 'gap:break_glass_token'       // DRAFT: break-glass elevated access token
  | 'gap:local_override_credential' // DRAFT: local policy override credential
  | 'gap:lca_root'                // DRAFT: lowest-common-ancestor trust root
  | 'gap:erasure_event'           // DRAFT: GDPR-style data erasure audit record
  | 'gap:orchestration_chain'     // DRAFT: agent delegation chain (Item 1)
  | 'gap:consent_record'          // DRAFT: consent version chain (Item 4)
  | 'gap:pip_response'            // DRAFT: signed PIP response (Item 7)

/** Current GAP wire version. CDROs that don't match this version are
 *  rejected by validators. */
export const GAP_VERSION = '1.0' as const
export type GapVersion = typeof GAP_VERSION

/**
 * The OID content core (ADR_019; synoi-sraid/PROJECTION_SPEC.md §2) removes
 * EXACTLY the six detached-signature / envelope fields before hashing: `oid`,
 * `signature`, `ml_dsa_signature`, `signature_key_id`, `signature_algorithm`,
 * `attestation`. Everything else is KEPT and hashed into identity, INCLUDING
 * `gap_version` and `supersedes`. `computeGapOid` strips those six itself, so a
 * caller may pass either a pre-attestation content core or a full signed
 * envelope and get the same OID. A future field the signer stamps post-hash is
 * added to the normative set in one place (`@synoi/sraid`), never re-listed.
 */
export interface GapCdroEnvelope<TBody> {
  /** Content-addressed identifier: `sha256:<hex>` over canonical body. */
  oid: string
  /** Object type discriminator, e.g. `gap:capability_grant`. */
  type: GapObjectType
  /** Wire version of the GAP protocol. */
  gap_version: GapVersion
  /** Tenant scope. CDROs never cross tenant boundaries implicitly. */
  tenant_id: string
  /** Server-clock millisecond timestamp at envelope construction. */
  created_at_ms: number
  /** Actor OID that created this CDRO. */
  created_by: string
  /** Type-specific payload. */
  body: TBody
  /** Optional Ed25519 signature, base64-encoded. */
  signature?: string
  /** Identifier of the public key that produced `signature`. */
  signature_key_id?: string
  /** OID of a prior CDRO that this one replaces. */
  supersedes?: string
  /**
   * Optional receipt-tier discriminator. Not part of the six detached-signature
   * envelope fields (it is KEPT in the OID content core and the signed bytes,
   * same treatment as gap_version), so it is tamper-evident: a receipt cannot
   * claim a different tier after signing. Consumed by @synoi/verify's
   * fail-closed `verifyReceiptByScheme` dispatcher. Known values today:
   * 'synoi.receipt/v2' (gateway KMS-hybrid DSSE tier, set out-of-band by the
   * gateway, not by this package) and 'synoi.receipt/gap-selfsign' (this
   * package's single-Ed25519 `receipt()` self-sign tier, receipt.ts). Absent
   * on receipts predating this field.
   */
  receipt_scheme?: string
}

/**
 * A minimal pre-attestation payload shape convenient for builders constructing
 * a CDRO step-by-step: it omits the six detached-signature / envelope fields
 * (see `GapCdroEnvelope`). Passing this to `computeGapOid` yields the same OID
 * as passing the full signed envelope, because those six fields are stripped
 * either way. Note `gap_version` and `supersedes`, when present, ARE part of
 * the content core and DO affect the OID.
 */
export interface GapOidPayload<TBody> {
  type: GapObjectType
  tenant_id: string
  created_at_ms: number
  created_by: string
  body: TBody
}
