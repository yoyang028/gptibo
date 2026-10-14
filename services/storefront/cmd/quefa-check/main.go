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
	directory := flag.String("directory", "", "absolute D-drive directory for encrypted credentials and endpoint.json")
	flag.Parse()
	data, err := os.ReadFile(filepath.Join(*directory, "endpoint.json"))
	if err != nil {
		log.Fatal("Missing endpoint.json; see docs/QUEFA_LOCAL.md.")
	}
	var endpoint struct {
		Base string `json:"api_base"`
	}
	if json.Unmarshal(data, &endpoint) != nil {
		log.Fatal("Invalid endpoint.json.")
	}
	const address = "127.0.0.1:8767"
	handler, err := quefacheck.NewServer(endpoint.Base, *directory, "http://"+address)
	if err != nil {
		log.Fatal("Could not prepare the local read-only check: ", err)
	}
	server := http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 30 * time.Second}
	controlListener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatal("Cannot bind loopback control listener: ", err)
	}
	const receiverAddress = "127.0.0.1:8768"
	receiverListener, err := net.Listen("tcp", receiverAddress)
	if err != nil {
		_ = controlListener.Close()
		log.Fatal("Cannot bind loopback test receiver: ", err)
	}
	receiver := http.Server{Addr: receiverAddress, Handler: handler.WebhookTestHandler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	go func() { log.Fatal(receiver.Serve(receiverListener)) }()
	log.Print("Local read-only credential check: http://", address)
	log.Print("Local webhook.test receiver only: http://", receiverAddress, "/api/recharge/webhook")
	log.Fatal(server.Serve(controlListener))
}
