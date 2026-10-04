package httpapi

import (
	"bytes"
	"strings"
	"testing"
)

// stripComplianceSpecs removes ClusterComplianceReport CR instances from the
// rendered manifest. These are preset compliance definitions (k8s-cis-1.23,
// k8s-nsa-1.0, etc.) included by some Trivy-Operator chart versions regardless
// of operator.clusterComplianceEnabled. Their CRD is in crds/ and installed
// first, but Helm's REST mapper cache doesn't refresh between the CRD install
// and manifest validation steps, so the mapper can't find ClusterComplianceReport
// and fails with "resource mapping not found".
//
// Stripping the CR instances (not the CRD itself) is safe: with
// clusterComplianceEnabled=false, these preset objects are unused. The CRD is
// still installed (it lives in crds/, which bypasses the PostRenderer).

func TestStripComplianceSpecs(t *testing.T) {
	cc := func(docs ...string) *bytes.Buffer {
		return bytes.NewBufferString(strings.Join(docs, "\n---\n"))
	}
	sa := "apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: trivy-operator"
	dep := "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: trivy-operator"
	cis := "apiVersion: aquasecurity.github.io/v1alpha1\nkind: ClusterComplianceReport\nmetadata:\n  name: k8s-cis-1.23"
	nsa := "apiVersion: aquasecurity.github.io/v1alpha1\nkind: ClusterComplianceReport\nmetadata:\n  name: k8s-nsa-1.0"

	r := &stripComplianceSpecs{}

	t.Run("passthrough when no compliance specs present", func(t *testing.T) {
		in := cc(sa, dep)
		out, err := r.Run(in)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(out.String(), "ServiceAccount") {
			t.Error("ServiceAccount should be kept")
		}
		if !strings.Contains(out.String(), "Deployment") {
			t.Error("Deployment should be kept")
		}
	})

	t.Run("strips ClusterComplianceReport docs", func(t *testing.T) {
		in := cc(sa, cis, dep, nsa)
		out, err := r.Run(in)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out.String(), "ClusterComplianceReport") {
			t.Error("ClusterComplianceReport should be stripped")
		}
		if !strings.Contains(out.String(), "ServiceAccount") {
			t.Error("ServiceAccount should be kept")
		}
		if !strings.Contains(out.String(), "Deployment") {
			t.Error("Deployment should be kept")
		}
	})

	t.Run("empty manifest returns empty", func(t *testing.T) {
		out, err := r.Run(bytes.NewBuffer(nil))
		if err != nil {
			t.Fatal(err)
		}
		if strings.TrimSpace(out.String()) != "" {
			t.Errorf("expected empty, got %q", out.String())
		}
	})

	t.Run("does not strip the ClusterComplianceReport CRD definition itself", func(t *testing.T) {
		crd := "apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\nmetadata:\n  name: clustercompliancereports.aquasecurity.github.io"
		in := cc(crd, cis)
		out, err := r.Run(in)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(out.String(), "CustomResourceDefinition") {
			t.Error("CRD definition should be kept")
		}
		if strings.Contains(out.String(), "kind: ClusterComplianceReport") {
			t.Error("CR instance should be stripped")
		}
	})
}
