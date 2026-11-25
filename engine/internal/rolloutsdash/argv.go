package rolloutsdash

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ArgvOptions are the values that reach the plugin's command line.
type ArgvOptions struct {
	Kubeconfig string
	Context    string
	Namespaces []string
	Port       int
	RootPath   string
}

var dnsLabel = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

// BuildArgv returns the plugin's arguments (an argv slice, never a shell
// string). --namespace is added only when exactly one namespace is selected;
// otherwise the tool's own all-namespaces behaviour applies. Every value is
// validated and none may look like a flag.
func BuildArgv(o ArgvOptions) ([]string, error) {
	if o.Kubeconfig == "" || strings.HasPrefix(o.Kubeconfig, "-") {
		return nil, errors.New("bad kubeconfig path")
	}
	if o.Context == "" || strings.HasPrefix(o.Context, "-") || strings.ContainsAny(o.Context, "\x00\n\r") {
		return nil, errors.New("bad context name")
	}
	if o.Port < 1 || o.Port > 65535 {
		return nil, errors.New("bad port")
	}
	if !strings.HasPrefix(o.RootPath, "/") {
		return nil, errors.New("bad root path")
	}
	args := []string{"dashboard", "--kubeconfig", o.Kubeconfig, "--context", o.Context}
	if len(o.Namespaces) == 1 {
		ns := o.Namespaces[0]
		if len(ns) > 63 || !dnsLabel.MatchString(ns) {
			return nil, fmt.Errorf("bad namespace %q", ns)
		}
		args = append(args, "--namespace", ns)
	}
	args = append(args, "--port", strconv.Itoa(o.Port), "--root-path", strings.TrimRight(o.RootPath, "/"))
	return args, nil
}
