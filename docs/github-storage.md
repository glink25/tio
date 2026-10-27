# GitHub storage

A GitHub account is a connection; each repository is one workspace. The browser keeps a full text replica and downloads private attachment bytes on demand. PAT connections need no application server. GitHub App sign-in uses a small stateless Cloudflare Worker; document traffic goes directly to GitHub.

## Connect and discover

Choose **GitHub → Connect with token**. Fine-grained PATs need access to the intended repositories, Metadata read and Contents write. Creating repositories additionally needs Repository creation write (or Administration write). A classic PAT needs `repo` for private repositories. A read-only repository remains readable; publication reports a permission issue without deleting local drafts.

Only accessible `tio-*` and `<owner>.github.io` repositories are candidates. There is no free-text repository input. The GitHub App path enumerates installation repositories; PAT uses paginated `/user/repos`. Candidate detection looks for `workspaces/<id>/objects/<id>.json`; loading validates the workspace object. Multiple workspace markers or a duplicated workspace ID bound to another repository are reported in discovery instead of selecting an arbitrary endpoint.

New spaces create private `tio-<workspaceId>` repositories in the signed-in user's account. Creation failures are reported immediately without retrying or persisting a pending attempt. Each new creation uses a fresh random workspace ID. Repository discovery runs automatically after login and when restoring the connection. There is no manual discovery or initialization UI. Repositories without a tio workspace marker are ignored; `<owner>.github.io` is only an additional eligible name. Existing unrelated files survive synchronization. Repository deletion, branch selection and organization repository creation are not provided.

The initial branch is the actual default branch. Later default-branch changes do not retarget the connection. Numeric repository IDs survive repository renames; workspace names are independent of repository names. Local replica namespaces include the connection, repository and branch. Disconnect removes credentials and stops runners while preserving recoverable local content.

## Persistence and synchronization

`GitHubProvider` implements file I/O and an optional stable snapshot/publication capability. `FileWorkspaceContent` alone maps business objects and chunks to files. `GitHubAdapter` handles account identity and repository lifecycle. Web composition supplies the local replica, credentials and lifecycle; the editor has no GitHub dependency.

Each batch reads one immutable Git commit. Blob SHAs provide strong fingerprints; a bounded cache avoids repeated reads. A truncated recursive tree is replaced with explicit subtree traversal. Files are encoded into blobs, applied over the original base tree, committed with the original head as parent, and published with a non-forced ref update. A competing ref update causes a fresh read/merge, at most three immediate attempts. The implementation never reparents stale merged content onto an unseen head. A lost ref response is checked against the resulting commit/history before confirmation.

Local revisions are confirmed only after publication succeeds. Later edits stay dirty. Ordinary `write` remains a durable operation; buffering is confined to the explicit batch API. Folder providers retain their direct, recoverable publication model. Tombstones remain the deletion representation, and normal synchronization never garbage-collects chunks or deletes unrelated files.

The GitHub replica has `persistence: atomic`, `offline: true`, `prefetch: all`. This describes local saves, not network availability. Text objects are fetched in the background; search/export reject incomplete initial replicas. Existing cached text remains editable without authorization or connectivity. Attachment metadata can arrive without bytes through the synchronization ingress, while new local attachments require staged bytes. Private attachments use authenticated blob reads and `asset:<id>` references. The existing 20 MiB local attachment limit remains.

Edits use the shared trailing debounce. GitHub polls every 60 seconds while visible and wakes on visibility/network restoration. Rate-limit deadlines defer retries. Repository/branch access errors are not interpreted as remote deletion. Reauthorization must match the original numeric user ID.

## GitHub App and Worker setup

Create a GitHub App with expiring user tokens enabled. Configure Metadata read, Contents read/write and Repository creation write. Users install it on their selected repositories; newly created repositories may require adding them to that installation before synchronization can run. The Worker does not use an installation private key, bot token, database, KV, Durable Object or document proxy.

Deploy `apps/auth` using Wrangler. Set these variables:

| Variable                 | Meaning                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`       | GitHub App client ID                                                        |
| `GITHUB_APP_SLUG`        | App installation URL slug                                                   |
| `FRONTEND_ORIGIN`        | Comma-separated exact allowed frontend origins                              |
| `REDIRECT_URI_ALLOWLIST` | Comma-separated exact frontend callback URLs, including path/trailing slash |
| `GITHUB_CLIENT_SECRET`   | Worker secret; never a Vite environment variable                            |
| `STATE_SECRET`           | High-entropy Worker secret used for authenticated encryption                |

Set the App's callback URL and installation Setup URL to `https://<worker>/api/github/callback`. Configure `VITE_GITHUB_AUTH_URL=https://<worker>` for the Web build. Without that variable the UI offers PAT only. For example, a frontend hosted at `https://tio.example/` needs that exact URL in `REDIRECT_URI_ALLOWLIST` and `https://tio.example` in `FRONTEND_ORIGIN`.

```sh
cd apps/auth
corepack pnpm dlx wrangler secret put GITHUB_CLIENT_ID
corepack pnpm dlx wrangler secret put GITHUB_CLIENT_SECRET
corepack pnpm dlx wrangler secret put STATE_SECRET
corepack pnpm dlx wrangler deploy
```

The configured deployment uses `https://tio-api.linkai.work` and the `tio-personal-editor` GitHub App. Frontend redirects are selected by the login request, validated against `REDIRECT_URI_ALLOWLIST`; the current list permits `https://tio.linkai.work/` and `http://localhost:6789/`. Add any additional frontend callback URLs and their CORS origins explicitly. For this deployment, set `VITE_GITHUB_AUTH_URL=https://tio-api.linkai.work` when building the frontend. If the three secrets above are stored in the ignored `apps/auth/.env`, deploy from `apps/auth` with `corepack pnpm dlx wrangler deploy --secrets-file .env`; loading local environment variables alone does not upload them. Keep `STATE_SECRET` stable between deployments.

The Worker provides `GET /api/github/login`, `GET /api/github/callback`, `POST /api/github/exchange`, and `POST /api/github/refresh`. It uses encrypted state, PKCE, installation verification and a two-minute encrypted exchange grant. State and grant purposes are distinct; redirect URLs and CORS origins are explicitly allowlisted. The frontend clears callback parameters, stores tokens separately from workspace data, and serializes rotating-token refreshes across tabs with Web Locks. Network failures do not erase credentials. A stateless exchange grant is short-lived and verifier-bound, not a server-enforced single-use code.

The Worker auth implementation is adapted from [ahead](https://github.com/glink25/ahead/tree/main/apps/auth); its MIT notice is preserved in `apps/auth/LICENSE.ahead`. Git storage follows the batch-publication approach studied in [Cent](https://github.com/glink25/Cent/blob/main/apps/cent/src/tidal/github.ts), using tio's own file protocol and merge semantics.

## Validation

`tests/github.test.ts` exercises Git snapshots, truncated tree traversal, blob caching, batch publication, response-loss recovery, concurrent updates, delayed ACK, lazy attachments, name filtering, rate limits and auth-envelope boundaries. `tests/e2e/github.spec.ts` exercises PAT discovery, opening the replica and offline restoration against a controlled GitHub API fixture. These fixtures do not establish live GitHub App installation or Cloudflare deployment success; a deployed Worker and a dedicated authorized test repository are needed for that final integration check.
