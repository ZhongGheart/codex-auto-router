# v0.3.0

GPT 6.1 Sol is preferred for STANDARD (`medium`) and DEEP (`high`) when the current session supports it. QUICK continues to prefer GPT 6 Luna (`high`), and ARCHITECT continues to prefer GPT 6 Astra (`high`). When Astra is absent, ARCHITECT prefers GPT 6.1 Sol with a higher supported reasoning effort. Catalogs without 6.1 Sol retain the existing fallback behavior.

This release also includes the capability negotiation completed in the previous session:

- Current spawn capabilities determine executable overrides even when the provider catalog is stale or from another model family.
- Routing exposes `ready_override`, `ready_profile`, `restart_required`, `blocked`, and `unavailable`; inherited settings never count as successful model routing.
- Generated agent profiles use a SHA-256 fingerprint visible in all four loaded agent descriptions. Matching files alone cannot prove the current session reloaded them.
- Profile synchronization validates and stages all mappings, creates backups, replaces the state marker last, and attempts rollback after installation failures.
- The installer preserves generated profiles and updates the global routing instructions and canonical templates.

Install or update with `./scripts/install.sh`. Supply the current spawn schema on every route. Profile synchronization requires a fresh task or client restart before generated profiles can be used; complete explicit overrides work in the current session.
