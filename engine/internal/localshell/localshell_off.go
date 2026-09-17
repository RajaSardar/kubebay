//go:build !localshell

// Package localshell runs a PTY on the machine hosting the engine.
//
// Everything real about it is behind the "localshell" build tag, and this file
// is what the package compiles down to without it.  A shell reachable from the
// engine's HTTP listener turns a leaked launch token into code execution as the
// user, and the Helm chart runs the engine on 0.0.0.0:8080 with cluster-wide
// impersonate RBAC and OIDC off by default.  Refusing at startup would not be
// enough: the code path must not exist in a shipped binary.  No release
// workflow and no container build passes the tag.
package localshell

import "errors"

// ErrNotBuilt is what a binary without the tag reports when asked for a shell.
var ErrNotBuilt = errors.New("local shell is not built into this binary (rebuild with -tags localshell)")
