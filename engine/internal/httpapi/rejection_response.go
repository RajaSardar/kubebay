package httpapi

import (
	"encoding/json"
	"net/http"
)

// writePolicyRejectionOrError writes a structured 422 policy-rejection body
// when err matches an admission-webhook denial (the same shape
// HandleApplyYAML already returned before this existed), otherwise a flat
// 502 with the raw error text — unchanged behavior for anything else.
// Returns the parsed rejection so a caller can also audit it, or nil for an
// ordinary error.
func writePolicyRejectionOrError(w http.ResponseWriter, err error) *PolicyRejection {
	if rejection := parsePolicyRejection(err); rejection != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":           "policy-rejected",
			"policyRejection": rejection,
		})
		return rejection
	}
	http.Error(w, err.Error(), http.StatusBadGateway)
	return nil
}
