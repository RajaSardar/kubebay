package httpapi

import (
	"errors"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestParsePolicyRejection(t *testing.T) {
	t.Run("nil for a plain error", func(t *testing.T) {
		if got := parsePolicyRejection(errors.New("connection refused")); got != nil {
			t.Errorf("want nil, got %+v", got)
		}
	})

	t.Run("nil for a StatusError that isn't a webhook denial", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{Message: "deployments.apps \"x\" not found"}}
		if got := parsePolicyRejection(err); got != nil {
			t.Errorf("want nil, got %+v", got)
		}
	})

	t.Run("detects a Kyverno webhook denial and extracts the detail message", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{
			Message: `admission webhook "validate.kyverno.svc-fail" denied the request: resource Deployment/default/my-deploy was blocked due to the following policies

require-labels:
  autogen-check-for-labels: 'validation error: label ''team'' is required'`,
		}}
		got := parsePolicyRejection(err)
		if got == nil {
			t.Fatal("want a non-nil rejection")
		}
		if got.Engine != "kyverno" {
			t.Errorf("Engine = %q, want kyverno", got.Engine)
		}
		if got.Webhook != "validate.kyverno.svc-fail" {
			t.Errorf("Webhook = %q", got.Webhook)
		}
		if got.Message == "" {
			t.Error("Message should not be empty")
		}
	})

	t.Run("detects a Gatekeeper webhook denial", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{
			Message: `admission webhook "validation.gatekeeper.sh" denied the request: [require-labels] you must provide labels: {"team"}`,
		}}
		got := parsePolicyRejection(err)
		if got == nil {
			t.Fatal("want a non-nil rejection")
		}
		if got.Engine != "gatekeeper" {
			t.Errorf("Engine = %q, want gatekeeper", got.Engine)
		}
	})

	t.Run("engine is empty for an unrecognised webhook", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{
			Message: `admission webhook "my-custom-webhook.example.com" denied the request: nope`,
		}}
		got := parsePolicyRejection(err)
		if got == nil {
			t.Fatal("want a non-nil rejection")
		}
		if got.Engine != "" {
			t.Errorf("Engine = %q, want empty for an unrecognised webhook", got.Engine)
		}
	})

	t.Run("carries structured causes when present", func(t *testing.T) {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{
			Message: `admission webhook "validate.kyverno.svc-fail" denied the request: blocked`,
			Details: &metav1.StatusDetails{
				Causes: []metav1.StatusCause{
					{Type: metav1.CauseTypeFieldValueRequired, Message: "label 'team' is required", Field: "metadata.labels.team"},
				},
			},
		}}
		got := parsePolicyRejection(err)
		if got == nil {
			t.Fatal("want a non-nil rejection")
		}
		if len(got.Causes) != 1 {
			t.Fatalf("Causes = %+v, want 1 entry", got.Causes)
		}
		if got.Causes[0].Field != "metadata.labels.team" {
			t.Errorf("Causes[0].Field = %q", got.Causes[0].Field)
		}
	})
}
