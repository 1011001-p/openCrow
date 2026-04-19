// tools_skills.go — Skill file management tool implementations.
package api

import (
	"fmt"
	"strings"
)

// ── Skill tools ───────────────────────────────────────────────────────────────

func (s *Server) toolListSkills() (map[string]any, error) {
	if s.skillStore == nil {
		return map[string]any{"skills": []any{}, "count": 0}, nil
	}
	skills, err := s.skillStore.List()
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}, nil
	}
	items := make([]map[string]any, len(skills))
	for i, sk := range skills {
		items[i] = map[string]any{
			"slug":        sk.Slug,
			"name":        sk.Name,
			"description": sk.Description,
		}
	}
	return map[string]any{"skills": items, "count": len(items)}, nil
}

func (s *Server) toolGetSkill(args map[string]any) (map[string]any, error) {
	if s.skillStore == nil {
		return map[string]any{"success": false, "error": "skill store not available"}, nil
	}
	slug, _ := args["slug"].(string)
	if slug == "" {
		return map[string]any{"success": false, "error": "slug is required"}, nil
	}
	sf, err := s.skillStore.Get(slug)
	if err != nil {
		return map[string]any{"success": false, "error": "skill not found: " + slug}, nil
	}
	return map[string]any{
		"slug":        sf.Slug,
		"name":        sf.Name,
		"description": sf.Description,
		"content":     sf.Content,
	}, nil
}

func (s *Server) toolInstallSkills(args map[string]any) (map[string]any, error) {
	if s.skillStore == nil {
		return map[string]any{"success": false, "error": "skill store not available"}, nil
	}
	source, _ := args["source"].(string)
	if source == "" {
		return map[string]any{"success": false, "error": "source is required"}, nil
	}
	installed, errs := s.skillStore.InstallFromGitHub(source)
	return map[string]any{
		"installed": installed,
		"errors":    errs,
		"count":     len(installed),
	}, nil
}

func (s *Server) toolCreateSkill(args map[string]any) (map[string]any, error) {
	if s.skillStore == nil {
		return map[string]any{"success": false, "error": "skill store not available"}, nil
	}
	slug, _ := args["slug"].(string)
	description, _ := args["description"].(string)
	content, _ := args["content"].(string)
	if slug == "" {
		return map[string]any{"success": false, "error": "slug is required"}, nil
	}
	if content == "" {
		return map[string]any{"success": false, "error": "content is required"}, nil
	}
	slug = strings.ToLower(strings.TrimSpace(slug))
	// Inject description into frontmatter if the content doesn't already have one
	if description != "" && !strings.Contains(content, "description:") {
		if strings.HasPrefix(strings.TrimSpace(content), "---") {
			// Insert description into existing frontmatter block
			content = strings.Replace(content, "---", "---\ndescription: "+description, 1)
		} else {
			// Prepend a fresh frontmatter block
			content = fmt.Sprintf("---\ndescription: %s\n---\n\n", description) + content
		}
	}
	if err := s.skillStore.Save(slug, content); err != nil {
		return map[string]any{"success": false, "error": err.Error()}, nil
	}
	sf, _ := s.skillStore.Get(slug)
	result := map[string]any{"success": true, "slug": slug}
	if sf != nil {
		result["name"] = sf.Name
		result["description"] = sf.Description
	}
	return result, nil
}

func (s *Server) toolDeleteSkill(args map[string]any) (map[string]any, error) {
	if s.skillStore == nil {
		return map[string]any{"success": false, "error": "skill store not available"}, nil
	}
	slug, _ := args["slug"].(string)
	if slug == "" {
		return map[string]any{"success": false, "error": "slug is required"}, nil
	}
	if err := s.skillStore.Delete(slug); err != nil {
		return map[string]any{"success": false, "error": err.Error()}, nil
	}
	return map[string]any{"success": true, "slug": slug}, nil
}
