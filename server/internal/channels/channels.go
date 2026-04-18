// Package channels defines the interface for outbound notification channels.
// Each channel (Telegram, Signal, etc.) implements the Notifier interface,
// allowing the orchestrator and workers to fan out notifications without
// being coupled to any specific messaging platform.
package channels

import "context"

// Notifier is the contract every channel must implement.
type Notifier interface {
	// Name returns a human-readable identifier for this channel instance.
	Name() string

	// SendNotification delivers a titled message to the configured recipient.
	SendNotification(ctx context.Context, title, body string) error
}
