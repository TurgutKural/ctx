package main

import (
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"
)

// TestNewHTTPServerTransportPolicy hält die Transport-Politik fest, die sonst
// nur als Literal in der Boot-Funktion stünde: die vier Timeouts und die
// Header-Obergrenze.
func TestNewHTTPServerTransportPolicy(t *testing.T) {
	srv := newHTTPServer("127.0.0.1:0", http.NotFoundHandler())
	if srv.MaxHeaderValueCount != maxHeaderValueCount {
		t.Errorf("MaxHeaderValueCount = %d, erwartet %d", srv.MaxHeaderValueCount, maxHeaderValueCount)
	}
	if srv.MaxHeaderValueCount >= http.DefaultMaxHeaderValueCount {
		t.Errorf("MaxHeaderValueCount = %d liegt nicht unter dem stdlib-Default %d — dann bringt die explizite Setzung nichts",
			srv.MaxHeaderValueCount, http.DefaultMaxHeaderValueCount)
	}
	if srv.ReadHeaderTimeout != 10*time.Second || srv.ReadTimeout != 30*time.Second {
		t.Errorf("ReadHeaderTimeout/ReadTimeout = %v/%v, erwartet 10s/30s", srv.ReadHeaderTimeout, srv.ReadTimeout)
	}
	if srv.WriteTimeout != 120*time.Second || srv.IdleTimeout != 60*time.Second {
		t.Errorf("WriteTimeout/IdleTimeout = %v/%v, erwartet 120s/60s", srv.WriteTimeout, srv.IdleTimeout)
	}
}

// TestNewHTTPServerRejectsHeaderFlood ist der Negativtest zur Obergrenze: ein
// Request mit mehr Header-Werten als erlaubt wird mit 431 abgewiesen, BEVOR der
// Handler läuft — ein Request in realistischer Größe geht unverändert durch.
func TestNewHTTPServerRejectsHeaderFlood(t *testing.T) {
	var handlerCalls int
	srv := newHTTPServer("127.0.0.1:0", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalls++
		w.WriteHeader(http.StatusNoContent)
	}))

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	url := "http://" + ln.Addr().String() + "/"
	do := func(t *testing.T, n int) int {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			t.Fatalf("NewRequest: %v", err)
		}
		for i := range n {
			req.Header.Set(fmt.Sprintf("X-Probe-%04d", i), "v")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("Do mit %d Headern: %v", n, err)
		}
		defer func() { _ = res.Body.Close() }()
		return res.StatusCode
	}

	// Realistische Last: eine Browser-Anfrage hinter einem Reverse Proxy trägt
	// rund 25 Header-Werte. Der Client legt Host, User-Agent und
	// Accept-Encoding selbst dazu.
	if got := do(t, 25); got != http.StatusNoContent {
		t.Errorf("25 Header: Status %d, erwartet %d", got, http.StatusNoContent)
	}
	if handlerCalls != 1 {
		t.Errorf("Handler lief %dx, erwartet 1x", handlerCalls)
	}

	if got := do(t, maxHeaderValueCount+10); got != http.StatusRequestHeaderFieldsTooLarge {
		t.Errorf("%d Header: Status %d, erwartet %d", maxHeaderValueCount+10, got, http.StatusRequestHeaderFieldsTooLarge)
	}
	if handlerCalls != 1 {
		t.Errorf("Handler lief %dx — die Flut hätte ihn nie erreichen dürfen", handlerCalls)
	}
}
