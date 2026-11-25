package fleet

import (
	"context"
	"errors"
	"net/url"
	"testing"
)

type timeoutErr struct{}

func (timeoutErr) Error() string {
	return "net/http: request canceled (Client.Timeout exceeded while awaiting headers)"
}
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

// The client's own timeout and the search's context share one duration, so
// either can fire first. Both are a timeout, and both must read "search timed
// out": CI failed TestColdSearchHungClusterTimesOut when the client won the race.
func TestAClientSideTimeoutIsASearchTimeout(t *testing.T) {
	live := context.Background()
	clientTimeout := &url.Error{Op: "Get", URL: "http://x/api/v1/pods", Err: timeoutErr{}}
	if !searchTimedOut(live, clientTimeout) {
		t.Fatal("a client timeout with a live context was not treated as a timeout")
	}
	if !searchTimedOut(live, context.DeadlineExceeded) {
		t.Fatal("DeadlineExceeded was not treated as a timeout")
	}
	done, cancel := context.WithCancel(context.Background())
	cancel()
	if !searchTimedOut(done, errors.New("anything")) {
		t.Fatal("a finished context was not treated as a timeout")
	}
	if searchTimedOut(live, errors.New("connection refused")) {
		t.Fatal("an ordinary failure was treated as a timeout")
	}
}
