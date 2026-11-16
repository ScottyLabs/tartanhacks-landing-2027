# TartanHacks 2027 landing page

The teaser site for TartanHacks 2027: February 5–6 at Carnegie Mellon University, Pittsburgh, hosted by [ScottyLabs](https://scottylabs.org).

It does three jobs until registration opens on December 1, with the theme announced after that:

- says when and where,
- counts down to registration opening,
- sends students to the pre-registration form and judges to the judge interest form.

Bark, the ScottyLabs dog, lives on it too: he walks along the top of the sign-up band after your pointer, and jumps when you press him.

Later it is replaced by the full event site, made by the ScottyLabs design committee.

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
| When registration opens | the `datetime` on `<time id="drop-time">` in `index.html` (midnight Eastern, December 1, 2026) |
| The site's public address | `VITE_SITE_URL` in `.env`, used for the share image |
| Share image | `public/og.png` (1200 × 630) |
| Search listing | the `<title>`, the description and the event data (`application/ld+json`) in the head of `index.html` |

## How it is built

Plain TypeScript and CSS, bundled by Vite. No framework and no runtime dependencies.

```
index.html              content and structure
public/                 files served as they are (boot script, favicon, share image)
src/main.ts             starts the countdown and the field
src/countdown.ts        countdown maths and rendering
src/bark/               Bark, the ScottyLabs dog
  shape.ts                his three strokes, fitted to the ScottyLabs mark
  pose.ts                 everything that can move, and the drawing in a pose
  mind.ts                 how he behaves: chase, turn, stride, jump
  bark.ts                 puts him on the page and runs him
src/field/              the drawn background
  field.ts                layout and the entrance
  ink.ts                  rasterises the wordmark from the DOM
  shader.ts               the fragment shader that draws it all
src/styles/             tokens, base, layout, entrance
```

### The field

The background is one WebGL 2 canvas behind the page. It draws a sheet of horizontal rules with the wordmark drawn into it. It moves once, for the entrance, and is still after that:

1. The rules draw outward from the centre of the page.
2. Where the wordmark is, the rules swell until they meet, and the wordmark is solid.
3. Above the band the plain rules leave again, each one running off the edges the way it came, so the wordmark sits on white.

- **The DOM owns layout.** The wordmark is real text. The field measures where the browser put each glyph and draws the wordmark at exactly that spot; the text itself stays in place, transparent, for selection and screen readers.
- **Everything sits on the rule grid.** The distance between two rules is the *pitch*. The field rounds it to whole device pixels so the rules stay sharp, writes the exact value to the `--pitch` custom property, and CSS sizes everything vertical in pitches. Elements marked `data-snap` are nudged so their edges fall between rules.
- **It only draws when something changes.** Frames run during the entrance, then stop.

### Bark

Bark is drawn in SVG from the same three strokes as the ScottyLabs mark: one weight, flat ends, one sharp corner at the nose. The curves in `shape.ts` were fitted to the mark and agree with it to a fraction of a stroke's width, so standing still he *is* the mark. Change them only against the mark, which is kept in `ScottyLabs-Logo/scottylabs-logo-square.png` for that purpose; the site itself does not use the image.

- **He is posed, not swapped.** There are no frames. `pose.ts` moves the points of the drawing: each pair of feet can reach and lift, the head turns about the neck, the ear about its base, the beard about its corner. The path is rebuilt every frame, and the stroke is set in screen pixels, so squashing and turning change his shape but never his line.
- **Behaviour is separate from drawing.** `mind.ts` turns time and a pointer position into a pose, and knows nothing about the page, which is what makes it testable: `npm test` checks that he reaches the pointer, turns round, stays on his ground, jumps about his own height, and never stretches far from the mark.
- **His ground is the band.** He stands on the top edge of the sign-up band. The empty strip above it (`.runway`) is as tall as he is; its height is `--bark-size`.
- **He is a button.** A transparent button follows him, so a click, a tap, or Enter and Space with the keyboard all make him jump.

With reduced motion requested he stands still. Without WebGL he still works, since he does not use the field.

The favicon (`public/favicon.svg`) and the home-screen icon are the same drawing, with a heavier line so that it still reads at 16 pixels.

### Without the field

The page works at every level of support:

| Situation | Result |
|---|---|
| Reduced motion requested | The finished sheet, drawn once, with no entrance. Bark stands still. |
| No WebGL 2 | A solid wordmark on white, CSS rules below the band. The countdown still runs. |
| No JavaScript | A solid wordmark on white, CSS rules below the band, and the registration date in text. |

## Deploy

The repo ships a `Dockerfile` that builds the site and serves it with nginx, with a strict Content-Security-Policy. nginx listens on `$PORT`, or on 80 when that is not set, and answers health checks at `/health` and `/healthz`.

The page sets no inline styles or scripts in its markup, so it runs under `style-src 'self'; script-src 'self'`. Keep it that way when editing, or nginx's policy will block the change.

### Search engines

Only `tartanhacks.com` is meant to be indexed. The page names it as its canonical address, `robots.txt` and `sitemap.xml` point at it, and nginx sends `X-Robots-Tag: noindex` on every other address the site answers on, so previews never compete with it in search results. If the site ever moves, change `VITE_SITE_URL` in `.env`, the two files in `public/`, and the `map` at the top of `nginx.conf`.

### Railway

The site runs as the `2027` service of the `TartanHacks-History` project, next to the earlier years. `railway.json` tells Railway to build the Dockerfile and to check `/health`; Railway provides `PORT`. The service deploys from this repo's `main` branch.

### Sheltie

For a preview on [Sheltie](https://github.com/scottylabs-labrador/sheltie), ScottyLabs' deployment platform:

- Source: this repo, as a public Git repository (or through the `sheltie-scottylabs` GitHub App, which adds deploy-on-push)
- Build pack: Dockerfile
- Ports exposes: `80`
- Health check path: `/healthz`
- Memory limit: `64m`

## Credits

Typeface: [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type, under the SIL Open Font License (`src/assets/fonts/OFL.txt`).
