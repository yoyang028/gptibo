package recharge

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/url"
	"time"
)

// A private CA is scoped to this one numeric loopback endpoint. System roots,
// environment proxies, redirects and non-loopback destinations are not used.
func (c *Client) UseLoopbackCA(pem []byte) error {
	u, err := url.Parse(c.Base)
	if err != nil || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || u.Port() == "" {
		return errors.New("local mock requires a numeric loopback HTTPS endpoint")
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return errors.New("invalid local mock CA")
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	c.HTTP.Transport = &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != u.Host {
			return nil, errors.New("local mock destination rejected")
		}
		return dialer.DialContext(ctx, network, address)
	}}
	return nil
}
