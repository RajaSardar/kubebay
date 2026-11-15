// Package clouddiscovery finds managed clusters the user can reach but has
// no kubeconfig context for yet (backlog #14). It runs the user's own
// provider CLI with their own credentials, only when asked, and never calls
// a mutating cloud API: the engine never holds a cloud credential.
package clouddiscovery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Runner runs a CLI and returns its stdout. Production uses os/exec with the
// user's own aws; tests pass a fake.
type Runner func(ctx context.Context, name string, args ...string) ([]byte, error)

var (
	regionRe      = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-\d$`)
	profileRe     = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$`)
	clusterNameRe = regexp.MustCompile(`^[0-9A-Za-z][A-Za-z0-9_-]{0,99}$`)
	accountRe     = regexp.MustCompile(`^arn:aws[a-z-]*:eks:[a-z0-9-]+:(\d{12}):cluster/`)
)

// ValidProfile reports whether p is a usable AWS profile name ("" is the default chain).
func ValidProfile(p string) bool { return p == "" || profileRe.MatchString(p) }

// ValidRegion reports whether r looks like an AWS region.
func ValidRegion(r string) bool { return regionRe.MatchString(r) }

// ValidClusterName reports whether n is an EKS cluster name.
func ValidClusterName(n string) bool { return clusterNameRe.MatchString(n) }

// EKSCluster is one cluster DescribeCluster returned.
type EKSCluster struct {
	Region   string `json:"region"`
	Name     string `json:"name"`
	Arn      string `json:"arn"`
	Account  string `json:"account,omitempty"`
	Endpoint string `json:"endpoint"`
	Status   string `json:"status,omitempty"`
	Version  string `json:"version,omitempty"`
	// CAData is the base64 cluster CA, as DescribeCluster returns it. Not sent
	// to the browser; import describes the cluster again itself.
	CAData string `json:"-"`
}

// RegionError is one region (or cluster) that couldn't be read. A scan
// carries on past it.
type RegionError struct {
	Region  string `json:"region"`
	Cluster string `json:"cluster,omitempty"`
	Message string `json:"message"`
}

type ScanResult struct {
	Clusters []EKSCluster  `json:"clusters"`
	Errors   []RegionError `json:"errors"`
}

// maxParallel bounds concurrent CLI calls: EKS's List/Describe throttle is
// modest, and each call is a process.
const maxParallel = 4

func awsArgs(profile, region string, args ...string) []string {
	out := append([]string{}, args...)
	out = append(out, "--region", region, "--output", "json")
	if profile != "" {
		out = append(out, "--profile", profile)
	}
	return out
}

// ScanEKS lists and describes the EKS clusters in each region. A region that
// fails (no permission, not enabled for the account) is reported and skipped.
func ScanEKS(ctx context.Context, run Runner, profile string, regions []string) ScanResult {
	res := ScanResult{Clusters: []EKSCluster{}, Errors: []RegionError{}}
	if !ValidProfile(profile) {
		res.Errors = append(res.Errors, RegionError{Message: fmt.Sprintf("%q is not an AWS profile name", profile)})
		return res
	}
	var mu sync.Mutex
	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup
	fail := func(e RegionError) {
		mu.Lock()
		res.Errors = append(res.Errors, e)
		mu.Unlock()
	}
	seen := map[string]bool{}
	for _, region := range regions {
		region = strings.TrimSpace(region)
		if region == "" || seen[region] {
			continue
		}
		seen[region] = true
		if !ValidRegion(region) {
			fail(RegionError{Region: region, Message: fmt.Sprintf("%q is not an AWS region", region)})
			continue
		}
		wg.Add(1)
		go func(region string) {
			defer wg.Done()
			sem <- struct{}{}
			out, err := run(ctx, "aws", awsArgs(profile, region, "eks", "list-clusters")...)
			<-sem
			if err != nil {
				fail(RegionError{Region: region, Message: explain(err, profile)})
				return
			}
			var list struct {
				Clusters []string `json:"clusters"`
			}
			if err := json.Unmarshal(out, &list); err != nil {
				fail(RegionError{Region: region, Message: "unexpected aws output: " + err.Error()})
				return
			}
			for _, name := range list.Clusters {
				if !ValidClusterName(name) {
					continue
				}
				wg.Add(1)
				go func(name string) {
					defer wg.Done()
					sem <- struct{}{}
					c, err := DescribeEKS(ctx, run, profile, region, name)
					<-sem
					if err != nil {
						fail(RegionError{Region: region, Cluster: name, Message: err.Error()})
						return
					}
					mu.Lock()
					res.Clusters = append(res.Clusters, c)
					mu.Unlock()
				}(name)
			}
		}(region)
	}
	wg.Wait()
	sort.Slice(res.Clusters, func(i, j int) bool {
		a, b := res.Clusters[i], res.Clusters[j]
		if a.Region != b.Region {
			return a.Region < b.Region
		}
		return a.Name < b.Name
	})
	sort.Slice(res.Errors, func(i, j int) bool {
		return res.Errors[i].Region+"/"+res.Errors[i].Cluster < res.Errors[j].Region+"/"+res.Errors[j].Cluster
	})
	return res
}

// DescribeEKS reads one cluster's endpoint and CA.
func DescribeEKS(ctx context.Context, run Runner, profile, region, name string) (EKSCluster, error) {
	if !ValidProfile(profile) || !ValidRegion(region) || !ValidClusterName(name) {
		return EKSCluster{}, fmt.Errorf("invalid profile, region or cluster name")
	}
	out, err := run(ctx, "aws", awsArgs(profile, region, "eks", "describe-cluster", "--name", name)...)
	if err != nil {
		return EKSCluster{}, fmt.Errorf("%s", explain(err, profile))
	}
	var d struct {
		Cluster struct {
			Name                 string `json:"name"`
			Arn                  string `json:"arn"`
			Endpoint             string `json:"endpoint"`
			Status               string `json:"status"`
			Version              string `json:"version"`
			CertificateAuthority struct {
				Data string `json:"data"`
			} `json:"certificateAuthority"`
		} `json:"cluster"`
	}
	if err := json.Unmarshal(out, &d); err != nil {
		return EKSCluster{}, fmt.Errorf("unexpected aws output: %w", err)
	}
	c := EKSCluster{
		Region:   region,
		Name:     d.Cluster.Name,
		Arn:      d.Cluster.Arn,
		Endpoint: d.Cluster.Endpoint,
		Status:   d.Cluster.Status,
		Version:  d.Cluster.Version,
		CAData:   d.Cluster.CertificateAuthority.Data,
	}
	if m := accountRe.FindStringSubmatch(c.Arn); m != nil {
		c.Account = m[1]
	}
	return c, nil
}

// explain turns the CLI's error into what to do about it.
func explain(err error, profile string) string {
	msg := err.Error()
	login := "aws sso login"
	if profile != "" {
		login += " --profile " + profile
	}
	switch {
	case strings.Contains(msg, "not found on PATH"):
		return "aws CLI not found on PATH: install the AWS CLI to discover EKS clusters"
	case strings.Contains(msg, "sso") && (strings.Contains(msg, "expired") || strings.Contains(msg, "invalid")):
		return fmt.Sprintf("the AWS SSO session has expired: run `%s`, then scan again", login)
	case strings.Contains(msg, "ExpiredToken"):
		return "the AWS credentials have expired: refresh them, then scan again"
	case strings.Contains(msg, "Unable to locate credentials"):
		return "no AWS credentials found for this profile: run `aws configure` or `aws sso login`"
	case strings.Contains(msg, "UnrecognizedClientException") || strings.Contains(msg, "InvalidClientTokenId"):
		return "this region is not enabled for the account, or the credentials aren't valid in it"
	case strings.Contains(msg, "AccessDenied"):
		return "these credentials aren't allowed to call eks:ListClusters/eks:DescribeCluster here"
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}

// Kubeconfig writes a one-cluster kubeconfig the way `aws eks
// update-kubeconfig` does: context, cluster and user all named by the ARN,
// and an exec stanza calling `aws eks get-token`, never a static token.
func Kubeconfig(c EKSCluster, profile string) ([]byte, error) {
	ca, err := base64.StdEncoding.DecodeString(c.CAData)
	if err != nil || len(ca) == 0 {
		return nil, fmt.Errorf("cluster %s has no usable certificate authority", c.Name)
	}
	exec := &clientcmdapi.ExecConfig{
		APIVersion:      "client.authentication.k8s.io/v1beta1",
		Command:         "aws",
		Args:            []string{"--region", c.Region, "eks", "get-token", "--cluster-name", c.Name, "--output", "json"},
		InteractiveMode: clientcmdapi.NeverExecInteractiveMode,
	}
	if profile != "" {
		exec.Env = []clientcmdapi.ExecEnvVar{{Name: "AWS_PROFILE", Value: profile}}
	}
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters[c.Arn] = &clientcmdapi.Cluster{Server: c.Endpoint, CertificateAuthorityData: ca}
	cfg.AuthInfos[c.Arn] = &clientcmdapi.AuthInfo{Exec: exec}
	cfg.Contexts[c.Arn] = &clientcmdapi.Context{Cluster: c.Arn, AuthInfo: c.Arn}
	cfg.CurrentContext = c.Arn
	return clientcmd.Write(*cfg)
}

// FileName is the Kubebay-owned file one imported cluster lives in.
func FileName(c EKSCluster, profile string) string {
	if profile == "" {
		profile = "default"
	}
	return fmt.Sprintf("eks-%s-%s-%s.yaml", profile, c.Region, c.Name)
}

// Profile is one named profile from the user's AWS config, with the region
// it defaults to (empty when it sets none).
type Profile struct {
	Name   string `json:"name"`
	Region string `json:"region,omitempty"`
}

// maxProfiles caps the per-profile region lookups, one process each.
const maxProfiles = 50

// Profiles lists the AWS CLI's configured profiles, sorted, so the scan can
// offer a picker instead of a free-text field (one per account).
func Profiles(ctx context.Context, run Runner) ([]Profile, error) {
	out, err := run(ctx, "aws", "configure", "list-profiles")
	if err != nil {
		return nil, fmt.Errorf("%s", explain(err, ""))
	}
	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		if n := strings.TrimSpace(line); n != "" && profileRe.MatchString(n) {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	if len(names) > maxProfiles {
		names = names[:maxProfiles]
	}
	profiles := make([]Profile, len(names))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxParallel)
	for i, n := range names {
		profiles[i].Name = n
		wg.Add(1)
		go func(i int, n string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			// Exits 1 when the profile sets no region; that's just "no default".
			if r, err := run(ctx, "aws", "configure", "get", "region", "--profile", n); err == nil && ValidRegion(strings.TrimSpace(string(r))) {
				profiles[i].Region = strings.TrimSpace(string(r))
			}
		}(i, n)
	}
	wg.Wait()
	return profiles, nil
}
