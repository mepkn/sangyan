# Learn

Notes I write while learning React, Svelte, Express and more, created and edited live on the site.

## Features

- Topics on the home page; inside each, a sidebar tree of sections, subsections and pages
- Add, rename, delete and drag to reorder or nest, right in the sidebar (+, ⋯ or right-click)
- Distraction-free editor with no toolbar: markdown turns into formatting as you type
  (`#`, `-`, `1.`, `[ ]`, `>`, ```` ``` ````, `**bold**`...), right-click for more, `Ctrl+/` for shortcuts
- View mode by default; `E` to edit, `Ctrl+S` to save, `Esc` to save and stop editing.
  Nothing is sent until you save; unsaved changes are kept in the browser meanwhile
- Code blocks with syntax highlighting, checklists, tables, links
- `Ctrl+K` to jump to any page; light and dark theme
- Anyone can read; only allowlisted emails can sign in and edit. Sign-up confirms the email with a
  6-digit code, and "Forgot password?" resets the password with one

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui (Base UI) · Tiptap · dnd-kit · Convex · Convex Auth · Vitest

## Development

Node 22.18+ (`.nvmrc`). Dev uses a local Convex backend on this machine.

```bash
cd backend && npm install
npm run dev          # local Convex backend; keep it running
npm run setup:auth   # once: JWT_PRIVATE_KEY and JWKS
npx convex env set SITE_URL http://localhost:5173
npx convex env set ALLOWED_EMAILS you@example.com
cd ../web && npm install
npm run dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
|---|---|
| `scripts/check.sh` | Every part's checks; run before committing |
| `scripts/deploy.sh` | Checks, deploys Convex, builds `web/` and uploads it to the VPS |
| `DRY_RUN=1 scripts/deploy.sh` | Same, but nothing is deployed or uploaded |
| `backend`: `npm run dev` | Local Convex backend |
| `backend`: `npm run test` | Backend tests (convex-test) |
| `backend`: `npm run check` | Typecheck + lint + tests |
| `backend`: `npm run setup:auth` | Auth keys (`-- --prod` for production) |
| `web`: `npm run dev` | Vite dev server |
| `web`: `npm run build` | Production build into `web/dist` |
| `web`: `npm run check` | Typecheck + lint + tests |

## Deployment

`scripts/deploy.sh` reads `backend/.env.prod.local` (`CONVEX_DEPLOY_KEY`) and
`web/.env.prod.local` (`DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_DIR`); see the `.env.example` next to each.
Deploy key:

```bash
cd backend && npx convex deployment token create learn-deploy --deployment praveen-nirmalkar:learn:production --save-env .env.prod.local
```

Caddy serves `/var/www/learn` with the SPA fallback `try_files {path} /index.html`.

## How it works

- Auth: email + password (Convex Auth). `ALLOWED_EMAILS` is checked at sign-up/sign-in and on
  every write (`requireEditor` in `backend/convex/lib/access.ts`). Reads are public.
- Prod env vars: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL=https://learn.pknspace.com` and `ALLOWED_EMAILS`;
  `RESEND_API_KEY` (sends the codes; set with `../scripts/set-resend-key.sh learn`).
- Data: `nodes` is the tree (topics are top-level sections with a slug; every node below carries
  its `topicId`), `contents` holds each page's markdown, kept apart so saving a page doesn't
  re-send the tree.
- Code map:
  - `backend/convex/nodes.ts`: tree queries and mutations, page save
  - `backend/convex/otp.ts`: the 6-digit codes for sign-up verification and password reset, sent by
    Resend from `Learn <noreply@send.pknspace.com>`. Without `RESEND_API_KEY` (local dev) the code is
    only logged in the `npx convex dev` output.
  - `web/src/lib/tree.ts`: flattening the tree and working out drag-and-drop targets (tested)
  - `web/src/components/sidebar/`: the tree, menus, inline rename, drag and drop
  - `web/src/components/editor/Editor.tsx`: Tiptap with markdown in and out, right-click menu
  - `web/src/components/PageView.tsx`: view/edit modes, save, local draft
