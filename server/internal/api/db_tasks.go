// db_tasks.go — Scheduled task persistence and stuck-task recovery.
package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) listTasks(ctx context.Context, userID string) ([]TaskDTO, error) {
	const q = `
SELECT id::text, description, prompt, execute_at, cron_expression, status, last_result, consecutive_failures, created_at, updated_at
FROM scheduled_tasks
WHERE user_id = $1::uuid
ORDER BY execute_at ASC;
`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TaskDTO
	for rows.Next() {
		item, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// recoverStuckTasks resets any tasks left in RUNNING state (from a previous crashed/restarted server)
// back to PENDING so they will be retried by the task worker.
func (s *Server) recoverStuckTasks(ctx context.Context) error {
	const q = `
UPDATE scheduled_tasks
SET status = 'PENDING', updated_at = NOW()
WHERE status = 'RUNNING';
`
	cmd, err := s.db.Exec(ctx, q)
	if err != nil {
		return fmt.Errorf("recover stuck tasks: %w", err)
	}
	if cmd.RowsAffected() > 0 {
		log.Printf("[task-worker] recovered %d stuck RUNNING task(s) to PENDING on startup", cmd.RowsAffected())
	}
	return nil
}

func (s *Server) createTask(ctx context.Context, userID, description, prompt string, executeAt time.Time, cronExpression *string) (TaskDTO, error) {
	const q = `
INSERT INTO scheduled_tasks (user_id, description, prompt, execute_at, cron_expression, status)
VALUES ($1::uuid, $2, $3, $4, $5, 'PENDING')
RETURNING id::text, description, prompt, execute_at, cron_expression, status, last_result, consecutive_failures, created_at, updated_at;
`
	row := s.db.QueryRow(ctx, q, userID, description, prompt, executeAt.UTC(), cronExpression)
	return scanTaskRow(row)
}

func (s *Server) deleteTask(ctx context.Context, userID, taskID string) (bool, error) {
	const q = `DELETE FROM scheduled_tasks WHERE id = $1::uuid AND user_id = $2::uuid;`
	cmd, err := s.db.Exec(ctx, q, taskID, userID)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (s *Server) getTask(ctx context.Context, userID, taskID string) (TaskDTO, error) {
	const q = `
SELECT id::text, description, prompt, execute_at, cron_expression, status, last_result, consecutive_failures, created_at, updated_at
FROM scheduled_tasks
WHERE id = $1::uuid AND user_id = $2::uuid;
`
	return scanTaskRow(s.db.QueryRow(ctx, q, taskID, userID))
}

func (s *Server) updateTask(ctx context.Context, userID, taskID string, req UpdateTaskRequest) (TaskDTO, error) {
	current, err := s.getTask(ctx, userID, taskID)
	if err != nil {
		return TaskDTO{}, err
	}

	description := current.Description
	if req.Description != nil {
		description = strings.TrimSpace(*req.Description)
	}

	prompt := current.Prompt
	if req.Prompt != nil {
		prompt = strings.TrimSpace(*req.Prompt)
	}

	executeAt := current.ExecuteAt
	if req.ExecuteAt != nil {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*req.ExecuteAt))
		if err != nil {
			return TaskDTO{}, errors.New("executeAt must be RFC3339")
		}
		executeAt = parsed.UTC().Format(time.RFC3339)
	}

	status := current.Status
	if req.Status != nil {
		status = strings.TrimSpace(strings.ToUpper(*req.Status))
	}

	var cronExpression *string
	if req.CronExpression != nil {
		trimmed := strings.TrimSpace(*req.CronExpression)
		if trimmed != "" {
			cronExpression = &trimmed
		}
	} else {
		cronExpression = current.CronExpression
	}

	execAtTime, err := time.Parse(time.RFC3339, executeAt)
	if err != nil {
		return TaskDTO{}, err
	}

	const q = `
UPDATE scheduled_tasks
SET description = $3,
    prompt = $4,
    execute_at = $5,
    cron_expression = $6,
    status = $7,
    updated_at = NOW()
WHERE id = $1::uuid AND user_id = $2::uuid
RETURNING id::text, description, prompt, execute_at, cron_expression, status, last_result, consecutive_failures, created_at, updated_at;
`
	return scanTaskRow(s.db.QueryRow(ctx, q, taskID, userID, description, prompt, execAtTime.UTC(), cronExpression, status))
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTask(row scanner) (TaskDTO, error) {
	var item TaskDTO
	var executeAt, createdAt, updatedAt time.Time
	err := row.Scan(
		&item.ID,
		&item.Description,
		&item.Prompt,
		&executeAt,
		&item.CronExpression,
		&item.Status,
		&item.LastResult,
		&item.ConsecutiveFailures,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return TaskDTO{}, err
	}
	item.ExecuteAt = executeAt.UTC().Format(time.RFC3339)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func scanTaskRow(row pgx.Row) (TaskDTO, error) {
	return scanTask(row)
}
