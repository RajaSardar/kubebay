package audit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Entry struct {
	Time      time.Time `json:"time"`
	Action    string    `json:"action"`    // "exec", "port-forward", "scale", "delete", "restart", "drain", "cordon"
	Cluster   string    `json:"cluster"`
	Namespace string    `json:"namespace,omitempty"`
	Resource  string    `json:"resource,omitempty"` // pod/deployment name
	Detail    string    `json:"detail,omitempty"`   // extra context (command, replicas, etc.)
	UserAgent string    `json:"userAgent,omitempty"`
}

type Logger struct {
	mu   sync.Mutex
	f    *os.File
	path string
	log  *slog.Logger
}

func New(log *slog.Logger) (*Logger, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "kubebay")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "audit.log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("audit: open %s: %w", path, err)
	}
	log.Info("audit log", "path", path)
	return &Logger{f: f, path: path, log: log}, nil
}

func (l *Logger) Record(e Entry) {
	if l == nil {
		return
	}
	e.Time = time.Now().UTC()
	b, _ := json.Marshal(e)
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = fmt.Fprintf(l.f, "%s\n", b)
}

// Tail returns the last n entries from the audit log file.
func (l *Logger) Tail(n int) ([]Entry, error) {
	if l == nil {
		return nil, nil
	}
	l.mu.Lock()
	path := l.path
	l.mu.Unlock()

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}

	entries := make([]Entry, 0, len(lines))
	for _, line := range lines {
		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err == nil {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

func (l *Logger) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	return l.f.Close()
}
