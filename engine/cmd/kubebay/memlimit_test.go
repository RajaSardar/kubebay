package main

import "testing"

func TestMemoryLimitBytes(t *testing.T) {
	t.Run("defaults to 512 MiB when GOMEMLIMIT is unset", func(t *testing.T) {
		got, ok := memoryLimitBytes("")
		if !ok || got != 512<<20 {
			t.Fatalf("got %d, %v; want 512 MiB, true", got, ok)
		}
	})
	t.Run("leaves an operator's GOMEMLIMIT alone", func(t *testing.T) {
		if _, ok := memoryLimitBytes("2GiB"); ok {
			t.Fatal("must not override GOMEMLIMIT")
		}
	})
}
