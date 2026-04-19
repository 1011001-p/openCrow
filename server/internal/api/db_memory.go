// db_memory.go — User memory CRUD persistence.
package api

import (
	"context"
	"time"
)

func (s *Server) listMemories(ctx context.Context, userID string) ([]MemoryDTO, error) {
	const q = `
SELECT id::text, category, content, confidence, created_at, updated_at
FROM user_memories
WHERE user_id = $1::uuid
ORDER BY confidence DESC, updated_at DESC;
`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []MemoryDTO
	for rows.Next() {
		var item MemoryDTO
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.Category, &item.Content, &item.Confidence, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Server) createMemory(ctx context.Context, userID, category, content string, confidence int) (MemoryDTO, error) {
	const q = `
INSERT INTO user_memories (user_id, category, content, confidence)
VALUES ($1::uuid, $2, $3, $4)
RETURNING id::text, category, content, confidence, created_at, updated_at;
`
	var item MemoryDTO
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(ctx, q, userID, category, content, confidence).Scan(
		&item.ID,
		&item.Category,
		&item.Content,
		&item.Confidence,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return MemoryDTO{}, err
	}
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func (s *Server) deleteMemory(ctx context.Context, userID, memoryID string) (bool, error) {
	const q = `DELETE FROM user_memories WHERE id = $1::uuid AND user_id = $2::uuid;`
	cmd, err := s.db.Exec(ctx, q, memoryID, userID)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (s *Server) reinforceMemory(ctx context.Context, userID, memoryID string) (MemoryDTO, error) {
	const q = `
UPDATE user_memories
SET confidence = confidence + 1, updated_at = NOW()
WHERE id = $1::uuid AND user_id = $2::uuid
RETURNING id::text, category, content, confidence, created_at, updated_at;
`
	var item MemoryDTO
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(ctx, q, memoryID, userID).Scan(
		&item.ID, &item.Category, &item.Content, &item.Confidence, &createdAt, &updatedAt,
	)
	if err != nil {
		return MemoryDTO{}, err
	}
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func (s *Server) promoteMemory(ctx context.Context, userID, memoryID string) (MemoryDTO, error) {
	const q = `
UPDATE user_memories
SET category = 'PROMOTED', updated_at = NOW()
WHERE id = $1::uuid AND user_id = $2::uuid
RETURNING id::text, category, content, confidence, created_at, updated_at;
`
	var item MemoryDTO
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(ctx, q, memoryID, userID).Scan(
		&item.ID, &item.Category, &item.Content, &item.Confidence, &createdAt, &updatedAt,
	)
	if err != nil {
		return MemoryDTO{}, err
	}
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}
