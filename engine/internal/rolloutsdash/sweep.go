package rolloutsdash

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const pidFileName = "rollouts-dashboard.pids"

type pidEntry struct {
	PID      int    `json:"pid"`
	Identity string `json:"identity"`
}

func (m *Manager) pidPath() string {
	if m.DataDir == "" {
		return ""
	}
	return filepath.Join(m.DataDir, pidFileName)
}

func (m *Manager) readPIDs() []pidEntry {
	p := m.pidPath()
	if p == "" {
		return nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var es []pidEntry
	_ = json.Unmarshal(b, &es)
	return es
}

func (m *Manager) writePIDs(es []pidEntry) {
	p := m.pidPath()
	if p == "" {
		return
	}
	if len(es) == 0 {
		_ = os.Remove(p)
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	b, _ := json.Marshal(es)
	_ = os.WriteFile(p, b, 0o600)
}

var pidMu = make(chan struct{}, 1)

func (m *Manager) recordPID(pid int, identity string) {
	pidMu <- struct{}{}
	defer func() { <-pidMu }()
	m.writePIDs(append(m.readPIDs(), pidEntry{PID: pid, Identity: identity}))
}

func (m *Manager) removePID(pid int) {
	pidMu <- struct{}{}
	defer func() { <-pidMu }()
	var keep []pidEntry
	for _, e := range m.readPIDs() {
		if e.PID != pid {
			keep = append(keep, e)
		}
	}
	m.writePIDs(keep)
}

// Sweep ends dashboards a previous engine left behind (it was killed without
// running its shutdown). An entry is only acted on when the pid still belongs
// to the same process (same start time and command), so a recycled pid is
// never signalled. Unix only; on Windows identities are empty and nothing is killed.
func (m *Manager) Sweep() {
	pidMu <- struct{}{}
	defer func() { <-pidMu }()
	for _, e := range m.readPIDs() {
		if e.Identity != "" && pidAlive(e.PID) && ident(e.PID) == e.Identity {
			killGroup(e.PID)
		}
	}
	m.writePIDs(nil)
}
