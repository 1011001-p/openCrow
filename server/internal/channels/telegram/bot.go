// Package telegram implements the channels.Notifier interface for Telegram bots.
// Future channel adapters (Signal, WhatsApp, etc.) will follow this same pattern.
package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Bot sends notifications via a Telegram bot token to a fixed chat ID.
type Bot struct {
	label              string
	botToken           string
	notificationChatID int64
}

// New creates a Telegram Bot notifier.
// notificationChatID must be a valid Telegram chat ID (can be negative for groups).
func New(label, botToken string, notificationChatID int64) *Bot {
	return &Bot{label: label, botToken: botToken, notificationChatID: notificationChatID}
}

func (b *Bot) Name() string { return "telegram:" + b.label }

// SendNotification sends a Markdown-formatted message to the bot's notification chat.
func (b *Bot) SendNotification(ctx context.Context, title, body string) error {
	text := fmt.Sprintf("🔔 *%s*\n%s", title, body)
	return b.Send(ctx, text)
}

// Send delivers raw text to the notification chat.
func (b *Bot) Send(ctx context.Context, text string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", b.botToken)
	payload := map[string]any{
		"chat_id": b.notificationChatID,
		"text":    text,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("telegram sendMessage HTTP %d", resp.StatusCode)
	}
	return nil
}
