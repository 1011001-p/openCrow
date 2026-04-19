package orchestrator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	einoclaude "github.com/cloudwego/eino-ext/components/model/claude"
	einodeepseek "github.com/cloudwego/eino-ext/components/model/deepseek"
	einoopenai "github.com/cloudwego/eino-ext/components/model/openai"
	einoollama "github.com/cloudwego/eino-ext/components/model/ollama"
	einomodel "github.com/cloudwego/eino/components/model"
)

// ── Shared chat types ─────────────────────────────────────────────────────────

// MessageAttachment holds a file attached to a user message.
type MessageAttachment struct {
	FileName string `json:"fileName"`
	MimeType string `json:"mimeType"`
	DataURL  string `json:"dataUrl"`
}

// ChatMessage is a single message in a conversation.
type ChatMessage struct {
	Role        string              `json:"role"`
	Content     string              `json:"content,omitempty"`
	ToolCallID  string              `json:"tool_call_id,omitempty"`
	ToolCalls   []ToolCall          `json:"tool_calls,omitempty"`
	Attachments []MessageAttachment `json:"attachments,omitempty"`
}

// ToolSpec describes a callable tool for function-calling APIs.
type ToolSpec struct {
	Name        string
	Description string
	Parameters  map[string]any // JSON Schema object
}

// TokenUsage holds token counts from a single LLM response.
type TokenUsage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
}

func (u *TokenUsage) Add(other TokenUsage) {
	u.PromptTokens += other.PromptTokens
	u.CompletionTokens += other.CompletionTokens
	u.TotalTokens += other.TotalTokens
}

func (u TokenUsage) IsZero() bool {
	return u.PromptTokens == 0 && u.CompletionTokens == 0 && u.TotalTokens == 0
}

// Provider can complete a chat conversation, optionally using tools.
type Provider interface {
	Name() string
	Chat(ctx context.Context, system string, messages []ChatMessage, tools []ToolSpec) (string, []ToolCall, TokenUsage, error)
}

// StreamingProvider extends Provider with token-by-token streaming.
type StreamingProvider interface {
	Provider
	ChatStream(ctx context.Context, system string, messages []ChatMessage, tools []ToolSpec, onToken func(token string)) (string, []ToolCall, error)
}

// ── EinoProvider ─────────────────────────────────────────────────────────────

// EinoProvider wraps any eino ToolCallingChatModel behind our Provider interface.
// All concrete eino-ext provider types implement ToolCallingChatModel.
type EinoProvider struct {
	name  string
	model einomodel.ToolCallingChatModel
}

func (p *EinoProvider) Name() string { return p.name }

func (p *EinoProvider) Chat(ctx context.Context, system string, messages []ChatMessage, tools []ToolSpec) (string, []ToolCall, TokenUsage, error) {
	einoMsgs := toEinoMessages(system, messages)
	m, err := bindTools(p.model, tools)
	if err != nil {
		return "", nil, TokenUsage{}, fmt.Errorf("bind tools: %w", err)
	}
	resp, err := m.Generate(ctx, einoMsgs)
	if err != nil {
		return "", nil, TokenUsage{}, err
	}
	text, calls, usage := fromEinoResponse(resp)
	return text, calls, usage, nil
}

// ChatStream implements StreamingProvider — all eino models support streaming.
func (p *EinoProvider) ChatStream(ctx context.Context, system string, messages []ChatMessage, tools []ToolSpec, onToken func(string)) (string, []ToolCall, error) {
	einoMsgs := toEinoMessages(system, messages)
	m, err := bindTools(p.model, tools)
	if err != nil {
		return "", nil, fmt.Errorf("bind tools: %w", err)
	}
	reader, err := m.Stream(ctx, einoMsgs)
	if err != nil {
		return "", nil, err
	}
	return drainStream(reader, onToken)
}

// ── Factory ───────────────────────────────────────────────────────────────────

// BuildProvider creates a Provider from configstore fields.
// Returns (nil, nil) for unrecognised kinds so callers can skip them gracefully.
func BuildProvider(ctx context.Context, name, kind, baseURL, apiKey, model string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(kind)) {

	case "openai", "custom":
		m, err := einoopenai.NewChatModel(ctx, &einoopenai.ChatModelConfig{
			APIKey:  apiKey,
			BaseURL: ensureV1BaseURL(baseURL),
			Model:   orDefault(model, "gpt-4o-mini"),
		})
		if err != nil {
			return nil, fmt.Errorf("openai: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil

	case "litellm":
		if baseURL == "" {
			baseURL = "http://localhost:4000"
		}
		m, err := einoopenai.NewChatModel(ctx, &einoopenai.ChatModelConfig{
			APIKey:  apiKey,
			BaseURL: ensureV1BaseURL(baseURL),
			Model:   orDefault(model, "gpt-4o-mini"),
		})
		if err != nil {
			return nil, fmt.Errorf("litellm: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil

	case "openrouter":
		if baseURL == "" {
			baseURL = "https://openrouter.ai/api"
		}
		m, err := einoopenai.NewChatModel(ctx, &einoopenai.ChatModelConfig{
			APIKey:  apiKey,
			BaseURL: ensureV1BaseURL(baseURL),
			Model:   orDefault(model, "openai/gpt-4o-mini"),
		})
		if err != nil {
			return nil, fmt.Errorf("openrouter: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil

	case "anthropic":
		var claudeBaseURL *string
		if baseURL != "" {
			claudeBaseURL = &baseURL
		}
		m, err := einoclaude.NewChatModel(ctx, &einoclaude.Config{
			APIKey:    apiKey,
			Model:     orDefault(model, "claude-3-5-haiku-20241022"),
			MaxTokens: 4096,
			BaseURL:   claudeBaseURL,
		})
		if err != nil {
			return nil, fmt.Errorf("anthropic: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil

	case "ollama":
		if baseURL == "" {
			baseURL = "http://localhost:11434"
		}
		m, err := einoollama.NewChatModel(ctx, &einoollama.ChatModelConfig{
			BaseURL: baseURL,
			Model:   orDefault(model, "llama3.2"),
		})
		if err != nil {
			return nil, fmt.Errorf("ollama: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil

	case "deepseek":
		m, err := einodeepseek.NewChatModel(ctx, &einodeepseek.ChatModelConfig{
			APIKey: apiKey,
			Model:  orDefault(model, "deepseek-chat"),
		})
		if err != nil {
			return nil, fmt.Errorf("deepseek: %w", err)
		}
		return &EinoProvider{name: name, model: m}, nil
	}

	return nil, nil
}

// ensureV1BaseURL appends /v1 to a base URL if not already present.
// eino's openai client expects the base URL to include /v1.
func ensureV1BaseURL(baseURL string) string {
	if baseURL == "" {
		return ""
	}
	trimmed := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(trimmed, "/v1") {
		return trimmed
	}
	return trimmed + "/v1"
}

func orDefault(val, def string) string {
	if strings.TrimSpace(val) == "" {
		return def
	}
	return val
}

// ── Argument parsing ──────────────────────────────────────────────────────────

func parseToolCallArguments(raw []byte) (map[string]any, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil, fmt.Errorf("empty tool arguments")
	}
	var args map[string]any
	if err := json.Unmarshal(raw, &args); err == nil {
		if args == nil {
			args = map[string]any{}
		}
		return args, nil
	}
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err == nil {
		encoded = strings.TrimSpace(encoded)
		if encoded == "" {
			return nil, fmt.Errorf("empty string tool arguments")
		}
		if err := json.Unmarshal([]byte(encoded), &args); err != nil {
			return nil, fmt.Errorf("invalid string-encoded tool arguments: %w", err)
		}
		if args == nil {
			args = map[string]any{}
		}
		return args, nil
	}
	return nil, fmt.Errorf("tool arguments were not a JSON object")
}

// ── Stub provider (used in tests) ─────────────────────────────────────────────

type StubProvider struct {
	ProviderName string
}

func (p StubProvider) Name() string { return p.ProviderName }

func (p StubProvider) Chat(ctx context.Context, system string, messages []ChatMessage, tools []ToolSpec) (string, []ToolCall, TokenUsage, error) {
	select {
	case <-ctx.Done():
		return "", nil, TokenUsage{}, ctx.Err()
	case <-time.After(10 * time.Millisecond):
	}
	last := ""
	if len(messages) > 0 {
		last = messages[len(messages)-1].Content
	}
	return "stub: " + truncate(last, 80), nil, TokenUsage{}, nil
}

func truncate(input string, max int) string {
	if len(input) <= max {
		return input
	}
	if max <= 3 {
		return input[:max]
	}
	return input[:max-3] + "..."
}
