package history

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"
)

// Recorder maps cluster IDs to fingerprint directories. The fingerprint is
// computed on a cluster's first recorded tick (one kube-system read) and
// cached; after a restart, FingerprintFor finds the existing directory from
// meta.json without touching the cluster.
type Recorder struct {
	store *Store
	mu    sync.Mutex
	fps   map[string]string
}

func NewRecorder(s *Store) *Recorder {
	return &Recorder{store: s, fps: map[string]string{}}
}

func (r *Recorder) Store() *Store { return r.store }

func (r *Recorder) Record(ctx context.Context, meta Meta, cs kubernetes.Interface, at time.Time, obs []Obs) error {
	r.mu.Lock()
	fp, ok := r.fps[meta.ClusterID]
	r.mu.Unlock()
	if !ok {
		fp = Fingerprint(ctx, cs, meta.Context, meta.Server)
		r.mu.Lock()
		r.fps[meta.ClusterID] = fp
		r.mu.Unlock()
	}
	return r.store.Record(fp, meta, at, obs)
}

// FingerprintFor returns the directory for clusterID: the one recorded this
// session, else the most recently recorded one on disk.
func (r *Recorder) FingerprintFor(clusterID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if fp, ok := r.fps[clusterID]; ok {
		return fp, true
	}
	return r.store.latestFingerprint(clusterID)
}

// Erase deletes all of clusterID's history and forgets its fingerprint.
func (r *Recorder) Erase(clusterID string) (int, error) {
	r.mu.Lock()
	delete(r.fps, clusterID)
	r.mu.Unlock()
	return r.store.EraseCluster(clusterID)
}

func (s *Store) latestFingerprint(clusterID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dirs, err := os.ReadDir(s.dir)
	if err != nil {
		return "", false
	}
	best, bestHour := "", time.Time{}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, d.Name(), metaFile))
		if err != nil {
			continue
		}
		var m Meta
		if json.Unmarshal(b, &m) != nil || m.ClusterID != clusterID {
			continue
		}
		var hour time.Time
		if c := s.load(d.Name()); c.open != nil {
			hour = c.open.Hour
		}
		if best == "" || hour.After(bestHour) {
			best, bestHour = d.Name(), hour
		}
	}
	return best, best != ""
}
