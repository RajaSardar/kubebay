package httpapi

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	repo "helm.sh/helm/v4/pkg/repo/v1"
)

// SharedHelmReposBlockReason is why the Helm repository list is read-only
// here, or "". A shared engine (in a cluster or with OIDC) has one
// repositories file, and every user's "repo/chart" install resolves against
// it, so one user adding, repointing or removing a repository would choose
// where another user's charts come from.
func SharedHelmReposBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "Helm repositories are read-only when OIDC or an auth proxy is configured: every user's chart installs use them, so the operator sets them through the engine's --helm-repos flag or the Helm chart's helmRepos value."
	case inCluster:
		return "Helm repositories are read-only when Kubebay runs in a cluster: every user's chart installs use them, so the operator sets them through the engine's --helm-repos flag or the Helm chart's helmRepos value."
	}
	return ""
}

// refuseIfReposLocked answers 403 and returns true when the repository list is read-only.
func (h *HelmManager) refuseIfReposLocked(w http.ResponseWriter) bool {
	if h.ReposLocked == "" {
		return false
	}
	http.Error(w, h.ReposLocked, http.StatusForbidden)
	return true
}

// OperatorHelmRepo is one repository the operator configures at startup.
type OperatorHelmRepo struct {
	Name string
	URL  string
}

// ParseOperatorHelmRepos reads --helm-repos / KUBEBAY_HELM_REPOS:
// comma-separated name=url pairs. Credentials are not taken here, since a
// flag or env value is easy to leak; a private repository belongs in a
// mounted repositories file named by HELM_REPOSITORY_CONFIG.
func ParseOperatorHelmRepos(s string) ([]OperatorHelmRepo, error) {
	var out []OperatorHelmRepo
	seen := map[string]bool{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, raw, ok := strings.Cut(part, "=")
		name, raw = strings.TrimSpace(name), strings.TrimSpace(raw)
		if !ok || !repoNameRE.MatchString(name) {
			return nil, fmt.Errorf("helm repo %q: want name=url with a name of letters, digits, dot, dash or underscore", part)
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("helm repo %q: the URL must be http or https", name)
		}
		if seen[name] {
			return nil, fmt.Errorf("helm repo %q is listed twice", name)
		}
		seen[name] = true
		out = append(out, OperatorHelmRepo{Name: name, URL: raw})
	}
	return out, nil
}

// SeedOperatorRepos writes the operator's repositories into the Helm
// repositories file, replacing any stored entry of the same name. Others are
// left alone. Indexes are fetched by RefreshRepos, or Update indexes.
func (h *HelmManager) SeedOperatorRepos(repos []OperatorHelmRepo) error {
	if len(repos) == 0 {
		return nil
	}
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("load repo file: %w", err)
		}
		f = repo.NewFile()
	}
	for _, r := range repos {
		f.Update(&repo.Entry{Name: r.Name, URL: r.URL})
	}
	if err := os.MkdirAll(filepath.Dir(settings.RepositoryConfig), 0o700); err != nil {
		return err
	}
	return f.WriteFile(settings.RepositoryConfig, 0o600)
}

// RefreshRepos fetches the named repositories' indexes, as Update indexes
// does, and returns each one's outcome ("ok" or "error: …").
func (h *HelmManager) RefreshRepos(names []string) map[string]string {
	settings := h.settings()
	out := map[string]string{}
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		for _, n := range names {
			out[n] = "error: " + err.Error()
		}
		return out
	}
	for _, n := range names {
		if e := f.Get(n); e != nil {
			out[n] = h.refreshRepo(settings, e)
		}
	}
	return out
}
