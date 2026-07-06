package gapcore

// contentCoreExcluded are the SIX detached-signature / envelope keys removed
// from a CDRO to obtain its content core: the signable, content-addressed
// projection of the object (ADR_019 decision 1;
// synoi-sraid/PROJECTION_SPEC.md Section 2). The set is derived from the ONE
// normative source, NOT independently hand-listed. gap_version and supersedes
// are deliberately NOT here: they are KEPT in identity so a protocol downgrade
// is OID-detectable and the Merkle-DAG lineage edge is tamper-evident.
var contentCoreExcluded = map[string]struct{}{
	"oid":                 {},
	"signature":           {},
	"ml_dsa_signature":    {},
	"signature_key_id":    {},
	"signature_algorithm": {},
	"attestation":         {},
}

// CdroContentCore returns the content-core projection of a CDRO: the top-level
// object with the six detached-signature / envelope fields removed and
// everything else (including gap_version and supersedes) kept. Canonicalizing
// this projection yields the exact bytes bound by a receipt-v2 attestation
// payload, and hashing it yields the CDRO's OID. Mirrors the reference
// cdroContentCore in @synoi/sraid.
func CdroContentCore(cdro map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(cdro))
	for k, v := range cdro {
		if _, skip := contentCoreExcluded[k]; skip {
			continue
		}
		out[k] = v
	}
	return out
}

// CdroOid computes the OID of a CDRO from its content core:
// "sha256:" + hex(sha256(CanonicalizeGAP(CdroContentCore(cdro)))). It uses the
// float-rejecting GAP canonicalizer (ADR_019 decision 2), so a float-bearing
// CDRO is rejected before hashing. This matches the receipt-v2 expected_oid
// and the sraid cdroOid.
func CdroOid(cdro map[string]interface{}) (string, error) {
	canon, err := CanonicalizeGAP(CdroContentCore(cdro))
	if err != nil {
		return "", err
	}
	return oidFromCanonical(canon), nil
}
