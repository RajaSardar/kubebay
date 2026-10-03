package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/auditfeed"
)

const (
	// auditTailBytes bounds how much of the log one request reads.
	auditTailBytes = 32 << 20
	auditMaxEvents = 500
)

// AuditFeedBlockReason says why the audit feed must be off, or "" when it may
// run. It reads a file on the engine host as the engine's OS user, so like
// the local shell (localshell.Allowed) it is refused when OIDC is configured
// (every logged-in user would see the cluster-wide audit trail, past their own
// RBAC) and under --in-cluster (the engine host is not the user's machine).
func AuditFeedBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "the audit feed reads a file on the engine host, so it is off when OIDC is configured: every logged-in user would see the whole cluster's audit trail"
	case inCluster:
		return "the audit feed reads a file on the engine host, so it is off in in-cluster mode"
	}
	return ""
}

// HandleSetAuditLogPath stores (or, with an empty path, clears) where one
// cluster's API server audit log can be read on this machine.
func (s *SettingsManager) HandleSetAuditLogPath(w http.ResponseWriter, r *http.Request) {
	if s.AuditFeedDisabled != "" {
		http.Error(w, s.AuditFeedDisabled, http.StatusForbidden)
		return
	}
	var req struct {
		Cluster string `json:"cluster"`
		Path    string `json:"path"`
	}
	if err := decodeBody(r, &req); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	path := strings.TrimSpace(req.Path)
	if path != "" {
		if !filepath.IsAbs(path) {
			http.Error(w, "use an absolute path to the audit log file", http.StatusBadRequest)
			return
		}
		st, err := os.Stat(path)
		if err != nil {
			http.Error(w, fmt.Sprintf("%s: %v", path, err), http.StatusBadRequest)
			return
		}
		if st.IsDir() {
			http.Error(w, path+" is a directory; point at the audit log file itself", http.StatusBadRequest)
			return
		}
		path = filepath.Clean(path)
	}

	s.mu <- struct{}{}
	defer func() { <-s.mu }()
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// A file replaces any cloud source; clearing stops reading either.
	delete(set.AuditSources, req.Cluster)
	if path == "" {
		delete(set.AuditLogPaths, req.Cluster)
	} else {
		if set.AuditLogPaths == nil {
			set.AuditLogPaths = map[string]string{}
		}
		set.AuditLogPaths[req.Cluster] = path
	}
	if err := s.save(set); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "path": path})
}

// HandleAuditEvents returns the security events in the tail of a cluster's
// configured audit log. An unreadable log is reported in the body, not as an
// HTTP error, so the UI can say what's wrong next to the configured path.
func (s *SettingsManager) HandleAuditEvents(w http.ResponseWriter, r *http.Request) {
	if s.AuditFeedDisabled != "" {
		http.Error(w, s.AuditFeedDisabled, http.StatusForbidden)
		return
	}
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if src, ok := set.AuditSources[cluster]; ok {
		run := s.AuditRunner
		if run == nil {
			run = execRunner
		}
		ctx, cancel := context.WithTimeout(r.Context(), auditCloudTimeout)
		defer cancel()
		events, err := auditfeed.ReadCloud(ctx, run, src, auditCloudWindow, auditMaxEvents, time.Now())
		out := map[string]any{"configured": true, "source": src.Kind, "path": describeSource(src), "cloud": src, "events": events}
		if err != nil {
			out["error"], out["events"] = err.Error(), []auditfeed.SecurityEvent{}
		}
		writeJSON(w, out)
		return
	}
	path := set.AuditLogPaths[cluster]
	if path == "" {
		writeJSON(w, map[string]any{"configured": false, "events": []auditfeed.SecurityEvent{}})
		return
	}
	events, err := auditfeed.ReadTail(path, auditTailBytes, auditMaxEvents)
	if err != nil {
		writeJSON(w, map[string]any{"configured": true, "source": "file", "path": path, "error": err.Error(), "events": []auditfeed.SecurityEvent{}})
		return
	}
	writeJSON(w, map[string]any{"configured": true, "source": "file", "path": path, "events": events})
}

const (
	// auditCloudWindow is how far back a cloud source is read.
	auditCloudWindow  = 2 * time.Hour
	auditCloudTimeout = 60 * time.Second
)

func describeSource(src auditfeed.CloudSource) string {
	switch src.Kind {
	case "eks":
		d := "CloudWatch /aws/eks/" + src.Cluster + "/cluster"
		if src.Region != "" {
			d += " (" + src.Region + ")"
		}
		return d
	case "gke":
		return "Cloud Logging " + src.Project + "/" + src.Location + "/" + src.Cluster
	}
	return src.Kind
}

// execRunner runs the user's own aws/gcloud with the engine's environment
// (the desktop app forwards the login shell's PATH and cloud profile vars).
func execRunner(ctx context.Context, name string, args ...string) ([]byte, error) {
	if _, err := exec.LookPath(name); err != nil {
		return nil, fmt.Errorf("%s CLI not found on PATH: install it, or point the feed at a synced log file", name)
	}
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			msg := strings.TrimSpace(string(ee.Stderr))
			if len(msg) > 500 {
				msg = msg[:500]
			}
			return nil, fmt.Errorf("%s: %s", err, msg)
		}
		return nil, err
	}
	return out, nil
}

// HandleSetAuditSource stores (or, with a null source, clears) a cloud audit
// source for one cluster. It replaces any file path.
func (s *SettingsManager) HandleSetAuditSource(w http.ResponseWriter, r *http.Request) {
	if s.AuditFeedDisabled != "" {
		http.Error(w, s.AuditFeedDisabled, http.StatusForbidden)
		return
	}
	var req struct {
		Cluster string                 `json:"cluster"`
		Source  *auditfeed.CloudSource `json:"source"`
	}
	if err := decodeBody(r, &req); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	if req.Source != nil {
		if err := req.Source.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	s.mu <- struct{}{}
	defer func() { <-s.mu }()
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	delete(set.AuditLogPaths, req.Cluster)
	if req.Source == nil {
		delete(set.AuditSources, req.Cluster)
	} else {
		if set.AuditSources == nil {
			set.AuditSources = map[string]auditfeed.CloudSource{}
		}
		set.AuditSources[req.Cluster] = *req.Source
	}
	if err := s.save(set); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
