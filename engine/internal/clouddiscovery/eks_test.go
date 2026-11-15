package clouddiscovery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
)

// fakeAWS answers list-clusters/describe-cluster per region, and records calls.
type fakeAWS struct {
	mu       sync.Mutex
	calls    [][]string
	clusters map[string][]string // region -> names
	fail     map[string]error    // region -> error
}

func (f *fakeAWS) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.mu.Lock()
	f.calls = append(f.calls, append([]string{name}, args...))
	f.mu.Unlock()
	region := argAfter(args, "--region")
	if err := f.fail[region]; err != nil {
		return nil, err
	}
	switch {
	case len(args) >= 2 && args[0] == "eks" && args[1] == "list-clusters":
		names := f.clusters[region]
		return []byte(fmt.Sprintf(`{"clusters": [%s]}`, quoteAll(names))), nil
	case len(args) >= 2 && args[0] == "eks" && args[1] == "describe-cluster":
		n := argAfter(args, "--name")
		return []byte(fmt.Sprintf(`{"cluster": {"name": %q, "arn": "arn:aws:eks:%s:111122223333:cluster/%s",
			"endpoint": "https://%s.gr7.%s.eks.amazonaws.com", "certificateAuthority": {"data": "Q0EtREFUQQ=="},
			"status": "ACTIVE", "version": "1.31"}}`, n, region, n, n, region)), nil
	}
	return nil, fmt.Errorf("unexpected call %v", args)
}

func argAfter(args []string, flag string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag {
			return args[i+1]
		}
	}
	return ""
}

func quoteAll(ss []string) string {
	q := make([]string, len(ss))
	for i, s := range ss {
		q[i] = fmt.Sprintf("%q", s)
	}
	return strings.Join(q, ",")
}

func TestScanListsAndDescribesEveryRegion(t *testing.T) {
	f := &fakeAWS{clusters: map[string][]string{"eu-west-1": {"prod", "dev"}, "us-east-1": {"ci"}}}
	res := ScanEKS(context.Background(), f.run, "work", []string{"us-east-1", "eu-west-1"})
	if len(res.Errors) != 0 {
		t.Fatalf("errors: %+v", res.Errors)
	}
	var got []string
	for _, c := range res.Clusters {
		got = append(got, c.Region+"/"+c.Name+" "+c.Arn)
	}
	want := []string{
		"eu-west-1/dev arn:aws:eks:eu-west-1:111122223333:cluster/dev",
		"eu-west-1/prod arn:aws:eks:eu-west-1:111122223333:cluster/prod",
		"us-east-1/ci arn:aws:eks:us-east-1:111122223333:cluster/ci",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("clusters:\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if c := res.Clusters[0]; c.Endpoint != "https://dev.gr7.eu-west-1.eks.amazonaws.com" || c.Version != "1.31" || c.Status != "ACTIVE" || c.Account != "111122223333" {
		t.Errorf("first cluster: %+v", c)
	}
	for _, call := range f.calls {
		if argAfter(call, "--profile") != "work" || argAfter(call, "--output") != "json" {
			t.Errorf("call %v should pass --profile work and --output json", call)
		}
	}
}

// A region the account can't use must not cost the user the regions it can.
func TestScanKeepsGoingPastARegionThatFails(t *testing.T) {
	f := &fakeAWS{
		clusters: map[string][]string{"eu-west-1": {"prod"}},
		fail: map[string]error{
			"ap-east-1": errors.New("exit status 254: An error occurred (UnrecognizedClientException) when calling the ListClusters operation: The security token included in the request is invalid."),
		},
	}
	res := ScanEKS(context.Background(), f.run, "", []string{"eu-west-1", "ap-east-1"})
	if len(res.Clusters) != 1 || res.Clusters[0].Name != "prod" {
		t.Fatalf("clusters: %+v", res.Clusters)
	}
	if len(res.Errors) != 1 || res.Errors[0].Region != "ap-east-1" || !strings.Contains(res.Errors[0].Message, "not enabled") {
		t.Errorf("errors: %+v", res.Errors)
	}
	for _, call := range f.calls {
		if argAfter(call, "--profile") != "" {
			t.Errorf("no profile was chosen, so none is passed: %v", call)
		}
	}
}

func TestExplainNamesTheFix(t *testing.T) {
	for raw, want := range map[string]string{
		"Error when retrieving token from sso: Token has expired and refresh failed":                                "aws sso login --profile work",
		"An error occurred (AccessDeniedException) when calling the ListClusters operation: User is not authorized": "eks:ListClusters",
		"Unable to locate credentials. You can configure credentials by running \"aws configure\".":                 "no AWS credentials",
		"aws CLI not found on PATH": "aws CLI not found",
		"An error occurred (ExpiredTokenException) when calling the ListClusters operation: The security token has expired": "expired",
	} {
		if got := explain(errors.New(raw), "work"); !strings.Contains(got, want) {
			t.Errorf("explain(%q) = %q, want it to mention %q", raw, got, want)
		}
	}
}

func TestScanRejectsValuesThatCouldBeReadAsFlags(t *testing.T) {
	f := &fakeAWS{}
	for _, bad := range []struct{ profile, region string }{{"--debug", "eu-west-1"}, {"", "--endpoint-url=http://evil"}, {"", "eu west 1"}} {
		res := ScanEKS(context.Background(), f.run, bad.profile, []string{bad.region})
		if len(res.Errors) != 1 || len(res.Clusters) != 0 {
			t.Errorf("%+v: want one validation error, got %+v", bad, res)
		}
	}
	if len(f.calls) != 0 {
		t.Errorf("the CLI ran with bad input: %v", f.calls)
	}
}

func TestKubeconfigUsesTheAWSCLIConventionAndNoStaticToken(t *testing.T) {
	c := EKSCluster{Region: "eu-west-1", Name: "prod", Arn: "arn:aws:eks:eu-west-1:111122223333:cluster/prod",
		Endpoint: "https://prod.gr7.eu-west-1.eks.amazonaws.com", CAData: "Q0EtREFUQQ=="}
	b, err := Kubeconfig(c, "work")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := clientcmd.Load(b)
	if err != nil {
		t.Fatalf("not a kubeconfig: %v\n%s", err, b)
	}
	ctx := cfg.Contexts[c.Arn]
	if ctx == nil || cfg.CurrentContext != c.Arn {
		t.Fatalf("context named by ARN, like aws eks update-kubeconfig: %+v", cfg.Contexts)
	}
	cl := cfg.Clusters[ctx.Cluster]
	if cl.Server != c.Endpoint || string(cl.CertificateAuthorityData) != "CA-DATA" {
		t.Errorf("cluster: %+v", cl)
	}
	u := cfg.AuthInfos[ctx.AuthInfo]
	if u.Token != "" || u.Exec == nil {
		t.Fatalf("user must use exec, never a static token: %+v", u)
	}
	if u.Exec.Command != "aws" || u.Exec.APIVersion != "client.authentication.k8s.io/v1beta1" ||
		strings.Join(u.Exec.Args, " ") != "--region eu-west-1 eks get-token --cluster-name prod --output json" {
		t.Errorf("exec: %+v", u.Exec)
	}
	if len(u.Exec.Env) != 1 || u.Exec.Env[0].Name != "AWS_PROFILE" || u.Exec.Env[0].Value != "work" {
		t.Errorf("exec env: %+v", u.Exec.Env)
	}
	if b2, _ := Kubeconfig(c, ""); strings.Contains(string(b2), "AWS_PROFILE") {
		t.Error("no profile, no AWS_PROFILE env")
	}
}

func TestFileNameIsSafe(t *testing.T) {
	if got := FileName(EKSCluster{Region: "eu-west-1", Name: "prod_1"}, "work"); got != "eks-work-eu-west-1-prod_1.yaml" {
		t.Errorf("got %q", got)
	}
	if got := FileName(EKSCluster{Region: "eu-west-1", Name: "prod"}, ""); got != "eks-default-eu-west-1-prod.yaml" {
		t.Errorf("got %q", got)
	}
}

func TestProfilesListsEachWithItsDefaultRegion(t *testing.T) {
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		switch strings.Join(args, " ") {
		case "configure list-profiles":
			return []byte("default\nwork\n--weird\nprod-readonly\n"), nil
		case "configure get region --profile default":
			return []byte("us-east-1\n"), nil
		case "configure get region --profile work":
			return []byte("eu-west-1\n"), nil
		case "configure get region --profile prod-readonly":
			return nil, errors.New("exit status 1") // no region set
		}
		return nil, fmt.Errorf("unexpected %v", args)
	}
	got, err := Profiles(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	want := []Profile{{Name: "default", Region: "us-east-1"}, {Name: "prod-readonly"}, {Name: "work", Region: "eu-west-1"}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
