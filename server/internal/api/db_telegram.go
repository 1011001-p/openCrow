// db_telegram.go — Telegram conversation lookup and lifecycle.
package api

import (
	"context"
	"fmt"
)

// getOrCreateTelegramConversation returns the conversation ID for a given Telegram
// chat, creating a new conversation in the DB if none exists yet.
// The conversation is looked up by the reserved title "[telegram] <chatID>".
func (s *Server) getOrCreateTelegramConversation(ctx context.Context, userID, chatID string) (string, error) {
	title := "[telegram] " + chatID
	const lookupQ = `
SELECT id::text FROM conversations
WHERE user_id = $1::uuid AND title = $2
ORDER BY created_at DESC
LIMIT 1;
`
	var convID string
	err := s.db.QueryRow(ctx, lookupQ, userID, title).Scan(&convID)
	if err == nil {
		return convID, nil
	}
	// Not found -- create one
	conv, err := s.createConversation(ctx, userID, title)
	if err != nil {
		return "", fmt.Errorf("telegram: create conversation for chat %s: %w", chatID, err)
	}
	return conv.ID, nil
}

// deleteTelegramConversations removes all conversations for a given Telegram chat.
func (s *Server) deleteTelegramConversations(ctx context.Context, userID, chatID string) error {
	title := "[telegram] " + chatID
	const q = `DELETE FROM conversations WHERE user_id = $1::uuid AND title = $2;`
	_, err := s.db.Exec(ctx, q, userID, title)
	return err
}

// newTelegramConversation forcibly creates a fresh conversation for a Telegram chat,
// used when the user sends /new.
func (s *Server) newTelegramConversation(ctx context.Context, userID, chatID string) (string, error) {
	title := "[telegram] " + chatID
	conv, err := s.createConversation(ctx, userID, title)
	if err != nil {
		return "", fmt.Errorf("telegram: create new conversation for chat %s: %w", chatID, err)
	}
	return conv.ID, nil
}
