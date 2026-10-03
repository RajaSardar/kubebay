package httpapi

import (
	"encoding/json"
	"net/http"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// writePolicyRejectionOrError writes a structured 422 policy-rejection body
// when err matches an admission-webhook denial (the same shape
// HandleApplyYAML already returned before this existed), otherwise the raw
// error text under the status the API server meant: 409, 422, 403 or 404,
// and 502 for anything that isn't a Kubernetes status (unreachable, etc.).
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
	http.Error(w, err.Error(), statusFor(err))
	return nil
}

func statusFor(err error) int {
	switch {
	case apierrors.IsConflict(err):
		return http.StatusConflict
	case apierrors.IsInvalid(err):
		return http.StatusUnprocessableEntity
	case apierrors.IsForbidden(err):
		return http.StatusForbidden
	case apierrors.IsNotFound(err):
		return http.StatusNotFound
	default:
		return http.StatusBadGateway
	}
}
