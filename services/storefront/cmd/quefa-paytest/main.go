package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"gptibo/storefront/internal/quefacheck"
)

func main() {
	credentials := flag.String("credentials-directory", "", "absolute D-drive directory with existing encrypted credentials")
	directory := flag.String("directory", "", "absolute D-drive directory for the single payment test")
	authorized := flag.Bool("authorized-one-cny", false, "explicit user authorization for exactly one one-CNY test")
	flag.Parse()
	if !*authorized {
		log.Fatal("Explicit one-CNY payment-test authorization is required.")
	}
	data, err := os.ReadFile(filepath.Join(*credentials, "endpoint.json"))
	if err != nil {
		log.Fatal("Missing saved supplier endpoint.")
	}
	var endpoint struct {
		Base string `json:"api_base"`
	}
	if json.Unmarshal(data, &endpoint) != nil {
		log.Fatal("Invalid supplier endpoint.")
	}
	const control = "127.0.0.1:8769"
	handler, err := quefacheck.NewPaymentTestServer(endpoint.Base, *credentials, *directory, "http://"+control)
	if err != nil {
		log.Fatal("Cannot prepare the single one-CNY test: ", err)
	}
	local, err := net.Listen("tcp", control)
	if err != nil {
		log.Fatal(err)
	}
	const ingress = "127.0.0.1:8770"
	public, err := net.Listen("tcp", ingress)
	if err != nil {
		_ = local.Close()
		log.Fatal(err)
	}
	callback := http.Server{Handler: handler.WebhookHandler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	go func() { log.Fatal(callback.Serve(public)) }()
	server := http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192}
	log.Print("One-CNY payment test page: http://", control)
	log.Print("Bound-order notification receiver only: http://", ingress, "/api/recharge/webhook")
	log.Fatal(server.Serve(local))
}
