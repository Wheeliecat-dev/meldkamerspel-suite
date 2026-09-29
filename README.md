# Wheeliecat's Meldkamerspel Scripts

> **Work in progress.** These scripts are still changing a lot and may contain bugs. Use them at your own risk and check what they do.

By **Wheeliecat**. All my [meldkamerspel.com](https://meldkamerspel.com) userscripts in one Tampermonkey script, with a dashboard to turn each one on or off and change its settings. Open it via **⚙️ Wheeliecat's scripts → Dashboard** in the game's navbar.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Click the install link:
   - **[Install Wheeliecat's Meldkamerspel Scripts](https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/meldkamerspel-suite.user.js)**
3. Tampermonkey checks for updates by itself, so you always get the latest version.

Install only one channel. If both are installed, the second one to load does nothing.

**Beta** (for testing, updates often, may break):
[meldkamerspel-suite-beta.user.js](https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/meldkamerspel-suite-beta.user.js)

## What's inside

| Script | What it does |
|---|---|
| Donker thema | Dark version of the game UI |
| Kleinere kaarticonen | Smaller vehicle and building icons on the map |
| Voertuig zoeken | Search bar in the alarm window |
| Ontbrekende voertuigen laden | Loads the full vehicle list in the alarm window |
| Creditfilter | Hide missions by credit range |
| Inzetvoorstellen maken | Creates **a lot** (570+) of dispatch presets. Only runs when you click it |
| Voertuignamen | Renames vehicles to real Dutch call signs. **Cannot be undone.** |
| Gebouwnamen | Renames buildings to real names. **Cannot be undone.** |
| Personeel | All personnel in one table, with stats |
| Inkomsten | Tracks your credits over time |
| Dekkingskaart | Map layer showing response-time coverage |
| Plaatsingsadvies | Shows real OpenStreetMap features while placing a building |

## Development

Source is in `src/` (`src/core` = dashboard, `src/modules` = one file per script). Build:

```
node build.js           # beta only
node build.js release   # beta + stable (bump VERSION in build.js first)
```

The installable `.user.js` files are short loaders (only the header). The code is in `dist/lib/`, loaded with `@require` and checked with a sha256 hash, so Tampermonkey stores it locally and runs it without delay.

Commit and push `dist/`. Tampermonkey picks up the new version via `@updateURL`.
