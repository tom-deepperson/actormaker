# Actormaker PWA

Actormaker is an installable D&D 5e character companion that runs on **iPhone and Android** phones (and desktop).
It reads a character's `character.json`, keeps everything on the device in IndexedDB, and works offline once it has
been opened once.

Stack: Vite + TypeScript + Preact, a hand-written service worker, Vitest. The built app is a static folder (`dist/`, ~40 KB gzipped JS).

## What's in it

- **App shell:** web manifest, offline service worker, icons, iOS home-screen tags, light/dark/system theme, phone-first layout with safe-area padding.
- **Characters:** import `character.json` (file picker or paste), update a character from a newer file (keeps live HP/uses/slots), export `character.json`, delete.
- **Backup / Restore:** one file with every character plus its tracker and combat state. Restore also accepts a bare `character.json`.
- **Sheet views:** Combat, Non-combat and Full. You can show the alias or the true name, and a player-safe mode hides secrets.
- **Live tracker:** HP (damage uses temp HP first), temp HP, hit dice per die type, spell slots with pact magic, feature uses, and short/long rests with the 2014 and 2024 hit-dice rules.
- **Combat session:** enter/exit combat, rounds, action/bonus/reaction/move, timed effects and conditions. Kit timers such as Giant's Might are added on entering combat.
- **Combat board:** "Roll initiative" starts combat; a turn bar with four economy orbs; every attack, turn option, limited-use feature, cantrip, spell and standard action as a card, filtered by cost. Using a card spends its use, spell slot and economy orb (Action Surge gives the action back). Dice roller with advantage, disadvantage and critical damage.
- **Explore board (Non-combat):** all 18 skills, ability checks and saves to tap and roll, passive senses, utility traits with uses, and rests.
- **Coins and encumbrance:** gain and spend with automatic change, set exact amounts, coin weight, and variant encumbrance (sheet rule or player toggle).
- **Inventory:** consumables, carried gear, storage locations (stash and take), magic items.
- **DM handoff:** player-safe or DM copy, with copy, share (Web Share) or file download.
- **Share this app:** link and QR code.
- **Quick help (? on the Combat and Non-combat tabs):** a short rules reference for combat or skills and exploration,
  2014 or 2024 to match the sheet.
- **Portraits:** one static picture per portrait, with its background painted in (a head-and-shoulders painting, the way
  Mild Gilding shows its portraits). The chosen face shows in the sheet's top bar; a tap shows it full size, to turn the
  phone round and show the table. There is no separate background layer, positioning, expressions or facings.
- **Portrait mode (🖼 in the character menu):** the face, big, and a grid of the character's pictures: tap one to make it
  the face, ✕ deletes it, 🔒 keeps it to the true-name view. "+ Add pictures" takes PNG, JPEG or WebP (kept as they are,
  so a transparent cutout shows on a dark vignette). The choices are saved in `appearance.portrait`.
- **Play mode (🎭 on a sheet):** the face with an Explore / Combat / AI panel: HP and AC, encumbrance,
  enter combat, action economy, end turn, effects and exit combat, without leaving the picture.
- **Secret pictures:** in alias or player-safe view, pictures marked 🔒 and pictures whose name contains the true name or
  "helm off" / "unarmored" are hidden (and not named in Manage). An old portraits `manifest.json` added with the pictures
  marks its `"secret": true` sets. **Pictures are not part of "Back up all"** (it would make backups tens of MB): keep the
  originals on your computer and add them again if the browser clears its storage.
- **AI assistant (✨ on a sheet):** level up in two steps (the AI looks up what the level grants, you make every choice
  and set HP, then it builds the sheet and you review it), table events ("got Boots of Elvenkind") with a change list to
  accept, and rules research with sources. Uses your own Gemini, OpenAI or Anthropic API key; web search is always on.
- **Scan a sheet (home screen):** take a photo of each page or pick photos, a PDF (up to 14 MB) or a text file, and the
  AI builds the character. Photos are shrunk to 1800 px JPEG on the device first; a real `character.json` imports
  directly without the AI.

## Run locally

Needs Node 20+ (tested with Node 24).

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. The service worker only runs in a production build. To test offline behaviour:

```bash
npm run build
```

```bash
npm run preview
```

Then open http://localhost:4173, import a character, stop the preview server, and reload: the app still works.

Other scripts:

```bash
npm test
```

```bash
npm run icons
```

`npm run icons` regenerates `public/icons/*` from `scripts/make-icons.mjs`.

### Testing on a phone over Wi-Fi

`npm run dev -- --host` shows a LAN address. Phones can open it, but service workers and installing need HTTPS
(or localhost), so offline and Add to Home Screen only work once it is deployed (below).

## Deploy to GitHub Pages

The build uses relative paths (`base: './'`) and hash routes (`#/c/<slug>`), so it works at
`https://<user>.github.io/<repo>/` with no server configuration.

This folder is set up to be **its own repository** (the workflow is in `pwa/.github/workflows/deploy.yml`):

1. Create an empty GitHub repository, for example `actormaker`.
2. From this `pwa` folder:
   ```bash
   git init -b main
   ```
   ```bash
   git add .
   ```
   ```bash
   git commit -m "Actormaker PWA"
   ```
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   ```
   ```bash
   git push -u origin main
   ```
3. In the repository: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
4. The "Deploy to GitHub Pages" workflow runs tests, builds and publishes on every push to `main`. The site is at
   `https://<user>.github.io/<repo>/`.

**Privacy:** the repository is public (GitHub Pages on a free account needs that). `test/fixtures/` holds sanitized
sheets with fictional names and placeholder text; never commit a real character sheet there. The fixtures are never
copied into `dist/`, so the deployed site doesn't contain them either.

If you would rather make the whole `actormaker/` folder the repository, move `pwa/.github` to the repository root
and add `defaults: run: working-directory: pwa` to the build job, with `cache-dependency-path: pwa/package-lock.json`
and `path: pwa/dist` in the matching steps.

To publish without Actions, run `npm run build` and upload the contents of `dist/` to any static host (Netlify,
Cloudflare Pages, a `gh-pages` branch).

### Updates

Each build gets a new cache name. Open apps pick up a new deploy on the next launch (the page is fetched network-first;
assets are cached). Data in IndexedDB is not touched by updates.

## Installing and keeping data safe

- **iPhone/iPad (Safari):** Share > Add to Home Screen. Import your character **inside the home-screen app**:
  Safari tabs and the installed app have separate storage. iOS can clear the storage of web apps you haven't
  opened for a while, so use **Back up all** after each session and keep the file in Files or iCloud Drive.
- **Android (Chrome):** menu > Install app (or the install banner).
- The Settings dialog shows whether the browser has granted persistent storage, and can ask for it.

### AI keys

API keys are stored only in this browser's IndexedDB on this device. They are never included in backups, exports
or DM handoffs, and they are sent only to the provider you picked. The provider is called straight from the browser
(Anthropic with its `anthropic-dangerous-direct-browser-access` header). When you use the assistant, the character
sheet (or the pages you scan) goes to that provider with your key.

Every GitHub Pages site under the same `<user>.github.io` address shares one browser origin, so another Pages site
of the same account could read this storage. Keep untrusted projects off that account, or serve the app from its own
domain.

## Layout

```
src/data/       app logic (no UI): model + parsing, tracker, coins, classes, combat, encumbrance,
                DM handoff, view context (alias / player-safe), IndexedDB storage and backup
src/ai/         AI assistant: provider HTTP calls, prompts, level-up planner, sheet merge, import and scan
src/ui/         Preact screens and components
src/sw.js       service worker template (vite.config.ts fills in the precache list and version)
src/assets/     conditions.json, kit_timers.json, rules/ and help/ (bundled into the app)
test/           Vitest specs, plus sanitized fixtures
```

Sheets are stored as plain JSON objects, so fields this app does not know about survive an import and export.

## Remaining

- The AI calls were tested against stubbed provider replies, not live keys; try one real level-up per provider.
