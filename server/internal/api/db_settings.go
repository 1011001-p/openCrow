// db_settings.go — User settings, MCP config, and heartbeat config persistence.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/opencrow/opencrow/server/internal/configstore"
)

func (s *Server) getSettings(ctx context.Context, userID string) (UserSettingsDTO, error) {
	const q = `
SELECT COALESCE(data, '{}'::jsonb), updated_at
FROM user_settings
WHERE user_id = $1::uuid;
`

	var raw []byte
	var updatedAt time.Time
	err := s.db.QueryRow(ctx, q, userID).Scan(&raw, &updatedAt)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return UserSettingsDTO{}, err
		}
		return UserSettingsDTO{UserID: userID, Settings: map[string]any{}, UpdatedAt: ""}, nil
	}

	settings := map[string]any{}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return UserSettingsDTO{}, err
	}

	return UserSettingsDTO{
		UserID:    userID,
		Settings:  settings,
		UpdatedAt: updatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) putSettings(ctx context.Context, userID string, settings map[string]any) (UserSettingsDTO, error) {
	raw, err := json.Marshal(settings)
	if err != nil {
		return UserSettingsDTO{}, err
	}

	const q = `
INSERT INTO user_settings (user_id, data, updated_at)
VALUES ($1::uuid, $2::jsonb, NOW())
ON CONFLICT (user_id)
DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
RETURNING updated_at;
`

	var updatedAt time.Time
	if err := s.db.QueryRow(ctx, q, userID, string(raw)).Scan(&updatedAt); err != nil {
		return UserSettingsDTO{}, err
	}

	return UserSettingsDTO{
		UserID:    userID,
		Settings:  settings,
		UpdatedAt: updatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) getMCPServersSetting(ctx context.Context, userID string) ([]configstore.MCPServerConfig, bool, error) {
	settingsDTO, err := s.getSettings(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if settingsDTO.Settings == nil {
		return []configstore.MCPServerConfig{}, false, nil
	}
	rawMCP, ok := settingsDTO.Settings["mcp"]
	if !ok {
		return []configstore.MCPServerConfig{}, false, nil
	}
	b, err := json.Marshal(rawMCP)
	if err != nil {
		return nil, true, err
	}
	var payload struct {
		Servers []configstore.MCPServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(b, &payload); err != nil {
		return nil, true, err
	}
	if payload.Servers == nil {
		payload.Servers = []configstore.MCPServerConfig{}
	}
	return payload.Servers, true, nil
}

func (s *Server) putMCPServersSetting(ctx context.Context, userID string, servers []configstore.MCPServerConfig) error {
	settingsDTO, err := s.getSettings(ctx, userID)
	if err != nil {
		return err
	}
	settings := settingsDTO.Settings
	if settings == nil {
		settings = map[string]any{}
	}
	if servers == nil {
		servers = []configstore.MCPServerConfig{}
	}
	settings["mcp"] = map[string]any{
		"servers": servers,
	}
	_, err = s.putSettings(ctx, userID, settings)
	return err
}

func (s *Server) getHeartbeatConfig(ctx context.Context, userID string) (HeartbeatConfigDTO, error) {
	const q = `
SELECT enabled, interval_seconds, next_run_at, updated_at
FROM user_heartbeat_configs
WHERE user_id = $1::uuid;
`

	var enabled bool
	var intervalSeconds int
	var nextRunAt *time.Time
	var updatedAt time.Time
	err := s.db.QueryRow(ctx, q, userID).Scan(&enabled, &intervalSeconds, &nextRunAt, &updatedAt)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return HeartbeatConfigDTO{}, err
		}
		return HeartbeatConfigDTO{
			UserID:          userID,
			Enabled:         false,
			IntervalSeconds: 300,
		}, nil
	}

	dto := HeartbeatConfigDTO{
		UserID:          userID,
		Enabled:         enabled,
		IntervalSeconds: intervalSeconds,
		UpdatedAt:       updatedAt.UTC().Format(time.RFC3339),
	}
	if nextRunAt != nil {
		dto.NextRunAt = nextRunAt.UTC().Format(time.RFC3339)
	}
	return dto, nil
}

func (s *Server) putHeartbeatConfig(ctx context.Context, userID string, req UpdateHeartbeatConfigRequest) (HeartbeatConfigDTO, error) {
	current, err := s.getHeartbeatConfig(ctx, userID)
	if err != nil {
		return HeartbeatConfigDTO{}, err
	}

	enabled := current.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	interval := current.IntervalSeconds
	if req.IntervalSeconds != nil {
		interval = *req.IntervalSeconds
	}
	if interval <= 0 {
		interval = 300
	}

	nextRun := time.Now().UTC().Add(time.Duration(interval) * time.Second)
	const q = `
INSERT INTO user_heartbeat_configs (user_id, enabled, interval_seconds, next_run_at, updated_at)
VALUES ($1::uuid, $2, $3, $4, NOW())
ON CONFLICT (user_id)
DO UPDATE SET enabled = EXCLUDED.enabled,
              interval_seconds = EXCLUDED.interval_seconds,
              next_run_at = CASE
                -- Reset timer when: interval changed, or heartbeat just became enabled
                WHEN user_heartbeat_configs.interval_seconds != EXCLUDED.interval_seconds
                  OR (user_heartbeat_configs.enabled = FALSE AND EXCLUDED.enabled = TRUE)
                THEN EXCLUDED.next_run_at
                -- Otherwise keep the existing scheduled time (don't push it into the future)
                ELSE user_heartbeat_configs.next_run_at
              END,
              updated_at = NOW()
RETURNING updated_at;
`

	var updatedAt time.Time
	if err := s.db.QueryRow(ctx, q, userID, enabled, interval, nextRun).Scan(&updatedAt); err != nil {
		return HeartbeatConfigDTO{}, err
	}

	return HeartbeatConfigDTO{
		UserID:          userID,
		Enabled:         enabled,
		IntervalSeconds: interval,
		NextRunAt:       nextRun.UTC().Format(time.RFC3339),
		UpdatedAt:       updatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) createHeartbeatEvent(ctx context.Context, userID, status, message string) (HeartbeatEventDTO, error) {
	const q = `
INSERT INTO heartbeat_events (user_id, status, message)
VALUES ($1::uuid, $2, $3)
RETURNING id::text, status, COALESCE(message, ''), created_at;
`
	var dto HeartbeatEventDTO
	var createdAt time.Time
	if err := s.db.QueryRow(ctx, q, userID, status, message).Scan(&dto.ID, &dto.Status, &dto.Message, &createdAt); err != nil {
		return HeartbeatEventDTO{}, err
	}
	dto.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return dto, nil
}

func (s *Server) listHeartbeatEvents(ctx context.Context, userID string) ([]HeartbeatEventDTO, error) {
	const q = `
SELECT id::text, status, COALESCE(message, ''), created_at
FROM heartbeat_events
WHERE user_id = $1::uuid
ORDER BY created_at DESC
LIMIT 100;
`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []HeartbeatEventDTO
	for rows.Next() {
		var dto HeartbeatEventDTO
		var createdAt time.Time
		if err := rows.Scan(&dto.ID, &dto.Status, &dto.Message, &createdAt); err != nil {
			return nil, err
		}
		dto.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		result = append(result, dto)
	}
	return result, rows.Err()
}
