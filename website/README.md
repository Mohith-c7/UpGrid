# UpGrid marketing website

Static site, no build step, no frameworks, no external CDN. Pages: `index`, `students`, `placement-cells`, `recruiters`, `assessments`, `ai`, `security`, `waitlist`, `contact`, `privacy` (DRAFT), `terms` (DRAFT), `404`.
URLs are extensionless (`/students`); Cloudflare Pages and Netlify serve `students.html` that way automatically.

## Placeholders to fill (all in `config.js`)
| Key | What to put |
|---|---|
| `SITE_NAME` | Display name (default "UpGrid") |
| `SITE_URL` | Final https origin, no trailing slash (currently `https://upgrid.example`) |
| `CONTACT_EMAIL` | Real inbox (currently `hello@upgrid.example`); used for contact links and the waitlist mailto fallback |
| `WAITLIST_ENDPOINT` | Full URL of `POST /api/v1/waitlist` on the deployed server. Empty = form opens a pre-filled email instead |
| `PLAY_STORE_URL` | Play listing; empty keeps the button hidden |
| `SOCIAL_LINKEDIN`, `SOCIAL_INSTAGRAM`, `SOCIAL_X`, `SOCIAL_YOUTUBE` | Profile URLs; empty hides the link |

After changing `SITE_URL` or `CONTACT_EMAIL`, run `python3 tools/stamp-urls.py` once. It rewrites the canonical, Open Graph and JSON-LD URLs, `sitemap.xml`, `robots.txt` and `site.webmanifest` so crawlers that do not run JavaScript see the right values. (`site.js` also corrects canonical/OG URLs at runtime.)

Other placeholders in the legal drafts are in `[SQUARE BRACKETS]` inside `privacy.html` and `terms.html`: founder name and city, providers, retention, governing law. A lawyer must review both before the pilot.

## Waitlist backend
The server module is `server/src/routes/waitlist.ts` (migration `050_waitlist.sql`, docs in `server/docs/waitlist-api.md`). Set the server `CORS_ORIGINS` to your site origin and `WAITLIST_ENDPOINT` to `https://<api-host>/api/v1/waitlist`. Export signups as an officer: `GET /api/v1/waitlist/export`.

## Preview locally
`python3 tools/serve.py 8080` (clean URLs and the 404 page). Plain `python3 -m http.server` also works but `/students` needs `/students.html`.

## Deploy
- **Cloudflare Pages:** create a project from the repo (or Direct Upload), build command empty, output directory `website`. `_headers` and `_redirects` are used as-is.
- **Netlify:** build command empty, publish directory `website`. `_headers` and `_redirects` are used as-is.
- **Render (Static Site):** publish directory `website`. Render does not read `_headers`/`_redirects` and has no extensionless URLs, so use the rewrites and headers in `render.yaml` (Blueprint) or copy them into the dashboard.
Serve from the domain root: asset paths are root-absolute.

## Notes
- Content Security Policy in `_headers` allows only same-origin scripts/styles and `connect-src https:` (for the waitlist API). No inline scripts or styles are used.
- Font: Inter Regular and SemiBold, subset to Latin, self-hosted (about 41 KB). Home page transfers about 106 KB uncompressed before gzip, excluding images.
- Motion: only a 150 ms colour fade on hover; disabled under `prefers-reduced-motion`.
- No analytics, cookies or trackers. All app screens are CSS drawings labelled "Illustrative screen · fictional data".
