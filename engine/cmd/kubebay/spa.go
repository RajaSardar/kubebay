package main

import (
	"net/http"
	"strings"
)

func wrapSPA(api http.Handler, files http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" {
			api.ServeHTTP(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}
