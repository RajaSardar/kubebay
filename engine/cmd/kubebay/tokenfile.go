package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// sessionTokenPath resolves where the launch token is handed to the desktop
// app.  Under the user's config dir because that directory is already expected
// to be private to the user on every platform we ship.
func sessionTokenPath(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "kubebay", "session-token"), nil
}

// writeSessionToken stores the token at path with 0600 permissions.
//
// Written to a temp file and renamed so a reader (the desktop app, polling for
// the file right after spawning the engine) can never observe a partial token
// and give up with a bogus value.
func writeSessionToken(path, token string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".session-token-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(token); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("rename token file: %w", err)
	}
	return nil
}
