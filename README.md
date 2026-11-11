# Bata

A small drum practice page written in strict TypeScript. It builds to plain HTML, CSS, and JavaScript, with all sounds and the original practice sheet included locally. No runtime dependencies, accounts, or backend.

## Run

Requires Node.js 22.12+ and Python 3 for the supplied local server.

```sh
npm ci
npm start
```

Open **http://localhost:8000**. For a phone on the same Wi-Fi, use `http://<your-computer-LAN-IP>:8000`. The server listens on all interfaces. Phone and computer may need permission to connect through your local firewall.

To deploy to any static host:

```sh
npm run build
```

Upload the contents of `dist/`. The page also works at a subdirectory. Serve it over HTTP or HTTPS; opening `index.html` directly as a file prevents browsers from loading the modules and audio reliably.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` checks TypeScript, runs the tests, builds the static page, and deploys `dist/` on every push to `main`. Pull requests run the same checks without publishing. It can also be run manually from the Actions tab.

One-time repository setup: open **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source. No personal access token or deployment secret is needed by the workflow. After the first successful deployment, the site is available at **https://franco-giordano.github.io/bata/**.

The deployment uses relative asset paths, so JavaScript, samples, and the reference PDF work under `/bata/`. GitHub Actions publishes only the generated `dist/` directory.

## Practice

- A–J reproduce the supplied *Ejercicios de Lectura I — Bombo y Tambor*. Each line on the sheet is four repetitions of one bar. The player shows that bar and loops it. A uses quarter-note hi-hat; B–J use eighths. Snare stays on 2 and 4.
- Press Play or Space. Adjust tempo from 30–240 BPM with the number, slider, ±5 buttons, or tap tempo. Changes apply during playback.
- Count in plays four clicks before the groove. Loop repeats the pattern; switch it off to finish the current pass. Click only runs the metronome without the kit.
- Sound & volume controls each instrument and the click separately; move a slider to zero to mute it.
- Playback stops when the page goes into the background, so returning to a phone tab does not trigger a burst of missed notes.
- Original practice sheet includes a readable image and a link to the supplied PDF.

## English / Español (Argentina)

Use the language selector in the header at any time, including during playback or while editing a draft. The page remembers your choice; on the first visit it follows your browser's English/Spanish language preference. Custom groove names and notes stay unchanged.

Spanish uses Argentine terminology and voseo: **bombo**, **tambor/redoblante**, **compás**, **pulso**, **negras**, **corcheas**, and **semicorcheas**. The collapsible bilingual drum glossary lets you compare terms without switching the whole page.

Translations live in `src/i18n.ts`. Both dictionaries share a TypeScript key type; tests also check matching interpolation parameters. Labels, exercise descriptions, status messages, validation errors, confirmations, and accessibility text use translation keys. Plural forms use `Intl.PluralRules`. JSON instrument IDs stay language-independent.

## Custom grooves

Use **Create groove** for an empty pattern, or **Edit a copy** to start from an exercise. Choose 1, 2, or 4 bars. Tap cells to cycle rest → hit → accent. The sixteenth-note grid scrolls horizontally on narrow screens. Tap an instrument name to audition its sound; Preview plays your draft.

Save stores the groove in this browser's local storage. Export a backup before clearing browser data, changing browser profiles, or moving devices. Import adds grooves without replacing existing ones. Files are validated before saving and must be smaller than 1 MB.

The version 1 format is:

```ts
{
  version: 1,
  patterns: [{
    id: 'my-groove',
    name: 'My groove',
    bars: 1,
    bpm: 80,
    tracks: {
      hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      kick:  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]
    }
  }]
}
```

Export produces valid JSON (the example above uses TypeScript object syntax for readability). Every bar has 16 steps: `0` rest, `1` hit, `2` accent. Tracks must contain exactly `bars * 16` values. Imports assign fresh IDs to avoid collisions. All patterns use 4/4 with straight subdivisions.

## Extend and check

- `src/model.ts`: typed pattern format, validation, built-in exercises, and rhythmic events.
- `src/audio.ts`: Web Audio sample player with an audio-clock scheduler. Replace WAVs in `assets/sounds/` to change the kit.
- `src/notation.ts`: SVG percussion notation for quarters, eighths, and sixteenths, including rests and accents.
- `src/app.ts`: controls, library, editor, and browser storage.
- `src/i18n.ts`: English and Argentine Spanish dictionaries, interpolation, plural forms, and language preference.
- `style.css`: responsive layout, including the mobile grid.

```sh
npm run check
npm test
```

Tests cover the PDF transcription, import validation, accents and multi-bar data, count-in, metronome events, audio-clock scheduling, looping, live tempo changes, interrupted or canceled playback, and packaged assets. JSDOM tests exercise navigation, editing, draft playback/export, save/reload, import/deletion, and language switching. Run `npm run test:ui` for just the DOM tests. TypeScript and JSDOM are development dependencies only; neither is shipped with the page.

Real Firefox checks also verify both languages at widths of 320, 375, 768, and 1280 pixels; a nonzero Web Audio signal from the three decoded samples; live tempo changes; metronome-only playback; count-in; automatic stopping; and custom save/reload with a scrolling mobile editor. Screenshots were inspected for the desktop, phone, and editor views. This verifies browser audio generation, not a particular phone's physical speaker or audio settings.

To repeat browser QA, keep `npm start` running. In a separate terminal, start a **dedicated test profile**:

```sh
mkdir -p /tmp/bata-browser-profile
firefox --headless --no-remote --profile /tmp/bata-browser-profile --remote-debugging-port 9222 about:blank
```

Then run `npm run test:browser` in another terminal. It uses Node's built-in WebSocket client and Firefox's WebDriver BiDi endpoint; no driver package is needed. Results and screenshots go in ignored `test-results/browser/`. The test saves a temporary groove and restores the test profile's previous grooves/language afterward. `BATA_URL` and `BATA_BIDI_URL` can override the local server and browser endpoint.

## Sources

The reference PDF is the user-supplied practice sheet with private identifying text removed. The preview image is generated from that sanitized PDF. The kick, snare, and hi-hat WAV files were copied from the local `~/repos/VisionPowered-AirDrums/sounds` checkout of [VisionPowered-AirDrums](https://github.com/Electrolight123/VisionPowered-AirDrums), copyright 2025 Abhishek Bala. Its MIT license is preserved in `assets/sounds/LICENSE`.
