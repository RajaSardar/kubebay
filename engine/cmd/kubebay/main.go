package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:9898", "listen address")
	kubeconfig := flag.String("kubeconfig", "", "explicit kubeconfig path (default: KUBECONFIG / ~/.kube/config)")
	webDist := flag.String("web-dist", "", "serve SPA from this directory")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	mgr, err := clusters.NewManager(log, *kubeconfig)
	if err != nil {
		log.Error("cluster manager init failed", "err", err)
		os.Exit(1)
	}

	registry := informers.NewPoolRegistry(mgr)
	channels := httpapi.NewChannels(mgr)
	hub := stream.NewHub(log, channels)
	pfManager := httpapi.NewPFManager(mgr)
	actions := &httpapi.Actions{Clusters: mgr}
	metrics := &httpapi.Metrics{Clusters: mgr}
	token, err := httpapi.NewToken()
	if err != nil {
		log.Error("token generation failed", "err", err)
		os.Exit(1)
	}

	handler := httpapi.Router(httpapi.Deps{
		Log:      log,
		Clusters: mgr,
		Pools:    registry,
		Hub:      hub,
		Channels: channels,
		PF:       pfManager,
		Actions:  actions,
		Metrics:  metrics,
	}, token)

	switch {
	case *webDist != "":
		if ui, ok := diskUI(*webDist); ok {
			handler = spaHandler(ui, handler)
			log.Info("serving web UI from directory", "dir", *webDist)
		} else {
			log.Warn("web-dist has no index.html, serving notice page")
			handler = fallbackNotice(handler)
		}
	default:
		if ui, ok := embeddedUI(); ok {
			handler = spaHandler(ui, handler)
			log.Info("serving embedded web UI")
		} else {
			handler = fallbackNotice(handler)
		}
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("kubebay engine listening", "addr", fmt.Sprintf("http://%s", *addr), "token", token)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
