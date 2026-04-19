package orchestrator

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"

	jschema "github.com/eino-contrib/jsonschema"

	einomodel "github.com/cloudwego/eino/components/model"
	einoschema "github.com/cloudwego/eino/schema"
)

// toEinoMessages converts our message slice + system prompt to eino schema messages.
func toEinoMessages(system string, msgs []ChatMessage) []*einoschema.Message {
	out := make([]*einoschema.Message, 0, len(msgs)+1)
	if system != "" {
		out = append(out, &einoschema.Message{
			Role:    einoschema.System,
			Content: system,
		})
	}
	for _, m := range msgs {
		if em := toEinoMessage(m); em != nil {
			out = append(out, em)
		}
	}
	return out
}

func toEinoMessage(m ChatMessage) *einoschema.Message {
	switch m.Role {
	case "user":
		em := &einoschema.Message{Role: einoschema.User}
		var parts []einoschema.MessageInputPart
		if parsed := parseUserContent(m.Content); len(parsed) > 0 {
			parts = parsed
		} else if m.Content != "" {
			parts = append(parts, einoschema.MessageInputPart{
				Type: einoschema.ChatMessagePartTypeText,
				Text: m.Content,
			})
		}
		for _, a := range m.Attachments {
			parts = append(parts, attachmentToInputPart(a))
		}
		if len(parts) > 0 {
			em.UserInputMultiContent = parts
		} else {
			em.Content = m.Content
		}
		return em
	case "assistant":
		em := &einoschema.Message{Role: einoschema.Assistant, Content: m.Content}
		if len(m.ToolCalls) > 0 {
			em.ToolCalls = toEinoToolCalls(m.ToolCalls)
		}
		return em
	case "tool":
		return &einoschema.Message{
			Role:       einoschema.Tool,
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
		}
	case "system":
		return &einoschema.Message{Role: einoschema.System, Content: m.Content}
	}
	return nil
}

func toEinoToolCalls(calls []ToolCall) []einoschema.ToolCall {
	out := make([]einoschema.ToolCall, len(calls))
	for i, tc := range calls {
		argsJSON, _ := json.Marshal(tc.Arguments)
		if string(argsJSON) == "null" {
			argsJSON = []byte("{}")
		}
		out[i] = einoschema.ToolCall{
			ID:   tc.ID,
			Type: "function",
			Function: einoschema.FunctionCall{
				Name:      tc.Name,
				Arguments: string(argsJSON),
			},
		}
	}
	return out
}

// toEinoTools converts ToolSpec slice to eino ToolInfo slice.
// The Parameters map is expected to be a JSON Schema object with at minimum a
// "properties" key. "type":"object" is injected if absent.
func toEinoTools(specs []ToolSpec) []*einoschema.ToolInfo {
	if len(specs) == 0 {
		return nil
	}
	out := make([]*einoschema.ToolInfo, 0, len(specs))
	for _, s := range specs {
		info := &einoschema.ToolInfo{
			Name: s.Name,
			Desc: s.Description,
		}
		params := s.Parameters
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		} else if _, ok := params["type"]; !ok {
			clone := make(map[string]any, len(params)+1)
			for k, v := range params {
				clone[k] = v
			}
			clone["type"] = "object"
			params = clone
		}
		if jsonBytes, err := json.Marshal(params); err == nil {
			var js jschema.Schema
			if err := json.Unmarshal(jsonBytes, &js); err == nil {
				info.ParamsOneOf = einoschema.NewParamsOneOfByJSONSchema(&js)
			}
		}
		out = append(out, info)
	}
	return out
}

// bindTools calls WithTools on the model when tools are non-empty.
func bindTools(m einomodel.ToolCallingChatModel, tools []ToolSpec) (einomodel.ToolCallingChatModel, error) {
	einoTools := toEinoTools(tools)
	if len(einoTools) == 0 {
		return m, nil
	}
	return m.WithTools(einoTools)
}

// fromEinoResponse extracts text, tool calls, and usage from an eino response message.
func fromEinoResponse(msg *einoschema.Message) (string, []ToolCall, TokenUsage) {
	if msg == nil {
		return "", nil, TokenUsage{}
	}
	var toolCalls []ToolCall
	if len(msg.ToolCalls) > 0 {
		toolCalls = make([]ToolCall, 0, len(msg.ToolCalls))
		for _, tc := range msg.ToolCalls {
			args, err := parseToolCallArguments([]byte(tc.Function.Arguments))
			if err != nil {
				args = map[string]any{}
			}
			toolCalls = append(toolCalls, ToolCall{
				ID:        tc.ID,
				Name:      tc.Function.Name,
				Arguments: args,
				Status:    "pending",
			})
		}
	}
	return msg.Content, toolCalls, extractUsage(msg)
}

func extractUsage(msg *einoschema.Message) TokenUsage {
	if msg == nil || msg.ResponseMeta == nil || msg.ResponseMeta.Usage == nil {
		return TokenUsage{}
	}
	u := msg.ResponseMeta.Usage
	return TokenUsage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

// drainStream reads an eino StreamReader, emitting text tokens via onToken and
// accumulating tool-call deltas. Returns (text, toolCalls, error).
func drainStream(reader *einoschema.StreamReader[*einoschema.Message], onToken func(string)) (string, []ToolCall, error) {
	defer reader.Close()

	type tcAccum struct {
		id   string
		name string
		args strings.Builder
	}
	tcMap := map[int]*tcAccum{}

	var fullText strings.Builder

	for {
		chunk, err := reader.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", nil, err
		}
		if chunk == nil {
			continue
		}
		if chunk.Content != "" {
			fullText.WriteString(chunk.Content)
			onToken(chunk.Content)
		}
		for _, tc := range chunk.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			acc, ok := tcMap[idx]
			if !ok {
				acc = &tcAccum{}
				tcMap[idx] = acc
			}
			if tc.ID != "" {
				acc.id = tc.ID
			}
			if tc.Function.Name != "" {
				acc.name = tc.Function.Name
			}
			if tc.Function.Arguments != "" {
				acc.args.WriteString(tc.Function.Arguments)
			}
		}
	}

	if len(tcMap) > 0 {
		calls := make([]ToolCall, 0, len(tcMap))
		for i := 0; i < len(tcMap); i++ {
			acc, ok := tcMap[i]
			if !ok {
				continue
			}
			args, err := parseToolCallArguments([]byte(acc.args.String()))
			if err != nil {
				args = map[string]any{}
			}
			calls = append(calls, ToolCall{
				ID:        acc.id,
				Name:      acc.name,
				Arguments: args,
				Status:    "pending",
			})
		}
		return fullText.String(), calls, nil
	}

	text := fullText.String()
	if text == "" {
		return "", nil, fmt.Errorf("stream: empty response")
	}
	return text, nil, nil
}

// ── Image parsing ─────────────────────────────────────────────────────────────

// attachmentToInputPart converts a MessageAttachment to an eino MessageInputPart.
// Images are sent as image_url parts (supports data URIs). Other file types are
// also forwarded as image_url since litellm/Gemini can accept PDFs this way.
func attachmentToInputPart(a MessageAttachment) einoschema.MessageInputPart {
	u := a.DataURL
	return einoschema.MessageInputPart{
		Type: einoschema.ChatMessagePartTypeImageURL,
		Image: &einoschema.MessageInputImage{
			MessagePartCommon: einoschema.MessagePartCommon{URL: &u},
		},
	}
}

var markdownImageRe = regexp.MustCompile(`!\[(.*?)\]\(((?:data:image/[^)]+)|(?:https?://[^)]+))\)`)

type imgSpan struct {
	start, end int
	url        string
}

func extractImageSpans(content string) []imgSpan {
	matches := markdownImageRe.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return nil
	}
	spans := make([]imgSpan, 0, len(matches))
	for _, m := range matches {
		if len(m) < 6 {
			continue
		}
		spans = append(spans, imgSpan{start: m[0], end: m[1], url: content[m[4]:m[5]]})
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	return spans
}

// parseUserContent converts user message text to multimodal parts if it contains
// inline images. Returns nil when no images are present; caller uses plain Content.
func parseUserContent(content string) []einoschema.MessageInputPart {
	spans := extractImageSpans(content)
	if len(spans) == 0 {
		return nil
	}
	parts := make([]einoschema.MessageInputPart, 0, len(spans)*2+1)
	last := 0
	for _, span := range spans {
		if span.start < last {
			continue
		}
		if span.start > last {
			if text := content[last:span.start]; strings.TrimSpace(text) != "" {
				parts = append(parts, einoschema.MessageInputPart{
					Type: einoschema.ChatMessagePartTypeText,
					Text: text,
				})
			}
		}
		u := span.url
		parts = append(parts, einoschema.MessageInputPart{
			Type: einoschema.ChatMessagePartTypeImageURL,
			Image: &einoschema.MessageInputImage{
				MessagePartCommon: einoschema.MessagePartCommon{URL: &u},
			},
		})
		last = span.end
	}
	if last < len(content) {
		if text := content[last:]; strings.TrimSpace(text) != "" {
			parts = append(parts, einoschema.MessageInputPart{
				Type: einoschema.ChatMessagePartTypeText,
				Text: text,
			})
		}
	}
	return parts
}
