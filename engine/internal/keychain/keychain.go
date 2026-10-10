// Package keychain keeps a secret in the OS credential store through the
// system's own CLI: `security` on macOS, `secret-tool` (libsecret) on Linux.
// The secret never appears in a process's argv: macOS reads the command from
// stdin (`security -i`), secret-tool reads the secret from stdin.
package keychain

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

var (
	ErrNotFound    = errors.New("not in the keychain")
	ErrUnsupported = errors.New("no supported keychain on this system")
)

// Store reads and writes one secret per service and account.
type Store interface {
	Get(service, account string) (string, error)
	Set(service, account, secret string) error
	Delete(service, account string) error
	// Name is what the user calls it ("macOS Keychain"), or "" when unsupported.
	Name() string
}

// System is the current OS's credential store.
func System() Store {
	return cliStore{goos: runtime.GOOS, run: runCmd, lookPath: func(n string) error { _, err := exec.LookPath(n); return err }}
}

type runner func(name string, args []string, stdin string) (stdout string, exitCode int, err error)

func runCmd(name string, args []string, stdin string) (string, int, error) {
	cmd := exec.Command(name, args...)
	cmd.Stdin = strings.NewReader(stdin)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return out.String(), exit.ExitCode(), nil
	}
	if err != nil {
		return "", -1, err
	}
	return out.String(), 0, nil
}

type cliStore struct {
	goos string
	run  runner
	// lookPath reports whether a CLI is installed; nil assumes it is.
	lookPath func(name string) error
}

// safe is what both CLIs take without quoting surprises; API keys fit it.
var safe = regexp.MustCompile(`^[A-Za-z0-9._~+/=:-]+$`)

func (s cliStore) Name() string {
	switch s.goos {
	case "darwin":
		return "macOS Keychain"
	case "linux":
		if s.lookPath != nil && s.lookPath("secret-tool") != nil {
			return ""
		}
		return "Secret Service (libsecret)"
	}
	return ""
}

func (s cliStore) Get(service, account string) (string, error) {
	if s.Name() == "" {
		return "", ErrUnsupported
	}
	var name string
	var args []string
	switch s.goos {
	case "darwin":
		name, args = "/usr/bin/security", []string{"find-generic-password", "-s", service, "-a", account, "-w"}
	case "linux":
		name, args = "secret-tool", []string{"lookup", "service", service, "account", account}
	default:
		return "", ErrUnsupported
	}
	out, code, err := s.run(name, args, "")
	if err != nil {
		return "", fmt.Errorf("%s: %w", name, err)
	}
	// security exits 44 for a missing item; secret-tool exits 1 with no output.
	if code != 0 || strings.TrimSpace(out) == "" {
		return "", ErrNotFound
	}
	return strings.TrimRight(out, "\r\n"), nil
}

func (s cliStore) Set(service, account, secret string) error {
	if s.Name() == "" {
		return ErrUnsupported
	}
	for _, v := range []string{service, account, secret} {
		if !safe.MatchString(v) {
			return errors.New("the key has characters a key doesn't have (spaces, quotes or line breaks)")
		}
	}
	var name, stdin string
	var args []string
	switch s.goos {
	case "darwin":
		// -U updates an existing item instead of failing.
		name, args = "/usr/bin/security", []string{"-i"}
		stdin = fmt.Sprintf("add-generic-password -U -s '%s' -a '%s' -w '%s'\n", service, account, secret)
	case "linux":
		name, args = "secret-tool", []string{"store", "--label=Kubebay " + service, "service", service, "account", account}
		stdin = secret
	}
	_, code, err := s.run(name, args, stdin)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	if code != 0 {
		return fmt.Errorf("%s couldn't save the key (exit %d)", s.Name(), code)
	}
	return nil
}

func (s cliStore) Delete(service, account string) error {
	if s.Name() == "" {
		return ErrUnsupported
	}
	var name string
	var args []string
	switch s.goos {
	case "darwin":
		name, args = "/usr/bin/security", []string{"delete-generic-password", "-s", service, "-a", account}
	case "linux":
		name, args = "secret-tool", []string{"clear", "service", service, "account", account}
	default:
		return ErrUnsupported
	}
	if _, _, err := s.run(name, args, ""); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}
