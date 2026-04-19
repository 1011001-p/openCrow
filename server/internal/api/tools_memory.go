// tools_memory.go — Memory store, forget, learn, read, reinforce, and promote tools.
package api

import (
	"context"
	"fmt"
)

// ── Memory tools ─────────────────────────────────────────────────────────

func (s *Server) toolStoreMemory(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	content, _ := args["content"].(string)
	category, _ := args["category"].(string)
	if content == "" {
		return map[string]any{"success": false, "error": "content is required"}, nil
	}
	if category == "" {
		category = "general"
	}

	mem, err := s.createMemory(ctx, userID, category, content, 1)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to store memory: %v", err)}, nil
	}

	return map[string]any{
		"success":   true,
		"memory_id": mem.ID,
		"category":  mem.Category,
		"content":   mem.Content,
		"message":   "Memory stored successfully",
	}, nil
}

func (s *Server) toolForgetMemory(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	memoryID, _ := args["memoryId"].(string)
	if memoryID == "" {
		return map[string]any{"success": false, "error": "memoryId is required"}, nil
	}

	deleted, err := s.deleteMemory(ctx, userID, memoryID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to forget memory: %v", err)}, nil
	}
	if !deleted {
		return map[string]any{"success": false, "error": "memory not found"}, nil
	}

	return map[string]any{"success": true, "message": "Memory forgotten"}, nil
}

func (s *Server) toolLearnMemory(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	content, _ := args["content"].(string)
	if content == "" {
		return map[string]any{"success": false, "error": "content is required"}, nil
	}

	mem, err := s.createMemory(ctx, userID, "LEARNING", content, 1)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to learn: %v", err)}, nil
	}

	return map[string]any{
		"success":   true,
		"memory_id": mem.ID,
		"category":  "LEARNING",
		"message":   "Learning stored successfully",
	}, nil
}

func (s *Server) toolReadMemory(ctx context.Context, userID string) (map[string]any, error) {
	memories, err := s.listMemories(ctx, userID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to read memories: %v", err)}, nil
	}
	entries := make([]map[string]any, 0, len(memories))
	for _, m := range memories {
		entries = append(entries, map[string]any{
			"id":         m.ID,
			"category":   m.Category,
			"content":    m.Content,
			"confidence": m.Confidence,
		})
	}
	return map[string]any{
		"success":  true,
		"count":    len(entries),
		"memories": entries,
	}, nil
}

func (s *Server) toolReinforceMemory(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	memoryID, _ := args["memoryId"].(string)
	if memoryID == "" {
		return map[string]any{"success": false, "error": "memoryId is required"}, nil
	}

	mem, err := s.reinforceMemory(ctx, userID, memoryID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to reinforce: %v", err)}, nil
	}

	return map[string]any{
		"success":    true,
		"memory_id":  mem.ID,
		"confidence": mem.Confidence,
		"message":    "Memory reinforced",
	}, nil
}

func (s *Server) toolPromoteLearning(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	memoryID, _ := args["memoryId"].(string)
	if memoryID == "" {
		return map[string]any{"success": false, "error": "memoryId is required"}, nil
	}

	mem, err := s.promoteMemory(ctx, userID, memoryID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to promote: %v", err)}, nil
	}

	return map[string]any{
		"success":   true,
		"memory_id": mem.ID,
		"category":  mem.Category,
		"message":   "Learning promoted to preferred behavior",
	}, nil
}
