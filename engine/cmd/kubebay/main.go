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

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/authproxy"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/netguard"
	"github.com/RajaSardar/kubebay/engine/internal/sigcheck"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
	"github.com/RajaSardar/kubebay/engine/internal/waste"

	// Registers client-go's in-tree auth providers via their init()s.  Without
	// this, a kubeconfig with `auth-provider: {name: oidc}` (Dex, Keycloak,
	// legacy kubelogin, Rancher) fails with `no Auth Provider found for name
	// "oidc"` where plain kubectl works.  The azure/gcp providers this also
	// pulls in are removal stubs that return a "use kubelogin/gke-gcloud-auth-
	// plugin instead" message — still far better than an opaque failure.
	_ "k8s.io/client-go/plugin/pkg/client/auth"
)

var version = "dev"

func main() {
	// `kubebay-engine mcp-stdio`: the stdio bridge MCP clients like Claude
	// Desktop launch; it forwards to the running app and serves nothing.
	if len(os.Args) > 1 && os.Args[1] == "mcp-stdio" {
		os.Exit(runMCPStdio(os.Args[2:], os.Stdin, os.Stdout, os.Stderr))
	}
	showVersion := flag.Bool("version", false, "print version and exit")
	noOpen := flag.Bool("no-open", false, "do not open the browser automatically")
	addr := flag.String("addr", "127.0.0.1:9898", "listen address")
	kubeconfigDefault := os.Getenv("KUBEBAY_KUBECONFIG") // prod-safety: dedicated override
	kubeconfig := flag.String("kubeconfig", kubeconfigDefault, "explicit kubeconfig path (KUBEBAY_KUBECONFIG > flag > KUBECONFIG > ~/.kube/config)")
	webDist := flag.String("web-dist", "", "serve SPA from this directory")
	tokenFile := flag.String("token-file", "", "write the session token here (default: <user config dir>/kubebay/session-token)")
	inCluster := flag.Bool("in-cluster", false, "use in-cluster ServiceAccount config instead of kubeconfig")
	oidcIssuer := flag.String("oidc-issuer-url", os.Getenv("KUBEBAY_OIDC_ISSUER"), "OIDC issuer URL (enables login)")
	oidcClientID := flag.String("oidc-client-id", os.Getenv("KUBEBAY_OIDC_CLIENT_ID"), "OIDC client id")
	oidcClientSecret := flag.String("oidc-client-secret", os.Getenv("KUBEBAY_OIDC_CLIENT_SECRET"), "OIDC client secret")
	oidcRedirect := flag.String("oidc-redirect-url", os.Getenv("KUBEBAY_OIDC_REDIRECT"), "OAuth2 redirect URL")
	proxyUserHeader := flag.String("auth-proxy-user-header", os.Getenv("KUBEBAY_AUTH_PROXY_USER_HEADER"), "trust this header from an authenticating reverse proxy as the user name, instead of OIDC, e.g. X-Auth-Request-Email (KUBEBAY_AUTH_PROXY_USER_HEADER)")
	proxyGroupsHeader := flag.String("auth-proxy-groups-header", os.Getenv("KUBEBAY_AUTH_PROXY_GROUPS_HEADER"), "header holding the user's comma separated groups (KUBEBAY_AUTH_PROXY_GROUPS_HEADER)")
	proxyCIDRs := flag.String("auth-proxy-trusted-cidrs", os.Getenv("KUBEBAY_AUTH_PROXY_TRUSTED_CIDRS"), "comma separated CIDRs the proxy connects from; the identity headers are honoured only from a peer inside them (KUBEBAY_AUTH_PROXY_TRUSTED_CIDRS)")
	proxySecretHeader := flag.String("auth-proxy-secret-header", os.Getenv("KUBEBAY_AUTH_PROXY_SECRET_HEADER"), "header the proxy must send with the shared secret (KUBEBAY_AUTH_PROXY_SECRET_HEADER)")
	proxySecretFile := flag.String("auth-proxy-secret-file", os.Getenv("KUBEBAY_AUTH_PROXY_SECRET_FILE"), "file holding the shared secret; the KUBEBAY_AUTH_PROXY_SECRET env var also works, there is no flag for the value")
	proxyAllowAny := flag.Bool("auth-proxy-allow-any-peer", os.Getenv("KUBEBAY_AUTH_PROXY_ALLOW_ANY_PEER") == "true", "acknowledge the risk of trusting an empty, 0.0.0.0/0 or wide CIDR range without a shared secret (KUBEBAY_AUTH_PROXY_ALLOW_ANY_PEER=true)")
	proxyAllowSystem := flag.Bool("auth-proxy-allow-system-identities", os.Getenv("KUBEBAY_AUTH_PROXY_ALLOW_SYSTEM_IDENTITIES") == "true", "let the proxy name system: users and the system:masters group (default off; KUBEBAY_AUTH_PROXY_ALLOW_SYSTEM_IDENTITIES=true)")
	warmClusters := flag.String("warm-clusters", os.Getenv("KUBEBAY_WARM_CLUSTERS"), "most connected clusters kept streaming; the least recently viewed unpinned one sleeps past it (default 5, 0 = no limit; KUBEBAY_WARM_CLUSTERS)")
	warmIdle := flag.String("warm-idle", os.Getenv("KUBEBAY_WARM_IDLE"), "a connected cluster nobody viewed for this long sleeps, e.g. 30m (default 30m, 0 = never; KUBEBAY_WARM_IDLE)")
	promURL := flag.String("prometheus-url", os.Getenv("KUBEBAY_PROMETHEUS_URL"), "Prometheus to query directly for every cluster; the only one a shared engine (in a cluster or with OIDC) uses (KUBEBAY_PROMETHEUS_URL)")
	promAllUsers := flag.Bool("prometheus-all-users", os.Getenv("KUBEBAY_PROMETHEUS_ALL_USERS") == "true", "let every OIDC user send raw PromQL to --prometheus-url, which answers for every namespace whatever their RBAC (KUBEBAY_PROMETHEUS_ALL_USERS=true)")
	helmRepos := flag.String("helm-repos", os.Getenv("KUBEBAY_HELM_REPOS"), "Helm repositories to configure at startup, as name=url,name=url; the only way to change them on a shared engine (in a cluster or with OIDC) (KUBEBAY_HELM_REPOS)")
	localShell := flag.Bool("local-shell", false, "serve a shell on this machine (requires a binary built with -tags localshell, a loopback --addr, no --in-cluster and no OIDC)")
	auditStdout := flag.Bool("audit-stdout", false, "also print every audit entry to stdout as a JSON line (default on with --in-cluster, off otherwise; KUBEBAY_AUDIT_STDOUT)")
	flag.Parse()

	if *showVersion {
		fmt.Println("kubebay", version)
		return
	}

	applyMemoryLimit(os.Getenv("GOMEMLIMIT"))

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// Sign-in comes from OIDC or from an authenticating proxy, never both. The
	// proxy build refuses an unsafe or conflicting setup, so a mistake is a
	// startup failure rather than a quietly open engine.
	proxy, proxyErr := authproxy.Build(authproxy.Options{
		UserHeader: *proxyUserHeader, GroupsHeader: *proxyGroupsHeader, TrustedCIDRs: *proxyCIDRs,
		SecretHeader: *proxySecretHeader, SecretFile: *proxySecretFile, Secret: os.Getenv("KUBEBAY_AUTH_PROXY_SECRET"),
		AllowAnyPeer: *proxyAllowAny, AllowSystemIdentities: *proxyAllowSystem,
	}, *oidcIssuer)
	if proxyErr != nil {
		log.Error("auth-proxy configuration refused", "err", proxyErr)
		os.Exit(1)
	}
	auth, authErr := httpapi.NewAuthenticator(*oidcIssuer, *oidcClientID, *oidcClientSecret, *oidcRedirect)
	if authErr != nil {
		log.Error("oidc init failed", "err", authErr)
		os.Exit(1)
	}

	// One engine serves several signed-in people, whichever way it learns who
	// they are. Every shared-state decision below takes this, not auth.Enabled().
	sharedIdentity := auth.Enabled() || proxy.Enabled()

	var mgr *clusters.Manager
	var err error
	if *inCluster {
		mgr, err = clusters.NewManager(log, "")
		if err == nil {
			err = mgr.LoadInCluster()
		}
	} else {
		mgr, err = clusters.NewManager(log, *kubeconfig)
	}
	if err != nil {
		log.Error("cluster manager init failed", "err", err)
		os.Exit(1)
	}

	// Streams are shared between users with OIDC or in-cluster, so one
	// person's idle clock must not cut another's: no eviction there.
	if !*inCluster && !sharedIdentity {
		warmCap, idle := clusters.ParseWarmPolicy(*warmClusters, *warmIdle)
		mgr.SetWarmPolicy(warmCap, idle)
		sweepCtx, cancelSweep := context.WithCancel(context.Background())
		defer cancelSweep()
		mgr.StartIdleSweeper(sweepCtx)
	}

	auditOpts := audit.OptionsFromEnv(os.Getenv, *inCluster)
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "audit-stdout" {
			auditOpts.Stdout = *auditStdout
		}
	})
	auditLog, err := audit.NewWithOptions(log, auditOpts)
	if err != nil {
		log.Error("audit log init failed", "err", err)
		os.Exit(1)
	}
	defer auditLog.Close()

	registry := informers.NewPoolRegistry(mgr)
	channels := httpapi.NewChannels(mgr, auditLog)
	chanDeps, localShellStatus, closeLocalShell := setupLocalShell(log, channels, *localShell, *inCluster, sharedIdentity, *addr)
	defer closeLocalShell()
	hub := stream.NewHub(log, chanDeps)
	pfManager := httpapi.NewPFManager(mgr)
	// Disconnect (or a connected context leaving the kubeconfig) stops the
	// cluster's informers, which ends its open streams, and its port-forwards.
	httpapi.TeardownOnDisconnect(mgr, registry, pfManager)
	actions := &httpapi.Actions{Clusters: mgr}
	metrics := &httpapi.Metrics{Clusters: mgr}
	rbac := &httpapi.RBAC{Clusters: mgr}
	wasteCtx, cancelWaste := context.WithCancel(context.Background())
	defer cancelWaste()
	wasteSampler := waste.NewSampler(mgr, log)
	helmMgr := httpapi.NewHelm(mgr, auditLog)
	settingsMgr := httpapi.NewSettingsManager(mgr)
	// A user-supplied URL (Prometheus, a Helm repo) must never reach cloud metadata or a
	// link-local address; in-cluster it must not reach the pod's own loopback either.
	outbound := netguard.Policy{BlockLoopback: *inCluster}
	settingsMgr.Outbound = outbound
	helmMgr.Outbound = outbound
	// One repositories file serves every user's installs on a shared engine,
	// so only the operator changes it, through --helm-repos.
	helmMgr.ReposLocked = httpapi.SharedHelmReposBlockReason(*inCluster, sharedIdentity)
	operatorRepos, err := httpapi.ParseOperatorHelmRepos(*helmRepos)
	if err != nil {
		log.Error("bad --helm-repos", "err", err)
		os.Exit(1)
	}
	if err := helmMgr.SeedOperatorRepos(operatorRepos); err != nil {
		log.Error("could not configure --helm-repos", "err", err)
		os.Exit(1)
	}
	if len(operatorRepos) > 0 {
		names := make([]string, len(operatorRepos))
		for i, r := range operatorRepos {
			names[i] = r.Name
		}
		go func() {
			for name, res := range helmMgr.RefreshRepos(names) {
				if res != "ok" {
					log.Warn("helm repo index fetch failed", "repo", name, "result", res)
				}
			}
		}()
	}
	settingsMgr.LocalShell = localShellStatus
	settingsMgr.AuditFeedDisabled = httpapi.AuditFeedBlockReason(*inCluster, sharedIdentity)
	settingsMgr.WarmPolicyDisabled = httpapi.WarmPolicyBlockReason(*inCluster, sharedIdentity)
	// One engine serving many people: what the node shell and debug containers
	// run, and which Prometheus is queried, come from the operator only.
	settingsMgr.SharedLocked = httpapi.SharedSettingsBlockReason(*inCluster, sharedIdentity)
	settingsMgr.HelmReposLocked = helmMgr.ReposLocked
	settingsMgr.Operator = httpapi.OperatorSettings{PrometheusURL: *promURL, PrometheusAllUsers: *promAllUsers}
	// A policy saved in Settings wins over the flag and env defaults.
	settingsMgr.ApplyStoredWarmPolicy()
	// Tier A (Prometheus) is a no-op until a cluster actually has one
	// configured — this just wires up how to ask, per-cluster, same as
	// promquery.go's own handlers.
	wasteSampler.SetPrometheusResolver(settingsMgr.SamplerPrometheusURL)
	// Poll workloads only on clusters the user connected to or enrolled in
	// usage history, never on every context that answers /version.
	wasteSampler.SetGate(func(id string) bool { return mgr.IsConnected(id) || settingsMgr.HistoryEnabled(id) })
	wasteSampler.SetConnected(mgr.IsConnected)
	historyAPI, closeHistory := setupHistory(log, mgr, settingsMgr, wasteSampler, httpapi.HistoryBlockReason(*inCluster, sharedIdentity), wasteCtx)
	defer closeHistory()
	timelineAPI, closeTimeline := setupTimeline(log, mgr, settingsMgr, registry, httpapi.TimelineBlockReason(*inCluster, sharedIdentity), wasteCtx)
	defer closeTimeline()
	timelineAPI.Audit = auditLog
	// Started only now, after the history recorder is set, so the sampler
	// goroutine never races those fields.
	wasteSampler.Start(wasteCtx)
	wasteSampler.StartTierA(wasteCtx)
	nodeShell := &httpapi.NodeShellManager{Clusters: mgr, Settings: settingsMgr}
	// An operator-supplied token (in-cluster, where there is no desktop app to
	// hand a file to) wins; otherwise we mint one per launch.
	envToken := os.Getenv("KUBEBAY_TOKEN")
	token := envToken
	if token == "" {
		token, err = httpapi.NewToken()
		if err != nil {
			log.Error("token generation failed", "err", err)
			os.Exit(1)
		}
	}

	// The token is a launch credential, not a log field: anything printed here
	// is re-emitted by the desktop wrapper and, for a launchd-started GUI app on
	// macOS, lands in the unified log where any process running as the user can
	// read it.  Hand it over through a 0600 file instead, and log only its path.
	tokenPath, tokenPathErr := sessionTokenPath(*tokenFile)
	tokenFileWritten := false
	if tokenPathErr == nil {
		if err := writeSessionToken(tokenPath, token); err != nil {
			log.Warn("could not write session token file", "path", tokenPath, "err", err)
		} else {
			tokenFileWritten = true
		}
	} else {
		log.Warn("could not resolve session token path", "err", tokenPathErr)
	}
	if !tokenFileWritten && envToken == "" {
		log.Warn("session token is unreadable by clients — set KUBEBAY_TOKEN to a known value")
	}
	defer func() {
		if tokenFileWritten {
			_ = os.Remove(tokenPath)
		}
	}()

	searchAPI := httpapi.NewSearchAPI(httpapi.NewPoolSearchBackend(registry, mgr))
	defer searchAPI.Close()

	handler := httpapi.Router(httpapi.Deps{
		Version:    version,
		Log:        log,
		Auth:       auth,
		Proxy:      proxy,
		Clusters:   mgr,
		Pools:      registry,
		Hub:        hub,
		Channels:   channels,
		PF:         pfManager,
		Actions:    actions,
		Metrics:    metrics,
		RBAC:       rbac,
		Helm:       helmMgr,
		NodeShell:  nodeShell,
		NetDiag:    &httpapi.NetDiagManager{Clusters: mgr, Audit: auditLog},
		ImageSigs:  &httpapi.ImageSignatureAPI{Clusters: mgr, Checker: &sigcheck.Checker{}, TrustRoots: sigstoreTrustRoots()},
		MCP:        newMCP(settingsMgr, mgr, registry, auditLog, *addr, *inCluster, sharedIdentity),
		Triage:     newTriage(settingsMgr, mgr, registry, auditLog, *inCluster, sharedIdentity),
		Settings:   settingsMgr,
		Extensions: newExtensions(settingsMgr, *inCluster, sharedIdentity),
		Audit:      auditLog,
		Waste:      wasteSampler,
		History:    historyAPI,
		Timeline:   timelineAPI,
		Search:     searchAPI,
		Discovery: &httpapi.DiscoveryAPI{
			Settings: settingsMgr,
			Clusters: mgr,
			Disabled: httpapi.DiscoveryBlockReason(*inCluster, sharedIdentity),
		},
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

	if proxy.Enabled() {
		handler = httpapi.ProxyGate(proxy, log)(handler)
		log.Info("auth-proxy mode: identity comes from a trusted proxy's headers", "userHeader", *proxyUserHeader)
	}

	// Wraps the SPA as well as the API: a rebound page should not be able to
	// read anything the engine serves, not just the JSON endpoints.
	if httpapi.IsLoopbackListenAddr(*addr) {
		handler = httpapi.RequireLoopbackHost(handler)
		log.Info("loopback listener: rejecting requests with a non-loopback Host")
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		url := fmt.Sprintf("http://%s", *addr)
		log.Info("kubebay engine listening", "addr", url, "version", version)
		if tokenFileWritten {
			log.Info("session token written", "path", tokenPath)
		}
		if !*noOpen && isTerminal() {
			go tryOpenBrowser(url + "/")
		}
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	cancelWaste()
	pfManager.StopAll()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
