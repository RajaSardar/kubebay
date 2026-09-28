package httpapi

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestWritePolicyRejectionOrError(t *testing.T) {
	t.Run("writes a structured 422 for an admission-webhook denial and returns the rejection", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{
			Message: `admission webhook "validate.kyverno.svc-fail" denied the request: label 'team' is required`,
		}}
		w := httptest.NewRecorder()
		got := writePolicyRejectionOrError(w, err)

		if got == nil {
			t.Fatal("want a non-nil rejection")
		}
		if w.Code != 422 {
			t.Errorf("status = %d, want 422", w.Code)
		}
		var body map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("body is not valid JSON: %v", err)
		}
		if body["error"] != "policy-rejected" {
			t.Errorf(`body["error"] = %v, want "policy-rejected"`, body["error"])
		}
	})

	t.Run("falls back to a flat 502 for an ordinary error and returns nil", func(t *testing.T) {
		w := httptest.NewRecorder()
		got := writePolicyRejectionOrError(w, errors.New("connection refused"))

		if got != nil {
			t.Errorf("want nil rejection, got %+v", got)
		}
		if w.Code != 502 {
			t.Errorf("status = %d, want 502", w.Code)
		}
		if w.Body.String() == "" {
			t.Error("want the raw error text in the body")
		}
	})
}
