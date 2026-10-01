# olt-server

The project server of the Open Layout Tool (roadmap phase 10): users and
sessions, projects with variants and revisions, images. Editing and
calculating stay in the browser; the server stores, versions, checks and
manages users. It never merges — it takes a revision only on top of the
current head of a variant (decision 97) and checks it with the browser's own
code (`parseProjectsPayload`, `validateProject`, decision 91).

## Run

Node 22. `npm install` here, then

    node bin/olt-server.mjs create-admin <login> [name]   # start password printed, changed at first sign-in
    node bin/olt-server.mjs serve
    node bin/olt-server.mjs backup <file>                 # consistent copy (SQLite backup API)

`bin/olt-server.mjs` registers a module hook (`src/esmHook.mjs`) before
anything else, which lets plain Node load the browser modules under `../../src`
(they import without file extensions and import JSON without attributes).

| Variable | Default | |
|---|---|---|
| `OLT_SERVER_DB` | `olt.sqlite` | database file (SQLite, WAL) |
| `OLT_SERVER_HOST` | `127.0.0.1` | bind address |
| `OLT_SERVER_PORT` | `8787` | port |
| `OLT_SERVER_INSECURE_COOKIE` | — | `1` drops `Secure` from the cookie (plain-http local runs only) |
| `OLT_ADMIN_PASSWORD` | — | start password for `create-admin` instead of a generated one |

The schema lives in `migrations/`, one numbered SQL file per step, applied in
order on start.

## Tests

From the repository root, with the rest: `npm test` (vitest runs
`tools/server/test/**` through `fastify.inject` against a database in memory).

## Behind Caddy

The API is served under `/api/` on the app's own origin (no CORS). Everything
else that costs or reveals something — the optimizer, the tiles, the terrain —
sits behind the sign-in through `forward_auth` against `GET /api/me`, so the
Python service itself stays as it is (decision 102):

    online.open-layout-tool.org {
        handle /api/* {
            reverse_proxy 172.18.0.1:8787
        }
        @guarded path /optimizer/* /data/*
        forward_auth @guarded 172.18.0.1:8787 {
            uri /api/me
            copy_headers Cookie
        }
        handle_path /optimizer/* {
            reverse_proxy 172.18.0.1:8099
        }
        handle {
            root * /srv/open-layout-tool
            file_server
        }
    }

The app's own files (the HTML and the JavaScript) stay public: the sign-in
page is part of them, and they hold no data.
