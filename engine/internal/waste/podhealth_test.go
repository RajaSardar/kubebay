package waste

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// The same fixtures the shell's attention.ts runs: a pod the Overview lists
// as needing attention must be the pod the history recorder counts as broken.
const podBrokenFixtures = "../../../web/apps/shell/src/lib/__fixtures__/podBroken.json"

func TestPodBrokenMatchesShellFixtures(t *testing.T) {
	b, err := os.ReadFile(podBrokenFixtures)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Now   time.Time `json:"now"`
		Cases []struct {
			Name   string     `json:"name"`
			Broken bool       `json:"broken"`
			Pod    corev1.Pod `json:"pod"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no fixtures")
	}
	for _, c := range f.Cases {
		if got := podBroken(c.Pod, f.Now); got != c.Broken {
			t.Errorf("%s: podBroken = %v, want %v", c.Name, got, c.Broken)
		}
	}
}
