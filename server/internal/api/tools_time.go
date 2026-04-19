// tools_time.go — Time, location, and timezone tool implementations.
package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"encoding/json"

	"github.com/opencrow/opencrow/server/internal/configstore"
)

// ── get_local_time ───────────────────────────────────────────────────────

var fixedOffsetTimezonePattern = regexp.MustCompile(`^(?i:(?:gmt|utc))\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$`)

func loadLocationIfValid(tz string) (*time.Location, bool) {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		return nil, false
	}
	if loc, ok := loadFixedOffsetLocation(tz); ok {
		return loc, true
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, false
	}
	return loc, true
}

func loadFixedOffsetLocation(tz string) (*time.Location, bool) {
	m := fixedOffsetTimezonePattern.FindStringSubmatch(strings.TrimSpace(tz))
	if m == nil {
		return nil, false
	}
	hours, err := strconv.Atoi(m[2])
	if err != nil || hours > 23 {
		return nil, false
	}
	minutes := 0
	if m[3] != "" {
		minutes, err = strconv.Atoi(m[3])
		if err != nil || minutes > 59 {
			return nil, false
		}
	}
	offset := hours*3600 + minutes*60
	if strings.TrimSpace(m[1]) == "-" {
		offset = -offset
	}
	name := fmt.Sprintf("UTC%s%02d:%02d", m[1], hours, minutes)
	return time.FixedZone(name, offset), true
}

func preferredTimezoneName(ctx context.Context, cfg *configstore.UserConfig, requestedTZ string) string {
	if _, ok := loadLocationIfValid(requestedTZ); ok {
		return strings.TrimSpace(requestedTZ)
	}
	if clientTZ := clientTimezoneFromContext(ctx); clientTZ != "" {
		if _, ok := loadLocationIfValid(clientTZ); ok {
			return clientTZ
		}
	}
	configuredTZ := ""
	if cfg != nil {
		configuredTZ = strings.TrimSpace(cfg.Heartbeat.ActiveHours.TZ)
		if configuredTZ != "" && !strings.EqualFold(configuredTZ, "UTC") {
			if _, ok := loadLocationIfValid(configuredTZ); ok {
				return configuredTZ
			}
		}
	}
	if envTZ := strings.TrimSpace(os.Getenv("TZ")); envTZ != "" {
		if _, ok := loadLocationIfValid(envTZ); ok {
			return envTZ
		}
	}
	if localName := strings.TrimSpace(time.Local.String()); localName != "" && localName != "Local" {
		if _, ok := loadLocationIfValid(localName); ok {
			return localName
		}
	}
	if configuredTZ != "" {
		if _, ok := loadLocationIfValid(configuredTZ); ok {
			return configuredTZ
		}
	}
	return "UTC"
}

func preferredLocation(ctx context.Context, cfg *configstore.UserConfig, requestedTZ string) *time.Location {
	if loc, ok := loadLocationIfValid(preferredTimezoneName(ctx, cfg, requestedTZ)); ok {
		return loc
	}
	return time.UTC
}

func (s *Server) toolGetLocalTime(ctx context.Context, userID string, args map[string]any) map[string]any {
	var cfg *configstore.UserConfig
	if s != nil && s.configStore != nil && userID != "" {
		if c, err := s.configStore.GetUserConfig(userID); err == nil {
			cfg = &c
		}
	}
	requestedTZ, _ := args["timezone"].(string)
	loc := preferredLocation(ctx, cfg, requestedTZ)
	now := time.Now().In(loc)
	return map[string]any{
		"success":          true,
		"iso_datetime":     now.Format(time.RFC3339),
		"display_datetime": now.Format("Monday, January 2, 2006 at 3:04 PM"),
		"timezone":         loc.String(),
		"day_of_week":      now.Weekday().String(),
	}
}

// ── get_location ─────────────────────────────────────────────────────────

func (s *Server) toolGetLocation(ctx context.Context) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://ipwho.is/", nil)
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}, nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("request failed: %v", err)}, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if err != nil {
		return map[string]any{"success": false, "error": "failed to read response"}, nil
	}

	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return map[string]any{"success": false, "error": "failed to parse response"}, nil
	}

	return result, nil
}
