package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
)

// WhisperManager calls a go-whisper sidecar over HTTP to transcribe audio.
// The sidecar is expected to expose the go-whisper REST API:
//
//	POST /api/whisper/model          - pre-download a model
//	POST /api/whisper/transcribe     - transcribe audio (multipart: audio + model)
type WhisperManager struct {
	endpoint      string // e.g. "http://whisper:8081"
	modelName     string // model ID for transcription, e.g. "ggml-base"
	modelFileName string // filename for download, e.g. "ggml-base.bin"

	mu    sync.RWMutex
	ready bool
}

// NewWhisperManager creates a WhisperManager.
// If endpoint is empty, all operations are no-ops that return clear errors.
func NewWhisperManager(endpoint, modelName string) *WhisperManager {
	if modelName == "" {
		modelName = "ggml-base"
	}
	// Strip .bin to get the model ID (used for transcription)
	modelID := strings.TrimSuffix(modelName, ".bin")
	// go-whisper download endpoint requires the .bin filename
	modelFileName := modelID + ".bin"
	return &WhisperManager{
		endpoint:      strings.TrimRight(endpoint, "/"),
		modelName:     modelID,
		modelFileName: modelFileName,
	}
}

// EnsureReady pings the sidecar and pre-downloads the model.
// If endpoint is empty it logs a warning and marks the manager as not ready.
func (w *WhisperManager) EnsureReady(ctx context.Context) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.endpoint == "" {
		log.Printf("[whisper] WHISPER_ENDPOINT not set - voice transcription disabled")
		return nil
	}

	log.Printf("[whisper] ensuring model %s is available at %s", w.modelFileName, w.endpoint)

	body, _ := json.Marshal(map[string]string{"model": w.modelFileName})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.endpoint+"/api/whisper/model", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("whisper: build model-download request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("whisper: model-download request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("whisper: model-download status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}

	w.ready = true
	log.Printf("[whisper] ready (model=%s, endpoint=%s)", w.modelName, w.endpoint)
	return nil
}

// IsReady reports whether EnsureReady completed successfully.
func (w *WhisperManager) IsReady() bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.ready
}

// Transcribe sends audio bytes to the go-whisper sidecar and returns the transcript.
func (w *WhisperManager) Transcribe(ctx context.Context, audioData []byte, mimeType string) (string, error) {
	w.mu.RLock()
	ready := w.ready
	endpoint := w.endpoint
	modelName := w.modelName // ID (no .bin), used for transcription
	w.mu.RUnlock()

	if endpoint == "" {
		return "", fmt.Errorf("whisper not configured (WHISPER_ENDPOINT is empty)")
	}
	if !ready {
		return "", fmt.Errorf("whisper is still initializing - please try again shortly")
	}

	// Build multipart body: fields "audio" (file) + "model" (string)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	fw, err := mw.CreateFormFile("audio", "voice"+voiceMimeToExt(mimeType))
	if err != nil {
		return "", fmt.Errorf("whisper: create form file: %w", err)
	}
	if _, err = fw.Write(audioData); err != nil {
		return "", fmt.Errorf("whisper: write audio field: %w", err)
	}
	if err = mw.WriteField("model", modelName); err != nil {
		return "", fmt.Errorf("whisper: write model field: %w", err)
	}
	mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/api/whisper/transcribe", &buf)
	if err != nil {
		return "", fmt.Errorf("whisper: build transcribe request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("whisper: transcribe request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("whisper: transcribe status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	// go-whisper returns: {"segments":[{"text":"..."},...], ...}
	var result struct {
		Segments []struct {
			Text string `json:"text"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("whisper: parse response: %w", err)
	}

	parts := make([]string, 0, len(result.Segments))
	for _, seg := range result.Segments {
		if t := strings.TrimSpace(seg.Text); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " "), nil
}

func voiceMimeToExt(mimeType string) string {
	switch mimeType {
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/m4a":
		return ".m4a"
	case "audio/wav":
		return ".wav"
	case "audio/webm":
		return ".webm"
	default:
		return ".ogg"
	}
}
