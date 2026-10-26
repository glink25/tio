# Security

Do not post private workspace files, authentication material, or sensitive local paths in public issues. When hosted in a repository with private vulnerability reporting, use that channel for security issues.

Tio treats imported and synchronized files as untrusted input. Validation checks object identities, managed paths, schema envelopes, and known structures before writes. Unsupported future versions are preserved read-only. Directory access is limited to the handle granted by the browser. Business files do not contain directory handles or credentials.

The application does not provide encryption, account isolation between users of the same browser profile, or zero-loss distributed storage. Browser data may be cleared or evicted; use exports or a synchronized folder for durable backups. Large archives and attachments have explicit size limits. These boundaries are part of the demo's design, not a substitute for a security audit.

Web Slice runs user HTML/JavaScript inside an opaque-origin sandbox. Its two host-side grants control scoped document/database writes and external resources. Grants never travel with document exports or synchronization. Browser CSP is not a complete network firewall, and iframe isolation is not a process/resource quota. See [Web Slice](web-slice.md) for the exact capability boundary and execution limitations.
