package keychain

import (
	"errors"
	"strings"
	"testing"
)

type invocation struct {
	name  string
	args  []string
	stdin string
}

type fakeRunner struct {
	calls []invocation
	out   string
	code  int
}

func (f *fakeRunner) run(name string, args []string, stdin string) (string, int, error) {
	f.calls = append(f.calls, invocation{name, args, stdin})
	return f.out, f.code, nil
}

const secret = "sk-ant-api03-abcDEF123_456-xyz"

func TestMacKeepsTheSecretOutOfTheProcessList(t *testing.T) {
	f := &fakeRunner{}
	s := cliStore{goos: "darwin", run: f.run}
	if err := s.Set("kubebay-triage", "api-key", secret); err != nil {
		t.Fatal(err)
	}
	c := f.calls[0]
	if c.name != "/usr/bin/security" || strings.Contains(strings.Join(c.args, " "), secret) {
		t.Errorf("argv must not carry the secret: %+v", c)
	}
	if !strings.Contains(c.stdin, "add-generic-password -U -s 'kubebay-triage' -a 'api-key' -w '"+secret+"'") {
		t.Errorf("stdin = %q", c.stdin)
	}
}

func TestMacReadsAndReportsMissing(t *testing.T) {
	f := &fakeRunner{out: secret + "\n"}
	s := cliStore{goos: "darwin", run: f.run}
	got, err := s.Get("kubebay-triage", "api-key")
	if err != nil || got != secret {
		t.Fatalf("get = %q, %v", got, err)
	}
	if strings.Join(f.calls[0].args, " ") != "find-generic-password -s kubebay-triage -a api-key -w" {
		t.Errorf("args = %v", f.calls[0].args)
	}
	f.code, f.out = 44, ""
	if _, err := s.Get("kubebay-triage", "api-key"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing item: %v", err)
	}
	f.code = 0
	if err := s.Delete("kubebay-triage", "api-key"); err != nil || strings.Join(f.calls[len(f.calls)-1].args, " ") != "delete-generic-password -s kubebay-triage -a api-key" {
		t.Errorf("delete: %v %v", err, f.calls[len(f.calls)-1].args)
	}
}

func TestLinuxUsesSecretToolWithTheSecretOnStdin(t *testing.T) {
	f := &fakeRunner{}
	s := cliStore{goos: "linux", run: f.run}
	if err := s.Set("kubebay-triage", "api-key", secret); err != nil {
		t.Fatal(err)
	}
	c := f.calls[0]
	if c.name != "secret-tool" || c.args[0] != "store" || c.stdin != secret || strings.Contains(strings.Join(c.args, " "), secret) {
		t.Errorf("store = %+v", c)
	}
	f.code = 1
	if _, err := s.Get("kubebay-triage", "api-key"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing item: %v", err)
	}
}

func TestSecretsThatCouldBreakQuotingAreRefused(t *testing.T) {
	f := &fakeRunner{}
	s := cliStore{goos: "darwin", run: f.run}
	for _, bad := range []string{"abc' ; delete-keychain", "with space", "new\nline", ""} {
		if err := s.Set("kubebay-triage", "api-key", bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if len(f.calls) != 0 {
		t.Error("nothing runs for a refused secret")
	}
}

func TestOtherSystemsAreUnsupported(t *testing.T) {
	s := cliStore{goos: "windows", run: (&fakeRunner{}).run}
	if err := s.Set("kubebay-triage", "api-key", secret); !errors.Is(err, ErrUnsupported) {
		t.Errorf("set: %v", err)
	}
	if _, err := s.Get("kubebay-triage", "api-key"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("get: %v", err)
	}
	if s.Name() != "" {
		t.Errorf("name = %q", s.Name())
	}
}

// A Linux desktop without libsecret's CLI has no keychain to offer; the
// user is pointed at the environment variable instead of a failed exec.
func TestLinuxWithoutSecretToolIsUnsupported(t *testing.T) {
	f := &fakeRunner{}
	s := cliStore{goos: "linux", run: f.run, lookPath: func(string) error { return errors.New("not found") }}
	if s.Name() != "" {
		t.Errorf("name = %q", s.Name())
	}
	if err := s.Set("kubebay-triage", "api-key", secret); !errors.Is(err, ErrUnsupported) {
		t.Errorf("set: %v", err)
	}
	if _, err := s.Get("kubebay-triage", "api-key"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("get: %v", err)
	}
	if len(f.calls) != 0 {
		t.Error("nothing runs")
	}
}
