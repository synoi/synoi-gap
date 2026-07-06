package gapcore

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// vectorsDir resolves the synoi-conformance vectors directory. It honors the
// GAP_CONFORMANCE_VECTORS env override; otherwise it walks up from the test
// file to find the sibling synoi-conformance/vectors checkout. This test is
// the proof the Go core is real: it loads the SAME cross-language vectors the
// TS and Python SDKs run against and asserts byte-identical output.
//
// This package now lives at synoi-gap/go/gapcore (one level deeper than the
// old standalone synoi-gap-go/gapcore repo), so the walk-up bound is widened
// to still reach the synoi-conformance sibling at the synoi/ workspace root.
// A missing vectors directory is a hard failure (t.Fatalf), not a skip: a
// green run must mean the shared vectors were actually loaded, matching the
// Rust SDK's panic-on-missing behavior.
func vectorsDir(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("GAP_CONFORMANCE_VECTORS"); env != "" {
		return env
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// Candidate: <...>/synoi/synoi-gap/go/gapcore -> <...>/synoi/synoi-conformance/vectors
	dir := wd
	for i := 0; i < 8; i++ {
		cand := filepath.Join(dir, "..", "synoi-conformance", "vectors")
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			return cand
		}
		dir = filepath.Join(dir, "..")
	}
	t.Fatalf("synoi-conformance/vectors not found within 8 levels above %s; set GAP_CONFORMANCE_VECTORS to point at it", wd)
	return ""
}

func loadVectors(t *testing.T, dir, rel string, out interface{}) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
}

// rawInput re-marshals a vector's already-parsed input and re-decodes it via
// DecodeCanonicalInput so number provenance (int vs float) is preserved exactly
// as the canonicalizer requires.
func rawInput(t *testing.T, v map[string]json.RawMessage, key string) interface{} {
	t.Helper()
	node, err := DecodeCanonicalInput(v[key])
	if err != nil {
		t.Fatalf("decode input: %v", err)
	}
	return node
}

func TestCanonicalizeVectors(t *testing.T) {
	dir := vectorsDir(t)
	pass, total := 0, 0
	for _, rel := range []string{"sraid/canonicalize.json", "sraid/canonicalize-edge.json"} {
		var vecs []map[string]json.RawMessage
		loadVectors(t, dir, rel, &vecs)
		for _, v := range vecs {
			total++
			var name, expected string
			json.Unmarshal(v["name"], &name)
			json.Unmarshal(v["expected_canonical"], &expected)
			got, err := Canonicalize(rawInput(t, v, "input"))
			if err != nil {
				t.Errorf("[%s] %s: unexpected error: %v", rel, name, err)
				continue
			}
			if got != expected {
				t.Errorf("[%s] %s: canonical mismatch\n  want %q\n  got  %q", rel, name, expected, got)
				continue
			}
			pass++
		}
	}
	t.Logf("canonicalize: %d/%d vectors passed (sraid/canonicalize.json + sraid/canonicalize-edge.json)", pass, total)
}

func TestOIDVectors(t *testing.T) {
	dir := vectorsDir(t)
	pass, total := 0, 0
	for _, rel := range []string{"sraid/oid.json"} {
		var vecs []map[string]json.RawMessage
		loadVectors(t, dir, rel, &vecs)
		for _, v := range vecs {
			var kind string
			json.Unmarshal(v["kind"], &kind)
			if kind != "oid" {
				continue // oid_determinism is exercised separately below
			}
			total++
			var name, expected string
			json.Unmarshal(v["name"], &name)
			json.Unmarshal(v["expected_oid"], &expected)
			got, err := OIDOf(rawInput(t, v, "input"))
			if err != nil {
				t.Errorf("[%s] %s: unexpected error: %v", rel, name, err)
				continue
			}
			if got != expected {
				t.Errorf("[%s] %s: oid mismatch\n  want %s\n  got  %s", rel, name, expected, got)
				continue
			}
			pass++
		}
	}
	t.Logf("oid: %d/%d vectors passed (sraid/oid.json)", pass, total)
}

// TestOidDeterminism consumes the oid_determinism vector in sraid/oid.json:
// OIDOf must be deterministic (same input -> same OID across two calls) and
// match the vector's expected value.
func TestOidDeterminism(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "sraid/oid.json", &vecs)
	ran := 0
	for _, v := range vecs {
		var kind string
		json.Unmarshal(v["kind"], &kind)
		if kind != "oid_determinism" {
			continue
		}
		ran++
		var name, exp1, exp2 string
		json.Unmarshal(v["name"], &name)
		json.Unmarshal(v["expected_oid_1"], &exp1)
		json.Unmarshal(v["expected_oid_2"], &exp2)
		input := rawInput(t, v, "input")
		a1, err := OIDOf(input)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		a2, err := OIDOf(input)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if a1 != a2 {
			t.Errorf("%s: non-deterministic OIDOf: %s vs %s", name, a1, a2)
		}
		if a1 != exp1 || exp1 != exp2 {
			t.Errorf("%s: oid mismatch: got %s, want %s", name, a1, exp1)
		}
	}
	if ran == 0 {
		t.Skip("no oid_determinism vector present")
	}
	t.Logf("oid determinism: %d vector(s) passed (sraid/oid.json)", ran)
}

// TestGapOidVectors exercises the GAP CDRO OID surface (gap/oid.json): each
// vector's input is a pre-stripped OID payload; ComputeGapOid must reproduce
// expected_oid byte-for-byte across languages.
func TestGapOidVectors(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "gap/oid.json", &vecs)
	pass := 0
	for _, v := range vecs {
		var name, expected string
		json.Unmarshal(v["name"], &name)
		json.Unmarshal(v["expected_oid"], &expected)
		node := rawInput(t, v, "input")
		m, ok := node.(map[string]interface{})
		if !ok {
			t.Errorf("%s: input is not an object", name)
			continue
		}
		got, err := ComputeGapOid(m)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", name, err)
			continue
		}
		if got != expected {
			t.Errorf("%s: gap oid mismatch\n  want %s\n  got  %s", name, expected, got)
			continue
		}
		pass++
	}
	t.Logf("gap oid: %d/%d vectors passed (gap/oid.json)", pass, len(vecs))
}

// TestSignatureVectors verifies the Ed25519 half of the hybrid signature
// vectors (sraid/signatures.json). Each vector signs the UTF-8 bytes of the
// `canonical` field; expected_valid asserts whether the ed25519 signature
// verifies against ed25519_pub_b64. ML-DSA-65 (the second, PQ signature) is
// NOT verified here: see README "Post-quantum status".
func TestSignatureVectors(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "sraid/signatures.json", &vecs)
	pass := 0
	for _, v := range vecs {
		var name, canonical string
		var expectedValid bool
		json.Unmarshal(v["name"], &name)
		json.Unmarshal(v["canonical"], &canonical)
		json.Unmarshal(v["expected_valid"], &expectedValid)

		var env struct {
			Ed25519 string `json:"ed25519"`
		}
		json.Unmarshal(v["envelope"], &env)
		var pubB64 string
		json.Unmarshal(v["ed25519_pub_b64"], &pubB64)

		pub, err := base64.StdEncoding.DecodeString(pubB64)
		if err != nil {
			t.Errorf("%s: bad pub b64: %v", name, err)
			continue
		}
		sig, err := base64.StdEncoding.DecodeString(env.Ed25519)
		if err != nil {
			t.Errorf("%s: bad sig b64: %v", name, err)
			continue
		}
		got := VerifyDetached(pub, []byte(canonical), sig)

		// These vectors verify a HYBRID envelope (ed25519 AND ml-dsa-65 both
		// required); expected_valid is the AND of both legs. We can only judge
		// the ed25519 leg here:
		//   - expected_valid == true  => ed25519 leg MUST verify true.
		//   - a vector whose name marks the failure as the PQ leg ("ml-dsa")
		//     has a VALID ed25519 leg; ed25519 true is correct there.
		//   - every other expected_valid == false vector isolates the ed25519
		//     leg (tampered payload / wrong pub / tampered sig) => MUST verify
		//     false.
		var wantEd bool
		switch {
		case expectedValid:
			wantEd = true
		case strings.Contains(name, "ml-dsa"):
			wantEd = true // hybrid fails on PQ leg only; ed25519 leg is valid
		default:
			wantEd = false
		}
		if got != wantEd {
			t.Errorf("%s: ed25519 leg verify = %v, want %v", name, got, wantEd)
			continue
		}
		pass++
	}
	t.Logf("signatures (ed25519 leg of hybrid): %d/%d vectors passed (sraid/signatures.json)", pass, len(vecs))
}

// TestReceiptV2CanonicalVector proves the CDRO content-core projection and OID
// byte-for-byte against the canonical-mode receipt-v2 vector.
func TestReceiptV2CanonicalVector(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "sraid/receipt-v2.json", &vecs)
	pass, ran := 0, 0
	for _, v := range vecs {
		var mode string
		json.Unmarshal(v["mode"], &mode)
		if mode != "canonical" {
			continue
		}
		ran++
		var name, expectedCore, expectedOid string
		json.Unmarshal(v["name"], &name)
		json.Unmarshal(v["expected_content_core"], &expectedCore)
		json.Unmarshal(v["expected_oid"], &expectedOid)

		node := rawInput(t, v, "receipt")
		receipt := node.(map[string]interface{})

		gotCore, err := Canonicalize(CdroContentCore(receipt))
		if err != nil {
			t.Errorf("%s: content-core error: %v", name, err)
			continue
		}
		if gotCore != expectedCore {
			t.Errorf("%s: content-core mismatch\n  want %s\n  got  %s", name, expectedCore, gotCore)
			continue
		}
		gotOid, err := CdroOid(receipt)
		if err != nil {
			t.Errorf("%s: oid error: %v", name, err)
			continue
		}
		if gotOid != expectedOid {
			t.Errorf("%s: receipt oid mismatch\n  want %s\n  got  %s", name, expectedOid, gotOid)
			continue
		}
		pass++
	}
	if ran == 0 {
		t.Skip("no canonical-mode receipt-v2 vector present")
	}
	t.Logf("receipt-v2 content-core + oid: %d/%d canonical vectors passed (sraid/receipt-v2.json)", pass, ran)
}

// TestXlangGoldenReceiptSignature verifies the golden detached Ed25519
// signatures over the receipt-v2 attestation payloads in
// governed-action-receipt-xlang.json. These were emitted by the Rust harness
// under a fixed test seed; verifying them in Go proves cross-language signature
// interop on the ed25519 leg. The ml-dsa-65 leg is intentionally NOT verified
// (README "Post-quantum status").
func TestXlangGoldenReceiptSignature(t *testing.T) {
	dir := vectorsDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "wasm-shell", "governed-action-receipt-xlang.json"))
	if err != nil {
		t.Skipf("xlang vector not found: %v", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse xlang: %v", err)
	}
	var pubHex string
	json.Unmarshal(doc["ed25519_pub_hex"], &pubHex)
	pub, err := hex.DecodeString(pubHex)
	if err != nil {
		t.Fatalf("bad ed25519_pub_hex: %v", err)
	}

	type sigEntry struct {
		Alg string `json:"alg"`
		Sig string `json:"sig"`
	}
	type attestation struct {
		PayloadType string     `json:"payloadType"`
		Payload     string     `json:"payload"`
		Signatures  []sigEntry `json:"signatures"`
	}
	type receipt struct {
		Attestation attestation `json:"attestation"`
		OID         string      `json:"oid"`
		Body        json.RawMessage
	}

	pass := 0
	targets := []string{"allow_receipt", "deny_receipt"}
	for _, key := range targets {
		var r receipt
		if err := json.Unmarshal(doc[key], &r); err != nil {
			t.Fatalf("%s: parse: %v", key, err)
		}
		// 1. Verify the golden ed25519 signature over the attestation payload.
		var edSig []byte
		for _, s := range r.Attestation.Signatures {
			if s.Alg == "ed25519" {
				edSig, err = base64.StdEncoding.DecodeString(s.Sig)
				if err != nil {
					t.Fatalf("%s: bad ed25519 sig b64: %v", key, err)
				}
			}
		}
		if edSig == nil {
			t.Errorf("%s: no ed25519 signature present", key)
			continue
		}
		// The golden signatures are over the DSSE PAE (payloadType bound in),
		// not the raw payload bytes.
		if !VerifyAttestationEd25519(pub, r.Attestation.PayloadType, r.Attestation.Payload, edSig) {
			t.Errorf("%s: golden ed25519 signature failed to verify over PAE", key)
			continue
		}
		// 2. The attestation payload MUST equal Canonicalize(CdroContentCore(receipt)),
		//    binding the signed bytes to the content core.
		var full map[string]interface{}
		fullNode, err := DecodeCanonicalInput(doc[key])
		if err != nil {
			t.Fatalf("%s: decode: %v", key, err)
		}
		full = fullNode.(map[string]interface{})
		gotCore, err := Canonicalize(CdroContentCore(full))
		if err != nil {
			t.Errorf("%s: content-core error: %v", key, err)
			continue
		}
		if gotCore != r.Attestation.Payload {
			t.Errorf("%s: content-core does not match signed payload\n  payload %s\n  core    %s", key, r.Attestation.Payload, gotCore)
			continue
		}
		// 3. And CdroOid(receipt) must equal the vector's oid.
		gotOid, err := CdroOid(full)
		if err != nil {
			t.Errorf("%s: oid error: %v", key, err)
			continue
		}
		if gotOid != r.OID {
			t.Errorf("%s: oid mismatch\n  want %s\n  got  %s", key, r.OID, gotOid)
			continue
		}
		// 4. Negative control: verification must fail against a tampered payload.
		if VerifyAttestationEd25519(pub, r.Attestation.PayloadType, r.Attestation.Payload+" tampered", edSig) {
			t.Errorf("%s: signature verified against tampered payload (should not)", key)
			continue
		}
		pass++
	}
	t.Logf("xlang golden receipt: %d/%d receipts verified (ed25519 sig + content-core + oid, wasm-shell/governed-action-receipt-xlang.json)", pass, len(targets))
}

// TestADR019MixedVectors replays the shared ADR_019 vectors (which carry
// gap_version + supersedes + attestation) against ComputeGapOid. The corrected
// 6-field content-core strip KEEPS gap_version+supersedes, so ComputeGapOid
// must reproduce the sraid-computed expected_oid byte-for-byte.
func TestADR019MixedVectors(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "adr019/cdro-contentcore-mixed.json", &vecs)
	pass := 0
	for _, v := range vecs {
		var name, expected string
		json.Unmarshal(v["name"], &name)
		json.Unmarshal(v["expected_oid"], &expected)
		node := rawInput(t, v, "input")
		m, ok := node.(map[string]interface{})
		if !ok {
			t.Errorf("%s: input is not an object", name)
			continue
		}
		got, err := ComputeGapOid(m)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", name, err)
			continue
		}
		if got != expected {
			t.Errorf("%s: adr019 mixed oid mismatch\n  want %s\n  got  %s", name, expected, got)
			continue
		}
		pass++
	}
	if len(vecs) != 4 {
		t.Fatalf("expected 4 adr019 mixed vectors, got %d", len(vecs))
	}
	t.Logf("adr019 mixed oid: %d/%d vectors passed (adr019/cdro-contentcore-mixed.json)", pass, len(vecs))
}

// TestADR019FloatReject proves every float-bearing ADR_019 vector is rejected
// by the GAP OID path (CanonicalizeGAP / ComputeGapOid), matching decision 2.
func TestADR019FloatReject(t *testing.T) {
	dir := vectorsDir(t)
	var vecs []map[string]json.RawMessage
	loadVectors(t, dir, "adr019/float-reject.json", &vecs)
	pass := 0
	for _, v := range vecs {
		var name string
		json.Unmarshal(v["name"], &name)
		node := rawInput(t, v, "input")
		if _, err := CanonicalizeGAP(node); err == nil {
			t.Errorf("%s: CanonicalizeGAP accepted a float (must reject)", name)
			continue
		}
		if m, ok := node.(map[string]interface{}); ok {
			if _, err := ComputeGapOid(m); err == nil {
				t.Errorf("%s: ComputeGapOid accepted a float (must reject)", name)
				continue
			}
		}
		pass++
	}
	if len(vecs) != 6 {
		t.Fatalf("expected 6 adr019 float-reject vectors, got %d", len(vecs))
	}
	t.Logf("adr019 float-reject: %d/%d vectors passed (adr019/float-reject.json)", pass, len(vecs))
}

// TestCanonicalizeRejectFloatGAP proves the GAP profile rejects non-integer
// numbers (the float-forbidden rule in gap canonicalize.ts), while the COF
// profile accepts them.
func TestCanonicalizeRejectFloatGAP(t *testing.T) {
	node, err := DecodeCanonicalInput([]byte(`{"amount":3.14}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CanonicalizeGAP(node); err == nil {
		t.Error("CanonicalizeGAP accepted a float; GAP profile must reject it")
	}
	if _, err := Canonicalize(node); err != nil {
		t.Errorf("COF Canonicalize rejected a float; it must accept it: %v", err)
	}
}
