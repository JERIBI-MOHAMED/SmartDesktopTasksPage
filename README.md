# Smart Desktop – Tasks page

The public web page of the **Smart Desktop** project. It shows the same to-do list as the
stationary tablet dashboard; both talk to the Smart Desktop .NET API (contract v1).

Live: https://jeribi-mohamed.github.io/SmartDesktopTasksPage/

- List tasks (not done first), add, rename inline, tick off, delete with undo, progress ("2 of 6 done").
- **Offline-first.** Tasks and a queue of unsent changes are kept in IndexedDB. Every edit shows
  immediately; rows that have not reached the server yet say *Not sent yet*. When the browser is
  offline a banner says how many changes are waiting, with a *Try again* button.
- Responsive from 360 px phones to desktop, dark Smart Desktop look, keyboard and screen-reader friendly.

Built with Angular 22 (standalone components, signals, built-in control flow), strict TypeScript,
SCSS and one runtime dependency besides Angular: [`idb`](https://github.com/jakearchibald/idb).

## Run locally

Requirements: Node 22+ and npm.

```bash
npm install
npm start          # http://localhost:4200
npm test           # unit tests, headless (Vitest + jsdom)
npm run build      # production build into dist/smart-desktop-tasks/browser
```

In development the page talks to the API at `http://localhost:5080` (see
`src/environments/environment.development.ts`). Start the Smart Desktop API there with
`localhost:4200` in its CORS list.

## Configure

On first visit the page asks for:

| Setting  | Default | Stored in |
|----------|---------|-----------|
| API URL  | `environment.apiBaseUrl` | `localStorage` of this browser |
| API key  | none (must be entered) | `localStorage` of this browser |

Change them any time with the settings button (top right). The key is sent as the `X-Api-Key`
header. **Never commit an API key**: this repository is public and the key lives only in the browser.

Before deploying, set the production API address in `src/environments/environment.ts`
(currently the placeholder `https://YOUR-API-HOST`). If you leave the placeholder, users are simply
asked for the URL on first run. The API must allow the origin `https://jeribi-mohamed.github.io` in CORS.

## How sync works

Each edit (add, rename, toggle, delete) updates the local copy and appends a change to the queue
in IndexedDB. Unsent edits of the same task are merged (one queued update per task, a rename of an
unsent task folds into its create, deleting a never-sent task just forgets it). The queue is sent
to `POST /api/sync` together with `since` (the last `serverTime`, `null` the first time):

- on page load, when the browser comes back online, about one second after an edit, and every 60 s;
- one request at a time; edits made while a request is in flight wait for the next one.

The response is merged into the local list: sent changes leave the queue, `tasks` (everything that
changed since `since`) and `conflicts` replace local copies — the server wins on conflicts, and any
still-queued edit of a conflicted task is dropped — and `serverTime` becomes the next `since`.
Network errors keep the queue as it is; a 401 shows a banner pointing to the settings.

Code: `src/app/core/task-store.ts` (state, queue, persistence) and `src/app/core/sync.service.ts`
(when and how to sync). Tests sit next to them.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs on every push to `main` (or manually): it installs, runs the
tests, builds with `--base-href /SmartDesktopTasksPage/`, copies `index.html` to `404.html` so deep
links work, and publishes with `actions/deploy-pages`.

**One-time setup:** in the GitHub repository go to **Settings → Pages → Build and deployment** and
set **Source** to **GitHub Actions**. Without this the deploy job fails.
