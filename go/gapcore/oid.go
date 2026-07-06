package gapcore

import (
	"crypto/sha256"
	"encoding/hex"
)

// OIDOf computes the content-addressed OID of an arbitrary canonical value:
// "sha256:" + hex(sha256(Canonicalize(value))). This is the SRAID oidOf surface
// (sraid/oid.json): it canonicalizes the value as-is, without field stripping,
// using the permissive SRAID canonicalizer. Use ComputeGapOid / CdroOid for CDRO
// envelopes, which strip the detached fields and enforce the GAP number rule.
func OIDOf(value interface{}) (string, error) {
	canon, err := Canonicalize(value)
	if err != nil {
		return "", err
	}
	return oidFromCanonical(canon), nil
}

// ComputeGapOid computes the OID of a GAP CDRO. It accepts either a
// pre-stripped OID payload or a full envelope: the SIX detached-signature /
// envelope fields (see contentCoreExcluded) are removed before canonicalization
// so a pre-attestation payload and a post-attestation envelope yield the same
// OID, while gap_version and supersedes are KEPT in identity. It uses the
// float-rejecting GAP canonicalizer (ADR_019). Identical result to CdroOid;
// kept under its historical name for API stability. Mirrors @synoi/gap
// computeGapOid and @synoi/sraid cdroOid.
func ComputeGapOid(envelope map[string]interface{}) (string, error) {
	return CdroOid(envelope)
}

func oidFromCanonical(canon string) string {
	sum := sha256.Sum256([]byte(canon))
	return "sha256:" + hex.EncodeToString(sum[:])
}
