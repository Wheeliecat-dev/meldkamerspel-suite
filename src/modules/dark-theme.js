MKS.module({
    id: 'dark-theme',
    name: 'Donker thema',
    short: 'Thema',
    icon: '🌙',
    category: 'look',
    description: 'Donkere versie van de echte spel-interface: dezelfde knoppen en panelen, alleen donkere kleuren en IBM Plex-letters. Werkt ook in de pop-upvensters.',
    at: 'start',
    frames: 'all',
    live: true,
    settings: [
        { key: 'darkMap', label: 'Donkere kaart', type: 'bool', default: true, help: 'Kaarttegels donker maken. Voertuigen en gebouwen houden hun eigen kleur.' },
        { key: 'dimIcons', label: 'Kaarticonen iets dimmen', type: 'bool', default: true, help: 'Iconen 20% donkerder, zodat ze niet fel afsteken tegen de donkere kaart.' },
        { key: 'teamChip', label: 'Team-knop in missiebalk', type: 'bool', default: true, help: 'Snelknop naast de missiefilters voor de team-meldingen (Aan/Uit).' },
    ],

    run(ctx) {
        /* ========================================================================
         * This is a pure CSS reskin — confirmed live against the real DOM
         * (Bootstrap 3: .navbar-default, .panel, .list-group-item, .label-*,
         * .btn-*, .dropdown-menu, .modal, ...). It targets those stock Bootstrap
         * classes directly, so it applies everywhere the game uses them —
         * including inside the building/vehicle edit lightbox iframes, since
         * @match runs this in every matching frame, not just the top page.
         *
         * The map's basemap tiles are dark-moded via a CSS filter on Leaflet's
         * tile pane only (invert + hue-rotate). Markers/popups/tooltips live in
         * separate sibling panes in Leaflet's DOM structure, not inside the tile
         * pane, so they're completely unaffected and keep their real colors —
         * confirmed live (an earlier attempt to "counter-invert" the marker pane
         * was wrong: sibling elements don't inherit each other's filters, so
         * that just inverted the markers pointlessly instead of restoring them).
         * ==================================================================== */

        const css = `
            /* @import only works as the first rule of a sheet */
            @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

            :root {
                --bg: #0a0e13;
                --surface: #11161d;
                --surface-2: #171e27;
                --surface-3: #1e2733;
                --surface-4: #29333f;
                --border: #26303c;
                --text: #c9d1d9;
                --text-dim: #a7b1bd;
                --text-faint: #6b7684;
                --accent: #4fb3c6;
                /* Muted on purpose — the stock Bootstrap reds/greens are tuned for
                   a white background and turn near-neon on a dark one. These are
                   the same hues pulled down in lightness/saturation so they read
                   as calm status color, not a warning klaxon. */
                --danger: #c1666b;
                --danger-dim: #3a1f21;
                --warning: #c99a5b;
                --warning-dim: #3a2f1a;
                --ok: #6faf8c;
                --ok-dim: #1c3327;
                --info: #7a9bcc;
                --info-dim: #1c2740;
            }

            html, body {
                background: var(--bg) !important;
                color: var(--text) !important;
            }
            body, .container-fluid, #main_container, #content {
                font-family: 'IBM Plex Sans', -apple-system, sans-serif !important;
            }
            code, pre, .label, .badge {
                font-family: 'IBM Plex Mono', ui-monospace, monospace !important;
            }

            /* ---- top navbar ---- */
            .navbar-default {
                background: var(--surface) !important;
                border-color: var(--border) !important;
            }
            .navbar-default .navbar-brand,
            .navbar-default .navbar-nav > li > a,
            .navbar-default .navbar-text {
                color: var(--text) !important;
            }
            .navbar-default .navbar-nav > li > a:hover,
            .navbar-default .navbar-nav > li > a:focus {
                color: var(--accent) !important;
                background: var(--surface-2) !important;
            }
            .navbar-default .navbar-nav > .open > a,
            .navbar-default .navbar-nav > .active > a {
                background: var(--surface-2) !important;
                color: var(--accent) !important;
            }

            /* ---- dropdown menus (the big blind spot on a naive reskin) ---- */
            .dropdown-menu {
                background: var(--surface-2) !important;
                border-color: var(--border) !important;
                box-shadow: 0 12px 28px -12px rgba(0,0,0,.6) !important;
            }
            .dropdown-menu > li > a {
                color: var(--text-dim) !important;
            }
            .dropdown-menu > li > a:hover,
            .dropdown-menu > li > a:focus {
                background: var(--surface-3) !important;
                color: var(--text) !important;
            }
            .dropdown-menu .divider {
                background: var(--border) !important;
            }

            /* ---- panels, wells, list groups (Posten list, incident cards, ...) ---- */
            .panel, .panel-default, .panel-body, .well,
            .list-group-item, #main_container, .modal-content {
                background: var(--surface) !important;
                border-color: var(--border) !important;
                color: var(--text) !important;
            }
            .panel-heading, .panel-footer, .modal-header, .modal-footer {
                background: var(--surface-2) !important;
                border-color: var(--border) !important;
            }
            .list-group-item.active, .list-group-item.active:hover {
                background: var(--surface-3) !important;
                border-color: var(--accent) !important;
                color: var(--text) !important;
            }

            /* ---- tables ---- */
            .table { color: var(--text) !important; }
            .table > thead > tr > th,
            .table > tbody > tr > td,
            .table > tbody > tr > th {
                border-color: var(--border) !important;
                padding: 9px 10px !important;
            }
            .table > thead > tr > th {
                padding: 9px 10px !important;
            }
            .table-striped > tbody > tr:nth-of-type(odd) {
                background: var(--surface-2) !important;
            }
            .table-hover > tbody > tr:hover {
                background: var(--surface-3) !important;
            }

            /* ---- forms ---- */
            .form-control, input[type=text], input[type=search], input[type=password],
            input[type=email], input[type=number], textarea, select {
                background: var(--surface-2) !important;
                border-color: var(--border) !important;
                color: var(--text) !important;
            }
            .form-control:focus {
                border-color: var(--accent) !important;
                box-shadow: 0 0 0 2px rgba(49,196,221,0.25) !important;
            }
            .form-control::placeholder { color: var(--text-faint) !important; }
            .input-group-addon {
                background: var(--surface-3) !important;
                border-color: var(--border) !important;
                color: var(--text-dim) !important;
            }

            /* ---- buttons — recolor, never restyle shape/size ---- */
            .btn-default {
                background: var(--surface-3) !important;
                border-color: var(--border) !important;
                color: var(--text) !important;
            }
            .btn-default:hover, .btn-default:focus {
                background: #29333f !important;
                color: var(--text) !important;
            }
            .btn-primary, .btn-success, .btn-warning, .btn-danger, .btn-info {
                border-radius: 7px !important;
                transition: filter .12s ease, transform .05s ease !important;
            }
            .btn-primary:hover, .btn-success:hover, .btn-warning:hover, .btn-danger:hover, .btn-info:hover {
                filter: brightness(1.12);
            }
            .btn-primary:active, .btn-success:active, .btn-warning:active, .btn-danger:active, .btn-info:active {
                transform: translateY(1px);
            }
            .btn-primary { background: var(--accent) !important; border-color: var(--accent) !important; color: #04262c !important; }
            .btn-success { background: var(--ok) !important; border-color: var(--ok) !important; color: #08201a !important; }
            .btn-warning { background: var(--warning) !important; border-color: var(--warning) !important; color: #2a1f0c !important; }
            .btn-danger  { background: var(--danger) !important; border-color: var(--danger) !important; color: #2a1315 !important; }
            .btn-info    { background: var(--info) !important; border-color: var(--info) !important; color: #10182a !important; }
            .btn-link { color: var(--accent) !important; }

            /* ---- labels/badges — keep semantic colors, just adjust for dark bg ---- */
            .label-default { background: var(--surface-3) !important; color: var(--text-dim) !important; }
            .label-danger  { background: var(--danger) !important; color: #2a1315 !important; }
            .label-warning { background: var(--warning) !important; color: #2a1f0c !important; }
            .label-success { background: var(--ok) !important; color: #08201a !important; }
            .label-info    { background: var(--info) !important; color: #10182a !important; }
            .label-primary { background: var(--accent) !important; color: #04262c !important; }
            .badge { background: var(--surface-3) !important; color: var(--text) !important; }

            /* ---- alerts ---- */
            .alert-danger  { background: var(--danger-dim) !important; border-color: var(--danger) !important; color: #e7b3b6 !important; }
            .alert-warning { background: var(--warning-dim) !important; border-color: var(--warning) !important; color: #e7cda4 !important; }
            .alert-success { background: var(--ok-dim) !important; border-color: var(--ok) !important; color: #b7dcc8 !important; }
            .alert-info    { background: var(--info-dim) !important; border-color: var(--info) !important; color: #c1d0ea !important; }

            /* ---- links, headings, misc text ---- */
            a { color: var(--accent) !important; }
            a:hover, a:focus { color: #7ecbdb !important; }
            h1, h2, h3, h4, h5, h6, .panel-title, .panel-title a {
                color: var(--text) !important;
                font-weight: 600 !important;
            }
            hr { border-color: var(--border) !important; }
            .text-muted { color: var(--text-faint) !important; }

            /* ---- progress bars — thinner, rounded, soft glow instead of a flat block ---- */
            .progress {
                background: var(--surface-3) !important;
                border-radius: 6px !important;
                box-shadow: inset 0 1px 2px rgba(0,0,0,.35) !important;
                overflow: hidden !important;
                height: 14px !important;
            }
            .progress-bar {
                border-radius: 6px !important;
            }
            .progress-bar-danger  { background: var(--danger) !important; }
            .progress-bar-warning { background: var(--warning) !important; }
            .progress-bar-success { background: var(--ok) !important; }
            .progress-bar-info    { background: var(--info) !important; }

            /* ---- incident cards in the right-hand meldingen sidebar ----
               Real structure (confirmed live): .panel.panel-default carries one
               of .mission_panel_red / _yellow / _green depending on status. We
               turn that into a single colored left edge (the actual signal you
               asked to keep) and hide the verbose "Missende voertuigen: ..."
               alert box inside it — the color alone already says what the list
               text used to spell out. */
            .mission_visibility .panel {
                border-radius: 9px !important;
                border-width: 1px !important;
                border-left-width: 4px !important;
                background: var(--surface-2) !important;
                overflow: hidden;
            }
            .mission_panel_red    { border-left-color: var(--danger) !important; }
            .mission_panel_yellow { border-left-color: var(--warning) !important; }
            .mission_panel_green  { border-left-color: var(--ok) !important; }
            .mission_visibility .panel-body { background: transparent !important; }
            .mission_visibility .panel-body .alert { display: none !important; }
            .mission_visibility h3, .mission_visibility h4, .mission_visibility a {
                font-family: 'IBM Plex Sans', sans-serif !important;
                font-weight: 600 !important;
                letter-spacing: .01em !important;
                /* the title is a real anchor tag, which the generic global link
                   color rule below would otherwise turn link-blue/purple — a
                   dispatch console reads better with the title as plain
                   readable text, not looking like a visited hyperlink. */
                color: var(--text) !important;
            }
            .mission_visibility a:hover {
                color: var(--accent) !important;
            }

            /* ---- incident detail lightbox (mission_header_info / mission_patient /
               the vehicle picker table) — these use game-specific classes, not
               plain Bootstrap, and were missed by the generic rules above. ---- */
            .mission_header_info {
                background: var(--surface) !important;
                color: var(--text) !important;
                border-bottom: 1px solid var(--border) !important;
            }
            .mission_patient {
                background: var(--surface-3) !important;
                border: 1px solid var(--border) !important;
                border-radius: 7px !important;
                color: var(--text) !important;
                padding: 10px 12px !important;
            }

            /* ---- readability/spacing pass on the mission body — same fix
               applies to every incident type (fire/police/ambulance), confirmed
               against a fire mission live: text was sitting edge-to-edge with
               no breathing room. ---- */
            #iframe-inside-container .alert {
                padding: 12px 16px !important;
                line-height: 1.55 !important;
                font-size: 13.5px !important;
                border-radius: 7px !important;
            }
            #iframe-inside-container h3,
            #iframe-inside-container h4 {
                margin: 22px 0 12px !important;
                font-size: 15px !important;
            }
            #iframe-inside-container .row {
                margin-bottom: 4px;
            }
            .aao_btn {
                margin: 3px 5px 3px 0 !important;
                padding: 5px 10px !important;
                border-radius: 6px !important;
            }
            .tab-content, .tab-pane {
                background: transparent !important;
            }
            .nav-tabs { border-color: var(--border) !important; }
            .nav-tabs > li > a {
                background: var(--surface-2) !important;
                border-color: var(--border) !important;
                color: var(--text-dim) !important;
            }
            .nav-tabs > li.active > a, .nav-tabs > li.active > a:hover, .nav-tabs > li.active > a:focus {
                background: var(--surface-3) !important;
                border-color: var(--border) !important;
                color: var(--text) !important;
            }
            table, table tr, table td, table th {
                background: transparent !important;
                color: var(--text) !important;
                border-color: var(--border) !important;
            }
            .tablesorter-header {
                background: var(--surface-2) !important;
                color: var(--text-dim) !important;
            }

            /* ---- chat / toast / lightbox chrome ---- */
            #toast_layer .toast {
                background: var(--surface-2) !important;
                color: var(--text) !important;
            }
            .close { color: var(--text) !important; opacity: 0.6 !important; }
            .close:hover { opacity: 1 !important; }

            /* the map container's OWN background shows through any tile that
               hasn't loaded yet (confirmed live: rgb(221,221,221) light grey) —
               most visible while zooming/panning fast. Dark it so a loading gap
               reads as "map", not a flash of grey/white. */
            .leaflet-container {
                background: var(--surface) !important;
            }

            /* ---- building list rows in the Posten sidebar — every other row's
               caption bar has its own light background (confirmed live:
               #building_list_caption at rgb(243,243,243), a striping effect the
               generic .panel/.list-group rules above don't reach). ---- */
            .building_list_caption {
                background: var(--surface-2) !important;
                color: var(--text) !important;
            }

            /* ---- lightbox chrome — the outer box (#lightbox_box, confirmed
               live at rgb(250,250,250)) is what's actually visible as a white
               flash the instant you open an incident/building, before the
               iframe inside it has painted its own (already-dark) content. Any
               <iframe> gets the same treatment as a general safety net. ---- */
            #lightbox_box {
                background: var(--surface) !important;
            }
            iframe {
                background: var(--bg) !important;
            }

            /* ---- explanatory empty-state notes in the meldingen panel — pure
               clutter once you know the game, not a styling problem. Confirmed
               live ids: #patient_no_transports ("besteld vervoer"),
               #critical_no_transports ("Interfacilitair Transport"). ---- */
            #patient_no_transports, #critical_no_transports {
                display: none !important;
            }

            /* ---- teamchat pinned banner — same category as the two "no
               transports" notes above: a static explainer, not something a
               returning player needs repeated every time. Confirmed live id:
               #alliance_chat_header_info. ---- */
            #alliance_chat_header_info {
                display: none !important;
            }

            /* ---- scrollbars (Chromium) ---- */
            ::-webkit-scrollbar { width: 10px; height: 10px; }
            ::-webkit-scrollbar-track { background: var(--surface); }
            ::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 5px; }
            ::-webkit-scrollbar-thumb:hover { background: var(--surface-4); }
        `;

        // Map rules are separate so each can be turned off on its own.
        // The basemap goes dark via a CSS filter on Leaflet's tile pane only;
        // markers/popups/tooltips sit in SEPARATE sibling panes, so they keep
        // their real colours (an earlier counter-invert of the marker pane was
        // wrong: siblings don't inherit each other's filters).
        const MAP_CSS = '.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.94) contrast(0.92) saturate(0.7); }';
        // Plain brightness reduction, not an invert: icons keep their colours.
        const ICON_CSS = '.leaflet-marker-icon { filter: brightness(0.8); }';

        const styles = [];
        function addStyle(id, text) {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = text;
            (document.head || document.documentElement).appendChild(style);
            styles.push(style);
            return style;
        }
        let mapStyle, iconStyle;
        function inject() {
            addStyle('mks-dark-theme', css);
            mapStyle = addStyle('mks-dark-theme-map', MAP_CSS);
            iconStyle = addStyle('mks-dark-theme-icons', ICON_CSS);
            applyCfg();
        }
        function applyCfg() {
            if (mapStyle) mapStyle.disabled = !ctx.cfg.darkMap;
            if (iconStyle) iconStyle.disabled = !ctx.cfg.dimIcons;
            if (!ctx.cfg.teamChip) document.getElementById('mks-team-toggle')?.remove();
        }
        ctx.onSettings(applyCfg);

        // document-start means <head> may not exist yet in some frames — retry
        // once it does, rather than waiting for the whole page (that would let
        // the stock light theme flash first).
        let headObs = null;
        if (document.head) inject();
        else {
            headObs = new MutationObserver((_, obs) => {
                if (document.head) { inject(); obs.disconnect(); }
            });
            headObs.observe(document.documentElement, { childList: true });
        }

        /* ========================================================================
         * "Team" shortcut chip in the missions stats bar.
         *
         * This does NOT reimplement the team-notifications feature — it's a
         * thin proxy button next to the existing prio/mission-type filter icons
         * (#missions-panel-main) that just calls .click() on whichever of the
         * real #alliance_radio_off / #alliance_radio_on toggle links (confirmed
         * live, normally tucked away in the Status panel) is currently visible,
         * and mirrors its Aan/Uit state back onto itself. All actual toggle
         * logic — which incidents show, notification behavior — stays exactly
         * the site's own; this is purely a shortcut for reaching it.
         * ==================================================================== */
        function syncTeamChip(chip) {
            const on = document.getElementById('alliance_radio_on');
            const isOn = !!(on && on.offsetParent !== null);
            chip.textContent = isOn ? 'Team: Aan' : 'Team: Uit';
            chip.className = 'btn btn-xs mks-team-toggle ' + (isOn ? 'btn-success' : 'btn-danger');
        }

        function installTeamChip() {
            const bar = document.getElementById('missions-panel-main');
            if (!bar || document.getElementById('mks-team-toggle')) return;

            const chip = document.createElement('a');
            chip.id = 'mks-team-toggle';
            chip.href = '#';
            chip.style.marginLeft = '4px';
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                const off = document.getElementById('alliance_radio_off');
                const on = document.getElementById('alliance_radio_on');
                const real = (off && off.offsetParent !== null) ? off : on;
                if (real) real.click();
                // the site's own click handler swaps which of the two real
                // links is visible synchronously, but give it a tick in case
                // that ever becomes async.
                setTimeout(() => syncTeamChip(chip), 50);
            });

            bar.appendChild(chip);
            syncTeamChip(chip);
        }

        // #missions-panel-main is populated after the page's own JS runs, well
        // after document-start — poll for it (cheap, and self-stops once the
        // chip exists) rather than trying to hook the site's own init timing.
        // Also re-syncs an existing chip in case the real toggle was flipped
        // some other way (e.g. a keyboard shortcut) since the last click.
        const chipTimer = setInterval(() => {
            if (!ctx.cfg.teamChip) return;
            const existing = document.getElementById('mks-team-toggle');
            if (existing) syncTeamChip(existing);
            else installTeamChip();
        }, 1000);

        return {
            stop() {
                headObs?.disconnect();
                clearInterval(chipTimer);
                styles.forEach((st) => st.remove());
                document.getElementById('mks-team-toggle')?.remove();
            },
        };
    },
});
