//go:build !windows

package quefacheck

import "errors"

func protect([]byte, bool) ([]byte, error) {
	return nil, errors.New("local credential storage requires Windows user encryption")
}
