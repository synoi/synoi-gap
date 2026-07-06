package gapcore

import (
	"crypto/ed25519"
	"errors"
	"strconv"
)

// PAE builds the DSSE (Dead Simple Signing Envelope) Pre-Authentication
// Encoding used by GAP attestations:
//
//	PAE(type, body) = "DSSEv1" SP LEN(type) SP type SP LEN(body) SP body
//
// where LEN is the ASCII decimal BYTE length. Binding payloadType and both
// lengths into the signed bytes is what makes a signature minted for one
// payloadType fail against another. Matches @synoi/sraid attestation.pae.
func PAE(payloadType, payload string) []byte {
	typeBytes := []byte(payloadType)
	bodyBytes := []byte(payload)
	prefix := "DSSEv1 " + strconv.Itoa(len(typeBytes)) + " " + payloadType + " " + strconv.Itoa(len(bodyBytes)) + " "
	out := make([]byte, 0, len(prefix)+len(bodyBytes))
	out = append(out, prefix...)
	out = append(out, bodyBytes...)
	return out
}

// VerifyAttestationEd25519 verifies the ed25519 signature leg of a DSSE
// attestation over PAE(payloadType, payload). The GAP attestation profile is
// hybrid (ed25519 AND ml-dsa-65 both required); this verifies only the ed25519
// leg. See README "Post-quantum status" for the ml-dsa-65 leg.
func VerifyAttestationEd25519(pub []byte, payloadType, payload string, sig []byte) bool {
	return VerifyDetached(pub, PAE(payloadType, payload), sig)
}

// SignDetached produces a detached Ed25519 signature over message using the
// given seed (32-byte private key / RFC 8032 seed). The signature is the
// standard 64-byte Ed25519 detached signature, matching the TS reference's
// ed25519.sign (@noble/curves) over the same message bytes.
func SignDetached(seed []byte, message []byte) ([]byte, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("gapcore: ed25519 seed must be 32 bytes")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return ed25519.Sign(priv, message), nil
}

// PublicFromSeed derives the 32-byte Ed25519 public key from a 32-byte seed.
func PublicFromSeed(seed []byte) ([]byte, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("gapcore: ed25519 seed must be 32 bytes")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	return pub, nil
}

// VerifyDetached verifies a detached Ed25519 signature over message against a
// 32-byte public key. Returns false (never panics) on malformed inputs, so it
// is safe to call directly on untrusted conformance-vector data.
func VerifyDetached(pub []byte, message []byte, sig []byte) bool {
	if len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), message, sig)
}

// SignCanonical canonicalizes value (COF profile), then produces a detached
// Ed25519 signature over the canonical UTF-8 bytes. This is the single-key
// self-custody signing surface mirrored from receipt.ts.
func SignCanonical(seed []byte, value interface{}) (canonical string, sig []byte, err error) {
	canonical, err = Canonicalize(value)
	if err != nil {
		return "", nil, err
	}
	sig, err = SignDetached(seed, []byte(canonical))
	if err != nil {
		return "", nil, err
	}
	return canonical, sig, nil
}
