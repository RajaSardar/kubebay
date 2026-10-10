package clouddiscovery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
)

// fakeGcloud stands in for the user's gcloud: project "shop-prod" has a
// regional and a zonal cluster; "locked" has the API disabled.
type fakeGcloud struct{ calls [][]string }

func (f *fakeGcloud) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	joined := strings.Join(args, " ")
	switch {
	case joined == "projects list --format=json --limit=200":
		return []byte(`[{"projectId":"shop-prod","name":"Shop prod"},{"projectId":"locked-1","name":"Locked"},{"projectId":"--evil","name":"x"}]`), nil
	case joined == "config get-value project":
		return []byte("shop-prod\n"), nil
	case joined == "container clusters list --project shop-prod --format=json":
		return []byte(`[
			{"name":"web","location":"europe-west1","endpoint":"34.1.2.3","status":"RUNNING","currentMasterVersion":"1.31.1-gke.100","masterAuth":{"clusterCaCertificate":"Q0EtREFUQQ=="}},
			{"name":"batch","location":"europe-west1-b","endpoint":"34.4.5.6","status":"PROVISIONING","currentMasterVersion":"1.30.5-gke.1","masterAuth":{"clusterCaCertificate":"Q0EtREFUQQ=="}},
			{"name":"Bad Name","location":"europe-west1","endpoint":"1.1.1.1"}
		]`), nil
	case joined == "container clusters list --project locked-1 --format=json":
		return nil, errors.New("exit status 1: ERROR: (gcloud.container.clusters.list) Kubernetes Engine API has not been used in project 123 before or it is disabled.")
	case strings.HasPrefix(joined, "container clusters describe web --location europe-west1 --project shop-prod --format=json"):
		return []byte(`{"name":"web","location":"europe-west1","endpoint":"34.1.2.3","status":"RUNNING","currentMasterVersion":"1.31.1-gke.100","masterAuth":{"clusterCaCertificate":"Q0EtREFUQQ=="}}`), nil
	}
	return nil, fmt.Errorf("unexpected gcloud %s", joined)
}

func TestScanGKEListsEveryLocationInTheProject(t *testing.T) {
	f := &fakeGcloud{}
	res := ScanGKE(context.Background(), f.run, "shop-prod")
	if len(res.Errors) != 0 || len(res.Clusters) != 2 {
		t.Fatalf("scan = %+v", res)
	}
	b := res.Clusters[0]
	if b.Name != "batch" || b.Location != "europe-west1-b" || b.Project != "shop-prod" || b.Version != "1.30.5-gke.1" || b.Status != "PROVISIONING" || b.Context != "gke_shop-prod_europe-west1-b_batch" {
		t.Errorf("batch = %+v", b)
	}
	if res.Clusters[1].Name != "web" {
		t.Errorf("sorted by name: %+v", res.Clusters)
	}
	if len(f.calls) != 1 {
		t.Errorf("one list call covers every location: %v", f.calls)
	}
}

func TestScanGKEExplainsWhatToDo(t *testing.T) {
	res := ScanGKE(context.Background(), (&fakeGcloud{}).run, "locked-1")
	if len(res.Errors) != 1 || !strings.Contains(res.Errors[0].Message, "Kubernetes Engine API") || !strings.Contains(res.Errors[0].Message, "enable") {
		t.Errorf("errors = %+v", res.Errors)
	}
	for in, want := range map[string]string{
		"gcloud CLI not found on PATH: install it":                                                "Google Cloud CLI",
		"ERROR: (gcloud.container.clusters.list) There was a problem refreshing your current auth tokens: Reauthentication failed": "gcloud auth login",
		"ERROR: You do not currently have an active account selected.":                           "gcloud auth login",
		"ERROR: (gcloud.container.clusters.list) ResponseError: code=403, message=Required \"container.clusters.list\" permission(s)": "container.clusters.list",
	} {
		if got := explainGcloud(errors.New(in)); !strings.Contains(got, want) {
			t.Errorf("%q → %q, want it to mention %q", in, got, want)
		}
	}
}

func TestGKENamesAreValidatedBeforeTheyReachArgv(t *testing.T) {
	f := &fakeGcloud{}
	for _, p := range []string{"--format=yaml", "Shop", "ab", ""} {
		if res := ScanGKE(context.Background(), f.run, p); len(res.Errors) != 1 {
			t.Errorf("project %q accepted", p)
		}
	}
	if _, err := DescribeGKE(context.Background(), f.run, "shop-prod", "--flag", "web"); err == nil {
		t.Error("bad location accepted")
	}
	if _, err := DescribeGKE(context.Background(), f.run, "shop-prod", "europe-west1", "-x"); err == nil {
		t.Error("bad name accepted")
	}
	if len(f.calls) != 0 {
		t.Errorf("nothing ran: %v", f.calls)
	}
	for _, ok := range []string{"shop-prod", "example.com:legacy-proj"} {
		if !ValidGCPProject(ok) {
			t.Errorf("%q rejected", ok)
		}
	}
	for _, ok := range []string{"us-central1", "europe-west1-b", "asia-northeast3-c"} {
		if !ValidGKELocation(ok) {
			t.Errorf("%q rejected", ok)
		}
	}
}

func TestGKEKubeconfigUsesTheAuthPluginNeverAToken(t *testing.T) {
	c, err := DescribeGKE(context.Background(), (&fakeGcloud{}).run, "shop-prod", "europe-west1", "web")
	if err != nil {
		t.Fatal(err)
	}
	b, err := GKEKubeconfig(c)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := clientcmd.Load(b)
	if err != nil {
		t.Fatal(err)
	}
	const ctx = "gke_shop-prod_europe-west1_web"
	if cfg.CurrentContext != ctx || cfg.Clusters[ctx].Server != "https://34.1.2.3" || string(cfg.Clusters[ctx].CertificateAuthorityData) != "CA-DATA" {
		t.Errorf("cluster = %+v", cfg.Clusters[ctx])
	}
	u := cfg.AuthInfos[ctx]
	if u.Token != "" || u.Exec == nil || u.Exec.Command != "gke-gcloud-auth-plugin" || u.Exec.APIVersion != "client.authentication.k8s.io/v1beta1" || !u.Exec.ProvideClusterInfo || !strings.Contains(u.Exec.InstallHint, "gcloud components install gke-gcloud-auth-plugin") {
		t.Errorf("user = %+v / exec %+v", u, u.Exec)
	}
	if GKEFileName(c) != "gke-shop-prod-europe-west1-web.yaml" {
		t.Errorf("file = %s", GKEFileName(c))
	}
}

func TestGCPProjectsMarksTheDefaultAndDropsBadIDs(t *testing.T) {
	ps, err := GCPProjects(context.Background(), (&fakeGcloud{}).run)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || ps[0].ID != "locked-1" || ps[1].ID != "shop-prod" || !ps[1].Default || ps[1].Name != "Shop prod" {
		t.Errorf("projects = %+v", ps)
	}
}
