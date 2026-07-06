// Package gapcore implements the GAP (Governed Action Protocol) core:
// RFC 8785 JCS canonical JSON, content-addressed OID computation, Ed25519
// detached signatures, and the CDRO / decision-receipt content-core projection.
//
// It is a byte-for-byte port of the shipped TypeScript reference in
// synoi-gap (canonicalize.ts, oid.ts, receipt.ts) and the COF/GAP
// canonicalizer exercised by the cross-language conformance vectors in
// synoi-conformance. It does NOT introduce a second, divergent canonicalizer:
// every rule here is anchored to an executable conformance vector.
package gapcore

import (
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// ErrNonFinite is returned when a non-finite float (NaN, +Inf, -Inf) is
// encountered. RFC 8785 forbids these; the TS reference throws a TypeError.
var ErrNonFinite = errors.New("gapcore canonicalize: non-finite number is not allowed in canonical JSON")

// ErrFloatForbidden is returned by CanonicalizeGAP when a non-integer number is
// encountered. The GAP CDRO profile forbids floats (money uses integer minor
// units; time uses integer milliseconds). The broader SRAID canonicalizer
// (Canonicalize) permits floats, matching the sraid/canonicalize.json vectors.
var ErrFloatForbidden = errors.New("gapcore canonicalize: float values are not allowed; use integer minor units (e.g. cents)")

// Number distinguishes an integer from a float at canonicalization time. The
// JSON decoder collapses both into float64, which loses the integer/float
// distinction needed to (a) forbid floats in the GAP profile and (b) format
// large integers without exponential notation. Callers who decode with
// UseNumber (json.Number) preserve the token; DecodeCanonicalInput below wires
// that through automatically.
type jsonKind int

const (
	kindInt jsonKind = iota
	kindFloat
)

// numberToken carries a parsed JSON number plus whether its source token was an
// integer literal (no '.', no exponent). This mirrors JS Number.isInteger used
// by the TS reference to decide float rejection.
type numberToken struct {
	value float64
	kind  jsonKind
}

// Canonicalize serializes value to RFC 8785 JCS canonical JSON, matching the
// SRAID canonicalizer used by sraid/canonicalize.json (floats permitted). value
// must be the output of DecodeCanonicalInput (or built from the same node
// types): map[string]interface{}, []interface{}, string, bool, nil, or
// numberToken.
func Canonicalize(value interface{}) (string, error) {
	var b strings.Builder
	if err := canonical(&b, value, false); err != nil {
		return "", err
	}
	return b.String(), nil
}

// CanonicalizeGAP is Canonicalize with the GAP CDRO float-rejection profile:
// any non-integer number throws (matches gap canonicalize.ts and the
// canonicalize_reject vectors). Integers are still serialized without
// exponential notation.
func CanonicalizeGAP(value interface{}) (string, error) {
	var b strings.Builder
	if err := canonical(&b, value, true); err != nil {
		return "", err
	}
	return b.String(), nil
}

func canonical(b *strings.Builder, value interface{}, forbidFloat bool) error {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
		return nil
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
		return nil
	case string:
		writeJSONString(b, v)
		return nil
	case numberToken:
		return writeNumber(b, v, forbidFloat)
	case float64:
		// Fallback for values not carrying integer/float provenance. Treated as
		// float unless it is a mathematical integer.
		tok := numberToken{value: v, kind: kindFloat}
		if v == math.Trunc(v) && !math.IsInf(v, 0) {
			tok.kind = kindInt
		}
		return writeNumber(b, tok, forbidFloat)
	case int:
		b.WriteString(strconv.Itoa(v))
		return nil
	case int64:
		b.WriteString(strconv.FormatInt(v, 10))
		return nil
	case []interface{}:
		b.WriteByte('[')
		for i, e := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonical(b, e, forbidFloat); err != nil {
				return err
			}
		}
		b.WriteByte(']')
		return nil
	case map[string]interface{}:
		keys := make([]string, 0, len(v))
		for k := range v {
			// RFC 8785 keeps null; only genuinely-absent keys are dropped. Go
			// maps have no "undefined", so every present key is emitted.
			keys = append(keys, k)
		}
		sortUTF16(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSONString(b, k)
			b.WriteByte(':')
			if err := canonical(b, v[k], forbidFloat); err != nil {
				return err
			}
		}
		b.WriteByte('}')
		return nil
	default:
		return errors.New("gapcore canonicalize: unsupported type in canonical JSON")
	}
}

func writeNumber(b *strings.Builder, n numberToken, forbidFloat bool) error {
	if math.IsInf(n.value, 0) || math.IsNaN(n.value) {
		return ErrNonFinite
	}
	isInteger := n.value == math.Trunc(n.value)
	if n.kind == kindInt || isInteger {
		if forbidFloat && n.kind == kindFloat && !isInteger {
			return ErrFloatForbidden
		}
		// Integer path: emit without exponent. -0 normalizes to 0.
		if n.value == 0 {
			b.WriteString("0")
			return nil
		}
		if isInteger && math.Abs(n.value) < 1e21 {
			b.WriteString(strconv.FormatFloat(n.value, 'f', -1, 64))
			return nil
		}
	}
	if forbidFloat {
		return ErrFloatForbidden
	}
	b.WriteString(ecmaNumberToString(n.value))
	return nil
}

// ecmaNumberToString reproduces ECMAScript Number.prototype.toString(10) as
// required by RFC 8785 §3.2.2.3. Go's shortest 'g' formatting produces the same
// shortest-round-trip mantissa; the remaining work is matching ECMAScript's
// exponent-notation thresholds and syntax (e.g. "1e-10", "1e+21").
func ecmaNumberToString(f float64) string {
	if f == 0 {
		return "0"
	}
	// strconv 'g' shortest gives the correct significant digits. We then
	// reshape the exponent form to ECMAScript rules.
	s := strconv.FormatFloat(f, 'g', -1, 64)
	// Go emits exponent as e.g. "1e-10" or "1e+21" already, but may also emit
	// "0.0000000001" or "1e-10" depending on magnitude. Normalize by working
	// from the decomposed shortest digits.
	mant, exp := shortestDigits(f)
	neg := false
	if strings.HasPrefix(mant, "-") {
		neg = true
		mant = mant[1:]
	}
	// mant is the significant digits (no dot); k = number of digits; the value
	// is mant * 10^(exp). Let n be position of decimal point: value = d.ddd *
	// 10^(n-1). ECMAScript algorithm (ECMA-262 Number::toString) below.
	k := len(mant)
	n := exp + k // exponent of the leading digit position (value ~ 10^(n-1))
	var out string
	switch {
	case k <= n && n <= 21:
		out = mant + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		out = mant[:n] + "." + mant[n:]
	case -6 < n && n <= 0:
		out = "0." + strings.Repeat("0", -n) + mant
	default:
		// Exponential notation.
		e := n - 1
		var esign string
		if e >= 0 {
			esign = "+"
		} else {
			esign = "-"
			e = -e
		}
		if k == 1 {
			out = mant + "e" + esign + strconv.Itoa(e)
		} else {
			out = mant[:1] + "." + mant[1:] + "e" + esign + strconv.Itoa(e)
		}
	}
	if neg {
		out = "-" + out
	}
	_ = s
	return out
}

// shortestDigits returns the shortest decimal significant digits of f and a
// base-10 exponent such that value = digits * 10^exp (digits read as an
// integer). It relies on strconv's shortest 'e' formatting.
func shortestDigits(f float64) (string, int) {
	s := strconv.FormatFloat(f, 'e', -1, 64) // e.g. "1.234e-10" or "-3.14e+00"
	neg := ""
	if strings.HasPrefix(s, "-") {
		neg = "-"
		s = s[1:]
	}
	eIdx := strings.IndexByte(s, 'e')
	mantPart := s[:eIdx]
	expPart := s[eIdx+1:]
	exp, _ := strconv.Atoi(expPart)
	dot := strings.IndexByte(mantPart, '.')
	var digits string
	var fracLen int
	if dot < 0 {
		digits = mantPart
	} else {
		digits = mantPart[:dot] + mantPart[dot+1:]
		fracLen = len(mantPart) - dot - 1
	}
	// value = digits * 10^(exp - fracLen)
	return neg + digits, exp - fracLen
}

// sortUTF16 sorts keys by their UTF-16 code-unit sequence, per RFC 8785 §3.2.3
// (proven by the emoji-key conformance vector: an astral key sorts after
// ASCII). Go's default string sort is by UTF-8 bytes, which orders astral
// characters differently, so a dedicated comparator is required.
func sortUTF16(keys []string) {
	sort.SliceStable(keys, func(i, j int) bool {
		return lessUTF16(keys[i], keys[j])
	})
}

func lessUTF16(a, b string) bool {
	ua := utf16.Encode([]rune(a))
	ub := utf16.Encode([]rune(b))
	n := len(ua)
	if len(ub) < n {
		n = len(ub)
	}
	for i := 0; i < n; i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

// writeJSONString serializes s as a JSON string using the minimal-escaping
// rules RFC 8785 inherits from ECMAScript JSON.stringify: escape only ", \,
// and control characters U+0000..U+001F (with the short forms \b \t \n \f \r);
// all other characters, including non-ASCII, are emitted literally as UTF-8.
func writeJSONString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString("\\\"")
		case '\\':
			b.WriteString("\\\\")
		case '\b':
			b.WriteString("\\b")
		case '\t':
			b.WriteString("\\t")
		case '\n':
			b.WriteString("\\n")
		case '\f':
			b.WriteString("\\f")
		case '\r':
			b.WriteString("\\r")
		default:
			if r < 0x20 {
				const hex = "0123456789abcdef"
				b.WriteString("\\u00")
				b.WriteByte(hex[(r>>4)&0xf])
				b.WriteByte(hex[r&0xf])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
