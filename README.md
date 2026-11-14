# TartanHacks 2027 landing page

The teaser site for TartanHacks 2027: February 5–6 at Carnegie Mellon University, Pittsburgh, hosted by [ScottyLabs](https://scottylabs.org).

It does three jobs until the theme and registration drop on December 1:

- says when and where,
- counts down to the drop,
- sends students to the pre-registration form and judges to the judge interest form.

On December 1 this site is replaced by the full event site.

## Run it

Needs Node 22.18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run build:site` | Build only (what the Docker image runs) |
| `npm run preview` | Serve the built site locally |
| `npm run typecheck` | Type-check without building |
| `npm test` | Unit tests for the countdown |

## Change the content

Everything a visitor reads is in `index.html`.

| To change | Edit |
|---|---|
| Dates, place, copy | `index.html` |
| Form links | the two `<a class="band__half">` links in `index.html` |
| The drop moment | the `datetime` on `<time id="drop-time">` in `index.html` (midnight Eastern, December 1, 2026) |
| The site's public address | `VITE_SITE_URL` in `.env`, used for the share image |
| Share image | `public/og.png` (1200 × 630) |

## How it is built

Plain TypeScript and CSS, bundled by Vite. No framework and no runtime dependencies.

```
index.html              content and structure
public/                 files served as they are (boot script, favicon, share image)
src/main.ts             starts the countdown and the field
src/countdown.ts        countdown maths and rendering
src/field/              the drawn background
  field.ts                layout, pointer input, frame loop
  facets.ts               the folds that open where the pointer travels
  ink.ts                  rasterises the wordmark from the DOM
  shader.ts               the fragment shader that draws it all
src/styles/             tokens, base, layout, entrance
```

### The field

The background is one WebGL 2 canvas behind the page. It draws a sheet of horizontal rules, thickens them wherever the wordmark is, and folds the sheet into mirrored figures where the pointer travels.

- **The DOM owns layout.** The wordmark is real text. The field measures where the browser put each glyph and draws the wordmark into the rules at exactly that spot; the text itself stays in place, transparent, for selection and screen readers.
- **Everything sits on the rule grid.** The distance between two rules is the *pitch*. The field rounds it to whole device pixels so the rules stay sharp, writes the exact value to the `--pitch` custom property, and CSS sizes everything vertical in pitches. Elements marked `data-snap` are nudged so their edges fall between rules.
- **It only draws when something changes.** The frame loop runs during the entrance and while a fold is open, then stops.

### Without the field

The page works at every level of support:

| Situation | Result |
|---|---|
| Reduced motion requested | The finished sheet, drawn once. No entrance, no pointer response. |
| No WebGL 2 | CSS rules and a solid wordmark. The countdown still runs. |
| No JavaScript | CSS rules, a solid wordmark, and the drop date in text. |

## Deploy

The repo ships a `Dockerfile` that builds the site and serves it with nginx on port 80, with a `/healthz` check and a strict Content-Security-Policy. It follows the conventions of [Sheltie](https://github.com/scottylabs-labrador/sheltie), ScottyLabs' deployment platform:

- Source: this repo through the `sheltie-scottylabs` GitHub App
- Build pack: Dockerfile
- Ports exposes: `80`
- Health check path: `/healthz`
- Memory limit: `64m`

The page sets no inline styles or scripts in its markup, so it runs under `style-src 'self'; script-src 'self'`. Keep it that way when editing, or nginx's policy will block the change.

## Credits

Typeface: [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type, under the SIL Open Font License (`src/assets/fonts/OFL.txt`).
