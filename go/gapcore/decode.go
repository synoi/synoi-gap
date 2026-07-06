package gapcore

import (
	"bytes"
	"encoding/json"
	"strings"
)

// DecodeCanonicalInput decodes raw JSON bytes into the node types the
// canonicalizer understands, preserving the integer-vs-float distinction of
// each number token (so large integers avoid exponential notation and the GAP
// profile can reject floats). This mirrors how the TS reference operates on
// already-parsed JS values where Number.isInteger is available.
func DecodeCanonicalInput(raw []byte) (interface{}, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v interface{}
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return convert(v), nil
}

// convert walks the json.Number-preserving tree and replaces json.Number with
// numberToken (carrying integer/float provenance) and normalizes container
// types to the exact shapes canonical() switches on.
func convert(v interface{}) interface{} {
	switch t := v.(type) {
	case json.Number:
		return toNumberToken(t)
	case map[string]interface{}:
		out := make(map[string]interface{}, len(t))
		for k, e := range t {
			out[k] = convert(e)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(t))
		for i, e := range t {
			out[i] = convert(e)
		}
		return out
	default:
		return v
	}
}

func toNumberToken(n json.Number) numberToken {
	s := n.String()
	kind := kindInt
	// A JSON number is a float if it carries a decimal point or an exponent.
	if strings.ContainsAny(s, ".eE") {
		kind = kindFloat
	}
	f, _ := n.Float64()
	return numberToken{value: f, kind: kind}
}
