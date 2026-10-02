package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// Disconnect against a real API server: the open stream ends with a
// "cluster disconnected" error frame, the cluster reports connected=false,
// and opening a stream again reconnects it.
func TestLiveDisconnectEndsStreams(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	srv, mgr := buildTestServer(t)
	clusterID := firstClusterID(t, httpGetJSON(t, srv.URL+"/api/clusters"))
	c := dialWS(t, srv)
	sendText(t, c, `{"type":"sub","id":"s1","cluster":"`+clusterID+`","gvr":"v1/namespaces"}`)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	waitControl := func(want func(stream.ControlFrame) bool) stream.ControlFrame {
		for {
			typ, b, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if typ != websocket.MessageText {
				continue
			}
			var f stream.ControlFrame
			_ = json.Unmarshal(b, &f)
			if want(f) {
				return f
			}
		}
	}
	waitControl(func(f stream.ControlFrame) bool { return f.Type == stream.TypeSync && f.ID == "s1" })
	if !mgr.IsConnected(clusterID) {
		t.Fatal("opening a stream should have connected the cluster")
	}

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/clusters/"+clusterID+"/disconnect", nil)
	req.Header.Set("X-Kubebay-Token", "testtoken")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("disconnect: %d", res.StatusCode)
	}

	f := waitControl(func(f stream.ControlFrame) bool { return f.ID == "s1" && f.Type == stream.TypeError })
	if !strings.Contains(f.Message, "disconnected") {
		t.Errorf("error frame = %+v", f)
	}
	if mgr.IsConnected(clusterID) {
		t.Error("cluster still connected after disconnect")
	}

	sendText(t, c, `{"type":"sub","id":"s2","cluster":"`+clusterID+`","gvr":"v1/namespaces"}`)
	waitControl(func(f stream.ControlFrame) bool { return f.Type == stream.TypeSync && f.ID == "s2" })
	if !mgr.IsConnected(clusterID) {
		t.Error("a new stream after disconnect should reconnect")
	}
}
