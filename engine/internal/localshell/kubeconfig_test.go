//go:build localshell

package localshell

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
)

func TestWriteSessionKubeconfigCarriesNoCredentials(t *testing.T) {
	dir := t.TempDir()
	path, err := writeSessionKubeconfig(dir, "prod-eu")
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	st, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", st.Mode().Perm())
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	for _, forbidden := range []string{
		"token", "client-key", "client-certificate", "password",
		"exec:", "auth-provider", "certificate-authority", "server:",
	} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("session kubeconfig contains %q:\n%s", forbidden, raw)
		}
	}

	cfg, err := clientcmd.LoadFromFile(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.CurrentContext != "prod-eu" {
		t.Fatalf("current-context = %q, want prod-eu", cfg.CurrentContext)
	}
	if len(cfg.AuthInfos) != 0 || len(cfg.Clusters) != 0 || len(cfg.Contexts) != 0 {
		t.Fatalf("expected an otherwise empty config, got %+v", cfg)
	}
}

func TestWriteSessionKubeconfigRefusesToClobber(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kubeconfig"), []byte("precious"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSessionKubeconfig(dir, "x"); err == nil {
		t.Fatal("expected O_EXCL to refuse an existing file")
	}
}

func TestKubeconfigEnvPutsTheSessionFileFirst(t *testing.T) {
	sep := string(os.PathListSeparator)
	got := kubeconfigEnv("/tmp/s/kubeconfig", []string{"/home/u/.kube/config", "", "/home/u/.kube/work"})
	want := strings.Join([]string{"/tmp/s/kubeconfig", "/home/u/.kube/config", "/home/u/.kube/work"}, sep)
	if got != want {
		t.Fatalf("KUBECONFIG = %q, want %q", got, want)
	}
}
