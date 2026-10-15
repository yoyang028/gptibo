// quefa-mock is an explicitly local development fixture, never a real supplier.
package main

import (
	"log"
	"os"

	"gptibo/storefront/internal/quefamock"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: quefa-mock init|serve|serve-cloudflare <absolute D-drive data directory>")
	}
	var err error
	switch os.Args[1] {
	case "init":
		err = quefamock.Init(os.Args[2])
	case "serve":
		err = quefamock.Serve(os.Args[2])
	case "serve-cloudflare":
		err = quefamock.ServeCloudflare(os.Args[2])
	default:
		log.Fatal("unknown local mock command")
	}
	if err != nil {
		log.Fatal(err)
	}
}
