package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeKC(t *testing.T, dir, name, ctx string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	body := "apiVersion: v1\nkind: Config\nclusters:\n- name: c-" + ctx + "\n  cluster: {server: 'https://127.0.0.1:1'}\nusers:\n- name: u-" + ctx + "\n  user: {token: abc}\ncontexts:\n- name: " + ctx + "\n  context: {cluster: c-" + ctx + ", user: u-" + ctx + "}\ncurrent-context: " + ctx + "\n"
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestKubeconfigForContextPicksTheFileThatDefinesIt(t *testing.T) {
	dir := t.TempDir()
	a := writeKC(t, dir, "a", "ctx-a")
	b := writeKC(t, dir, "b", "ctx-b")
	got, err := kubeconfigForContext([]string{a, filepath.Join(dir, "missing"), b}, "ctx-b")
	if err != nil || got != b {
		t.Fatalf("got %q %v, want %q", got, err, b)
	}
	if _, err := kubeconfigForContext([]string{a, b}, "ctx-none"); err == nil {
		t.Fatal("a context no file defines must be an error")
	}
}
