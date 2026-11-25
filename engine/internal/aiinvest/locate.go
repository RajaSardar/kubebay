package aiinvest

import (
	"os"
	"path/filepath"
)

// CommonPaths are where Claude Code installs itself when PATH misses it
// (a desktop app is often launched with a short PATH).
func CommonPaths(home string) []string {
	var out []string
	if home != "" {
		out = append(out,
			filepath.Join(home, ".claude", "local", "claude"),
			filepath.Join(home, ".local", "bin", "claude"),
		)
	}
	return append(out, "/opt/homebrew/bin/claude", "/usr/local/bin/claude")
}

func isExecFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular() && st.Mode().Perm()&0o111 != 0
}

// Find returns the absolute path of the claude executable: PATH first, then
// the candidates. Empty when there is none. Relative PATH entries are
// ignored (a relative entry would run whatever is in the current directory).
func Find(pathEnv string, candidates []string) string {
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		if p := filepath.Join(dir, "claude"); isExecFile(p) {
			return p
		}
	}
	for _, p := range candidates {
		if filepath.IsAbs(p) && isExecFile(p) {
			return p
		}
	}
	return ""
}
