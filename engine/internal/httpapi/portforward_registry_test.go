package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"k8s.io/client-go/tools/portforward"
)

// fakeTunnel stands in for a client-go forwarder so the registry, lifecycle
// and conflict rules are tested without a cluster.
type fakeTunnel struct {
	local   uint16
	stop    <-chan struct{}
	ready   chan struct{}
	die     chan error // send to simulate the tunnel dying
	failNow error      // ForwardPorts returns this before ready
}

func (f *fakeTunnel) ForwardPorts() error {
	if f.failNow != nil {
		return f.failNow
	}
	close(f.ready)
	select {
	case <-f.stop:
		return nil
	case err := <-f.die:
		return err
	}
}

func (f *fakeTunnel) GetPorts() ([]portforward.ForwardedPort, error) {
	return []portforward.ForwardedPort{{Local: f.local, Remote: 80}}, nil
}

type fakeDialer struct {
	calls   atomic.Int32
	next    atomic.Int32
	mu      sync.Mutex
	tunnels []*fakeTunnel
	failNow error
}

func (d *fakeDialer) dial(_ context.Context, _, _, _ string, _, local int32, stop <-chan struct{}, ready chan struct{}, _ io.Writer) (tunnel, error) {
	d.calls.Add(1)
	l := uint16(local)
	if l == 0 {
		l = uint16(40000 + d.next.Add(1))
	}
	t := &fakeTunnel{local: l, stop: stop, ready: ready, die: make(chan error, 1), failNow: d.failNow}
	d.mu.Lock()
	d.tunnels = append(d.tunnels, t)
	d.mu.Unlock()
	return t, nil
}

func newTestPF(d *fakeDialer) *PFManager {
	p := NewPFManager(nil)
	p.dial = d.dial
	return p
}

func freePort(t *testing.T) int32 {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return int32(l.Addr().(*net.TCPAddr).Port)
}

func TestSameLocalPortAcrossClustersIsRejectedNamingTheHolder(t *testing.T) {
	d := &fakeDialer{}
	p := newTestPF(d)
	port := freePort(t)
	if _, err := p.Start(context.Background(), "prod-a", "ns1", "api-0", 80, port); err != nil {
		t.Fatal(err)
	}
	_, err := p.Start(context.Background(), "prod-b", "ns2", "web-0", 80, port)
	if !errors.Is(err, ErrPortInUse) {
		t.Fatalf("want ErrPortInUse, got %v", err)
	}
	for _, want := range []string{"prod-a", "ns1/api-0", fmt.Sprint(port)} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should name %q", err, want)
		}
	}
	if d.calls.Load() != 1 {
		t.Errorf("second forward must not open a tunnel, dials=%d", d.calls.Load())
	}
}

func TestOtherUsersHolderIsNotNamed(t *testing.T) {
	p := newTestPF(&fakeDialer{})
	port := freePort(t)
	if _, err := p.Start(as("alice"), "c", "secret-ns", "secret-pod", 80, port); err != nil {
		t.Fatal(err)
	}
	_, err := p.Start(as("bob"), "c", "n", "p", 80, port)
	if !errors.Is(err, ErrPortInUse) || strings.Contains(err.Error(), "secret-pod") {
		t.Fatalf("must conflict without leaking alice's pod: %v", err)
	}
}

func TestConcurrentStartsOnOnePortYieldExactlyOneWinner(t *testing.T) {
	d := &fakeDialer{}
	p := newTestPF(d)
	port := freePort(t)
	var wg sync.WaitGroup
	var ok atomic.Int32
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := p.Start(context.Background(), fmt.Sprintf("c%d", i%3), "n", fmt.Sprintf("p%d", i), 80, port); err == nil {
				ok.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if ok.Load() != 1 {
		t.Fatalf("want exactly 1 winner, got %d", ok.Load())
	}
}

func TestPortBoundByAnotherProcessFailsFastWithAClearError(t *testing.T) {
	d := &fakeDialer{}
	p := newTestPF(d)
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := int32(l.Addr().(*net.TCPAddr).Port)
	start := time.Now()
	_, err = p.Start(context.Background(), "c", "n", "p", 80, port)
	if !errors.Is(err, ErrPortInUse) || !strings.Contains(err.Error(), "another process") {
		t.Fatalf("want ErrPortInUse mentioning another process, got %v", err)
	}
	if time.Since(start) > 2*time.Second || d.calls.Load() != 0 {
		t.Errorf("must fail fast without dialing (dials=%d)", d.calls.Load())
	}
	if len(p.List(context.Background())) != 0 {
		t.Error("a rejected forward must leave no entry")
	}
}

func TestLocalPortIsReusableAfterStop(t *testing.T) {
	p := newTestPF(&fakeDialer{})
	port := freePort(t)
	fw, err := p.Start(context.Background(), "c", "n", "p", 80, port)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Stop(context.Background(), fw.ID) {
		t.Fatal("stop")
	}
	if _, err := p.Start(context.Background(), "c2", "n", "p", 80, port); err != nil {
		t.Fatalf("reuse after stop: %v", err)
	}
}

func TestAutoPortsNeverCollide(t *testing.T) {
	p := newTestPF(&fakeDialer{})
	seen := map[uint16]bool{}
	for i := 0; i < 5; i++ {
		fw, err := p.Start(context.Background(), "c", "n", "p", 80, 0)
		if err != nil {
			t.Fatal(err)
		}
		if seen[fw.LocalPort] {
			t.Fatalf("port %d handed out twice", fw.LocalPort)
		}
		seen[fw.LocalPort] = true
	}
}

func TestInvalidPortsAreRejected(t *testing.T) {
	p := newTestPF(&fakeDialer{})
	for _, lp := range []int32{-1, 65536, 99999} {
		if _, err := p.Start(context.Background(), "c", "n", "p", 80, lp); !errors.Is(err, ErrInvalidPort) {
			t.Errorf("local %d: want ErrInvalidPort, got %v", lp, err)
		}
	}
	if _, err := p.Start(context.Background(), "c", "n", "p", 70000, 0); !errors.Is(err, ErrInvalidPort) {
		t.Errorf("pod port 70000: want ErrInvalidPort, got %v", err)
	}
}

func pfWaitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestForwardThatDiesShowsFailedAndFreesItsPort(t *testing.T) {
	d := &fakeDialer{}
	p := newTestPF(d)
	port := freePort(t)
	fw, err := p.Start(context.Background(), "c", "n", "p", 80, port)
	if err != nil {
		t.Fatal(err)
	}
	if got := p.List(context.Background())[0].Status; got != "running" {
		t.Fatalf("status = %q, want running", got)
	}
	d.tunnels[0].die <- errors.New("lost connection to pod")
	pfWaitFor(t, "failed status", func() bool { return p.List(context.Background())[0].Status == "failed" })
	got := p.List(context.Background())[0]
	if !strings.Contains(got.Error, "lost connection") {
		t.Errorf("error = %q", got.Error)
	}
	if p.Count() != 0 {
		t.Errorf("a dead forward is not active, count=%d", p.Count())
	}
	if _, err := p.Start(context.Background(), "c", "n", "p", 80, port); err != nil {
		t.Fatalf("port of a dead forward must be reusable: %v", err)
	}
	if !p.Stop(context.Background(), fw.ID) {
		t.Error("a failed forward can be dismissed with Stop")
	}
}

func TestTunnelFailingAtStartupReturnsItsErrorImmediately(t *testing.T) {
	d := &fakeDialer{failNow: errors.New(`pods "gone" not found`)}
	p := newTestPF(d)
	start := time.Now()
	_, err := p.Start(context.Background(), "c", "n", "gone", 80, 0)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("want the tunnel's error, got %v", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Error("must not wait for the 15s ready timeout")
	}
	if len(p.List(context.Background())) != 0 {
		t.Error("failed start must leave no entry")
	}
}

func TestPFErrorStatusMapsConflictsAndBadPorts(t *testing.T) {
	if got := pfErrorStatus(fmt.Errorf("x: %w", ErrPortInUse)); got != 409 {
		t.Errorf("conflict = %d, want 409", got)
	}
	if got := pfErrorStatus(fmt.Errorf("x: %w", ErrInvalidPort)); got != 400 {
		t.Errorf("invalid = %d, want 400", got)
	}
	if got := pfErrorStatus(errors.New("boom")); got != 502 {
		t.Errorf("other = %d, want 502", got)
	}
}

func TestStopAllAndStopClusterCloseTunnels(t *testing.T) {
	d := &fakeDialer{}
	p := newTestPF(d)
	for _, c := range []string{"a", "a", "b"} {
		if _, err := p.Start(context.Background(), c, "n", "p", 80, 0); err != nil {
			t.Fatal(err)
		}
	}
	p.StopCluster("a")
	if p.Count() != 1 {
		t.Fatalf("after StopCluster(a) count=%d, want 1", p.Count())
	}
	p.StopAll()
	if p.Count() != 0 || len(p.List(context.Background())) != 0 {
		t.Fatal("StopAll must clear everything")
	}
	for i, tn := range d.tunnels {
		select {
		case <-tn.stop:
		default:
			t.Errorf("tunnel %d was not closed", i)
		}
	}
}
