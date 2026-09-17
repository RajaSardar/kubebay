//go:build localshell

package localshell

import (
	"errors"
	"testing"
)

func TestAllowed(t *testing.T) {
	cases := []struct {
		name                            string
		enabled, inCluster, oidcEnabled bool
		addr                            string
		want                            bool // true = allowed
	}{
		{name: "off by default", addr: "127.0.0.1:9898"},
		{name: "loopback v4", enabled: true, addr: "127.0.0.1:9898", want: true},
		{name: "loopback v6", enabled: true, addr: "[::1]:9898", want: true},
		{name: "localhost", enabled: true, addr: "localhost:9898", want: true},
		{name: "all interfaces", enabled: true, addr: "0.0.0.0:9898"},
		{name: "bare port binds everything", enabled: true, addr: ":9898"},
		{name: "routable address", enabled: true, addr: "10.0.0.5:9898"},
		{name: "unparseable address", enabled: true, addr: "nonsense"},
		{name: "in-cluster", enabled: true, inCluster: true, addr: "127.0.0.1:9898"},
		{name: "oidc configured", enabled: true, oidcEnabled: true, addr: "127.0.0.1:9898"},
		{name: "in-cluster helm default", enabled: true, inCluster: true, addr: "0.0.0.0:8080"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := Allowed(tc.enabled, tc.inCluster, tc.oidcEnabled, tc.addr)
			if tc.want && err != nil {
				t.Fatalf("Allowed(%v, %v, %v, %q) = %v, want nil", tc.enabled, tc.inCluster, tc.oidcEnabled, tc.addr, err)
			}
			if !tc.want {
				if err == nil {
					t.Fatalf("Allowed(%v, %v, %v, %q) = nil, want refusal", tc.enabled, tc.inCluster, tc.oidcEnabled, tc.addr)
				}
				if !errors.Is(err, ErrDisabled) {
					t.Fatalf("refusal %v does not wrap ErrDisabled", err)
				}
			}
		})
	}
}
