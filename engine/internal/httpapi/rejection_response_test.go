package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
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

func TestWriteErrorMapsKubernetesStatuses(t *testing.T) {
	gr := schema.GroupResource{Group: "apps", Resource: "deployments"}
	cases := []struct {
		err  error
		code int
	}{
		{apierrors.NewConflict(gr, "web", errors.New("the object has been modified")), http.StatusConflict},
		{apierrors.NewInvalid(schema.GroupKind{Group: "apps", Kind: "Deployment"}, "web", field.ErrorList{field.Invalid(field.NewPath("spec", "replicas"), -1, "must be >= 0")}), http.StatusUnprocessableEntity},
		{apierrors.NewForbidden(gr, "web", errors.New("RBAC: patch denied")), http.StatusForbidden},
		{apierrors.NewNotFound(gr, "web"), http.StatusNotFound},
		{errors.New("dial tcp: connection refused"), http.StatusBadGateway},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		writePolicyRejectionOrError(rr, c.err)
		if rr.Code != c.code {
			t.Errorf("%v: status = %d, want %d", c.err, rr.Code, c.code)
		}
		if strings.Contains(rr.Header().Get("Content-Type"), "json") {
			t.Errorf("%v: plain errors keep a text body so existing callers still show the message", c.err)
		}
		if !strings.Contains(rr.Body.String(), c.err.Error()) {
			t.Errorf("%v: body %q should carry the message", c.err, rr.Body.String())
		}
	}
}
