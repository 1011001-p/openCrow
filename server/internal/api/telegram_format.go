package api

import (
	"html"
	"regexp"
	"strings"
)

// markdownToTelegramHTML converts a Markdown-formatted LLM reply to
// Telegram's HTML parse mode. Supported tags emitted: <b>, <i>, <s>, <u>,
// <code>, <pre>, <a href>. All other text is HTML-escaped so it is safe to
// pass as parse_mode=HTML to the Telegram sendMessage API.
func markdownToTelegramHTML(md string) string {
	var out strings.Builder

	// Split on fenced code blocks (``` ... ```) so their contents are never
	// processed by the inline formatter - only HTML-escaped.
	codeBlockRe := regexp.MustCompile("(?s)```([a-zA-Z0-9]*)\n?(.*?)```")

	rest := md
	for {
		loc := codeBlockRe.FindStringIndex(rest)
		if loc == nil {
			out.WriteString(inlineMarkdownToTelegramHTML(rest))
			break
		}
		// Text before the code block
		out.WriteString(inlineMarkdownToTelegramHTML(rest[:loc[0]]))

		// The code block itself
		match := codeBlockRe.FindStringSubmatch(rest[loc[0]:loc[1]])
		code := ""
		if len(match) >= 3 {
			code = match[2]
		}
		code = strings.TrimRight(code, "\n")
		out.WriteString("<pre><code>")
		out.WriteString(html.EscapeString(code))
		out.WriteString("</code></pre>")

		rest = rest[loc[1]:]
	}

	return out.String()
}

// inlineMarkdownToTelegramHTML handles inline formatting inside non-code
// regions. It first extracts inline code spans so they are not formatted,
// HTML-escapes plain text, then applies bold/italic/strike/link patterns.
func inlineMarkdownToTelegramHTML(text string) string {
	var out strings.Builder

	inlineCodeRe := regexp.MustCompile("`([^`\n]+)`")
	rest := text

	for {
		loc := inlineCodeRe.FindStringIndex(rest)
		if loc == nil {
			out.WriteString(applyTelegramInlineFormats(html.EscapeString(rest)))
			break
		}
		// Text before inline code
		out.WriteString(applyTelegramInlineFormats(html.EscapeString(rest[:loc[0]])))

		// Inline code span
		match := inlineCodeRe.FindStringSubmatch(rest[loc[0]:loc[1]])
		code := ""
		if len(match) >= 2 {
			code = match[1]
		}
		out.WriteString("<code>")
		out.WriteString(html.EscapeString(code))
		out.WriteString("</code>")

		rest = rest[loc[1]:]
	}

	return out.String()
}

// applyTelegramInlineFormats applies bold, italic, strikethrough, underline,
// and hyperlink conversions to already-HTML-escaped text.
//
// Conversion table:
//
//	**text** / __text__  -> <b>text</b>
//	*text* / _text_      -> <i>text</i>
//	~~text~~             -> <s>text</s>
//	[text](url)          -> <a href="url">text</a>
func applyTelegramInlineFormats(text string) string {
	// Bold: **text** (processed before single-star italic)
	text = regexp.MustCompile(`\*\*(.+?)\*\*`).ReplaceAllString(text, "<b>$1</b>")

	// Bold: __text__ (double-underscore, before single-underscore italic)
	text = regexp.MustCompile(`__(.+?)__`).ReplaceAllString(text, "<b>$1</b>")

	// Italic: *text* (single star, not preceded/followed by another star)
	text = regexp.MustCompile(`(?:^|[\s(])\*([^*\n]+?)\*(?:[\s,.!?;)]|$)`).ReplaceAllStringFunc(text, func(s string) string {
		inner := regexp.MustCompile(`\*([^*\n]+?)\*`).FindStringSubmatch(s)
		if len(inner) < 2 {
			return s
		}
		return strings.Replace(s, inner[0], "<i>"+inner[1]+"</i>", 1)
	})

	// Italic: _text_ (single underscore, word-boundary style)
	text = regexp.MustCompile(`(?:^|[\s(])_([^_\n]+?)_(?:[\s,.!?;)]|$)`).ReplaceAllStringFunc(text, func(s string) string {
		inner := regexp.MustCompile(`_([^_\n]+?)_`).FindStringSubmatch(s)
		if len(inner) < 2 {
			return s
		}
		return strings.Replace(s, inner[0], "<i>"+inner[1]+"</i>", 1)
	})

	// Strikethrough: ~~text~~
	text = regexp.MustCompile(`~~(.+?)~~`).ReplaceAllString(text, "<s>$1</s>")

	// Hyperlinks: [label](url)
	text = regexp.MustCompile(`\[([^\]\n]+)\]\((https?://[^\)\n]+)\)`).ReplaceAllString(text, `<a href="$2">$1</a>`)

	return text
}
