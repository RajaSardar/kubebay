package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
)

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
