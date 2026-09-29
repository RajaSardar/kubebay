package httpapi

import (
	"testing"

	"helm.sh/helm/v3/pkg/repo"
)

func TestAddOrUpdateRepoEntryAddsNew(t *testing.T) {
	f := repo.NewFile()
	entry, changed := addOrUpdateRepoEntry(f, "autoscaler", "https://kubernetes.github.io/autoscaler")

	if !changed {
		t.Fatal("expected changed=true when adding a brand-new repo")
	}
	if entry.Name != "autoscaler" || entry.URL != "https://kubernetes.github.io/autoscaler" {
		t.Errorf("entry = %+v, want name=autoscaler url=https://kubernetes.github.io/autoscaler", entry)
	}
	if got := f.Get("autoscaler"); got == nil || got.URL != entry.URL {
		t.Errorf("repo file does not contain the new entry: %+v", f.Repositories)
	}
}

func TestAddOrUpdateRepoEntryNoopWhenUnchanged(t *testing.T) {
	f := repo.NewFile()
	f.Add(&repo.Entry{Name: "autoscaler", URL: "https://kubernetes.github.io/autoscaler"})

	_, changed := addOrUpdateRepoEntry(f, "autoscaler", "https://kubernetes.github.io/autoscaler")

	if changed {
		t.Error("expected changed=false when the same name/url already exists")
	}
}

func TestAddOrUpdateRepoEntryUpdatesExistingUrl(t *testing.T) {
	f := repo.NewFile()
	f.Add(&repo.Entry{Name: "autoscaler", URL: "https://old.example.com"})

	entry, changed := addOrUpdateRepoEntry(f, "autoscaler", "https://kubernetes.github.io/autoscaler")

	if !changed {
		t.Fatal("expected changed=true when the URL differs from the existing entry")
	}
	if entry.URL != "https://kubernetes.github.io/autoscaler" {
		t.Errorf("entry.URL = %q, want the new URL", entry.URL)
	}
	if got := f.Get("autoscaler"); got == nil || got.URL != "https://kubernetes.github.io/autoscaler" {
		t.Errorf("repo file entry was not updated in place: %+v", f.Repositories)
	}
}
