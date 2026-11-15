// Package netguard keeps the engine from being aimed at addresses it must never
// fetch on a user's behalf: cloud metadata services, link-local and unspecified
// addresses and, when the engine is a shared in-cluster service, its own loopback.
//
// A user-supplied URL (a Prometheus endpoint, a Helm repository) turns the engine
// into a proxy that can reach what the user cannot. Where that matters most is a
// cloud node's metadata service, which hands out the node's credentials. So the
// check runs twice: ValidateURL when the URL is saved, and again at connection time
// through Client, which also covers a DNS name whose answer changed after the first
// check and a redirect to a blocked address.
//
// Private ranges (10/8, 172.16/12, 192.168/16) stay allowed: a Prometheus reached
// by its cluster IP or a Helm repo on a company network is the normal case. Where
// that is too open, a NetworkPolicy on the engine's pod is the control for it.
package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"syscall"
	"time"
)

// Policy says which of the otherwise-blocked destinations are allowed.
type Policy struct {
	// BlockLoopback refuses 127.0.0.0/8 and ::1. Off on a desktop, where a
	// port-forwarded Prometheus at localhost is the usual setup; on for an
	// in-cluster engine, where loopback is the engine's own pod. The zero Policy is
	// the desktop's, so a caller that forgets to set it never breaks localhost.
	BlockLoopback bool
}

var (
	// 100.64.0.0/10 is carrier-grade NAT; Alibaba Cloud serves its metadata at 100.100.100.200.
	cgnat = netip.MustParsePrefix("100.64.0.0/10")
	// AWS's IPv6 metadata endpoint, in a unique-local range.
	awsIPv6Metadata = netip.MustParseAddr("fd00:ec2::254")
)

// blocked returns why an address may not be connected to, or nil.
func (p Policy) blocked(addr netip.Addr) error {
	addr = addr.Unmap()
	switch {
	case addr.IsUnspecified():
		return errors.New("an unspecified address")
	case addr.IsMulticast():
		return errors.New("a multicast address")
	case addr.IsLinkLocalUnicast():
		return errors.New("a link-local address (cloud metadata services live there)")
	case cgnat.Contains(addr):
		return errors.New("a carrier-grade NAT address (some clouds serve metadata there)")
	case addr == awsIPv6Metadata:
		return errors.New("a cloud metadata address")
	case addr.IsLoopback() && p.BlockLoopback:
		return errors.New("a loopback address, which is this engine's own pod")
	}
	return nil
}

// ValidateURL checks a URL a user supplied before it is saved or fetched. It
// accepts http and https only, no credentials in the URL, and a host that is not,
// and does not resolve to, a blocked address.
func (p Policy) ValidateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("not a valid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("the URL must start with http:// or https://, not %q", u.Scheme)
	}
	if u.User != nil {
		return errors.New("the URL must not carry a user name or password")
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("the URL has no host")
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		if why := p.blocked(addr); why != nil {
			return fmt.Errorf("%s is %w", host, why)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		// Not resolvable now. That is not a blocked address; connecting will fail on
		// its own, and Client checks the address again when it does connect.
		return nil
	}
	for _, ip := range ips {
		if why := p.blocked(ip); why != nil {
			return fmt.Errorf("%s resolves to %s, which is %w", host, ip, why)
		}
	}
	return nil
}

// Transport is an HTTP transport that refuses, at connection time, to connect to a
// blocked address. The check is on the address actually dialed, so it holds for
// every redirect and for a name that resolves differently than it did at save time.
func (p Policy) Transport() *http.Transport {
	d := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			addr, err := netip.ParseAddr(host)
			if err != nil {
				return err
			}
			if why := p.blocked(addr); why != nil {
				return fmt.Errorf("connecting to %s is not allowed: it is %w", host, why)
			}
			return nil
		},
	}
	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           d.DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
	}
}

// Client is an HTTP client on Transport that follows at most five redirects.
func (p Policy) Client(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: p.Transport(),
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			return nil
		},
	}
}
