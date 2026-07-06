package gapcore

import (
	"encoding/hex"
	"testing"
)

// TestSelfSignRoundTrip proves the sign path (not just verify) against the
// exact seed the xlang vector documents: ed25519 seed [7,0,...,0,7]. If Go
// signing is byte-identical to the reference, re-signing the allow_receipt
// content core under this seed must reproduce a signature that verifies, and
// the derived public key must match the vector's ed25519_pub_hex.
func TestSelfSignRoundTrip(t *testing.T) {
	seed := make([]byte, 32)
	seed[0] = 7
	seed[31] = 7

	// Public key must match the vector's documented ed25519_pub_hex.
	pub, err := PublicFromSeed(seed)
	if err != nil {
		t.Fatal(err)
	}
	const wantPubHex = "f36893a20f88339def8609dd86b266309a97237e8cb23e52ee3bfb620a66afaf"
	if got := hex.EncodeToString(pub); got != wantPubHex {
		t.Fatalf("derived pub = %s, want %s (seed does not match reference)", got, wantPubHex)
	}

	// Sign an arbitrary DSSE payload and verify it round-trips.
	payloadType := "application/vnd.synoi.gap+json"
	payload := `{"body":{"decision":"allow"},"type":"gap:decision_receipt"}`
	sig, err := SignDetached(seed, PAE(payloadType, payload))
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyAttestationEd25519(pub, payloadType, payload, sig) {
		t.Fatal("self-signed attestation failed to verify")
	}
	if VerifyAttestationEd25519(pub, payloadType, payload+"x", sig) {
		t.Fatal("verified against tampered payload")
	}
	if VerifyAttestationEd25519(pub, payloadType+"x", payload, sig) {
		t.Fatal("verified against tampered payloadType (PAE type-binding broken)")
	}
}

// TestComputeGapOidStripsSixDetachedFields proves ComputeGapOid produces the
// same OID whether given a pre-attestation content core or the same object with
// the SIX detached-signature fields attached (ADR_019 / PROJECTION_SPEC.md
// Section 2). gap_version and supersedes are part of the content core and are
// KEPT identical in both forms here.
func TestComputeGapOidStripsSixDetachedFields(t *testing.T) {
	coreJSON := []byte(`{"type":"gap:decision_receipt","gap_version":"1.0","tenant_id":"t1","created_at_ms":1700000000000,"created_by":"op","body":{"x":1},"supersedes":"sha256:00"}`)
	postJSON := []byte(`{"type":"gap:decision_receipt","gap_version":"1.0","tenant_id":"t1","created_at_ms":1700000000000,"created_by":"op","body":{"x":1},"supersedes":"sha256:00","oid":"sha256:deadbeef","signature":"zzz","ml_dsa_signature":"mmm","signature_key_id":"k","signature_algorithm":"ed25519+ml-dsa-65","attestation":{"payloadType":"x","payload":"{}","signatures":[]}}`)

	cn, _ := DecodeCanonicalInput(coreJSON)
	pn, _ := DecodeCanonicalInput(postJSON)
	oidCore, err := ComputeGapOid(cn.(map[string]interface{}))
	if err != nil {
		t.Fatal(err)
	}
	oidPost, err := ComputeGapOid(pn.(map[string]interface{}))
	if err != nil {
		t.Fatal(err)
	}
	if oidCore != oidPost {
		t.Fatalf("pre- vs post-attestation OID differ: %s vs %s", oidCore, oidPost)
	}
}

// TestComputeGapOidKeepsGapVersionAndSupersedes proves that gap_version and
// supersedes are hashed into identity (ADR_019): dropping either changes the
// OID.
func TestComputeGapOidKeepsGapVersionAndSupersedes(t *testing.T) {
	coreJSON := []byte(`{"type":"gap:decision_receipt","gap_version":"1.0","tenant_id":"t1","created_at_ms":1700000000000,"created_by":"op","body":{"x":1},"supersedes":"sha256:00"}`)
	noGvJSON := []byte(`{"type":"gap:decision_receipt","tenant_id":"t1","created_at_ms":1700000000000,"created_by":"op","body":{"x":1},"supersedes":"sha256:00"}`)
	noSupJSON := []byte(`{"type":"gap:decision_receipt","gap_version":"1.0","tenant_id":"t1","created_at_ms":1700000000000,"created_by":"op","body":{"x":1}}`)

	cn, _ := DecodeCanonicalInput(coreJSON)
	gn, _ := DecodeCanonicalInput(noGvJSON)
	sn, _ := DecodeCanonicalInput(noSupJSON)
	base, _ := ComputeGapOid(cn.(map[string]interface{}))
	noGv, _ := ComputeGapOid(gn.(map[string]interface{}))
	noSup, _ := ComputeGapOid(sn.(map[string]interface{}))
	if base == noGv {
		t.Fatal("dropping gap_version did not change the OID (must be kept in identity)")
	}
	if base == noSup {
		t.Fatal("dropping supersedes did not change the OID (must be kept in identity)")
	}
}

// TestComputeGapOidADR019Keystone pins the exact object from PROJECTION_SPEC.md
// Section 2.3 to the shipped sraid OID. Per ADR_020 (sraid: wire-identifier
// migration), the version key is now sraid_version (value 2.0); gap_version
// is a distinct L3 field and stays.
func TestComputeGapOidADR019Keystone(t *testing.T) {
	keystoneJSON := []byte(`{"type":"gap:decision_receipt","sraid_version":"2.0","gap_version":"1.0","tenant_id":"tenant-x","created_at_ms":1720000000000,"created_by":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","body":{"decision":"allow","amount_minor":1299},"authority":{"grant_oid":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision":"allow"},"supersedes":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`)
	kn, err := DecodeCanonicalInput(keystoneJSON)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ComputeGapOid(kn.(map[string]interface{}))
	if err != nil {
		t.Fatal(err)
	}
	const want = "sha256:d1d5d5c51d2d5f80470089ff10b8b642e19fc76db6be298f4f346616528a087a"
	if got != want {
		t.Fatalf("keystone OID mismatch:\n  want %s\n  got  %s", want, got)
	}
}
