package mailer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
)

// LocalMailbox retains rendered development emails on disk and never uses a network.
// Configuration permits it only when both the public origin and listener are loopback.
type LocalMailbox struct {
	directory, from, origin string
}

func NewLocalMailbox(directory, from, origin string) (*LocalMailbox, error) {
	if !filepath.IsAbs(directory) {
		return nil, errors.New("local mailbox requires an absolute directory")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return nil, errors.New("invalid local mail sender")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, errors.New("cannot create local mailbox")
	}
	return &LocalMailbox{directory: directory, from: from, origin: origin}, nil
}

func (l *LocalMailbox) SendCode(ctx context.Context, role, to, code, id string) error {
	label, ok := map[string]string{"admin": "admin-login", "partner": "partner-login", "customer": "order-recovery"}[role]
	if !ok {
		return errors.New("unsupported email kind")
	}
	message, err := BrandedTemplate(label, ContextBrand(ctx, l.origin), map[string]string{"VERIFICATION_CODE": code})
	if err != nil {
		return err
	}
	return l.send(ctx, to, message, "storefront-auth/"+id)
}

func (l *LocalMailbox) SendInvitation(ctx context.Context, to, origin, id string) error {
	brand := ContextBrand(ctx, l.origin)
	brand.WorkspaceURL = strings.TrimRight(origin, "/") + "/join"
	message, err := BrandedTemplate("partner-welcome", brand, nil)
	if err != nil {
		return err
	}
	return l.send(ctx, to, message, "storefront-invitation/"+id)
}

func (l *LocalMailbox) send(ctx context.Context, to string, message Message, key string) error {
	body, err := l.Freeze(to, message)
	if err != nil {
		return err
	}
	_, err = l.SendFrozen(ctx, body, key)
	return err
}

func (l *LocalMailbox) Freeze(to string, message Message) (string, error) {
	// Use exactly the same address validation and serialization as the live adapter.
	return (&Resend{from: l.from}).Freeze(to, message)
}

func (l *LocalMailbox) SendFrozen(ctx context.Context, body, key string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	var saved Frozen
	if json.Unmarshal([]byte(body), &saved) != nil || !SameSender(saved.From, l.from) || len(saved.To) != 1 || key == "" {
		return "", errors.New("invalid local mail message")
	}
	if _, err := mail.ParseAddress(saved.To[0]); err != nil {
		return "", errors.New("invalid saved recipient")
	}
	digest := sha256.Sum256([]byte(key))
	id := "local-" + hex.EncodeToString(digest[:])
	filename := filepath.Join(l.directory, id+".json")
	if previous, err := os.ReadFile(filename); err == nil {
		if string(previous) != body {
			return "", errors.New("local mail idempotency conflict")
		}
		return id, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("cannot read local mailbox")
	}
	temporary, err := os.CreateTemp(l.directory, ".mail-*")
	if err != nil {
		return "", errors.New("cannot write local mailbox")
	}
	defer os.Remove(temporary.Name())
	_, writeErr := temporary.WriteString(body)
	closeErr := temporary.Close()
	if writeErr != nil || closeErr != nil {
		return "", errors.New("cannot save local mail")
	}
	// Publish a complete message without overwriting another writer's message.
	if err := os.Link(temporary.Name(), filename); err != nil {
		previous, readErr := os.ReadFile(filename)
		if readErr != nil || string(previous) != body {
			return "", errors.New("cannot publish local mail or idempotency conflict")
		}
	}
	return id, nil
}
