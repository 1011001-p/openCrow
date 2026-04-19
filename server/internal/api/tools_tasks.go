// tools_tasks.go — Task scheduling and cancellation tool implementations.
package api

import (
	"context"
	"fmt"
	"time"
)

// ── Task tools ───────────────────────────────────────────────────────────

func (s *Server) toolListTasks(ctx context.Context, userID string) (map[string]any, error) {
	tasks, err := s.listTasks(ctx, userID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to list tasks: %v", err)}, nil
	}

	return map[string]any{
		"success": true,
		"count":   len(tasks),
		"tasks":   tasks,
	}, nil
}

func (s *Server) toolScheduleTask(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	prompt, _ := args["prompt"].(string)
	executeAtStr, _ := args["executeAt"].(string)
	description, _ := args["description"].(string)
	if prompt == "" || executeAtStr == "" {
		return map[string]any{"success": false, "error": "prompt and executeAt are required"}, nil
	}
	if description == "" {
		description = prompt
		if len(description) > 100 {
			description = description[:100] + "..."
		}
	}

	executeAt, err := time.Parse(time.RFC3339, executeAtStr)
	if err != nil {
		return map[string]any{"success": false, "error": "executeAt must be RFC3339 format"}, nil
	}

	var cronExpr *string
	if c, ok := args["cronExpression"].(string); ok && c != "" {
		cronExpr = &c
	}

	task, err := s.createTask(ctx, userID, description, prompt, executeAt, cronExpr)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to schedule task: %v", err)}, nil
	}

	return map[string]any{
		"success": true,
		"task_id": task.ID,
		"message": "Task scheduled successfully",
	}, nil
}

func (s *Server) toolCancelTask(ctx context.Context, userID string, args map[string]any) (map[string]any, error) {
	taskID, _ := args["taskId"].(string)
	if taskID == "" {
		return map[string]any{"success": false, "error": "taskId is required"}, nil
	}

	deleted, err := s.deleteTask(ctx, userID, taskID)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("failed to cancel task: %v", err)}, nil
	}
	if !deleted {
		return map[string]any{"success": false, "error": "task not found"}, nil
	}

	return map[string]any{"success": true, "message": "Task cancelled"}, nil
}
