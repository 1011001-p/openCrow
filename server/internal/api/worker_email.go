// worker_email.go — Background worker for polling email inboxes.
package api

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"time"
)

func (s *Server) runEmailWorker(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	s.wlog("email-worker", "[email-worker] started")
	for {
		select {
		case <-ctx.Done():
			s.wlog("email-worker", "[email-worker] stopped")
			return
		case <-ticker.C:
			err := s.processDueEmailInboxes(ctx)
			s.workerStatus.tick("email-worker", err)
			if err != nil {
				s.wlog("email-worker", "[email-worker] error: %v", err)
			}
		}
	}
}

func (s *Server) processDueEmailInboxes(ctx context.Context) error {
	const q = `
SELECT id::text, user_id::text, address, imap_host, imap_port, imap_username, imap_password, use_tls
FROM email_inboxes
WHERE active = TRUE AND (last_polled_at IS NULL OR last_polled_at + (poll_interval_seconds * interval '1 second') <= NOW())
ORDER BY last_polled_at ASC NULLS FIRST
LIMIT 20;
`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return fmt.Errorf("query due email inboxes: %w", err)
	}
	defer rows.Close()

	type inboxPollRow struct {
		id           string
		userID       string
		address      string
		imapHost     string
		imapPort     int
		imapUsername string
		imapPassword string
		useTLS       bool
	}

	var due []inboxPollRow
	for rows.Next() {
		var r inboxPollRow
		if err := rows.Scan(&r.id, &r.userID, &r.address, &r.imapHost, &r.imapPort, &r.imapUsername, &r.imapPassword, &r.useTLS); err != nil {
			return fmt.Errorf("scan inbox row: %w", err)
		}
		due = append(due, r)
	}
	rows.Close()

	for _, r := range due {
		s.pollEmailInbox(ctx, r.id, r.userID, r.address, r.imapHost, r.imapPort, r.imapUsername, r.imapPassword, r.useTLS)
	}
	return nil
}

func (s *Server) pollEmailInbox(ctx context.Context, inboxID, userID, address, imapHost string, imapPort int, imapUsername, imapPassword string, useTLS bool) {
	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if imapUsername == "" || imapPassword == "" {
		detail := "skipped: IMAP credentials not configured"
		s.wlog("email-worker", "[email-worker] inbox %s (%s): %s", inboxID, address, detail)
		if _, err := s.createEmailPollEvent(pollCtx, userID, inboxID, "skipped", detail); err != nil {
			s.wlog("email-worker", "[email-worker] failed to log poll event: %v", err)
		}
		return
	}

	addr := fmt.Sprintf("%s:%d", imapHost, imapPort)
	detail, pollErr := checkIMAPConnectivity(pollCtx, addr, imapUsername, imapPassword, useTLS)

	status := "ok"
	if pollErr != nil {
		status = "error"
		detail = pollErr.Error()
		s.wlog("email-worker", "[email-worker] inbox %s (%s) poll error: %v", inboxID, address, pollErr)
	} else {
		s.wlog("email-worker", "[email-worker] inbox %s (%s): %s", inboxID, address, detail)
	}

	if _, err := s.createEmailPollEvent(pollCtx, userID, inboxID, status, detail); err != nil {
		s.wlog("email-worker", "[email-worker] failed to log poll event for inbox %s: %v", inboxID, err)
	}
}

// checkIMAPConnectivity dials the IMAP server and attempts LOGIN.
// Returns a detail string describing what was found, or an error.
func checkIMAPConnectivity(ctx context.Context, addr, username, password string, useTLS bool) (string, error) {
	dialer := &net.Dialer{}
	var conn net.Conn
	var err error

	if useTLS {
		host, _, _ := net.SplitHostPort(addr)
		tlsCfg := &tls.Config{ServerName: host}
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return "", fmt.Errorf("dial %s: %w", addr, err)
	}
	defer conn.Close()

	// Set deadline from context
	if deadline, ok := ctx.Deadline(); ok {
		conn.SetDeadline(deadline)
	}

	// Read server greeting
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	if err != nil {
		return "", fmt.Errorf("read greeting: %w", err)
	}
	greeting := strings.TrimSpace(string(buf[:n]))

	if !strings.HasPrefix(greeting, "* OK") {
		return "", fmt.Errorf("unexpected greeting: %s", greeting)
	}

	// Send LOGIN command
	_, err = fmt.Fprintf(conn, "a001 LOGIN %s %s\r\n", imapQuote(username), imapQuote(password))
	if err != nil {
		return "", fmt.Errorf("send LOGIN: %w", err)
	}

	// Read response
	respBuf := make([]byte, 1024)
	n, err = conn.Read(respBuf)
	if err != nil {
		return "", fmt.Errorf("read LOGIN response: %w", err)
	}
	resp := strings.TrimSpace(string(respBuf[:n]))

	if strings.Contains(resp, "a001 OK") {
		// Send LOGOUT
		fmt.Fprintf(conn, "a002 LOGOUT\r\n")
		return fmt.Sprintf("connected and authenticated to %s", addr), nil
	}
	return "", fmt.Errorf("LOGIN failed: %s", resp)
}

// imapQuote wraps a string in IMAP literal or quoted string format.
func imapQuote(s string) string {
	// Simple quoted string - escape backslash and double-quote
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
