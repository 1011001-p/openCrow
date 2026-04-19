// tools_whisper.go — Whisper/STT tool implementation.
package api

import (
	"context"
	"fmt"
	"os"
	"strings"
)

func (s *Server) toolTranscribeAudio(ctx context.Context, args map[string]any) (any, error) {
	filePath, _ := args["path"].(string)
	if filePath == "" {
		return map[string]any{"success": false, "error": "path is required"}, nil
	}

	if s.whisper == nil || !s.whisper.IsReady() {
		return map[string]any{"success": false, "error": "whisper is not available or still initializing"}, nil
	}

	audioData, err := os.ReadFile(filePath)
	if err != nil {
		return map[string]any{"success": false, "error": fmt.Sprintf("could not read file: %s", err)}, nil
	}

	ext := strings.ToLower(filePath)
	var mimeType string
	switch {
	case strings.HasSuffix(ext, ".mp3"):
		mimeType = "audio/mpeg"
	case strings.HasSuffix(ext, ".mp4"), strings.HasSuffix(ext, ".m4v"):
		mimeType = "audio/mp4"
	case strings.HasSuffix(ext, ".m4a"):
		mimeType = "audio/m4a"
	case strings.HasSuffix(ext, ".wav"):
		mimeType = "audio/wav"
	case strings.HasSuffix(ext, ".webm"):
		mimeType = "audio/webm"
	default:
		mimeType = "audio/ogg"
	}

	transcript, err := s.whisper.Transcribe(ctx, audioData, mimeType)
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}, nil
	}

	return map[string]any{
		"success":    true,
		"transcript": transcript,
		"path":       filePath,
		"length":     len(transcript),
	}, nil
}
