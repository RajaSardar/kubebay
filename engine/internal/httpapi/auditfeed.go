package httpapi

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/auditfeed"
)

const (
	// auditTailBytes bounds how much of the log one request reads.
	auditTailBytes = 32 << 20
	auditMaxEvents = 500
)

// HandleSetAuditLogPath stores (or, with an empty path, clears) where one
// cluster's API server audit log can be read on this machine.
func (s *SettingsManager) HandleSetAuditLogPath(w http.ResponseWriter, r *http.Request) {
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
	path := set.AuditLogPaths[cluster]
	if path == "" {
		writeJSON(w, map[string]any{"configured": false, "events": []auditfeed.SecurityEvent{}})
		return
	}
	events, err := auditfeed.ReadTail(path, auditTailBytes, auditMaxEvents)
	if err != nil {
		writeJSON(w, map[string]any{"configured": true, "path": path, "error": err.Error(), "events": []auditfeed.SecurityEvent{}})
		return
	}
	writeJSON(w, map[string]any{"configured": true, "path": path, "events": events})
}
