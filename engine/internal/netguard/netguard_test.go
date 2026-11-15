package netguard

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var (
	desktop   = Policy{}
	inCluster = Policy{BlockLoopback: true}
)

func TestValidateURLRefusesWhatTheEngineMustNeverFetch(t *testing.T) {
	for _, tc := range []struct{ name, url string }{
		{"AWS and GCP metadata", "http://169.254.169.254/latest/meta-data/"},
		{"link-local range", "http://169.254.10.20:8080/"},
		{"AWS IPv6 metadata", "http://[fd00:ec2::254]/latest/meta-data/"},
		{"Alibaba metadata (carrier-grade NAT range)", "http://100.100.100.200/latest/meta-data/"},
		{"IPv4-mapped link-local", "http://[::ffff:169.254.169.254]/"},
		{"IPv6 link-local", "http://[fe80::1]/"},
		{"unspecified", "http://0.0.0.0:9090/"},
		{"multicast", "http://224.0.0.1/"},
		{"file scheme", "file:///etc/passwd"},
		{"ftp scheme", "ftp://example.com/index.yaml"},
		{"credentials in the URL", "https://user:pass@charts.example.com/"},
		{"no host", "http:///index.yaml"},
		{"not a URL", "::::"},
	} {
		for _, p := range []Policy{desktop, inCluster} {
			if err := p.ValidateURL(tc.url); err == nil {
				t.Errorf("%s: %q was accepted (BlockLoopback=%v)", tc.name, tc.url, p.BlockLoopback)
			}
		}
	}
}

func TestLoopbackIsForTheDesktopOnly(t *testing.T) {
	for _, u := range []string{"http://127.0.0.1:9090", "http://localhost:9090", "http://[::1]:9090/"} {
		if err := desktop.ValidateURL(u); err != nil {
			t.Errorf("desktop refused %q, but a port-forwarded Prometheus lives there: %v", u, err)
		}
		if err := inCluster.ValidateURL(u); err == nil {
			t.Errorf("in-cluster accepted %q, which is the engine's own pod", u)
		}
	}
}

func TestOrdinaryAddressesPass(t *testing.T) {
	for _, u := range []string{
		"https://93.184.216.34/charts",            // public
		"http://10.0.12.7:9090",                   // private, e.g. an in-cluster Prometheus
		"http://192.168.1.20:9090/prometheus",     // private
		"https://[2606:2800:220:1::1]/index.yaml", // public IPv6
	} {
		for _, p := range []Policy{desktop, inCluster} {
			if err := p.ValidateURL(u); err != nil {
				t.Errorf("%q refused (BlockLoopback=%v): %v", u, p.BlockLoopback, err)
			}
		}
	}
}

func TestAHostnameIsRefusedWhenItResolvesToABlockedAddress(t *testing.T) {
	// "localhost" resolves to loopback, so it follows the loopback rule.
	if err := inCluster.ValidateURL("http://localhost:8080/"); err == nil {
		t.Error("localhost accepted in-cluster")
	}
}

func TestClientRefusesToConnectToABlockedAddressEvenIfTheURLLooksFine(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "secret") }))
	defer srv.Close()

	// In-cluster the loopback server is off limits at dial time, whatever got the URL here
	// (a redirect, or a name whose DNS answer changed after it was checked).
	if _, err := inCluster.Client(2 * time.Second).Get(srv.URL); err == nil {
		t.Fatal("the in-cluster client connected to a loopback server")
	} else if !strings.Contains(err.Error(), "not allowed") {
		t.Errorf("error should say why, got: %v", err)
	}

	resp, err := desktop.Client(2 * time.Second).Get(srv.URL)
	if err != nil {
		t.Fatalf("the desktop client could not reach a loopback server: %v", err)
	}
	defer resp.Body.Close()
	if b, _ := io.ReadAll(resp.Body); string(b) != "secret" {
		t.Errorf("body = %q", b)
	}
}

func TestClientStopsEndlessRedirects(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, srv.URL, http.StatusFound) }))
	defer srv.Close()
	if _, err := desktop.Client(2 * time.Second).Get(srv.URL); err == nil {
		t.Error("an endless redirect loop was followed to the end")
	}
}
