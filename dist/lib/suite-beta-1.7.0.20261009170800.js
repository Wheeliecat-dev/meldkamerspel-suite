/* Wheeliecat's Meldkamerspel Scripts (beta) v1.7.0.20261009170800 — https://github.com/Wheeliecat-dev/meldkamerspel-suite */

/* eslint-disable no-console */
/* ============================================================================
 * SUITE CORE
 * ============================================================================
 * Every script is a module: MKS.module({ id, name, ..., run(ctx) }).
 * The core decides which modules run on this page, stores their on/off
 * state and settings (GM storage, key mks.suite.v1), and draws the
 * dashboard, the "Wheeliecat's scripts" navbar menu and the status dock.
 *
 * Module definition:
 *   id, name, icon, category, description
 *   at:       'start' (document-start) | 'ready' (DOM parsed) | 'load'
 *   frames:   'top' (main window only) | 'all' (also lightbox iframes)
 *   pages:    optional RegExp on location.pathname
 *   pageNote: shown in the dashboard when the module does not run here
 *   live:     true = run() may return { stop() }; on/off works without reload
 *   warning:  big red callout in the dashboard (HTML)
 *   confirmOn: text of a confirm() shown before the module is turned on
 *   settings: [{ key, label, type, default, help, min, max, step, unit, options, group, advanced }]
 *             group: sub-heading above the first setting of a group; advanced: under "Geavanceerd"
 *             type: bool | number | range | select | text
 *
 * ctx (passed to run):
 *   ctx.cfg                 current settings (same object, updated in place)
 *   ctx.W                   the page window (unsafeWindow)
 *   ctx.log/warn/err        console with the module name
 *   ctx.status(text, opts)  opts: { tone: ok|warn|error|busy|idle, progress: [done,total], dock: bool }
 *   ctx.actions([...])      buttons in the dashboard: { label, run, kind: primary|danger, title, confirm }
 *   ctx.panel(render)       render(el) draws extra content in the dashboard detail view
 *   ctx.refresh()           re-draw that panel (when the dashboard shows it)
 *   ctx.menu(item)          entry in the navbar menu: { icon, label, title, run }
 *   ctx.onSettings(fn)      settings apply live; without it a change asks for a reload
 *   ctx.set(key, value)     change one of the module's own settings
 *   ctx.open()              open the dashboard on this module
 * ========================================================================== */
const MKS = (() => {
    'use strict';

    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const IS_TOP = window.top === window.self;
    const VERSION = '1.7.0.20261009170800';
    const CHANNEL = 'beta';
    const STATE_KEY = 'mks.suite.v1';
    const LAST_KEY = 'mks.suite.lastView';

    const CATEGORIES = [
        { id: 'look', label: 'Weergave' },
        { id: 'missions', label: 'Inzetten' },
        { id: 'auto', label: 'Automatisch' },
        { id: 'names', label: 'Namen' },
        { id: 'tools', label: 'Overzichten' },
        { id: 'map', label: 'Kaart & gebouwen' },
    ];

    // Old standalone scripts each had their own GM storage. These key
    // prefixes are what the suite modules read, so they can be imported.
    const IMPORT_PREFIXES = ['vn_', 'bn_', 'incomeTracker.', 'personnelOverview.'];

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nl = (n) => Math.round(Number(n) || 0).toLocaleString('nl-NL');

    /* ------------------------------------------------------------------------
     * STATE
     * ---------------------------------------------------------------------- */
    function loadState() {
        try { return JSON.parse(GM_getValue(STATE_KEY, '{}')) || {}; } catch (e) { return {}; }
    }
    const state = loadState();
    state.enabled = state.enabled || {};
    state.settings = state.settings || {};
    const saveState = () => GM_setValue(STATE_KEY, JSON.stringify(state));

    const defs = [];
    const byId = {};
    const rt = {}; // id -> runtime info

    // Everything starts off: each player picks what they want.
    const isEnabled = (def) => !!state.enabled[def.id];
    const applies = (def) => (def.frames === 'all' || IS_TOP) && (!def.pages || def.pages.test(location.pathname));

    function settingsOf(def) {
        const saved = state.settings[def.id] || {};
        const out = {};
        for (const s of def.settings || []) out[s.key] = s.key in saved ? saved[s.key] : s.default;
        return out;
    }

    /* ------------------------------------------------------------------------
     * MODULE RUNTIME
     * ---------------------------------------------------------------------- */
    function runtime(def) {
        if (!rt[def.id]) {
            rt[def.id] = {
                cfg: settingsOf(def), running: false, handle: null, error: null, needsReload: false,
                status: null, actions: [], panel: null, menus: [], onSettings: null,
            };
        }
        return rt[def.id];
    }

    function makeCtx(def) {
        const r = runtime(def);
        const tag = `%c[${def.name}]`;
        const css = 'color:#31c4dd';
        return {
            id: def.id,
            W,
            cfg: r.cfg,
            esc,
            nl,
            get active() { return isEnabled(def) && r.running; },
            log: (...a) => console.log(tag, css, ...a),
            warn: (...a) => console.warn(`[${def.name}]`, ...a),
            err: (...a) => console.error(`[${def.name}]`, ...a),
            status(text, opts = {}) {
                r.status = text == null ? null : { text: String(text), tone: 'idle', ...opts };
                ui.statusChanged(def.id);
            },
            actions(list) { r.actions = list || []; ui.detailChanged(def.id, false); },
            panel(render) { r.panel = render; ui.detailChanged(def.id, true); },
            refresh() { ui.detailChanged(def.id, true); },
            menu(item) { r.menus.push(item); nav.render(); },
            onSettings(fn) { r.onSettings = fn; },
            set(key, value) { setSetting(def, key, value); ui.changed(def.id, true); },
            open() { ui.open(def.id); },
        };
    }

    function start(def) {
        const r = runtime(def);
        if (r.running) return;
        r.running = true;
        r.error = null;
        try {
            const out = def.run(makeCtx(def));
            if (out && typeof out.then === 'function') out.catch((e) => fail(def, e));
            else r.handle = out || null;
        } catch (e) {
            fail(def, e);
        }
    }

    function fail(def, e) {
        const r = runtime(def);
        r.error = e;
        console.error(`[${def.name}] crashed`, e);
        ui.statusChanged(def.id);
    }

    function stop(def) {
        const r = runtime(def);
        if (!r.running) return;
        try { r.handle && r.handle.stop && r.handle.stop(); } catch (e) { console.error(`[${def.name}] stop failed`, e); }
        r.running = false;
        r.handle = null;
        r.status = null;
        r.actions = [];
        r.panel = null;
        r.menus = [];
        nav.render();
    }

    function schedule(def) {
        const go = () => start(def);
        if (def.at === 'start') return go();
        if (def.at === 'load') {
            if (document.readyState === 'complete') go();
            else window.addEventListener('load', go, { once: true });
            return;
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
        else go();
    }

    function setEnabled(def, on) {
        if (on && def.confirmOn && !confirm(def.confirmOn)) {
            ui.changed(def.id);
            return;
        }
        state.enabled[def.id] = on;
        saveState();
        const r = runtime(def);
        if (!applies(def)) return ui.changed(def.id);
        if (def.live) {
            r.needsReload = false;
            if (on) start(def); else stop(def);
        } else {
            // Non-live modules keep running until reload: observers and
            // intervals can't be pulled out cleanly.
            r.needsReload = on !== r.running;
        }
        ui.changed(def.id);
    }

    function setSetting(def, key, value) {
        (state.settings[def.id] = state.settings[def.id] || {})[key] = value;
        saveState();
        const r = runtime(def);
        r.cfg[key] = value;
        if (r.running) {
            if (r.onSettings) {
                try { r.onSettings(r.cfg, key); } catch (e) { console.error(`[${def.name}] settings handler failed`, e); }
            } else {
                r.needsReload = true;
            }
        }
        ui.changed(def.id);
    }

    function resetSettings(def) {
        delete state.settings[def.id];
        saveState();
        const r = runtime(def);
        Object.assign(r.cfg, settingsOf(def));
        if (r.running) {
            if (r.onSettings) r.onSettings(r.cfg, null);
            else r.needsReload = true;
        }
        ui.changed(def.id, true);
    }

    /* ------------------------------------------------------------------------
     * STYLE
     * ---------------------------------------------------------------------- */
    const CSS = `
    #mks-dash, #mks-dock, .mks-ui {
        --m-bg:#0a0e13; --m-s1:#11161d; --m-s2:#171e27; --m-s3:#1e2733; --m-s4:#29333f;
        --m-bd:#26303c; --m-bd2:#34404e; --m-tx:#e7ecf1; --m-dim:#9aa6b4; --m-faint:#66717e;
        --m-ac:#31c4dd; --m-ac-d:#133d46; --m-ok:#3ecf8e; --m-ok-d:#123526; --m-wa:#f0a83c; --m-wa-d:#3d2d12;
        --m-er:#ef4a52; --m-er-d:#401a1d;
        --m-sans:'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
        --m-mono:'IBM Plex Mono', ui-monospace, Consolas, monospace;
    }
    #mks-dash { position:fixed; inset:0; z-index:100050; background:rgba(3,6,10,.62); display:flex;
        align-items:center; justify-content:center; padding:24px; font:13px/1.45 var(--m-sans); color:var(--m-tx); }
    #mks-dash *, #mks-dock * { box-sizing:border-box; }
    #mks-dash .mks-win { width:min(1180px,100%); height:min(820px,100%); background:var(--m-s1); border:1px solid var(--m-bd);
        border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 80px -20px rgba(0,0,0,.7); }
    #mks-dash .mks-top { display:flex; align-items:center; gap:14px; padding:12px 16px; background:var(--m-s2); border-bottom:1px solid var(--m-bd); }
    #mks-dash .mks-brand { display:flex; align-items:center; gap:10px; white-space:nowrap; }
    #mks-dash .mks-brand b { font-size:15px; font-weight:600; }
    #mks-dash .mks-logo { width:26px; height:26px; border-radius:7px; background:var(--m-ac); color:#03242b; display:grid; place-items:center; font-weight:700; font-size:13px; }
    #mks-dash .mks-ver { font:500 11px var(--m-mono); color:var(--m-faint); }
    #mks-dash .mks-count { font:500 12px var(--m-mono); color:var(--m-dim); margin-left:auto; white-space:nowrap; }
    #mks-dash input.mks-search { width:220px !important; }
    #mks-dash .mks-x { width:32px; height:32px; padding:0 !important; font-size:15px !important; }
    #mks-dash .mks-reload { display:flex; align-items:center; gap:12px; padding:9px 16px; background:var(--m-wa-d); color:#ffd9a0;
        border-bottom:1px solid #5a4219; font-size:13px; }
    #mks-dash .mks-reload[hidden] { display:none; }
    #mks-dash .mks-reload button { margin-left:auto; }
    #mks-dash .mks-main { flex:1; display:flex; min-height:0; }
    #mks-dash .mks-side { width:300px; flex:none; overflow:auto; border-right:1px solid var(--m-bd); padding:8px; background:var(--m-s1); }
    #mks-dash .mks-group { font:600 10.5px var(--m-sans); letter-spacing:.1em; text-transform:uppercase; color:var(--m-faint); padding:12px 10px 5px; }
    #mks-dash .mks-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; cursor:pointer; border:1px solid transparent; }
    #mks-dash .mks-row:hover { background:var(--m-s2); }
    #mks-dash .mks-row.sel { background:var(--m-s3); border-color:var(--m-bd2); }
    #mks-dash .mks-row.off .mks-ico, #mks-dash .mks-row.off .mks-nm { opacity:.45; }
    #mks-dash .mks-ico { width:28px; height:28px; flex:none; border-radius:7px; background:var(--m-s3); display:grid; place-items:center; font-size:15px; }
    #mks-dash .mks-row.sel .mks-ico { background:var(--m-s4); }
    #mks-dash .mks-rt { flex:1; min-width:0; display:flex; flex-direction:column; }
    #mks-dash .mks-nm { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #mks-dash .mks-st { font-size:11.5px; color:var(--m-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #mks-dash .mks-st.t-ok { color:var(--m-ok); } #mks-dash .mks-st.t-warn { color:var(--m-wa); }
    #mks-dash .mks-st.t-error { color:var(--m-er); } #mks-dash .mks-st.t-busy { color:var(--m-ac); }
    #mks-dash .mks-detail { flex:1; overflow:auto; padding:22px 26px 30px; min-width:0; }
    #mks-dash .mks-dh { display:flex; align-items:center; gap:14px; }
    #mks-dash .mks-dh .mks-ico { width:44px; height:44px; font-size:22px; border-radius:10px; }
    #mks-dash .mks-dh h2 { margin:0; font:600 19px var(--m-sans); color:var(--m-tx); }
    #mks-dash .mks-dh .mks-pills { display:flex; gap:6px; margin-top:4px; flex-wrap:wrap; }
    #mks-dash .mks-dh .mks-sw { margin-left:auto; }
    #mks-dash .mks-desc { color:var(--m-dim); margin:14px 0 0; max-width:760px; font-size:13.5px; }
    #mks-dash h4.mks-h { font:600 11px var(--m-sans); letter-spacing:.1em; text-transform:uppercase; color:var(--m-faint); margin:26px 0 10px; }
    #mks-dash .mks-status { margin-top:18px; background:var(--m-s2); border:1px solid var(--m-bd); border-radius:9px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
    #mks-dash .mks-status .mks-line { display:flex; align-items:center; gap:10px; }
    #mks-dash .mks-dot { width:9px; height:9px; border-radius:50%; background:var(--m-faint); flex:none; }
    .mks-dot.t-ok { background:var(--m-ok) !important; } .mks-dot.t-warn { background:var(--m-wa) !important; }
    .mks-dot.t-error { background:var(--m-er) !important; } .mks-dot.t-busy { background:var(--m-ac) !important; animation:mks-pulse 1.2s ease-in-out infinite; }
    @keyframes mks-pulse { 50% { opacity:.35; } }
    #mks-dash .mks-bar { height:6px; background:var(--m-s4); border-radius:3px; overflow:hidden; }
    #mks-dash .mks-bar i { display:block; height:100%; background:var(--m-ac); border-radius:3px; transition:width .3s; }
    #mks-dash .mks-acts { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
    #mks-dash .mks-panel { margin-top:6px; }
    #mks-dash .mks-panel:empty { display:none; }
    #mks-dash .mks-set { display:grid; grid-template-columns:minmax(200px, 1fr) minmax(200px, 300px); gap:6px 24px; align-items:center;
        padding:11px 0; border-bottom:1px solid var(--m-bd); max-width:820px; }
    #mks-dash .mks-set:last-of-type { border-bottom:0; }
    #mks-dash .mks-set .l { font-weight:500; }
    #mks-dash .mks-sg { font:600 10.5px var(--m-sans); letter-spacing:.1em; text-transform:uppercase; color:var(--m-faint); padding:14px 0 2px; }
    #mks-dash .mks-adv { margin-top:10px; }
    #mks-dash .mks-adv > summary { display:list-item; cursor:pointer; color:var(--m-faint); font-weight:500; padding:6px 0; }
    #mks-dash .mks-set .h { display:block; color:var(--m-faint); font-size:12px; font-weight:400; margin-top:1px; }
    #mks-dash .mks-set .c { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
    #mks-dash .mks-set .u { color:var(--m-dim); font-size:12px; white-space:nowrap; }
    #mks-dash .mks-set .rv { font:500 12px var(--m-mono); color:var(--m-tx); min-width:42px; text-align:right; }
    #mks-dash .mks-reset { margin-top:12px; }
    #mks-dash .mks-empty { color:var(--m-faint); padding:28px 0; }

    /* controls — !important because the dark theme styles every input/button on the page */
    #mks-dash input[type=text], #mks-dash input[type=search], #mks-dash input[type=number], #mks-dash select, #mks-dash textarea,
    .mks-ui input[type=text], .mks-ui input[type=number], .mks-ui textarea {
        background:var(--m-bg) !important; color:var(--m-tx) !important; border:1px solid var(--m-bd2) !important; border-radius:7px !important;
        padding:6px 9px !important; font:13px var(--m-sans) !important; height:auto !important; box-shadow:none !important; margin:0 !important; width:100%; }
    #mks-dash textarea { font:12px var(--m-mono) !important; resize:vertical; }
    #mks-dash input:focus, #mks-dash select:focus, #mks-dash textarea:focus { outline:none !important; border-color:var(--m-ac) !important; }
    #mks-dash input[type=number] { width:110px; text-align:right; }
    #mks-dash input[type=range] { width:170px; accent-color:var(--m-ac); margin:0; }
    #mks-dash .mks-btn, .mks-ui .mks-btn { display:inline-flex; align-items:center; gap:6px; background:var(--m-s3) !important; color:var(--m-tx) !important;
        border:1px solid var(--m-bd2) !important; border-radius:7px !important; padding:6px 12px !important; font:500 13px var(--m-sans) !important;
        cursor:pointer; text-shadow:none !important; box-shadow:none !important; line-height:1.3 !important; }
    #mks-dash .mks-btn:hover, .mks-ui .mks-btn:hover { background:var(--m-s4) !important; }
    #mks-dash .mks-btn.primary, .mks-ui .mks-btn.primary { background:var(--m-ac) !important; border-color:var(--m-ac) !important; color:#03242b !important; }
    #mks-dash .mks-btn.primary:hover { filter:brightness(1.1); }
    #mks-dash .mks-btn.danger { color:#ffb3b7 !important; border-color:#5d2a2e !important; background:var(--m-er-d) !important; }
    #mks-dash .mks-btn[disabled] { opacity:.5; cursor:default; }
    #mks-dash .mks-btn.busy::before { content:''; width:11px; height:11px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:mks-spin .7s linear infinite; }
    @keyframes mks-spin { to { transform:rotate(360deg); } }
    #mks-dash a.mks-link { color:var(--m-ac); cursor:pointer; text-decoration:none; }
    #mks-dash a.mks-link:hover { text-decoration:underline; }

    /* switch */
    .mks-sw { position:relative; display:inline-block; width:36px; height:20px; flex:none; margin:0 !important; cursor:pointer; }
    .mks-sw input { position:absolute; opacity:0; width:0; height:0; margin:0; }
    .mks-sw i { position:absolute; inset:0; background:var(--m-s4); border-radius:10px; transition:background .15s; }
    .mks-sw i::after { content:''; position:absolute; left:3px; top:3px; width:14px; height:14px; border-radius:50%; background:#aeb8c4; transition:transform .15s, background .15s; }
    .mks-sw input:checked + i { background:var(--m-ac); }
    .mks-sw input:checked + i::after { transform:translateX(16px); background:#fff; }
    .mks-sw input:focus-visible + i { outline:2px solid var(--m-ac); outline-offset:2px; }
    .mks-sw.lg { width:44px; height:24px; } .mks-sw.lg i::after { width:18px; height:18px; } .mks-sw.lg input:checked + i::after { transform:translateX(20px); }

    /* pills, tags, tables, tiles — also used by module panels */
    .mks-pill { display:inline-flex; align-items:center; gap:5px; font:500 11.5px var(--m-sans); padding:2px 9px; border-radius:20px; background:var(--m-s3); color:var(--m-dim); white-space:nowrap; }
    .mks-pill.t-ok { background:var(--m-ok-d); color:#9ff0c8; } .mks-pill.t-warn { background:var(--m-wa-d); color:#ffd59a; }
    .mks-pill.t-error { background:var(--m-er-d); color:#ffb3b7; } .mks-pill.t-busy { background:var(--m-ac-d); color:#9fe9f5; }
    #mks-dash .mks-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; margin-top:4px; }
    #mks-dash .mks-tile { background:var(--m-s2); border:1px solid var(--m-bd); border-radius:9px; padding:11px 13px; }
    #mks-dash .mks-tile .v { font:600 21px var(--m-mono); color:var(--m-tx); font-variant-numeric:tabular-nums; }
    #mks-dash .mks-tile .k { color:var(--m-faint); font-size:11.5px; margin-top:2px; }
    #mks-dash .mks-tile.t-warn .v { color:var(--m-wa); } #mks-dash .mks-tile.t-error .v { color:var(--m-er); } #mks-dash .mks-tile.t-ok .v { color:var(--m-ok); }
    #mks-dash .mks-tblwrap { max-height:340px; overflow:auto; border:1px solid var(--m-bd); border-radius:9px; }
    #mks-dash table.mks-tbl { width:100%; border-collapse:collapse; font-size:12.5px; background:transparent !important; margin:0; }
    #mks-dash table.mks-tbl th { position:sticky; top:0; background:var(--m-s3) !important; color:var(--m-dim) !important; text-align:left; font-weight:600;
        padding:7px 10px !important; border:0 !important; border-bottom:1px solid var(--m-bd) !important; white-space:nowrap; }
    #mks-dash table.mks-tbl td { padding:6px 10px !important; border:0 !important; border-bottom:1px solid var(--m-bd) !important; color:var(--m-tx) !important;
        background:transparent !important; vertical-align:top; }
    #mks-dash table.mks-tbl tr:last-child td { border-bottom:0 !important; }
    #mks-dash table.mks-tbl td.mono, #mks-dash .mono { font-family:var(--m-mono); font-size:12px; }
    #mks-dash table.mks-tbl a { color:var(--m-ac); }
    #mks-dash .mks-dim { color:var(--m-faint); }
    #mks-dash .mks-note { color:var(--m-dim); font-size:12.5px; margin:8px 0; max-width:780px; }
    #mks-dash .mks-callout { border:1px solid #5a4219; background:var(--m-wa-d); color:#ffe0b0; border-radius:9px; padding:12px 14px; margin-top:16px; max-width:820px; }
    #mks-dash .mks-callout b { color:#fff; }
    #mks-dash .mks-callout .mks-acts { margin-top:10px; }
    #mks-dash .mks-warn { border:1px solid #6b262b; background:var(--m-er-d); color:#ffd0d3; border-radius:9px; padding:13px 15px 13px 46px;
        margin-top:16px; max-width:820px; position:relative; font-size:13.5px; }
    #mks-dash .mks-warn::before { content:'⚠'; position:absolute; left:15px; top:10px; font-size:20px; color:var(--m-er); }
    #mks-dash .mks-warn b { color:#fff; }
    #mks-dash .mks-wip { display:flex; align-items:center; gap:10px; padding:7px 16px; background:var(--m-ac-d); color:#bdeef6;
        border-bottom:1px solid #1f5966; font-size:12.5px; }
    #mks-dash .mks-wip b { color:#fff; }
    #mks-dash .mks-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px; }
    #mks-dash .mks-card { background:var(--m-s2); border:1px solid var(--m-bd); border-radius:9px; padding:12px 14px; }
    #mks-dash .mks-now { display:flex; flex-direction:column; gap:2px; }
    #mks-dash .mks-now .mks-row { cursor:pointer; }
    #mks-dash kbd { font:11px var(--m-mono); background:var(--m-s3); border:1px solid var(--m-bd2); border-radius:4px; padding:0 5px; color:var(--m-tx); }

    /* dock */
    #mks-dock { position:fixed; left:8px; bottom:8px; z-index:99990; display:flex; flex-direction:column-reverse; gap:5px; align-items:flex-start;
        font:12px/1.3 var(--m-sans); pointer-events:none; }
    #mks-dock .mks-chip { pointer-events:auto; display:flex; align-items:center; gap:7px; max-width:320px; background:rgba(17,22,29,.94); color:var(--m-tx);
        border:1px solid var(--m-bd2); border-radius:8px; padding:5px 10px 5px 8px; cursor:pointer; box-shadow:0 6px 18px -6px rgba(0,0,0,.6); }
    #mks-dock .mks-chip:hover { border-color:var(--m-ac); }
    #mks-dock .mks-chip .n { font-weight:600; white-space:nowrap; }
    #mks-dock .mks-chip .s { color:var(--m-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
    #mks-dock .mks-chip .mks-dot { width:8px; height:8px; border-radius:50%; background:var(--m-faint); flex:none; }
    #mks-dock .mks-chip .mks-bar { width:60px; height:4px; background:var(--m-s4); border-radius:2px; overflow:hidden; flex:none; }
    #mks-dock .mks-chip .mks-bar i { display:block; height:100%; background:var(--m-ac); }

    @media (max-width: 760px) {
        #mks-dash { padding:0; }
        #mks-dash .mks-win { height:100%; border-radius:0; }
        #mks-dash .mks-main { flex-direction:column; }
        #mks-dash .mks-side { width:auto; max-height:38vh; border-right:0; border-bottom:1px solid var(--m-bd); }
        #mks-dash .mks-detail { padding:16px; }
        #mks-dash .mks-set { grid-template-columns:1fr; }
        #mks-dash .mks-set .c { justify-content:flex-start; }
        #mks-dash input.mks-search { width:120px !important; }
        #mks-dash .mks-count { display:none; }
    }
    `;

    let styled = false;
    function ensureStyle() {
        if (styled || !document.head) return;
        styled = true;
        const font = document.createElement('link');
        font.rel = 'stylesheet';
        font.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
        document.head.appendChild(font);
        const st = document.createElement('style');
        st.id = 'mks-suite-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    /* ------------------------------------------------------------------------
     * NAVBAR MENU
     * ---------------------------------------------------------------------- */
    const nav = (() => {
        let li, menu;
        // Far right of the navbar: the last item of Bootstrap's right-hand
        // list, or a right-hand list of our own when the page has none.
        function rightBar() {
            const collapse = document.querySelector('#navbar-main-collapse') || document.querySelector('.navbar .navbar-collapse');
            const scope = collapse || document.querySelector('.navbar');
            if (!scope) return null;
            const lists = scope.querySelectorAll('ul.nav.navbar-nav.navbar-right');
            if (lists.length) return lists[lists.length - 1];
            if (!scope.querySelector('ul.nav.navbar-nav')) return null;
            const ul = document.createElement('ul');
            ul.className = 'nav navbar-nav navbar-right';
            ul.id = 'mks-nav-right';
            scope.appendChild(ul);
            return ul;
        }
        function mount() {
            if (li && li.isConnected) return true;
            const bar = rightBar();
            if (!bar) return false;
            li = document.createElement('li');
            li.className = 'dropdown';
            li.id = 'mks-nav';
            li.innerHTML = '<a href="#" class="dropdown-toggle" title="Aan/uit en instellingen">⚙️ Wheeliecat&#39;s scripts <span class="caret"></span></a><ul class="dropdown-menu dropdown-menu-right"></ul>';
            menu = li.querySelector('ul');
            bar.appendChild(li);
            // Stay the last item when the game or another script adds one later.
            new MutationObserver(() => {
                if (li.parentNode === bar && bar.lastElementChild !== li) bar.appendChild(li);
            }).observe(bar, { childList: true });
            li.firstChild.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                li.classList.toggle('open');
            });
            document.addEventListener('click', (e) => { if (!li.contains(e.target)) li.classList.remove('open'); });
            render();
            return true;
        }
        function render() {
            if (!menu) return;
            menu.innerHTML = '';
            const add = (label, fn, title) => {
                const item = document.createElement('li');
                const a = document.createElement('a');
                a.href = '#';
                a.textContent = label;
                if (title) a.title = title;
                a.addEventListener('click', (e) => { e.preventDefault(); li.classList.remove('open'); fn(); });
                item.appendChild(a);
                menu.appendChild(item);
            };
            add('🧩 Dashboard', () => ui.open());
            const items = defs.flatMap((d) => (rt[d.id] ? rt[d.id].menus : []));
            if (items.length) {
                const div = document.createElement('li');
                div.className = 'divider';
                menu.appendChild(div);
                items.forEach((m) => add(`${m.icon ? m.icon + ' ' : ''}${m.label}`, m.run, m.title));
            }
        }
        return { mount, render };
    })();

    /* ------------------------------------------------------------------------
     * STATUS DOCK (bottom-left) — replaces the old per-script floating panels
     * ---------------------------------------------------------------------- */
    const dock = (() => {
        let el;
        function render() {
            if (!IS_TOP || !document.body) return;
            const chips = defs.filter((d) => rt[d.id] && rt[d.id].running && rt[d.id].status && rt[d.id].status.dock);
            if (!el) {
                if (!chips.length) return;
                el = document.createElement('div');
                el.id = 'mks-dock';
                document.body.appendChild(el);
            }
            el.innerHTML = chips.map((d) => {
                const s = rt[d.id].status;
                const p = s.progress && s.progress[1] ? Math.min(100, (s.progress[0] / s.progress[1]) * 100) : null;
                return `<div class="mks-chip" data-id="${d.id}" title="${esc(d.name)} — ${esc(s.text)}\nKlik voor details">
                    <span class="mks-dot t-${esc(s.tone)}"></span><span class="n">${esc(d.short || d.name)}</span>
                    <span class="s">${esc(s.text)}</span>${p != null ? `<span class="mks-bar"><i style="width:${p}%"></i></span>` : ''}</div>`;
            }).join('');
            el.querySelectorAll('.mks-chip').forEach((c) => c.addEventListener('click', () => ui.open(c.dataset.id)));
        }
        return { render };
    })();

    /* ------------------------------------------------------------------------
     * DASHBOARD
     * ---------------------------------------------------------------------- */
    const ui = (() => {
        let root = null;
        let view = null; // module id or '__home'
        let query = '';

        const HOME = '__home';

        function pillsFor(def) {
            const r = runtime(def);
            const on = isEnabled(def);
            const out = [];
            if (r.error) out.push(['t-error', 'Fout']);
            if (r.needsReload) out.push(['t-warn', 'Herladen nodig']);
            if (!on) out.push(['', 'Uit']);
            else if (!applies(def)) out.push(['', def.pageNote || 'Niet actief op deze pagina']);
            else if (r.running && !r.error) out.push(['t-ok', 'Actief']);
            return out.map(([c, t]) => `<span class="mks-pill ${c}">${esc(t)}</span>`).join('');
        }

        function rowStatus(def) {
            const r = runtime(def);
            if (r.error) return ['t-error', `Fout: ${r.error.message || r.error}`];
            if (r.needsReload) return ['t-warn', 'Herladen nodig'];
            if (!isEnabled(def)) return ['', 'Uit'];
            if (r.running && r.status) return [`t-${r.status.tone}`, r.status.text];
            if (!applies(def)) return ['', def.pageNote || 'Niet actief op deze pagina'];
            return ['', def.tagline || 'Aan'];
        }

        function switchHtml(checked, cls = '') {
            return `<label class="mks-sw ${cls}" title="Aan/uit"><input type="checkbox" ${checked ? 'checked' : ''}><i></i></label>`;
        }

        function open(id) {
            if (!IS_TOP) return;
            ensureStyle();
            if (!root) build();
            view = id || GM_getValue(LAST_KEY, HOME);
            if (view !== HOME && !byId[view]) view = HOME;
            renderSide();
            renderDetail();
        }

        function close() {
            if (!root) return;
            root.remove();
            root = null;
            document.removeEventListener('keydown', onKey, true);
            if (pip) { const w = pip; pip = null; w.close(); }
        }

        // Picture-in-picture (Chrome/Edge 116+): the same dashboard node moves into an
        // always-on-top window, so it keeps working while the game is used. All lookups
        // go through root, so nothing else changes. Closing that window closes the dashboard.
        let pip = null;
        const canPip = () => !!(W.documentPictureInPicture && W.documentPictureInPicture.requestWindow);
        async function popOut() {
            if (!root || pip || !canPip()) return;
            const w = await W.documentPictureInPicture.requestWindow({ width: 920, height: 720 });
            pip = w;
            const d = w.document;
            const font = d.createElement('link');
            font.rel = 'stylesheet';
            font.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
            d.head.appendChild(font);
            const st = d.createElement('style');
            st.textContent = `${CSS}
            html, body { margin:0; height:100%; background:#11161d; }
            #mks-dash.mks-pip { position:static; inset:auto; height:100vh; padding:0; background:none; }
            #mks-dash.mks-pip .mks-win { width:100%; height:100%; max-width:none; max-height:none; border:0; border-radius:0; box-shadow:none; }
            #mks-dash.mks-pip .mks-pipbtn, #mks-dash.mks-pip .mks-wip { display:none; }
            @media (max-width:760px) { #mks-dash.mks-pip .mks-side { width:210px; } #mks-dash.mks-pip input.mks-search { width:130px !important; } }`;
            d.head.appendChild(st);
            d.title = "Wheeliecat's scripts";
            root.classList.add('mks-pip');
            d.body.appendChild(root);
            d.addEventListener('keydown', onKey, true);
            w.addEventListener('pagehide', () => { if (pip === w) { pip = null; close(); } });
        }

        function onKey(e) {
            if (e.key === 'Escape' && root) { e.stopPropagation(); close(); }
        }

        function build() {
            root = document.createElement('div');
            root.id = 'mks-dash';
            root.innerHTML = `
            <div class="mks-win" role="dialog" aria-label="Wheeliecat's scripts">
              <div class="mks-top">
                <div class="mks-brand"><span class="mks-logo">W</span><b>Wheeliecat's scripts</b><span class="mks-ver">v${VERSION}</span>${CHANNEL === 'beta' ? '<span class="mks-pill t-warn">beta</span>' : ''}</div>
                <span class="mks-count"></span>
                <input class="mks-search" type="search" placeholder="Zoek script…" aria-label="Zoek script">
                ${canPip() ? '<button class="mks-btn mks-x mks-pipbtn" title="Zwevend venster: blijft boven alles, ook als je het spel gebruikt">⧉</button>' : ''}
                <button class="mks-btn mks-x mks-close" title="Sluiten (Esc)">✕</button>
              </div>
              <div class="mks-wip"><span>🚧</span><span><b>Werk in uitvoering.</b> Deze scripts worden nog volop aangepast. Er kunnen fouten in zitten;
                gebruik ze op eigen risico en controleer wat ze doen.</span></div>
              <div class="mks-reload" hidden><span>Sommige wijzigingen werken pas na herladen van de pagina.</span>
                <button class="mks-btn primary">Nu herladen</button></div>
              <div class="mks-main">
                <div class="mks-side"></div>
                <div class="mks-detail"></div>
              </div>
            </div>`;
            document.body.appendChild(root);
            root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
            root.querySelector('.mks-close').onclick = close;
            const pipBtn = root.querySelector('.mks-pipbtn');
            if (pipBtn) pipBtn.onclick = () => popOut().catch((e) => console.error('[MKS] picture-in-picture failed', e));
            root.querySelector('.mks-reload button').onclick = () => location.reload();
            const search = root.querySelector('.mks-search');
            search.value = query;
            search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderSide(); });
            // Keep the game's hotkeys quiet while typing in the dashboard.
            ['keydown', 'keyup', 'keypress'].forEach((t) => root.addEventListener(t, (e) => {
                if (e.key !== 'Escape') e.stopPropagation();
            }));
            document.addEventListener('keydown', onKey, true);
        }

        function select(id) {
            view = id;
            GM_setValue(LAST_KEY, id);
            root.querySelectorAll('.mks-row[data-id]').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
            renderDetail();
        }

        function renderSide() {
            if (!root) return;
            const side = root.querySelector('.mks-side');
            const match = (d) => !query || `${d.name} ${d.description} ${d.id}`.toLowerCase().includes(query);
            let html = `<div class="mks-row ${view === HOME ? 'sel' : ''}" data-id="${HOME}"><span class="mks-ico">🧩</span>
                <span class="mks-rt"><span class="mks-nm">Overzicht</span><span class="mks-st">Status, importeren, back-up</span></span></div>`;
            for (const cat of CATEGORIES) {
                const list = defs.filter((d) => d.category === cat.id && match(d));
                if (!list.length) continue;
                html += `<div class="mks-group">${esc(cat.label)}</div>`;
                for (const d of list) {
                    const [tone, text] = rowStatus(d);
                    html += `<div class="mks-row ${view === d.id ? 'sel' : ''} ${isEnabled(d) ? '' : 'off'}" data-id="${d.id}">
                        <span class="mks-ico">${d.icon || '•'}</span>
                        <span class="mks-rt"><span class="mks-nm">${esc(d.name)}${d.warning ? ' <span title="Let op: zie waarschuwing" style="color:var(--m-wa)">⚠</span>' : ''}</span><span class="mks-st ${tone}">${esc(text)}</span></span>
                        ${switchHtml(isEnabled(d))}</div>`;
                }
            }
            side.innerHTML = html;
            side.querySelectorAll('.mks-row').forEach((row) => {
                row.addEventListener('click', (e) => { if (!e.target.closest('.mks-sw')) select(row.dataset.id); });
                const cb = row.querySelector('.mks-sw input');
                if (cb) cb.addEventListener('change', () => setEnabled(byId[row.dataset.id], cb.checked));
            });
            const on = defs.filter(isEnabled).length;
            root.querySelector('.mks-count').textContent = `${on}/${defs.length} aan`;
            root.querySelector('.mks-reload').hidden = !defs.some((d) => runtime(d).needsReload);
        }

        function renderDetail() {
            if (!root) return;
            const el = root.querySelector('.mks-detail');
            el.scrollTop = 0;
            if (view === HOME) return renderHome(el);
            const def = byId[view];
            const r = runtime(def);
            el.innerHTML = `
                <div class="mks-dh">
                  <span class="mks-ico">${def.icon || '•'}</span>
                  <div><h2>${esc(def.name)}</h2><div class="mks-pills">${pillsFor(def)}</div></div>
                  ${switchHtml(isEnabled(def), 'lg')}
                </div>
                <p class="mks-desc">${def.description || ''}</p>
                ${def.warning ? `<div class="mks-warn">${def.warning}</div>` : ''}
                <div class="mks-status-slot"></div>
                <div class="mks-acts"></div>
                <div class="mks-panel"></div>
                <div class="mks-settings"></div>`;
            el.querySelector('.mks-dh .mks-sw input').addEventListener('change', (e) => setEnabled(def, e.target.checked));
            renderStatus(def);
            renderActions(def);
            renderPanel(def);
            renderSettings(def, el.querySelector('.mks-settings'));
            void r;
        }

        function renderStatus(def) {
            const slot = root && view === def.id && root.querySelector('.mks-status-slot');
            if (!slot) return;
            const r = runtime(def);
            const s = r.error ? { text: `Gecrasht: ${r.error.message || r.error}. Zie console (F12).`, tone: 'error' } : (r.running ? r.status : null);
            if (!s) { slot.innerHTML = ''; return; }
            const p = s.progress && s.progress[1] ? Math.min(100, (s.progress[0] / s.progress[1]) * 100) : null;
            slot.innerHTML = `<div class="mks-status"><div class="mks-line"><span class="mks-dot t-${esc(s.tone)}"></span><span>${esc(s.text)}</span></div>
                ${p != null ? `<div class="mks-bar"><i style="width:${p}%"></i></div>` : ''}</div>`;
        }

        function renderActions(def) {
            const box = root && view === def.id && root.querySelector('.mks-acts');
            if (!box) return;
            const r = runtime(def);
            box.innerHTML = '';
            if (!r.running) return;
            for (const a of r.actions) {
                if (a.hidden) continue;
                const b = document.createElement('button');
                b.className = `mks-btn ${a.kind || ''}`;
                b.textContent = a.label;
                if (a.title) b.title = a.title;
                if (a.disabled) b.disabled = true;
                b.addEventListener('click', async () => {
                    if (a.confirm && !confirm(a.confirm)) return;
                    b.disabled = true;
                    b.classList.add('busy');
                    try { await a.run(); } catch (e) { console.error(`[${def.name}]`, e); alert(`${def.name}: ${e.message || e}`); }
                    if (b.isConnected) { b.disabled = false; b.classList.remove('busy'); }
                });
                box.appendChild(b);
            }
        }

        function renderPanel(def) {
            const box = root && view === def.id && root.querySelector('.mks-panel');
            if (!box) return;
            const r = runtime(def);
            box.innerHTML = '';
            if (!r.running || !r.panel) return;
            try { r.panel(box); } catch (e) { box.innerHTML = `<p class="mks-note">Paneel kon niet laden: ${esc(e.message)}</p>`; console.error(e); }
        }

        function renderSettings(def, box) {
            const list = def.settings || [];
            if (!list.length) { box.innerHTML = ''; return; }
            const cfg = settingsOf(def);
            // s.group: a sub-heading above the first setting of each group.
            // s.advanced: tucked away under "Geavanceerd" (fine-tuning).
            let lastGroup = null;
            const rows = (items) => items.map(([s, i]) => {
                const head = s.group && s.group !== lastGroup ? `<div class="mks-sg">${esc(s.group)}</div>` : '';
                if (s.group) lastGroup = s.group;
                return head + rowHtml(s, i);
            }).join('');
            const indexed = list.map((s, i) => [s, i]);
            const main = indexed.filter(([s]) => !s.advanced);
            const adv = indexed.filter(([s]) => s.advanced);
            box.innerHTML = `<h4 class="mks-h">Instellingen</h4>` + rows(main)
                + (adv.length ? `<details class="mks-adv"><summary>Geavanceerd (${adv.length})</summary>${(lastGroup = null, rows(adv))}</details>` : '')
                + `<div class="mks-reset"><a class="mks-link">Standaardwaarden herstellen</a></div>`;
            function rowHtml(s, i) {
                const v = cfg[s.key];
                let control;
                if (s.type === 'bool') control = switchHtml(!!v);
                else if (s.type === 'select') {
                    control = `<select>${s.options.map((o) => {
                        const [val, lab] = Array.isArray(o) ? o : [o, o];
                        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
                    }).join('')}</select>`;
                } else if (s.type === 'range') {
                    control = `<input type="range" min="${s.min}" max="${s.max}" step="${s.step || 1}" value="${esc(v)}"><span class="rv">${esc(fmtRange(s, v))}</span>`;
                } else if (s.type === 'number') {
                    control = `<input type="number" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''} step="${s.step || 'any'}" value="${esc(v)}">${s.unit ? `<span class="u">${esc(s.unit)}</span>` : ''}`;
                } else {
                    control = `<input type="text" value="${esc(v)}" placeholder="${esc(s.placeholder || '')}">`;
                }
                return `<div class="mks-set" data-i="${i}"><div class="l">${esc(s.label)}${s.help ? `<span class="h">${s.help}</span>` : ''}</div><div class="c">${control}</div></div>`;
            }

            box.querySelectorAll('.mks-set').forEach((row) => {
                const s = list[Number(row.dataset.i)];
                const input = row.querySelector('input, select');
                const read = () => {
                    if (s.type === 'bool') return input.checked;
                    if (s.type === 'number' || s.type === 'range') {
                        let n = Number(input.value);
                        if (!Number.isFinite(n)) n = s.default;
                        if (s.min != null) n = Math.max(s.min, n);
                        if (s.max != null) n = Math.min(s.max, n);
                        return n;
                    }
                    if (s.type === 'select' && typeof s.default === 'number') return Number(input.value);
                    return input.value;
                };
                if (s.type === 'range') {
                    input.addEventListener('input', () => { row.querySelector('.rv').textContent = fmtRange(s, input.value); });
                }
                input.addEventListener('change', () => {
                    const v = read();
                    if (s.type === 'number') input.value = v;
                    setSetting(def, s.key, v);
                });
            });
            box.querySelector('.mks-reset a').addEventListener('click', () => resetSettings(def));
        }

        const fmtRange = (s, v) => (s.format ? s.format(Number(v)) : `${v}${s.unit || ''}`);

        function renderHome(el) {
            const running = defs.filter((d) => runtime(d).running && runtime(d).status);
            const on = defs.filter(isEnabled).length;
            el.innerHTML = `
                <div class="mks-dh"><span class="mks-ico">🧩</span><div><h2>Overzicht</h2>
                  <div class="mks-pills"><span class="mks-pill t-ok">${on} aan</span><span class="mks-pill">${defs.length - on} uit</span></div></div></div>
                ${on ? '' : `<div class="mks-callout"><b>Alles staat nog uit.</b> Kies links welke scripts je wilt gebruiken:
                  klik op een script om te lezen wat het doet, en zet het aan met het schuifje.</div>`}
                <p class="mks-desc">Wheeliecat's scripts voor Meldkamerspel, allemaal in één. Zet ze links aan of uit en klik op een script voor de instellingen.
                  De meeste wijzigingen werken direct; anders verschijnt bovenin een knop om te herladen.</p>
                <h4 class="mks-h">Nu actief op deze pagina</h4>
                <div class="mks-now">${running.length ? running.map((d) => {
                    const s = runtime(d).status;
                    return `<div class="mks-row" data-go="${d.id}"><span class="mks-ico">${d.icon}</span><span class="mks-rt">
                        <span class="mks-nm">${esc(d.name)}</span><span class="mks-st t-${esc(s.tone)}">${esc(s.text)}</span></span></div>`;
                }).join('') : '<div class="mks-empty">Geen scripts met een status op deze pagina.</div>'}</div>

                <h4 class="mks-h">Opslag van de oude losse scripts importeren</h4>
                <p class="mks-note">Tampermonkey bewaart gegevens per script. Stap je over van de losse scripts, neem dan hun geheugen mee
                  (vooral de voertuig- en gebouwnamer, anders nummeren die opnieuw). In Tampermonkey: open het oude script →
                  tabblad <b>Opslag</b> (Storage; zet zo nodig Instellingen → Configuratiemodus op <i>Geavanceerd</i>) → kopieer alles en plak het hier.
                  Plak per script, één voor één.</p>
                <textarea class="mks-imp" rows="5" placeholder='{ "data": { "vn_assignments": "…" } }'></textarea>
                <div class="mks-acts"><button class="mks-btn primary mks-imp-go">Importeren</button><span class="mks-imp-out mks-note"></span></div>

                <h4 class="mks-h">Back-up van dashboard-instellingen</h4>
                <p class="mks-note">Aan/uit en instellingen van alle scripts, als tekst. Handig om naar een andere browser over te zetten.</p>
                <div class="mks-acts"><button class="mks-btn mks-exp">Kopieer instellingen</button><button class="mks-btn mks-res">Plak instellingen…</button></div>
                <p class="mks-note" style="margin-top:22px">Tip: <kbd>Esc</kbd> sluit dit venster.</p>`;
            el.querySelectorAll('[data-go]').forEach((r) => r.addEventListener('click', () => select(r.dataset.go)));
            el.querySelector('.mks-imp-go').onclick = () => {
                const out = el.querySelector('.mks-imp-out');
                try {
                    const n = importStorage(el.querySelector('.mks-imp').value);
                    out.textContent = n ? `${n} sleutels geïmporteerd. Herlaad de pagina.` : 'Geen bruikbare sleutels gevonden.';
                    if (n) defs.forEach((d) => { if (runtime(d).running) runtime(d).needsReload = true; });
                    renderSide();
                } catch (e) {
                    out.textContent = `Kon niet lezen: ${e.message}`;
                }
            };
            el.querySelector('.mks-exp').onclick = async () => {
                const text = JSON.stringify({ enabled: state.enabled, settings: state.settings });
                try { await navigator.clipboard.writeText(text); alert('Gekopieerd.'); } catch (e) { prompt('Kopieer:', text); }
            };
            el.querySelector('.mks-res').onclick = () => {
                const text = prompt('Plak de gekopieerde instellingen:');
                if (!text) return;
                try {
                    const j = JSON.parse(text);
                    state.enabled = j.enabled || {};
                    state.settings = j.settings || {};
                    saveState();
                    location.reload();
                } catch (e) { alert(`Ongeldige tekst: ${e.message}`); }
            };
        }

        // A change to a module: update its row, and the detail view when shown.
        function changed(id, full) {
            if (!root) { dock.render(); return; }
            renderSide();
            if (view === id) {
                if (full) renderDetail();
                else {
                    const def = byId[id];
                    const pills = root.querySelector('.mks-dh .mks-pills');
                    if (pills) pills.innerHTML = pillsFor(def);
                    const sw = root.querySelector('.mks-dh .mks-sw input');
                    if (sw) sw.checked = isEnabled(def);
                    renderStatus(def);
                    renderActions(def);
                    renderPanel(def);
                }
            }
            dock.render();
        }

        let sideQueued = false;
        function statusChanged(id) {
            dock.render();
            if (!root) return;
            // Status can change many times a second while a queue runs.
            if (!sideQueued) {
                sideQueued = true;
                requestAnimationFrame(() => {
                    sideQueued = false;
                    if (!root) return;
                    for (const d of defs) {
                        const row = root.querySelector(`.mks-row[data-id="${d.id}"] .mks-st`);
                        if (!row) continue;
                        const [tone, text] = rowStatus(d);
                        row.className = `mks-st ${tone}`;
                        row.textContent = text;
                    }
                    if (view === HOME) {
                        const now = root.querySelector('.mks-now');
                        if (now && !now.matches(':hover')) renderDetail();
                    }
                });
            }
            if (view === id) renderStatus(byId[id]);
        }

        function detailChanged(id, panelToo) {
            if (!root || view !== id) return;
            renderActions(byId[id]);
            if (panelToo) renderPanel(byId[id]);
        }

        return { open, close, changed, statusChanged, detailChanged, isOpen: () => !!root };
    })();

    /* ------------------------------------------------------------------------
     * IMPORT OLD STORAGE
     * ---------------------------------------------------------------------- */
    // Accepts Tampermonkey's storage view ({ data: {...} }) or a flat object.
    function importStorage(text) {
        const j = JSON.parse(text);
        const data = j && typeof j.data === 'object' && j.data ? j.data : j;
        let n = 0;
        for (const [k, v] of Object.entries(data || {})) {
            if (!IMPORT_PREFIXES.some((p) => k.startsWith(p))) continue;
            // The old scripts stored JSON strings; keep strings as they are.
            GM_setValue(k, typeof v === 'string' ? v : JSON.stringify(v));
            n++;
        }
        return n;
    }

    /* ------------------------------------------------------------------------
     * BOOT
     * ---------------------------------------------------------------------- */
    function module(def) {
        def.category = def.category || 'tools';
        defs.push(def);
        byId[def.id] = def;
    }

    function boot() {
        // Stable and beta installed together would run everything twice.
        if (W.__mksSuiteLoaded) {
            console.warn(`[Wheeliecat's scripts] ${W.__mksSuiteLoaded} is al geladen; deze kopie (${CHANNEL}) doet niets. Zet een van beide uit in Tampermonkey.`);
            return;
        }
        W.__mksSuiteLoaded = `Wheeliecat's scripts (${CHANNEL})`;
        for (const def of defs) {
            runtime(def);
            if (isEnabled(def) && applies(def)) schedule(def);
        }
        if (!IS_TOP) return;
        const ready = () => {
            ensureStyle();
            let tries = 0;
            const t = setInterval(() => { if (nav.mount() || ++tries > 20) clearInterval(t); }, 500);
            nav.mount();
            dock.render();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
        else ready();
        W.mksSuite = { open: ui.open, modules: defs.map((d) => d.id) };
    }

    return { module, boot, esc, nl, W, IS_TOP };
})();

/* ==== module: dark-theme ================================================== */
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

/* ==== module: small-vehicle-icons ========================================= */
MKS.module({
    id: 'small-vehicle-icons',
    name: 'Kleinere kaarticonen',
    short: 'Iconen',
    icon: '🔍',
    category: 'look',
    description: 'Maakt voertuig- en gebouwiconen op de kaart kleiner, zodat drukke gebieden overzichtelijk blijven. Inzetten houden hun grootte.',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [
        { key: 'vehicleScale', label: 'Voertuigen', type: 'range', default: 0.6, min: 0.3, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'buildingScale', label: 'Gebouwen', type: 'range', default: 0.6, min: 0.3, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    ],

    run(ctx) {
        const VEHICLE_SEL = '.leaflet-marker-icon[src*="vehicle_graphic_images"]';
        // Covers building_*.png and policechief_building_*.png. Same bottom-centre anchor.
        const BUILDING_SEL = '.leaflet-marker-icon[src*="/images/"][src*="building_"]';
        const SEL = `${VEHICLE_SEL}, ${BUILDING_SEL}`;
        const SCALE_RE = /\s*scale\([^)]*\)/;

        // Leaflet positions markers with an inline `transform: translate3d(x, y, 0)`.
        // The CSS `scale` property is applied BEFORE `transform`, so it would scale
        // that translate too and pull icons toward the map corner. Instead, append
        // scale() to the transform itself so it applies to the icon only. Leaflet
        // rewrites the transform on every zoom/move, so re-append when it does.
        // Origin 50% 100% is Leaflet's bottom-centre anchor for these icons.
        const style = document.createElement('style');
        style.textContent = `${SEL} { transform-origin: 50% 100%; }`;
        document.head.appendChild(style);

        const scaleOf = (el) => (el.matches(BUILDING_SEL) ? ctx.cfg.buildingScale : ctx.cfg.vehicleScale);

        function fix(el) {
            const t = el.style.transform;
            if (!t) return;
            const want = `scale(${scaleOf(el)})`;
            if (t.includes(want)) return;
            el.style.transform = `${t.replace(SCALE_RE, '')} ${want}`;
        }

        function scan(node) {
            if (node.nodeType !== 1) return;
            if (node.matches(SEL)) fix(node);
            node.querySelectorAll(SEL).forEach(fix);
        }

        scan(document.documentElement);

        const obs = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'attributes') {
                    if (m.target.matches(SEL)) fix(m.target);
                } else {
                    m.addedNodes.forEach(scan);
                }
            }
        });
        obs.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['style'],
        });

        ctx.onSettings(() => scan(document.documentElement));

        return {
            stop() {
                obs.disconnect();
                style.remove();
                document.querySelectorAll(SEL).forEach((el) => {
                    el.style.transform = el.style.transform.replace(SCALE_RE, '');
                });
            },
        };
    },
});

/* ==== module: vehicle-search ============================================== */
MKS.module({
    id: 'vehicle-search',
    name: 'Voertuig zoeken',
    icon: '🔎',
    category: 'missions',
    description: 'Zoekbalk boven de voertuigtabs in het alarmeervenster. Filtert op naam, post of huidige inzet, in alle tabs. '
        + 'Meerdere woorden = allemaal, <kbd>,</kbd> = of, <kbd>-woord</kbd> = niet. <kbd>Enter</kbd> vinkt het eerste voertuig aan (alarmeert niet), '
        + '<kbd>Esc</kbd> wist, <kbd>/</kbd> springt naar de balk. Alleen weergave: vinkt of verstuurt nooit zelf.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    settings: [],

    run() {
        /* ========================================================================
         * How to search
         *   - Several words = all must match:  "ON NH"  -> ON units from NH.
         *   - Comma = either:                  "ts, hv" -> TS or HV.
         *   - Start a word with - to exclude:  "arnhem -noord".
         *   - Enter ticks the first visible, unticked vehicle (it does NOT alarm).
         *   - Every tab is searched, including Dooralarmeren; each tab name
         *     shows its number of matches while you search.
         *   - Esc clears the search. "/" anywhere on the page jumps to the bar.
         * Ticked vehicles always stay visible, so a search never hides a
         * selection you already made.
         * ==================================================================== */

        const ROW_SEL = 'tr:has(input.vehicle_checkbox)';
        const BAR_ID = 'mks-vehicle-search';

        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

        // "a b, c -d" -> [[{t:'a'},{t:'b'}], [{t:'c'},{t:'d',not:true}]]
        function parseQuery(q) {
            return norm(q).split(',').map((part) => part.trim().split(' ').filter(Boolean)
                .filter((w) => w !== '-')
                .map((w) => (w.startsWith('-') ? { t: w.slice(1), not: true } : { t: w })))
                .filter((g) => g.length);
        }

        function rowMatches(text, groups) {
            return groups.some((g) => g.every((w) => text.includes(w.t) !== !!w.not));
        }

        function rowText(tr) {
            // Cache per row; the game replaces rows when it reloads a table, so
            // a new row simply gets a new cache entry.
            if (tr.dataset.mksSearch === undefined) tr.dataset.mksSearch = norm(tr.textContent);
            return tr.dataset.mksSearch;
        }

        let input, counter, tabsEl;

        // Every vehicle row in every tab. The "Dooralarmeren" tab may use a
        // different checkbox class than the normal tabs, so besides the game's
        // input.vehicle_checkbox rows, take any checkbox row inside the tab
        // panes that belong to the vehicle tabs.
        function allRows() {
            const rows = new Set(document.querySelectorAll(ROW_SEL));
            for (const pane of tabPanes().map((t) => t.pane)) {
                pane.querySelectorAll('tr:has(input[type="checkbox"])').forEach((tr) => rows.add(tr));
            }
            return [...rows].filter((tr) => !tr.querySelector('th'));
        }
        const rowCheckbox = (tr) => tr.querySelector('input.vehicle_checkbox') || tr.querySelector('input[type="checkbox"]');

        // [{ link, pane }] for each vehicle tab (Alles, …, Dooralarmeren).
        function tabPanes() {
            if (!tabsEl) return [];
            return [...tabsEl.querySelectorAll('a')].map((link) => {
                const id = (link.getAttribute('href') || '').startsWith('#') ? link.getAttribute('href').slice(1) : link.getAttribute('aria-controls');
                const pane = id ? document.getElementById(id) : null;
                return pane ? { link, pane } : null;
            }).filter(Boolean);
        }

        // Some tabs (Dooralarmeren) only fill their table when opened. Open each
        // empty tab once, then switch back, so the search covers it too.
        const preloaded = new WeakSet();
        function preloadEmptyTabs() {
            const tabs = tabPanes();
            const active = tabs.find((t) => t.link.parentElement.classList.contains('active'));
            let clicked = false;
            for (const t of tabs) {
                if (preloaded.has(t.link) || t === active) continue;
                preloaded.add(t.link);
                if (!t.pane.querySelector('tr')) { t.link.click(); clicked = true; }
            }
            if (clicked && active) active.link.click();
        }

        // Show "(n)" matches behind each tab name while searching.
        function updateTabBadges(groups) {
            for (const { link, pane } of tabPanes()) {
                let badge = link.querySelector('.mks-vs-badge');
                if (!groups.length) { if (badge) badge.remove(); continue; }
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'mks-vs-badge badge';
                    badge.style.marginLeft = '5px';
                    link.appendChild(badge);
                }
                const n = [...pane.querySelectorAll('tr')].filter((tr) => rowCheckbox(tr) && tr.style.display !== 'none').length;
                if (badge.textContent !== String(n)) badge.textContent = n; // avoid re-triggering the observer
            }
        }

        function applyFilter() {
            if (!input) return;
            const groups = parseQuery(input.value);
            let shown = 0, total = 0;
            allRows().forEach((tr) => {
                total++;
                const cb = rowCheckbox(tr);
                const show = !groups.length || (cb && cb.checked) || rowMatches(rowText(tr), groups);
                tr.style.display = show ? '' : 'none';
                if (show) shown++;
            });
            counter.textContent = groups.length ? `${shown} / ${total}` : '';
            updateTabBadges(groups);
        }

        function tickFirstVisible() {
            const pane = tabPanes().find((t) => t.link.parentElement.classList.contains('active'))?.pane
                || document.querySelector('.tab-pane.active') || document;
            const rows = [...pane.querySelectorAll('tr')].filter((tr) => rowCheckbox(tr) && tr.style.display !== 'none' && tr.offsetParent !== null);
            for (const tr of rows) {
                const cb = rowCheckbox(tr);
                if (cb && !cb.checked && !cb.disabled) { cb.click(); return; }
            }
        }

        function findTabs() {
            const first = document.querySelector('input.vehicle_checkbox');
            const tabs = [...document.querySelectorAll('ul.nav-tabs')];
            // The vehicle tabs are the nav-tabs list right above the vehicle
            // table; prefer one that contains an "Alles" tab.
            return tabs.find((ul) => /\balles\b/i.test(ul.textContent) && (!first || (ul.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)))
                || (first && tabs.filter((ul) => ul.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).pop())
                || null;
        }

        function addBar() {
            if (tabsEl && !tabsEl.isConnected) tabsEl = null;
            if (!tabsEl) tabsEl = findTabs();
            if (document.getElementById(BAR_ID)) return;
            const tabs = tabsEl;
            if (!tabs) return;

            const bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;';
            bar.innerHTML = `
                <div class="input-group input-group-sm" style="flex:1;max-width:520px">
                    <span class="input-group-addon"><span class="glyphicon glyphicon-search"></span></span>
                    <input type="search" class="form-control" placeholder="Zoek voertuig, post of inzet…  (komma = of, -woord = niet)" autocomplete="off">
                </div>
                <span class="mks-vs-count" style="color:#888;font-variant-numeric:tabular-nums"></span>`;
            tabs.parentNode.insertBefore(bar, tabs);

            input = bar.querySelector('input');
            counter = bar.querySelector('.mks-vs-count');
            input.addEventListener('input', () => {
                if (input.value.trim()) preloadEmptyTabs();
                applyFilter();
            });
            input.addEventListener('keydown', (e) => {
                // Keep the game's own hotkeys from firing while typing.
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); tickFirstVisible(); }
                if (e.key === 'Escape') { input.value = ''; applyFilter(); input.blur(); }
            });
            input.addEventListener('keyup', (e) => e.stopPropagation());
            input.addEventListener('keypress', (e) => e.stopPropagation());
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== '/' || !input) return;
            const t = e.target;
            if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
            e.preventDefault();
            input.focus();
            input.select();
        });

        addBar();
        applyFilter();

        // Tabs load their tables lazily and "load missing vehicles" appends rows,
        // so re-apply whenever rows are added. Debounced to one pass per frame.
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                addBar();
                if (input && input.value) applyFilter();
            });
        }).observe(document.body, { childList: true, subtree: true });
    },
});

/* ==== module: preset-search =============================================== */
MKS.module({
    id: 'preset-search',
    name: 'AAO zoeken',
    icon: '🔍',
    category: 'missions',
    description: 'Zoekbalk boven de AAO\'s in het alarmeervenster. Zoekt door alle categorieën tegelijk. '
        + 'Meerdere woorden = allemaal. <kbd>Enter</kbd> klikt de eerste AAO (vinkt voertuigen aan, alarmeert niet), '
        + '<kbd>Esc</kbd> wist. De rode knop links vinkt alle geselecteerde voertuigen uit.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    live: true,
    settings: [],

    run() {
        // While searching, every category pane is shown at once and the
        // category tabs are hidden, so the result ignores categories.
        // Buttons stay the game's own elements, so clicking works as usual.
        const BTN_SEL = '.aao_btn';
        const BAR_ID = 'mks-preset-search';
        const ON = 'mks-ps-on';
        const HIDE = 'mks-ps-hide';

        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

        const style = document.createElement('style');
        style.textContent = `
            .${ON} > .tab-pane { display: block !important; opacity: 1 !important; }
            .${HIDE} { display: none !important; }`;
        document.head.appendChild(style);

        let input, counter, content, tabs;

        const buttons = () => [...document.querySelectorAll(BTN_SEL)];
        const btnText = (b) => norm(`${b.getAttribute('title') || ''} ${b.textContent}`);

        // The category tabs (Klein / Middel / ...) and the .tab-content that
        // holds their panes. Both are null when the player has no categories.
        function findContainers() {
            const first = document.querySelector(BTN_SEL);
            content = first ? first.closest('.tab-content') : null;
            let prev = content && content.previousElementSibling;
            while (prev && !prev.matches('ul.nav-tabs')) prev = prev.previousElementSibling;
            tabs = prev || null;
        }

        function applyFilter() {
            if (!input) return;
            const words = norm(input.value).split(' ').filter(Boolean);
            const searching = words.length > 0;
            if (content) content.classList.toggle(ON, searching);
            if (tabs) tabs.classList.toggle(HIDE, searching);

            let shown = 0;
            const all = buttons();
            all.forEach((b) => {
                const show = !searching || words.every((w) => btnText(b).includes(w));
                b.classList.toggle(HIDE, !show);
                if (show) shown++;
            });
            // Hide categories without a match, so no empty gaps.
            if (content) {
                [...content.children].filter((p) => p.classList.contains('tab-pane')).forEach((p) => {
                    p.classList.toggle(HIDE, searching && !p.querySelector(`${BTN_SEL}:not(.${HIDE})`));
                });
            }
            counter.textContent = searching ? `${shown} / ${all.length}` : '';
        }

        function addBar() {
            if (document.getElementById(BAR_ID)) return;
            findContainers();
            const first = document.querySelector(BTN_SEL);
            if (!first) return;
            const anchor = tabs || content || first.parentElement;

            const bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;';
            bar.innerHTML = `
                <button type="button" class="btn btn-danger btn-sm mks-ps-reset" title="Alle aangevinkte voertuigen uitvinken">
                    <span class="glyphicon glyphicon-remove"></span>
                </button>
                <div class="input-group input-group-sm" style="flex:1;max-width:360px">
                    <span class="input-group-addon"><span class="glyphicon glyphicon-search"></span></span>
                    <input type="search" class="form-control" placeholder="Zoek AAO…" autocomplete="off">
                </div>
                <span class="mks-ps-count" style="color:#888;font-variant-numeric:tabular-nums"></span>`;
            anchor.parentNode.insertBefore(bar, anchor);

            input = bar.querySelector('input');
            counter = bar.querySelector('.mks-ps-count');
            // click() instead of setting .checked, so the game updates its
            // own counters and the selected-vehicle summary.
            bar.querySelector('.mks-ps-reset').addEventListener('click', () => {
                document.querySelectorAll('input.vehicle_checkbox:checked').forEach((cb) => cb.click());
            });
            input.addEventListener('input', applyFilter);
            input.addEventListener('keydown', (e) => {
                // Keep the game's preset hotkeys from firing while typing.
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const hit = buttons().find((b) => !b.classList.contains(HIDE));
                    if (hit && input.value.trim()) hit.click();
                }
                if (e.key === 'Escape') { input.value = ''; applyFilter(); input.blur(); }
            });
            input.addEventListener('keyup', (e) => e.stopPropagation());
            input.addEventListener('keypress', (e) => e.stopPropagation());
        }

        addBar();

        // The mission window can re-render parts of the page; put the bar
        // back and re-apply the search when that happens.
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (input && !input.isConnected) input = null;
                addBar();
                if (input && input.value) applyFilter();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        return {
            stop() {
                observer.disconnect();
                if (input) { input.value = ''; applyFilter(); }
                document.getElementById(BAR_ID)?.remove();
                style.remove();
                input = null;
            },
        };
    },
});

/* ==== module: mission-helper ============================================== */
MKS.module({
    id: 'mission-helper',
    name: 'Meldinghelper',
    icon: '📋',
    category: 'missions',
    description: 'Rechtsboven in het alarmeervenster een lijstje met wat je moet sturen: de benodigde voertuigen, water en personeel. '
        + 'De gegevens komen uit de hulppagina van het spel zelf. Op de kaartpagina worden ze alvast opgehaald voor de inzetten in je lijst, '
        + 'zodat het lijstje meteen staat als je een inzet opent.',
    at: 'ready',
    frames: 'all',
    pages: /^\/(missions\/\d+\/?)?$/,
    pageNote: 'In het alarmeervenster (en op de kaartpagina om vooruit te laden)',
    live: true,
    settings: [
        { key: 'chances', label: 'Ook kansen op extra voertuigen tonen', type: 'bool', default: true,
            help: 'Bijvoorbeeld "Hoogwerker 80%". Die hoef je niet meteen te sturen.' },
        { key: 'moveMissing', label: 'Ontbrekende voertuigen links ernaast', type: 'bool', default: true,
            help: 'Zet het rode vak "Missende voertuigen" van het spel in de linkerhelft, naast het lijstje, in plaats van eronder.' },
    ],

    run(ctx) {
        const CACHE_KEY = 'mks-mission-helper-v5';
        const CACHE_MS = 3 * 24 * 3600 * 1000;
        const esc = ctx.esc;
        // Left over from the first beta version.
        try { ['mks-mission-helper-cache', 'mks-mission-helper-open', 'mks-mission-helper-v2', 'mks-mission-helper-v3', 'mks-mission-helper-v4'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }

        /* ========================================================================
         * DATA — the game's own help page (/einsaetze/{type}?additive_overlays=x).
         * From the "Voertuig en personeel vereisten" table:
         *   "Benodigde X" = n       -> send n × X
         *   "X benodigd" = amount   -> e.g. water in litres
         *   "X benodigd waarschijnlijkheid" = % -> chance (optional)
         * and "Benodigde Personeel" from "Overige informatie".
         * Parsed result is cached per type + overlays in localStorage.
         * ==================================================================== */
        // A mission is its type plus optional variants: overlay_index picks a
        // numbered variant (e.g. 878 with index 1 needs 3 instead of 1 police
        // car), additive_overlays adds letters like "a". Both come from the
        // data-overlay-index / data-additive-overlays attributes.
        const attr = (el, name) => (el.getAttribute(name) || '').replace(/^null$/, '');
        const keyOf = (type, overlays, index) => `${type}|${overlays || ''}|${index || ''}`;
        function urlOf(type, overlays, index) {
            const q = new URLSearchParams();
            if (overlays) q.set('additive_overlays', overlays);
            if (index) q.set('overlay_index', index);
            const qs = q.toString();
            return `/einsaetze/${type}${qs ? `?${qs}` : ''}`;
        }

        function readCache() {
            try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
        }
        function cached(key) {
            const hit = readCache()[key];
            return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
        }
        function store(key, data) {
            const all = readCache();
            const now = Date.now();
            for (const k in all) if (now - all[k].at > CACHE_MS) delete all[k];
            all[key] = { at: now, ...data };
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
        }

        function parse(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const need = [], chance = [], patients = {};
            let credits = null;
            for (const table of doc.querySelectorAll('table')) {
                const title = ((table.querySelector('thead th') || {}).textContent || '').trim();
                const vehicles = /voertuig|personeel/i.test(title);
                const other = /overige/i.test(title);
                if (/beloning/i.test(title)) {
                    for (const tr of table.querySelectorAll('tbody tr')) {
                        if (tr.cells.length >= 2 && /credits/i.test(tr.cells[0].textContent)) credits = Number(tr.cells[1].textContent.replace(/\D/g, '')) || null;
                    }
                    continue;
                }
                if (!vehicles && !other) continue;
                for (const tr of table.querySelectorAll('tbody tr')) {
                    if (tr.cells.length < 2) continue;
                    const label = tr.cells[0].textContent.trim().replace(/\s+/g, ' ');
                    const value = tr.cells[1].textContent.trim().replace(/\s+/g, ' ');
                    let m;
                    if ((m = label.match(/^(.*?)\s+benodigd waarschijnlijkheid$/i))) chance.push({ name: m[1], v: value });
                    else if (/^Minimaal aantal patiënten$/i.test(label)) patients.min = value;
                    else if (/^Maximale? aantal patiënten$/i.test(label)) patients.max = value;
                    else if (/patiënt getransporteerd/i.test(label)) patients.transport = value;
                    else if (other && !/^Benodigde? Personeel$/i.test(label)) continue;
                    else if ((m = label.match(/^Benodigd(?:e)?(?: aantal)?\s+(.*)$/i))) need.push({ name: m[1], v: value });
                    else if ((m = label.match(/^(.*?)\s+benodigd$/i))) need.push({ name: m[1], v: value });
                }
            }
            return { need, chance, patients, credits };
        }

        async function fetchType(type, overlays, index) {
            const res = await fetch(urlOf(type, overlays, index), { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = parse(await res.text());
            store(keyOf(type, overlays, index), data);
            return data;
        }

        /* ========================================================================
         * MAP PAGE — warm the cache for the missions in the list, slowly
         * (one help page every 1.5 s, only types not cached yet).
         * ==================================================================== */
        if (location.pathname === '/') {
            if (window.top !== window.self) return;
            let stopped = false;
            let busy = false;
            async function warm() {
                if (busy || stopped) return;
                busy = true;
                try {
                    const todo = new Map();
                    document.querySelectorAll('.missionSideBarEntry[mission_type_id]').forEach((el) => {
                        const type = el.getAttribute('mission_type_id');
                        const ov = attr(el, 'data-additive-overlays');
                        const idx = attr(el, 'data-overlay-index');
                        if (!/^\d+$/.test(type)) return;
                        const k = keyOf(type, ov, idx);
                        if (!todo.has(k) && !cached(k)) todo.set(k, [type, ov, idx]);
                    });
                    for (const [type, ov, idx] of todo.values()) {
                        if (stopped) break;
                        try { await fetchType(type, ov, idx); } catch (e) { ctx.warn('prefetch failed', type, e); }
                        await new Promise((r) => setTimeout(r, 1500));
                    }
                } finally { busy = false; }
            }
            const first = setTimeout(warm, 5000);
            const timer = setInterval(warm, 60000);
            return { stop() { stopped = true; clearTimeout(first); clearInterval(timer); } };
        }

        /* ========================================================================
         * MISSION WINDOW — list in the right half of the header, under the
         * progress bar. Drawn synchronously from cache, so nothing moves.
         * ==================================================================== */
        const info = document.getElementById('mission_general_info');
        const right = document.getElementById('mission_progress_info');
        if (!info || !right) return;
        const type = info.getAttribute('data-mission-type');
        if (!/^\d+$/.test(type || '')) return; // own/alliance large-scale events have no type
        const overlays = attr(info, 'data-additive-overlays');
        const index = attr(info, 'data-overlay-index');
        const key = keyOf(type, overlays, index);

        const style = document.createElement('style');
        style.textContent = `
            .mks-mh.alert { margin: 8px 0 0; padding: 8px 12px; font-size: 14px; line-height: 1.4; min-height: 44px; }
            .mks-mh-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, max-content); gap: 1px 28px; }
            .mks-mh-row { display: flex; gap: 6px; align-items: baseline; white-space: nowrap; min-width: 0; }
            .mks-mh-n { min-width: 2.4em; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
            .mks-mh-name { overflow: hidden; text-overflow: ellipsis; }
            .mks-mh-pct { flex: none; font-size: 11px; font-weight: 600; padding: 0 5px; border-radius: 8px; background: rgba(0,0,0,.08); }
            .mks-mh-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 16px; margin-top: 6px; padding-top: 5px;
                border-top: 1px solid rgba(0,0,0,.1); }
            .mks-mh-foot .mks-mh-credits { margin-left: auto; font-weight: 700; }
            .mks-mh-note { opacity: .6; font-size: 12px; }
            #mission_general_info > .alert-missing-vehicles { clear: both; margin: 8px 0 0; }
        `;
        document.head.appendChild(style);

        const box = document.createElement('div');
        // Same Bootstrap alert as the game's red missing-vehicles box, in green.
        box.className = 'mks-mh alert alert-success';
        right.appendChild(box);

        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        // "HOVD's" and "HOVD", "Hoogwerkers" and "Hoogwerker": same vehicle.
        const norm = (n) => n.toLowerCase().replace(/['’]s\b/g, '').replace(/(en|s)$/, '').trim();

        function render(data) {
            if (!data) { box.innerHTML = '<span class="mks-mh-note">Meldinghelper laden…</span>'; return; }
            // Plain counts go in the grid. A chance on a vehicle that is also
            // in the list ("HOVD 50%") becomes a badge on that row: it is only
            // needed that often. Other chances get their own row with the badge, except
            // MMT, which goes with the patient info in the footer. Water, foam
            // and personnel rules also go in the footer.
            const litres = (x) => /water|schuim/i.test(x.name) && /^\d+$/.test(x.v.replace(/\./g, ''));
            const counts = data.need.filter((x) => /^\d+$/.test(x.v) && !litres(x));
            const rest = data.need.filter((x) => !counts.includes(x));
            const chances = ctx.cfg.chances ? data.chance.slice() : [];
            const mmt = data.chance.find((x) => /mmt|arts/i.test(x.name));
            const badge = {};
            for (const c of chances.slice()) {
                if (c === mmt) { chances.splice(chances.indexOf(c), 1); continue; }
                const hit = counts.find((x) => norm(x.name) === norm(c.name));
                if (hit) { badge[hit.name] = c.v; chances.splice(chances.indexOf(c), 1); }
            }

            const rows = counts.map((x) => `<div class="mks-mh-row" title="${esc(`${x.v}× ${x.name}${badge[x.name] ? ` (${badge[x.name]}% kans dat dit nodig is)` : ''}`)}">`
                + `<span class="mks-mh-n">${esc(x.v)}×</span><span class="mks-mh-name">${esc(cap(x.name))}</span>`
                + `${badge[x.name] ? `<span class="mks-mh-pct">${esc(badge[x.name])}%</span>` : ''}</div>`)
                .concat(chances.map((x) => `<div class="mks-mh-row" title="${esc(`${x.v}% kans dat ${x.name} nodig is`)}">`
                    + `<span class="mks-mh-n"></span><span class="mks-mh-name">${esc(cap(x.name))}</span><span class="mks-mh-pct">${esc(x.v)}%</span></div>`));
            box.innerHTML = rows.length
                // Top to bottom, 5 per column, then the next column.
                ? `<div class="mks-mh-list" style="grid-template-rows:repeat(${Math.min(rows.length, 5)},auto)">${rows.join('')}</div>`
                : '<span class="mks-mh-note">Geen voertuigeisen: alleen patiënten of ambulance.</span>';

            const foot = rest.map((x) => `<span><b>${esc(cap(x.name))}</b> ${esc(litres(x) ? `${ctx.nl(Number(x.v.replace(/\./g, '')))} l` : x.v)}</span>`);
            const p = data.patients || {};
            if (p.max) foot.push(`<span><b>Patiënten</b> ${esc(p.min && p.min !== p.max ? `${p.min}-${p.max}` : p.max)}</span>`);
            if (p.transport) foot.push(`<span><b>Transport</b> ${esc(p.transport)}%</span>`);
            if (mmt && ctx.cfg.chances) foot.push(`<span><b>MMT</b> ${esc(mmt.v)}%</span>`);
            if (data.credits) foot.push(`<span class="mks-mh-credits">± ${ctx.nl(data.credits)} credits</span>`);
            if (foot.length) box.insertAdjacentHTML('beforeend', `<div class="mks-mh-foot">${foot.join('')}</div>`);
        }

        // The game's "missing vehicles" alert, moved into the left half of the
        // header so it sits next to the list. The game updates its contents in
        // place, so moving the element itself is safe; stop() puts it back.
        const missing = document.querySelector('.alert.alert-missing-vehicles');
        const home = missing && { parent: missing.parentNode, next: missing.nextSibling };
        function placeMissing() {
            if (!missing) return;
            if (ctx.cfg.moveMissing) info.appendChild(missing);
            else if (missing.parentNode !== home.parent) home.parent.insertBefore(missing, home.next);
        }
        placeMissing();

        let data = cached(key);
        render(data);
        if (!data) {
            fetchType(type, overlays, index)
                .then((d) => { data = d; render(d); })
                .catch((e) => { ctx.warn('help page failed', e); box.innerHTML = '<span class="mks-mh-note">Meldinghelper: hulppagina niet geladen.</span>'; });
        }
        ctx.onSettings(() => { render(data); placeMissing(); });

        return {
            stop() {
                box.remove();
                style.remove();
                if (missing && missing.parentNode !== home.parent) home.parent.insertBefore(missing, home.next);
            },
        };
    },
});

/* ==== module: auto-load-vehicles ========================================== */
MKS.module({
    id: 'auto-load-vehicles',
    name: 'Ontbrekende voertuigen laden',
    icon: '⏬',
    category: 'missions',
    description: 'Klikt in het alarmeervenster automatisch op <i>"Voertuigenweergave limiet is bereikt! Laad ontbrekende voertuigen!"</i>, zodat je altijd de hele lijst ziet.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    live: true,
    settings: [],

    run() {
        // The button is a link to /missions/<id>/missing_vehicles?... The game's own
        // click handler fetches the missing rows via AJAX and appends them to the
        // vehicle table, so we just trigger that handler.
        const SEL = 'a[href*="/missing_vehicles"]';
        const clicked = new WeakSet();

        function load() {
            document.querySelectorAll(SEL).forEach((a) => {
                if (clicked.has(a)) return;
                clicked.add(a);
                a.click();
            });
        }

        load();

        // The button can appear later (tab switch, table reload), so keep watching.
        const obs = new MutationObserver(load);
        obs.observe(document.body, { childList: true, subtree: true });
        return { stop: () => obs.disconnect() };
    },
});

/* ==== module: transport-requests ========================================== */
MKS.module({
    id: 'transport-requests',
    name: 'Verbeterde spraakaanvragen',
    icon: '📻',
    category: 'missions',
    description: 'Werk spraakaanvragen snel achter elkaar af. Een knop in de missiefilterbalk telt je open spraakaanvragen en opent de oudste. '
        + 'Een inzet met een spraakaanvraag opent die meteen. Na het kiezen van een bestemming ga je vanzelf door naar het volgende voertuig, '
        + 'daarna terug naar de inzet of dicht. Kiest nooit zelf een ziekenhuis of cel.',
    at: 'ready',
    frames: 'all',
    settings: [
        { key: 'counter', label: 'Teller in de missiefilterbalk', type: 'bool', default: true,
            help: 'Groen met het aantal open spraakaanvragen. Klik = oudste openen.' },
        { key: 'autoOpen', label: 'Spraakaanvraag openen vanuit de inzet', type: 'bool', default: true,
            help: 'Open je een inzet waar een voertuig spraak aanvraagt, dan ga je direct naar dat voertuig.' },
        { key: 'after', label: 'Na het kiezen van een bestemming', type: 'select', default: 'next',
            options: [
                ['next', 'Volgende voertuig, dan terug naar de inzet'],
                ['nextClose', 'Volgende voertuig, dan venster dicht'],
                ['mission', 'Terug naar de inzet'],
                ['close', 'Venster dicht'],
                ['none', 'Niets doen'],
            ] },
    ],

    run(ctx) {
        const W = ctx.W;
        const path = location.pathname;
        const IN_FRAME = window.top !== window.self;
        // Hidden windows of Automatisch alarmeren: jumping away there breaks its job.
        if (IN_FRAME && window.name.startsWith('mks-auto-worker:')) return;

        /* ========================================================================
         * MISSION WINDOW — jump to the vehicle that asks for a transport.
         * The game lists status-5 vehicles in a red alert with a green button
         * to /vehicles/{id}. The missing-vehicles alert is also red, skip it.
         * A vehicle we already jumped to recently is not opened again, so going
         * back to the mission never loops (e.g. when no hospital fits).
         * ==================================================================== */
        if (/^\/missions\/\d+\/?$/.test(path)) {
            if (!ctx.cfg.autoOpen) return;
            const btn = document.querySelector('.alert.alert-danger:not(.alert-missing-vehicles) a.btn.btn-success[href^="/vehicles/"]');
            if (!btn) return;
            const KEY = 'mks-transport-opened';
            let seen = {};
            try { seen = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { /* ignore */ }
            const now = Date.now();
            for (const k in seen) if (now - seen[k] > 120000) delete seen[k];
            const href = btn.getAttribute('href');
            if (seen[href]) return;
            seen[href] = now;
            try { sessionStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* ignore */ }
            btn.click();
            return;
        }

        /* ========================================================================
         * AFTER ANSWERING — the game shows the result on
         * /vehicles/{id}/patient/{building} or /vehicles/{id}/gefangener/{building}
         * with "next vehicle in status 5" (#next-vehicle-fms-5) and a green
         * button back to the mission.
         * ==================================================================== */
        const answered = /^\/vehicles\/\d+\/(patient|gefangener)\/-?\d+\/?$/.test(path);
        const next = document.getElementById('next-vehicle-fms-5');
        if (answered || (next && /^\/vehicles\/\d+\/?$/.test(path) && !document.getElementById('h2_sprechwunsch'))) {
            const mode = ctx.cfg.after;
            if (mode === 'none') return;
            const close = () => {
                if (!IN_FRAME) return;
                if (typeof W.tellParent === 'function') W.tellParent('lightboxClose();');
                else if (W.parent && typeof W.parent.lightboxClose === 'function') W.parent.lightboxClose();
            };
            if ((mode === 'next' || mode === 'nextClose') && next) return next.click();
            if (mode === 'next' || mode === 'mission') {
                const back = document.querySelector('#iframe-inside-container a.btn.btn-success[href^="/missions/"]');
                if (back) return back.click();
            }
            close();
            return;
        }

        /* ========================================================================
         * MAP PAGE — counter button in the mission filter bar.
         * Starts from /api/vehicles once, then follows the game's live status
         * messages (radioMessage). Oldest request first.
         * ==================================================================== */
        if (path !== '/' || IN_FRAME || !ctx.cfg.counter) return;
        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        const open = new Map(); // vehicleId -> { caption, since }

        const btn = document.createElement('a');
        btn.href = '#';
        btn.className = 'btn btn-xs btn-default';
        btn.style.marginLeft = '4px';
        btn.onclick = (ev) => {
            ev.preventDefault();
            const first = [...open.entries()].sort((a, b) => a[1].since - b[1].since)[0];
            if (first && typeof W.lightboxOpen === 'function') W.lightboxOpen(`/vehicles/${first[0]}`);
        };
        row.appendChild(btn);

        function render() {
            const n = open.size;
            btn.classList.toggle('btn-success', n > 0);
            btn.classList.toggle('btn-default', n === 0);
            btn.innerHTML = `<span class="glyphicon glyphicon-earphone"></span> ${n}`;
            btn.title = n
                ? `${n} open spraakaanvra${n === 1 ? 'ag' : 'gen'}. Klik om de oudste te openen:\n`
                    + [...open.values()].sort((a, b) => a.since - b.since).slice(0, 15).map((v) => v.caption).join('\n')
                : 'Geen open spraakaanvragen';
        }

        function onStatus(id, fms, caption) {
            if (Number(fms) === 5) {
                if (!open.has(id)) open.set(id, { caption: caption || String(id), since: Date.now() });
            } else {
                open.delete(id);
            }
            render();
        }

        // The game defines radioMessage in its own scripts; wait for it.
        let tries = 0;
        (function hook() {
            const orig = W.radioMessage;
            if (typeof orig !== 'function') {
                if (++tries <= 30) setTimeout(hook, 1000);
                else ctx.warn('radioMessage not found; counter only updates on page load');
                return;
            }
            W.radioMessage = function (msg) {
                try {
                    if (msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                        onStatus(Number(msg.id), msg.fms_real, msg.caption);
                    }
                } catch (e) { ctx.warn('radio hook failed', e); }
                return orig.apply(this, arguments);
            };
        })();

        render();
        fetch('/api/vehicles', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : []))
            .then((list) => {
                for (const v of list) if (v.fms_real === 5 && !open.has(v.id)) open.set(v.id, { caption: v.caption, since: 0 });
                render();
            })
            .catch((e) => ctx.warn('could not load vehicles', e));
    },
});

/* ==== module: destination-filter ========================================== */
MKS.module({
    id: 'destination-filter',
    name: 'Bestemmingfilter',
    icon: '🏥',
    category: 'missions',
    description: 'Verbergt bij een spraakaanvraag de ziekenhuizen en cellen die niet passen: vol, verkeerde afdeling, te duur of te ver. '
        + 'De beste keuze (dichtstbij, passend, laagste kosten) krijgt een markering; <kbd>Enter</kbd> kiest die. '
        + 'Een balk boven de lijst toont hoeveel er verborgen zijn, met een knop om alles te tonen.',
    at: 'ready',
    frames: 'all',
    pages: /^\/vehicles\/\d+\/?$/,
    pageNote: 'Alleen in het voertuigvenster bij een spraakaanvraag',
    live: true,
    settings: [
        { key: 'full', label: 'Volle bestemmingen verbergen', type: 'bool', default: true },
        { key: 'department', label: 'Ziekenhuizen zonder de juiste afdeling verbergen', type: 'bool', default: true },
        { key: 'minBeds', label: 'Minimaal aantal vrije bedden', type: 'number', default: 1, min: 0, max: 50, step: 1 },
        { key: 'cellsShort', label: 'Cellen met te weinig plek verbergen', type: 'bool', default: false,
            help: 'Oranje knoppen: het cellencomplex heeft minder vrije cellen dan er gevangenen in het voertuig zitten.' },
        { key: 'maxCost', label: 'Maximale kosten (team)', type: 'select', default: '50',
            options: [['0', '0 %'], ['10', '10 %'], ['20', '20 %'], ['30', '30 %'], ['40', '40 %'], ['50', '50 % (alles)']] },
        { key: 'maxKm', label: 'Maximale afstand', type: 'number', default: 0, min: 0, max: 500, step: 5, unit: 'km', help: '0 = geen grens.' },
        { key: 'ownKm', label: 'Voorrang eigen ziekenhuis', type: 'number', default: 5, min: 0, max: 100, step: 1, unit: 'km',
            help: 'Bij gelijke kosten wint je eigen ziekenhuis, zolang het niet meer dan zoveel km verder is dan een teamziekenhuis.' },
        { key: 'enter', label: 'Enter kiest de beste bestemming', type: 'bool', default: true },
    ],

    run(ctx) {
        const h2 = document.getElementById('h2_sprechwunsch');
        if (!h2) return;

        const HIDDEN = 'mks-dest-hidden';
        const BEST = 'mks-dest-best';
        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            body.mks-dest-all .${HIDDEN} { display: table-row !important; opacity: .45; }
            body.mks-dest-all a.btn.${HIDDEN} { display: inline-block !important; }
            tr.${BEST} > td { box-shadow: inset 0 2px 0 #3ecf8e, inset 0 -2px 0 #3ecf8e; }
            tr.${BEST} > td:first-child { box-shadow: inset 2px 2px 0 #3ecf8e, inset 0 -2px 0 #3ecf8e; }
            a.btn.${BEST} { outline: 3px solid #3ecf8e; outline-offset: 1px; }
            .mks-dest-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 3px; background: #3ecf8e; color: #03241a;
                font-size: 11px; font-weight: 600; vertical-align: middle; }
            .mks-dest-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 10px; font-size: 12px; }
            .mks-dest-bar .mks-dest-why { opacity: .75; }
        `;
        document.head.appendChild(style);

        const num = (s) => {
            const m = String(s).replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
            return m ? parseFloat(m[0].replace(',', '.')) : NaN;
        };
        const cell = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent.trim() : '');

        /* ========================================================================
         * CANDIDATES
         * Hospitals: tables #own-hospitals and #alliance-hospitals, one row per
         * hospital, button a[href*="/patient/"]. Own hospitals have no cost column.
         * Cells: either table rows like hospitals (button a[href*="/gefangener/"])
         * or loose buttons with distance, free cells and cost in the text.
         * Red (btn-danger / row .danger / 0 free) = full, orange = not enough room.
         * ==================================================================== */
        const DEST = 'a[href*="/patient/"], a[href*="/gefangener/"]';
        const isRed = (el) => !!el && (el.classList.contains('btn-danger') || el.classList.contains('danger')
            || el.classList.contains('label-danger'));
        function candidates() {
            const out = [];
            const seen = new Set();
            for (const table of document.querySelectorAll('table')) {
                const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
                const iDist = heads.findIndex((h) => h.startsWith('afstand'));
                if (iDist < 0) continue;
                const iFree = heads.findIndex((h) => h.startsWith('vrij'));
                const iCost = heads.findIndex((h) => h.startsWith('kosten') || h.startsWith('belasting'));
                const iDep = heads.findIndex((h) => h.startsWith('afdeling'));
                for (const tr of table.querySelectorAll('tbody > tr')) {
                    const a = tr.querySelector(DEST);
                    if (!a) continue;
                    seen.add(a);
                    const kind = /\/gefangener\//.test(a.getAttribute('href')) ? 'cell' : 'hospital';
                    const free = iFree >= 0 ? num(cell(tr, iFree).split('/')[0]) : Infinity;
                    const red = isRed(a) || isRed(tr) || (iFree >= 0 && isRed(tr.cells[iFree] && tr.cells[iFree].querySelector('.label')));
                    out.push({
                        el: tr, a, kind, own: table.id === 'own-hospitals',
                        dist: num(cell(tr, iDist)),
                        free: red ? 0 : (isNaN(free) ? Infinity : free),
                        short: a.classList.contains('btn-warning') || tr.classList.contains('warning'),
                        cost: iCost >= 0 ? num(cell(tr, iCost)) || 0 : 0,
                        dep: kind === 'cell' || iDep < 0 || !!(tr.cells[iDep] && tr.cells[iDep].querySelector('.label-success')),
                    });
                }
            }
            for (const a of document.querySelectorAll('a[href*="/gefangener/"]')) {
                if (seen.has(a)) continue;
                const t = a.textContent.replace(/\s+/g, ' ');
                const km = t.match(/(\d+(?:[.,]\d+)?)\s*km/);
                const pct = t.match(/(\d+)\s*%/);
                const freeTxt = t.match(/vrij\w*\s*(?:cel\w*)?\s*:?\s*(\d+)/i);
                out.push({
                    el: a, a, kind: 'cell',
                    dist: km ? parseFloat(km[1].replace(',', '.')) : NaN,
                    free: isRed(a) ? 0 : (freeTxt ? Number(freeTxt[1]) : Infinity),
                    short: a.classList.contains('btn-warning'),
                    cost: pct ? Number(pct[1]) : 0,
                    dep: true,
                });
            }
            return out;
        }

        // Reason a candidate is hidden, or '' when it stays.
        function reason(c) {
            const cfg = ctx.cfg;
            if (c.a.classList.contains('disabled')) return 'niet beschikbaar';
            if (cfg.full && c.free <= 0) return 'vol';
            if (c.kind === 'hospital' && c.free < Number(cfg.minBeds)) return 'te weinig bedden';
            if (c.kind === 'cell' && cfg.cellsShort && c.short && c.free !== 0) return 'te weinig cellen';
            if (c.kind === 'hospital' && cfg.department && !c.dep) return 'geen afdeling';
            if (c.cost > Number(cfg.maxCost)) return 'te duur';
            if (Number(cfg.maxKm) > 0 && c.dist > Number(cfg.maxKm)) return 'te ver';
            return '';
        }

        const bar = document.createElement('div');
        bar.className = 'mks-dest-bar';
        h2.insertAdjacentElement('afterend', bar);

        let best = null;
        function apply() {
            obs.disconnect();
            document.querySelectorAll(`.${BEST}`).forEach((el) => el.classList.remove(BEST));
            document.querySelectorAll('.mks-dest-tag').forEach((el) => el.remove());
            const list = candidates();
            const why = {};
            const shown = [];
            for (const c of list) {
                const r = reason(c);
                c.el.classList.toggle(HIDDEN, !!r);
                if (r) why[r] = (why[r] || 0) + 1;
                else shown.push(c);
            }
            // Best: cheapest first, then nearest, own hospitals get a head start
            // of ownKm. Unknown distance goes last.
            const rank = (c) => (isNaN(c.dist) ? 1e9 : c.dist) - (c.own ? Number(ctx.cfg.ownKm) || 0 : 0);
            best = shown.slice().sort((x, y) => x.cost - y.cost || rank(x) - rank(y))[0] || null;
            if (best) {
                best.el.classList.add(BEST);
                const tag = document.createElement('span');
                tag.className = 'mks-dest-tag';
                tag.textContent = ctx.cfg.enter ? 'Beste keuze · Enter' : 'Beste keuze';
                (best.el.tagName === 'TR' ? best.el.cells[0] : best.a).appendChild(tag);
            }
            const hidden = list.length - shown.length;
            const parts = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ');
            const all = document.body.classList.contains('mks-dest-all');
            bar.innerHTML = hidden
                ? `<span><b>${shown.length}</b> van ${list.length} bestemmingen</span><span class="mks-dest-why">verborgen: ${ctx.esc(parts)}</span>`
                  + `<a href="#" class="btn btn-xs btn-default">${all ? 'Verborgen weer verbergen' : 'Alles tonen'}</a>`
                : `<span class="mks-dest-why">${list.length} bestemmingen, niets verborgen</span>`;
            const toggle = bar.querySelector('a');
            if (toggle) toggle.onclick = (ev) => { ev.preventDefault(); document.body.classList.toggle('mks-dest-all'); apply(); };
            if (!shown.length && list.length) bar.insertAdjacentHTML('beforeend', '<span class="label label-danger">Geen passende bestemming</span>');
            obs.takeRecords();
            watch();
        }

        function onKey(ev) {
            if (!ctx.cfg.enter || ev.key !== 'Enter' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
            const t = ev.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
            if (!best || !document.contains(best.a)) return;
            ev.preventDefault();
            best.a.click();
        }
        document.addEventListener('keydown', onKey);

        // "Load all" swaps in more alliance hospitals without a page load.
        // apply() changes the DOM itself, so it stops observing while it runs.
        const root = document.getElementById('iframe-inside-container') || document.body;
        let timer = null;
        const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(apply, 100);
        });
        const watch = () => obs.observe(root, { childList: true, subtree: true });

        apply();
        ctx.onSettings(apply);

        return {
            stop() {
                obs.disconnect();
                clearTimeout(timer);
                document.removeEventListener('keydown', onKey);
                document.body.classList.remove('mks-dest-all');
                document.querySelectorAll(`.${HIDDEN}, .${BEST}`).forEach((el) => el.classList.remove(HIDDEN, BEST));
                document.querySelectorAll('.mks-dest-tag').forEach((el) => el.remove());
                bar.remove();
                style.remove();
            },
        };
    },
});

/* ==== module: credit-filter =============================================== */
MKS.module({
    id: 'credit-filter',
    name: 'Creditfilter',
    icon: '💶',
    category: 'missions',
    description: 'Drie knoppen in de missiefilterbalk: laag, midden en hoog aantal credits. Groen = tonen, rood = verbergen, net als de filters van het spel zelf. '
        + 'Inzetten zonder bekende credits blijven altijd zichtbaar.',
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'lowMax', label: 'Grens laag / midden', type: 'number', default: 1000, min: 100, max: 100000, step: 100, unit: 'credits' },
        { key: 'highMin', label: 'Grens midden / hoog', type: 'number', default: 5000, min: 100, max: 100000, step: 100, unit: 'credits' },
    ],

    run(ctx) {
        const STORE_KEY = 'mks-credit-filter';
        const k = (n) => (n % 1000 ? `${(n / 1000).toLocaleString('nl-NL')}k` : `${n / 1000}k`);
        // Lower bound inclusive, upper bound exclusive. Rebuilt when the
        // borders change in the dashboard.
        const BUCKETS = [];
        function buildBuckets() {
            const lo = Math.min(ctx.cfg.lowMax, ctx.cfg.highMin);
            const hi = Math.max(ctx.cfg.lowMax, ctx.cfg.highMin);
            BUCKETS.splice(0, BUCKETS.length,
                { key: 'low', label: `< ${k(lo)}`, title: `0 - ${ctx.nl(lo)} credits`, min: 0, max: lo },
                { key: 'mid', label: `${k(lo)}-${k(hi)}`, title: `${ctx.nl(lo)} - ${ctx.nl(hi)} credits`, min: lo, max: hi },
                { key: 'high', label: `${k(hi)}+`, title: `${ctx.nl(hi)}+ credits`, min: hi, max: Infinity });
        }
        buildBuckets();
        // Planned events and patient transports keep their own toggles, so only
        // filter the emergency and alliance lists.
        const LIST_IDS = ['mission_list', 'mission_list_alliance', 'mission_list_alliance_event'];
        const HIDDEN = 'mks-credit-hidden';

        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        // Keys of the buckets that are switched off (hidden).
        let off = new Set();
        try { off = new Set(JSON.parse(localStorage.getItem(STORE_KEY)) || []); } catch (e) {}
        const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify([...off])); } catch (e) {} };

        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            .mks-credit-filters { display: inline-block; margin-left: 4px; }
        `;
        document.head.appendChild(style);

        const group = document.createElement('div');
        group.className = 'mks-credit-filters';
        const buttons = {};
        BUCKETS.forEach(b => {
            // No `mission_selection` class: the game binds its own toggle handler to it.
            const a = document.createElement('a');
            a.className = 'btn btn-xs';
            a.href = '#';
            a.onclick = ev => {
                ev.preventDefault();
                off.has(b.key) ? off.delete(b.key) : off.add(b.key);
                save();
                apply();
            };
            buttons[b.key] = a;
            group.appendChild(a);
        });
        row.appendChild(group);

        function bucketOf(entry) {
            let c;
            try { c = JSON.parse(entry.getAttribute('data-sortable-by')).average_credits; } catch (e) { return null; }
            if (typeof c !== 'number') return null;
            return BUCKETS.find(b => c >= b.min && c < b.max) || null;
        }

        function apply() {
            const counts = Object.fromEntries(BUCKETS.map(b => [b.key, 0]));
            LIST_IDS.forEach(id => {
                const list = document.getElementById(id);
                if (!list) return;
                list.querySelectorAll(':scope > .missionSideBarEntry').forEach(entry => {
                    const b = bucketOf(entry);
                    // Unknown credits: keep visible rather than hide by accident.
                    entry.classList.toggle(HIDDEN, !!b && off.has(b.key));
                    if (b) counts[b.key]++;
                });
            });
            BUCKETS.forEach(b => {
                const a = buttons[b.key];
                const isOff = off.has(b.key);
                a.classList.toggle('btn-success', !isOff);
                a.classList.toggle('btn-danger', isOff);
                a.title = b.title;
                a.innerHTML = `<span class="glyphicon glyphicon-euro"></span> ${b.label} ${counts[b.key]}`;
            });
        }

        // The game adds and removes entries as missions spawn and finish.
        let queued = false;
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; apply(); });
        };
        const observer = new MutationObserver(schedule);
        LIST_IDS.forEach(id => {
            const list = document.getElementById(id);
            if (list) observer.observe(list, { childList: true });
        });

        apply();

        ctx.onSettings(() => { buildBuckets(); apply(); });
    },
});

/* ==== module: map-filter ================================================== */
MKS.module({
    id: 'map-filter',
    name: 'Kaartfilter',
    icon: '🗺️',
    category: 'missions',
    description: 'Inzetten die door de missiefilters verborgen zijn, verdwijnen ook van de kaart. '
        + 'Werkt met de filters van het spel zelf, de zoekbalk en het Creditfilter.',
    at: 'ready',
    frames: 'top',
    live: true,

    run(ctx) {
        const W = ctx.W;
        const panel = document.getElementById('missions-panel-body');
        if (!panel || !Array.isArray(W.mission_markers)) return;

        const HIDDEN = 'mks-map-hidden';
        const style = document.createElement('style');
        style.textContent = `.leaflet-marker-icon.${HIDDEN} { display: none !important; }`;
        document.head.appendChild(style);

        // An entry is filtered out when it, or a parent inside the mission
        // panel, is display:none. The game marks filtered entries with the
        // `hidden` class; the credit filter and search use their own classes.
        // Stop at the panel so a collapsed sidebar does not empty the map.
        function filteredOut(entry) {
            for (let el = entry; el && el !== panel; el = el.parentElement) {
                if (getComputedStyle(el).display === 'none') return true;
            }
            return false;
        }

        function sync() {
            W.mission_markers.forEach((m) => {
                if (!m._icon) return;
                const entry = document.getElementById(`mission_${m.mission_id}`);
                // No list entry (yet): leave the marker alone.
                const hide = !!entry && filteredOut(entry);
                m._icon.classList.toggle(HIDDEN, hide);
            });
        }

        // Progress bars in the list change every second, so batch mutations.
        // setTimeout, not requestAnimationFrame: rAF stops in background tabs.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; sync(); }, 100);
        };

        // Filter clicks, search and new or finished missions all change the
        // list's classes or children.
        const obs = new MutationObserver(schedule);
        obs.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

        // Leaflet builds a new icon element when a marker is (re)added or its
        // icon changes (mission turns red/yellow/green), which drops our class.
        const pane = W.map && W.map.getPane && W.map.getPane('markerPane');
        const paneObs = new MutationObserver(schedule);
        if (pane) paneObs.observe(pane, { childList: true });

        sync();

        return {
            stop() {
                obs.disconnect();
                paneObs.disconnect();
                clearTimeout(timer);
                style.remove();
                document.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.classList.remove(HIDDEN));
            },
        };
    },
});

/* ==== module: team-filter ================================================= */
MKS.module({
    id: 'team-filter',
    name: 'Teamfilter',
    icon: '🤝',
    category: 'missions',
    description: 'Een knop in de missiefilterbalk die alle gedeelde teaminzetten verbergt: noodgevallen, geplande inzetten en patiëntenvervoer. '
        + 'Je eigen geplande inzetten en vervoer blijven zichtbaar. Groen = tonen, rood = verbergen.',
    at: 'ready',
    frames: 'top',
    live: true,

    run(ctx) {
        const STORE_KEY = 'mks-team-filter';
        const LIST_IDS = [
            'mission_list_alliance',
            'mission_list_alliance_event',
            'mission_list_sicherheitswache_alliance',
            'mission_list_krankentransporte_alliance',
        ];
        const HIDDEN = 'mks-teamfilter-hidden';

        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        let off = false;
        try { off = localStorage.getItem(STORE_KEY) === 'off'; } catch (e) {}
        const save = () => { try { localStorage.setItem(STORE_KEY, off ? 'off' : 'on'); } catch (e) {} };

        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            .mks-teamfilter { display: inline-block; margin-left: 4px; }
        `;
        document.head.appendChild(style);

        // No `mission_selection` class: the game binds its own toggle handler to it.
        const btn = document.createElement('a');
        btn.className = 'btn btn-xs mks-teamfilter';
        btn.href = '#';
        btn.onclick = (ev) => {
            ev.preventDefault();
            off = !off;
            save();
            apply();
        };
        row.appendChild(btn);

        function apply() {
            let count = 0;
            LIST_IDS.forEach((id) => {
                const list = document.getElementById(id);
                if (!list) return;
                list.querySelectorAll(':scope > .missionSideBarEntry').forEach((entry) => {
                    entry.classList.toggle(HIDDEN, off);
                    count++;
                });
            });
            btn.classList.toggle('btn-success', !off);
            btn.classList.toggle('btn-danger', off);
            btn.title = off ? 'Teaminzetten verborgen. Klik om te tonen.' : 'Klik om alle teaminzetten te verbergen.';
            btn.innerHTML = `<span class="glyphicon glyphicon-user"></span> Team ${count}`;
        }

        // The game adds and removes entries as missions spawn and finish.
        // setTimeout, not requestAnimationFrame: rAF stops in background tabs.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; apply(); }, 50);
        };
        const obs = new MutationObserver(schedule);
        LIST_IDS.forEach((id) => {
            const list = document.getElementById(id);
            if (list) obs.observe(list, { childList: true });
        });

        apply();

        return {
            stop() {
                obs.disconnect();
                clearTimeout(timer);
                btn.remove();
                style.remove();
                document.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.classList.remove(HIDDEN));
            },
        };
    },
});

/* ==== module: dispatch-presets ============================================ */
MKS.module({
    id: 'dispatch-presets',
    name: 'Inzetvoorstellen maken',
    short: 'Inzetvoorstellen',
    icon: '📋',
    category: 'missions',
    description: 'Maakt inzetvoorstellen (AAO\'s) voor grote inzetten, verdeeld over de categorieën Klein, Middel en Groot. Ambulances tellen niet mee '
        + 'voor de grootte, maar GGB en NHT worden wel meegenomen waar een inzet die vraagt. '
        + 'Doet alleen iets als je op <b>Controleren</b> of <b>Aanmaken</b> klikt. Bestaande voorstellen (zelfde naam) worden bijgewerkt als hun '
        + 'voertuigen niet meer kloppen, in plaats van overgeslagen.',
    tagline: 'Handmatig starten',
    warning: '<b>Dit maakt HEEL VEEL inzetvoorstellen aan: 573 stuks.</b> Ze komen allemaal in je lijst met inzetvoorstellen '
        + 'en in het alarmeervenster te staan. Weghalen gaat alleen met de hand, één voor één. Het script is nog in ontwikkeling. '
        + '<b>Aanmaken</b> kan bestaande voorstellen ook wijzigen (zelfde naam, andere voertuigen) — pas ze dus niet handmatig aan tenzij je '
        + 'de naam ook aanpast. Maak eerst de categorieën <b>Klein</b>, <b>Middel</b> en <b>Groot</b> aan.',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [
        { key: 'color', label: 'Kleur', type: 'text', default: 'ff0000', placeholder: 'ff0000', help: 'Hex-kleur van de knoppen, zonder #.' },
        { key: 'prefix', label: 'Voorvoegsel', type: 'text', default: '', placeholder: 'bijv. ★ ', help: 'Komt voor elke naam. Let op: bestaande voorstellen worden op naam herkend.' },
        { key: 'throttleSec', label: 'Pauze tussen voorstellen', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.5, unit: 'sec' },
    ],

    run(ctx) {
        const CONFIG = {
            get THROTTLE_MS() { return ctx.cfg.throttleSec * 1000; },
            CATEGORIES: ['Klein', 'Middel', 'Groot'],
            get COLOR() { return String(ctx.cfg.color || '').replace(/^#/, ''); }, // preset colour (hex)
            get PREFIX() { return ctx.cfg.prefix || ''; },                        // optional prefix added to every caption
        };

        // c = mission name (preset caption), s = size group, v = slots (aao[slot] -> count), n = variants merged
        const PRESETS = [{"c": "Aanhanger losgeschoten", "s": "Klein", "v": {"fire": 1, "elw": 1, "any_traffic_unit": 2, "fustw": 3}, "n": 1, "e": []}, {"c": "Aanrijding door ijzel", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Aanrijding door trein", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 1, "railway_fire_engine": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Aanrijding meerdere vrachtwagens", "s": "Klein", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "any_traffic_unit": 2, "traffic_patrol": 2, "fire": 2, "fustw": 4}, "n": 1, "e": []}, {"c": "Aanrijding met zwaar letsel", "s": "Klein", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "any_traffic_unit": 1, "traffic_patrol": 1, "fire": 2, "fustw": 6}, "n": 8, "e": []}, {"c": "Aanrijding snelweg, veroorzaker gevlucht", "s": "Klein", "v": {"rw": 1, "any_traffic_unit": 2, "traffic_patrol": 1, "fire": 1, "polizeihubschrauber": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Aanrijding voetganger (> 30km/h)", "s": "Klein", "v": {"ovd_p": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Aanvaring met luxe jachtschip (Grip 4)", "s": "Klein", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 2, "boot": 2, "fustw": 2}, "n": 2, "e": []}, {"c": "Aanvaring veerpont", "s": "Klein", "v": {"coastal_boat": 5, "boot": 2, "gw_wasserrettung": 5}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met kajuitboot (Grip 3)", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 1, "boot": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met vlet (Grip 3)", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 1, "boot": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met waterbus (Grip 3)", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 1, "boot": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met watertaxi (Grip 3)", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "dlk": 1, "care_service": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Achtervolging personenauto", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "traffic_patrol": 3, "fustw": 4}, "n": 2, "e": []}, {"c": "Ambulance betrokken bij ongeluk", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "ovd_p": 1, "polizeihubschrauber": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Auto tegen pijlwagen gereden", "s": "Klein", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "any_traffic_unit": 1, "traffic_patrol": 1, "fire": 2, "fustw": 4}, "n": 2, "e": []}, {"c": "Ballonnen opblazen voor verjaardagsfeest", "s": "Klein", "v": {"rw": 2, "dlk": 2, "gwa": 1, "fire": 3, "fustw": 2}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Begeleiding demonstratie (klein)", "s": "Klein", "v": {"grukw": 3, "police_horse": 2, "fustw": 3, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Bestuurder op telefoon botst op vrachtwagen", "s": "Klein", "v": {"rw": 2, "elw": 1, "fire": 4, "fustw": 6}, "n": 1, "e": []}, {"c": "Bliksem treft konijnenhol", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Bloemenveld in brand", "s": "Klein", "v": {"gwl2wasser": 1, "elw": 1, "rw": 1, "fire": 7}, "n": 1, "e": []}, {"c": "Bom uit WOII gevonden", "s": "Klein", "v": {"rw": 1, "elw": 2, "ovd_p": 1, "fire": 3, "spokesman": 1, "bomb_disposal": 1, "fustw": 3, "military_police": 2}, "n": 1, "e": []}, {"c": "Bootje op drift", "s": "Klein", "v": {"gw_taucher": 1, "dlk": 1, "fire": 2, "boot": 1, "fustw": 2, "gw_wasserrettung": 2}, "n": 1, "e": []}, {"c": "Bosbrand (Grip 1)", "s": "Klein", "v": {"elw": 1, "elw3": 1, "elw2": 1, "care_service": 1, "fustw": 2, "brush_truck": 4}, "n": 4, "e": []}, {"c": "Brand bij afvalverwerker (Groot)", "s": "Klein", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 3, "gwgefahrgut": 1, "gwmesstechnik": 1}, "n": 1, "e": []}, {"c": "Brand in appartementencomplex", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "gwa": 1, "fire": 4, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in bouwmarkt (Groot)", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in bovenleiding", "s": "Klein", "v": {"dlk": 1, "elw": 1, "fire": 2, "railway_fire_engine": 2, "railway_electric_response": 1}, "n": 1, "e": []}, {"c": "Brand in cafetaria (Groot)", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw2": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in flatwoning", "s": "Klein", "v": {"dlk": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in garagebedrijf", "s": "Klein", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 1}, "n": 3, "e": []}, {"c": "Brand in gevangenis", "s": "Klein", "v": {"dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gefkw": 1, "ovd_p": 1, "hondengeleider": 1, "fire": 2, "polizeihubschrauber": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Brand in hotel", "s": "Klein", "v": {"dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 3, "fustw": 2}, "n": 3, "e": []}, {"c": "Brand in kantoorgebouw", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 2, "elw": 1, "elw2": 1, "gwa": 1, "fire": 4}, "n": 3, "e": []}, {"c": "Brand in kelder", "s": "Klein", "v": {"gwl2wasser": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in landbouwschuur", "s": "Klein", "v": {"rw": 1, "foam": 1, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 4, "e": []}, {"c": "Brand in manege", "s": "Klein", "v": {"gwl2wasser": 1, "foam": 1, "dlk": 1, "elw": 1, "elw2": 1, "fire": 3}, "n": 2, "e": []}, {"c": "Brand in museum", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in parkeergarage", "s": "Klein", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "fustw": 2}, "n": 3, "e": []}, {"c": "Brand in passagierstrein (Middel)", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 2, "railway_fire_engine": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in schoolgebouw", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in snackbar", "s": "Klein", "v": {"fire": 3, "elw": 1, "dlk": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in sporthal", "s": "Klein", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4}, "n": 3, "e": []}, {"c": "Brand in stacaravan", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in supermarkt", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in tram (Groot)", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "gwa": 1, "fire": 4, "railway_fire_engine": 2, "fustw": 3}, "n": 2, "e": []}, {"c": "Brand in transformatorhuisje", "s": "Klein", "v": {"rw": 2, "elw": 1, "elw3": 1, "elw2": 1, "fire": 3, "fustw": 2}, "n": 2, "e": []}, {"c": "Brand in verzorgingshuis", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "fustw": 2}, "n": 3, "e": []}, {"c": "Brand in werkplaats (Groot)", "s": "Klein", "v": {"gwl2wasser": 1, "rw": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in ziekenhuis (Middel)", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand op binnenvaartschip", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "foam": 1, "elw": 1, "elw2": 1, "gwa": 1, "fire": 3, "gwgefahrgut": 1, "spokesman": 1, "boot": 2}, "n": 2, "e": []}, {"c": "Brand op zomerkamp", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "gwa": 1, "fire": 6, "fustw": 2}, "n": 1, "e": []}, {"c": "Brandend dak", "s": "Klein", "v": {"dlk": 1, "elw": 1, "elw2": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brandend klein vliegtuig", "s": "Klein", "v": {"elw": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "fustw": 2, "arff": 1}, "n": 1, "e": []}, {"c": "Brandende caravan", "s": "Klein", "v": {"gwl2wasser": 1, "elw": 1, "any_traffic_unit": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brandende goederenwagon (Middel)", "s": "Klein", "v": {"gwl2wasser": 1, "elw": 1, "fire": 2, "gwgefahrgut": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Brandende laadpaal", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 2, "bike_police": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Brandende vrachtwagen (Middel)", "s": "Klein", "v": {"gwl2wasser": 1, "foam": 1, "car_carrier_large": 1, "elw": 1, "fire": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Carnaval beveiliging", "s": "Klein", "v": {"fire": 4, "elw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Diepzeemijn aangetroffen", "s": "Klein", "v": {"ovd_p": 1, "bomb_disposal": 1, "bomb_disposal_robot": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Doorzoeking risicopand", "s": "Klein", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 1, "at_c": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Dronken persoon gooit met terrasmeubilair", "s": "Klein", "v": {"police_horse": 8, "fustw": 3}, "n": 1, "e": []}, {"c": "Drugsafval aangetroffen", "s": "Klein", "v": {"elw": 1, "ovd_p": 1, "fire": 1, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Drugslab aangetroffen", "s": "Klein", "v": {"elw": 1, "ovd_p": 1, "fire": 1, "gwgefahrgut": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Duiker vermist", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Duinbrand (Middel)", "s": "Klein", "v": {"gw_wasserrettung": 2, "elw": 1, "brush_truck": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Fietser onder tram", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 1, "railway_fire_engine": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Gaslekkage", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "gwgefahrgut": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Geplande aanhouding vuurwapengevaarlijke verdachte", "s": "Klein", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "at_c": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Geweld tegen hulpverleners", "s": "Klein", "v": {"ovd_p": 1, "fustw": 6, "hondengeleider": 2}, "n": 1, "e": []}, {"c": "Graffitispuiters betrapt", "s": "Klein", "v": {"ovd_p": 1, "fustw": 6, "hondengeleider": 2}, "n": 1, "e": []}, {"c": "Grenscontrole", "s": "Klein", "v": {"military_police": 6, "police_motorcycle": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Groep kitesurfers in problemen", "s": "Klein", "v": {"gw_wasserrettung": 3, "boot": 2, "fustw": 3}, "n": 2, "e": []}, {"c": "Groep zwemmers in problemen", "s": "Klein", "v": {"gw_wasserrettung": 2, "boot": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Grote vechtpartij", "s": "Klein", "v": {"ovd_p": 1, "fustw": 6, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Hazenbijeenkomst in Paaseistad", "s": "Klein", "v": {"fire": 2, "fustw": 8}, "n": 1, "e": [], "vt": {"100": 2, "101": 2}}, {"c": "Heidebrand (Groot)", "s": "Klein", "v": {"gwl2wasser": 2, "elw": 1, "spokesman": 1, "fustw": 2, "brush_truck": 4}, "n": 1, "e": []}, {"c": "Helikopter crash", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw_airport": 1, "ovd_p": 1, "fire": 2, "fustw": 4, "arff": 2}, "n": 1, "e": []}, {"c": "Illegale raceauto op snelweg", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 10, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Ingestort konijnenhol", "s": "Klein", "v": {"rw": 1, "elw": 2, "fire": 4, "fustw": 2}, "n": 1, "e": []}, {"c": "Instap na bedreiging (Hoog risico)", "s": "Klein", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 2, "at_c": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Kettingbotsing", "s": "Klein", "v": {"rw": 2, "elw": 1, "any_traffic_unit": 2, "traffic_patrol": 1, "fire": 4, "fustw": 4}, "n": 3, "e": []}, {"c": "Klein vliegtuig neergestort", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "fustw": 2, "arff": 1}, "n": 3, "e": []}, {"c": "Koolmonoxidevergiftiging in een school", "s": "Klein", "v": {"elw": 2, "elw2": 1, "gwa": 2, "fire": 6, "fustw": 3}, "n": 1, "e": []}, {"c": "Koperdiefstal", "s": "Klein", "v": {"ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Lek/zinken plezierjacht", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Lekkage gevaarlijke stoffen (Middel)", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw2": 1, "ovd_p": 1, "hazard_response_material": 1, "fire": 2, "gwgefahrgut": 1, "spokesman": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Lekkende LPG installatie", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Lekkende chocoladevrachtwagen", "s": "Klein", "v": {"rw": 2, "elw": 2, "fire": 4, "gwgefahrgut": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Lekkende tankwagen", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 3}, "n": 3, "e": []}, {"c": "Massa-beroerte tijdens het eten van fondue (groot)", "s": "Klein", "v": {"rw": 1, "elw": 1, "gwa": 1, "fire": 3, "gwmesstechnik": 1, "fustw": 6}, "n": 1, "e": []}, {"c": "Massa-beroerte tijdens het eten van fondue (klein)", "s": "Klein", "v": {"elw": 1, "gwa": 1, "fire": 2, "gwmesstechnik": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Mensen vermist op de dansvloer", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "ovd_p": 1, "hondengeleider": 2, "fire": 4, "fustw": 4}, "n": 1, "e": []}, {"c": "Nablussen natuur", "s": "Klein", "v": {"gwl2wasser": 1, "elw": 1, "fire": 5}, "n": 1, "e": []}, {"c": "Natuurbrand (Zeer Groot)", "s": "Klein", "v": {"gwl2wasser": 2, "elw": 2, "elw2": 1, "spokesman": 1, "fustw": 2, "brush_truck": 4}, "n": 1, "e": []}, {"c": "Oefening Handcrew", "s": "Klein", "v": {"brush_truck": 4}, "n": 1, "e": []}, {"c": "Oefening brandweer", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "fire": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Omgeslagen Zeilboot", "s": "Klein", "v": {"gw_taucher": 2, "dlk": 1, "elw": 1, "fire": 1, "boot": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Ongeregeldheden in de wijk", "s": "Klein", "v": {"grukw": 6, "bike_police": 1, "fustw": 6, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Ongeregeldheden voetbalsupporters horeca", "s": "Klein", "v": {"grukw": 6, "police_horse": 1, "gefkw": 1, "ovd_p": 1, "fustw": 4, "lebefkw": 1}, "n": 12, "e": []}, {"c": "Ongeval in septic tank", "s": "Klein", "v": {"rw": 1, "elw": 1, "gwgefahrgut": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Ongeval met hete luchtballon", "s": "Klein", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "fire": 2, "spokesman": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Ongeval met trein en personenauto", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 1, "railway_fire_engine": 4, "car_carrier": 1, "fustw": 3}, "n": 3, "e": []}, {"c": "Ongeval met trein en persoon", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 1, "railway_fire_engine": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Ongeval met trein en vrachtwagen (THV Klein)", "s": "Klein", "v": {"rw": 1, "car_carrier_large": 1, "elw": 1, "fire": 1, "railway_fire_engine": 3, "fustw": 2, "railway_electric_response": 1}, "n": 2, "e": []}, {"c": "Ongeval met trein en vrachtwagen (THV Middel)", "s": "Klein", "v": {"rw": 1, "car_carrier_large": 1, "elw": 1, "fire": 2, "railway_fire_engine": 2, "fustw": 3, "railway_electric_response": 1}, "n": 4, "e": []}, {"c": "Onrust in de wijk", "s": "Klein", "v": {"grukw": 3, "bike_police": 1, "fustw": 4, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Ontruimen kraakpand", "s": "Klein", "v": {"grukw": 3, "gefkw": 1, "ovd_p": 1, "fustw": 4, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Ontruimingsoefening", "s": "Klein", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "ovd_p": 1, "fire": 2, "fustw": 3}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Opvang slachtoffers", "s": "Klein", "v": {"fire": 1, "ovd_p": 1, "fustw": 6}, "n": 1, "e": []}, {"c": "Overval bankkantoor", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Overval frietkraam", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Overval winkel", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5}, "n": 2, "e": []}, {"c": "Paniek op de tribune", "s": "Klein", "v": {"gefkw": 1, "police_horse": 4, "fustw": 5}, "n": 1, "e": []}, {"c": "Peperkoekhuis in brand", "s": "Klein", "v": {"fire": 5, "elw": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Personen aangetroffen in vrachtwagen", "s": "Klein", "v": {"gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "polizeihubschrauber": 1, "fustw": 8}, "n": 2, "e": []}, {"c": "Personen onwel door hitte", "s": "Klein", "v": {"elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Personenauto te water", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 1, "fustw": 3}, "n": 7, "e": []}, {"c": "Persoon bekneld in bouwkraan", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Persoon bekneld in gierput", "s": "Klein", "v": {"rw": 1, "hazard_response_suits": 1, "ovd_p": 1, "gwa": 1, "hazard_response_material": 1, "fire": 2, "gwgefahrgut": 1, "fustw": 4, "hazard_response_disinfection": 1}, "n": 8, "e": []}, {"c": "Persoon bekneld onder garagedeur", "s": "Klein", "v": {"rw": 1, "elw": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Persoon onwel in hijskraan", "s": "Klein", "v": {"rw": 1, "dlk": 1, "elw": 1, "elw2": 1, "fire": 1, "spokesman": 1, "bike_police": 2, "fustw": 1, "police_motorcycle": 1}, "n": 1, "e": []}, {"c": "Persoon te water", "s": "Klein", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 2, "fustw": 1}, "n": 5, "e": []}, {"c": "Persoon vermist", "s": "Klein", "v": {"grukw": 6, "ovd_p": 1, "polizeihubschrauber": 1, "fustw": 3, "lebefkw": 1}, "n": 3, "e": []}, {"c": "Plofkraak", "s": "Klein", "v": {"elw": 1, "ovd_p": 1, "fire": 1, "polizeihubschrauber": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Politie aangevallen met illegaal vuurwerk", "s": "Klein", "v": {"grukw": 3, "ovd_p": 1, "hondengeleider": 2, "fustw": 5, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Protesterende elven", "s": "Klein", "v": {"grukw": 6, "ovd_p": 1, "hondengeleider": 1, "fustw": 3, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Rieten kap woning in brand door vuurwerk", "s": "Klein", "v": {"dlk": 1, "elw": 1, "gwa": 1, "fire": 5, "fustw": 2}, "n": 1, "e": []}, {"c": "Schipbreukeling vermist", "s": "Klein", "v": {"coastal_boat": 3, "gw_wasserrettung": 2}, "n": 1, "e": []}, {"c": "Scootmobiel te water", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "dlk": 1, "elw2": 1, "fire": 1, "boot": 1, "bike_police": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Steekincident (groot)", "s": "Klein", "v": {"elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fustw": 10}, "n": 2, "e": []}, {"c": "Straatroof", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Supporters met vuurwerk op tribune", "s": "Klein", "v": {"grukw": 2, "gefkw": 1, "ovd_p": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Toezicht Horeca", "s": "Klein", "v": {"police_horse": 4, "hondengeleider": 1, "bike_police": 1, "fustw": 3}, "n": 3, "e": []}, {"c": "Toezicht bij manifestatie", "s": "Klein", "v": {"grukw": 6, "ovd_p": 1, "bike_police": 1, "fustw": 3, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Toezicht/Begeleiding Surfwedstrijd", "s": "Klein", "v": {"gw_wasserrettung": 4, "boot": 4, "fustw": 2}, "n": 1, "e": [], "vt": {"100": 1}}, {"c": "Vader vermist", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Valentijnsdecoraties in restaurant in brand gevlogen", "s": "Klein", "v": {"fire": 5, "elw": 1, "dlk": 1}, "n": 1, "e": []}, {"c": "Vat met gevaarlijke stoffen omgevallen", "s": "Klein", "v": {"rw": 1, "foam": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 3}, "n": 4, "e": []}, {"c": "Vechtpartij horecagebied", "s": "Klein", "v": {"police_horse": 4, "bike_police": 2, "fustw": 7, "hondengeleider": 1}, "n": 2, "e": []}, {"c": "Vechtpartij in café", "s": "Klein", "v": {"ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 1, "e": []}, {"c": "Verdacht pakket bij voordeur", "s": "Klein", "v": {"ovd_p": 2, "fire": 1, "bomb_disposal_robot": 1, "bomb_disposal": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Verdacht pakket luchthaven", "s": "Klein", "v": {"bomb_disposal": 1, "fustw": 1, "military_police": 3}, "n": 1, "e": []}, {"c": "Verdachte vaten aangetroffen", "s": "Klein", "v": {"elw": 1, "ovd_p": 1, "fire": 1, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Vergeten jubileum", "s": "Klein", "v": {"grukw": 3, "gefkw": 1, "ovd_p": 1, "fustw": 4, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Verhoog bewustzijn van het bestaan van 112 onder kinderen", "s": "Klein", "v": {"rw": 1, "police_horse": 1, "dlk": 1, "elw": 1, "gefkw": 1, "hondengeleider": 1, "fire": 1, "spokesman": 1, "bike_police": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Verjaardagsgasten hebben taart gestolen", "s": "Klein", "v": {"gefkw": 1, "ovd_p": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Verkeerscontrole", "s": "Klein", "v": {"police_motorcycle": 6}, "n": 1, "e": []}, {"c": "Verkeersongeval met beknelling", "s": "Klein", "v": {"gw_taucher": 1, "rw": 1, "elw": 1, "fire": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Verkeersongeval met gevaarlijke stoffen (middel)", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Verkeersongeval met touringcar", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "any_traffic_unit": 2, "ovd_p": 1, "fire": 3, "fustw": 4}, "n": 11, "e": []}, {"c": "Verkeersruzie loopt uit de hand", "s": "Klein", "v": {"gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "bike_police": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Verward persoon (Hoge dreiging)", "s": "Klein", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 1, "at_c": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Verward persoon op dak", "s": "Klein", "v": {"dlk": 1, "at_m": 1, "ovd_p": 1, "at_o": 4, "at_c": 1, "fire": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Vliegtuig buiten start-/landingsbaan beland", "s": "Klein", "v": {"elw": 1, "elw_airport": 1, "fire": 1, "fustw": 2, "arff": 2}, "n": 1, "e": []}, {"c": "Voertuigbrand in tunnel", "s": "Klein", "v": {"gwl2wasser": 1, "foam": 1, "elw": 1, "ovd_p": 1, "fire": 2, "gwgefahrgut": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Voetbalwedstrijd", "s": "Klein", "v": {"grukw": 3, "police_horse": 4, "lebefkw": 1}, "n": 2, "e": [], "vt": {"100": 1}}, {"c": "Vrachtwagen te water", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 1, "fustw": 2}, "n": 6, "e": []}, {"c": "Vrachtwagen vast in tunnel", "s": "Klein", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "any_traffic_unit": 1, "fire": 2, "fustw": 3}, "n": 1, "e": []}, {"c": "Vrachtwagenongeval met zwaar letsel", "s": "Klein", "v": {"rw": 1, "elw": 1, "any_traffic_unit": 1, "traffic_patrol": 1, "fire": 2, "fustw": 2}, "n": 2, "e": []}, {"c": "Vreemde lucht in kantoorgebouw", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Vreemde lucht in winkelcentrum", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Vuilniswagen aangestoken", "s": "Klein", "v": {"fire": 3, "elw": 1, "foam": 1, "fustw": 6}, "n": 2, "e": []}, {"c": "Wateroverlast", "s": "Klein", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Watersporter vermist", "s": "Klein", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "fire": 1, "boot": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Windsurfer vermist", "s": "Klein", "v": {"gw_wasserrettung": 4, "polizeihubschrauber": 1, "boot": 2, "fustw": 3}, "n": 1, "e": []}, {"c": "Woningoverval", "s": "Klein", "v": {"polizeihubschrauber": 1, "ovd_p": 1, "fustw": 5, "hondengeleider": 1}, "n": 2, "e": []}, {"c": "Zoekactie vermist persoon", "s": "Klein", "v": {"police_horse": 2, "coastal_boat": 1, "gw_wasserrettung": 2, "fustw": 3}, "n": 2, "e": []}, {"c": "Zwemmer vermist (Grip 1)", "s": "Klein", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 2, "boot": 2, "fustw": 2}, "n": 2, "e": []}, {"c": "Zwemmer vermist (Middel)", "s": "Klein", "v": {"gw_taucher": 2, "rw": 1, "dlk": 1, "elw": 1, "fire": 2, "boot": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Aanhouding georganiseerde misdaad", "s": "Middel", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 2, "at_c": 1, "fustw": 10}, "n": 1, "e": []}, {"c": "Aankondiging voor nieuwe 112 functionaliteiten", "s": "Middel", "v": {"grukw": 3, "ovd_p": 1, "hondengeleider": 1, "fire": 2, "fustw": 10, "lebefkw": 1}, "n": 1, "e": [], "vt": {"100": 1}}, {"c": "Aanrijding bus en tram", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 2, "dlk": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 8, "spokesman": 1, "railway_fire_engine": 3, "fustw": 10}, "n": 4, "e": []}, {"c": "Aanrijding trein & betonmixer", "s": "Middel", "v": {"rw": 2, "dlk": 1, "elw3": 1, "care_service": 1, "railway_fire_engine": 3, "fustw": 8, "elw": 2, "fire": 8, "gwmesstechnik": 2, "car_carrier_large": 1, "gwgefahrgut": 1, "spokesman": 1, "railway_electric_response": 1, "railway_fire_equipment_container": 1, "elw2": 1, "ovd_p": 2, "polizeihubschrauber": 1}, "n": 32, "e": []}, {"c": "Aanvaring 2 vrachtschepen (Grip 4)", "s": "Middel", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "coastal_boat": 3, "elw": 1, "elw2": 1, "elw3": 1, "ovd_p": 1, "care_service": 1, "fire": 2, "polizeihubschrauber": 1, "spokesman": 1, "boot": 2, "fustw": 4}, "n": 2, "e": []}, {"c": "Aanvaring met rondvaartboot (Grip 3)", "s": "Middel", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "care_service": 1, "fire": 2, "boot": 2, "fustw": 4}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met passagiersschip (Grip 4)", "s": "Middel", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "coastal_boat": 3, "elw": 1, "elw2": 1, "elw3": 1, "ovd_p": 1, "care_service": 1, "fire": 3, "gwgefahrgut": 1, "polizeihubschrauber": 1, "spokesman": 1, "boot": 2, "gwmesstechnik": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Aanvaring vrachtschip met veerboot (Grip 4)", "s": "Middel", "v": {"gw_taucher": 4, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "care_service": 1, "fire": 2, "boot": 2, "fustw": 4}, "n": 2, "e": []}, {"c": "Achtervolging eindigt met botstende verdachte in supermarkt, waterleiding breekt", "s": "Middel", "v": {"rw": 2, "dlk": 1, "elw": 1, "ovd_p": 1, "fire": 4, "polizeihubschrauber": 1, "fustw": 8}, "n": 1, "e": []}, {"c": "Achtervolging gevaarlijke verdachte", "s": "Middel", "v": {"gefkw": 1, "ovd_p": 1, "traffic_patrol": 2, "hondengeleider": 2, "polizeihubschrauber": 1, "fustw": 15}, "n": 2, "e": []}, {"c": "Akkerbrand", "s": "Middel", "v": {"elw": 4, "elw3": 1, "elw2": 2, "ovd_p": 2, "gwa": 2, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 6}, "n": 2, "e": []}, {"c": "Ammoniakalarm in opslagloods", "s": "Middel", "v": {"rw": 1, "hazard_response_suits": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "hazard_response_material": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 4, "hazard_response_disinfection": 1}, "n": 8, "e": []}, {"c": "Begeleiding demonstratie (groot)", "s": "Middel", "v": {"grukw": 6, "police_horse": 5, "gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "fustw": 4, "lebefkw": 1}, "n": 2, "e": [], "vt": {"100": 1}}, {"c": "Begeleiding supporters", "s": "Middel", "v": {"grukw": 6, "police_horse": 4, "gefkw": 1, "ovd_p": 2, "hondengeleider": 2, "bike_police": 1, "fustw": 10, "lebefkw": 1}, "n": 3, "e": []}, {"c": "Binnenstap drugspand met vuurwapengevaarlijke verdachte", "s": "Middel", "v": {"at_m": 1, "gefkw": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 2, "at_c": 1, "polizeihubschrauber": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Bouwsteiger ingestort", "s": "Middel", "v": {"rw": 1, "dlk": 2, "elw": 2, "fire": 4, "search_and_rescue": 1, "fustw": 5}, "n": 2, "e": []}, {"c": "Brand bij afvalverwerker (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 3, "rw": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "care_service": 1, "gwa": 1, "fire": 8, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 4, "e": []}, {"c": "Brand bij afvalverwerker (Grip 3)", "s": "Middel", "v": {"gwl2wasser": 4, "rw": 1, "dlk": 3, "elw": 2, "elw3": 1, "elw2": 1, "care_service": 1, "gwa": 1, "fire": 12, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 4, "e": []}, {"c": "Brand bij afvalverwerker (Zeer Groot)", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1}, "n": 1, "e": []}, {"c": "Brand in Bibliotheek", "s": "Middel", "v": {"rw": 2, "foam": 2, "elw": 2, "elw2": 1, "fire": 6, "spokesman": 1, "bike_police": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in Silo", "s": "Middel", "v": {"rw": 1, "foam": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 2}, "n": 4, "e": []}, {"c": "Brand in bioscoop", "s": "Middel", "v": {"gwl2wasser": 2, "dlk": 2, "elw": 2, "elw3": 1, "ovd_p": 2, "elw2": 1, "gwa": 1, "fire": 5, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 2, "fustw": 9}, "n": 2, "e": []}, {"c": "Brand in boerderij", "s": "Middel", "v": {"dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 5}, "n": 2, "e": []}, {"c": "Brand in bouwmarkt (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "foam": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "care_service": 1, "gwa": 1, "fire": 4, "gwmesstechnik": 1, "fustw": 2}, "n": 8, "e": []}, {"c": "Brand in bouwmarkt (Grip 2)", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "foam": 2, "dlk": 3, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 4}, "n": 8, "e": []}, {"c": "Brand in chocolade-eierenfabriek", "s": "Middel", "v": {"gwl2wasser": 4, "dlk": 4, "elw": 4, "elw2": 1, "gwa": 2, "fire": 16, "fustw": 8}, "n": 1, "e": []}, {"c": "Brand in fabriekshal", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 3}, "n": 6, "e": []}, {"c": "Brand in gasverdeelstation", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "foam": 2, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 2, "gwa": 1, "care_service": 1, "hazard_response_material": 1, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 8, "industrial_response_engine": 1}, "n": 32, "e": []}, {"c": "Brand in graandroger", "s": "Middel", "v": {"gwl2wasser": 1, "foam": 1, "rw": 1, "dlk": 2, "elw": 2, "elw2": 1, "gwa": 2, "fire": 4, "fustw": 2}, "n": 1, "e": [], "vt": {"100": 1}}, {"c": "Brand in hangaar", "s": "Middel", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "elw_airport": 1, "gwa": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 4}, "n": 1, "e": []}, {"c": "Brand in hoogspanningsruimte", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 3}, "n": 1, "e": []}, {"c": "Brand in hooischuur", "s": "Middel", "v": {"foam": 1, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 5}, "n": 4, "e": []}, {"c": "Brand in houtzagerij", "s": "Middel", "v": {"gwl2wasser": 1, "foam": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 3, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 3}, "n": 4, "e": []}, {"c": "Brand in kerkgebouw", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "dlk": 2, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "fustw": 2}, "n": 6, "e": []}, {"c": "Brand in magazijn", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 6, "gwgefahrgut": 1, "gwmesstechnik": 2, "fustw": 2}, "n": 4, "e": []}, {"c": "Brand in meubelzaak", "s": "Middel", "v": {"gwl2wasser": 4, "foam": 1, "dlk": 3, "elw": 3, "elw2": 1, "ovd_p": 1, "gwa": 2, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 2, "fustw": 5}, "n": 1, "e": []}, {"c": "Brand in nachtclub", "s": "Middel", "v": {"gwl2wasser": 1, "dlk": 2, "elw": 1, "elw3": 1, "ovd_p": 1, "elw2": 1, "gwa": 1, "hondengeleider": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 6}, "n": 3, "e": []}, {"c": "Brand in opslagloods", "s": "Middel", "v": {"gwl2wasser": 4, "foam": 3, "rw": 2, "dlk": 4, "elw": 4, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 16}, "n": 1, "e": []}, {"c": "Brand in passagierstrein (Grip 1)", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw3": 1, "care_service": 1, "railway_fire_engine": 3, "fustw": 10, "elw": 2, "gwa": 1, "fire": 6, "gwmesstechnik": 3, "gwl2wasser": 2, "foam": 1, "gwgefahrgut": 1, "spokesman": 1, "railway_electric_response": 1, "elw2": 1, "ovd_p": 2}, "n": 16, "e": []}, {"c": "Brand in passagierstrein (Groot)", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "elw": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "spokesman": 1, "railway_fire_engine": 2, "fustw": 4, "railway_electric_response": 1}, "n": 2, "e": []}, {"c": "Brand in restaurant", "s": "Middel", "v": {"gwl2wasser": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 3}, "n": 1, "e": []}, {"c": "Brand in sauna", "s": "Middel", "v": {"gwl2wasser": 2, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 5, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 2, "fustw": 5}, "n": 2, "e": []}, {"c": "Brand in serverruimte (Groot)", "s": "Middel", "v": {"gwl2wasser": 3, "rw": 3, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 3, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Brand in serverruimte (Middel)", "s": "Middel", "v": {"gwl2wasser": 3, "rw": 2, "elw": 2, "elw3": 1, "gwa": 1, "fire": 5, "gwmesstechnik": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in snackbar (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 2, "foam": 1, "rw": 1, "dlk": 3, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 10, "spokesman": 1, "gwmesstechnik": 3, "fustw": 4}, "n": 2, "e": []}, {"c": "Brand in snackbar (Zeer Groot)", "s": "Middel", "v": {"gwl2wasser": 1, "dlk": 2, "elw": 2, "elw2": 1, "fire": 6, "fustw": 4}, "n": 1, "e": []}, {"c": "Brand in station (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 3, "foam": 1, "dlk": 2, "elw": 4, "elw3": 1, "elw2": 2, "ovd_p": 1, "gwa": 1, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 6}, "n": 8, "e": []}, {"c": "Brand in station (Groot)", "s": "Middel", "v": {"gwl2wasser": 2, "dlk": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Brand in tankstation", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "foam": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 5, "e": []}, {"c": "Brand in terminal", "s": "Middel", "v": {"foam": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "elw_airport": 1, "gwa": 1, "ovd_p": 1, "fire": 3, "fustw": 4}, "n": 2, "e": []}, {"c": "Brand in theater", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "dlk": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 4}, "n": 6, "e": []}, {"c": "Brand in tram (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "dlk": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "fire": 8, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "railway_fire_engine": 3, "fustw": 6}, "n": 8, "e": []}, {"c": "Brand in ziekenhuis (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 4, "foam": 1, "dlk": 3, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 2, "fire": 6, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 4}, "n": 8, "e": []}, {"c": "Brand in ziekenhuis (Groot)", "s": "Middel", "v": {"gwl2wasser": 2, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 5, "spokesman": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Brand op bedrijventerrein", "s": "Middel", "v": {"foam": 2, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 4, "fustw": 4}, "n": 2, "e": []}, {"c": "Brand op passagiersschip", "s": "Middel", "v": {"gw_taucher": 3, "rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 3, "boot": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand op veerpont", "s": "Middel", "v": {"gw_taucher": 3, "rw": 1, "foam": 1, "dlk": 2, "elw": 1, "elw2": 1, "ovd_p": 1, "fire": 3, "boot": 3, "fustw": 4, "gw_wasserrettung": 1}, "n": 3, "e": []}, {"c": "Brand op windmolenpark", "s": "Middel", "v": {"rw": 1, "dlk": 2, "elw": 2, "elw2": 1, "ovd_p": 2, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 3, "fustw": 6}, "n": 1, "e": []}, {"c": "Brand partycentrum", "s": "Middel", "v": {"gwl2wasser": 2, "foam": 1, "dlk": 2, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 5, "gwmesstechnik": 2, "fustw": 4}, "n": 1, "e": []}, {"c": "Brand zonnepanelen", "s": "Middel", "v": {"gwl2wasser": 3, "rw": 2, "dlk": 3, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 2, "gwa": 2, "fire": 2, "gwgefahrgut": 2, "spokesman": 1, "bike_police": 2, "gwmesstechnik": 4, "fustw": 13}, "n": 4, "e": []}, {"c": "Brandende goederenwagon (Groot)", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "foam": 1, "elw": 1, "elw2": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 4, "industrial_response_engine": 1}, "n": 4, "e": []}, {"c": "Brandende tankwagen", "s": "Middel", "v": {"gwl2wasser": 1, "foam": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 4}, "n": 3, "e": []}, {"c": "Chloorgas ontsnapt", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 3, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 5, "gwgefahrgut": 1, "gwmesstechnik": 3, "fustw": 4}, "n": 1, "e": []}, {"c": "Controle bij de openingsceremonie van sport evenement", "s": "Middel", "v": {"grukw": 3, "elw": 2, "gefkw": 1, "ovd_p": 1, "fire": 4, "fustw": 3, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Demonstranten vastgelijmd aan snelweg", "s": "Middel", "v": {"rw": 1, "grukw": 3, "gefkw": 2, "ovd_p": 2, "any_traffic_unit": 2, "hondengeleider": 2, "fire": 2, "fustw": 20, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Duinbrand (Grip 1)", "s": "Middel", "v": {"elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 3, "fustw": 4, "gw_wasserrettung": 2, "brush_truck": 6}, "n": 4, "e": []}, {"c": "Duinbrand (Grip 2)", "s": "Middel", "v": {"elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 2, "gwa": 2, "care_service": 1, "gwgefahrgut": 2, "polizeihubschrauber": 1, "spokesman": 1, "bike_police": 2, "gwmesstechnik": 5, "fustw": 6, "gw_wasserrettung": 2, "brush_truck": 10}, "n": 4, "e": []}, {"c": "Europese 112 dag viering", "s": "Middel", "v": {"rw": 1, "grukw": 2, "police_horse": 2, "dlk": 1, "elw": 1, "gefkw": 1, "ovd_p": 1, "hondengeleider": 1, "fire": 2, "fustw": 4, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Explosie in woonhuis", "s": "Middel", "v": {"rw": 2, "dlk": 2, "elw": 2, "elw2": 1, "elw3": 1, "gwa": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 4}, "n": 4, "e": []}, {"c": "Explosief gevonden in winkelcentrum", "s": "Middel", "v": {"rw": 1, "elw3": 1, "fustw": 6, "elw": 1, "fire": 1, "bike_police": 1, "gwgefahrgut": 1, "spokesman": 1, "ovd_p": 1, "elw2": 1, "hondengeleider": 1}, "n": 3, "e": []}, {"c": "Festival", "s": "Middel", "v": {"police_horse": 8, "ovd_p": 1, "hondengeleider": 1, "bike_police": 2, "fustw": 5}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Gaslek bedrijventerrein", "s": "Middel", "v": {"rw": 1, "foam": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwgefahrgut": 1, "fire": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 4}, "n": 4, "e": []}, {"c": "Gestolen vrachtwagen botst in een casino", "s": "Middel", "v": {"elw": 1, "ovd_p": 1, "hondengeleider": 1, "fire": 3, "fustw": 10}, "n": 1, "e": []}, {"c": "Gevel dreigt in te storten", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 3, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 2, "fustw": 3}, "n": 2, "e": []}, {"c": "Gijzeling", "s": "Middel", "v": {"grukw": 2, "at_m": 1, "gefkw": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 3, "at_c": 1, "polizeihubschrauber": 1, "fustw": 10}, "n": 2, "e": []}, {"c": "Grote alcoholcontrole bij race-evenement", "s": "Middel", "v": {"gefkw": 2, "ovd_p": 1, "hondengeleider": 4, "bike_police": 2, "fustw": 14}, "n": 1, "e": []}, {"c": "Grote zoekactie vermist persoon", "s": "Middel", "v": {"police_horse": 2, "polizeihubschrauber": 1, "boot": 2, "gw_wasserrettung": 4, "fustw": 6}, "n": 3, "e": []}, {"c": "Heidebrand (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 4, "rw": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 4, "brush_truck": 8}, "n": 4, "e": []}, {"c": "Heidebrand (Grip 2)", "s": "Middel", "v": {"gwl2wasser": 5, "rw": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 4, "brush_truck": 8}, "n": 4, "e": []}, {"c": "Lekkende goederenwagon (Groot)", "s": "Middel", "v": {"rw": 2, "hazard_response_suits": 1, "elw": 1, "elw2": 1, "gwa": 1, "hazard_response_material": 1, "fire": 4, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 3, "hazard_response_disinfection": 1}, "n": 8, "e": []}, {"c": "Massale paniek bij halloween parade", "s": "Middel", "v": {"elw": 1, "elw2": 1, "ovd_p": 1, "fire": 4, "fustw": 10}, "n": 1, "e": []}, {"c": "Nationale 112 award ceremonie", "s": "Middel", "v": {"gwl2wasser": 1, "rw": 1, "dlk": 2, "elw": 3, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "fustw": 6}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Natuurbrand (Grip 1)", "s": "Middel", "v": {"gwl2wasser": 2, "rw": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "spokesman": 1, "fustw": 4, "brush_truck": 6}, "n": 4, "e": []}, {"c": "Natuurbrand (Grip 2)", "s": "Middel", "v": {"gwl2wasser": 3, "rw": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "spokesman": 1, "fustw": 4, "brush_truck": 6}, "n": 4, "e": []}, {"c": "Natuurbrand (Grip 3)", "s": "Middel", "v": {"gwl2wasser": 5, "rw": 1, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "care_service": 1, "spokesman": 1, "gwmesstechnik": 1, "fustw": 6, "brush_truck": 8}, "n": 4, "e": []}, {"c": "Natuurbrand (Grip 4)", "s": "Middel", "v": {"gwl2wasser": 6, "rw": 1, "elw": 3, "elw3": 1, "elw2": 2, "ovd_p": 1, "gwa": 2, "care_service": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 6, "brush_truck": 8}, "n": 4, "e": []}, {"c": "Noodlanding groot vliegtuig", "s": "Middel", "v": {"rw": 1, "elw": 1, "elw_airport": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 2, "gwgefahrgut": 1, "gwmesstechnik": 2, "fustw": 4, "arff": 3}, "n": 1, "e": []}, {"c": "Oefening Arrestatieteam", "s": "Middel", "v": {"at_c": 1, "at_o": 4, "at_m": 1, "fustw": 10}, "n": 1, "e": []}, {"c": "Omgevallen hijskraan", "s": "Middel", "v": {"rw": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 2, "gwmesstechnik": 3, "fustw": 6}, "n": 1, "e": []}, {"c": "Onaangekondigde demonstratie", "s": "Middel", "v": {"grukw": 6, "gefkw": 1, "ovd_p": 1, "hondengeleider": 1, "bike_police": 1, "fustw": 5, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Onaangekondigde paashaasstaking", "s": "Middel", "v": {"grukw": 3, "gefkw": 1, "ovd_p": 1, "polizeihubschrauber": 1, "fustw": 10, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Ontsnapping gevaarlijke gedetineerde", "s": "Middel", "v": {"at_m": 1, "gefkw": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 2, "at_c": 1, "polizeihubschrauber": 1, "bike_police": 2, "fustw": 12}, "n": 1, "e": []}, {"c": "Ontspoorde tram botst tegen gebouw", "s": "Middel", "v": {"rw": 2, "dlk": 1, "elw3": 1, "care_service": 1, "railway_fire_engine": 3, "fustw": 10, "elw": 2, "gwa": 1, "fire": 8, "gwmesstechnik": 3, "gwl2wasser": 1, "gwgefahrgut": 1, "spokesman": 1, "railway_fire_equipment_container": 1, "elw2": 1, "ovd_p": 1}, "n": 16, "e": []}, {"c": "Opbreken manifestatie", "s": "Middel", "v": {"grukw": 9, "gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "bike_police": 1, "fustw": 8, "lebefkw": 2}, "n": 2, "e": []}, {"c": "Overval tankstation met gijzeling", "s": "Middel", "v": {"at_m": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 1, "at_c": 1, "polizeihubschrauber": 1, "fustw": 6}, "n": 2, "e": []}, {"c": "Overval waardetransport", "s": "Middel", "v": {"at_m": 1, "gefkw": 1, "ovd_p": 3, "at_o": 4, "hondengeleider": 3, "at_c": 1, "polizeihubschrauber": 2, "fustw": 20}, "n": 1, "e": []}, {"c": "Passagierstrein botst op brandweerwagen in een spoorwegovergang", "s": "Middel", "v": {"rw": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "any_traffic_unit": 2, "fire": 6, "polizeihubschrauber": 1, "spokesman": 1, "railway_fire_engine": 3, "fustw": 6, "railway_electric_response": 1}, "n": 4, "e": []}, {"c": "Personen onwel in school", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 2, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 6}, "n": 1, "e": []}, {"c": "Personen vast in achtbaan", "s": "Middel", "v": {"rw": 1, "dlk": 2, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "fire": 4, "fustw": 6}, "n": 1, "e": []}, {"c": "Persoon met gevaarlijke stoffen", "s": "Middel", "v": {"gwl2wasser": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 4, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "fustw": 10}, "n": 2, "e": []}, {"c": "Protest voor racecircuit", "s": "Middel", "v": {"grukw": 3, "police_horse": 2, "hondengeleider": 1, "fustw": 10, "lebefkw": 1}, "n": 1, "e": []}, {"c": "School shooting", "s": "Middel", "v": {"at_m": 1, "elw3": 1, "ovd_p": 2, "at_o": 4, "hondengeleider": 2, "at_c": 1, "polizeihubschrauber": 1, "bike_police": 2, "fustw": 15}, "n": 2, "e": []}, {"c": "Schoolbus te water", "s": "Middel", "v": {"gw_taucher": 3, "rw": 2, "dlk": 1, "elw": 2, "ovd_p": 1, "elw2": 1, "fire": 3, "spokesman": 1, "boot": 2, "fustw": 4}, "n": 12, "e": []}, {"c": "Schrootbrand op schip", "s": "Middel", "v": {"gwl2wasser": 2, "foam": 1, "dlk": 2, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 6, "gwgefahrgut": 1, "spokesman": 1, "bike_police": 1, "gwmesstechnik": 3, "fustw": 6}, "n": 3, "e": []}, {"c": "Spontane opstand", "s": "Middel", "v": {"grukw": 6, "gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "bike_police": 2, "fustw": 10, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Toezicht manifestatie pietendiscussie", "s": "Middel", "v": {"grukw": 6, "police_horse": 8, "gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "polizeihubschrauber": 1, "fustw": 4, "lebefkw": 1}, "n": 1, "e": []}, {"c": "Toezicht nieuwjaarsfeest", "s": "Middel", "v": {"grukw": 6, "police_horse": 4, "gefkw": 1, "ovd_p": 1, "hondengeleider": 2, "bike_police": 5, "fustw": 4, "lebefkw": 1}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Uit de handgelopen overwinningsfeest", "s": "Middel", "v": {"grukw": 4, "police_horse": 4, "gefkw": 1, "ovd_p": 1, "hondengeleider": 1, "fustw": 8, "lebefkw": 1}, "n": 3, "e": []}, {"c": "Uitslaande brand in veestal", "s": "Middel", "v": {"foam": 2, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 1, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 4, "fustw": 3}, "n": 2, "e": []}, {"c": "Vermoeden van opslag grote partij illegaal vuurwerk", "s": "Middel", "v": {"rw": 1, "at_m": 1, "elw": 1, "gefkw": 1, "ovd_p": 1, "at_o": 4, "at_c": 1, "fire": 2, "bomb_disposal": 1, "bike_police": 2, "bomb_disposal_robot": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Verward persoon draait gaskraan open", "s": "Middel", "v": {"rw": 1, "at_m": 1, "elw": 1, "ovd_p": 1, "at_o": 4, "hondengeleider": 1, "at_c": 1, "fire": 1, "fustw": 4}, "n": 1, "e": []}, {"c": "Vliegtuig met brandmelding in vrachtruim", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "elw_airport": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "fustw": 5, "arff": 2}, "n": 1, "e": []}, {"c": "Vliegtuig met motorisch probleem", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "elw_airport": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "fustw": 5, "arff": 2}, "n": 1, "e": []}, {"c": "Vliegtuig met probleem met landingsgestel", "s": "Middel", "v": {"rw": 1, "dlk": 1, "elw": 1, "elw3": 1, "elw2": 1, "elw_airport": 1, "ovd_p": 1, "fire": 4, "gwgefahrgut": 1, "fustw": 5, "arff": 2}, "n": 1, "e": []}, {"c": "Vliegtuig neergestort", "s": "Middel", "v": {"rw": 3, "dlk": 2, "elw": 3, "elw3": 2, "elw2": 2, "ovd_p": 2, "fire": 10, "gwgefahrgut": 1, "spokesman": 1, "fustw": 14}, "n": 8, "e": []}, {"c": "Vloeistof lekkage uit gekantelde aanhanger", "s": "Middel", "v": {"rw": 2, "elw": 1, "elw2": 1, "ovd_p": 1, "fire": 2, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 2, "bike_police": 1, "fustw": 6}, "n": 1, "e": []}, {"c": "Voetbalwedstrijd, risicowedstrijd", "s": "Middel", "v": {"grukw": 6, "police_horse": 8, "gefkw": 1, "hondengeleider": 2, "lebefkw": 1}, "n": 3, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Vrachtwagen op file ingereden", "s": "Middel", "v": {"rw": 2, "elw": 1, "elw2": 1, "ovd_p": 1, "any_traffic_unit": 2, "traffic_patrol": 1, "fire": 4, "spokesman": 1, "fustw": 4}, "n": 2, "e": []}, {"c": "Vrachtwagen rijdt tegen losgeschoten aanhanger", "s": "Middel", "v": {"rw": 1, "elw": 1, "ovd_p": 1, "any_traffic_unit": 2, "fire": 3, "fustw": 8}, "n": 1, "e": []}, {"c": "Woonhuis ingestort", "s": "Middel", "v": {"rw": 2, "dlk": 1, "elw": 4, "elw3": 1, "elw2": 2, "ovd_p": 1, "gwa": 1, "fire": 2, "gwgefahrgut": 1, "polizeihubschrauber": 1, "spokesman": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Zwaar vuurwerk aangetroffen", "s": "Middel", "v": {"rw": 1, "elw": 1, "elw3": 1, "elw2": 1, "ovd_p": 1, "hondengeleider": 1, "fire": 2, "gwgefahrgut": 1, "polizeihubschrauber": 1, "spokesman": 1, "gwmesstechnik": 1, "bomb_disposal": 1, "bomb_disposal_robot": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "100 Ambulancestandplaats mijlpaal", "s": "Groot", "v": {"rw": 3, "dlk": 5, "elw": 6, "elw3": 3, "elw2": 3, "gwa": 2, "fire": 15, "spokesman": 1, "fustw": 10}, "n": 1, "e": []}, {"c": "1000 Brandweerkazerne mijlpaal", "s": "Groot", "v": {"dlk": 25, "elw": 10, "elw3": 3, "elw2": 6, "gwa": 3, "fire": 100, "gwgefahrgut": 3, "spokesman": 1, "gwmesstechnik": 3}, "n": 1, "e": []}, {"c": "1000 Politiebureau mijlpaal", "s": "Groot", "v": {"rw": 5, "at_m": 1, "dlk": 5, "elw3": 3, "at_c": 1, "fustw": 100, "elw": 6, "traffic_patrol": 1, "gwa": 2, "fire": 15, "bike_police": 3, "gefkw": 2, "at_o": 4, "spokesman": 1, "lebefkw": 1, "grukw": 6, "police_horse": 4, "elw2": 4, "ovd_p": 6, "hondengeleider": 3, "polizeihubschrauber": 2}, "n": 1, "e": []}, {"c": "250 Ambulancestandplaats mijlpaal", "s": "Groot", "v": {"rw": 3, "dlk": 5, "elw": 6, "elw3": 3, "elw2": 3, "gwa": 2, "fire": 15, "spokesman": 1, "fustw": 10}, "n": 1, "e": []}, {"c": "500 Ambulancestandplaats mijlpaal", "s": "Groot", "v": {"rw": 3, "dlk": 5, "elw": 6, "elw3": 3, "elw2": 3, "gwa": 2, "fire": 15, "spokesman": 1, "fustw": 10}, "n": 1, "e": []}, {"c": "500 Brandweerkazerne mijlpaal", "s": "Groot", "v": {"dlk": 25, "elw": 10, "elw3": 3, "elw2": 6, "gwa": 3, "fire": 50, "gwgefahrgut": 3, "spokesman": 1, "gwmesstechnik": 3}, "n": 1, "e": []}, {"c": "500 Politiebureau mijlpaal", "s": "Groot", "v": {"rw": 5, "at_m": 1, "dlk": 5, "elw3": 3, "at_c": 1, "fustw": 50, "elw": 6, "gwa": 2, "fire": 15, "bike_police": 3, "gefkw": 2, "at_o": 4, "spokesman": 1, "lebefkw": 1, "grukw": 6, "elw2": 4, "ovd_p": 6, "hondengeleider": 3, "polizeihubschrauber": 2}, "n": 1, "e": []}, {"c": "750 Brandweerkazerne mijlpaal", "s": "Groot", "v": {"dlk": 25, "elw": 10, "elw3": 3, "elw2": 6, "gwa": 3, "fire": 75, "gwgefahrgut": 3, "spokesman": 1, "gwmesstechnik": 3}, "n": 1, "e": []}, {"c": "750 Politiebureau mijlpaal", "s": "Groot", "v": {"rw": 5, "at_m": 1, "dlk": 5, "elw3": 3, "at_c": 1, "fustw": 75, "elw": 6, "gwa": 2, "fire": 15, "bike_police": 3, "gefkw": 2, "at_o": 4, "spokesman": 1, "lebefkw": 1, "grukw": 6, "elw2": 4, "ovd_p": 6, "hondengeleider": 3, "polizeihubschrauber": 2}, "n": 1, "e": []}, {"c": "Blokkade door boze menigte", "s": "Groot", "v": {"grukw": 6, "police_horse": 10, "gefkw": 2, "ovd_p": 1, "hondengeleider": 4, "polizeihubschrauber": 1, "fustw": 20, "lebefkw": 1}, "n": 2, "e": []}, {"c": "Brand bij afvalverwerker", "s": "Groot", "v": {"gwl2wasser": 6, "rw": 2, "dlk": 2, "elw": 5, "elw3": 1, "elw2": 2, "gwa": 1, "fire": 20, "gwgefahrgut": 1, "gwmesstechnik": 4, "fustw": 5}, "n": 1, "e": []}, {"c": "Brand bij papierrecyclaar", "s": "Groot", "v": {"gwl2wasser": 4, "rw": 2, "foam": 2, "dlk": 3, "elw": 4, "elw3": 1, "elw2": 2, "ovd_p": 1, "gwa": 2, "care_service": 1, "fire": 12, "gwgefahrgut": 2, "spokesman": 1, "gwmesstechnik": 4, "fustw": 6, "industrial_response_engine": 1}, "n": 16, "e": []}, {"c": "Brand in kantoorpand", "s": "Groot", "v": {"gwl2wasser": 3, "rw": 2, "dlk": 5, "elw": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 1, "fire": 15, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 4, "fustw": 10}, "n": 1, "e": []}, {"c": "Brand in nucleaire installatie", "s": "Groot", "v": {"rw": 3, "dlk": 6, "elw3": 2, "care_service": 1, "fustw": 8, "hazard_response_disinfection_large": 1, "elw": 6, "gwa": 2, "hazard_response_material": 1, "fire": 20, "gwmesstechnik": 6, "industrial_response_engine": 1, "gwl2wasser": 8, "foam": 2, "hazard_response_suits": 1, "gwgefahrgut": 3, "spokesman": 2, "elw2": 3, "ovd_p": 2, "industrial_response_fire_engine": 1, "polizeihubschrauber": 1}, "n": 256, "e": []}, {"c": "Brand in opslagloods met gevaarlijke stoffen", "s": "Groot", "v": {"rw": 10, "dlk": 10, "elw3": 5, "fustw": 10, "arff": 1, "elw": 10, "gwa": 10, "fire": 30, "bike_police": 2, "gwmesstechnik": 6, "gwl2wasser": 10, "foam": 10, "gwgefahrgut": 6, "spokesman": 5, "elw2": 5, "ovd_p": 1, "hondengeleider": 2, "polizeihubschrauber": 1}, "n": 1, "e": []}, {"c": "Brand in stadion", "s": "Groot", "v": {"rw": 1, "dlk": 3, "elw3": 1, "fustw": 12, "elw": 3, "gwa": 1, "fire": 1, "bike_police": 2, "gwmesstechnik": 6, "gefkw": 1, "gwgefahrgut": 2, "spokesman": 1, "lebefkw": 1, "grukw": 6, "elw2": 2, "ovd_p": 2, "hondengeleider": 2, "polizeihubschrauber": 1}, "n": 5, "e": []}, {"c": "Brand in station (Grip 2)", "s": "Groot", "v": {"gwl2wasser": 5, "foam": 1, "dlk": 3, "elw": 6, "elw3": 1, "elw2": 3, "ovd_p": 1, "gwa": 2, "fire": 12, "gwgefahrgut": 2, "spokesman": 1, "gwmesstechnik": 4, "fustw": 8}, "n": 8, "e": []}, {"c": "Brand in vuurwerkopslag", "s": "Groot", "v": {"rw": 1, "dlk": 3, "elw3": 1, "care_service": 1, "fustw": 12, "elw": 3, "gwa": 2, "hazard_response_material": 1, "fire": 10, "gwmesstechnik": 6, "industrial_response_engine": 1, "gwl2wasser": 4, "foam": 2, "gwgefahrgut": 2, "spokesman": 1, "elw2": 2, "ovd_p": 3, "industrial_response_fire_engine": 1, "polizeihubschrauber": 1}, "n": 64, "e": []}, {"c": "Brand in ziekenhuis (Grip 2)", "s": "Groot", "v": {"gwl2wasser": 5, "rw": 2, "foam": 1, "dlk": 4, "elw": 3, "elw3": 1, "elw2": 1, "ovd_p": 1, "gwa": 2, "fire": 12, "gwgefahrgut": 1, "spokesman": 1, "gwmesstechnik": 4, "fustw": 10}, "n": 8, "e": []}, {"c": "Brand overheidsgebouw", "s": "Groot", "v": {"rw": 2, "gwl2wasser": 3, "foam": 1, "dlk": 3, "elw": 3, "elw3": 1, "elw2": 2, "ovd_p": 2, "gwa": 2, "hondengeleider": 2, "fire": 8, "gwgefahrgut": 2, "polizeihubschrauber": 1, "spokesman": 1, "bike_police": 2, "gwmesstechnik": 5, "fustw": 15}, "n": 4, "e": []}, {"c": "Dieseltrein met gevaarlijke stoffen ontspoord", "s": "Groot", "v": {"rw": 3, "dlk": 2, "elw3": 1, "care_service": 1, "railway_fire_engine": 4, "fustw": 14, "hazard_response_disinfection_large": 1, "elw": 4, "gwa": 2, "hazard_response_material": 1, "fire": 12, "gwmesstechnik": 6, "industrial_response_engine": 1, "gwl2wasser": 2, "foam": 3, "hazard_response_suits": 1, "gwgefahrgut": 2, "spokesman": 1, "railway_fire_equipment_container": 1, "elw2": 2, "ovd_p": 2, "industrial_response_fire_engine": 1, "polizeihubschrauber": 1}, "n": 128, "e": []}, {"c": "Duinbrand (Grip 3)", "s": "Groot", "v": {"elw": 3, "elw3": 2, "elw2": 2, "ovd_p": 2, "gwa": 2, "care_service": 1, "gwgefahrgut": 2, "polizeihubschrauber": 1, "spokesman": 1, "bike_police": 2, "gwmesstechnik": 6, "fustw": 6, "gw_wasserrettung": 2, "brush_truck": 10}, "n": 4, "e": []}, {"c": "Duinbrand (Grip 4)", "s": "Groot", "v": {"elw": 3, "elw3": 2, "elw2": 2, "ovd_p": 2, "gwa": 2, "care_service": 1, "gwgefahrgut": 2, "polizeihubschrauber": 1, "spokesman": 2, "bike_police": 2, "gwmesstechnik": 6, "fustw": 8, "gw_wasserrettung": 2, "brush_truck": 12}, "n": 4, "e": []}, {"c": "Explosie in woonwijk", "s": "Groot", "v": {"rw": 2, "dlk": 3, "elw3": 1, "bomb_disposal_robot": 1, "fustw": 4, "arff": 3, "elw": 5, "gwa": 2, "fire": 10, "bomb_disposal": 2, "gwmesstechnik": 4, "gwl2wasser": 2, "foam": 2, "gwgefahrgut": 2, "spokesman": 1, "elw2": 2, "ovd_p": 1, "military_police": 4}, "n": 1, "e": []}, {"c": "Explosie luchthaven", "s": "Groot", "v": {"rw": 2, "dlk": 3, "elw3": 1, "bomb_disposal_robot": 1, "fustw": 4, "arff": 3, "elw": 5, "gwa": 2, "fire": 10, "bomb_disposal": 2, "gwmesstechnik": 4, "gwl2wasser": 2, "foam": 2, "gwgefahrgut": 2, "spokesman": 1, "elw2": 2, "ovd_p": 1, "military_police": 4}, "n": 1, "e": []}, {"c": "Massa-beroerte tijdens het eten van fondue (enorm)", "s": "Groot", "v": {"rw": 1, "dlk": 2, "elw": 3, "elw3": 1, "elw2": 1, "gwa": 1, "fire": 20, "gwgefahrgut": 1, "gwmesstechnik": 1, "fustw": 14}, "n": 1, "e": []}, {"c": "Natuurbrand", "s": "Groot", "v": {"rw": 4, "elw": 10, "elw3": 2, "elw2": 4, "gwa": 2, "fustw": 8, "brush_truck": 20}, "n": 1, "e": []}, {"c": "Natuurbrand (Grip 5)", "s": "Groot", "v": {"gwl2wasser": 8, "rw": 2, "elw": 3, "elw3": 1, "elw2": 2, "ovd_p": 1, "gwa": 2, "care_service": 1, "spokesman": 1, "gwmesstechnik": 3, "fustw": 8, "brush_truck": 10}, "n": 4, "e": []}, {"c": "Olietanker in de problemen", "s": "Groot", "v": {"gwl2wasser": 2, "rw": 4, "elw": 3, "coastal_boat": 2, "elw3": 2, "elw2": 1, "gwa": 1, "ovd_p": 1, "fire": 16, "gwgefahrgut": 2, "spokesman": 1, "gwmesstechnik": 4, "fustw": 10}, "n": 1, "e": []}, {"c": "Rellen na stadsderby", "s": "Groot", "v": {"grukw": 9, "police_horse": 4, "gefkw": 2, "ovd_p": 2, "hondengeleider": 4, "polizeihubschrauber": 1, "bike_police": 3, "fustw": 15, "lebefkw": 1}, "n": 8, "e": []}, {"c": "Rellen tijdens voetbal wedstrijd", "s": "Groot", "v": {"grukw": 9, "police_horse": 8, "gefkw": 2, "ovd_p": 3, "hondengeleider": 3, "polizeihubschrauber": 1, "bike_police": 2, "fustw": 25, "lebefkw": 2}, "n": 1, "e": []}, {"c": "Terroristische aanslag", "s": "Groot", "v": {"rw": 5, "dlk": 3, "at_m": 1, "elw": 6, "elw3": 2, "elw2": 3, "ovd_p": 2, "gwa": 3, "at_o": 4, "hondengeleider": 3, "at_c": 1, "polizeihubschrauber": 2, "fire": 15, "spokesman": 2, "fustw": 25}, "n": 2, "e": []}, {"c": "Trein ontspoord", "s": "Groot", "v": {"rw": 2, "dlk": 1, "elw3": 1, "care_service": 1, "railway_fire_engine": 3, "fustw": 10, "elw": 2, "gwa": 1, "fire": 8, "search_and_rescue": 1, "gwmesstechnik": 3, "gwl2wasser": 2, "foam": 1, "gwgefahrgut": 1, "spokesman": 1, "railway_electric_response": 1, "railway_fire_equipment_container": 1, "elw2": 1, "ovd_p": 2, "polizeihubschrauber": 1}, "n": 128, "e": []}, {"c": "Trein ontspoord na botsing met goederentrein", "s": "Groot", "v": {"rw": 2, "dlk": 1, "elw3": 1, "care_service": 1, "railway_fire_engine": 3, "fustw": 12, "elw": 3, "gwa": 2, "hazard_response_material": 1, "fire": 10, "gwmesstechnik": 3, "gwl2wasser": 2, "foam": 1, "hazard_response_suits": 1, "gwgefahrgut": 1, "spokesman": 1, "railway_electric_response": 1, "railway_fire_equipment_container": 1, "elw2": 1, "ovd_p": 2, "polizeihubschrauber": 1, "hazard_response_disinfection": 1}, "n": 256, "e": []}, {"c": "Uit de hand gelopen manifestatie", "s": "Groot", "v": {"grukw": 18, "police_horse": 24, "gefkw": 20, "ovd_p": 3, "hondengeleider": 8, "polizeihubschrauber": 1, "fustw": 50, "lebefkw": 3}, "n": 1, "e": []}, {"c": "ANPR hit: Gesignaleerd persoon", "s": "Klein", "v": {"traffic_patrol": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "ANPR hit: Mobiel banditisme", "s": "Klein", "v": {"traffic_patrol": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "ANPR hit: Rijden zonder rijbewijs", "s": "Klein", "v": {"traffic_patrol": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "ANPR hit: Vervreemd voertuig", "s": "Klein", "v": {"traffic_patrol": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Aanhouding verdachte in winkelcentrum", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2, "bike_police": 1}, "n": 1, "e": []}, {"c": "Aanrijding blokarters", "s": "Klein", "v": {"gw_wasserrettung": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Aanrijding hulpverleningsvoertuig", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 2}, "n": 4, "e": []}, {"c": "Accu ontploft", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Achtervolging gestolen scooter", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 4, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Alcoholcontrole", "s": "Klein", "v": {"fustw": 5, "gefkw": 1}, "n": 1, "e": []}, {"c": "Assistentie collega", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Assistentie treinconducteur", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 4, "ovd_p": 1}, "n": 2, "e": []}, {"c": "Auto met pech op vluchtstrook", "s": "Klein", "v": {"car_carrier": 1, "any_traffic_unit": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Auto tankstation ingereden", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Auto tegen woonhuis", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Autobrand op snelweg", "s": "Klein", "v": {"elw": 1, "any_traffic_unit": 1, "fire": 1, "fustw": 1, "gwl2wasser": 1}, "n": 1, "e": []}, {"c": "Bedreiging met vuurwapen", "s": "Klein", "v": {"fustw": 3, "ovd_p": 1}, "n": 2, "e": []}, {"c": "Bergen object uit water voor politie", "s": "Klein", "v": {"gw_taucher": 1, "fire": 1, "fustw": 2, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Beveiliger aangevallen", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Bladeren op spoor", "s": "Klein", "v": {"fire": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Bloemen gestolen", "s": "Klein", "v": {"fustw": 5}, "n": 1, "e": []}, {"c": "Boom op auto", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Boom op dak", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Bosbrand (Groot)", "s": "Klein", "v": {"brush_truck": 2, "elw2": 1, "elw": 1}, "n": 1, "e": []}, {"c": "Bosbrand (Middel)", "s": "Klein", "v": {"elw": 1, "brush_truck": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Bouwvakker bekneld onder bouwmateriaal", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Bouwvakker van hoogte gevallen (Spoed)", "s": "Klein", "v": {"dlk": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand bij afvalverwerker (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "gwl2wasser": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brand bij zendmast", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in asielzoekerscentrum (middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in bouwmarkt (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brand in bovenwoning (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in cafetaria (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in garagebox", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in keuken", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 3, "e": []}, {"c": "Brand in passagierstrein (Klein)", "s": "Klein", "v": {"railway_fire_engine": 1, "fire": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in schuurtje", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in serverruimte (Klein)", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brand in silo", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brand in slaapkamer", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 2, "e": []}, {"c": "Brand in spoorwissel", "s": "Klein", "v": {"railway_fire_engine": 2, "fire": 1}, "n": 1, "e": []}, {"c": "Brand in station (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brand in tram (Middel)", "s": "Klein", "v": {"elw": 1, "railway_fire_engine": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in tuinhuis", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 2, "e": []}, {"c": "Brand in vakantiewoning", "s": "Klein", "v": {"elw": 1, "dlk": 1, "gwl2wasser": 1, "fire": 2}, "n": 2, "e": []}, {"c": "Brand in werkplaats (Middel)", "s": "Klein", "v": {"elw": 1, "fire": 2, "fustw": 1, "gwa": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Brand in woonkamer", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brand in woonwagen (Middel)", "s": "Klein", "v": {"elw": 1, "fire": 2, "fustw": 1, "dlk": 1, "gwl2wasser": 1}, "n": 1, "e": []}, {"c": "Brand op balkon door vuurwerk", "s": "Klein", "v": {"dlk": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brandend plezierjacht", "s": "Klein", "v": {"gw_taucher": 1, "elw": 1, "fire": 2, "fustw": 1, "boot": 1}, "n": 2, "e": []}, {"c": "Brandend pompoenveld", "s": "Klein", "v": {"elw": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brandend praalwagen", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "fire": 3, "fustw": 1}, "n": 1, "e": []}, {"c": "Brandende aanhangwagen", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "fire": 2, "fustw": 1}, "n": 2, "e": []}, {"c": "Brandende frietkraam", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Brandende goederenwagon (Klein)", "s": "Klein", "v": {"elw": 1, "gwgefahrgut": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Brandende personenauto in parkeergarage (Middel)", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Brandende vliegtuigtrekker", "s": "Klein", "v": {"elw_airport": 1, "arff": 2, "fire": 1}, "n": 2, "e": []}, {"c": "Brandende wegberm", "s": "Klein", "v": {"elw": 1, "any_traffic_unit": 1, "gwl2wasser": 1, "fire": 2}, "n": 2, "e": []}, {"c": "Brandstichting", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Crash op Circuit", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Diefstal personenauto", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 3, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Dier op de snelweg", "s": "Klein", "v": {"any_traffic_unit": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Droger in brand", "s": "Klein", "v": {"dlk": 1, "fire": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Dronken bouwvakker rijdt cementwagen in de greppel", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Duinbrand", "s": "Klein", "v": {"gw_wasserrettung": 1, "brush_truck": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Fietser op de snelweg", "s": "Klein", "v": {"any_traffic_unit": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Frankenstein gespot", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Gasten hebben een vergiftigd drankje gedronken op verjaardagsfeest", "s": "Klein", "v": {"elw": 2, "fustw": 3}, "n": 1, "e": []}, {"c": "Gekantelde paaseivrachtwagen", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Gemaskerd bal trofee gestolen", "s": "Klein", "v": {"fustw": 5}, "n": 1, "e": []}, {"c": "Gesabotteerde vuurwerkshow", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Gevallen groep mountainbikers", "s": "Klein", "v": {"gw_wasserrettung": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Gevecht om de lelijkste kersttrui", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Gewonden op strand/ in de duinen", "s": "Klein", "v": {"gw_wasserrettung": 3, "fustw": 2}, "n": 1, "e": []}, {"c": "Grap veroorzaakt hartaanval", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Grote boek van Sinterklaas aangespoeld", "s": "Klein", "v": {"gw_taucher": 1, "fire": 1, "fustw": 1, "boot": 1}, "n": 1, "e": []}, {"c": "Heidebrand (Middel)", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "brush_truck": 2}, "n": 1, "e": []}, {"c": "Hennepkwekerij aangetroffen", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Identiteitsfraude", "s": "Klein", "v": {"fustw": 3}, "n": 2, "e": []}, {"c": "Illegaal vuurwerk in huis", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Illegale plantage (klein)", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 3, "gefkw": 1, "grukw": 1}, "n": 1, "e": []}, {"c": "Illegale stoffen gevonden in buffet", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Inbraak in bedrijfspand", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2}, "n": 3, "e": []}, {"c": "Inbraak in woning", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 4, "ovd_p": 1}, "n": 2, "e": []}, {"c": "Inbraakalarm", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Inbraakalarm bedrijfspand", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Inbraakalarm woning", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Insluiping in woning", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Inval in woning", "s": "Klein", "v": {"fustw": 3, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Kelderbrand door vuurwerk", "s": "Klein", "v": {"elw": 1, "fire": 3}, "n": 1, "e": []}, {"c": "Kersenbloesems in brand", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 3}, "n": 1, "e": []}, {"c": "Kerstboom gestolen", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Kerstman vast in schoorsteen", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Kind vast in hek", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Kind vast in klimtoestel", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Kinderreanimatie", "s": "Klein", "v": {"fire": 2, "fustw": 3}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Kitesurfer in problemen", "s": "Klein", "v": {"gw_wasserrettung": 2, "fustw": 1, "boot": 1}, "n": 1, "e": []}, {"c": "Klein vliegtuig met motorisch probleem", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2, "arff": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Koeien dief op de vlucht", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 5}, "n": 1, "e": []}, {"c": "Koolmonoxide vrijgekomen", "s": "Klein", "v": {"elw": 1, "gwgefahrgut": 1, "fire": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "LZV met pech op snelweg", "s": "Klein", "v": {"any_traffic_unit": 2, "fustw": 3}, "n": 1, "e": []}, {"c": "Lekkage gevaarlijke stoffen (Klein)", "s": "Klein", "v": {"gwgefahrgut": 1, "elw": 1, "fire": 1, "fustw": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Lekkende goederenwagon (Klein)", "s": "Klein", "v": {"elw": 1, "fire": 1, "gwgefahrgut": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Man over boord", "s": "Klein", "v": {"coastal_boat": 3}, "n": 1, "e": []}, {"c": "Militair betrokken bij verkeersongeluk", "s": "Klein", "v": {"military_police": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Militair onder invloed achter het stuur", "s": "Klein", "v": {"military_police": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Mogelijk explosief gevonden bij magneetvissen", "s": "Klein", "v": {"fustw": 2, "bike_police": 1}, "n": 1, "e": []}, {"c": "Monster uitgebroken", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Monteur in aanraking met hoogspanning", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Natuurbrand (Groot)", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "brush_truck": 3}, "n": 1, "e": []}, {"c": "Natuurbrand (Middel)", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "brush_truck": 2}, "n": 1, "e": []}, {"c": "Oefening brandweerduikers", "s": "Klein", "v": {"gw_taucher": 1, "fire": 1, "boot": 1}, "n": 1, "e": []}, {"c": "Onbeheerde bagage gevonden", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2, "ovd_p": 1}, "n": 4, "e": []}, {"c": "Onbevoegde op spoor", "s": "Klein", "v": {"railway_fire_engine": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Onbevoegden op spoor", "s": "Klein", "v": {"railway_fire_engine": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Ongeluk met overstekend hert", "s": "Klein", "v": {"fire": 2, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Ongeluk op mistige weg", "s": "Klein", "v": {"fire": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Ongelukken in de carnavalsoptocht", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Ongeval met sneeuwploeg", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Ongeval waterscooter", "s": "Klein", "v": {"gw_wasserrettung": 2, "boot": 1, "coastal_boat": 1}, "n": 2, "e": []}, {"c": "Ontplofte gasfles", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Open dag, groot", "s": "Klein", "v": {"fire": 2, "dlk": 1, "rw": 1, "fustw": 1}, "n": 1, "e": [], "vt": {"100": 1}}, {"c": "Open dag, klein", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Overval tankstation", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Overvalalarm bankkantoor", "s": "Klein", "v": {"fustw": 4, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Overvalalarm supermarkt", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Paard in sloot", "s": "Klein", "v": {"gw_taucher": 1, "fire": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Paaseieren vermist", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Paaseieren zoeken onder water", "s": "Klein", "v": {"gw_taucher": 2, "fire": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Paashaas in een kraan", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Paniekknop geactiveerd", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Paraglider neergestort", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 2, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Parkeergarage onder water", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "fire": 2}, "n": 2, "e": []}, {"c": "Personen geraakt door weggevlogen parasol", "s": "Klein", "v": {"gw_wasserrettung": 3, "fire": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Personen op dak van school", "s": "Klein", "v": {"dlk": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Personen opgesloten in sauna", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Personen vallen voorbijgangers lastig", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Personenauto in sloot", "s": "Klein", "v": {"gw_taucher": 1, "elw": 1, "fire": 1, "fustw": 2, "rw": 1}, "n": 4, "e": []}, {"c": "Persoon bekneld in machine", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Persoon bekneld onder boom", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Persoon bekneld onder heftruck", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Persoon bekneld onder kerstpakketten", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Persoon bekneld tussen containers", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Persoon geraakt door schroef van boot", "s": "Klein", "v": {"gw_taucher": 1, "fire": 1, "fustw": 2, "boot": 1}, "n": 1, "e": []}, {"c": "Persoon met mes gezien", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Persoon onwel in attractie", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Persoon onwel na mixen mest", "s": "Klein", "v": {"gwgefahrgut": 1, "gwmesstechnik": 1, "elw": 1, "fire": 1, "fustw": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Persoon opgesloten in sauna", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Persoon vast in roltrap", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Persoon vermist rondom mui", "s": "Klein", "v": {"gw_wasserrettung": 1, "polizeihubschrauber": 1, "fustw": 2, "boot": 1}, "n": 2, "e": []}, {"c": "Picknick met kaarslicht veroorzaakt bosbrand", "s": "Klein", "v": {"elw": 1, "gwl2wasser": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Prioriteit: paasei-jacht", "s": "Klein", "v": {"fustw": 6}, "n": 1, "e": []}, {"c": "Racefans houden straatrace", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 3, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Racistisch gezang van fans op de tribune", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Ramkraak", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 4, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Reanimatie", "s": "Klein", "v": {"fire": 1, "fustw": 2}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Reanimatie drenkeling", "s": "Klein", "v": {"fire": 1, "fustw": 2}, "n": 1, "e": [], "vt": {"100": 1, "101": 1}}, {"c": "Rookontwikkeling in vrachtruim vliegtuig", "s": "Klein", "v": {"elw_airport": 1, "arff": 2, "fire": 1}, "n": 1, "e": []}, {"c": "Ruzie op terras", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Ruzie tijdens uitgaansnacht", "s": "Klein", "v": {"ovd_p": 1, "hondengeleider": 1, "fustw": 3, "bike_police": 1}, "n": 1, "e": []}, {"c": "Schietincident", "s": "Klein", "v": {"fustw": 5, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Schoorsteenbrand woning met rietenkap", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Sneeuwploeg gekanteld op provinciale weg", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Speler vermist", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Spookrijder", "s": "Klein", "v": {"traffic_patrol": 1, "fustw": 3}, "n": 2, "e": []}, {"c": "Stankoverlast", "s": "Klein", "v": {"elw": 1, "gwgefahrgut": 1, "fire": 1, "fustw": 1}, "n": 2, "e": []}, {"c": "Steekincident", "s": "Klein", "v": {"fustw": 5, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Stilgevallen trein", "s": "Klein", "v": {"railway_fire_engine": 4}, "n": 1, "e": []}, {"c": "Storing in attractie pretpark", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Straat afzetten voor politie", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Straat onder water", "s": "Klein", "v": {"fire": 1, "gwl2wasser": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Surfer vermist", "s": "Klein", "v": {"coastal_boat": 2, "gw_wasserrettung": 2}, "n": 1, "e": []}, {"c": "Valse kaartjes race in verkoop", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Vechtpartij in bankkantoor", "s": "Klein", "v": {"fustw": 4, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Verdacht pakket gevonden bij de ingang van het sportstadion", "s": "Klein", "v": {"fustw": 5}, "n": 1, "e": []}, {"c": "Verdacht vaartuig in de haven", "s": "Klein", "v": {"military_police": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Verdachte situatie", "s": "Klein", "v": {"fustw": 2, "bike_police": 1}, "n": 3, "e": []}, {"c": "Verdachte situatie luchthaven", "s": "Klein", "v": {"military_police": 2, "fustw": 1}, "n": 1, "e": []}, {"c": "Verjaardagsgast vermist", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Verjaardagsgasten hebben versiering gestolen", "s": "Klein", "v": {"fustw": 4}, "n": 1, "e": []}, {"c": "Verkeersongeval door gevallen bladeren", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Verkeersongeval door gladheid", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 1}, "n": 3, "e": []}, {"c": "Verkeersongeval door verliefdheid", "s": "Klein", "v": {"fire": 1, "rw": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Verkeersongeval met gevaarlijke stoffen (Klein)", "s": "Klein", "v": {"gwgefahrgut": 1, "elw": 1, "fire": 1, "fustw": 2, "rw": 1}, "n": 1, "e": []}, {"c": "Verkeersongeval met lijnbus en fietser", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2, "rw": 1}, "n": 3, "e": []}, {"c": "Verkeersongeval met sportersbus", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Verkeersongeval met vrachtwagen en fietser", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 2, "rw": 1}, "n": 4, "e": []}, {"c": "Verkeersruzie", "s": "Klein", "v": {"fustw": 3, "ovd_p": 1}, "n": 1, "e": []}, {"c": "Verlaten kinderfiets langs waterkant", "s": "Klein", "v": {"elw": 1, "fire": 1, "gw_taucher": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Verlaten kleding langs waterkant", "s": "Klein", "v": {"elw": 1, "fire": 1, "gw_taucher": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Verlaten slee langs waterkant", "s": "Klein", "v": {"elw": 1, "fire": 1, "gw_taucher": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Verlovingsring gestolen tijdens aanzoek", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Vermist persoon", "s": "Klein", "v": {"polizeihubschrauber": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Vermist persoon op begraafplaats", "s": "Klein", "v": {"fire": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Verward persoon bij spoor", "s": "Klein", "v": {"fustw": 3}, "n": 2, "e": []}, {"c": "Vliegtuig met brandgeur in cabine", "s": "Klein", "v": {"elw_airport": 1, "arff": 2, "fire": 1}, "n": 1, "e": []}, {"c": "Vliegtuig met hydraulisch probleem", "s": "Klein", "v": {"elw_airport": 1, "arff": 2, "fire": 1}, "n": 1, "e": []}, {"c": "Vliegtuig met rook in cabine", "s": "Klein", "v": {"elw_airport": 1, "arff": 2, "fire": 1}, "n": 1, "e": []}, {"c": "Vluchtende verdachte in voetgangersgebied", "s": "Klein", "v": {"hondengeleider": 1, "fustw": 2, "bike_police": 1}, "n": 1, "e": []}, {"c": "Voedselvergiftiging door vergiftigd snoep", "s": "Klein", "v": {"elw": 1, "fire": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Voetganger aangereden door rendier", "s": "Klein", "v": {"elw": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Voetganger onder tram", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Voetganger op de snelweg", "s": "Klein", "v": {"any_traffic_unit": 1, "fustw": 3}, "n": 1, "e": []}, {"c": "Vogel vast in schoorsteen", "s": "Klein", "v": {"fire": 1, "dlk": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Voorzorgslanding klein vliegtuig", "s": "Klein", "v": {"elw_airport": 1, "arff": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Vrachtwagen gekanteld", "s": "Klein", "v": {"elw": 1, "any_traffic_unit": 1, "fire": 1, "fustw": 1, "rw": 1}, "n": 4, "e": []}, {"c": "Vrachtwagen gekanteld door ijzel", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Vrachtwagen met eierpunch gekanteld", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Vrachtwagen omgevallen in de greppel", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Vrachtwagen omgewaaid", "s": "Klein", "v": {"elw": 1, "fire": 2, "rw": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Vreemde lucht", "s": "Klein", "v": {"elw": 1, "fire": 1, "gwgefahrgut": 1, "rw": 1}, "n": 1, "e": []}, {"c": "Vreemde lucht portiek", "s": "Klein", "v": {"fire": 2, "dlk": 1, "gwmesstechnik": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Vuur door elektrische verjaardagsversiering (groot)", "s": "Klein", "v": {"elw": 1, "fire": 4}, "n": 1, "e": []}, {"c": "Vuurwerkoverlast", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Wasmachine in brand", "s": "Klein", "v": {"dlk": 1, "fire": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Wielrenner aangereden", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 2}, "n": 1, "e": []}, {"c": "Wielrenner ongeluk tijdens wedstrijd", "s": "Klein", "v": {"elw": 1, "fire": 1, "rw": 1, "fustw": 1}, "n": 1, "e": []}, {"c": "Winkeloverval door geesten", "s": "Klein", "v": {"fustw": 3}, "n": 1, "e": []}, {"c": "Woningbrand", "s": "Klein", "v": {"elw": 1, "dlk": 1, "fire": 2, "fustw": 2}, "n": 1, "e": []}, {"c": "Zoektocht naar verdwenen vriendje", "s": "Klein", "v": {"hondengeleider": 1, "polizeihubschrauber": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Zwemmer in nood", "s": "Klein", "v": {"fire": 1, "fustw": 2}, "n": 2, "e": []}, {"c": "Zwemmer vermist", "s": "Klein", "v": {"gw_wasserrettung": 1, "fustw": 1, "boot": 1}, "n": 1, "e": []}, {"c": "Zwemmer vermist (Klein)", "s": "Klein", "v": {"gw_taucher": 1, "elw": 1, "fire": 1, "fustw": 1, "boot": 1}, "n": 1, "e": []}, {"c": "Blikseminslag rietenkap (Grip 1)", "s": "Middel", "v": {"spokesman": 1, "fustw": 5, "dlk": 1, "gwgefahrgut": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 1, "elw": 2, "elw3": 1, "rw": 1, "ovd_p": 1, "gwmesstechnik": 2, "gwl2wasser": 2, "fire": 6}, "n": 8, "e": []}, {"c": "Blikseminslag rietenkap (Grip 2)", "s": "Middel", "v": {"spokesman": 1, "fustw": 7, "dlk": 2, "gwgefahrgut": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 1, "elw": 2, "elw3": 1, "rw": 1, "ovd_p": 1, "gwmesstechnik": 4, "gwl2wasser": 2, "fire": 8}, "n": 8, "e": []}, {"c": "Blikseminslag rietenkap (Groot)", "s": "Klein", "v": {"spokesman": 1, "fustw": 2, "dlk": 1, "thatched_firefighting": 1, "gwa": 1, "elw": 1, "rw": 1, "gwmesstechnik": 1, "gwl2wasser": 1, "fire": 4}, "n": 2, "e": []}, {"c": "Blikseminslag rietenkap (Klein)", "s": "Klein", "v": {"fire": 1, "thatched_firefighting": 1}, "n": 1, "e": []}, {"c": "Blikseminslag rietenkap (Middel)", "s": "Klein", "v": {"dlk": 1, "thatched_firefighting": 1, "elw": 1, "rw": 1, "fire": 2}, "n": 1, "e": []}, {"c": "Brand in rietenkap na werkzaamheden (Grip 1)", "s": "Middel", "v": {"spokesman": 1, "fustw": 4, "dlk": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 1, "elw": 2, "elw3": 1, "ovd_p": 1, "gwmesstechnik": 3, "gwl2wasser": 2, "fire": 7}, "n": 8, "e": []}, {"c": "Brand in rietenkap na werkzaamheden (Grip 2)", "s": "Middel", "v": {"spokesman": 1, "fustw": 7, "dlk": 2, "gwgefahrgut": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 2, "elw": 2, "elw3": 1, "ovd_p": 1, "gwmesstechnik": 3, "gwl2wasser": 2, "fire": 10}, "n": 8, "e": []}, {"c": "Brand in rietenkap na werkzaamheden (Groot)", "s": "Klein", "v": {"fustw": 2, "dlk": 1, "thatched_firefighting": 1, "gwa": 1, "elw": 1, "gwmesstechnik": 1, "gwl2wasser": 2, "fire": 4}, "n": 2, "e": []}, {"c": "Brand in rietenkap na werkzaamheden (Klein)", "s": "Klein", "v": {"fire": 1, "thatched_firefighting": 1}, "n": 1, "e": []}, {"c": "Brand in rietenkap na werkzaamheden (Middel)", "s": "Klein", "v": {"dlk": 1, "thatched_firefighting": 1, "fire": 2, "elw": 1}, "n": 1, "e": []}, {"c": "Ezel in sloot", "s": "Klein", "v": {"rw": 1, "gw_taucher": 1, "livestock_hoist": 1, "fire": 1}, "n": 2, "e": []}, {"c": "Geit in gierput", "s": "Klein", "v": {"livestock_hoist": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Koe in gierput", "s": "Klein", "v": {"rw": 1, "livestock_hoist": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Koe in sloot", "s": "Klein", "v": {"rw": 1, "livestock_hoist": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Rietenkapbrand (Klein)", "s": "Klein", "v": {"fire": 1, "thatched_firefighting": 1}, "n": 1, "e": []}, {"c": "Rietkapbrand (Grip 1)", "s": "Middel", "v": {"spokesman": 1, "fustw": 4, "dlk": 1, "gwgefahrgut": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 1, "elw": 2, "elw3": 1, "ovd_p": 1, "gwmesstechnik": 2, "gwl2wasser": 2, "fire": 6}, "n": 8, "e": []}, {"c": "Rietkapbrand (Grip 2)", "s": "Middel", "v": {"spokesman": 1, "fustw": 6, "dlk": 2, "gwgefahrgut": 1, "care_service": 1, "thatched_firefighting": 1, "elw2": 1, "gwa": 1, "elw": 2, "elw3": 1, "ovd_p": 1, "gwmesstechnik": 3, "gwl2wasser": 2, "fire": 8}, "n": 8, "e": []}, {"c": "Rietkapbrand (Groot)", "s": "Klein", "v": {"spokesman": 1, "fustw": 2, "dlk": 1, "gwgefahrgut": 1, "thatched_firefighting": 1, "gwa": 1, "elw": 1, "gwmesstechnik": 1, "gwl2wasser": 1, "fire": 4}, "n": 2, "e": []}, {"c": "Rietkapbrand (Middel)", "s": "Klein", "v": {"dlk": 1, "thatched_firefighting": 1, "fire": 2, "elw": 1}, "n": 1, "e": []}, {"c": "Schaap in sloot", "s": "Klein", "v": {"livestock_hoist": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Varken in gierput", "s": "Klein", "v": {"rw": 1, "livestock_hoist": 1, "fire": 1}, "n": 1, "e": []}, {"c": "Brand in diervoerfabriek (Grip 1)", "s": "Middel", "v": {"gwa": 1, "gwl2wasser": 3, "gwgefahrgut": 1, "fustw": 5, "elw": 2, "gwmesstechnik": 2, "elw3": 1, "elw2": 1, "ovd_p": 1, "spokesman": 1, "fire": 6, "dlk": 2}, "n": 2, "e": []}, {"c": "Brand in diervoerfabriek (Groot)", "s": "Klein", "v": {"gwa": 1, "gwl2wasser": 2, "gwgefahrgut": 1, "fustw": 2, "elw": 1, "gwmesstechnik": 1, "spokesman": 1, "fire": 4, "dlk": 1}, "n": 1, "e": []}, {"c": "Brand in diervoerfabriek (Middel)", "s": "Klein", "v": {"gwl2wasser": 1, "fustw": 1, "elw": 1, "fire": 3, "dlk": 1}, "n": 1, "e": []}];

        // The game rejects captions over 60 characters: cut at a word boundary.
        const capOf = c => { const t = CONFIG.PREFIX + c; if (t.length <= 60) return t; const cut = t.slice(0, 59); return cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 59).replace(/[ ,;:-]+$/, '') + '…'; };
        // Log lines show up in the dashboard as well as in the console.
        const lines = [];
        const log = (...a) => {
            ctx.log(...a);
            lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
            if (lines.length > 200) lines.shift();
            ctx.refresh();
        };
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const parse = html => new DOMParser().parseFromString(html, 'text/html');
        const get = async u => parse(await (await fetch(u, { credentials: 'include' })).text());

        async function readState() {
            const doc = await get('/aaos/new');
            const form = [...doc.forms].find(f => /\/aaos$/.test(f.action));
            const token = form.querySelector('[name=authenticity_token]').value;
            const cats = {};
            form.querySelectorAll('[name="aao[aao_category_id]"] option').forEach(o => { if (o.value) cats[o.text.trim()] = o.value; });
            const list = await get('/aaos');
            const existing = new Map([...list.querySelectorAll('a[href$="/edit"][href^="/aaos/"]')]
                .map(a => [a.textContent.trim(), a.getAttribute('href')]).filter(([n]) => n));
            return { token, cats, existing, slots: new Set([...form.elements].map(e => e.name)) };
        }

        async function createCategory(caption, token, order) {
            const body = new URLSearchParams({ utf8: '✓', authenticity_token: token, 'aao_category[caption]': caption, 'aao_category[order_number]': String(order), 'aao_category[hidden]': '0' });
            const r = await fetch('/aao_category/create', { method: 'POST', credentials: 'include', body });
            if (!r.ok) throw new Error('category create failed ' + r.status);
        }

        // GGB (100) en NHT (101) staan alleen als los voertuigtype op het formulier
        // (vehicle_type_ids[...]), niet als algemeen aao[...] veld.
        function applyVehicleTypeIds(fd, vt) {
            for (const [id, n] of Object.entries(vt || {})) fd.set('vehicle_type_ids[' + id + ']', String(n));
        }

        async function createPreset(p, catId, token) {
            // Build the body from the real form: the game rejects posts that omit its blank defaults.
            const doc = await get('/aaos/new');
            const form = [...doc.forms].find(f => /\/aaos$/.test(f.action));
            const fd = new FormData(form);
            fd.set('aao[caption]', capOf(p.c));
            fd.set('aao[aao_category_id]', catId);
            if (CONFIG.COLOR) fd.set('aao[color]', CONFIG.COLOR);
            for (const [slot, n] of Object.entries(p.v)) fd.set('aao[' + slot + ']', String(n));
            applyVehicleTypeIds(fd, p.vt);
            const r = await fetch('/aaos', { method: 'POST', credentials: 'include', body: new URLSearchParams(fd) });
            if (!r.ok) throw new Error('preset create failed ' + r.status);
            if ([...parse(await r.text()).forms].some(f => /\/aaos$/.test(f.action))) throw new Error('rejected by validation: ' + p.c);
        }

        // Vergelijkt wat een bestaand voorstel nu heeft met wat het moet hebben.
        // Geeft null terug als alles al klopt.
        function diffPreset(form, p) {
            const diff = {};
            for (const [slot, n] of Object.entries(p.v)) {
                const cur = form.querySelector('[name="aao[' + slot + ']"]')?.value || '0';
                if (String(cur) !== String(n)) diff['aao[' + slot + ']'] = [cur, n];
            }
            for (const [id, n] of Object.entries(p.vt || {})) {
                const cur = form.querySelector('[name="vehicle_type_ids[' + id + ']"]')?.value || '0';
                if (String(cur) !== String(n)) diff['vehicle_type_ids[' + id + ']'] = [cur, n];
            }
            return Object.keys(diff).length ? diff : null;
        }

        async function patchPreset(href, p) {
            const editDoc = await get(href);
            const form = [...editDoc.forms].find(f => /\/aaos\/\d+$/.test(f.action) || f.querySelector('[name=_method]'));
            if (!form) throw new Error('bewerkformulier niet gevonden voor ' + href);
            const diff = diffPreset(form, p);
            if (!diff) return null; // klopt al, niets versturen
            const fd = new FormData(form);
            for (const [slot, n] of Object.entries(p.v)) fd.set('aao[' + slot + ']', String(n));
            applyVehicleTypeIds(fd, p.vt);
            const r = await fetch(form.action, { method: 'POST', credentials: 'include', body: new URLSearchParams(fd) });
            if (!r.ok) throw new Error('bijwerken mislukt ' + r.status);
            return diff;
        }

        let preview = null;  // { todo, toCheck } from the last dry run
        let toUpdate = null; // [{ p, diff }] found during the last dry run's check
        let busy = false;

        async function check() {
            const st = await readState();
            const unknown = new Set();
            PRESETS.forEach(p => Object.keys(p.v).forEach(k => { if (!st.slots.has('aao[' + k + ']')) unknown.add(k); }));
            if (unknown.size) log('LET OP: onbekende voertuigsoorten (worden door het spel genegeerd):', [...unknown].join(', '));
            const todo = PRESETS.filter(p => !st.existing.has(capOf(p.c)));
            const toCheck = PRESETS.filter(p => st.existing.has(capOf(p.c)));
            const noCat = CONFIG.CATEGORIES.filter(n => !st.cats[n]);
            return { st, todo, toCheck, noCat };
        }

        async function dryRun() {
            if (busy) return;
            busy = true;
            try {
                const { st, todo, toCheck, noCat } = await check();
                preview = { todo, toCheck };
                log(`${PRESETS.length} voorstellen, ${PRESETS.length - todo.length} bestaan al, ${todo.length} nieuw.`);
                if (noCat.length) log('Maak eerst deze categorieën aan (Eigen inzetvoorstellen-categorieën):', noCat.join(', '));
                log('Bestaande voorstellen controleren op verouderde waarden (alleen lezen)…');
                status();
                const changed = [];
                let i = 0;
                for (const p of toCheck) {
                    if (!running) break;
                    i++;
                    ctx.status(`Controleren ${i}/${toCheck.length}: ${p.c}`, { tone: 'busy', progress: [i, toCheck.length], dock: true });
                    const editDoc = await get(st.existing.get(capOf(p.c)));
                    const form = [...editDoc.forms].find(f => /\/aaos\/\d+$/.test(f.action) || f.querySelector('[name=_method]'));
                    const diff = form && diffPreset(form, p);
                    if (diff) { changed.push({ p, diff }); log(`(${i}/${toCheck.length}) wijkt af:`, p.c, diff); }
                    else if (i % 25 === 0) log(`(${i}/${toCheck.length}) gecontroleerd…`);
                    await sleep(CONFIG.THROTTLE_MS);
                }
                toUpdate = changed;
                log(`Controle klaar. ${changed.length} bestaande voorstellen zouden worden bijgewerkt.`);
            } finally {
                busy = false;
                status();
            }
        }

        async function create() {
            if (busy) return;
            busy = true;
            try {
                const { st, todo, toCheck, noCat } = await check();
                if (noCat.length) throw new Error('Maak eerst deze categorieën aan (Eigen inzetvoorstellen-categorieën): ' + noCat.join(', '));
                let done = 0;
                const failed = [];
                for (const p of todo) {
                    if (!running) break;
                    ctx.status(`Aanmaken ${done + 1}/${todo.length}: ${p.c}`, { tone: 'busy', progress: [done, todo.length], dock: true });
                    try { await createPreset(p, st.cats[p.s], st.token); done++; log(`(${done}/${todo.length})`, p.c); }
                    catch (e) {
                        ctx.err(p.c, e);
                        if (/^rejected/.test(e.message)) { failed.push(p.c); await sleep(CONFIG.THROTTLE_MS); continue; }
                        log('Gestopt door fout:', e.message);
                        break;
                    }
                    await sleep(CONFIG.THROTTLE_MS);
                }
                let patched = 0, checked = 0;
                for (const p of toCheck) {
                    if (!running) break;
                    checked++;
                    ctx.status(`Controleren ${checked}/${toCheck.length}: ${p.c}`, { tone: 'busy', progress: [checked, toCheck.length], dock: true });
                    try {
                        const diff = await patchPreset(st.existing.get(capOf(p.c)), p);
                        if (diff) { patched++; log(`(bijgewerkt ${patched}, gecontroleerd ${checked}/${toCheck.length})`, p.c, diff); }
                    } catch (e) {
                        ctx.err('bijwerken', p.c, e);
                        failed.push('bijwerken:' + p.c);
                    }
                    await sleep(CONFIG.THROTTLE_MS);
                }
                log(`Klaar. ${done} aangemaakt, ${patched} bijgewerkt (van ${checked} gecontroleerd).`, failed.length ? 'Afgewezen: ' + failed.join(' | ') : '');
                preview = null;
                toUpdate = null;
            } finally {
                busy = false;
                status();
            }
        }

        function status() {
            const n = (preview ? preview.todo.length : 0) + (toUpdate ? toUpdate.length : 0);
            ctx.status(n ? `${n} voorstellen klaar om aan te maken of bij te werken` : 'Klaar voor gebruik', { tone: n ? 'warn' : 'idle' });
        }

        let running = true;
        ctx.actions([
            { label: 'Controleren', run: dryRun, title: 'Laat zien wat er zou gebeuren, zonder iets aan te maken of te wijzigen.' },
            { label: 'Aanmaken', kind: 'primary', run: create,
                confirm: `Weet je het zeker?

Dit maakt tot ${PRESETS.length} inzetvoorstellen aan in het spel en werkt bestaande voorstellen bij als hun
voertuigen niet meer kloppen (bijv. nieuwe GGB/NHT-velden). Weghalen kan alleen met de hand, één voor één.` },
        ]);
        ctx.panel((el) => {
            const esc = ctx.esc;
            let html = '';
            if (preview) {
                html += `<h4 class="mks-h">Nieuw (${preview.todo.length})</h4>`;
                html += preview.todo.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Groep</th><th>Naam</th><th>Voertuigen</th></tr></thead><tbody>
                    ${preview.todo.map((p) => `<tr><td>${esc(p.s)}</td><td>${esc(capOf(p.c))}</td>
                    <td class="mono mks-dim">${esc(Object.entries(p.v).map(([k, n]) => `${n}× ${k}`).join(', '))}</td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="mks-note">Alle voorstellen bestaan al.</p>';
            }
            if (toUpdate) {
                html += `<h4 class="mks-h">Bij te werken (${toUpdate.length})</h4>`;
                html += toUpdate.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Naam</th><th>Wijziging</th></tr></thead><tbody>
                    ${toUpdate.map(({ p, diff }) => `<tr><td>${esc(capOf(p.c))}</td>
                    <td class="mono mks-dim">${esc(Object.entries(diff).map(([k, [o, n]]) => `${k}: ${o}→${n}`).join(', '))}</td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="mks-note">Alle bestaande voorstellen zijn up-to-date.</p>';
            }
            if (lines.length) {
                html += `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${lines.slice().reverse().map((l) => `<tr><td class="mono">${esc(l)}</td></tr>`).join('')}</tbody></table></div>`;
            }
            el.innerHTML = html;
        });
        status();

        return { stop() { running = false; } };
    },
});

/* ==== module: vehicle-namer =============================================== */
MKS.module({
    id: 'vehicle-namer',
    name: 'Voertuignamen',
    short: 'Voertuignamen',
    icon: '🚒',
    category: 'names',
    description: 'Geeft je voertuigen echte Nederlandse roepnummers waar die bekend zijn, en anders een verzonnen roepnummer in hetzelfde systeem. '
        + 'Nooit dubbele namen. Pakt nieuw gekochte voertuigen vanzelf op.',
    warning: '<b>Werk in uitvoering. Hernoemen kan niet ongedaan worden gemaakt.</b> Zodra je dit aanzet, verandert het de namen van je voertuigen '
        + 'in het spel zelf. De oude namen worden nergens bewaard. De nummering is nog niet af en kan in een volgende versie weer veranderen.',
    confirmOn: 'Let op: dit hernoemt direct je voertuigen in het spel.\n\nDat kan NIET ongedaan worden gemaakt: de oude namen worden niet bewaard. '
        + 'Het script is nog in ontwikkeling.\n\nToch aanzetten?',
    at: 'load',
    frames: 'top',
    settings: [
        { key: 'defaultRegio', label: 'Standaard regio', type: 'select', default: '09',
            options: [['01', '01 Groningen'], ['02', '02 Fryslân'], ['03', '03 Drenthe'], ['04', '04 IJsselland'], ['05', '05 Twente'],
                ['06', '06 Noord- en Oost-Gelderland'], ['07', '07 Gelderland-Midden'], ['08', '08 Gelderland-Zuid'], ['09', '09 Utrecht'],
                ['10', '10 Noord-Holland Noord'], ['11', '11 Zaanstreek-Waterland'], ['12', '12 Kennemerland'], ['13', '13 Amsterdam-Amstelland'],
                ['14', '14 Gooi en Vechtstreek'], ['15', '15 Haaglanden'], ['16', '16 Hollands Midden'], ['17', '17 Rotterdam-Rijnmond'],
                ['18', '18 Zuid-Holland Zuid'], ['19', '19 Zeeland'], ['20', '20 Midden- en West-Brabant'], ['21', '21 Brabant-Noord'],
                ['22', '22 Brabant-Zuidoost'], ['23', '23 Limburg-Noord'], ['24', '24 Limburg-Zuid'], ['25', '25 Flevoland']],
            help: 'Voor gebouwen waarvan de plaatsnaam niet herkend wordt.' },
        { key: 'pollMin', label: 'Zoeken naar nieuwe voertuigen', type: 'number', default: 1, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rescanMin', label: 'Volledige controle', type: 'number', default: 30, min: 5, max: 240, step: 5, unit: 'min' },
        { key: 'throttleSec', label: 'Pauze tussen hernoemingen', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.5, unit: 'sec' },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG — read this first
         * ====================================================================
         * DRY_RUN starts as `true` on purpose: the very first time you run this
         * script it will only PRINT what it *would* rename in the browser
         * console (F12) instead of actually renaming anything. Check the
         * console, make sure the names look right, and only then set
         * DRY_RUN to false.
         *
         * The in-game rename mechanism this script uses is the same one the
         * community's LSS Manager tool uses (GET /vehicles/:id/editName, fill
         * in the form, click submit). It's about as compatible as a userscript
         * can be, but if meldkamerspel.com changes its markup this may need a
         * small selector tweak — see renameVehicleInGame() below, it logs
         * loudly on failure.
         * ==================================================================== */
        const CONFIG = {
            DRY_RUN: false,
            get DEBUG() { return !!ctx.cfg.debug; },
            // Region used for buildings whose place name we can't recognise at all.
            get DEFAULT_REGIO_CODE() { return ctx.cfg.defaultRegio; },
            get POLL_NEW_VEHICLES_MS() { return ctx.cfg.pollMin * 60000; }, // look for newly bought vehicles
            get FULL_RESCAN_MS() { return ctx.cfg.rescanMin * 60000; }, // self-healing full re-check
            get RENAME_THROTTLE_MS() { return ctx.cfg.throttleSec * 1000; }, // pause between individual rename calls
            REQUEST_TIMEOUT_MS: 10 * 1000, // abort any single network request that hangs this long
            MAX_NAME_LENGTH: 150,
        };

        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[VehicleNamer]', 'color:#0a7', ...a); };
        const warn = (...a) => console.warn('[VehicleNamer]', ...a);
        const err = (...a) => console.error('[VehicleNamer]', ...a);

        /* ========================================================================
         * PERSISTENT STORAGE
         * ==================================================================== */
        const store = {
            get(key, def) {
                try {
                    const v = GM_getValue(key, undefined);
                    return v === undefined ? def : JSON.parse(v);
                } catch (e) { return def; }
            },
            set(key, val) {
                try { GM_setValue(key, JSON.stringify(val)); } catch (e) { warn('store.set failed', key, e); }
            },
        };

        // Bump this whenever the reference data (fire type dictionary, known
        // afkortingen, exact station lists, etc.) changes meaningfully. On
        // mismatch, every vehicle's stored assignment is wiped so the next scan
        // re-classifies everyone from scratch with the new data — not just the
        // handful that happen to already look wrong.
        const DATA_VERSION = 11;

        // Memory guard was removed: everything runs live. Old standalone
        // memory can still be imported via Overzicht before turning this on.
        // renumber the fleet, so wait until the user imports or starts fresh.
        const hasMemory = true;

        // vehicleId -> { name, seqKey, exact }
        let assignments = store.get('vn_assignments', {});
        // seqKey -> highest sequence number used
        let seqCounters = store.get('vn_seqCounters', {});
        // regio code -> { buildingId: postNumber }
        let postNumbers = store.get('vn_postNumbers', {});
        // every vehicle id we've ever seen (to detect newly bought vehicles)
        let knownVehicleIds = store.get('vn_knownVehicleIds', []);
        // vehicleId -> { building, typeCaption, currentName, generatedName } — every
        // vehicle whose real type text we didn't recognize (fell back to OVR).
        let ovrLog = store.get('vn_ovrLog', {});

        const storedDataVersion = store.get('vn_dataVersion', 0);
        if (storedDataVersion !== DATA_VERSION) {
            log(`data version changed (${storedDataVersion} -> ${DATA_VERSION}) — clearing all stored assignments for a full recheck with the new reference data`);
            assignments = {};
            seqCounters = {};
            store.set('vn_dataVersion', DATA_VERSION);
        }

        function persistAll() {
            store.set('vn_assignments', assignments);
            store.set('vn_seqCounters', seqCounters);
            store.set('vn_postNumbers', postNumbers);
            store.set('vn_knownVehicleIds', knownVehicleIds);
            store.set('vn_ovrLog', ovrLog);
        }

        // A vehicle we genuinely can't classify (empty type text AND no parseable
        // real-format current name) — left completely untouched in-game, just
        // logged here so you can tell Claude about it.
        function recordUnclassified(building, vehicle) {
            ovrLog[vehicle.id] = {
                vehicleId: vehicle.id,
                building: building.caption,
                typeCaption: resolveTypeCaption(vehicle) || '(empty)',
                vehicleTypeId: vehicle.vehicle_type,
                currentName: vehicle.caption,
            };
        }

        function printOvrLog() {
            const rows = Object.values(ovrLog);
            if (!rows.length) {
                log('nothing left unclassified — every vehicle could be matched to a role.');
                return;
            }
            console.log(`%c[VehicleNamer] ${rows.length} vehicle(s) left untouched (couldn't work out their role):`, 'color:#e90');
            console.table(rows);
            console.log('[VehicleNamer] copy/paste this to Claude:\n' + JSON.stringify(rows, null, 2));
        }

        /* ========================================================================
         * TEXT HELPERS
         * ==================================================================== */
        function normalize(s) {
            return (s || '')
                .toString()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[()]/g, ' ')
                .replace(/[^a-z0-9\- ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Generic words we strip off the front of a building caption to get at
        // the place name, e.g. "Brandweer Kazerne Amersfoort-Noord" -> "amersfoort-noord"
        const PREFIX_WORDS = [
            'brandweerkazerne', 'brandweerpost', 'brandweer kazerne', 'brandweer post', 'brandweer',
            'ambulance standplaats', 'standplaats', 'ambulance',
            'politiebureau', 'politiepost', 'politie hoofdbureau', 'politie',
            'ravu', 'rav',
            'kazerne',
        ];
        function stripPrefix(normCaption) {
            let out = normCaption;
            let changed = true;
            while (changed) {
                changed = false;
                for (const w of PREFIX_WORDS) {
                    const re = new RegExp('^' + w + '\\s+');
                    if (re.test(out)) { out = out.replace(re, '').trim(); changed = true; }
                }
            }
            return out;
        }

        function deriveStationCode(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const firstWord = stripped.split(' ')[0] || stripped;
            const letters = firstWord.replace(/[^a-z]/g, '').toUpperCase();
            return letters.slice(0, 8) || 'VZ';
        }

        // Matches `needle` inside `haystack` only on a whole-word boundary, so
        // e.g. "doorn" does NOT match inside "apeldoorn".
        function wordBoundaryIncludes(haystack, needle) {
            if (!needle) return false;
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])');
            return re.test(' ' + haystack + ' ');
        }

        /* ========================================================================
         * REFERENCE DATA — Veiligheidsregio's (official, 25 regions)
         * Source: "Nationaal Nummerplan Brandweer Nederland" v1.5 (NVBR/LNM, 2008)
         * ==================================================================== */
        const VEILIGHEIDSREGIO = {
            '01': 'Groningen', '02': 'Fryslan', '03': 'Drenthe', '04': 'IJsselland',
            '05': 'Twente', '06': 'Noord- en Oost-Gelderland', '07': 'Gelderland-Midden',
            '08': 'Gelderland-Zuid', '09': 'Utrecht', '10': 'Noord-Holland Noord',
            '11': 'Zaanstreek-Waterland', '12': 'Kennemerland', '13': 'Amsterdam-Amstelland',
            '14': 'Gooi en Vechtstreek', '15': 'Haaglanden', '16': 'Hollands Midden',
            '17': 'Rotterdam-Rijnmond', '18': 'Zuid-Holland Zuid', '19': 'Zeeland',
            '20': 'Midden- en West-Brabant', '21': 'Brabant-Noord', '22': 'Brabant-Zuidoost',
            '23': 'Limburg-Noord', '24': 'Limburg-Zuid', '25': 'Flevoland',
        };

        // Place name (normalized, lowercase) -> regio code.
        // Not exhaustive for all ~1700 kazernes in NL — covers your current
        // buildings plus the main city of every region so new buildings have a
        // fighting chance of landing in the right region automatically.
        // Add more entries here any time; format: 'placename': 'regiocode'.
        const PLACE_TO_REGIO = {
            // Utrecht (09) — every VRU post
            'amersfoort-centrum': '09', 'amersfoort-noord': '09', 'amersfoort n-oost': '09', 'amersfoort': '09',
            'baarn': '09', 'bunschoten': '09', 'bunnik': '09', 'werkhoven': '09', 'bilthoven': '09',
            'de bilt': '09', 'groenekan': '09', 'maartensdijk': '09', 'westbroek': '09', 'abcoude': '09',
            'mijdrecht': '09', 'vinkeveen': '09', 'wilnis': '09', 'eemnes': '09', 'houten': '09',
            'houten-oost': '09', 'houten-west': '09', 'schalkwijk': '09', 'ijsselstein': '09',
            'achterveld': '09', 'leusden': '09', 'benschop': '09', 'lopik': '09', 'linschoten': '09',
            'montfoort': '09', 'nieuwegein': '09', 'oudewater': '09', 'renswoude': '09', 'elst': '09',
            'rhenen': '09', 'rhenen-achterberg': '09', 'soest': '09', 'soesterberg': '09', 'breukelen': '09',
            'kockengen': '09', 'loenen': '09', 'maarssen': '09', 'nieuwer ter aa': '09', 'nigtevecht': '09',
            'de meern': '09', 'utrecht': '09', 'vleuten': '09', 'amerongen': '09', 'driebergen': '09',
            'doorn': '09', 'leersum': '09', 'maarn-maarsbergen': '09', 'maarn': '09', 'veenendaal': '09',
            'hagestein': '09', 'vianen': '09', 'wijk bij duurstede': '09', 'harmelen': '09', 'kamerik': '09',
            'woerden': '09', 'zegveld': '09', 'woudenberg': '09', 'den dolder': '09', 'zeist': '09',
            'ameide': '09', 'leerdam': '09', 'lexmond': '09', 'meerkerk': '09', 'schoonrewoerd': '09',
            'nieuwegein-noord': '09', 'nieuwegein-zuid': '09',

            // Noord- en Oost-Gelderland (06) — Apeldoorn/Harderwijk/Putten area
            'apeldoorn': '06', 'harderwijk': '06', 'putten': '06', 'nunspeet': '06', 'elburg': '06',
            'epe': '06', 'oldebroek': '06', 'hattem': '06', 'zutphen': '06', 'doetinchem': '06',
            'winterswijk': '06', 'lochem': '06', 'voorst': '06', 'garderen': '06',

            // Gelderland-Midden (07) — Ede/Barneveld area
            'ede': '07', 'ederveen': '07', 'nijkerk': '07', 'scherpenzeel': '07', 'otterlo': '07',
            'barneveld': '07', 'arnhem': '07', 'wageningen': '07', 'renkum': '07', 'de valk': '07',

            // Gelderland-Zuid (08)
            'nijmegen': '08', 'tiel': '08', 'zaltbommel': '08', 'wijchen': '08', 'culemborg': '08',

            // Rest of NL — provincial anchor cities per region, extend as needed
            'groningen': '01', 'leeuwarden': '02', 'assen': '03', 'zwolle': '04', 'enschede': '05',
            'hilversum': '14', 'alkmaar': '10', 'den helder': '10', 'zaandam': '11', 'purmerend': '11',
            'haarlem': '12', 'haarlemmermeer': '12', 'schiphol': '12', 'ijmuiden': '12',
            'amsterdam': '13', 'amstelveen': '13', 'den haag': '15', 's-gravenhage': '15', 'delft': '15',
            'leiden': '16', 'alphen aan den rijn': '16', 'gouda': '16', 'rotterdam': '17', 'schiedam': '17',
            'dordrecht': '18', 'gorinchem': '18', 'middelburg': '19', 'vlissingen': '19', 'goes': '19',
            'breda': '20', 'tilburg': '20', 'den bosch': '21', 's-hertogenbosch': '21', 'oss': '21',
            'eindhoven': '22', 'helmond': '22', 'venlo': '23', 'roermond': '23', 'maastricht': '24',
            'heerlen': '24', 'sittard': '24', 'almere': '25', 'lelystad': '25',
        };

        /* ========================================================================
         * REFERENCE DATA — Brandweer (fire) vehicle-type -> digit/label
         * Empirically derived from ~14,000 real Dutch emergency vehicle records
         * (hulpdienstvoertuigenbenelux.nl national database, cross-referenced
         * against real roepnummers so the digit is measured, not guessed): for
         * each real "TypeVoertuig" description, this is the type-digit and
         * abbreviation real vehicles of that type actually carry.
         * ==================================================================== */
        const FIRE_TYPE_DICT = {
            "dienstbus": { digit: "0", label: "DB" },
            "tankautospuit": { digit: "3", label: "TS" },
            "personeel/materieelvoertuig": { digit: "0", label: "PM" },
            "officier van dienst brandweer": { digit: "9", label: "OVD-B" },
            "dienstauto": { digit: "0", label: "DA" },
            "grootschalige ontsmetting haakarmbak logistiek": { digit: "2", label: "GOH-LO" },
            "veetakel installatie aanhanger": { digit: "7", label: "VIA" },
            "haakarmvoertuig": { digit: "8", label: "HA" },
            "verlichtingsaanhanger": { digit: "8", label: "LIA" },
            "grootschalige ontsmetting haakarmbak decontaminatie": { digit: "2", label: "GOH-DC" },
            "oppervlakte reddingsteam voertuig": { digit: "1", label: "OR" },
            "brandweervaartuig middel": { digit: "1", label: "BRV-M" },
            "slangenhaakarmbak grootschalige watervoorziening": { digit: "6", label: "SLH-GW" },
            "dompelpompaanhanger grootschalige watervoorziening": { digit: "6", label: "DPA-GW" },
            "verkenningsvoertuig team digitale verkenning": { digit: "8", label: "VK-TDV" },
            "technische dienst": { digit: "0", label: "TD" },
            "hulpverleningsvoertuig": { digit: "7", label: "HV" },
            "gereedschap/materieelvoertuig": { digit: "0", label: "GM" },
            "adviseur gevaarlijke stoffen": { digit: "2", label: "AGS" },
            "logistiek voertuig": { digit: "8", label: "LO" },
            "hoofdofficier van dienst brandweer": { digit: "9", label: "HOVD-B" },
            "informatiemanager copi": { digit: "9", label: "IM-COPI" },
            "voorlichter brandweer": { digit: "9", label: "VL-B" },
            "team brandonderzoek": { digit: "0", label: "TBO" },
            "officier van dienst bevolkingszorg": { digit: "9", label: "OVD-BZ" },
            "waterongevallenvoertuig": { digit: "1", label: "WO" },
            "basis ontsmetting haakarmbak decontaminatie": { digit: "2", label: "BOH-DC" },
            "gevaarlijke stoffen haakarmbak": { digit: "2", label: "GSH" },
            "olieschermen haakarmbak": { digit: "2", label: "OSH" },
            "hoogwerker": { digit: "5", label: "HW" },
            "schuimblushaakarmbak": { digit: "6", label: "SBH" },
            "ondersteuningsteam grootschalige watervoorziening": { digit: "6", label: "ON-GW" },
            "hulpverleningsvoertuig met kraan": { digit: "7", label: "HV-KR" },
            "verlichtingshaakarmbak rampterrein verlichting": { digit: "7", label: "LIH-RTV" },
            "commandant van dienst brandweer": { digit: "9", label: "CVD-B" },
            "verzorgingshaakarmbak": { digit: "8", label: "VZH" },
            "commando voertuig multidisciplinair": { digit: "9", label: "CO-MU" },
            "hulpverleningshaakarmbak": { digit: "7", label: "HVH" },
            "specialistische technische hulpverlening haakarmbak stutmaterieel": { digit: "7", label: "SHH-ST" },
            "watertankhaakarmbak": { digit: "6", label: "WTH" },
            "schuimblusvoertuig": { digit: "6", label: "SB" },
            "personeel/materieelvoertuig bedrijfsbrandweer": { digit: "0", label: "PM-BB" },
            "schuimblusvoertuig bedrijfsbrandweer": { digit: "6", label: "SB-BB" },
            "haakarmvoertuig bedrijfsbrandweer": { digit: "8", label: "HA-BB" },
            "tankautospuit terreinvaardig natuurbrandbestrijding": { digit: "4", label: "TST-NB" },
            "tankautospuit terreinvaardig": { digit: "4", label: "TST" },
            "autoladder": { digit: "5", label: "AL" },
            "personeel/materieelvoertuig terreinvaardig": { digit: "0", label: "PMT" },
            "haakarmvoertuig met kraan": { digit: "8", label: "HA-KR" },
            "brandweervaartuig klein": { digit: "1", label: "BRV-K" },
            "dompelpomphaakarmbak grootschalige watervoorziening": { digit: "6", label: "DPH-GW" },
            "gevaarlijke stoffen voertuig": { digit: "2", label: "GS" },
            "waterbassinhaakarmbak": { digit: "6", label: "WBH" },
            "watertankwagen terreinvaardig": { digit: "6", label: "WTT" },
            "specialistische technische hulpverlening haakarmbak redding": { digit: "7", label: "SHH-RD" },
            "specialistische technische hulpverlening haakarmbak logistiek": { digit: "8", label: "SHH-LO" },
            "tankautospuit bedrijfsbrandweer": { digit: "3", label: "TS-BB" },
            "watertankwagen": { digit: "6", label: "WT" },
            "logistiek haakarmbak open uitvoering": { digit: "8", label: "LOH-O" },
            "algemeen commandant brandweer": { digit: "9", label: "AC-B" },
            "verbindingsdienst voertuig mobiel opstelpunt": { digit: "8", label: "VD-MOP" },
            "trekker klein": { digit: "0", label: "TK-K" },
            "motorspuitaanhanger": { digit: "6", label: "MSA" },
            "arbeidshygiene voertuig": { digit: "8", label: "AH" },
            "bijzonder materieel haakarmbak t.b.v. opleiding, training en oefenen": { digit: "8", label: "BMH-OTO" },
            "waterongevallen materieel aanhanger": { digit: "1", label: "WOA" },
            "verzorgingsvoertuig": { digit: "8", label: "VZ" },
            "verzorgingsaanhanger": { digit: "0", label: "VZA" },
            "trekker groot": { digit: "8", label: "TK-G" },
            "crashtender": { digit: "6", label: "CT" },
            "multifunctioneel voertuig terreinvaardig": { digit: "8", label: "MFT" },
            "kleinschalige watervoorziening voertuig": { digit: "6", label: "KW" },
            "adembescherming voertuig": { digit: "8", label: "AB" },
            "poederblusaanhanger": { digit: "6", label: "PBA" },
            "algemeen commandant crisiscommunicatie": { digit: "8", label: "AC-CC" },
            "slangenvoertuig kleinschalige watervoorziening": { digit: "6", label: "SL-KW" },
            "rietdak brandbestrijdingsteam": { digit: "6", label: "RI" },
            "handcrew voertuig": { digit: "0", label: "HC" },
            "brandstoftankaanhanger": { digit: "8", label: "BSA" },
            "tankautospuit t.b.v. opleiding, training en oefenen": { digit: "3", label: "TS-OTO" },
            "adembescherming haakarmbak": { digit: "8", label: "ABH" },
            "brandstoftankhaakarmbak": { digit: "8", label: "BSH" },
            "commando haakarmbak multidisciplinair": { digit: "9", label: "COH-MU" },
            "bijzonder materieel aanhanger t.b.v. opleiding, training en oefenen": { digit: "8", label: "BMA-OTO" },
            "verkenningsvoertuig ibgs": { digit: "2", label: "VK-GS" },
            "slangenaanhanger kleinschalige watervoorziening": { digit: "6", label: "SLA-KW" },
            "logistiek haakarmbak": { digit: "8", label: "LOH" },
            "gaspakteam voertuig": { digit: "2", label: "GP" },
            "logistiek voertuig ict": { digit: "0", label: "LO-ICT" },
            "stroom aggregaat aanhanger": { digit: "8", label: "SAA" },
            "haakarmvoertuig terreinvaardig": { digit: "8", label: "HAT" },
            "natuurbrandbestrijdingshaakarmbak": { digit: "4", label: "NBH" },
            "first responder brandweer": { digit: "8", label: "FR-B" },
            "ondersteuningsteam grootschalige ontsmetting": { digit: "2", label: "ON-GO" },
            "ondersteuningsteam logistiek": { digit: "0", label: "ON-LO" },
            "veetakel installatie voertuig": { digit: "7", label: "VI" },
            "pelotonscommandant logistiek": { digit: "8", label: "PC-L" },
            "centralist brandweer": { digit: "0", label: "CTL-B" },
            "commando voertuig fire bucket operations": { digit: "0", label: "CO-FBO" },
            "coordinatie- en informatievoorzieningsvoertuig brandweer": { digit: "9", label: "CI-B" },
            "schuimblusaanhanger": { digit: "6", label: "SBA" },
            "bijzondere uitrusting slangen opneem apparaat": { digit: "8", label: "BU-SO" },
            "bron-/buispomp aanhanger": { digit: "6", label: "BPA" },
            "watertankwagen groot": { digit: "6", label: "WT-G" },
            "bijzondere uitrusting vaartuig sonar": { digit: "8", label: "BUV-SN" },
            "brandweervaartuig groot": { digit: "6", label: "BRV-G" },
            "opleidingsvoertuig": { digit: "8", label: "OO" },
            "verkenningsvoertuig terreinvaardig natuurbrandbestrijding": { digit: "8", label: "VKT-NB" },
            "verzorgingsaanhanger met wc": { digit: "8", label: "VZA-WC" },
            "logistiek aanhanger": { digit: "8", label: "LOA" },
            "quick response team": { digit: "7", label: "QR" },
            "teamleider quick response team": { digit: "9", label: "TL-QRT" },
            "hulpverleningsvoertuig terreinvaardig": { digit: "7", label: "HVT" },
            "rietdak brandbestrijdingsteam aanhanger": { digit: "6", label: "RIA" },
            "bron-/buispomp haakarmbak": { digit: "6", label: "BPH" },
            "verzorgingshaakarmbak met wc": { digit: "8", label: "VZH-WC" },
            "verbindingscommando voertuig": { digit: "9", label: "VC" },
            "multifunctioneel voertuig terreinvaardig verreiker": { digit: "7", label: "MFT-VER" },
            "preventie": { digit: "0", label: "PR" },
            "snel inzetbaar voertuig": { digit: "6", label: "SI" },
            "schuimblusvoertuig met blusarm": { digit: "6", label: "SB-BA" },
            "schuimvormend middel aanhanger": { digit: "6", label: "SVA" },
            "coordinator verkenningseenheden": { digit: "2", label: "C-VE" },
            "geo informatie medewerker copi": { digit: "9", label: "GIMCOPI" },
            "arbeidshygiene haakarmbak": { digit: "8", label: "AHH" },
            "verbindingsdienst": { digit: "0", label: "VD" },
            "informatiemanager rot": { digit: "9", label: "IM-ROT" },
            "leider copi": { digit: "9", label: "L-COPI" },
            "geo informatie medewerker rot": { digit: "0", label: "GIM-ROT" },
            "schuimvormend middel haakarmbak": { digit: "6", label: "SVH" },
            "verkenningsvoertuig terreinvaardig": { digit: "0", label: "VKT" },
            "dompelpompvoertuig grootschalige watervoorziening": { digit: "6", label: "DP-GW" },
            "bijzonder materieel haakarmbak met bijzondere brandbestrijdingsmiddelen": { digit: "6", label: "BMH-BBM" },
            "dienstbus bedrijfsbrandweer": { digit: "0", label: "DB-BB" },
            "tankautospuit industrie brandbestrijding": { digit: "3", label: "TS-IB" },
            "officier van dienst bedrijfsbrandweer": { digit: "9", label: "OVD-BB" },
            "bedrijfsbrandweer": { digit: "5", label: "BB" },
            "gereedschap/materieelhaakarmbak": { digit: "7", label: "GMH" },
            "dienstauto terreinvaardig": { digit: "0", label: "DAT" },
            "dompelpomphaakarmbak tankput brandbestrijding": { digit: "6", label: "DPH-TPB" },
            "bijzonder materieel haakarmbak tankput brandbestrijding": { digit: "6", label: "BMH-TPB" },
            "schuimvormend middel haakarmbak tankput brandbestrijding": { digit: "6", label: "SVH-TPB" },
            "slangenhaakarmbak tankput brandbestrijding": { digit: "6", label: "SLH-TPB" },
            "waterkanonaanhanger tankput brandbestrijding": { digit: "6", label: "WKA-TPB" },
            "motorspuit/boosterpomphaakarmbak tankput brandbestrijding": { digit: "6", label: "MSH-TPB" },
            "tactisch officier meldkamer brandweer": { digit: "9", label: "TO-MKB" },
            "ts slagkracht": { digit: "3", label: "TS-SK" },
            "brandweervaartuig zeer groot": { digit: "6", label: "BRV-Z" },
            "autospuit industrie brandbestrijding": { digit: "6", label: "AS-IB" },
            "redteam hoogteverschillen": { digit: "7", label: "RH" },
            "stroom aggregaat haakarmbak": { digit: "8", label: "SAH" },
            "watertankhaakarmbak groot": { digit: "6", label: "WTH-G" },
            "ondersteuningsteam brandweervaartuig": { digit: "1", label: "ON-BRV" },
            "functionaris logistiek": { digit: "9", label: "FL" },
            "waterongevallenvaartuig middel": { digit: "1", label: "WOV-M" },
            "bijzonder materieel haakarmbak met blusrobot": { digit: "8", label: "BMH-BRB" },
            "brandweer motor": { digit: "6", label: "BRM" },
            "dienstauto bedrijfsbrandweer": { digit: "0", label: "DA-BB" },
            "bijzonder materieel haakarmbak met natuurbrand bestrijdingmaterieel": { digit: "4", label: "BMH-NB" },
            "personeel/materieelvoertuig ultra hoge druk blussysteem": { digit: "6", label: "PM-UHD" },
            "ondersteuningsteam verzorging": { digit: "0", label: "ON-VZ" },
            "bijzonder materieel veiligheidstester hoogspanning": { digit: "7", label: "BM-VTHS" },
            "bijzonder materieel haakarmbak scheepsincidentbestrijding": { digit: "8", label: "BMH-SIB" },
            "slangenopneemhaakarmbak tankput brandbestrijding": { digit: "8", label: "SOH-TPB" },
            "schuimvormend middel aanhanger tankput brandbestrijding": { digit: "6", label: "SVA-TPB" },
            "hoogwerker industrie brandbestrijding": { digit: "5", label: "HW-IB" },
            "bijzonder materieel aanhanger met natuurbrandbestrijding waterscherm": { digit: "4", label: "BMA-NWS" },
            "personeel/materieelvoertuig met bijzondere brandbestrijdingsmiddelen": { digit: "6", label: "PM-BBM" },
            "verkenningsvoertuig": { digit: "2", label: "VK" },
            "officier van dienst havenbedrijf": { digit: "9", label: "OVD-HB" },
            "hoofdofficier van dienst havenbedrijf": { digit: "9", label: "HOVD-HB" },
            "algemeen commandant havenbedrijf": { digit: "9", label: "AC-HB" },
            "test eenheid": { digit: "0", label: "BM-TES" },
            "teamleider team digitale verkenning": { digit: "0", label: "TL-TDV" },
            "regionaal operationeel leider": { digit: "9", label: "ROL" },
            "bijzonder materieel aanhanger spoorsloot overbrugging": { digit: "8", label: "BMA-SOB" },
            "personeel/materieelvoertuig terreinvaardig usar": { digit: "0", label: "PMT-USR" },
            "gereedschap/materieelvoertuig terreinvaardig": { digit: "7", label: "GMT" },
            "schuimblusvoertuig terreinvaardig": { digit: "6", label: "SBT" },
            "watertankaanhanger groot": { digit: "6", label: "WTA-G" },
            "ondersteuningsteam hulpverlening": { digit: "7", label: "ON-HV" },
            "poederblushaakarmbak": { digit: "6", label: "PBH" },
            "medische assistentie voertuig": { digit: "8", label: "MA" },
            "dienstbus defensie": { digit: "0", label: "DB-DF" },
            "tankautospuit terreinvaardig defensie": { digit: "4", label: "TST-DF" },
            "watertankwagen defensie": { digit: "6", label: "WT-DF" },
            "watertankhaakarmbak defensie": { digit: "6", label: "WTH-DF" },
            "motorspuitaanhanger defensie": { digit: "6", label: "MSA-DF" },
            "haakarmvoertuig defensie": { digit: "8", label: "HA-DF" },
            "logistiek haakarmbak defensie": { digit: "8", label: "LOH-DF" },
            "officier van dienst defensie": { digit: "9", label: "OVD-DF" },
            "tankautospuit defensie": { digit: "3", label: "TS-DF" },
            "crashtender defensie": { digit: "6", label: "CT-DF" },
            "on scene commander defensie": { digit: "9", label: "OSC-DF" },
            "hoogwerker defensie": { digit: "5", label: "HW-DF" },
            "bijzonder materieel haakarmbak defensie": { digit: "6", label: "BMH-DF" },
            "olieschermen haakarmbak defensie": { digit: "8", label: "OSH-DF" },
            "waterongevallenvoertuig defensie": { digit: "1", label: "WO-DF" },
        };
        const FIRE_TYPE_KEYS_BY_LENGTH = Object.keys(FIRE_TYPE_DICT).sort((a, b) => b.length - a.length);

        // Real abbreviations actually used on Dutch emergency vehicles nationally
        // (same source as above). Used to sanity-check a label we read off a
        // vehicle's own current name before trusting it.
        const KNOWN_AFKORTINGEN = new Set([
            "AB", "ABH", "AC-B", "AC-CC", "AC-G", "AC-HB", "AFO", "AGS", "AGS-G", "AGS-ROT", "AH", "AHH", "AL", "AL-OTO", "AMBU-DF", "AMBU-EH", "AMBU-HC", "AMBU-IT", "AMBU-LC", "AMBU-MC", "AMBU-RK", "AMBU-SC", "ARTS-HP", "ARTS-SC", "AS", "AS-BB", "AS-IB", "ATP", "BB", "BM-BBM", "BM-BRB", "BM-TES", "BM-VTHS", "BMA-NB", "BMA-NWS", "BMA-OTO", "BMA-SOB", "BMA-USR", "BMH", "BMH-BB", "BMH-BBM", "BMH-BRB", "BMH-DF", "BMH-KR", "BMH-NB", "BMH-OTO", "BMH-SIB", "BMH-SOB", "BMH-TPB", "BOH-DC", "BPA", "BPH", "BRM", "BRV-G", "BRV-K", "BRV-M", "BRV-WSC", "BRV-Z", "BSA", "BSB", "BSH", "BT-EH", "BT-RA", "BT-RK", "BTV", "BU-BRB", "BU-SO", "BU-UHD", "BUV-OWD", "BUV-SN", "C-VE", "CA-EH", "CAH-BH", "CDT-B", "CGV", "CI-B", "CI-RB", "CO-FBO", "CO-MU", "CO-RA", "CO-RK", "COH-B", "COH-MU", "COP-DCU", "COP-RB", "CT", "CT-DF", "CTL-B", "CVD-B", "CVD-G", "DA", "DA-BB", "DA-DF", "DA-PL", "DA-RA", "DA-WAIS", "DAT", "DB", "DB-BB", "DB-DF", "DB-ICB", "DB-RA", "DB-RK", "DP-GW", "DPA-GW", "DPH-BB", "DPH-GW", "DPH-TPB", "EH", "EHH-MP", "FL", "FR-B", "FR-DF", "GGB", "GIM-ROT", "GIMCOPI", "GM", "GMH", "GMH-BB", "GMT", "GOH-DC", "GOH-LO", "GP", "GPH", "GS", "GS-BB", "GS-S", "GSA", "GSH", "GSH-BB", "GSH-PBM", "HA", "HA-BB", "HA-DF", "HA-ICB", "HA-KR", "HA-RA", "HA-RK", "HART", "HAT", "HAT-KR", "HBV", "HC", "HIN-B", "HIN-RA", "HON-B", "HON-RA", "HOVD-B", "HOVD-G", "HOVD-HB", "HRB", "HSCH", "HV", "HV-BB", "HV-KR", "HV-OTO", "HVA", "HVH", "HVH-BB", "HVT", "HW", "HW-BB", "HW-DF", "HW-IB", "IM-COPI", "IM-ROT", "KMCGS", "KW", "L-COPI", "LA-NB", "LA-TDV", "LBO", "LG", "LIA", "LIH-RTV", "LO", "LO-BB", "LO-ICT", "LO-KR", "LO-RA", "LO-RK", "LOA", "LOA-RA", "LOH", "LOH-DF", "LOH-KR", "LOH-O", "MA", "MFT", "MFT-EH", "MFT-RB", "MFT-VER", "MICU", "MMT", "MMTL", "MSA", "MSA-BB", "MSA-DF", "MSH-TPB", "NBH", "NHT", "NICU", "NRV", "OG", "ON-BRV", "ON-GO", "ON-GW", "ON-HV", "ON-LO", "ON-UHD", "ON-VZ", "OO", "OO-RA", "OPSCENT", "OR", "OS", "OSC", "OSC-DF", "OSH", "OSH-DF", "OVD-B", "OVD-BB", "OVD-BZ", "OVD-DF", "OVD-G", "OVD-HB", "OVD-MB", "OVDG-DF", "OVDG-N", "OVDG-NO", "OVDG-RR", "OVDG-Z", "OVDG-ZW", "PAL-RA", "PAT", "PBA", "PBH", "PBH-BB", "PC-B", "PC-L", "PICU", "PM", "PM-BB", "PM-BBM", "PM-DF", "PM-UHD", "PMT", "PMT-USR", "PR", "QR", "RA", "RAA", "RAH", "RAV", "RB", "RBT", "RBV", "RBV-WSC", "RES-PKT", "RGF", "RH", "RHIB", "RI", "RIA", "RK", "RKA", "RKA-MP", "RKH", "RKH-MP", "RMT-KHV", "RMV", "RMV-WSC", "ROL", "RR", "RR-EH", "RR-RK", "RR-VS", "RRM", "RRM-EH", "SAA", "SAH", "SB", "SB-BA", "SB-BB", "SBA", "SBH", "SBT", "SC", "SHH-LO", "SHH-RD", "SHH-ST", "SI", "SI-BB", "SL-GW", "SL-KW", "SLA-KW", "SLH-BB", "SLH-GW", "SLH-TPB", "SN", "SOA", "SOH-TPB", "SORT", "SPL", "STAF", "SVA", "SVA-TPB", "SVH", "SVH-BB", "SVH-DF", "SVH-TPB", "TBO", "TC-B", "TD", "TK-G", "TK-K", "TK-RK", "TL-QRT", "TL-STH", "TL-TDV", "TO-MKB", "TS", "TS-4", "TS-BB", "TS-DF", "TS-IB", "TS-OTO", "TS-RO", "TS-SK", "TST", "TST-DF", "TST-NB", "VC", "VC-BB", "VC-DF", "VD", "VD-MOP", "VI", "VIA", "VK", "VK-GS", "VK-TDV", "VKL-DRG", "VKT", "VKT-NB", "VL-B", "VNA", "VZ", "VZA", "VZA-WC", "VZH", "VZH-KA", "VZH-WC", "WBH", "WKA-TPB", "WKH-BB", "WO", "WO-DF", "WOA", "WOH", "WOV", "WOV-K", "WOV-M", "WT", "WT-DF", "WT-G", "WTA-G", "WTH", "WTH-DF", "WTH-G", "WTT", "ZSC", "ZWB",
        ]);

        /* ========================================================================
         * REFERENCE DATA — numeric vehicle_type -> Dutch caption.
         * The API's `vehicle_type_caption` text field is empty/null for a lot of
         * vehicles (this is what was causing everything to fall back to OVR), but
         * every vehicle always carries a numeric `vehicle_type` id. This table
         * (game-internal ids, sourced from the community LSS Manager tool's own
         * Dutch translations, which it needs for its UI) maps that id straight to
         * the real Dutch vehicle name — bypassing the unreliable text field
         * entirely. Confirmed correct against this save: e.g. id 106 "Berger-K
         * (RWS)" and id 144/145 "DB-ICB"/"OvD-ICB" match vehicles you already own.
         * ==================================================================== */
        const VEHICLE_TYPE_ID_MAP = {
            0: "SI-2", 1: "TS 8/9", 2: "Autoladder", 3: "DA - Officier van Dienst", 4: "Hulpverleningsvoertuig",
            5: "Adembeschermingsvoertuig", 6: "TST 8/9", 7: "TST 6/7", 8: "TST 4/5", 9: "TS 4/5",
            10: "Slangenwagen", 11: "Verkenningseenheid Brandweer", 12: "TST-NB 8/9", 14: "TST-NB 6/7", 15: "TST-NB 4/5",
            16: "Ambulance", 17: "TS 6/7", 18: "Hoogwerker", 19: "DA - Hoofdofficier van Dienst", 20: "DA",
            21: "DB Klein", 22: "DA Noodhulp", 23: "Lifeliner", 24: "DA - Adviseur Gevaarlijke stoffen", 25: "DB Noodhulp",
            26: "Haakarmvoertuig", 27: "Adembeschermingshaakarmbak", 28: "Politiehelikopter", 29: "Watertankhaakarmbak", 30: "Zorgambulance",
            31: "Commandovoertuig", 32: "Commandohaakarmbak", 33: "Waterongevallenvoertuig", 34: "Watertankwagen", 35: "Officier van Dienst - Politie",
            36: "Waterongevallenaanhanger", 37: "MMT-Auto", 38: "Officier van Dienst - Geneeskunde", 39: "ME Commandovoertuig", 40: "ME Flexbus",
            41: "Crashtender (8x8)", 42: "Crashtender (6x6)", 43: "Crashtender (4x4)", 44: "Airport Fire Officer / On Scene Commander", 45: "Dompelpomphaakarmbak",
            46: "DM-Politie", 47: "DA Hondengeleider", 48: "DB Hondengeleider", 49: "PM-OR | Materieelvoertuig - Oppervlakteredding", 50: "TS-OR | Tankautospuit - Oppervlakteredding",
            51: "HulpverleningsHaakarmbak", 52: "Rapid Responder", 53: "AT-Commandant", 54: "AT-Operator", 55: "AT-Materiaalwagen",
            56: "DA Voorlichter", 57: "DA Officier van Dienst - Geneeskundig / Rapid Responder", 58: "DB Arrestantenvervoer", 59: "Noodhulp - Onopvallend", 60: "DB Biketeam",
            61: "Slangenhaakarmbak", 62: "TS-HV | Tankautospuit-Hulpverlening", 63: "DM - Rapid Responder", 64: "ME Aanhoudingseenheid", 65: "DA Terreinwaardig - Reddingsbrigade",
            66: "Kusthulpverleningsvoertuig", 67: "Bootaanhanger Reddingsbrigade", 68: "SB", 69: "SBH", 70: "SBA",
            71: "MSA", 72: "DPA", 73: "Vrachtwagen - Bereden Brigade", 74: "Bereden Brigade Aanhanger", 75: "Dienstauto terreinvaardig - Noodhulp",
            76: "Quad", 77: "KW-boot", 78: "RB-K", 79: "RB-G", 80: "SAR-heli",
            81: "DA-RWS | Dienstvoertuig weginspecteur Rijkswaterstaat", 82: "DM-RWS | Dienstmotor weginspecteur Rijkswaterstaat", 83: "DA-SIG | Signalisatievoertuig", 84: "Waterwerper", 85: "FBO-Heli",
            86: "DB-Handcrew", 87: "DA-LA-NB", 88: "VW-NB", 89: "NBH", 90: "TS-STH",
            91: "HVH-STH", 92: "DB-USAR", 93: "TS-USAR", 94: "VW-USAR", 95: "DM-USAR",
            96: "Quad-USAR", 97: "DB–Speurhonden", 98: "SIV-P", 99: "DB-VOA", 100: "GGB",
            101: "NHT", 102: "MC-Ambulance", 103: "MICU", 104: "Berger-K", 105: "Berger-G",
            106: "Berger-K (RWS)", 107: "Berger-G (RWS)", 108: "Berger-K (Politie)", 109: "Berger-G (Politie)", 110: "DAT-KMAR",
            111: "DB-KMAR", 112: "DM-KMAR", 113: "DAT-EOD", 114: "DB-EOD", 115: "VW-EOD",
            116: "DB-Explosievenhonden", 117: "DB-Explosievenduikers", 118: "BA-DDG", 119: "DB-TEV", 120: "DB-VZ",
            121: "VZH", 122: "DB-AH", 123: "VZH-AH", 124: "DB-PC-LOG", 125: "DB-LOG",
            126: "VW-LOG", 127: "BMH-LOG", 128: "DB-DRONE", 129: "DB-TDV", 130: "SB-BA",
            131: "SB-IB", 132: "AS", 133: "TS-IB", 134: "GSH", 135: "DB-GS",
            136: "GPH", 137: "DB-GP", 138: "BOH-DC", 139: "TS-BO", 140: "DB-BO",
            141: "GOH-DC", 142: "TS-GO", 143: "DB-GO", 144: "DB-ICB", 145: "OvD-ICB",
            146: "VW-VZ-ICB", 147: "HA-ICB", 148: "GM-ICB", 149: "HSH-ICB", 150: "VW-HS",
            151: "BM-VTHS", 152: "TS-Spoor",
        };

        // The one caption source that's actually reliable: prefer the API's own
        // text if present (rare, but possible), otherwise resolve it from the
        // numeric type id, which is always populated.
        function resolveTypeCaption(vehicle) {
            return vehicle.vehicle_type_caption || VEHICLE_TYPE_ID_MAP[vehicle.vehicle_type] || '';
        }

        // Fire-relevant entries of VEHICLE_TYPE_ID_MAP, classified directly into
        // the official numbering plan's digit bucket. This is the fix for the
        // real bug: VEHICLE_TYPE_ID_MAP gives short game captions like "TS 6/7",
        // which never matched FIRE_TYPE_DICT's full Dutch descriptions (like
        // "tankautospuit") — so classification was silently failing and falling
        // through to trusting the vehicle's own current name, which is circular
        // when that name is already wrong. This table is name-independent and
        // always available, so it's now checked FIRST.
        const VEHICLE_TYPE_ID_TO_ROLE = {
            0: { digit: '8', label: 'SI-2' }, 1: { digit: '3', label: 'TS 8/9' }, 2: { digit: '5', label: 'AL' },
            3: { digit: '9', label: 'DA-OVD' }, 4: { digit: '7', label: 'HV' }, 5: { digit: '8', label: 'AB' },
            6: { digit: '4', label: 'TST 8/9' }, 7: { digit: '4', label: 'TST 6/7' }, 8: { digit: '4', label: 'TST 4/5' },
            9: { digit: '3', label: 'TS 4/5' }, 10: { digit: '6', label: 'SL' }, 11: { digit: '2', label: 'VEB' },
            12: { digit: '4', label: 'TST-NB 8/9' }, 14: { digit: '4', label: 'TST-NB 6/7' }, 15: { digit: '4', label: 'TST-NB 4/5' },
            17: { digit: '3', label: 'TS 6/7' }, 18: { digit: '5', label: 'HW' }, 19: { digit: '9', label: 'DA-HOVD' },
            20: { digit: '0', label: 'DA' }, 21: { digit: '0', label: 'DB' }, 24: { digit: '2', label: 'DA-AGS' },
            26: { digit: '8', label: 'HA' }, 27: { digit: '8', label: 'ABH' }, 29: { digit: '6', label: 'WTH' },
            31: { digit: '9', label: 'CO' }, 32: { digit: '9', label: 'COH' }, 33: { digit: '1', label: 'WO' },
            34: { digit: '6', label: 'WT' }, 36: { digit: '1', label: 'WOA' }, 41: { digit: '6', label: 'CT' },
            42: { digit: '6', label: 'CT' }, 43: { digit: '6', label: 'CT' }, 44: { digit: '9', label: 'AFO' },
            45: { digit: '6', label: 'DPH' }, 49: { digit: '1', label: 'PM-OR' }, 50: { digit: '1', label: 'TS-OR' },
            51: { digit: '7', label: 'HVH' }, 56: { digit: '9', label: 'VL-B' }, 61: { digit: '6', label: 'SLH' },
            62: { digit: '3', label: 'TS-HV' }, 68: { digit: '6', label: 'SB' }, 69: { digit: '6', label: 'SBH' },
            70: { digit: '6', label: 'SBA' }, 71: { digit: '6', label: 'MSA' }, 72: { digit: '6', label: 'DPA' },
            76: { digit: '8', label: 'Quad' }, 77: { digit: '6', label: 'KW-boot' }, 84: { digit: '6', label: 'WKA' },
            86: { digit: '0', label: 'DB-Handcrew' }, 87: { digit: '9', label: 'LA-NB' }, 88: { digit: '8', label: 'VW-NB' },
            89: { digit: '4', label: 'NBH' }, 90: { digit: '7', label: 'TS-STH' }, 91: { digit: '7', label: 'HVH-STH' },
            92: { digit: '7', label: 'DB-USAR' }, 93: { digit: '7', label: 'TS-USAR' }, 94: { digit: '7', label: 'VW-USAR' },
            95: { digit: '7', label: 'DM-USAR' }, 96: { digit: '7', label: 'Quad-USAR' }, 97: { digit: '8', label: 'DB-Speurhonden' },
            119: { digit: '8', label: 'DB-TEV' }, 120: { digit: '8', label: 'DB-VZ' }, 121: { digit: '8', label: 'VZH' },
            122: { digit: '8', label: 'DB-AH' }, 123: { digit: '8', label: 'VZH-AH' }, 124: { digit: '8', label: 'DB-PC-LOG' },
            125: { digit: '8', label: 'DB-LOG' }, 126: { digit: '8', label: 'VW-LOG' }, 127: { digit: '8', label: 'BMH-LOG' },
            128: { digit: '8', label: 'DB-DRONE' }, 129: { digit: '8', label: 'DB-TDV' }, 130: { digit: '6', label: 'SB-BA' },
            131: { digit: '6', label: 'SB-IB' }, 132: { digit: '3', label: 'AS' }, 133: { digit: '3', label: 'TS-IB' },
            134: { digit: '2', label: 'GSH' }, 135: { digit: '2', label: 'DB-GS' }, 136: { digit: '2', label: 'GPH' },
            137: { digit: '2', label: 'DB-GP' }, 138: { digit: '2', label: 'BOH-DC' }, 139: { digit: '2', label: 'TS-BO' },
            140: { digit: '2', label: 'DB-BO' }, 141: { digit: '2', label: 'GOH-DC' }, 142: { digit: '2', label: 'TS-GO' },
            143: { digit: '2', label: 'DB-GO' }, 144: { digit: '9', label: 'DB-ICB' }, 145: { digit: '9', label: 'OvD-ICB' },
            146: { digit: '8', label: 'VW-VZ-ICB' }, 147: { digit: '8', label: 'HA-ICB' }, 148: { digit: '0', label: 'GM-ICB' },
            149: { digit: '7', label: 'HSH-ICB' }, 150: { digit: '8', label: 'VW-HS' }, 151: { digit: '7', label: 'BM-VTHS' },
            152: { digit: '3', label: 'TS-Spoor' },
        };

        // Type captions/vehicles that already got a "can't classify" warning this
        // session — avoids spamming the console with the same one repeatedly.
        const warnedUnclassified = new Set();

        // Turns out `vehicle_type_caption` from the API is empty/null for a lot of
        // vehicles on this site — it is NOT a reliable signal on its own. But every
        // vehicle that already has a real-format name ("NN-NNNN LABEL") has its
        // role encoded right there in the number and the label text itself, and
        // that's ground truth (it's either the real roepnummer, or a name this
        // very script assigned before) — far more reliable than keyword-guessing.
        // We NEVER invent a generic "OVR" placeholder name any more: if we can't
        // work out a vehicle's role from either signal, we leave it untouched
        // rather than assign it a meaningless name.
        function classifyFireVehicle(typeCaption, currentName, vehicleTypeId) {
            // Priority 1: the numeric vehicle_type id — name-independent, always
            // populated, and can never be circular the way trusting the current
            // name could be.
            if (vehicleTypeId !== undefined && VEHICLE_TYPE_ID_TO_ROLE[vehicleTypeId]) {
                return VEHICLE_TYPE_ID_TO_ROLE[vehicleTypeId];
            }

            // Priority 2: the (rarely populated) API type-caption text, matched
            // against the real-world Dutch type dictionary.
            const norm = normalize(typeCaption);
            if (norm) {
                if (FIRE_TYPE_DICT[norm]) return FIRE_TYPE_DICT[norm];
                for (const key of FIRE_TYPE_KEYS_BY_LENGTH) {
                    if (wordBoundaryIncludes(norm, key)) return FIRE_TYPE_DICT[key];
                }
            }

            // Priority 3 (last resort): trust the vehicle's own current name IF
            // it's already in real format with a plausible-looking label. Kept
            // low-priority on purpose — trusting it FIRST was circular (a vehicle
            // mislabeled by an old bug would just keep re-confirming its own
            // mistake forever, since the name matches "itself" every time).
            const parsedCurrent = currentName ? parseFireCallsign(currentName) : null;
            if (parsedCurrent) {
                const firstToken = (parsedCurrent.label || '').split(' ')[0];
                const prefix = firstToken.split('-')[0];
                const looksLikeRealAfkorting = /^[A-Z0-9][A-Z0-9\-/]{0,12}$/.test(firstToken);
                const isLeftoverOvr = /^OVR(-\d+)?$/i.test(firstToken);
                if (!isLeftoverOvr && (KNOWN_AFKORTINGEN.has(firstToken) || KNOWN_AFKORTINGEN.has(prefix) || looksLikeRealAfkorting)) {
                    return { digit: parsedCurrent.typeDigit, label: parsedCurrent.label };
                }
            }

            const warnKey = `${typeCaption}|${currentName}|${vehicleTypeId}`;
            if (!warnedUnclassified.has(warnKey)) {
                warnedUnclassified.add(warnKey);
                warn(`can't classify vehicle "${currentName}" (type text: "${typeCaption || '(empty)'}", type id: ${vehicleTypeId}) — leaving it untouched. Tell Claude the exact vehicle name/type so it can be taught.`);
            }
            return null;
        }

        function parseFireCallsign(cs) {
            const m = cs.match(/^(\d{2})-(\d{2})(\d)(\d)(?:\s+(.*))?$/);
            if (!m) return null;
            return { regio: m[1], post: m[2], typeDigit: m[3], seq: m[4], label: m[5] || '' };
        }

        /* ========================================================================
         * REFERENCE DATA — exact real Utrecht (09) brandweer roepnummers
         * Source: user-supplied "Utrecht vehicle naming" reference sheet.
         * Parenthesised notes stripped as instructed.
         * ==================================================================== */
        const UTRECHT_FIRE_STATIONS = {
            "Amersfoort-Centrum": ["09-0101 DB", "09-0111 WO", "09-0131 TS", "09-0132 TS", "09-0133 TS", "09-0134 TSC", "09-0144 TST-NB", "09-0152 AL", "09-0181 HA", "09-8031 TS", "09-8030 TS", "09-8052 AL", "09-8182 HA", "09-8641 TST", "09-8684 HA", "09-9093 Leiding & Coordinatie Unit", "09-9297 MC", "09-9471 PM-QRT", "09-9491 DA-QRT"],
            "Amersfoort-Noord": ["09-0231 TS", "09-0271 HV"],
            "Baarn": ["09-0301 DB", "09-0331 TS", "09-0341 TST", "09-0372 MFT", "09-0374 HVT", "09-0380 PMT"],
            "Bunschoten": ["09-0401 DB", "09-0411 WO", "09-0412 WOV", "09-0431 TS", "09-0432 TS", "09-0468 MSA"],
            "Bunnik": ["09-0501 DB", "09-0531 TS", "09-0571 HV"],
            "Werkhoven": ["09-0601 DB", "09-0631 TS", "09-0667 RIA", "09-0668 MSA", "09-0680 PM"],
            "Bilthoven": ["09-0701 DB", "09-0734 TSC", "09-0744 TST-NB", "09-0762 SLH", "09-0774 HVT", "09-0781 HA", "09-9187 ABH"],
            "De Bilt": ["09-0801 PM", "09-0831 TS"],
            "Groenekan": ["09-0931 TS"],
            "Maartensdijk": ["09-1034 TSC", "09-1044 TST-NB"],
            "Westbroek": ["09-1131 TS"],
            "Abcoude": ["09-1201 DB", "09-1210 PM-OR", "09-1231 TS", "09-1280 GM"],
            "Mijdrecht": ["09-1311 WO", "09-1321 DV-VK", "09-1331 TS", "09-1332 TS", "09-1351 HW"],
            "Vinkeveen": ["09-1401 DB", "09-1412 BRV", "09-1431 TS", "09-1468 MSA", "09-1480 PM"],
            "Wilnis": ["09-1501 DB", "09-1531 TS", "09-1571 HV", "09-1568 MSA", "09-1578 VT"],
            "Eemnes": ["09-1601 DB", "09-1621 DB-VK", "09-1631 TS", "09-1632 TS"],
            "Houten": ["09-1731 TS", "09-1801 DB", "09-1812 WOV", "09-1831 TS", "09-1832 TS", "09-1880 DB", "09-9063 WT", "09-9197 MC"],
            "Schalkwijk": ["09-1901 DB", "09-1921 DB-VK", "09-1931 TS"],
            "IJsselstein": ["09-2001 DB", "09-2031 TS", "09-2032 TS", "09-2052 AL"],
            "Achterveld": ["09-2101 DB", "09-2131 TS", "09-2168 MSA", "09-2178 PM-VI", "09-2180 DB-K"],
            "Leusden": ["09-2231 TS", "09-2241 TST-NB", "09-2261 WTS-2500", "09-2265 WTH", "09-2286 HAT"],
            "Benschop": ["09-2301 DB", "09-2331 TS", "09-2368 MSA", "09-2378 VIA", "09-2380 PM"],
            "Lopik": ["09-2401 DB", "09-2431 TS", "09-2432 TS"],
            "Linschoten": ["09-2531 TS", "09-2571 HV"],
            "Montfoort": ["09-2601 DB", "09-2631 TS", "09-2661 DPH", "09-2668 MSA", "09-2680 PM", "09-2681 HA"],
            "Nieuwegein-Noord": ["09-2701 DB", "09-2731 TS", "09-2732 TS", "09-2771 HV", "09-9472 PM-QRT", "09-9492 DA-QRT"],
            "Nieuwegein-Zuid": ["09-2801 DB", "09-2831 TS", "09-2869 PM-KSH"],
            "Oudewater": ["09-2901 PM", "09-2931 TS", "09-2932 TS", "09-2978 VTI", "09-9183 PM-VZ"],
            "Renswoude": ["09-3001 DB", "09-3041 TS", "09-3068 MSA", "09-3080 PM"],
            "Elst": ["09-3134 TSC", "09-3144 TST-NB", "09-3172 MFT", "09-3180 PMT"],
            "Rhenen": ["09-3201 DB", "09-3231 TS", "09-3241 TST-NB", "09-3268 MSA", "09-3278 VIA"],
            "Soest": ["09-3301 DB", "09-3341 TST-NB", "09-3351 HW", "09-3364 BPH", "09-3366 WBH", "09-3386 HAT", "09-3387 BSH"],
            "Soest-Nevenpost": ["09-3441 TST-NB"],
            "Soesterberg": ["09-3501 DB", "09-3534 TSC", "09-3541 TST-NB", "09-9283 PM-VZ"],
            "Breukelen": ["09-3601 DB", "09-3612 WOV", "09-3631 TS", "09-3632 TS", "09-3671 HV"],
            "Kockengen": ["09-3731 TS", "09-3767 PM-RI"],
            "Loenen": ["09-3801 DB", "09-3831 TS", "09-8131 TS"],
            "Maarssen": ["09-3911 WO", "09-3931 TS", "09-3932 TS", "09-3952 AL", "09-3961 DPH", "09-8132 TS", "09-8202 PM-TD"],
            "Nieuwer ter Aa": ["09-4101 DB", "09-4131 TS", "09-4181 HA"],
            "Nigtevecht": ["09-4201 DB", "09-4231 TS"],
            "De Meern": ["09-4301 DB", "09-4321 DB-VK", "09-4331 TS"],
            "Utrecht-Leidsche Rijn": ["09-4401 DB", "09-4411 WO", "09-4412 WOV", "09-4431 TS", "09-4452 AL", "09-4471 HV", "09-4480 PM5", "09-4481 HA", "09-4482 HA", "09-8181 HA", "09-8301 VW", "09-8531 TS", "09-9075 HVH-LI", "09-9080 VW", "09-9082 HA", "09-9083 VZH-WC", "09-9084 VZH", "09-9085 VW", "09-9088 PM5"],
            "Utrecht-Schepenbuurt": ["09-4501 DB", "09-4522 GSH-DE", "09-4531 TS", "09-4581 HA"],
            "Utrecht-Tolsteeg": ["09-4601 PM", "09-4631 TS"],
            "Vleuten": ["09-4701 DB", "09-4731 TS", "09-8532 TS"],
            "Amerongen": ["09-5001 PM", "09-5034 TSC", "09-5044 TST-NB", "09-5071 HV"],
            "Driebergen": ["09-5101 DB", "09-5131 TS", "09-5144 TST-NB", "09-5169 WT"],
            "Doorn": ["09-5201 DB", "09-5234 TSC", "09-5244 TST-NB", "09-5252 AL", "09-8832 TS"],
            "Leersum": ["09-5301 DB", "09-5321 DB-VK", "09-5334 TSC", "09-5344 TST-NB", "09-8831 TS", "09-9473 PM-QRT", "09-9493 DA-QRT"],
            "Maarn-Maarsbergen": ["09-5401 DB", "09-5431 TS", "09-5434 TSC", "09-5444 TST-NB", "09-5474 HVT"],
            "Veenendaal": ["09-5501 DB", "09-5522 MIH", "09-5531 TS", "09-5532 TS", "09-5541 TST-NB", "09-5552 AL", "09-5561 DPH", "09-5571 HV", "09-5581 HA", "09-5586 HAT", "09-8502 DA", "09-9272 BMH-Log"],
            "Hagestein": ["09-5631 TS"],
            "Vianen": ["09-5710 PM-OR", "09-5712 WOV", "09-5731 TS", "09-5751 HW", "09-5780 PMT"],
            "Wijk bij Duurstede": ["09-5901 DB", "09-5911 WO", "09-5912 WOV", "09-5931 TS", "09-5934 TSC", "09-5944 TST-NB"],
            "Harmelen": ["09-6001 DB", "09-6031 TS", "09-6068 MSA"],
            "Kamerik": ["09-6131 TS", "09-6167 RI"],
            "Woerden": ["09-6210 PM-OR", "09-6231 TS", "09-6232 TS", "09-6252 AL"],
            "Zegveld": ["09-6301 DB", "09-6331 TS"],
            "Woudenberg": ["09-6434 TSC", "09-6444 TST-NB", "09-6464 WBH", "09-6466 BPH", "09-6486 HAT", "09-8481 HA", "09-8633 TS"],
            "Den Dolder": ["09-6531 TS"],
            "Zeist": ["09-6621 DV-VK", "09-6631 TS", "09-6644 TST-NB", "09-6652 AL", "09-6662 SLH", "09-6665 WTH", "09-6686 HAT", "09-8032 TS"],
            "Ameide": ["09-6701 DB", "09-6731 TS"],
            "Leerdam": ["09-6801 PM", "09-6802 DV-BVD", "09-6831 TS", "09-6851 HW"],
            "Lexmond": ["09-6901 PM", "09-6931 TS"],
            "Meerkerk": ["09-7001 DB", "09-7031 TS", "09-7071 HV2"],
            "Schoonrewoerd": ["09-7101 DB", "09-7131 TS", "09-7169 WT"],
        };

        // Partial, community-sourced (forum.meldkamerspel.com) real Gelderland-Midden (07)
        // roepnummers for the handful of your buildings that fall in this region.
        const GELDERLAND_MIDDEN_FIRE_STATIONS = {
            "Ede": ["07-2701 DB", "07-2704 DA", "07-2705 DA"],
            "Ederveen": ["07-2531 TS", "07-2580 DB-FRB"],
            "Nijkerk": ["07-1101 DB", "07-1103 DA", "07-1104 DA", "07-1131 TST"],
            "Scherpenzeel": ["07-1931 TST", "07-1961 PM-FRB"],
            "Garderen": ["07-1341 TST-NBB", "07-1380 DB-FRB"],
            "Otterlo": ["07-2341 TST-NBB", "07-2380 DA-FRB"],
        };

        // Alias fixes for building names that don't match a place key directly.
        const FIRE_BUILDING_ALIASES = {
            'brandweer kazerne de valk': 'de valk',
            'brandweer kazerne houten': 'houten',
            'brandweer kazerne putten': 'putten',
            'brandweer kazerne harderwijk': 'harderwijk',
            'brandweer post schiphol rijk': 'schiphol',
            'brandweer post schiphol sloten': 'schiphol',
            'brandweer post schiphol vijfhuizen': 'schiphol',
        };

        /* ========================================================================
         * REFERENCE DATA — Ambulance (generic RAVU-style; 1xx regular / 3xx rapid
         * responder-solo-motor / 4xx B-ambulance). Region code reused from the
         * fire/veiligheidsregio table since RAV regions use the same numbering.
         * ==================================================================== */
        // Direct numeric vehicle_type -> role, same rationale as the fire table:
        // name-independent and always populated, so this is checked first and is
        // what actually lets you tell MICU/OVDG/regular ambulance apart at a
        // glance instead of every ambulance just being a bare number.
        const AMBULANCE_TYPE_ID_TO_ROLE = {
            16: { block: '1', label: 'AMB' },
            30: { block: '1', label: 'ZA' },
            37: { block: '1', label: 'MMT' },
            38: { block: '3', label: 'OVDG' },
            52: { block: '3', label: 'RR' },
            57: { block: '3', label: 'OVDG-RR' },
            63: { block: '3', label: 'RR' },
            100: { block: '4', label: 'GGB' },
            101: { block: '4', label: 'NHT' },
            102: { block: '1', label: 'MC' },
            103: { block: '3', label: 'MICU' },
        };
        const AMBULANCE_TYPE_RULES = [
            { block: '4', label: 'B-Amb', kw: ['b-ambulance', 'ziekenvervoer', 'bestelbus'] },
            { block: '3', label: 'RR', kw: ['rapid responder', 'solo', 'motor', 'micu', 'snelle interventie', 'bike'] },
            { block: '1', label: 'AMB', kw: [] },
        ];
        function classifyAmbulance(typeCaption, vehicleTypeId) {
            if (vehicleTypeId !== undefined && AMBULANCE_TYPE_ID_TO_ROLE[vehicleTypeId]) {
                return AMBULANCE_TYPE_ID_TO_ROLE[vehicleTypeId];
            }
            const norm = normalize(typeCaption);
            for (const r of AMBULANCE_TYPE_RULES) { if (r.kw.some((k) => norm.includes(k))) return r; }
            return AMBULANCE_TYPE_RULES[AMBULANCE_TYPE_RULES.length - 1];
        }

        /* ========================================================================
         * REFERENCE DATA — Politie. MD basisteam numbers are real (Politie
         * Midden-Nederland, district Oost-Utrecht); everywhere else falls back
         * to a generic-but-plausible "<eenheid> <team>.<seq> <rol>" pattern.
         * ==================================================================== */
        const POLICE_UNIT_ABBR = {
            '01': 'NN', '02': 'NN', '03': 'NN', '04': 'ON', '05': 'ON', '06': 'ON', '07': 'ON', '08': 'ON',
            '09': 'MD', '10': 'NH', '11': 'NH', '12': 'NH', '13': 'AM', '14': 'MD', '15': 'HR', '16': 'HR',
            '17': 'RN', '18': 'RN', '19': 'ZWB', '20': 'ZWB', '21': 'OB', '22': 'OB', '23': 'LI', '24': 'LI', '25': 'MD',
        };
        // Real basisteam numbers, Politie Midden-Nederland / district Oost-Utrecht
        const MD_BASISTEAMS = {
            'amersfoort': 31,
            'baarn': 32, 'eemland': 32, 'soest': 32,
            'zeist': 33, 'bunnik': 33, 'leusden': 33, 'woudenberg': 33,
            'veenendaal': 34, 'doorn': 34, 'heuvelrug': 34, 'wijk bij duurstede': 34,
        };

        /* ========================================================================
         * REFERENCE DATA — known real aircraft (trauma heli's & politiehelikopters)
         * These are exact and finite, matched by keyword in the building caption.
         * ==================================================================== */
        const KNOWN_AIRCRAFT = [];

        // Real ANWB Medical Air Assistance LifeLiner trauma heli registrations
        // (Airbus H135). Assigned in order per building via a counter, same
        // mechanism as POLICE_HELI_LIST, so a base with several LifeLiners gets
        // several distinct real tail numbers instead of one shared placeholder.
        const LIFELINER_MAIN_LIST = ['LifeLiner - PH-LLN', 'LifeLiner - PH-UMC', 'LifeLiner - PH-DOC', 'LifeLiner - PH-HIP', 'LifeLiner - PH-HLP'];
        const LIFELINER_MAIN_BUILDING_MATCH = /amsterdam.*heliport|vumc|\bamc\b|radboud|nijmeg|traumaheli|traumacentrum/i;
        // Wadden/patiëntenvervoer variant — separate pool for bases serving the
        // Waddeneilanden (e.g. "Vliegbasis Traumacentrum Zuidwest").
        const LIFELINER_WADDEN_LIST = ['Medic 01 - PH-OOP', 'PH-HOW'];
        const LIFELINER_WADDEN_BUILDING_MATCH = /wadden|zeeland|zuidwest/i;

        // Real Landelijke Eenheid politiehelikopter roepnamen. Source: forum.meldkamerspel.com
        // thread "roepnummers-landelijke-eenheid". One entry consumed per vehicle,
        // in order, via a per-building counter — so multiple heli's at the same
        // police-aviation building each get a distinct real tail number instead of
        // all sharing the single "PH-PXD - ZULU" placeholder used before.
        // Picked by vehicle type (28 = Politiehelikopter), never by the base's name,
        // and shared across the whole fleet so no two heli's get the same one.
        const POLICE_HELI_TYPE_ID = 28;
        const POLICE_HELI_LIST = [
            'ZULU 80.11 - PH-PXA', 'ZULU 80.12 - PH-PXB', 'ZULU 80.13 - PH-PXC',
            'ZULU 80.14 - PH-PXD', 'ZULU 80.15 - PH-PXE', 'ZULU 80.16 - PH-PXF',
            'ZULU 80.24 - PH-PXX', 'ZULU 80.25 - PH-PXY', 'ZULU 80.26 - PH-PXZ',
        ];

        /* ========================================================================
         * REFERENCE DATA — building_type -> discipline
         * Source: verified against the game's own nl_NL translation strings.
         * ==================================================================== */
        const BUILDING_TYPE_DISCIPLINE = {
            0: 'fire', 17: 'fire',
            3: 'ambulance', 13: 'ambulance',
            5: 'police', 11: 'police', 18: 'police',
            6: 'aviation', 9: 'aviation', 19: 'aviation', 21: 'aviation',
            22: 'rws',
            23: 'military',
            25: 'kmar',
            27: 'prorail',
        };
        function classifyDiscipline(buildingType) {
            return BUILDING_TYPE_DISCIPLINE[buildingType] || 'other';
        }

        /* ========================================================================
         * Manual overrides — put exact names you want here, keyed by vehicle id.
         * Always wins over everything else.
         * ==================================================================== */
        const MANUAL_VEHICLE_OVERRIDES = {
            // 123456: '09-5001 PM',

            // NOTE: the old 63-entry "known-good backup" list that used to live
            // here has been removed. It was captured back when vehicle_type_id
            // classification didn't exist yet, and — because manual overrides
            // always win — it was actively forcing those vehicles back to their
            // OLD (often wrong) names every scan, overriding the now-correct
            // vehicle_type-based classifier. E.g. vehicle 9825247 was locked to
            // "09-1801 DB" here even though its real vehicle_type_id (9) is
            // "TS 4/5". If you need to hard-lock a specific vehicle again, add
            // it below — but check it against the classifier first.
        };

        /* ========================================================================
         * NAME GENERATION ENGINE
         * ==================================================================== */

        function regioForBuilding(building) {
            const stripped = stripPrefix(normalize(building.caption));
            if (FIRE_BUILDING_ALIASES[stripped] && PLACE_TO_REGIO[FIRE_BUILDING_ALIASES[stripped]]) {
                return PLACE_TO_REGIO[FIRE_BUILDING_ALIASES[stripped]];
            }
            // exact place match first
            if (PLACE_TO_REGIO[stripped]) return PLACE_TO_REGIO[stripped];
            // then longest whole-word match (never a bare substring — "doorn" must not match inside "apeldoorn")
            let best = null;
            for (const place of Object.keys(PLACE_TO_REGIO)) {
                if (wordBoundaryIncludes(stripped, place) || wordBoundaryIncludes(place, stripped)) {
                    if (!best || place.length > best.length) best = place;
                }
            }
            return best ? PLACE_TO_REGIO[best] : CONFIG.DEFAULT_REGIO_CODE;
        }

        function getOrAssignPostNumber(regio, buildingId) {
            postNumbers[regio] = postNumbers[regio] || {};
            if (postNumbers[regio][buildingId]) return postNumbers[regio][buildingId];
            const used = new Set(Object.values(postNumbers[regio]));
            let n = 1;
            while (used.has(n) && n < 99) n++;
            postNumbers[regio][buildingId] = n;
            return n;
        }

        function nextSeq(seqKey) {
            seqCounters[seqKey] = (seqCounters[seqKey] || 0) + 1;
            return seqCounters[seqKey];
        }

        function findFireStationData(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const alias = FIRE_BUILDING_ALIASES[stripped];
            const tryKey = (dict) => {
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (nkey === stripped || (alias && nkey === alias)) return { list: dict[key], regio: dict === UTRECHT_FIRE_STATIONS ? '09' : '07' };
                }
                // whole-word fallback match (handles "Rhenen-Achterberg" -> "Rhenen" etc.,
                // but never lets "doorn" match inside "apeldoorn")
                let best = null;
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (wordBoundaryIncludes(stripped, nkey) || wordBoundaryIncludes(nkey, stripped)) {
                        if (!best || nkey.length > best.nkey.length) best = { key, nkey };
                    }
                }
                if (best) return { list: dict[best.key], regio: dict === UTRECHT_FIRE_STATIONS ? '09' : '07' };
                return null;
            };
            return tryKey(UTRECHT_FIRE_STATIONS) || tryKey(GELDERLAND_MIDDEN_FIRE_STATIONS) || null;
        }

        // Which exact target strings are already claimed by OTHER vehicles at this building?
        function claimedExactTargets(building, vehicles) {
            const claimed = new Set();
            for (const v of vehicles) {
                const a = assignments[v.id];
                if (a && a.exact && a.building === building.id) claimed.add(a.name);
            }
            return claimed;
        }

        // Returns null when the vehicle's role genuinely can't be worked out —
        // callers must leave that vehicle untouched rather than invent a name.
        function generateFireTarget(building, vehicle, regio, post, exactData, claimed) {
            const rule = classifyFireVehicle(resolveTypeCaption(vehicle), vehicle.caption || '', vehicle.vehicle_type);
            if (!rule) return null;
            const t = generateFireTargetInner(building, rule, regio, post, exactData, claimed);
            // A current name fits when it is the same regio, role digit and label,
            // at this station's post or on one of its real roepnummers.
            const realNums = new Set((exactData ? exactData.list : []).map((raw) => {
                const p = parseFireCallsign(raw);
                return p ? `${p.regio}-${p.post}${p.typeDigit}${p.seq}` : '';
            }));
            const post2 = String(post).padStart(2, '0');
            t.fits = (caption) => {
                const p = parseFireCallsign(caption || '');
                if (!p || p.regio !== regio || p.typeDigit !== rule.digit || p.label !== (rule.label || '')) return null;
                const real = realNums.has(`${p.regio}-${p.post}${p.typeDigit}${p.seq}`);
                if (!real && p.post !== post2) return null;
                return { seq: Number(p.seq), exact: real };
            };
            return t;
        }

        function generateFireTargetInner(building, rule, regio, post, exactData, claimed) {
            if (exactData) {
                const targets = exactData.list.map((raw) => ({ raw, parsed: parseFireCallsign(raw) }));
                // Only ever take a real roepnummer whose role actually matches this
                // vehicle's classified role. Previously this fell back to grabbing
                // *any* leftover real entry regardless of role when none matched,
                // which is how a hoogwerker (HW) could end up wearing a real "DB"
                // callsign that actually belongs to a completely different vehicle.
                const pick = targets.find((t) => !claimed.has(t.raw) && t.parsed && t.parsed.typeDigit === rule.digit);
                if (pick) {
                    // IMPORTANT: only ever borrow the NUMBER from the reference
                    // data. The class/label (DB, TS, VEB, ...) always comes from
                    // what the game itself says this vehicle is (`rule`, derived
                    // from vehicle_type) — never from the reference list's own
                    // label text, which describes a DIFFERENT real vehicle that
                    // happens to share this digit slot, not this one. Pasting
                    // that label wholesale is exactly what caused e.g. a VEB
                    // vehicle to get labeled "MFT" and a TS to get labeled "DB".
                    const p = pick.parsed;
                    const label = rule.label ? ` ${rule.label}` : '';
                    return { name: `${p.regio}-${p.post}${p.typeDigit}${p.seq}${label}`, seqKey: null, exact: true };
                }
                // No real slot of the right role left (or this station's real list
                // simply has none of this role) -> fall through to a generated
                // name, same regio+post. Seed the counter so it continues numerically
                // after the real roepnummers for this role instead of restarting at 1
                // (avoids e.g. a fictional "5001 DB" next to the real "5001 PM").
            }
            const seqKey = `fire:${building.id}:${rule.digit}`;
            if (!(seqKey in seqCounters) && exactData) {
                seqCounters[seqKey] = exactData.list.filter((raw) => {
                    const p = parseFireCallsign(raw);
                    return p && p.typeDigit === rule.digit;
                }).length;
            }
            const seq = Math.min(nextSeq(seqKey), 9);
            const label = rule.label ? ` ${rule.label}` : '';
            return { name: `${regio}-${String(post).padStart(2, '0')}${rule.digit}${seq}${label}`, seqKey, exact: false };
        }

        function escRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        // Builds a fits() check from a regex whose one capture group is the sequence number.
        function fitsBy(re) {
            return (caption) => {
                const m = (caption || '').match(re);
                return m ? { seq: Number(m[1]), exact: false } : null;
            };
        }

        function generateAmbulanceTarget(building, vehicle, regio) {
            const rule = classifyAmbulance(resolveTypeCaption(vehicle), vehicle.vehicle_type);
            const seqKey = `amb:${building.id}:${rule.block}`;
            const seq = nextSeq(seqKey);
            const re = new RegExp(`^${escRe(`${regio}-${rule.block}`)}(\\d{2}) ${escRe(rule.label)}$`);
            return { name: `${regio}-${rule.block}${String(seq).padStart(2, '0')} ${rule.label}`, seqKey, exact: false, fits: fitsBy(re) };
        }

        // Direct numeric vehicle_type -> role, same rationale as the fire/ambulance
        // tables: the type caption text is often empty or doesn't contain the
        // keyword the old text-scan looked for (e.g. "ME Flexbus" matched the
        // 'bus' keyword meant for arrestantenbussen and got labeled DB; "DM-Politie"
        // doesn't contain "motor" so it fell through to the generic "NH" default
        // along with several other real police types). Checked first, so every
        // vehicle_type below is name-independent and can't silently collapse to NH.
        const POLICE_TYPE_ID_TO_ROLE = {
            22: 'NH', 25: 'NH', 28: 'HELI', 35: 'OVD-P', 39: 'ME-CO', 40: 'ME-FB',
            46: 'DM-P', 47: 'HK9', 48: 'HK9', 58: 'DB', 59: 'NH-OV', 60: 'BIKE',
            64: 'ME-AE', 73: 'BER', 74: 'BER-AH', 98: 'SIV', 99: 'VOA',
            108: 'BRG-K', 109: 'BRG-G', 110: 'KMAR', 111: 'KMAR', 112: 'KMAR-M',
        };
        function generatePoliceTarget(building, vehicle) {
            const stripped = stripPrefix(normalize(building.caption));
            const regio = regioForBuilding(building);
            const unitAbbr = POLICE_UNIT_ABBR[regio] || 'PL';
            let teamNum = null;
            for (const [place, num] of Object.entries(MD_BASISTEAMS)) {
                // whole-word match only — plain .includes() let unrelated place
                // names collide (same class of bug as "doorn" matching inside
                // "apeldoorn" before).
                if (wordBoundaryIncludes(stripped, place)) { teamNum = num; break; }
            }
            const prefix = teamNum ? `${unitAbbr} ${teamNum}` : `${unitAbbr} ${getOrAssignPostNumber('police:' + regio, building.id) + 30}`;
            let role = POLICE_TYPE_ID_TO_ROLE[vehicle.vehicle_type];
            if (!role) {
                const typeNorm = normalize(resolveTypeCaption(vehicle));
                role = 'NH';
                if (typeNorm.includes('officier')) role = 'OVD-P';
                else if (typeNorm.includes('motor')) role = 'DM-P';
                else if (typeNorm.includes('bus') || typeNorm.includes('arrestant')) role = 'DB';
                else if (typeNorm.includes('hond')) role = 'HK9';
                else if (typeNorm.includes('paard')) role = 'BP';
            }
            // IMPORTANT: a real basisteam number (e.g. "MD 34") can cover MULTIPLE
            // physical buildings in this save (Doorn and Veenendaal are both team
            // 34) — the sequence must be shared across all of them, not restart at
            // .01 per building, or two different stations both produce "MD 34.01
            // NH". Only the auto-assigned fallback prefix is genuinely unique per
            // building, so that one can stay scoped to the building.
            const seqScope = teamNum ? `team:${unitAbbr}${teamNum}` : `building:${building.id}`;
            const seqKey = `pol:${seqScope}:${role}`;
            const seq = nextSeq(seqKey);
            const re = new RegExp(`^${escRe(prefix)}\\.(\\d{2}) ${escRe(role)}$`);
            return { name: `${prefix}.${String(seq).padStart(2, '0')} ${role}`, seqKey, exact: false, fits: fitsBy(re) };
        }

        function generateAviationTarget(building) {
            for (const ac of KNOWN_AIRCRAFT) {
                if (ac.match.test(building.caption)) return { name: ac.name, seqKey: null, exact: true, aviation: true };
            }
            // Checked before LIFELINER_MAIN since a Wadden base's caption can also
            // contain "traumacentrum" (e.g. "Vliegbasis Traumacentrum Zuidwest").
            if (LIFELINER_WADDEN_BUILDING_MATCH.test(building.caption)) {
                const seqKey = `lifelinerw:${building.id}`;
                const idx = nextSeq(seqKey) - 1;
                if (idx < LIFELINER_WADDEN_LIST.length) {
                    return { name: LIFELINER_WADDEN_LIST[idx], seqKey: null, exact: true, aviation: true };
                }
            }
            if (LIFELINER_MAIN_BUILDING_MATCH.test(building.caption)) {
                const seqKey = `lifeliner:${building.id}`;
                const idx = nextSeq(seqKey) - 1;
                if (idx < LIFELINER_MAIN_LIST.length) {
                    return { name: LIFELINER_MAIN_LIST[idx], seqKey: null, exact: true, aviation: true };
                }
            }
            return null;
        }

        const ORG_CODE = { rws: 'RWS', prorail: 'PR', kmar: 'KMAR' };
        const OTHER_TYPE_LABEL = {
            81: 'DA-RWS', 82: 'DM-RWS', 83: 'DA-SIG', 104: 'BRG-K', 105: 'BRG-G',
            106: 'BRG-K', 107: 'BRG-G', 108: 'BRG-K', 109: 'BRG-G',
            110: 'DAT', 111: 'DB', 112: 'DM', 113: 'DAT-EOD', 114: 'DB-EOD', 115: 'VW-EOD',
            116: 'DB-EXH', 117: 'DB-EXD', 118: 'BA-DDG', 144: 'DB-ICB', 145: 'OVD-ICB',
            146: 'VW-VZ-ICB', 147: 'HA-ICB', 148: 'GM-ICB', 149: 'HSH-ICB', 150: 'VW-HS',
            151: 'BM-VTHS', 152: 'TS-SPOOR',
        };
        function generateGenericTarget(building, discipline, vehicle) {
            const code = ORG_CODE[discipline] || deriveStationCode(building);
            let label = OTHER_TYPE_LABEL[vehicle && vehicle.vehicle_type];
            if (!label && vehicle) label = (VEHICLE_TYPE_ID_MAP[vehicle.vehicle_type] || '').split(' | ')[0];
            // Counter is shared per org+label (not per building) so two sites of
            // the same org never both produce e.g. "RWS-1 DA-RWS".
            const seqKey = `gen:${discipline}:${label || building.id}`;
            const seq = nextSeq(seqKey);
            const re = new RegExp(`^${escRe(code)}-(\\d+)${label ? ' ' + escRe(label) : ''}$`);
            return { name: `${code}-${seq}${label ? ' ' + label : ''}`, seqKey, exact: false, fits: fitsBy(re) };
        }

        // A heli already wearing a list name keeps it; otherwise it gets the first
        // list name no other vehicle has or is assigned. Past the end of the list
        // it is left untouched (null) rather than invent a callsign.
        function policeHeliTarget(vehicle) {
            const fits = (caption) => (POLICE_HELI_LIST.includes(caption) ? { seq: 0, exact: true } : null);
            const taken = new Set(Object.entries(assignments).filter(([id]) => Number(id) !== vehicle.id).map(([, a]) => a.name));
            for (const [id, caption] of captionById) if (id !== vehicle.id) taken.add(caption);
            const name = POLICE_HELI_LIST.find((n) => !taken.has(n));
            if (!name) return fits(vehicle.caption) ? { name: vehicle.caption, seqKey: null, exact: true } : null;
            return { name, seqKey: null, exact: true, fits };
        }

        function computeTarget(building, vehicle, vehiclesAtBuilding) {
            if (MANUAL_VEHICLE_OVERRIDES[vehicle.id]) {
                return { name: MANUAL_VEHICLE_OVERRIDES[vehicle.id], seqKey: null, exact: true, manual: true };
            }
            if (Number(vehicle.vehicle_type) === POLICE_HELI_TYPE_ID) return policeHeliTarget(vehicle);
            const discipline = classifyDiscipline(building.building_type);
            if (discipline === 'fire') {
                const exactData = findFireStationData(building);
                // If this station has a known real post number, reuse it for any
                // overflow vehicles too (so they read as "the same station", not
                // as an unrelated auto-numbered one). Only fall back to an
                // auto-assigned post number when we have no real data at all.
                const realPost = exactData && exactData.list.length
                    ? (parseFireCallsign(exactData.list[0]) || {}).post
                    : null;
                const regio = exactData ? exactData.regio : regioForBuilding(building);
                const post = realPost || getOrAssignPostNumber(regio, building.id);
                const claimed = claimedExactTargets(building, vehiclesAtBuilding);
                return generateFireTarget(building, vehicle, regio, post, exactData, claimed);
            }
            if (discipline === 'ambulance') {
                const regio = regioForBuilding(building);
                return generateAmbulanceTarget(building, vehicle, regio);
            }
            if (discipline === 'police') {
                return generatePoliceTarget(building, vehicle);
            }
            if (discipline === 'aviation') {
                const aviationTarget = generateAviationTarget(building);
                if (aviationTarget) return aviationTarget;
                return generateGenericTarget(building, discipline, vehicle);
            }
            return generateGenericTarget(building, discipline, vehicle);
        }

        /* ========================================================================
         * UNIQUENESS
         * ==================================================================== */
        function countCaptions(vehicles) {
            const m = new Map();
            for (const v of vehicles) m.set(v.caption, (m.get(v.caption) || 0) + 1);
            return m;
        }
        // Keep a vehicle's current name when it already is the computed name
        // and no other vehicle has it; otherwise it would collide with itself.
        function keepOrUnique(name, vehicle, usedNames, captionCount) {
            if (name === vehicle.caption && captionCount.get(name) === 1) return name;
            return ensureUnique(name, usedNames);
        }

        // "What would I have named this?" If the vehicle's current name already
        // follows the same scheme (same station, role and label, only a different
        // sequence number), keep it instead of renumbering the whole fleet. The
        // counter is moved past the kept number so new vehicles never reuse it.
        function adoptOrUnique(target, vehicle, usedNames, captionCount, adopted) {
            const fit = target.fits ? target.fits(vehicle.caption) : null;
            delete target.fits;
            if (fit && !adopted.has(vehicle.caption)) {
                adopted.add(vehicle.caption);
                if (target.seqKey) seqCounters[target.seqKey] = Math.max(seqCounters[target.seqKey] || 0, fit.seq);
                return { ...target, name: vehicle.caption, exact: fit.exact };
            }
            target.name = keepOrUnique(target.name, vehicle, usedNames, captionCount);
            return target;
        }

        function ensureUnique(name, usedNames) {
            if (!usedNames.has(name)) { usedNames.add(name); return name; }

            // For a real-format callsign ("NN-NNNN LABEL"), a collision should
            // count up the 4-digit number itself (0181 -> 0182 -> ...) so it still
            // reads as a real roepnummer, instead of tacking on an ugly "-2".
            const parsed = parseFireCallsign(name);
            if (parsed) {
                let n = Number(parsed.post + parsed.typeDigit + parsed.seq);
                for (let i = 0; i < 9000; i++) {
                    n++;
                    const numStr = String(n % 10000).padStart(4, '0');
                    const candidate = `${parsed.regio}-${numStr}${parsed.label ? ' ' + parsed.label : ''}`;
                    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
                }
            }

            // Same idea for the ambulance-style "NN-NNN LABEL" (3-digit) format.
            const parsedAmb = name.match(/^(\d{2})-(\d{3})\s+(.*)$/);
            if (parsedAmb) {
                let n = Number(parsedAmb[2]);
                for (let i = 0; i < 900; i++) {
                    n++;
                    const numStr = String(n % 1000).padStart(3, '0');
                    const candidate = `${parsedAmb[1]}-${numStr} ${parsedAmb[3]}`;
                    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
                }
            }

            // Fallback for anything not in real-callsign format.
            let n = 2;
            let candidate = `${name}-${n}`;
            while (usedNames.has(candidate) && n < 200) { n++; candidate = `${name}-${n}`; }
            usedNames.add(candidate);
            return candidate;
        }

        /* ========================================================================
         * GAME API
         * ==================================================================== */
        async function fetchWithTimeout(url, opts, timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs || CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        async function apiGet(path) {
            const res = await fetchWithTimeout(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }
        const getVehicles = () => apiGet('/api/vehicles');
        const getBuildings = () => apiGet('/api/buildings');
        const getVehicle = (id) => apiGet(`/api/vehicles/${id}`);

        /* ========================================================================
         * IN-GAME RENAME MECHANISM
         *
         * IMPORTANT: earlier versions injected the rename form into the live page
         * and clicked its submit button — turns out that form does a REAL
         * (non-AJAX) submit on meldkamerspel.com, which navigates/reloads the
         * whole page and kills the script's in-memory rename queue after the
         * very first vehicle. Fixed by never touching the live DOM at all: we
         * parse the fetched form fragment off-screen (DOMParser, not attached to
         * document), copy every field it has (CSRF token, Rails _method
         * override, etc.), swap in our new name, and POST it ourselves via
         * fetch(). fetch() never navigates the page no matter what the server
         * responds with, so the queue can never be interrupted this way again.
         * ==================================================================== */
        async function renameVehicleInGame(vehicleId, newName) {
            const trimmed = newName.slice(0, CONFIG.MAX_NAME_LENGTH);

            if (CONFIG.DRY_RUN) {
                log(`[DRY RUN] would rename vehicle ${vehicleId} -> "${trimmed}"`);
                return true;
            }

            log(`(${vehicleId}) fetching rename form...`);
            const html = await fetchWithTimeout(`/vehicles/${vehicleId}/editName`, { credentials: 'same-origin' }).then((r) => r.text());

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const form = doc.querySelector(`#vehicle_form_${vehicleId}`) || doc.querySelector('form');
            if (!form) {
                err(`(${vehicleId}) no <form> found in the fetched rename fragment. Raw HTML:`, html);
                return false;
            }

            const nameInput = form.querySelector(`#vehicle_new_name_${vehicleId}`)
                || form.querySelector('input[name*=caption]')
                || form.querySelector('input[name*=name]')
                || form.querySelector('input[type=text]');
            if (!nameInput || !nameInput.name) {
                err(`(${vehicleId}) no usable name <input> (with a "name" attribute) found. Form HTML:`, form.outerHTML);
                return false;
            }

            const action = form.getAttribute('action') || `/vehicles/${vehicleId}`;
            const url = new URL(action, location.origin);

            const body = new URLSearchParams();
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
                if (el === nameInput) return;
                if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
                body.append(el.name, el.value);
            });
            body.append(nameInput.name, trimmed);

            log(`(${vehicleId}) posting to ${url.pathname} ...`);
            let res;
            try {
                res = await fetchWithTimeout(url.toString(), {
                    method: 'POST', // Rails method-override (_method=patch) still physically POSTs
                    credentials: 'same-origin',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: body.toString(),
                });
            } catch (e) {
                err(`(${vehicleId}) rename POST failed/timed out`, e);
                return false;
            }
            if (!res.ok) {
                err(`(${vehicleId}) rename POST returned HTTP ${res.status}`);
                return false;
            }

            // Verify: re-fetch the vehicle and confirm the caption actually changed
            // server-side, rather than just trusting a 200 status.
            try {
                const fresh = await getVehicle(vehicleId);
                if (fresh && fresh.caption === trimmed) {
                    log(`(${vehicleId}) confirmed: caption is now "${trimmed}"`);
                    return true;
                }
                err(`(${vehicleId}) POST succeeded but caption is still "${fresh && fresh.caption}" (expected "${trimmed}") — the form field name may be wrong for this site version.`);
                return false;
            } catch (e) {
                warn(`(${vehicleId}) could not verify rename (network error on re-fetch), assuming it worked since POST returned OK`, e);
                return true;
            }
        }

        /* ========================================================================
         * MAIN ENGINE
         * ==================================================================== */
        const renameQueue = [];
        let queueRunning = false;
        let queueTotal = 0;
        let queueDone = 0;
        let queueFailed = 0;

        // What the dashboard shows. captionById is refreshed on every scan.
        const captionById = new Map();
        const planned = new Map();   // dry run: vehicleId -> { from, to }
        const recent = [];           // last renames: { id, from, to, at, ok }
        const stats = { vehicles: 0, lastScan: 0, scanning: false };

        function enqueueRename(vehicleId, name) {
            if (CONFIG.DRY_RUN) {
                planned.set(vehicleId, { from: captionById.get(vehicleId) || '', to: name });
                return;
            }
            if (renameQueue.some((q) => q.vehicleId === vehicleId)) return;
            renameQueue.push({ vehicleId, name });
            queueTotal++;
            if (!queueRunning) runQueue();
        }

        async function runQueue() {
            queueRunning = true;
            while (renameQueue.length) {
                const { vehicleId, name } = renameQueue.shift();
                setStatus(`Hernoemen ${queueDone + 1}/${queueTotal}: ${name}`, 'busy', [queueDone, queueTotal]);
                try {
                    const ok = await renameVehicleInGame(vehicleId, name);
                    recent.unshift({ id: vehicleId, from: captionById.get(vehicleId) || '', to: name, at: Date.now(), ok });
                    recent.length = Math.min(recent.length, 100);
                    if (ok) captionById.set(vehicleId, name);
                    if (ok) { log(`renamed vehicle ${vehicleId} -> "${name}"`); queueDone++; }
                    else { queueFailed++; }
                } catch (e) {
                    err(`failed to rename vehicle ${vehicleId}`, e);
                    queueFailed++;
                }
                ctx.refresh();
                await new Promise((r) => setTimeout(r, CONFIG.RENAME_THROTTLE_MS));
            }
            queueRunning = false;
            queueTotal = 0; queueDone = 0; queueFailed = 0;
            idleStatus();
            persistAll();
            ctx.refresh();
        }

        async function fullScan() {
            if (!hasMemory) return memoryMissing();
            if (stats.scanning) return;
            stats.scanning = true;
            setStatus('Controleren…', 'busy');
            if (CONFIG.DRY_RUN) planned.clear();
            try { await fullScanInner(); } finally { stats.scanning = false; }
            if (!queueRunning) idleStatus();
            ctx.refresh();
        }

        async function fullScanInner() {
            log('running full scan...');
            let vehicles, buildings;
            try {
                [vehicles, buildings] = await Promise.all([getVehicles(), getBuildings()]);
            } catch (e) {
                err('could not fetch /api/vehicles or /api/buildings', e);
                setStatus(`Kon voertuigen niet ophalen: ${e.message}`, 'error');
                return;
            }
            ovrLog = {}; // rebuilt fresh each full pass so fixed vehicles drop off the log

            const buildingsById = {};
            for (const b of buildings) buildingsById[b.id] = b;

            const vehiclesByBuilding = {};
            for (const v of vehicles) {
                (vehiclesByBuilding[v.building_id] = vehiclesByBuilding[v.building_id] || []).push(v);
            }

            // Self-heal: clear any persisted "exact" assignment whose role no longer
            // matches the vehicle's classified type. Fixes vehicles that were
            // mislabeled with an unrelated real callsign by the old "grab any
            // leftover real slot" fallback (e.g. a hoogwerker labeled "DB") — only
            // touches the specific vehicles actually affected, not the whole fleet.
            let mismatchFixed = 0;
            for (const vehicle of vehicles) {
                const a = assignments[vehicle.id];
                if (!a || !a.exact) continue;
                const building = buildingsById[vehicle.building_id];
                if (!building || classifyDiscipline(building.building_type) !== 'fire') continue;
                const parsed = parseFireCallsign(a.name);
                if (!parsed) continue;
                const rule = classifyFireVehicle(resolveTypeCaption(vehicle), vehicle.caption || '', vehicle.vehicle_type);
                if (rule && parsed.typeDigit !== rule.digit) {
                    delete assignments[vehicle.id];
                    mismatchFixed++;
                }
            }
            if (mismatchFixed) log(`cleared ${mismatchFixed} mismatched real-callsign assignment(s), will recompute below`);

            // Self-heal pass #2: any vehicle *currently named* with a leftover "OVR"
            // from an older version of this script gets its stored assignment wiped
            // so it's re-evaluated fresh below — this picks up the 63 known-good
            // vehicles via MANUAL_VEHICLE_OVERRIDES automatically. Anything else
            // that's genuinely unrecoverable (no manual override, no usable type
            // text) will show up in the unclassified log so you know it needs
            // attention rather than silently staying wrong forever.
            // Police heli's named by an older version (base name, lowercase "Zulu")
            // get their stored name dropped so they pick up a ZULU list name.
            for (const vehicle of vehicles) {
                const a = assignments[vehicle.id];
                if (Number(vehicle.vehicle_type) === POLICE_HELI_TYPE_ID && a && !POLICE_HELI_LIST.includes(a.name)) delete assignments[vehicle.id];
            }

            let ovrNamedFound = 0;
            for (const vehicle of vehicles) {
                if (/\bOVR(-\d+)?$/i.test(vehicle.caption || '')) {
                    ovrNamedFound++;
                    delete assignments[vehicle.id];
                }
            }
            if (ovrNamedFound) log(`found ${ovrNamedFound} vehicle(s) still named with a leftover "OVR" — re-evaluating them now`);

            const usedNames = new Set(vehicles.map((v) => v.caption));
            const captionCount = countCaptions(vehicles);
            const adopted = new Set();
            captionById.clear();
            vehicles.forEach((v) => captionById.set(v.id, v.caption));
            stats.vehicles = vehicles.length;
            stats.lastScan = Date.now();

            let renameCount = 0;
            for (const building of buildings) {
                const vehiclesHere = (vehiclesByBuilding[building.id] || []).slice().sort((a, b) => a.id - b.id);
                for (const vehicle of vehiclesHere) {
                    const existing = assignments[vehicle.id];

                    // Already has a stable assignment and the in-game name matches it -> nothing to do.
                    if (existing && existing.name === vehicle.caption) continue;

                    let target;
                    if (existing) {
                        // Re-apply a previously computed assignment (self-healing).
                        // Still register it in usedNames — a reused assignment
                        // whose rename hasn't landed in-game yet wasn't otherwise
                        // accounted for, and a different vehicle computing a fresh
                        // name later in this same pass could collide with it.
                        target = existing;
                        usedNames.add(target.name);
                    } else {
                        target = computeTarget(building, vehicle, vehiclesHere);
                        if (!target) {
                            recordUnclassified(building, vehicle);
                            continue; // can't work out its role -> leave it exactly as-is
                        }
                        target = adoptOrUnique(target, vehicle, usedNames, captionCount, adopted);
                        target.building = building.id;
                        assignments[vehicle.id] = target;
                    }

                    if (target.name !== vehicle.caption) {
                        enqueueRename(vehicle.id, target.name);
                        renameCount++;
                    }
                }
            }

            // Explicit final audit: guarantee no two vehicles ever end up sharing
            // a name, even if some path above missed a collision. Belt-and-braces
            // on top of the ensureUnique() checks during assignment above.
            const finalNameOwner = new Map(); // name -> vehicleId
            let duplicatesFixed = 0;
            for (const vehicle of vehicles) {
                const a = assignments[vehicle.id];
                const finalName = a ? a.name : vehicle.caption;
                const owner = finalNameOwner.get(finalName);
                if (owner === undefined) {
                    finalNameOwner.set(finalName, vehicle.id);
                } else if (owner !== vehicle.id) {
                    const fixed = ensureUnique(finalName, usedNames);
                    warn(`duplicate name "${finalName}" on vehicles ${owner} and ${vehicle.id} — reassigned the latter to "${fixed}"`);
                    assignments[vehicle.id] = { ...(a || {}), name: fixed, building: vehicle.building_id };
                    finalNameOwner.set(fixed, vehicle.id);
                    if (fixed !== vehicle.caption) { enqueueRename(vehicle.id, fixed); renameCount++; }
                    duplicatesFixed++;
                }
            }
            if (duplicatesFixed) log(`duplicate-name audit: found and fixed ${duplicatesFixed} collision(s)`);

            knownVehicleIds = vehicles.map((v) => v.id);
            persistAll();
            log(`full scan complete — ${renameCount} vehicle(s) queued for rename`);
            if (CONFIG.DEBUG) printOvrLog();
        }

        async function pollNewVehicles() {
            if (!hasMemory || stats.scanning) return;
            let vehicles;
            try {
                vehicles = await getVehicles();
            } catch (e) {
                err('poll: could not fetch /api/vehicles', e);
                return;
            }
            const known = new Set(knownVehicleIds);
            const fresh = vehicles.filter((v) => !known.has(v.id));
            if (!fresh.length) return;

            log(`found ${fresh.length} newly bought vehicle(s)`);
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('poll: could not fetch /api/buildings', e);
                return;
            }
            const buildingsById = {};
            for (const b of buildings) buildingsById[b.id] = b;

            const vehiclesByBuilding = {};
            for (const v of vehicles) {
                (vehiclesByBuilding[v.building_id] = vehiclesByBuilding[v.building_id] || []).push(v);
            }
            const usedNames = new Set(vehicles.map((v) => v.caption));
            const captionCount = countCaptions(vehicles);
            const adopted = new Set();
            vehicles.forEach((v) => captionById.set(v.id, v.caption));
            stats.vehicles = vehicles.length;

            for (const vehicle of fresh) {
                const building = buildingsById[vehicle.building_id];
                if (!building) continue;
                const vehiclesHere = (vehiclesByBuilding[building.id] || []).sort((a, b) => a.id - b.id);
                let target = computeTarget(building, vehicle, vehiclesHere);
                if (!target) { recordUnclassified(building, vehicle); continue; }
                target = adoptOrUnique(target, vehicle, usedNames, captionCount, adopted);
                target.building = building.id;
                assignments[vehicle.id] = target;
                if (target.name !== vehicle.caption) enqueueRename(vehicle.id, target.name);
            }

            knownVehicleIds = vehicles.map((v) => v.id);
            persistAll();
            if (CONFIG.DEBUG) printOvrLog();
            ctx.refresh();
        }

        /* ========================================================================
         * DASHBOARD
         * ==================================================================== */
        function setStatus(text, tone = 'idle', progress) {
            // Only busy/error states go to the dock; idle stays in the dashboard.
            ctx.status(text, { tone, progress, dock: tone === 'busy' || tone === 'error' });
            if (CONFIG.DEBUG) log('status:', text);
        }

        function idleStatus() {
            if (!hasMemory) return memoryMissing();
            const unknown = Object.keys(ovrLog).length;
            const when = stats.lastScan ? new Date(stats.lastScan).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
            setStatus(`${stats.vehicles} voertuigen in orde · controle ${when}${unknown ? ` · ${unknown} onbekend` : ''}`, unknown ? 'warn' : 'ok');
        }

        function memoryMissing() {
            setStatus('Wacht: geheugen van het oude script ontbreekt', 'warn');
        }

        const esc = ctx.esc;
        const table = (head, rows) => `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        const vLink = (id, text) => `<a href="/vehicles/${id}" target="_blank">${esc(text)}</a>`;

        ctx.panel((el) => {
            const unknown = Object.values(ovrLog);
            const failed = recent.filter((r) => !r.ok).length;
            let html = `<h4 class="mks-h">Stand</h4><div class="mks-tiles">
                <div class="mks-tile"><div class="v">${ctx.nl(stats.vehicles)}</div><div class="k">voertuigen</div></div>
                <div class="mks-tile"><div class="v">${renameQueue.length}</div><div class="k">in wachtrij</div></div>
                <div class="mks-tile"><div class="v">${recent.filter((r) => r.ok).length}</div><div class="k">hernoemd (deze sessie)</div></div>
                <div class="mks-tile ${failed ? 't-error' : ''}"><div class="v">${failed}</div><div class="k">mislukt</div></div>
                <div class="mks-tile ${unknown.length ? 't-warn' : ''}"><div class="v">${unknown.length}</div><div class="k">rol onbekend</div></div>
            </div>`;

            if (recent.length) {
                html += '<h4 class="mks-h">Laatst hernoemd</h4>' + table(['Tijd', 'Was', 'Nu', ''], recent.slice(0, 50).map((r) => `<tr>
                    <td class="mono">${new Date(r.at).toLocaleTimeString('nl-NL')}</td><td>${esc(r.from)}</td><td>${vLink(r.id, r.to)}</td>
                    <td>${r.ok ? '<span class="mks-pill t-ok">ok</span>' : '<span class="mks-pill t-error">mislukt</span>'}</td></tr>`));
            }

            if (unknown.length) {
                html += `<h4 class="mks-h">Rol onbekend (${unknown.length})</h4>
                    <p class="mks-note">Deze voertuigen blijven ongemoeid: hun type kon niet aan een rol gekoppeld worden.
                    Kopieer de lijst en geef hem aan Claude om ze toe te voegen.</p>`
                    + table(['Voertuig', 'Gebouw', 'Type', 'Type-id'], unknown.map((u) => `<tr><td>${vLink(u.vehicleId, u.currentName)}</td>
                        <td>${esc(u.building)}</td><td>${esc(u.typeCaption)}</td><td class="mono">${esc(u.vehicleTypeId)}</td></tr>`));
            }
            el.innerHTML = html;
        });

        if (hasMemory) {
            ctx.actions([
                { label: 'Nu controleren', kind: 'primary', run: () => fullScan(), title: 'Alle voertuigen nalopen' },
                { label: 'Kopieer onbekende (JSON)', run: async () => {
                    const text = JSON.stringify(Object.values(ovrLog), null, 2);
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
            ]);
        }

        // Proefdraaien toggled: rescan so the preview (or the real renames)
        // follows right away. New timings apply after a reload.
        ctx.onSettings(() => {
            {
                idleStatus();
            }
        });

        /* ========================================================================
         * BOOT
         * ==================================================================== */
        log('starting — DRY_RUN =', CONFIG.DRY_RUN);
        if (!hasMemory) {
            memoryMissing();
            return;
        }
        fullScan();
        setInterval(pollNewVehicles, CONFIG.POLL_NEW_VEHICLES_MS);
        setInterval(fullScan, CONFIG.FULL_RESCAN_MS);
    },
});

/* ==== module: building-namer ============================================== */
MKS.module({
    id: 'building-namer',
    name: 'Gebouwnamen',
    short: 'Gebouwnamen',
    icon: '🏢',
    category: 'names',
    description: 'Geeft je kazernes, posten en bureaus hun echte Nederlandse naam (en waar bekend de echte post-/regionummering). '
        + 'Nooit dubbele namen: bij een botsing blijft het gebouw ongemoeid. Ziekenhuizen en meldkamers worden niet hernoemd.',
    warning: '<b>Werk in uitvoering. Hernoemen kan niet ongedaan worden gemaakt.</b> Zodra je dit aanzet, verandert het de namen van je gebouwen '
        + 'in het spel zelf. De oude namen worden nergens bewaard. De namenlijst is nog niet af en kan in een volgende versie weer veranderen.',
    confirmOn: 'Let op: dit hernoemt direct je gebouwen in het spel.\n\nDat kan NIET ongedaan worden gemaakt: de oude namen worden niet bewaard. '
        + 'Het script is nog in ontwikkeling.\n\nToch aanzetten?',
    at: 'load',
    frames: 'top',
    settings: [
        { key: 'osmCheck', label: 'Controleren met OpenStreetMap', type: 'bool', default: true,
            help: 'Vergelijkt namen met OSM (Nominatim) en toont verschillen hieronder. Verandert zelf nooit iets. Max. 1 verzoek per seconde.' },
        { key: 'pollMin', label: 'Zoeken naar nieuwe gebouwen', type: 'number', default: 1, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rescanMin', label: 'Volledige controle', type: 'number', default: 30, min: 5, max: 240, step: 5, unit: 'min' },
        { key: 'throttleSec', label: 'Pauze tussen hernoemingen', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.5, unit: 'sec' },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG — read this first
         * ====================================================================
         * DRY_RUN starts as `true` on purpose: the very first run only PRINTS
         * what it would rename in the console (F12), nothing is touched
         * in-game. Check the console, then set DRY_RUN to false.
         *
         * Reference data here is only as complete as what could be sourced:
         * Utrecht (09) and the handful of Gelderland-Midden (07) fire stations
         * have exact real post numbers (borrowed from the vehicle namer's own
         * roepnummer reference sheet — those post numbers ARE real). Everywhere
         * else, and every non-fire discipline, only gets the real PLACE name
         * (no fabricated post number) since a verified nationwide address/post
         * list wasn't available to build this from. Extend the dictionaries
         * below as you learn more real names — see PLACE_DISPLAY_NAME.
         *
         * Rename mechanism confirmed via live devtools capture (not guessed):
         * GET /buildings/:id/edit returns a normal Rails edit form
         * (#edit_building_:id, action /buildings/:id, method POST with a
         * hidden _method=patch field), name field is #building_name /
         * name="building[name]". We fetch that form off-screen, copy every
         * field (including the CSRF token), swap in the new name, and POST it
         * ourselves — never touching the live DOM, so it can't get killed by a
         * real page navigation.
         * ==================================================================== */
        const CONFIG = {
            DRY_RUN: false,
            get DEBUG() { return !!ctx.cfg.debug; },
            get POLL_NEW_BUILDINGS_MS() { return ctx.cfg.pollMin * 60000; },
            get FULL_RESCAN_MS() { return ctx.cfg.rescanMin * 60000; },
            get RENAME_THROTTLE_MS() { return ctx.cfg.throttleSec * 1000; },
            REQUEST_TIMEOUT_MS: 10 * 1000,
            MAX_NAME_LENGTH: 150,

            // Crosschecks every computed building name against OpenStreetMap
            // (Nominatim, free/no API key) and logs disagreements for you to
            // review — it NEVER changes what gets renamed in-game by itself.
            // Nominatim's usage policy caps this at ~1 request/sec and requires
            // an identifying User-Agent, both handled below.
            get ENABLE_OSM_CROSSCHECK() { return !!ctx.cfg.osmCheck; },
            OSM_THROTTLE_MS: 1100,
            OSM_REQUEST_TIMEOUT_MS: 12 * 1000,
        };

        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[BuildingNamer]', 'color:#07a', ...a); };
        const warn = (...a) => console.warn('[BuildingNamer]', ...a);
        const err = (...a) => console.error('[BuildingNamer]', ...a);

        /* ========================================================================
         * PERSISTENT STORAGE (separate GM keys from the vehicle namer, so the two
         * scripts never step on each other)
         * ==================================================================== */
        const store = {
            get(key, def) {
                try {
                    const v = GM_getValue(key, undefined);
                    return v === undefined ? def : JSON.parse(v);
                } catch (e) { return def; }
            },
            set(key, val) {
                try { GM_setValue(key, JSON.stringify(val)); } catch (e) { warn('store.set failed', key, e); }
            },
        };

        // No stored assignments = the old standalone script's memory wasn't
        // imported. Wait until the user imports it or starts fresh.
        const hasMemory = true;

        const DATA_VERSION = 4; // bumped: shorter names (length cap), fixed double-prefix bug, DRY_RUN off
        let assignments = store.get('bn_assignments', {}); // buildingId -> { name }
        let knownBuildingIds = store.get('bn_knownBuildingIds', []);
        let unclassifiedLog = store.get('bn_unclassifiedLog', {});
        let osmCache = store.get('bn_osmCache', {}); // query string -> { result, ts } — never expires, Nominatim data is stable enough and this avoids re-querying every scan
        let osmCrosscheckLog = store.get('bn_osmCrosscheckLog', {}); // buildingId -> crosscheck verdict

        const storedDataVersion = store.get('bn_dataVersion', 0);
        if (storedDataVersion !== DATA_VERSION) {
            log(`data version changed (${storedDataVersion} -> ${DATA_VERSION}) — clearing stored assignments for a full recheck`);
            assignments = {};
            store.set('bn_dataVersion', DATA_VERSION);
        }

        function persistAll() {
            store.set('bn_assignments', assignments);
            store.set('bn_knownBuildingIds', knownBuildingIds);
            store.set('bn_unclassifiedLog', unclassifiedLog);
            store.set('bn_osmCache', osmCache);
            store.set('bn_osmCrosscheckLog', osmCrosscheckLog);
        }

        // computeTarget() returns null for two very different reasons: a
        // genuinely unmapped building_type (worth logging — tell Claude about
        // it) vs. a recognized NO_RENAME_DISCIPLINES type we deliberately never
        // touch (hospitals, meldkamers, ...). Only the first should show up in
        // the unclassified log — otherwise every hospital/meldkamer/kazerne
        // would spam it every single scan for no reason.
        function isDeliberatelySkipped(building) {
            const discipline = classifyDiscipline(building.building_type);
            return !!discipline && NO_RENAME_DISCIPLINES.has(discipline);
        }

        function recordUnclassified(building, reason) {
            unclassifiedLog[building.id] = { buildingId: building.id, currentName: building.caption, buildingType: building.building_type, reason };
        }
        function printUnclassifiedLog() {
            const rows = Object.values(unclassifiedLog);
            if (!rows.length) { log('nothing left unclassified.'); return; }
            console.log(`%c[BuildingNamer] ${rows.length} building(s) left untouched:`, 'color:#e90');
            console.table(rows);
            console.log('[BuildingNamer] copy/paste this to Claude:\n' + JSON.stringify(rows, null, 2));
        }

        /* ========================================================================
         * TEXT HELPERS (same normalization rules as the vehicle namer, so both
         * scripts recognize the same building captions the same way)
         * ==================================================================== */
        function normalize(s) {
            return (s || '')
                .toString()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[()]/g, ' ')
                .replace(/[^a-z0-9\- ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        const PREFIX_WORDS = [
            'brandweerkazerne', 'brandweerpost', 'brandweer kazerne', 'brandweer post', 'brandweer',
            'ambulance standplaats', 'ambulancepost', 'standplaats', 'ambulance',
            'politiebureau', 'politiepost', 'politie hoofdbureau', 'politie',
            'ravu', 'rav', 'kazerne',
            // Labels this script writes itself, so a rescan of its own output
            // doesn't stack another label on top ("Vliegbasis Vliegbasis ...").
            'vliegbasis', 'rws steunpunt', 'rws',
        ];
        // Place keys are written with hyphens ("utrecht-leidsche rijn") but the
        // display name can use spaces ("Utrecht Leidsche Rijn"); compare both
        // forms the same so a renamed building still finds its own entry.
        const foldHyphens = (s) => s.replace(/-/g, ' ');
        function stripPrefix(normCaption) {
            let out = normCaption;
            // Strip a leading regio/post code the script itself writes ("09 ",
            // "09-59 ", "06 ") BEFORE matching label words, else a name this
            // script already generated (e.g. "09 Ambulancepost Amersfoort
            // Noord") never matches ^ambulancepost — "09" is in the way — and
            // every rescan bolts another label on top. Confirmed live: produced
            // "09 Ambulancepost 09 Ambulancepost Amersfoort Noord".
            out = out.replace(/^\d{2}(-\d+)?\s+/, '');
            let changed = true;
            while (changed) {
                changed = false;
                for (const w of PREFIX_WORDS) {
                    const re = new RegExp('^' + w + '\\s+');
                    if (re.test(out)) { out = out.replace(re, '').trim(); changed = true; }
                }
            }
            return out;
        }

        function wordBoundaryIncludes(haystack, needle) {
            if (!needle) return false;
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])');
            return re.test(' ' + haystack + ' ');
        }

        function titleCase(normPlace) {
            return normPlace
                .split(' ')
                .map((w) => w.split('-').map((p) => p ? p[0].toUpperCase() + p.slice(1) : p).join('-'))
                .join(' ');
        }

        /* ========================================================================
         * REFERENCE DATA — real place -> regio (25 official Veiligheidsregio's)
         * Same table as the vehicle namer.
         * ==================================================================== */
        const PLACE_TO_REGIO = {
            'amersfoort-centrum': '09', 'amersfoort-noord': '09', 'amersfoort n-oost': '09', 'amersfoort': '09',
            'baarn': '09', 'bunschoten': '09', 'bunnik': '09', 'werkhoven': '09', 'bilthoven': '09',
            'de bilt': '09', 'groenekan': '09', 'maartensdijk': '09', 'westbroek': '09', 'abcoude': '09',
            'mijdrecht': '09', 'vinkeveen': '09', 'wilnis': '09', 'eemnes': '09', 'houten': '09',
            'houten-oost': '09', 'houten-west': '09', 'schalkwijk': '09', 'ijsselstein': '09',
            'achterveld': '09', 'leusden': '09', 'benschop': '09', 'lopik': '09', 'linschoten': '09',
            'montfoort': '09', 'nieuwegein': '09', 'oudewater': '09', 'renswoude': '09', 'elst': '09',
            'rhenen': '09', 'rhenen-achterberg': '09', 'soest': '09', 'soesterberg': '09', 'breukelen': '09',
            'kockengen': '09', 'loenen': '09', 'maarssen': '09', 'nieuwer ter aa': '09', 'nigtevecht': '09',
            'de meern': '09', 'utrecht': '09', 'vleuten': '09', 'amerongen': '09', 'driebergen': '09',
            'doorn': '09', 'leersum': '09', 'maarn-maarsbergen': '09', 'maarn': '09', 'veenendaal': '09',
            'hagestein': '09', 'vianen': '09', 'wijk bij duurstede': '09', 'harmelen': '09', 'kamerik': '09',
            'woerden': '09', 'zegveld': '09', 'woudenberg': '09', 'den dolder': '09', 'zeist': '09',
            'ameide': '09', 'leerdam': '09', 'lexmond': '09', 'meerkerk': '09', 'schoonrewoerd': '09',
            'nieuwegein-noord': '09', 'nieuwegein-zuid': '09',

            'apeldoorn': '06', 'harderwijk': '06', 'putten': '06', 'nunspeet': '06', 'elburg': '06',
            'epe': '06', 'oldebroek': '06', 'hattem': '06', 'zutphen': '06', 'doetinchem': '06',
            'winterswijk': '06', 'lochem': '06', 'voorst': '06', 'garderen': '06',

            'ede': '07', 'ederveen': '07', 'nijkerk': '07', 'scherpenzeel': '07', 'otterlo': '07',
            'barneveld': '07', 'arnhem': '07', 'wageningen': '07', 'renkum': '07', 'de valk': '07',

            'nijmegen': '08', 'tiel': '08', 'zaltbommel': '08', 'wijchen': '08', 'culemborg': '08',

            'groningen': '01', 'leeuwarden': '02', 'assen': '03', 'zwolle': '04', 'enschede': '05',
            'hilversum': '14', 'alkmaar': '10', 'den helder': '10', 'zaandam': '11', 'purmerend': '11',
            'haarlem': '12', 'haarlemmermeer': '12', 'schiphol': '12', 'ijmuiden': '12',
            'amsterdam': '13', 'amstelveen': '13', 'den haag': '15', 's-gravenhage': '15', 'delft': '15',
            'leiden': '16', 'alphen aan den rijn': '16', 'gouda': '16', 'rotterdam': '17', 'schiedam': '17',
            'dordrecht': '18', 'gorinchem': '18', 'middelburg': '19', 'vlissingen': '19', 'goes': '19',
            'breda': '20', 'tilburg': '20', 'den bosch': '21', 's-hertogenbosch': '21', 'oss': '21',
            'eindhoven': '22', 'helmond': '22', 'venlo': '23', 'roermond': '23', 'maastricht': '24',
            'heerlen': '24', 'sittard': '24', 'almere': '25', 'lelystad': '25',
        };

        // "Display" spelling for a place — real, properly capitalized official
        // kazerne-list spelling (source: brandweer.nl/utrecht/kazernes/ and the
        // vehicle namer's own Utrecht roepnummer reference sheet). Falls back to
        // naive title-casing for anything not listed here.
        const PLACE_DISPLAY_NAME = {
            'amersfoort-centrum': 'Amersfoort-Centrum', 'amersfoort-noord': 'Amersfoort-Noord',
            'baarn': 'Baarn', 'bunschoten': 'Bunschoten', 'bunnik': 'Bunnik', 'werkhoven': 'Werkhoven',
            'bilthoven': 'Bilthoven', 'de bilt': 'De Bilt', 'groenekan': 'Groenekan', 'maartensdijk': 'Maartensdijk',
            'westbroek': 'Westbroek-Tienhoven', 'abcoude': 'Abcoude', 'mijdrecht': 'Mijdrecht', 'vinkeveen': 'Vinkeveen',
            'wilnis': 'Wilnis', 'eemnes': 'Eemnes', 'houten': 'Houten', 'houten-oost': 'Houten-Oost',
            'schalkwijk': 'Schalkwijk', 'ijsselstein': 'IJsselstein', 'achterveld': 'Achterveld', 'leusden': 'Leusden',
            'benschop': 'Benschop', 'lopik': 'Lopik', 'linschoten': 'Linschoten', 'montfoort': 'Montfoort',
            'oudewater': 'Oudewater', 'renswoude': 'Renswoude', 'elst': 'Rhenen-Elst', 'rhenen': 'Rhenen',
            'rhenen-achterberg': 'Rhenen-Achterberg', 'soest': 'Soest', 'soesterberg': 'Soesterberg',
            'breukelen': 'Breukelen', 'kockengen': 'Kockengen', 'loenen': 'Loenen aan de Vecht', 'maarssen': 'Maarssen',
            'nieuwer ter aa': 'Nieuwer ter Aa', 'nigtevecht': 'Nigtevecht', 'de meern': 'De Meern', 'utrecht': 'Utrecht',
            'vleuten': 'Vleuten', 'amerongen': 'Amerongen', 'driebergen': 'Driebergen', 'doorn': 'Doorn',
            'leersum': 'Leersum', 'maarn-maarsbergen': 'Maarn-Maarsbergen', 'maarn': 'Maarn', 'veenendaal': 'Veenendaal',
            'hagestein': 'Hagestein', 'vianen': 'Vianen', 'wijk bij duurstede': 'Wijk bij Duurstede',
            'harmelen': 'Harmelen', 'kamerik': 'Kamerik', 'woerden': 'Woerden', 'zegveld': 'Zegveld',
            'woudenberg': 'Woudenberg', 'den dolder': 'Den Dolder', 'zeist': 'Zeist', 'ameide': 'Ameide',
            'leerdam': 'Leerdam', 'lexmond': 'Lexmond', 'meerkerk': 'Meerkerk', 'schoonrewoerd': 'Schoonrewoerd',
            'nieuwegein-noord': 'Nieuwegein-Noord', 'nieuwegein-zuid': 'Nieuwegein-Zuid',
            'utrecht-leidsche rijn': 'Utrecht Leidsche Rijn', 'utrecht-schepenbuurt': 'Utrecht Schepenbuurt',
            'utrecht-tolsteeg': 'Utrecht Tolsteeg',
            'ede': 'Ede', 'ederveen': 'Ederveen', 'nijkerk': 'Nijkerk', 'scherpenzeel': 'Scherpenzeel',
            'otterlo': 'Otterlo', 'garderen': 'Garderen', 'de valk': 'De Valk',
        };

        function displayPlaceName(stripped) {
            if (PLACE_DISPLAY_NAME[stripped]) return PLACE_DISPLAY_NAME[stripped];
            for (const [norm, disp] of Object.entries(PLACE_DISPLAY_NAME)) {
                if (foldHyphens(norm) === foldHyphens(stripped)) return disp;
            }
            for (const [norm, disp] of Object.entries(PLACE_DISPLAY_NAME)) {
                if (wordBoundaryIncludes(stripped, norm) || wordBoundaryIncludes(norm, stripped)) return disp;
            }
            return titleCase(stripped);
        }

        function regioForBuilding(building) {
            const stripped = stripPrefix(normalize(building.caption));
            if (PLACE_TO_REGIO[stripped]) return PLACE_TO_REGIO[stripped];
            let best = null;
            for (const place of Object.keys(PLACE_TO_REGIO)) {
                if (wordBoundaryIncludes(stripped, place) || wordBoundaryIncludes(place, stripped)) {
                    if (!best || place.length > best.length) best = place;
                }
            }
            return best ? PLACE_TO_REGIO[best] : null;
        }

        /* ========================================================================
         * REFERENCE DATA — exact real Utrecht (09) / Gelderland-Midden (07) fire
         * post numbers, borrowed straight from the vehicle namer's own verified
         * roepnummer sheet. Only used to recover the real 2-digit POST code
         * (e.g. "09-32 ...") — the vehicle labels themselves aren't needed here.
         * ==================================================================== */
        const UTRECHT_FIRE_STATIONS = {
            "Amersfoort-Centrum": ["09-0101"], "Amersfoort-Noord": ["09-0231"], "Baarn": ["09-0301"],
            "Bunschoten": ["09-0401"], "Bunnik": ["09-0501"], "Werkhoven": ["09-0601"], "Bilthoven": ["09-0701"],
            "De Bilt": ["09-0801"], "Groenekan": ["09-0931"], "Maartensdijk": ["09-1034"], "Westbroek": ["09-1131"],
            "Abcoude": ["09-1201"], "Mijdrecht": ["09-1311"], "Vinkeveen": ["09-1401"], "Wilnis": ["09-1501"],
            "Eemnes": ["09-1601"], "Houten": ["09-1731"], "Schalkwijk": ["09-1901"], "IJsselstein": ["09-2001"],
            "Achterveld": ["09-2101"], "Leusden": ["09-2231"], "Benschop": ["09-2301"], "Lopik": ["09-2401"],
            "Linschoten": ["09-2531"], "Montfoort": ["09-2601"], "Nieuwegein-Noord": ["09-2701"],
            "Nieuwegein-Zuid": ["09-2801"], "Oudewater": ["09-2901"], "Renswoude": ["09-3001"], "Elst": ["09-3134"],
            "Rhenen": ["09-3201"], "Soest": ["09-3301"], "Soest-Nevenpost": ["09-3441"], "Soesterberg": ["09-3501"],
            "Breukelen": ["09-3601"], "Kockengen": ["09-3731"], "Loenen": ["09-3801"], "Maarssen": ["09-3911"],
            "Nieuwer ter Aa": ["09-4101"], "Nigtevecht": ["09-4201"], "De Meern": ["09-4301"],
            "Utrecht-Leidsche Rijn": ["09-4401"], "Utrecht-Schepenbuurt": ["09-4501"], "Utrecht-Tolsteeg": ["09-4601"],
            "Vleuten": ["09-4701"], "Amerongen": ["09-5001"], "Driebergen": ["09-5101"], "Doorn": ["09-5201"],
            "Leersum": ["09-5301"], "Maarn-Maarsbergen": ["09-5401"], "Veenendaal": ["09-5501"],
            "Hagestein": ["09-5631"], "Vianen": ["09-5710"], "Wijk bij Duurstede": ["09-5901"], "Harmelen": ["09-6001"],
            "Kamerik": ["09-6131"], "Woerden": ["09-6210"], "Zegveld": ["09-6301"], "Woudenberg": ["09-6434"],
            "Den Dolder": ["09-6531"], "Zeist": ["09-6621"], "Ameide": ["09-6701"], "Leerdam": ["09-6801"],
            "Lexmond": ["09-6901"], "Meerkerk": ["09-7001"], "Schoonrewoerd": ["09-7101"],
        };
        const GELDERLAND_MIDDEN_FIRE_STATIONS = {
            "Ede": ["07-2701"], "Ederveen": ["07-2531"], "Nijkerk": ["07-1101"],
            "Scherpenzeel": ["07-1931"], "Garderen": ["07-1341"], "Otterlo": ["07-2341"],
        };
        const FIRE_BUILDING_ALIASES = {
            'brandweer kazerne de valk': 'de valk', 'brandweer kazerne houten': 'houten',
            'brandweer kazerne putten': 'putten', 'brandweer kazerne harderwijk': 'harderwijk',
        };

        function findFirePostCode(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const alias = FIRE_BUILDING_ALIASES[stripped];
            const tryDict = (dict, regio) => {
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (foldHyphens(nkey) === foldHyphens(stripped) || (alias && nkey === alias)) return { post: dict[key][0].split('-')[1].slice(0, 2), regio };
                }
                let best = null;
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (wordBoundaryIncludes(stripped, nkey) || wordBoundaryIncludes(nkey, stripped)) {
                        if (!best || nkey.length > best.nkey.length) best = { key, nkey };
                    }
                }
                if (best) return { post: dict[best.key][0].split('-')[1].slice(0, 2), regio };
                return null;
            };
            return tryDict(UTRECHT_FIRE_STATIONS, '09') || tryDict(GELDERLAND_MIDDEN_FIRE_STATIONS, '07') || null;
        }

        /* ========================================================================
         * REFERENCE DATA — real Dutch kazerne name/address/regio/post, parsed
         * from a community export (hulpdienstvoertuigenbenelux.nl scrape,
         * allvehicleseverlmao.txt). Covers mostly regio 01-08 (Noord/Oost-
         * Nederland) plus a handful of national heli/MMT bases; Utrecht (09)
         * already has its own verified sheet above (UTRECHT_FIRE_STATIONS).
         * key = normalize()-d place name, matched the same way building
         * captions are.
         * ==================================================================== */
        const STATION_ADDRESS_DATA = {
            "heliport amsterdam": { display: "Heliport Amsterdam", address: "Hornweg 24, 1045 AR Amsterdam", regio: null, post: null },
            "rotterdam airport": { display: "Rotterdam Airport", address: "Zestienhoven 3045 AS", regio: null, post: null },
            "vliegbasis volkel": { display: "Vliegbasis Volkel", address: "5408 SM Volkel", regio: null, post: null },
            "eelde airport": { display: "Eelde Airport", address: "Machlaan 28", regio: null, post: null },
            "leeuwarden airport": { display: "Leeuwarden Airport", address: "Keegsdijkje 7", regio: null, post: null },
            "lelystad airport": { display: "Lelystad Airport", address: "Emoeweg 16", regio: null, post: null },
            "soesterberg": { display: "Soesterberg", address: "Stemerdingweg 11-13", regio: null, post: null },
            "medisch spectrum twente": { display: "Medisch Spectrum Twente", address: "Koningstraat 1 Enschede", regio: null, post: null },
            "leek": { display: "Leek", address: "Tolberterstraat 66", regio: "01", post: "10" },
            "marum": { display: "Marum", address: "Kruisweg 40", regio: "01", post: "11" },
            "grootegast": { display: "Grootegast", address: "Rondweg 15", regio: "01", post: "12" },
            "grijpskerk": { display: "Grijpskerk", address: "Bouwhuisstraat 20", regio: "01", post: "13" },
            "oldehove": { display: "Oldehove", address: "Englumstraat 6", regio: "01", post: "13" },
            "zuidhorn": { display: "Zuidhorn", address: "Boslaan 16", regio: "01", post: "13" },
            "wehe-den hoorn": { display: "Wehe-Den Hoorn", address: "W.H. Timmermastraat 7", regio: "01", post: "14" },
            "zoutkamp": { display: "Zoutkamp", address: "Marnestraat 1", regio: "01", post: "14" },
            "baflo": { display: "Baflo", address: "Laurentiusstraat 4", regio: "01", post: "15" },
            "winsum": { display: "Winsum", address: "Meenden 2", regio: "01", post: "15" },
            "bedum": { display: "Bedum", address: "Industrieweg 15", regio: "01", post: "16" },
            "ten boer": { display: "Ten Boer", address: "Boltweg 1", regio: "01", post: "17" },
            "groningen hoofdpost": { display: "Groningen Hoofdpost", address: "Sontweg 10", regio: "01", post: "18" },
            "groningen vinkhuizen": { display: "Groningen Vinkhuizen", address: "Diamantlaan 168", regio: "01", post: "18" },
            "haren": { display: "Haren", address: "Felland Noord 2", regio: "01", post: "20" },
            "hoogezand-sappemeer": { display: "Hoogezand-Sappemeer", address: "Rembrandtlaan 8", regio: "01", post: "21" },
            "harkstede": { display: "Harkstede", address: "Dorphuisweg 30a", regio: "01", post: "22" },
            "siddeburen": { display: "Siddeburen", address: "Oudeweg 140a", regio: "01", post: "22" },
            "slochteren": { display: "Slochteren", address: "Verlende Veenlaan 1", regio: "01", post: "22" },
            "zuidbroek": { display: "Zuidbroek", address: "Europaweg 6", regio: "01", post: "23" },
            "nieuwe pekela": { display: "Nieuwe Pekela", address: "Pekelwerk 8", regio: "01", post: "24" },
            "oude pekela": { display: "Oude Pekela", address: "Burg. Snaterlaan 42", regio: "01", post: "24" },
            "veendam": { display: "Veendam", address: "Langeleegte 2E", regio: "01", post: "25" },
            "stadskanaal": { display: "Stadskanaal", address: "Veenstraat 8", regio: "01", post: "26" },
            "ter apel": { display: "Ter Apel", address: "Heemker Akkerstraat 1", regio: "01", post: "27" },
            "vlagtwedde": { display: "Vlagtwedde", address: "Nieuwe Weg 1", regio: "01", post: "27" },
            "bellingwolde": { display: "Bellingwolde", address: "Blijhamsterweg 34a", regio: "01", post: "28" },
            "bad nieuweschans": { display: "Bad Nieuweschans", address: "Noorseweg 2", regio: "01", post: "29" },
            "finsterwolde": { display: "Finsterwolde", address: "Bospad 1", regio: "01", post: "29" },
            "scheemda": { display: "Scheemda", address: "Zwaagsterweg 2e", regio: "01", post: "29" },
            "winschoten": { display: "Winschoten", address: "Molenweg 2", regio: "01", post: "29" },
            "bierum": { display: "Bierum", address: "Spijksterweg 5a", regio: "01", post: "30" },
            "delfzijl": { display: "Delfzijl", address: "Hogelandsterweg 1", regio: "01", post: "30" },
            "wagenborgen": { display: "Wagenborgen", address: "De Elzen 4", regio: "01", post: "30" },
            "woldendorp": { display: "Woldendorp", address: "A.E. Gorterweg 30", regio: "01", post: "30" },
            "appingedam": { display: "Appingedam", address: "Dijkhuizenweg 28", regio: "01", post: "31" },
            "loppersum": { display: "Loppersum", address: "Pomonaweg 3", regio: "01", post: "32" },
            "middelstum": { display: "Middelstum", address: "Delleweg 21", regio: "01", post: "32" },
            "uithuizen": { display: "Uithuizen", address: "Industrieweg 1a", regio: "01", post: "33" },
            "falck chemiepark delfzijl": { display: "Falck Chemiepark Delfzijl", address: "Oosterhorn 4e", regio: "01", post: "39" },
            "bedrijfsbrandweer cosun beet company hoogkerk": { display: "Bedrijfsbrandweer Cosun Beet Company Hoogkerk", address: "Fabriekslaan 12", regio: null, post: null },
            "bosbrandweer noord nl": { display: "Bosbrandweer Noord NL", address: "J.H. de Boerstraat 35 Niebert", regio: "01", post: "39" },
            "hoofdkantoor regio friesland": { display: "Hoofdkantoor Regio Friesland", address: "Harlingertrekweg 58 Leeuwarden", regio: null, post: null },
            "hollum": { display: "Hollum", address: "Fabrieksweg 30", regio: "02", post: "40" },
            "ameland-nes": { display: "Ameland-Nes", address: "Ballumerweg 38", regio: "02", post: "40" },
            "schiermonnikoog": { display: "Schiermonnikoog", address: "Knuppeldam 8", regio: "02", post: "41" },
            "anjum": { display: "Anjum", address: "Buorfinne 11", regio: "02", post: "42" },
            "dokkum": { display: "Dokkum", address: "Rondweg Noord 28", regio: "02", post: "42" },
            "ternaard": { display: "Ternaard", address: "Gysbert Japiksstrjitte 10", regio: "02", post: "42" },
            "damwald": { display: "Damwâld", address: "De Moarrewei 24", regio: "02", post: "43" },
            "de westereen": { display: "De Westereen", address: "Roazeloane 103,", regio: "02", post: "43" },
            "kollum": { display: "Kollum", address: "Tochmalaan 3", regio: "02", post: "44" },
            "buitenpost": { display: "Buitenpost", address: "Vaart 4", regio: "02", post: "45" },
            "drogeham": { display: "Drogeham", address: "Droegehamster Feart 6", regio: "02", post: "45" },
            "surhuisterveen": { display: "Surhuisterveen", address: "Lauwersweg 20", regio: "02", post: "45" },
            "harlingen": { display: "Harlingen", address: "Almenumerweg 4", regio: "02", post: "46" },
            "vlieland": { display: "Vlieland", address: "Willem de Vlaminghweg 43", regio: "02", post: "47" },
            "franeker": { display: "Franeker", address: "Burg. J. Dijkstraweg 13", regio: "02", post: "48" },
            "midsland": { display: "Midsland", address: "Midslander Hoofdweg 9", regio: "02", post: "49" },
            "west terschelling": { display: "West Terschelling", address: "Burg. Eschauzierstraat 51", regio: "02", post: "49" },
            "sint annaparochie": { display: "Sint Annaparochie", address: "Warmoesstraat 61", regio: "02", post: "50" },
            "marssum": { display: "Marssum", address: "Sasker van Heringawei 41", regio: "02", post: "51" },
            "menaldum": { display: "Menaldum", address: "Bitgumerdyk 17", regio: "02", post: "51" },
            "stiens": { display: "Stiens", address: "It Noarderfjild 28", regio: "02", post: "52" },
            "ferwert": { display: "Ferwert", address: "Prof. Heijmansstraat 2", regio: "02", post: "53" },
            "hallum": { display: "Hallum", address: "It Blikkelan 15", regio: "02", post: "53" },
            "bakhuizen": { display: "Bakhuizen", address: "Teeuwes de Boerstraat 23", regio: "02", post: "54" },
            "balk": { display: "Balk", address: "Herman Gorterstraat 12", regio: "02", post: "54" },
            "sloten": { display: "Sloten", address: "Wijckelerweg 171b", regio: "02", post: "54" },
            "bolsward": { display: "Bolsward", address: "Hichtumerweg 17", regio: "02", post: "56" },
            "heeg": { display: "Heeg", address: "De Draei 17", regio: "02", post: "56" },
            "ijlst": { display: "IJlst", address: "De Finne 1", regio: "02", post: "56" },
            "koudum": { display: "Koudum", address: "Tjalke van der Walstraat 32", regio: "02", post: "56" },
            "makkum": { display: "Makkum", address: "Suderseewei 1b", regio: "02", post: "56" },
            "parrega": { display: "Parrega", address: "Trekweg 116a", regio: "02", post: "56" },
            "sneek": { display: "Sneek", address: "Malta 1", regio: "02", post: "57" },
            "stavoren": { display: "Stavoren", address: "Meerweg 10", regio: "02", post: "57" },
            "witmarsum": { display: "Witmarsum", address: "Ulbe Hiemstrastrjitte 21", regio: "02", post: "57" },
            "workum": { display: "Workum", address: "Konvintsdyk 2", regio: "02", post: "57" },
            "woudsend": { display: "Woudsend", address: "Yndyksterleane 1a", regio: "02", post: "57" },
            "mantgum": { display: "Mantgum", address: "Skillaerderdyk 15", regio: "02", post: "60" },
            "wommels": { display: "Wommels", address: "Terp 31", regio: "02", post: "60" },
            "leeuwarden hoofdpost": { display: "Leeuwarden Hoofdpost", address: "Aldlânsdyk 11", regio: "02", post: "61" },
            "leeuwarden noord": { display: "Leeuwarden Noord", address: "Ludinga 1", regio: "02", post: "61" },
            "akkrum": { display: "Akkrum", address: "It Vegelinskampke 12", regio: "02", post: "63" },
            "grou": { display: "Grou", address: "Oedsmawei 17", regio: "02", post: "63" },
            "heerenveen": { display: "Heerenveen", address: "It Hege Stik 8", regio: "02", post: "64" },
            "jubbega": { display: "Jubbega", address: "Siemen Brinkmaweg 26", regio: "02", post: "64" },
            "nieuwehorne": { display: "Nieuwehorne", address: "Schoterlandseweg 69", regio: "02", post: "64" },
            "tjalleberd": { display: "Tjalleberd", address: "De Kluft 1", regio: "02", post: "64" },
            "joure": { display: "Joure", address: "Tolhuswei 6", regio: "02", post: "65" },
            "langweer": { display: "Langweer", address: "Pontdyk 1", regio: "02", post: "65" },
            "sint-nicolaasga": { display: "Sint-Nicolaasga", address: "Slotweg 15", regio: "02", post: "65" },
            "echten": { display: "Echten", address: "Middenweg 21", regio: "02", post: "66" },
            "lemmer": { display: "Lemmer", address: "Albert Koopmanstraat 1", regio: "02", post: "66" },
            "noordwolde": { display: "Noordwolde", address: "Hellingstraat 2", regio: "02", post: "67" },
            "scherpenzeel": { display: "Scherpenzeel (Frl)", address: "Grindweg 135", regio: "02", post: "67" },
            "wolvega": { display: "Wolvega", address: "Grafietstraat 1", regio: "02", post: "67" },
            "appelscha": { display: "Appelscha", address: "Industrieweg 8c", regio: "02", post: "68" },
            "haulerwijk": { display: "Haulerwijk", address: "Eikensingel 18", regio: "02", post: "68" },
            "oldeberkoop": { display: "Oldeberkoop", address: "Willinge Prinsstraat 18c", regio: "02", post: "68" },
            "oosterwolde": { display: "Oosterwolde", address: "Dertien Aprilstraat 42a", regio: "02", post: "68" },
            "beetsterzwaag": { display: "Beetsterzwaag", address: "Van Lyndenlaan 3", regio: "02", post: "69" },
            "gorredijk": { display: "Gorredijk", address: "Leitswei 3", regio: "02", post: "69" },
            "ureterp": { display: "Ureterp", address: "De Gilden 21", regio: "02", post: "69" },
            "drachten": { display: "Drachten", address: "Loswal 1", regio: "02", post: "70" },
            "oudega": { display: "Oudega", address: "Gariperwei 30", regio: "02", post: "70" },
            "burgum": { display: "Burgum", address: "Meester W.M. Oppedijk van Veenweg 24A", regio: "02", post: "71" },
            "giekerk": { display: "Giekerk", address: "Rinia van Nautaweg 4d", regio: "02", post: "71" },
            "philips drachten": { display: "Philips Drachten", address: "De Lange West 17", regio: "02", post: "75" },
            "norg": { display: "Norg", address: "Eenerstraat 69", regio: "03", post: "80" },
            "peize": { display: "Peize", address: "De Aanleg 4", regio: "03", post: "80" },
            "roden": { display: "Roden", address: "Westeresch 20", regio: "03", post: "80" },
            "veenhuizen": { display: "Veenhuizen", address: "Oude Gracht 6", regio: "03", post: "80" },
            "eelde": { display: "Eelde", address: "Burg. J.G. Legroweg 29a", regio: "03", post: "81" },
            "vries": { display: "Vries", address: "Westerstraat 26", regio: "03", post: "81" },
            "zuidlaren": { display: "Zuidlaren", address: "Havenstraat 6", regio: "03", post: "81" },
            "assen hoofdpost west": { display: "Assen Hoofdpost (west)", address: "Mien Ruysweg 1", regio: "03", post: "82" },
            "assen nevenpost": { display: "Assen Nevenpost", address: "Stelmakerstraat 28", regio: "03", post: "82" },
            "beilen": { display: "Beilen", address: "Gentiaan 34", regio: "03", post: "83" },
            "smilde": { display: "Smilde", address: "Hoofdweg 27", regio: "03", post: "83" },
            "westerbork": { display: "Westerbork", address: "Sliemkampen 2", regio: "03", post: "83" },
            "annen": { display: "Annen", address: "Spijkerboorsdijk 3", regio: "03", post: "84" },
            "gasselternijveen": { display: "Gasselternijveen", address: "Vogelshemweg 20", regio: "03", post: "84" },
            "gieten": { display: "Gieten", address: "Oelenboom 8a", regio: "03", post: "84" },
            "rolde": { display: "Rolde", address: "Grote Brink 22", regio: "03", post: "84" },
            "2e exloermond": { display: "2e Exloërmond", address: "Middenkijl 1", regio: "03", post: "85" },
            "borger": { display: "Borger", address: "IJzertijdstraat 1", regio: "03", post: "85" },
            "emmen": { display: "Emmen", address: "Nijbracht 43a", regio: "03", post: "86" },
            "emmer-compascuum": { display: "Emmer-Compascuum", address: "Kijlweg 1", regio: "03", post: "87" },
            "klazienaveen": { display: "Klazienaveen", address: "Derksweg 267", regio: "03", post: "87" },
            "schoonebeek": { display: "Schoonebeek", address: "De Pienhoek 16", regio: "03", post: "87" },
            "coevorden": { display: "Coevorden", address: "Hulsvoorderdijk 2", regio: "03", post: "88" },
            "schoonoord": { display: "Schoonoord", address: "Alle Boelensstraat 29", regio: "03", post: "88" },
            "sleen": { display: "Sleen", address: "Boelkenweg 7", regio: "03", post: "88" },
            "zweeloo": { display: "Zweeloo", address: "Burg. Tonkensstraat 5", regio: "03", post: "88" },
            "zwinderen": { display: "Zwinderen", address: "Brinkweg 5b", regio: "03", post: "88" },
            "hoogeveen": { display: "Hoogeveen", address: "Industrieweg 2", regio: "03", post: "89" },
            "noordwijk-de wijk": { display: "Noordwijk-De Wijk", address: "Zuiderkanaalweg 16", regio: "03", post: "90" },
            "ruinen": { display: "Ruinen", address: "Kloosterstraat 5", regio: "03", post: "90" },
            "ruinerwold": { display: "Ruinerwold", address: "Gieser Wildemans 1", regio: "03", post: "90" },
            "zuidwolde": { display: "Zuidwolde", address: "Industrieweg 34", regio: "03", post: "90" },
            "dwingeloo": { display: "Dwingeloo", address: "Valderseweg 77", regio: "03", post: "91" },
            "havelte": { display: "Havelte", address: "Molenweg 3a", regio: "03", post: "91" },
            "vledder": { display: "Vledder", address: "Kerkhoflaan 2", regio: "03", post: "91" },
            "meppel": { display: "Meppel", address: "Paradijsweg 1", regio: "03", post: "92" },
            "bedrijfsbrandweer forbo novilon coevorden": { display: "Bedrijfsbrandweer Forbo Novilon Coevorden", address: "De Holwert 12", regio: "03", post: "88" },
            "fokker aircraft hoogeveen": { display: "Fokker Aircraft Hoogeveen", address: "Europaweg 7903 TD", regio: "03", post: "93" },
            "bon wijster": { display: "BON Wijster", address: "Weegbrugweg 2a", regio: "03", post: "94" },
            "bedrijfsbrandweer falck emmen": { display: "Bedrijfsbrandweer FALCK Emmen", address: "Eerste Bokslootweg 17", regio: null, post: null },
            "eelde airport-03": { display: "03-XX Eelde Airport", address: "Machlaan", regio: null, post: null },
            "tt circuit assen": { display: "03-XX TT Circuit Assen", address: "De Haar", regio: null, post: null },
            "giethoorn": { display: "Giethoorn", address: "Bartus Warnersweg 1", regio: "04", post: "12" },
            "kuinre": { display: "Kuinre", address: "De Schans 2a", regio: "04", post: "12" },
            "oldemarkt": { display: "Oldemarkt", address: "Industrieweg 3", regio: "04", post: "12" },
            "steenwijk": { display: "Steenwijk", address: "Vendelweg 3", regio: "04", post: "12" },
            "vollenhove": { display: "Vollenhove", address: "De Weyert 1", regio: "04", post: "12" },
            "ijsselmuiden": { display: "IJsselmuiden", address: "Goudplevier 121", regio: "04", post: "14" },
            "kampen": { display: "Kampen", address: "Jan Ligthartstraat 9", regio: "04", post: "14" },
            "zwolle hoofdpost": { display: "Zwolle (Hoofdpost)", address: "Marsweg 39", regio: "04", post: "16" },
            "zwolle noord": { display: "Zwolle Noord", address: "Middelweg 235", regio: "04", post: "16" },
            "genemuiden": { display: "Genemuiden", address: "Stuivenbergstraat 15", regio: "04", post: "18" },
            "hasselt": { display: "Hasselt", address: "Tijlswegje 2", regio: "04", post: "18" },
            "zwartsluis": { display: "Zwartsluis", address: "Zomerdijk 41", regio: "04", post: "18" },
            "staphorst": { display: "Staphorst", address: "Gemeenteweg 36", regio: "04", post: "19" },
            "dalfsen": { display: "Dalfsen", address: "Prins Hendrikstraat 2", regio: "04", post: "20" },
            "lemelerveld": { display: "Lemelerveld", address: "Nijverheidstraat 8", regio: "04", post: "20" },
            "nieuwleusen": { display: "Nieuwleusen", address: "Westeinde 19b", regio: "04", post: "20" },
            "ommen": { display: "Ommen", address: "Schurinkstraat 44a", regio: "04", post: "22" },
            "balkbrug": { display: "Balkbrug", address: "Meppelerweg 2", regio: "04", post: "23" },
            "bergentheim": { display: "Bergentheim", address: "Kanaalweg West 65a", regio: "04", post: "23" },
            "de krim": { display: "De Krim", address: "Hoofdweg 70", regio: "04", post: "23" },
            "dedemsvaart": { display: "Dedemsvaart", address: "Hoofdvaart 51", regio: "04", post: "23" },
            "gramsbergen": { display: "Gramsbergen", address: "De Oostermaat 59b", regio: "04", post: "23" },
            "hardenberg": { display: "Hardenberg", address: "Europaweg 10", regio: "04", post: "23" },
            "slagharen": { display: "Slagharen", address: "Coevorderweg-Noord 36a", regio: "04", post: "23" },
            "olst": { display: "Olst", address: "Industrieweg 3", regio: "04", post: "25" },
            "welsum": { display: "Welsum", address: "Kapellenkamp 2", regio: "04", post: "25" },
            "wesepe": { display: "Wesepe", address: "Eikenweg 3", regio: "04", post: "25" },
            "wijhe": { display: "Wijhe", address: "Industrieweg 6", regio: "04", post: "25" },
            "heeten": { display: "Heeten", address: "IJzerweg 23", regio: "04", post: "26" },
            "heino": { display: "Heino", address: "Marktstraat 72", regio: "04", post: "26" },
            "luttenberg": { display: "Luttenberg", address: "Witte Hekke 8", regio: "04", post: "26" },
            "raalte": { display: "Raalte", address: "Aakstraat 2", regio: "04", post: "26" },
            "bathmen": { display: "Bathmen", address: "Koekendijk 9", regio: "04", post: "28" },
            "deventer": { display: "Deventer", address: "Schonenvaardersstraat 5", regio: "04", post: "28" },
            "diepenveen": { display: "Diepenveen", address: "Oranjelaan 63a", regio: "04", post: "28" },
            "opleidingscentrum bogo": { display: "OpleidingsCentrum BOGO", address: "De Netelhorst 17", regio: null, post: null },
            "hengelo centrum": { display: "Hengelo Centrum", address: "Lansinkesweg 59 Hengelo", regio: "05", post: "11" },
            "hengelo noord": { display: "Hengelo Noord", address: "Torenlaan 2a", regio: "05", post: "12" },
            "borne": { display: "Borne", address: "De Bieffel 11", regio: "05", post: "13" },
            "goor": { display: "Goor", address: "Van Kollaan 19", regio: "05", post: "14" },
            "delden": { display: "Delden", address: "De Berken 2b", regio: "05", post: "15" },
            "markelo": { display: "Markelo", address: "Schoolstraat 13a", regio: "05", post: "16" },
            "diepenheim": { display: "Diepenheim", address: "Wilsonweg 6", regio: "05", post: "17" },
            "oldenzaal": { display: "Oldenzaal", address: "Ossenmaatstraat 1", regio: "05", post: "21" },
            "losser": { display: "Losser", address: "Broekhoekweg 40", regio: "05", post: "22" },
            "denekamp": { display: "Denekamp", address: "Nordhornsestraat 66", regio: "05", post: "23" },
            "tubbergen": { display: "Tubbergen", address: "Reutummerweg 6", regio: "05", post: "24" },
            "de lutte": { display: "De Lutte", address: "Lossersestraat 16", regio: "05", post: "25" },
            "ootmarsum": { display: "Ootmarsum", address: "Laagestraat 4", regio: "05", post: "26" },
            "weerselo": { display: "Weerselo", address: "Legtenbergerstraat 3-5", regio: "05", post: "27" },
            "almelo": { display: "Almelo", address: "Henri Dunantstraat 11", regio: "05", post: "31" },
            "den ham": { display: "Den Ham", address: "Dorpsstraat 49", regio: "05", post: "34" },
            "vroomshoop": { display: "Vroomshoop", address: "Plantsoen 8", regio: "05", post: "35" },
            "vriezenveen": { display: "Vriezenveen", address: "De Zuivering 30", regio: "05", post: "36" },
            "enschede hoofdpost": { display: "Enschede Hoofdpost", address: "Spaansland 20", regio: "05", post: "41" },
            "enschede noord": { display: "Enschede Noord", address: "Lijsterstraat 15", regio: "05", post: "42" },
            "glanerbrug": { display: "Glanerbrug", address: "Heidevlinder 2a", regio: "05", post: "43" },
            "boekelo": { display: "Boekelo", address: "Verzetslaan 21", regio: "05", post: "44" },
            "haaksbergen": { display: "Haaksbergen", address: "Parallelweg 2", regio: "05", post: "45" },
            "rijssen": { display: "Rijssen", address: "Molenstalweg 17", regio: "05", post: "51" },
            "holten": { display: "Holten", address: "Eg 6", regio: "05", post: "52" },
            "hellendoorn": { display: "Hellendoorn", address: "Kasteelstraat 9", regio: "05", post: "53" },
            "nijverdal": { display: "Nijverdal", address: "Kerkstraat 140", regio: "05", post: "54" },
            "wierden": { display: "Wierden", address: "Tulpenstraat 1", regio: "05", post: "55" },
            "enter": { display: "Enter", address: "Vonderweg 2", regio: "05", post: "56" },
            "oefencentrum troned": { display: "Oefencentrum Troned", address: "Oude Vliegveldstraat", regio: "05", post: "80" },
            "bedrijfsbrandweer elementis": { display: "Bedrijfsbrandweer Elementis", address: "Langestraat 167 Delden", regio: "05", post: "82" },
            "apollo vredestein enschede": { display: "Apollo Vredestein Enschede", address: "Ingenieur Schiffstraat 370", regio: "05", post: "84" },
            "hierden": { display: "Hierden", address: "Ooster Mheenweg 6", regio: "06", post: "10" },
            "harderwijk": { display: "Harderwijk", address: "Maltezerlaan 1", regio: "06", post: "11" },
            "ermelo": { display: "Ermelo", address: "Oude Telgterweg 181", regio: "06", post: "12" },
            "wapenveld": { display: "Wapenveld", address: "W.H. van de Pollstraat 48", regio: "06", post: "13" },
            "heerde": { display: "Heerde", address: "Rhijnsburglaan 52", regio: "06", post: "14" },
            "elburg": { display: "Elburg", address: "Oostendorperstraatweg 8", regio: "06", post: "15" },
            "nunspeet": { display: "Nunspeet", address: "Elburgerweg 13", regio: "06", post: "16" },
            "elspeet": { display: "Elspeet", address: "Vierhouterweg 22a", regio: "06", post: "17" },
            "oldebroek": { display: "Oldebroek", address: "Zuiderzeestraatweg 213b", regio: "06", post: "18" },
            "wezep": { display: "Wezep", address: "Rondweg 15", regio: "06", post: "19" },
            "hattem": { display: "Hattem", address: "Verlengde Parklaan 36", regio: "06", post: "20" },
            "putten": { display: "Putten", address: "Kelnarijstraat 10", regio: "06", post: "21" },
            "epe": { display: "Epe", address: "Kweekweg 1", regio: "06", post: "22" },
            "oene": { display: "Oene", address: "Dorpsstraat 5", regio: "06", post: "23" },
            "vaassen": { display: "Vaassen", address: "Laan van Fasna 69", regio: "06", post: "24" },
            "uddel": { display: "Uddel", address: "Uttilochweg 8", regio: "06", post: "25" },
            "apeldoorn-centrum": { display: "Apeldoorn-Centrum", address: "Vosselmanstraat 203", regio: "06", post: "26" },
            "ugchelen": { display: "Ugchelen", address: "G.P. Duuringlaan 13", regio: "06", post: "27" },
            "hoog soeren": { display: "Hoog Soeren", address: "Hoog Soeren 53", regio: "06", post: "28" },
            "beekbergen": { display: "Beekbergen", address: "Van Schaffelaarweg 2", regio: "06", post: "29" },
            "hoenderloo": { display: "Hoenderloo", address: "Brinkenbergweg 6", regio: "06", post: "30" },
            "loenen": { display: "Loenen (Gld)", address: "Leeuwenbergweg 13", regio: "06", post: "31" },
            "apeldoorn de maten": { display: "Apeldoorn de Maten", address: "Beatrijsgaarde 2", regio: "06", post: "32" },
            "apeldoorn zuid": { display: "Apeldoorn Zuid", address: "Saba 6", regio: "06", post: "33" },
            "klarenbeek": { display: "Klarenbeek", address: "Klarenbeekseweg 127a", regio: "06", post: "34" },
            "terwolde": { display: "Terwolde", address: "Dorpsstraat 57", regio: "06", post: "35" },
            "twello": { display: "Twello", address: "Zuiderlaan 9", regio: "06", post: "36" },
            "voorst": { display: "Voorst", address: "Wilhelminaweg 24", regio: "06", post: "37" },
            "eerbeek": { display: "Eerbeek", address: "Smeestraat 4a", regio: "06", post: "38" },
            "brummen": { display: "Brummen", address: "Oude Eerbeekseweg 44", regio: "06", post: "39" },
            "zutphen": { display: "Zutphen", address: "Gerard Doustraat 129", regio: "06", post: "40" },
            "gorssel": { display: "Gorssel", address: "Hoofdstraat 14a", regio: "06", post: "41" },
            "laren": { display: "Laren (Gld)", address: "Zutphenseweg 22", regio: "06", post: "42" },
            "almen": { display: "Almen", address: "Binnenweg 46", regio: "06", post: "43" },
            "lochem": { display: "Lochem", address: "Albert Hahnweg 7", regio: "06", post: "44" },
            "barchem": { display: "Barchem", address: "Van Damstraat 2", regio: "06", post: "45" },
            "neede": { display: "Neede", address: "Oude Eibergseweg 20", regio: "06", post: "46" },
            "borculo": { display: "Borculo", address: "Haarloseweg 202", regio: "06", post: "47" },
            "eibergen": { display: "Eibergen", address: "Nijverheidsstraat 2", regio: "06", post: "48" },
            "ruurlo": { display: "Ruurlo", address: "Groenloseweg 10a", regio: "06", post: "49" },
            "didam": { display: "Didam", address: "Vincwijkcweg 1c", regio: "06", post: "50" },
            "s-heerenberg": { display: "'s-Heerenberg", address: "Zeddamseweg 77b", regio: "06", post: "51" },
            "wehl": { display: "Wehl", address: "Didamseweg 26", regio: "06", post: "52" },
            "doetinchem": { display: "Doetinchem", address: "Stokhorstweg 1", regio: "06", post: "53" },
            "gendringen": { display: "Gendringen", address: "Nijverheidsweg 27", regio: "06", post: "54" },
            "silvolde": { display: "Silvolde", address: "De Breide 74", regio: "06", post: "55" },
            "varsseveld": { display: "Varsseveld", address: "Klaproosstraat 28", regio: "06", post: "56" },
            "vorden": { display: "Vorden", address: "Rondweg 6", regio: "06", post: "57" },
            "steenderen": { display: "Steenderen", address: "Dr. Alfons Ariënsstraat 33c", regio: "06", post: "58" },
            "hengelo gd": { display: "Hengelo GD", address: "Zelhemseweg 27", regio: "06", post: "59" },
            "zelhem": { display: "Zelhem", address: "Industriepark 2", regio: "06", post: "60" },
            "dinxperlo": { display: "Dinxperlo", address: "Nieuwstraat 2", regio: "06", post: "61" },
            "aalten": { display: "Aalten", address: "Tramstraat 1", regio: "06", post: "62" },
            "lichtenvoorde": { display: "Lichtenvoorde", address: "Vragenderweg 5", regio: "06", post: "63" },
            "groenlo": { display: "Groenlo", address: "Oude Winterswijkseweg 22", regio: "06", post: "64" },
            "winterswijk": { display: "Winterswijk", address: "Europark 16", regio: "06", post: "65" },
            "loenen-vakbekwaamheidsplein": { display: "Loenen (Vakbekwaamheidsplein)", address: "Veldhuizen 3", regio: null, post: null },
            "bedrijfsbrandweer folding boxboard eerbeek": { display: "Bedrijfsbrandweer Folding Boxboard Eerbeek", address: "Coldenhovenseweg 12", regio: null, post: null },
            "bedrijfsbrandweer aviko steenderen": { display: "Bedrijfsbrandweer Aviko Steenderen", address: "Nijverheidsweg 6, 7221 CK Steenderen", regio: null, post: null },
            "hoofdkantoor vnog": { display: "Hoofdkantoor VNOG", address: "Europaweg 77", regio: null, post: null },
            "nijkerk": { display: "Nijkerk", address: "Havenstraat 5", regio: "07", post: "11" },
            "hoevelaken": { display: "Hoevelaken", address: "De Wel 5", regio: "07", post: "12" },
            "garderen": { display: "Garderen", address: "Oud Milligenseweg 12", regio: "07", post: "13" },
            "voorthuizen": { display: "Voorthuizen", address: "Wheemstraat 10", regio: "07", post: "14" },
            "zwartebroek": { display: "Zwartebroek", address: "Eendrachtstraat 48", regio: "07", post: "15" },
            "kootwijkerbroek": { display: "Kootwijkerbroek", address: "Drieenhuizerweg 5", regio: "07", post: "16" },
            "barneveld beekstraat": { display: "Barneveld Beekstraat", address: "Beekstraat 53", regio: "07", post: "17" },
            "barneveld nijkerkerweg": { display: "Barneveld Nijkerkerweg", address: "Nijkerkerweg 119", regio: "07", post: "17" },
            "harskamp": { display: "Harskamp", address: "Dorpsstraat 106a", regio: "07", post: "21" },
            "de valk": { display: "De Valk", address: "Lage Valkseweg 119", regio: "07", post: "22" },
            "otterlo": { display: "Otterlo", address: "Harskamperweg 30a", regio: "07", post: "23" },
            "lunteren": { display: "Lunteren", address: "Zilvervoslaan 29", regio: "07", post: "24" },
            "ederveen": { display: "Ederveen", address: "Sneeuwbesstraat 8", regio: "07", post: "25" },
            "ede centrum": { display: "Ede Centrum", address: "Breelaan 4", regio: "07", post: "27" },
            "ede stadspoort": { display: "Ede Stadspoort", address: "Willy Brandtlaan 1", regio: "07", post: "28" },
            "bennekom": { display: "Bennekom", address: "Bergakkerplein 1", regio: "07", post: "29" },
            "wageningen": { display: "Wageningen", address: "Marijkeweg 25", regio: "07", post: "31" },
            "wolfheze": { display: "Wolfheze", address: "Parallelweg 2", regio: "07", post: "32" },
            "oosterbeek": { display: "Oosterbeek", address: "Steynweg 3", regio: "07", post: "33" },
            "doorwerth": { display: "Doorwerth", address: "Van der Mollenalle 10", regio: "07", post: "34" },
            "renkum-heelsum": { display: "Renkum-Heelsum", address: "Utrechtseweg 131", regio: "07", post: "35" },
            "arnhem noord": { display: "Arnhem Noord", address: "Rietgrachtstraat 74", regio: "07", post: "36" },
            "arnhem zuid": { display: "Arnhem Zuid", address: "Groningensingel 1249", regio: "07", post: "37" },
            "heteren": { display: "Heteren", address: "Polderstraat 1", regio: "07", post: "41" },
            "elst": { display: "Elst", address: "De Korte Helster 1", regio: "07", post: "42" },
            "zetten": { display: "Zetten", address: "Sint Walburg 1b", regio: "07", post: "43" },
            "valburg": { display: "Valburg", address: "De Vang 1", regio: "07", post: "44" },
            "oosterhout": { display: "Oosterhout (Gld)", address: "Dorpsstraat 3a", regio: "07", post: "45" },
            "huissen": { display: "Huissen", address: "Kampstuk 21", regio: "07", post: "46" },
            "doornenburg": { display: "Doornenburg", address: "Vijzelpad 9", regio: "07", post: "47" },
            "bemmel": { display: "Bemmel", address: "Karstraat 18", regio: "07", post: "48" },
            "gendt": { display: "Gendt", address: "Dorpstraat 72a", regio: "07", post: "49" },
            "dieren": { display: "Dieren", address: "Burgemeester Bloemersstraat 1", regio: "07", post: "51" },
            "rheden": { display: "Rheden", address: "Worth Rhedenseweg 66", regio: "07", post: "52" },
            "velp": { display: "Velp", address: "Noorder Parallelweg 21", regio: "07", post: "53" },
            "giesbeek": { display: "Giesbeek", address: "Dorpsplein 7", regio: "07", post: "54" },
            "zevenaar": { display: "Zevenaar", address: "Professor Aalbersestraat 3", regio: "07", post: "55" },
            "duiven": { display: "Duiven", address: "Ploenstraat 3", regio: "07", post: "56" },
            "doesburg": { display: "Doesburg", address: "Halve Maanweg 3", regio: "07", post: "57" },
            "pannerden": { display: "Pannerden", address: "Renbaan 1c", regio: "07", post: "58" },
            "lobith-tolkamer": { display: "Lobith-Tolkamer", address: "Industrieweg 1a", regio: "07", post: "59" },
            "norske skog parneco-renkum": { display: "Norske Skog Parneco-Renkum", address: "Veerweg 1 (Bedrijfsbrandweer)", regio: "07", post: "83" },
            "logistiek gelderland-midden": { display: "Logistiek — Poort van Midden Gelderland", address: "Rood 5", regio: null, post: null },
            "groesbeek": { display: "Groesbeek", address: "Industrieweg 9", regio: "08", post: "11" },
            "millingen aan den rijn": { display: "Millingen aan den Rijn", address: "Heerbaan 65", regio: "08", post: "12" },
            "ubbergen": { display: "Ubbergen", address: "Nieuwe Rijksweg 1", regio: "08", post: "13" },
            "nijmegen centrum": { display: "Nijmegen Centrum", address: "Prof. Bellefroidstraat 11", regio: "08", post: "21" },
            "lent": { display: "Lent", address: "Spoorstraat 31", regio: "08", post: "22" },
            "nijmegen west": { display: "Nijmegen West", address: "Nieuwe Dukenburgseweg 23", regio: "08", post: "23" },
            "malden": { display: "Malden", address: "Ambachtsweg 9", regio: "08", post: "31" },
            "overasselt": { display: "Overasselt", address: "Kasteelsestraat 3", regio: "08", post: "32" },
            "wijchen": { display: "Wijchen", address: "Bronckhorstlaan 5", regio: "08", post: "33" },
            "beneden leeuwen": { display: "Beneden Leeuwen", address: "Van Heemstraweg 64c", regio: "08", post: "41" },
            "beuningen": { display: "Beuningen", address: "Van Heemstraweg 95", regio: "08", post: "42" },
            "dreumel": { display: "Dreumel", address: "Margrietstraat 12b", regio: "08", post: "43" },
            "druten": { display: "Druten", address: "Van Heemstraweg 52a", regio: "08", post: "44" },
            "maasbommel": { display: "Maasbommel", address: "Kapelstraat 21a", regio: "08", post: "45" },
            "brakel": { display: "Brakel", address: "Molenkampsweg 9", regio: "08", post: "51" },
            "gameren": { display: "Gameren", address: "Middelkampseweg 4", regio: "08", post: "52" },
        };

        // Looks up STATION_ADDRESS_DATA for a building's caption. Exact
        // normalized match ONLY — several real Dutch place names repeat across
        // regions (Loenen exists in both Gelderland and Utrecht, Scherpenzeel
        // in both Gelderland and Friesland, Oosterhout in both Gelderland and
        // Noord-Brabant). A fuzzy/word-boundary fallback here would risk
        // silently attaching the wrong region's address to a building — exact
        // match is the only way to stay safe without cross-checking regio too.
        function findStationAddress(building) {
            const stripped = stripPrefix(normalize(building.caption));
            return STATION_ADDRESS_DATA[stripped] || null;
        }

        /* ========================================================================
         * REFERENCE DATA — real Politie Midden-Nederland basisteam numbers
         * (district Oost-Utrecht) — same table as the vehicle namer.
         * ==================================================================== */
        const MD_BASISTEAMS = {
            'amersfoort': { num: 31, team: 'Amersfoort' },
            'baarn': { num: 32, team: 'Eemland-Noord' }, 'eemland': { num: 32, team: 'Eemland-Noord' }, 'soest': { num: 32, team: 'Eemland-Noord' },
            'zeist': { num: 33, team: 'Heuvelrug' }, 'bunnik': { num: 33, team: 'Heuvelrug' }, 'leusden': { num: 33, team: 'Heuvelrug' }, 'woudenberg': { num: 33, team: 'Heuvelrug' },
            'veenendaal': { num: 34, team: 'Veenendaal' }, 'doorn': { num: 34, team: 'Veenendaal' }, 'heuvelrug': { num: 34, team: 'Veenendaal' }, 'wijk bij duurstede': { num: 34, team: 'Veenendaal' },
        };
        const POLICE_UNIT_ABBR = {
            '01': 'Noord-Nederland', '02': 'Noord-Nederland', '03': 'Noord-Nederland', '04': 'Oost-Nederland',
            '05': 'Oost-Nederland', '06': 'Oost-Nederland', '07': 'Oost-Nederland', '08': 'Oost-Nederland',
            '09': 'Midden-Nederland', '10': 'Noord-Holland', '11': 'Noord-Holland', '12': 'Noord-Holland',
            '13': 'Amsterdam', '14': 'Midden-Nederland', '15': 'Den Haag', '16': 'Den Haag', '17': 'Rotterdam',
            '18': 'Rotterdam', '19': 'Zeeland-West-Brabant', '20': 'Zeeland-West-Brabant', '21': 'Oost-Brabant',
            '22': 'Oost-Brabant', '23': 'Limburg', '24': 'Limburg', '25': 'Midden-Nederland',
        };

        /* ========================================================================
         * REFERENCE DATA — known real aircraft bases (matched by keyword, same
         * list as the vehicle namer).
         * ==================================================================== */
        const KNOWN_AIRCRAFT_BASES = [
            { match: /amsterdam.*heliport|vumc|\bamc\b/i, name: 'Traumaheli Standplaats AMC (Lifeliner 1)' },
            { match: /radboud|nijmeg/i, name: 'Traumaheli Standplaats Radboudumc (Lifeliner 3)' },
            { match: /luchtvaartpolitie|politiehelikopter/i, name: 'Landelijke Eenheid — Dienst Luchtvaartpolitie' },
            { match: /schiphol/i, name: 'Vliegbasis / Brandweer Schiphol' },
        ];

        /* ========================================================================
         * REFERENCE DATA — building_type -> discipline & Dutch generic label
         * ==================================================================== */
        const BUILDING_TYPE_DISCIPLINE = {
            0: 'fire', 17: 'fire',
            3: 'ambulance', 13: 'ambulance',
            5: 'police', 11: 'police', 18: 'police',
            6: 'aviation', 9: 'aviation', 19: 'aviation', 21: 'aviation',
            22: 'rws',
            23: 'military', 25: 'military', // 25 confirmed live (KMar kazernes: Generaal-Majoor Kootkazerne, Van Braam Houckgeestkazerne, Sergeant-Majoor Scheickkazerne) — same discipline/label as 23
            1: 'meldkamer', // confirmed live: "Meldkamer Huis Ter Heide", "Meldkamer Amerongen"
            2: 'hospital', // confirmed live: hospitals (Meander Medisch Centrum, Ziekenhuis Gelderse Vallei, St Antonius Nieuwegein, Gelre Ziekenhuizen, Diakonessenhuis Utrecht, UMC Utrecht) — carries a `patient_count` field too
            4: 'education', // confirmed live: training institutes (Nederlands Instituut Publieke Veiligheid, Stichting Brandweeropleidingen Bogo)
            8: 'police_academy', // confirmed live: "Politieacademie Leusden" (Loes van Overeemlaan 11, Leusden) — distinct from regular police (5/11/18)
            27: 'rail', // confirmed live: "Prorail Amersfoort Centraal"
        };
        // Game silently drops a rename that runs too long (POST returns 200,
        // caption unchanged) — confirmed live at 41 and 45 chars, confirmed OK
        // at 33. Cap conservatively and shorten the label word before ever
        // truncating the actual place name.
        const SAFE_NAME_LENGTH = 38;
        const LABEL_SHORTENING = {
            'Brandweerkazerne': 'Brandweer',
            'Ambulancepost': 'Ambulance',
            'Politiebureau': 'Politie',
            'Opleidingsinstituut': 'Opleiding',
            'Kazerne (Defensie)': 'Defensie',
            'RWS Steunpunt': 'RWS',
            'Politieacademie': 'Politieacad.',
        };
        function enforceNameLength(name) {
            let out = name;
            if (out.length <= SAFE_NAME_LENGTH) return out;
            for (const [long, short] of Object.entries(LABEL_SHORTENING)) {
                if (out.includes(long)) {
                    out = out.replace(long, short);
                    if (out.length <= SAFE_NAME_LENGTH) return out;
                }
            }
            if (out.length > SAFE_NAME_LENGTH) {
                out = out.slice(0, SAFE_NAME_LENGTH).replace(/\s+\S*$/, '').trim();
            }
            return out;
        }

        const DISCIPLINE_LABEL = {
            fire: 'Brandweerkazerne',
            ambulance: 'Ambulancepost',
            police: 'Politiebureau',
            aviation: 'Vliegbasis',
            rws: 'RWS Steunpunt',
            military: 'Kazerne (Defensie)',
            meldkamer: 'Meldkamer',
            hospital: 'Ziekenhuis',
            education: 'Opleidingsinstituut',
            police_academy: 'Politieacademie',
            rail: 'Spoor',
        };
        // Disciplines that are NEVER auto-renamed. Hospitals, meldkamers,
        // training institutes, police academies, military kazernes, and rail
        // posts are each named after a SPECIFIC real-world institution (a
        // hospital's actual name, a named kazerne, ...) — there's no "place +
        // generic label" formula that reconstructs that correctly, unlike
        // fire/ambulance/police which follow a real, regular numbering/naming
        // convention. Guessing one is exactly what corrupted several real
        // hospitals/kazernes into "Post <place>" before. These get recognized
        // (so they don't spam the unclassified log) but always left exactly as
        // they are.
        const NO_RENAME_DISCIPLINES = new Set(['meldkamer', 'hospital', 'education', 'police_academy', 'military', 'rail']);

        // Any building_type NOT in BUILDING_TYPE_DISCIPLINE at all (something we
        // haven't seen live yet) returns null here — NEVER a guessed generic
        // label. An unclassified building is left completely untouched in-game
        // and shows up in the "unclassified" log — tell Claude its building_type
        // and real caption so it can be added properly.
        function classifyDiscipline(buildingType) {
            return BUILDING_TYPE_DISCIPLINE[buildingType] || null;
        }

        /* ========================================================================
         * Manual overrides — put exact names you want here, keyed by building id.
         * Always wins over everything else.
         * ==================================================================== */
        const MANUAL_BUILDING_OVERRIDES = {
            // 123456: 'Brandweerkazerne Amersfoort-Noord',

            // Real names, restored 2026-09-14 after an earlier version of this
            // script wrongly renamed these to generic "Post <place>" — verified
            // either directly (the real name was still visible after "Post ")
            // or via live OSM/Overpass coordinate lookup against the building's
            // own latitude/longitude.
            2570149: 'Meander Medisch Centrum',
            3146758: 'Generaal-Majoor Kootkazerne',
            3146759: 'Van Braam Houckgeestkazerne',
            3145075: 'Meldkamer Huis Ter Heide',
            2555705: 'Ziekenhuis Gelderse Vallei',
            2596197: 'Stichting Brandweeropleidingen Bogo',
            3148143: 'St Antonius Nieuwegein',
            3143906: 'Prorail Amersfoort Centraal',
            3147502: 'Sergeant-Majoor Scheickkazerne',
            2570083: 'Gelre Ziekenhuizen',
            425940: 'Meldkamer Amerongen',
            3148146: 'Diakonessenhuis Utrecht', // OSM Overpass: exact coordinate match (52.0816,5.1385)
            3147450: 'UMC Utrecht', // OSM Overpass: exact coordinate match (52.0870,5.1803)
            3147469: 'Meander Medisch Centrum Baarn', // OSM Overpass: exact coordinate match (52.2147,5.2769)
            2596153: 'Politieacademie Leusden', // confirmed via politieacademie.nl's own locations page
            2571136: 'VRU Opleidingen', // OSM Overpass: exact coordinate match (52.0950,5.1533) with Archimedeslaan 6, Utrecht — VRU's own HQ address
        };

        /* ========================================================================
         * NAME GENERATION
         * ==================================================================== */
        function computeTarget(building) {
            if (MANUAL_BUILDING_OVERRIDES[building.id]) {
                return { name: MANUAL_BUILDING_OVERRIDES[building.id], manual: true };
            }

            const discipline = classifyDiscipline(building.building_type);
            if (!discipline) return null; // unknown building_type — leave completely untouched, never guess a label
            if (NO_RENAME_DISCIPLINES.has(discipline)) return null; // recognized, but never auto-renamed — see NO_RENAME_DISCIPLINES
            const stripped = stripPrefix(normalize(building.caption));
            if (!stripped) return null; // nothing to derive a place name from

            if (discipline === 'aviation') {
                for (const base of KNOWN_AIRCRAFT_BASES) {
                    if (base.match.test(building.caption)) return { name: base.name, exact: true };
                }
            }

            const label = DISCIPLINE_LABEL[discipline];
            const rawStationData = findStationAddress(building);

            // Several real Dutch place names repeat across regions (Elst exists
            // in both Utrecht and Gelderland, Loenen in both Gelderland and
            // Utrecht, Scherpenzeel in both Gelderland and Friesland,
            // Oosterhout in both Gelderland and Noord-Brabant, ...). Only trust
            // STATION_ADDRESS_DATA's address/display for a given building once
            // its region is confirmed to match — either the entry has no region
            // of its own (a one-off heliport/hospital/etc., unambiguous by
            // name), or it agrees with the regio this building was independently
            // resolved to. Otherwise silently drop the address rather than risk
            // attaching the wrong town's street to this building.
            // Trust the data unless we have a SPECIFIC, resolved regio for this
            // building that actively disagrees with it (that's the real Elst/
            // Loenen/Scherpenzeel/Oosterhout collision case). When nothing else
            // is known about the building's region, there's nothing to conflict
            // with, so the entry's own region stands — rejecting it in that case
            // would just silently drop addresses for most of the newly-covered
            // towns, which aren't in the older, much smaller PLACE_TO_REGIO list.
            function stationDataForRegio(expectedRegio) {
                if (!rawStationData) return null;
                if (!rawStationData.regio || !expectedRegio) return rawStationData;
                return rawStationData.regio === expectedRegio ? rawStationData : null;
            }

            if (discipline === 'fire') {
                // Utrecht/Gelderland-Midden's own verified sheet is authoritative
                // for the post number when it has one. Otherwise, if
                // STATION_ADDRESS_DATA itself carries a regio+post for this exact
                // place, that IS the confirmed region for this building (the
                // number came from that same entry) — use it as-is, no
                // cross-check needed since there's nothing else to cross-check
                // it against yet.
                const post = findFirePostCode(building)
                    || (rawStationData && rawStationData.regio && rawStationData.post
                        ? { regio: rawStationData.regio, post: rawStationData.post }
                        : null);
                const regio = post ? post.regio : regioForBuilding(building);
                const stationData = stationDataForRegio(regio);
                const place = stationData ? stationData.display : displayPlaceName(stripped);
                // The real address is NOT put in the display name — the game
                // silently rejected a name that included one (POST returned 200
                // but the caption never actually changed, likely a server-side
                // length cap). Kept as `address` on the returned object purely
                // for the OSM crosscheck to use internally.
                const address = stationData ? stationData.address : null;
                if (post) return { name: `${post.regio}-${post.post} ${label} ${place}`, exact: true, place, address, regio };
                return { name: `${regio ? regio + ' ' : ''}${label} ${place}`, place, address, regio };
            }

            const regio = regioForBuilding(building);
            const stationData = stationDataForRegio(regio);
            const place = stationData ? stationData.display : displayPlaceName(stripped);
            const address = stationData ? stationData.address : null;

            if (discipline === 'police') {
                // No parenthetical team-name / "Eenheid X" suffix — same info,
                // shorter. The game silently drops renames that run too long
                // (confirmed live), so keep police names to label+place, plus
                // just the basisteam number when known.
                const teamInfo = Object.entries(MD_BASISTEAMS).find(([p]) => wordBoundaryIncludes(stripped, p));
                if (teamInfo) return { name: `${label} ${place} (BT ${teamInfo[1].num})`, exact: true, place, address, regio };
                return { name: `${label} ${place}`, place, address, regio };
            }

            if (discipline === 'ambulance') {
                return { name: `${regio ? regio + ' ' : ''}${label} ${place}`, place, address, regio };
            }

            // aviation (no exact match), rws, military, other
            return { name: `${label} ${place}`, place, address, regio };
        }

        /* ========================================================================
         * UNIQUENESS
         * ==================================================================== */
        // Never invents a suffix like " (2)". Returns the name if free, or null
        // on a real collision — caller then leaves the building untouched and
        // logs it. usedNames holds every building's CURRENT caption, so a
        // building whose computed name equals its own caption must not count as
        // colliding with itself (that self-collision was what produced "(2)").
        // "Is this what I would have named it?" Feed the computed name back in as
        // if it were the building's caption: a correct name must come out the
        // same. If it drifts (label stacking, place lookup changing), renaming
        // would repeat on every scan or update, so the building is left alone.
        function stableTarget(building) {
            const target = computeTarget(building);
            if (!target) return { target: null };
            target.name = enforceNameLength(target.name);
            if (target.name === building.caption) return { target };
            const again = computeTarget({ ...building, caption: target.name });
            if (again && enforceNameLength(again.name) !== target.name) return { target: null, unstable: target.name };
            return { target };
        }

        function claimName(name, building, usedNames) {
            if (name === building.caption) return name;
            if (usedNames.has(name)) return null;
            usedNames.add(name);
            return name;
        }

        /* ========================================================================
         * GAME API
         * ==================================================================== */
        async function fetchWithTimeout(url, opts, timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs || CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }
        async function apiGet(path) {
            const res = await fetchWithTimeout(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }
        const getBuildings = () => apiGet('/api/buildings');
        const getBuilding = (id) => apiGet(`/api/buildings/${id}`);

        /* ========================================================================
         * IN-GAME RENAME MECHANISM — mirrors the vehicle namer's approach exactly:
         * fetch the rename form off-screen, copy every field, swap in the new
         * name, POST it ourselves via fetch() so a real page navigation can never
         * kill an in-progress rename queue.
         *
         * ASSUMPTION: /buildings/:id/editName exists and behaves like
         * /vehicles/:id/editName. If meldkamerspel.com's building rename uses a
         * different URL or field names, this will fail loudly below (check the
         * console) — tell Claude the actual endpoint/form and it can be fixed
         * in one line.
         * ==================================================================== */
        async function renameBuildingInGame(buildingId, newName) {
            const trimmed = newName.slice(0, CONFIG.MAX_NAME_LENGTH);

            // Last-line guard: never write a "(n)" collision-style suffix in-game.
            if (/\s\(\d+\)$/.test(trimmed)) {
                err(`(${buildingId}) refusing to rename to "${trimmed}" — collision-style suffix`);
                return false;
            }

            if (CONFIG.DRY_RUN) {
                log(`[DRY RUN] would rename building ${buildingId} -> "${trimmed}"`);
                return true;
            }

            log(`(${buildingId}) fetching edit form...`);
            // Confirmed via live devtools capture: GET /buildings/:id/edit
            // returns a normal Rails edit form — id="edit_building_:id", action
            // /buildings/:id, method POST with a hidden _method=patch field, and
            // the name field is #building_name / name="building[name]".
            const html = await fetchWithTimeout(`/buildings/${buildingId}/edit`, { credentials: 'same-origin' }).then((r) => r.text());

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const form = doc.querySelector(`#edit_building_${buildingId}`) || doc.querySelector('form');
            if (!form) {
                err(`(${buildingId}) no <form> found in the fetched edit page. Raw HTML:`, html);
                return false;
            }

            const nameInput = form.querySelector('#building_name')
                || form.querySelector('input[name="building[name]"]')
                || form.querySelector('input[name*=name]')
                || form.querySelector('input[type=text]');
            if (!nameInput || !nameInput.name) {
                err(`(${buildingId}) no usable name <input> (with a "name" attribute) found. Form HTML:`, form.outerHTML);
                return false;
            }

            const action = form.getAttribute('action') || `/buildings/${buildingId}`;
            const url = new URL(action, location.origin);

            const body = new URLSearchParams();
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
                if (el === nameInput) return;
                if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
                body.append(el.name, el.value);
            });
            body.append(nameInput.name, trimmed);

            log(`(${buildingId}) posting to ${url.pathname} ...`);
            let res;
            try {
                res = await fetchWithTimeout(url.toString(), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: body.toString(),
                });
            } catch (e) {
                err(`(${buildingId}) rename POST failed/timed out`, e);
                return false;
            }
            if (!res.ok) {
                err(`(${buildingId}) rename POST returned HTTP ${res.status}`);
                return false;
            }

            try {
                const fresh = await getBuilding(buildingId);
                if (fresh && fresh.caption === trimmed) {
                    log(`(${buildingId}) confirmed: caption is now "${trimmed}"`);
                    return true;
                }
                err(`(${buildingId}) POST succeeded but caption is still "${fresh && fresh.caption}" (expected "${trimmed}") — the form field name may be wrong for this site version.`);
                return false;
            } catch (e) {
                warn(`(${buildingId}) could not verify rename (network error on re-fetch), assuming it worked since POST returned OK`, e);
                return true;
            }
        }

        /* ========================================================================
         * MAIN ENGINE
         * ==================================================================== */
        const renameQueue = [];
        let queueRunning = false;
        let queueTotal = 0;
        let queueDone = 0;
        let queueFailed = 0;

        // What the dashboard shows.
        const captionById = new Map();
        const planned = new Map();   // dry run: buildingId -> { from, to }
        const recent = [];           // last renames: { id, from, to, at, ok }
        const stats = { buildings: 0, lastScan: 0, scanning: false };

        function enqueueRename(buildingId, name) {
            if (CONFIG.DRY_RUN) {
                planned.set(buildingId, { from: captionById.get(buildingId) || '', to: name });
                return;
            }
            if (renameQueue.some((q) => q.buildingId === buildingId)) return;
            renameQueue.push({ buildingId, name });
            queueTotal++;
            if (!queueRunning) runQueue();
        }

        async function runQueue() {
            queueRunning = true;
            while (renameQueue.length) {
                const { buildingId, name } = renameQueue.shift();
                setStatus(`Hernoemen ${queueDone + 1}/${queueTotal}: ${name}`, 'busy', [queueDone, queueTotal]);
                try {
                    const ok = await renameBuildingInGame(buildingId, name);
                    recent.unshift({ id: buildingId, from: captionById.get(buildingId) || '', to: name, at: Date.now(), ok });
                    recent.length = Math.min(recent.length, 100);
                    if (ok) captionById.set(buildingId, name);
                    if (ok) { log(`renamed building ${buildingId} -> "${name}"`); queueDone++; }
                    else { queueFailed++; }
                } catch (e) {
                    err(`failed to rename building ${buildingId}`, e);
                    queueFailed++;
                }
                ctx.refresh();
                await new Promise((r) => setTimeout(r, CONFIG.RENAME_THROTTLE_MS));
            }
            queueRunning = false;
            queueTotal = 0; queueDone = 0; queueFailed = 0;
            idleStatus();
            persistAll();
            ctx.refresh();
        }

        /* ========================================================================
         * OSM (NOMINATIM) CROSSCHECK
         *
         * Advisory only — this NEVER changes what gets renamed in-game. It runs
         * alongside the rename queue and logs, per building, whether OpenStreetMap
         * data agrees with what we're about to name it. Review with the "Show
         * OSM crosscheck log" panel button (or bn.printCrosscheckLog() in the
         * console).
         *
         * Rate-limited to Nominatim's own usage policy (~1 req/sec, identifying
         * Referer/User-Agent) via a throttled queue, same pattern as the rename
         * queue. Results are cached indefinitely in GM storage so re-scans don't
         * re-query the same place over and over.
         * ==================================================================== */
        function osmRequest(cacheKey, url) {
            if (osmCache[cacheKey] !== undefined) return Promise.resolve(osmCache[cacheKey]);
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: CONFIG.OSM_REQUEST_TIMEOUT_MS,
                    headers: { 'Accept-Language': 'nl' },
                    onload: (res) => {
                        let parsed = null;
                        try { parsed = JSON.parse(res.responseText); } catch (e) { /* fall through with null */ }
                        // /search returns an array, /reverse returns a single object (or {error: ...})
                        const result = Array.isArray(parsed) ? (parsed[0] || null) : (parsed && !parsed.error ? parsed : null);
                        osmCache[cacheKey] = result;
                        resolve(result);
                    },
                    onerror: () => resolve(undefined), // undefined = request failed, distinct from null = confirmed no match
                    ontimeout: () => resolve(undefined),
                });
            });
        }
        function osmSearch(query) {
            return osmRequest(`search:${query}`, `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=nl&q=${encodeURIComponent(query)}`);
        }
        function osmReverse(lat, lon) {
            const key = `reverse:${lat},${lon}`;
            return osmRequest(key, `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        }

        // The game's /api/buildings shape isn't documented anywhere we could
        // check — this tries every plausible field-name pair a building object
        // might carry its real-world coordinates under. If none match, the
        // caller falls back to a forward text search instead. If you know the
        // actual field names, tell Claude and this can just be two lines.
        const LAT_KEYS = ['lat', 'latitude', 'y', 'pos_lat', 'position_lat', 'map_lat'];
        const LON_KEYS = ['lon', 'lng', 'longitude', 'x', 'pos_lon', 'pos_lng', 'position_lng', 'map_lon', 'map_lng'];
        function extractCoords(building) {
            let lat, lon;
            for (const k of LAT_KEYS) if (building[k] !== undefined && building[k] !== null) { lat = Number(building[k]); break; }
            for (const k of LON_KEYS) if (building[k] !== undefined && building[k] !== null) { lon = Number(building[k]); break; }
            if (building.location && typeof building.location === 'object') {
                if (lat === undefined) lat = Number(building.location.lat ?? building.location.latitude);
                if (lon === undefined) lon = Number(building.location.lon ?? building.location.lng ?? building.location.longitude);
            }
            if (building.coordinates && typeof building.coordinates === 'object') {
                if (lat === undefined) lat = Number(building.coordinates.lat ?? building.coordinates.latitude);
                if (lon === undefined) lon = Number(building.coordinates.lon ?? building.coordinates.lng ?? building.coordinates.longitude);
            }
            // Sanity range check — real Dutch coordinates only, so a stray
            // unrelated numeric field (id, building_type, ...) can't get read as
            // a coordinate and sent off to Nominatim.
            if (Number.isFinite(lat) && Number.isFinite(lon) && lat > 50 && lat < 54 && lon > 2 && lon < 8) {
                return { lat, lon };
            }
            return null;
        }

        // Loose overlap check: does any "word" (4+ chars, to skip "de"/"van"/etc)
        // from `needle` appear in `haystack`? Good enough for "does this address
        // text plausibly describe the same place" without demanding an exact
        // string match, which real-world address formatting differences would
        // never satisfy anyway.
        function looseTextOverlap(haystack, needle) {
            const h = normalize(haystack);
            const words = normalize(needle).split(' ').filter((w) => w.length >= 4);
            if (!words.length) return null; // nothing meaningful to compare
            return words.some((w) => h.includes(w));
        }

        async function crosscheckBuilding(building, target) {
            // Reuse EXACTLY what computeTarget already resolved (target.place /
            // target.address) rather than re-deriving them here. Re-deriving via
            // a fresh findStationAddress() call would bypass computeTarget's
            // region-collision guard (see stationDataForRegio there) and could
            // crosscheck an ambiguous place — e.g. "Elst" — against the WRONG
            // region's address even though the assigned name itself was correct.
            const discipline = classifyDiscipline(building.building_type);
            const place = target.place || displayPlaceName(stripPrefix(normalize(building.caption)));
            const ourAddress = target.address || null;

            // Strongest check available: if the building object itself carries
            // real-world coordinates, reverse-geocode THOSE instead of guessing
            // a search query from the name — this confirms the actual building,
            // not just "a place with a similar name somewhere in NL".
            const coords = extractCoords(building);
            let osmResult;
            let query;
            if (coords) {
                query = `reverse ${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
                osmResult = await osmReverse(coords.lat, coords.lon);
            } else if (ourAddress) {
                query = `${ourAddress}, ${place}, Netherlands`;
                osmResult = await osmSearch(query);
            } else {
                query = `${DISCIPLINE_LABEL[discipline]} ${place}, Netherlands`;
                osmResult = await osmSearch(query);
            }

            let entry;
            if (osmResult === undefined) {
                entry = { status: 'request_failed' };
            } else if (!osmResult) {
                entry = { status: 'no_osm_result' };
            } else {
                const osmAddressText = [osmResult.display_name, osmResult.address && osmResult.address.postcode].filter(Boolean).join(' ');
                if (coords) {
                    // Reverse geocode: compare against whichever real place name we
                    // assigned (from the address data if we have it, else the
                    // display place name) — this is checking "does the real
                    // location agree with what we called it", the actual point of
                    // having coordinates at all.
                    const overlap = looseTextOverlap(osmAddressText, place) || (ourAddress && looseTextOverlap(osmAddressText, ourAddress));
                    entry = overlap === false
                        ? { status: 'possible_mismatch', ourPlace: place, ourAddress, osmAddress: osmResult.display_name, source: 'coords' }
                        : { status: 'consistent', source: 'coords' };
                } else if (ourAddress) {
                    const overlap = looseTextOverlap(osmAddressText, ourAddress) || looseTextOverlap(osmAddressText, place);
                    entry = overlap === false
                        ? { status: 'possible_mismatch', ourAddress, osmAddress: osmResult.display_name, source: 'name-search' }
                        : { status: 'consistent', source: 'name-search' };
                } else {
                    // We had no address of our own for this one — surface what OSM
                    // found as a candidate to manually add to STATION_ADDRESS_DATA.
                    entry = { status: 'suggested_address', osmAddress: osmResult.display_name, osmType: osmResult.type };
                }
            }

            osmCrosscheckLog[building.id] = {
                buildingId: building.id,
                place,
                ourName: target.name,
                query,
                ...entry,
            };
        }

        const crosscheckQueue = [];
        let crosscheckRunning = false;

        function enqueueCrosscheck(building, target) {
            if (!CONFIG.ENABLE_OSM_CROSSCHECK) return;
            crosscheckQueue.push({ building, target });
            if (!crosscheckRunning) runCrosscheckQueue();
        }

        async function runCrosscheckQueue() {
            crosscheckRunning = true;
            while (crosscheckQueue.length) {
                const { building, target } = crosscheckQueue.shift();
                try {
                    await crosscheckBuilding(building, target);
                } catch (e) {
                    warn(`(${building.id}) OSM crosscheck failed`, e);
                }
                store.set('bn_osmCache', osmCache);
                store.set('bn_osmCrosscheckLog', osmCrosscheckLog);
                await new Promise((r) => setTimeout(r, CONFIG.OSM_THROTTLE_MS));
            }
            crosscheckRunning = false;
            if (CONFIG.DEBUG) printCrosscheckLog(true);
            ctx.refresh();
        }

        function printCrosscheckLog(summaryOnly) {
            const rows = Object.values(osmCrosscheckLog);
            if (!rows.length) { log('no OSM crosscheck data yet.'); return; }
            const mismatches = rows.filter((r) => r.status === 'possible_mismatch');
            const suggestions = rows.filter((r) => r.status === 'suggested_address');
            const noResult = rows.filter((r) => r.status === 'no_osm_result' || r.status === 'request_failed');
            log(`OSM crosscheck: ${rows.length} checked — ${mismatches.length} possible mismatch(es), ${suggestions.length} address suggestion(s), ${noResult.length} unconfirmed.`);
            if (summaryOnly && !mismatches.length && !suggestions.length) return;
            if (mismatches.length) {
                console.log('%c[BuildingNamer] possible mismatches — our data disagrees with OSM, review by hand:', 'color:#e33');
                console.table(mismatches);
            }
            if (suggestions.length) {
                console.log('%c[BuildingNamer] OSM found an address we didn\'t have — candidates to add to STATION_ADDRESS_DATA:', 'color:#0a7');
                console.table(suggestions);
            }
        }

        async function fullScan() {
            if (!hasMemory) return memoryMissing();
            if (stats.scanning) return;
            stats.scanning = true;
            setStatus('Controleren…', 'busy');
            if (CONFIG.DRY_RUN) planned.clear();
            try { await fullScanInner(); } finally { stats.scanning = false; }
            if (!queueRunning) idleStatus();
            ctx.refresh();
        }

        async function fullScanInner() {
            log('running full scan...');
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('could not fetch /api/buildings', e);
                setStatus(`Kon gebouwen niet ophalen: ${e.message}`, 'error');
                return;
            }
            unclassifiedLog = {};

            const usedNames = new Set(buildings.map((b) => b.caption));
            captionById.clear();
            buildings.forEach((b) => captionById.set(b.id, b.caption));
            stats.buildings = buildings.length;
            stats.lastScan = Date.now();
            let renameCount = 0;

            for (const building of buildings) {
                const existing = assignments[building.id];
                if (existing && existing.name === building.caption) continue;

                let target;
                if (existing) {
                    target = existing;
                    usedNames.add(target.name);
                } else {
                    const res = stableTarget(building);
                    target = res.target;
                    if (res.unstable) {
                        recordUnclassified(building, `computed name "${res.unstable}" would change again on the next scan — left untouched`);
                        continue;
                    }
                    if (!target) {
                        if (!isDeliberatelySkipped(building)) recordUnclassified(building, 'unknown building_type or no place name could be derived');
                        continue;
                    }
                    const claimed = claimName(target.name, building, usedNames);
                    if (!claimed) {
                        recordUnclassified(building, `name collision: "${target.name}" already used by another building — left untouched`);
                        continue;
                    }
                    target.name = claimed;
                    assignments[building.id] = target;
                }

                if (target.name !== building.caption) {
                    enqueueRename(building.id, target.name);
                    renameCount++;
                }
                if (!osmCrosscheckLog[building.id]) enqueueCrosscheck(building, target);
            }

            knownBuildingIds = buildings.map((b) => b.id);
            persistAll();
            log(`full scan complete — ${renameCount} building(s) queued for rename`);
            if (CONFIG.DEBUG) printUnclassifiedLog();
        }

        async function pollNewBuildings() {
            if (!hasMemory || stats.scanning) return;
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('poll: could not fetch /api/buildings', e);
                return;
            }
            const known = new Set(knownBuildingIds);
            const fresh = buildings.filter((b) => !known.has(b.id));
            if (!fresh.length) return;

            log(`found ${fresh.length} newly acquired building(s)`);
            const usedNames = new Set(buildings.map((b) => b.caption));
            buildings.forEach((b) => captionById.set(b.id, b.caption));
            stats.buildings = buildings.length;

            for (const building of fresh) {
                const { target, unstable } = stableTarget(building);
                if (unstable) {
                    recordUnclassified(building, `computed name "${unstable}" would change again on the next scan — left untouched`);
                    continue;
                }
                if (!target) {
                    if (!isDeliberatelySkipped(building)) recordUnclassified(building, 'unknown building_type or no place name could be derived');
                    continue;
                }
                const claimed = claimName(target.name, building, usedNames);
                if (!claimed) {
                    recordUnclassified(building, `name collision: "${target.name}" already used by another building — left untouched`);
                    continue;
                }
                target.name = claimed;
                assignments[building.id] = target;
                if (target.name !== building.caption) enqueueRename(building.id, target.name);
                enqueueCrosscheck(building, target);
            }

            knownBuildingIds = buildings.map((b) => b.id);
            persistAll();
            if (CONFIG.DEBUG) printUnclassifiedLog();
            ctx.refresh();
        }

        /* ========================================================================
         * DASHBOARD
         * ==================================================================== */
        function setStatus(text, tone = 'idle', progress) {
            // Only busy/error states go to the dock; idle stays in the dashboard.
            ctx.status(text, { tone, progress, dock: tone === 'busy' || tone === 'error' });
            if (CONFIG.DEBUG) log('status:', text);
        }

        function idleStatus() {
            if (!hasMemory) return memoryMissing();
            const unknown = Object.keys(unclassifiedLog).length;
            const when = stats.lastScan ? new Date(stats.lastScan).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
            setStatus(`${stats.buildings} gebouwen in orde · controle ${when}${unknown ? ` · ${unknown} niet hernoemd` : ''}`, unknown ? 'warn' : 'ok');
        }

        function memoryMissing() {
            setStatus('Wacht: geheugen van het oude script ontbreekt', 'warn');
        }

        const esc = ctx.esc;
        const table = (head, rows) => `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        const bLink = (id, text) => `<a href="/buildings/${id}" target="_blank">${esc(text)}</a>`;

        ctx.panel((el) => {
            const unknown = Object.values(unclassifiedLog);
            const failed = recent.filter((r) => !r.ok).length;
            const osm = Object.values(osmCrosscheckLog);
            const mismatches = osm.filter((r) => r.status === 'possible_mismatch');
            const suggestions = osm.filter((r) => r.status === 'suggested_address');
            let html = `<h4 class="mks-h">Stand</h4><div class="mks-tiles">
                <div class="mks-tile"><div class="v">${ctx.nl(stats.buildings)}</div><div class="k">gebouwen</div></div>
                <div class="mks-tile"><div class="v">${renameQueue.length}</div><div class="k">in wachtrij</div></div>
                <div class="mks-tile"><div class="v">${recent.filter((r) => r.ok).length}</div><div class="k">hernoemd (deze sessie)</div></div>
                <div class="mks-tile ${failed ? 't-error' : ''}"><div class="v">${failed}</div><div class="k">mislukt</div></div>
                <div class="mks-tile ${unknown.length ? 't-warn' : ''}"><div class="v">${unknown.length}</div><div class="k">niet hernoemd</div></div>
                ${CONFIG.ENABLE_OSM_CROSSCHECK ? `<div class="mks-tile ${mismatches.length ? 't-warn' : ''}"><div class="v">${mismatches.length}</div><div class="k">OSM-verschillen (${osm.length} gecontroleerd)</div></div>` : ''}
            </div>`;

            if (recent.length) {
                html += '<h4 class="mks-h">Laatst hernoemd</h4>' + table(['Tijd', 'Was', 'Nu', ''], recent.slice(0, 50).map((r) => `<tr>
                    <td class="mono">${new Date(r.at).toLocaleTimeString('nl-NL')}</td><td>${esc(r.from)}</td><td>${bLink(r.id, r.to)}</td>
                    <td>${r.ok ? '<span class="mks-pill t-ok">ok</span>' : '<span class="mks-pill t-error">mislukt</span>'}</td></tr>`));
            }

            if (unknown.length) {
                html += `<h4 class="mks-h">Niet hernoemd (${unknown.length})</h4>`
                    + table(['Gebouw', 'Type', 'Reden'], unknown.map((u) => `<tr><td>${bLink(u.buildingId, u.currentName)}</td>
                        <td class="mono">${esc(u.buildingType)}</td><td>${esc(u.reason)}</td></tr>`));
            }

            if (mismatches.length || suggestions.length) {
                html += `<h4 class="mks-h">OpenStreetMap</h4>
                    <p class="mks-note">Alleen ter controle: <b>verschil</b> = onze gegevens en OSM zijn het oneens, kijk zelf even.
                    <b>adres</b> = OSM vond een adres dat nog niet in de lijst stond.</p>`
                    + table(['Gebouw', '', 'Onze naam', 'OSM'], [...mismatches, ...suggestions].map((r) => `<tr>
                        <td>${bLink(r.buildingId, captionById.get(r.buildingId) || r.buildingId)}</td>
                        <td>${r.status === 'possible_mismatch' ? '<span class="mks-pill t-warn">verschil</span>' : '<span class="mks-pill t-busy">adres</span>'}</td>
                        <td>${esc(r.ourName)}</td><td class="mks-dim">${esc(r.osmAddress)}</td></tr>`));
            }
            el.innerHTML = html;
        });

        if (hasMemory) {
            ctx.actions([
                { label: 'Nu controleren', kind: 'primary', run: () => fullScan(), title: 'Alle gebouwen nalopen' },
                { label: 'Kopieer niet-hernoemde (JSON)', run: async () => {
                    const text = JSON.stringify(Object.values(unclassifiedLog), null, 2);
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
            ]);
        }

        ctx.onSettings(() => {
            {
                idleStatus();
                ctx.refresh();
            }
        });

        /* ========================================================================
         * BOOT
         * ==================================================================== */
        log('starting — DRY_RUN =', CONFIG.DRY_RUN);
        window.bn = { fullScan, printUnclassifiedLog, printCrosscheckLog, extractCoords };
        if (!hasMemory) {
            memoryMissing();
            return;
        }
        fullScan();
        setInterval(pollNewBuildings, CONFIG.POLL_NEW_BUILDINGS_MS);
        setInterval(fullScan, CONFIG.FULL_RESCAN_MS);
    },
});

/* ==== module: personnel-overview ========================================== */
MKS.module({
    id: 'personnel-overview',
    name: 'Personeel',
    icon: '👥',
    category: 'tools',
    description: 'Al je personeel uit alle gebouwen in één tabel. Sorteer op elke kolom, filter op opleiding, gebouw, status of naam. '
        + 'Met een statistiekentab, een gebouwentab die per gebouw laat zien welke uitbreidingen er zijn, in aanbouw (met aftelling) of uitgeschakeld, '
        + 'en een meldingentab die laat zien welke nieuwe meldingen je vrijspeelt met nog een paar gebouwen of uitbreidingen.',
    tagline: "Openen via menu Wheeliecat's scripts",
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'concurrency', label: 'Gelijktijdige verzoeken', type: 'number', default: 3, min: 1, max: 6, step: 1,
            help: 'Hoeveel gebouwpagina\'s tegelijk geladen worden. Hoger = sneller, maar zwaarder voor de server.' },
        { key: 'delayMs', label: 'Pauze per verzoek', type: 'number', default: 150, min: 0, max: 2000, step: 50, unit: 'ms' },
    ],

    run(ctx) {

        /* ========================================================================
         * CONFIG
         * ==================================================================== */
        const CONFIG = {
            CONCURRENCY: ctx.cfg.concurrency, // parallel building page requests
            DELAY_MS: ctx.cfg.delayMs,        // pause between requests per worker
            REQUEST_TIMEOUT_MS: 20000,
            CACHE_KEY: 'personnelOverview.cache.v2',
            TAB_KEY: 'personnelOverview.tab',
            TICK_MS: 60000,          // countdown refresh on the buildings tab
        };

        const log = (...a) => console.log('[personnel-overview]', ...a);
        const warn = (...a) => console.warn('[personnel-overview]', ...a);

        /* ========================================================================
         * FETCHING
         * ==================================================================== */
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        async function fetchWithTimeout(url, opts) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { credentials: 'same-origin', ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        async function getBuildings() {
            const res = await fetchWithTimeout('/api/buildings', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET /api/buildings failed: ${res.status}`);
            return res.json();
        }

        async function getVehicles() {
            const res = await fetchWithTimeout('/api/vehicles', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET /api/vehicles failed: ${res.status}`);
            return res.json();
        }

        async function getPersonnelPage(buildingId) {
            const res = await fetchWithTimeout(`/buildings/${buildingId}/personals`);
            if (!res.ok) throw new Error(`GET /buildings/${buildingId}/personals failed: ${res.status}`);
            return res.text();
        }

        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        // The personals page is a plain HTML table. Columns are located by
        // header text rather than position so a reordered/extra column does not
        // break parsing. Fallback order if headers are unrecognised:
        // name, education, bound vehicle, status.
        function parsePersonnel(html, building) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const table = doc.querySelector('#personal_table')
                || [...doc.querySelectorAll('table')].find(t => /opleiding|education|schooling/i.test(t.textContent));
            if (!table) return [];

            const headers = [...table.querySelectorAll('thead th')].map(th => clean(th.textContent).toLowerCase());
            const col = (re, fallback) => {
                const i = headers.findIndex(h => re.test(h));
                return i >= 0 ? i : fallback;
            };
            const iName = col(/naam|name/, 0);
            const iEdu = col(/opleiding|education|schooling|training/, 1);
            const iVeh = col(/gekoppeld|voertuig|vehicle|bound/, 2);
            const iStatus = col(/status/, 3);
            if (!parsePersonnel.logged) {
                parsePersonnel.logged = true;
                log('personals table headers:', headers, { iName, iEdu, iVeh, iStatus });
                const tr = table.querySelector('tbody tr');
                if (tr) log('first row HTML:', tr.outerHTML);
            }

            const rows = table.querySelectorAll('tbody tr');
            const out = [];
            rows.forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (!cells.length) return;
                const name = clean(cells[iName]?.textContent);
                if (!name) return;
                const eduCell = cells[iEdu];
                let educations = [];
                if (eduCell) {
                    // Educations are comma separated, sometimes split with <br>.
                    const raw = eduCell.innerHTML.replace(/<br\s*\/?>/gi, ',');
                    const tmp = document.createElement('div');
                    tmp.innerHTML = raw;
                    educations = tmp.textContent.split(',').map(clean).filter(Boolean);
                }
                // Coupling is decided by an actual /vehicles/<id> link in the row,
                // not by column text: the vehicle column's text is unreliable.
                const vehLink = (cells[iVeh]?.querySelector('a[href*="/vehicles/"]'))
                    || [...tr.querySelectorAll('a[href*="/vehicles/"]')].find(a => /\/vehicles\/\d+/.test(a.getAttribute('href')));
                const vehicleId = vehLink ? (vehLink.getAttribute('href').match(/\/vehicles\/(\d+)/) || [])[1] || null : null;
                out.push({
                    name,
                    educations,
                    vehicle: vehicleId ? clean(vehLink.textContent) : '',
                    vehicleId,
                    status: clean(cells[iStatus]?.textContent),
                    buildingId: building.id,
                    building: building.caption,
                });
            });
            return out;
        }

        async function loadAll(onProgress) {
            const buildings = await getBuildings();
            // personal_count is present on buildings that can hold personnel.
            // If the field is missing entirely, just try every building.
            const withStaff = buildings.filter(b => b.personal_count === undefined || b.personal_count > 0);
            const people = [];
            const failed = [];
            let done = 0;
            let next = 0;

            async function worker() {
                while (next < withStaff.length) {
                    const b = withStaff[next++];
                    try {
                        people.push(...parsePersonnel(await getPersonnelPage(b.id), b));
                    } catch (e) {
                        warn('building failed', b.id, b.caption, e);
                        failed.push(b);
                    }
                    done++;
                    onProgress(done, withStaff.length);
                    await sleep(CONFIG.DELAY_MS);
                }
            }
            await Promise.all(Array.from({ length: CONFIG.CONCURRENCY }, worker));
            log(`loaded ${people.length} personnel from ${withStaff.length} buildings (${failed.length} failed)`);
            return { people, failed: failed.length, loadedAt: Date.now() };
        }

        const cache = {
            get() {
                try { return JSON.parse(GM_getValue(CONFIG.CACHE_KEY, 'null')); } catch (e) { return null; }
            },
            set(v) {
                try { GM_setValue(CONFIG.CACHE_KEY, JSON.stringify(v)); } catch (e) { warn('cache write failed', e); }
            },
        };

        /* ========================================================================
         * UI
         * ==================================================================== */
        const CSS = `
        #po-overlay { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.55); display: flex; }
        #po-panel { margin: 24px auto; width: min(1400px, calc(100vw - 32px)); background: #1e2126; color: #e4e6ea;
            border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; font: 13px/1.4 system-ui, sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,.5); }
        #po-panel * { box-sizing: border-box; }
        #po-head { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #333841; flex-wrap: wrap; }
        #po-head h3 { margin: 0 12px 0 0; font-size: 16px; color: #fff; }
        #po-head input, #po-head select, #po-head button { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d;
            border-radius: 4px; padding: 5px 8px; font: inherit; }
        #po-head button { cursor: pointer; }
        #po-head button:hover { background: #353a43; }
        #po-close { margin-left: auto; }
        #po-body { display: flex; flex: 1; min-height: 0; }
        #po-side { width: 260px; border-right: 1px solid #333841; overflow: auto; padding: 8px 10px; flex-shrink: 0; }
        #po-side h4 { margin: 6px 0; font-size: 12px; text-transform: uppercase; color: #9aa1ab; letter-spacing: .04em; }
        #po-side label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
        #po-side label span.c { margin-left: auto; color: #9aa1ab; font-variant-numeric: tabular-nums; }
        #po-side .po-mode { display: flex; gap: 10px; margin-bottom: 6px; }
        #po-tablewrap { flex: 1; overflow: auto; }
        #po-table { width: 100%; border-collapse: collapse; }
        #po-table th { position: sticky; top: 0; background: #262a30; text-align: left; padding: 6px 8px; cursor: pointer;
            user-select: none; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #po-table th:hover { background: #2f343b; }
        #po-table td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #po-table tr:hover td { background: #252930; }
        #po-table a { color: #6fb3ff; }
        .po-chip { display: inline-block; background: #2f4a66; color: #d6e8ff; border-radius: 10px; padding: 1px 8px; margin: 1px 3px 1px 0; font-size: 12px; }
        .po-none { color: #7a818b; font-style: italic; }
        #po-foot { padding: 6px 14px; border-top: 1px solid #333841; color: #9aa1ab; display: flex; gap: 16px; }
        #po-msg { padding: 40px; text-align: center; color: #9aa1ab; }
        .po-tabs { display: flex; gap: 2px; margin-right: 8px; }
        #po-head .po-tabs button { border-radius: 4px 4px 0 0; }
        #po-head .po-tabs button.on { background: #2f4a66; border-color: #4a6f96; color: #fff; }
        #po-stats { flex: 1; overflow: auto; padding: 14px 18px; }
        .po-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
        .po-tile { background: #262a30; border: 1px solid #333841; border-radius: 6px; padding: 10px 12px; }
        .po-tile .v { font-size: 24px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
        .po-tile .l { color: #9aa1ab; font-size: 12px; }
        .po-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 18px; }
        .po-card { background: #22262c; border: 1px solid #333841; border-radius: 6px; padding: 10px 14px; }
        .po-card h4 { margin: 0 0 8px; font-size: 13px; color: #fff; }
        .po-bar { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; gap: 8px; align-items: center; padding: 2px 0; }
        .po-bar:hover { background: #2a2e35; }
        .po-bar .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c9cdd3; }
        .po-bar .t { height: 12px; }
        .po-bar .f { height: 100%; min-width: 2px; background: #4a90d9; border-radius: 0 4px 4px 0; }
        .po-bar .c { color: #9aa1ab; font-variant-numeric: tabular-nums; text-align: right; min-width: 70px; }
        .po-facts { list-style: none; margin: 0; padding: 0; }
        .po-facts li { padding: 5px 0; border-bottom: 1px solid #2a2e35; }
        .po-facts li:last-child { border-bottom: 0; }
        .po-facts b { color: #fff; }
        .po-facts .s { color: #9aa1ab; }
        #po-bld { flex: 1; overflow: auto; padding: 14px 18px; flex-direction: column; gap: 14px; }
        .po-bld-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .po-bld-ctl input, .po-bld-ctl select { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d;
            border-radius: 4px; padding: 5px 8px; font: inherit; }
        .po-bld-ctl label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .po-chip.on { background: #1f4d3a; color: #c9f0dc; }
        .po-chip.off { background: #6b2226; color: #ffd0d0; }
        .po-chip.bld { background: #5a3e12; color: #ffdca3; }
        .po-bld-off td:first-child a { color: #8d939c; text-decoration: line-through; }
        .po-when { color: #ffdca3; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .po-when.due { color: #7fe0a8; }
        .po-free { color: #7fe0a8; font-weight: 600; }
        .po-full { color: #9aa1ab; }
        #po-bld .po-table { width: 100%; border-collapse: collapse; }
        #po-bld .po-table th { text-align: left; padding: 6px 8px; background: #262a30; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #po-bld .po-table td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #po-bld .po-table tr:hover td { background: #252930; }
        #po-bld a { color: #6fb3ff; }
        #po-mis { flex: 1; overflow: auto; padding: 14px 18px; flex-direction: column; gap: 14px; }
        #po-mis a { color: #6fb3ff; }
        #po-mis .po-table { width: 100%; border-collapse: collapse; }
        #po-mis .po-table th { text-align: left; padding: 6px 8px; background: #262a30; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #po-mis .po-table td { padding: 6px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #po-mis .po-table tr:hover td { background: #252930; }
        .po-gap { display: inline-block; background: #5a3e12; color: #ffdca3; border-radius: 10px; padding: 1px 8px; margin: 1px 3px 1px 0; font-size: 12px; white-space: nowrap; }
        .po-gap.unk { background: #3a3f47; color: #c9cdd3; }
        .po-mis-n { font-size: 18px; font-weight: 600; color: #7fe0a8; font-variant-numeric: tabular-nums; }
        .po-mis-list a { display: inline-block; margin: 1px 10px 1px 0; }
        .po-mis-list summary { cursor: pointer; color: #9aa1ab; }
        .po-mis-ev { color: #ffdca3; font-size: 11px; }
        `;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const NO_EDU = '(geen opleiding)';

        const state = {
            data: null,
            sortKey: 'building',
            sortDir: 1,
            eduSelected: new Set(),
            eduMode: 'any',  // 'any' | 'all'
            search: '',
            building: '',
            status: '',
            tab: 'table',  // 'table' | 'stats' | 'buildings' | 'missions'
            bld: null,     // { buildings, loadedAt } — always fetched live, never cached
            bldSearch: '',
            bldType: '',
            bldShow: 'all', // 'all' | 'building' | 'off'
            mis: null,      // { missions, buildings, loadedAt } — fetched when the tab opens
            misSearch: '',
            misMax: 2,      // show missions missing at most this many buildings/extensions
        };

        let tick;

        let overlay;

        function open() {
            if (!document.getElementById('po-style')) {
                const st = document.createElement('style');
                st.id = 'po-style';
                st.textContent = CSS;
                document.head.appendChild(st);
            }
            overlay = document.createElement('div');
            overlay.id = 'po-overlay';
            overlay.innerHTML = `
            <div id="po-panel">
              <div id="po-head">
                <h3>Personeel</h3>
                <div class="po-tabs">
                  <button data-tab="table">Tabel</button>
                  <button data-tab="stats">📊 Statistieken</button>
                  <button data-tab="buildings">🏗️ Gebouwen</button>
                  <button data-tab="missions">🔓 Meldingen</button>
                </div>
                <input id="po-search" type="search" placeholder="Zoek naam / voertuig…" size="24">
                <select id="po-building"><option value="">Alle gebouwen</option></select>
                <select id="po-status"><option value="">Alle statussen</option></select>
                <button id="po-reset">Filters wissen</button>
                <button id="po-refresh">Vernieuwen</button>
                <button id="po-csv">CSV</button>
                <button id="po-close">✕</button>
              </div>
              <div id="po-body">
                <div id="po-side">
                  <h4>Opleiding</h4>
                  <div class="po-mode">
                    <label><input type="radio" name="po-mode" value="any" checked> Eén van</label>
                    <label><input type="radio" name="po-mode" value="all"> Allemaal</label>
                  </div>
                  <div id="po-edu"></div>
                </div>
                <div id="po-tablewrap"><div id="po-msg">Laden…</div></div>
                <div id="po-stats" style="display:none"></div>
                <div id="po-bld" style="display:none">
                  <div class="po-bld-ctl">
                    <input id="po-bld-search" type="search" placeholder="Zoek gebouw / uitbreiding…" size="28">
                    <select id="po-bld-type"><option value="">Alle types</option></select>
                    <label><input type="radio" name="po-bld-show" value="all" checked> Alles</label>
                    <label><input type="radio" name="po-bld-show" value="building"> In aanbouw</label>
                    <label><input type="radio" name="po-bld-show" value="off"> Uitgeschakeld</label>
                    <label><input type="radio" name="po-bld-show" value="free"> Vrije parkeerplekken</label>
                  </div>
                  <div id="po-bld-body"><div id="po-msg">Laden…</div></div>
                </div>
                <div id="po-mis" style="display:none">
                  <div class="po-bld-ctl">
                    <input id="po-mis-search" type="search" placeholder="Zoek melding / gebouw / uitbreiding…" size="32">
                    <label>Nog nodig: <select id="po-mis-max">
                      <option value="1">1 stap</option><option value="2">max. 2 stappen</option>
                      <option value="3">max. 3 stappen</option><option value="5">max. 5 stappen</option>
                      <option value="10">max. 10 stappen</option><option value="999">alles</option>
                    </select></label>
                  </div>
                  <div id="po-mis-body"><div id="po-msg">Laden…</div></div>
                </div>
              </div>
              <div id="po-foot"><span id="po-count"></span><span id="po-age"></span></div>
            </div>`;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
            document.addEventListener('keydown', onKey);
            overlay.querySelector('#po-close').onclick = close;
            overlay.querySelector('#po-refresh').onclick = () => (state.tab === 'buildings' ? loadBuildingsTab(true)
                : state.tab === 'missions' ? loadMissionsTab(true) : refresh());
            overlay.querySelector('#po-csv').onclick = exportCsv;
            overlay.querySelector('#po-reset').onclick = () => {
                Object.assign(state, { search: '', building: '', status: '', eduMode: 'any' });
                state.eduSelected.clear();
                overlay.querySelector('#po-search').value = '';
                overlay.querySelector('input[name=po-mode][value=any]').checked = true;
                buildFilters();
                render();
            };
            overlay.querySelector('#po-search').oninput = e => { state.search = e.target.value.toLowerCase(); render(); };
            overlay.querySelector('#po-building').onchange = e => { state.building = e.target.value; render(); };
            overlay.querySelector('#po-status').onchange = e => { state.status = e.target.value; render(); };
            overlay.querySelectorAll('input[name=po-mode]').forEach(r => r.onchange = e => { state.eduMode = e.target.value; render(); });
            overlay.querySelector('#po-bld-search').oninput = e => { state.bldSearch = e.target.value.toLowerCase(); renderBuildings(); };
            overlay.querySelector('#po-bld-type').onchange = e => { state.bldType = e.target.value; renderBuildings(); };
            overlay.querySelectorAll('input[name=po-bld-show]').forEach(r => r.onchange = e => { state.bldShow = e.target.value; renderBuildings(); });
            overlay.querySelector('#po-mis-search').oninput = e => { state.misSearch = e.target.value.toLowerCase(); renderMissions(); };
            overlay.querySelector('#po-mis-max').value = String(state.misMax);
            overlay.querySelector('#po-mis-max').onchange = e => { state.misMax = Number(e.target.value); renderMissions(); };
            overlay.querySelectorAll('.po-tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
            tick = setInterval(() => { if (state.tab === 'buildings') renderBuildings(); }, CONFIG.TICK_MS);

            state.data = state.data || cache.get();
            if (state.data) buildFilters();
            switchTab(GM_getValue(CONFIG.TAB_KEY, 'table'));
        }

        // Reopens on the last used tab, so the construction list is one click away.
        function switchTab(tab) {
            state.tab = tab;
            GM_setValue(CONFIG.TAB_KEY, tab);
            if (tab === 'buildings') { showTab(tab); loadBuildingsTab(false); return; }
            if (tab === 'missions') { showTab(tab); loadMissionsTab(false); return; }
            if (state.data) render(); else refresh();
        }

        function close() {
            clearInterval(tick);
            document.removeEventListener('keydown', onKey);
            overlay?.remove();
            overlay = null;
        }
        const onKey = (e) => { if (e.key === 'Escape') close(); };

        async function refresh() {
            const wrap = overlay.querySelector('#po-tablewrap');
            showTab('table');  // progress messages live in the table area
            wrap.innerHTML = '<div id="po-msg">Gebouwen ophalen…</div>';
            try {
                state.data = await loadAll((d, t) => {
                    const m = overlay?.querySelector('#po-msg');
                    if (m) m.textContent = `Personeel laden… ${d} / ${t} gebouwen`;
                });
                cache.set(state.data);
            } catch (e) {
                warn(e);
                wrap.innerHTML = `<div id="po-msg">Laden mislukt: ${esc(e.message)}</div>`;
                return;
            }
            if (!overlay) return;
            buildFilters();
            render();
        }

        const eduList = (p) => (p.educations.length ? p.educations : [NO_EDU]);

        function buildFilters() {
            const people = state.data.people;
            const eduCounts = new Map();
            people.forEach(p => eduList(p).forEach(e => eduCounts.set(e, (eduCounts.get(e) || 0) + 1)));
            const edus = [...eduCounts.keys()].sort((a, b) => (a === NO_EDU) - (b === NO_EDU) || a.localeCompare(b));
            overlay.querySelector('#po-edu').innerHTML = edus.map(e => `
                <label><input type="checkbox" value="${esc(e)}" ${state.eduSelected.has(e) ? 'checked' : ''}>
                ${esc(e)}<span class="c">${eduCounts.get(e)}</span></label>`).join('');
            overlay.querySelectorAll('#po-edu input').forEach(cb => cb.onchange = () => {
                cb.checked ? state.eduSelected.add(cb.value) : state.eduSelected.delete(cb.value);
                render();
            });

            const fillSelect = (sel, values, allLabel) => {
                const el = overlay.querySelector(sel);
                const cur = el.value;
                el.innerHTML = `<option value="">${allLabel}</option>` +
                    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
                el.value = values.includes(cur) ? cur : '';
            };
            fillSelect('#po-building', [...new Set(people.map(p => p.building))].sort((a, b) => a.localeCompare(b)), 'Alle gebouwen');
            fillSelect('#po-status', [...new Set(people.map(p => p.status).filter(Boolean))].sort(), 'Alle statussen');
        }

        function filtered() {
            const sel = [...state.eduSelected];
            return state.data.people.filter(p => {
                if (state.building && p.building !== state.building) return false;
                if (state.status && p.status !== state.status) return false;
                if (state.search && !(`${p.name} ${p.vehicle}`.toLowerCase().includes(state.search))) return false;
                if (sel.length) {
                    const has = eduList(p);
                    if (state.eduMode === 'all' ? !sel.every(e => has.includes(e)) : !sel.some(e => has.includes(e))) return false;
                }
                return true;
            });
        }

        const COLUMNS = [
            { key: 'name', label: 'Naam', val: p => p.name },
            { key: 'building', label: 'Gebouw', val: p => p.building },
            { key: 'educations', label: 'Opleidingen', val: p => p.educations.join(', '), num: p => p.educations.length },
            { key: 'vehicle', label: 'Gekoppeld voertuig', val: p => p.vehicle },
            { key: 'status', label: 'Status', val: p => p.status },
        ];

        function render() {
            const col = COLUMNS.find(c => c.key === state.sortKey);
            const rows = filtered().sort((a, b) => {
                // Education column sorts by count first, then alphabetically.
                const d = col.num ? col.num(a) - col.num(b) : 0;
                return state.sortDir * (d || col.val(a).localeCompare(col.val(b), undefined, { numeric: true }))
                    || a.name.localeCompare(b.name);
            });

            const arrow = k => (k === state.sortKey ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '');
            const html = `<table id="po-table"><thead><tr>${COLUMNS.map(c =>
                `<th data-k="${c.key}">${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead><tbody>${rows.map(p => `
                <tr>
                  <td>${esc(p.name)}</td>
                  <td><a href="/buildings/${p.buildingId}/personals" target="_blank">${esc(p.building)}</a></td>
                  <td>${p.educations.length ? p.educations.map(e => `<span class="po-chip">${esc(e)}</span>`).join('') : `<span class="po-none">${NO_EDU}</span>`}</td>
                  <td>${p.vehicleId ? `<a href="/vehicles/${p.vehicleId}" target="_blank">${esc(p.vehicle)}</a>` : esc(p.vehicle)}</td>
                  <td>${esc(p.status)}</td>
                </tr>`).join('')}</tbody></table>`;
            const wrap = overlay.querySelector('#po-tablewrap');
            wrap.innerHTML = rows.length || state.data.people.length ? html : '<div id="po-msg">Geen personeel gevonden.</div>';
            wrap.querySelectorAll('th').forEach(th => th.onclick = () => {
                const k = th.dataset.k;
                state.sortDir = state.sortKey === k ? -state.sortDir : 1;
                state.sortKey = k;
                render();
            });

            if (state.tab === 'buildings' || state.tab === 'missions') return;  // personnel finished loading after a tab switch
            overlay.querySelector('#po-count').textContent = `${rows.length} van ${state.data.people.length} personeelsleden`
                + (state.data.failed ? ` · ${state.data.failed} gebouwen mislukt` : '');
            overlay.querySelector('#po-age').textContent = `Geladen: ${new Date(state.data.loadedAt).toLocaleString('nl-NL')}`;
            if (state.tab === 'stats') renderStats(rows);
            showTab(state.tab);
        }

        function showTab(tab) {
            overlay.querySelector('#po-tablewrap').style.display = tab === 'table' ? '' : 'none';
            overlay.querySelector('#po-stats').style.display = tab === 'stats' ? '' : 'none';
            overlay.querySelector('#po-bld').style.display = tab === 'buildings' ? 'flex' : 'none';
            overlay.querySelector('#po-mis').style.display = tab === 'missions' ? 'flex' : 'none';
            // Personnel filters mean nothing on the buildings and missions tabs.
            const personnel = tab !== 'buildings' && tab !== 'missions';
            overlay.querySelector('#po-side').style.display = personnel ? '' : 'none';
            ['#po-search', '#po-building', '#po-status', '#po-reset', '#po-csv']
                .forEach(sel => { overlay.querySelector(sel).style.display = personnel ? '' : 'none'; });
            overlay.querySelectorAll('.po-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        }

        /* ========================================================================
         * STATS TAB — uses the currently filtered people
         * ==================================================================== */
        // Categorical slots in fixed order (validated for a dark surface); the
        // 5th+ category folds into a neutral "Overig" slice.
        const PIE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
        const OTHER_COLOR = '#6b7079';
        const PANEL_BG = '#22262c';

        const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
        const nl = (n) => n.toLocaleString('nl-NL');

        function countBy(items, keyFn) {
            const m = new Map();
            items.forEach(x => [].concat(keyFn(x)).forEach(k => m.set(k, (m.get(k) || 0) + 1)));
            return [...m.entries()].sort((a, b) => b[1] - a[1]);
        }

        // entries: [[label, count], ...] already sorted. Returns donut + legend.
        function donut(title, entries) {
            let slices = entries.slice(0, PIE_COLORS.length).map(([l, v], i) => ({ l, v, c: PIE_COLORS[i] }));
            const rest = entries.slice(PIE_COLORS.length).reduce((s, [, v]) => s + v, 0);
            if (rest) slices.push({ l: 'Overig', v: rest, c: OTHER_COLOR });
            slices = slices.filter(s => s.v > 0);
            const total = slices.reduce((s, x) => s + x.v, 0);

            const R = 60, r = 38, C = 70;
            const pt = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
            let a0 = 0;
            const paths = slices.map(s => {
                const tip = `<title>${esc(s.l)}: ${nl(s.v)} (${pct(s.v, total)}%)</title>`;
                if (s.v === total) {
                    // Full ring: an arc path cannot draw 360°, so use a thick circle.
                    return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${s.c}" stroke-width="${R - r}">${tip}</circle>`;
                }
                const a1 = a0 + (s.v / total) * Math.PI * 2;
                const big = a1 - a0 > Math.PI ? 1 : 0;
                const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
                a0 = a1;
                return `<path d="M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z"
                    fill="${s.c}" stroke="${PANEL_BG}" stroke-width="2">${tip}</path>`;
            }).join('');

            const legend = slices.map(s => `
                <div class="po-bar" title="${esc(s.l)}: ${nl(s.v)}" style="grid-template-columns: 12px 1fr auto">
                  <span style="width:10px;height:10px;border-radius:2px;background:${s.c}"></span>
                  <span class="n">${esc(s.l)}</span>
                  <span class="c">${nl(s.v)} · ${pct(s.v, total)}%</span>
                </div>`).join('');

            return `<div class="po-card"><h4>${esc(title)}</h4>
                <div style="display:flex;gap:14px;align-items:center">
                  <svg viewBox="0 0 140 140" width="140" height="140" style="flex-shrink:0">${paths}
                    <text x="${C}" y="${C - 2}" text-anchor="middle" fill="#fff" font-size="18" font-weight="600">${nl(total)}</text>
                    <text x="${C}" y="${C + 14}" text-anchor="middle" fill="#9aa1ab" font-size="10">totaal</text>
                  </svg>
                  <div style="flex:1;min-width:0">${legend}</div>
                </div></div>`;
        }

        function bars(title, entries, total, limit) {
            const shown = entries.slice(0, limit);
            const max = shown.length ? shown[0][1] : 1;
            const more = entries.length - shown.length;
            return `<div class="po-card"><h4>${esc(title)}</h4>${shown.map(([l, v]) => `
                <div class="po-bar" title="${esc(l)}: ${nl(v)} (${pct(v, total)}%)">
                  <span class="n">${esc(l)}</span>
                  <span class="t"><span class="f" style="display:block;width:${(v / max) * 100}%"></span></span>
                  <span class="c">${nl(v)} · ${pct(v, total)}%</span>
                </div>`).join('')}
                ${more > 0 ? `<div class="po-none" style="padding-top:4px">+ ${more} meer</div>` : ''}</div>`;
        }

        function renderStats(people) {
            const box = overlay.querySelector('#po-stats');
            const n = people.length;
            if (!n) { box.innerHTML = '<div id="po-msg">Geen personeel binnen deze filters.</div>'; return; }

            const coupled = people.filter(p => p.vehicleId).length;
            const educated = people.filter(p => p.educations.length).length;
            const eduTotal = people.reduce((s, p) => s + p.educations.length, 0);
            const buildingCount = new Set(people.map(p => p.buildingId)).size;
            const vehicleCount = new Set(people.filter(p => p.vehicleId).map(p => p.vehicleId)).size;

            const eduCounts = countBy(people.filter(p => p.educations.length), p => p.educations);
            const perBuilding = countBy(people, p => p.building);
            const statusCounts = countBy(people, p => p.status || '(onbekend)');
            const eduBuckets = countBy(people, p => {
                const k = p.educations.length;
                return k === 0 ? 'Geen' : k >= 3 ? '3 of meer' : k === 1 ? '1 opleiding' : '2 opleidingen';
            });

            // --- fun facts ---
            const facts = [];
            const maxEdu = Math.max(...people.map(p => p.educations.length));
            if (maxEdu > 0) {
                const nerds = people.filter(p => p.educations.length === maxEdu);
                const nerd = nerds[0];
                facts.push(`🎓 <b>Studiebol:</b> ${esc(nerd.name)} <span class="s">(${esc(nerd.building)})</span> met <b>${maxEdu}</b> opleidingen`
                    + (nerds.length > 1 ? ` <span class="s">— en ${nerds.length - 1} anderen evenveel</span>` : ''));
            }
            const idle = people.filter(p => p.educations.length && !p.vehicleId).length;
            facts.push(`🛋️ <b>Onbenut talent:</b> ${nl(idle)} opgeleide mensen zonder voertuig`);
            if (eduCounts.length) {
                const [rare, rareN] = eduCounts[eduCounts.length - 1];
                facts.push(`🦄 <b>Zeldzaamste opleiding:</b> ${esc(rare)} <span class="s">(${nl(rareN)}×)</span>`);
                facts.push(`🏆 <b>Populairste opleiding:</b> ${esc(eduCounts[0][0])} <span class="s">(${nl(eduCounts[0][1])}×)</span>`);
            }
            const combos = countBy(people.filter(p => p.educations.length >= 2), p => [...p.educations].sort().join(' + '));
            if (combos.length) facts.push(`🧩 <b>Populairste combinatie:</b> ${esc(combos[0][0])} <span class="s">(${nl(combos[0][1])}×)</span>`);
            const firstNames = countBy(people, p => p.name.split(' ')[0]);
            if (firstNames.length) facts.push(`👋 <b>Populairste voornaam:</b> ${esc(firstNames[0][0])} <span class="s">(${nl(firstNames[0][1])}×)</span>`);
            const twins = countBy(people, p => p.name).filter(([, v]) => v > 1);
            facts.push(twins.length
                ? `👯 <b>Naamgenoten:</b> ${nl(twins.length)} namen komen vaker voor, bv. ${esc(twins[0][0])} <span class="s">(${twins[0][1]}×)</span>`
                : '👯 <b>Naamgenoten:</b> geen — iedereen is uniek');
            const longest = people.reduce((a, b) => (b.name.length > a.name.length ? b : a));
            facts.push(`📏 <b>Langste naam:</b> ${esc(longest.name)} <span class="s">(${longest.name.length} tekens)</span>`);
            const smart = countBy(people, p => p.buildingId)
                .filter(([, v]) => v >= 5)
                .map(([id, v]) => {
                    const staff = people.filter(p => p.buildingId === id);
                    return { name: staff[0].building, avg: staff.reduce((s, p) => s + p.educations.length, 0) / v };
                })
                .sort((a, b) => b.avg - a.avg);
            if (smart.length) facts.push(`🧠 <b>Slimste gebouw:</b> ${esc(smart[0].name)} <span class="s">(gem. ${smart[0].avg.toFixed(2)} opleidingen p.p.)</span>`);
            const crews = countBy(people.filter(p => p.vehicleId), p => p.vehicle);
            if (crews.length) facts.push(`🚒 <b>Grootste bemanning:</b> ${esc(crews[0][0])} <span class="s">(${crews[0][1]} personen)</span>`);
            if (perBuilding.length) facts.push(`🏢 <b>Drukste gebouw:</b> ${esc(perBuilding[0][0])} <span class="s">(${nl(perBuilding[0][1])} personen)</span>`);

            const tile = (v, l) => `<div class="po-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            box.innerHTML = `
                <div class="po-tiles">
                  ${tile(nl(n), 'personeelsleden')}
                  ${tile(nl(buildingCount), 'gebouwen')}
                  ${tile(`${pct(coupled, n)}%`, 'gekoppeld aan voertuig')}
                  ${tile(`${pct(educated, n)}%`, 'heeft een opleiding')}
                  ${tile((eduTotal / n).toFixed(2), 'opleidingen per persoon')}
                  ${tile(nl(vehicleCount), 'bemande voertuigen')}
                </div>
                <div class="po-grid">
                  ${donut('Gekoppeld aan voertuig', [['Gekoppeld', coupled], ['Niet gekoppeld', n - coupled]])}
                  ${donut('Aantal opleidingen per persoon', eduBuckets)}
                  ${donut('Status', statusCounts)}
                  ${donut('Opleidingen (verdeling)', eduCounts)}
                  <div class="po-card"><h4>Leuke weetjes</h4><ul class="po-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul></div>
                  ${bars('Opleidingen', eduCounts, n, 20)}
                  ${bars('Meeste personeel per gebouw', perBuilding, n, 10)}
                </div>`;
        }

        /* ========================================================================
         * BUILDINGS TAB — extensions per building, live from /api/buildings
         * ==================================================================== */
        const BUILDING_TYPE_LABEL = {
            0: 'Brandweer', 17: 'Brandweer',
            3: 'Ambulance', 13: 'Ambulance',
            5: 'Politie', 11: 'Politie', 18: 'Politie',
            6: 'Luchtvaart', 9: 'Luchtvaart', 19: 'Luchtvaart', 21: 'Luchtvaart',
            22: 'RWS',
            23: 'Defensie', 25: 'Defensie',
            1: 'Meldkamer',
            2: 'Ziekenhuis',
            4: 'Opleiding',
            8: 'Politieacademie',
            27: 'Spoor',
        };
        const typeLabel = (b) => BUILDING_TYPE_LABEL[b.building_type] || `Type ${b.building_type}`;

        // Buildings that never hold vehicles get no parking column.
        const NO_PARKING_TYPES = new Set([1, 2, 4, 8]);
        // Level is 0-based and each level adds one parking space: level 0 = 1 space.
        function parking(b) {
            if (NO_PARKING_TYPES.has(b.building_type) || typeof b.level !== 'number') return null;
            const total = b.level + 1;
            const used = state.bld.vehicleCount[b.id] || 0;
            return { total, used, free: Math.max(0, total - used) };
        }

        // An extension still under construction has available=false and an
        // available_at timestamp. enabled=false means built but switched off.
        const extState = (x) => (x.available === false ? 'building' : x.enabled === false ? 'off' : 'on');
        const extDone = (x) => { const t = Date.parse(x.available_at); return Number.isFinite(t) ? t : null; };

        function timeLeft(t) {
            if (t === null) return { text: 'onbekend', due: false };
            const ms = t - Date.now();
            if (ms <= 0) return { text: 'klaar — vernieuwen', due: true };
            const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
            return { text: d ? `${d}d ${h}u` : h ? `${h}u ${mm}m` : `${mm}m`, due: false };
        }
        const whenFmt = (t) => (t === null ? '' : new Date(t).toLocaleString('nl-NL',
            { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

        async function loadBuildingsTab(force) {
            if (state.bld && !force) { renderBuildings(); return; }
            overlay.querySelector('#po-bld-body').innerHTML = '<div id="po-msg">Gebouwen ophalen…</div>';
            try {
                const [buildings, vehicles] = await Promise.all([getBuildings(), getVehicles()]);
                const vehicleCount = {};
                vehicles.forEach(v => { vehicleCount[v.building_id] = (vehicleCount[v.building_id] || 0) + 1; });
                state.bld = { buildings, vehicleCount, loadedAt: Date.now() };
                const sample = buildings.find(b => (b.extensions || []).length);
                if (sample) log('sample building extensions:', sample.extensions, 'level:', sample.level, 'vehicles:', vehicleCount[sample.id]);
            } catch (e) {
                warn(e);
                if (overlay) overlay.querySelector('#po-bld-body').innerHTML = `<div id="po-msg">Laden mislukt: ${esc(e.message)}</div>`;
                return;
            }
            if (!overlay) return;
            const sel = overlay.querySelector('#po-bld-type');
            const types = [...new Set(state.bld.buildings.map(typeLabel))].sort((a, b) => a.localeCompare(b));
            sel.innerHTML = '<option value="">Alle types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
            sel.value = types.includes(state.bldType) ? state.bldType : '';
            state.bldType = sel.value;
            renderBuildings();
        }

        function renderBuildings() {
            if (!overlay || !state.bld) return;
            const all = state.bld.buildings;
            const exts = (b) => b.extensions || [];
            const q = state.bldSearch;

            const rows = all.filter(b => {
                if (state.bldType && typeLabel(b) !== state.bldType) return false;
                if (q && !`${b.caption} ${exts(b).map(x => x.caption).join(' ')}`.toLowerCase().includes(q)) return false;
                if (state.bldShow === 'building') return exts(b).some(x => extState(x) === 'building');
                if (state.bldShow === 'off') return b.enabled === false || exts(b).some(x => extState(x) === 'off');
                if (state.bldShow === 'free') return (parking(b)?.free || 0) > 0;
                return true;
            }).sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)) || a.caption.localeCompare(b.caption, undefined, { numeric: true }));

            // Construction queue over ALL buildings (ignores filters), soonest first.
            const queue = all.flatMap(b => exts(b).filter(x => extState(x) === 'building').map(x => ({ b, x, t: extDone(x) })))
                .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
            const extTotal = all.reduce((s, b) => s + exts(b).length, 0);
            const extOff = all.reduce((s, b) => s + exts(b).filter(x => extState(x) === 'off').length, 0);
            const bldOff = all.filter(b => b.enabled === false).length;
            const freeTotal = all.reduce((s, b) => s + (parking(b)?.free || 0), 0);
            const freeBuildings = all.filter(b => (parking(b)?.free || 0) > 0).length;
            const parkCell = (b) => {
                const p = parking(b);
                if (!p) return '<span class="po-none">—</span>';
                return `<span class="${p.free ? 'po-free' : 'po-full'}" title="${p.used} voertuigen op ${p.total} plekken">`
                    + `${p.free ? `${p.free} vrij` : 'vol'} <span class="po-none">(${p.used}/${p.total})</span></span>`;
            };

            const link = (b) => `<a href="/buildings/${b.id}" target="_blank">${esc(b.caption)}</a>`;
            const tile = (v, l) => `<div class="po-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            const chip = (x) => {
                const st = extState(x);
                if (st !== 'building') return `<span class="po-chip ${st}" title="${st === 'on' ? 'Actief' : 'Uitgeschakeld'}">${esc(x.caption)}</span>`;
                const t = extDone(x);
                return `<span class="po-chip bld" title="In aanbouw — klaar ${esc(whenFmt(t))}">🏗️ ${esc(x.caption)} · ${esc(timeLeft(t).text)}</span>`;
            };

            const queueHtml = queue.length ? `
                <div class="po-card"><h4>In aanbouw (${queue.length})</h4>
                  <table class="po-table"><thead><tr><th>Klaar over</th><th>Klaar op</th><th>Uitbreiding</th><th>Gebouw</th></tr></thead><tbody>
                  ${queue.map(({ b, x, t }) => { const left = timeLeft(t); return `
                    <tr><td class="po-when${left.due ? ' due' : ''}">${esc(left.text)}</td><td>${esc(whenFmt(t))}</td>
                        <td>${esc(x.caption)}</td><td>${link(b)}</td></tr>`; }).join('')}
                  </tbody></table></div>`
                : '<div class="po-card"><h4>In aanbouw</h4><span class="po-none">Er wordt nu niets gebouwd.</span></div>';

            overlay.querySelector('#po-bld-body').innerHTML = `
                <div class="po-tiles">
                  ${tile(nl(all.length), 'gebouwen')}
                  ${tile(nl(extTotal), 'uitbreidingen')}
                  ${tile(nl(queue.length), 'in aanbouw')}
                  ${tile(queue.length ? esc(timeLeft(queue[0].t).text) : '—', 'eerstvolgende klaar')}
                  ${tile(nl(extOff), 'uitbreidingen uit')}
                  ${tile(nl(bldOff), 'gebouwen uit')}
                  ${tile(nl(freeTotal), `vrije parkeerplekken (${nl(freeBuildings)} gebouwen)`)}
                </div>
                ${queueHtml}
                <div class="po-card" style="margin-top:14px"><h4>Alle gebouwen (${rows.length})</h4>
                  <table class="po-table"><thead><tr><th>Gebouw</th><th>Type</th><th>Status</th><th>Parkeerplekken</th><th>Uitbreidingen</th></tr></thead><tbody>
                  ${rows.map(b => `
                    <tr class="${b.enabled === false ? 'po-bld-off' : ''}">
                      <td>${link(b)}</td>
                      <td>${esc(typeLabel(b))}</td>
                      <td>${b.enabled === false ? '<span class="po-none">Uitgeschakeld</span>' : 'Actief'}</td>
                      <td style="white-space:nowrap">${parkCell(b)}</td>
                      <td>${exts(b).length ? exts(b).map(chip).join('') : '<span class="po-none">geen</span>'}</td>
                    </tr>`).join('')}
                  </tbody></table></div>`;

            overlay.querySelector('#po-count').textContent = `${rows.length} van ${all.length} gebouwen`;
            overlay.querySelector('#po-age').textContent = `Geladen: ${new Date(state.bld.loadedAt).toLocaleString('nl-NL')}`;
        }

        /* ========================================================================
         * MISSIONS TAB — which missions are closest to being unlocked.
         * The game's public /einsaetze.json lists per mission its
         * "prerequisites": how many buildings, extensions and trained staff
         * you need before it can spawn. We count the same things from
         * /api/buildings and show the gap.
         * ==================================================================== */
        // types: building types counted; ext: extension captions counted.
        // Labels follow the game's own help pages (/einsaetze/{id}).
        const PREREQ = {
            fire_stations: { label: 'Brandweerkazerne', types: [0, 17] },
            rescue_stations: { label: 'Ambulancestandplaats', types: [3, 13] },
            police_stations: { label: 'Politiebureau', types: [5, 18] },
            bereitschaftspolizei: { label: 'Politie hoofdbureau', types: [11] },
            police_helicopter_stations: { label: 'Politiehelikopter standplaats', types: [9] },
            water_rescue_2: { label: 'Waterreddingspost', types: [16] },
            coastal_rescue_count: { label: 'Kustwacht haven', types: [19] },
            coastal_helicopter_count: { label: 'SAR Helikopter platform', types: [21] },
            // A Berger-K extension counts as a tow station too: checked live, a
            // player without Berger standplaatsen gets the "tow_trucks: 2" missions.
            tow_trucks: { label: 'Berger standplaats / Berger-K', types: [24], ext: /^Berger-K/i },
            railway: { label: 'Standplaats Incidentenbestrijding spoor', types: [27] },
            military_police: { label: 'Kazerne defensie', types: [25] },
            fire_aviation_count: { label: 'Militaire hangar', types: [23] },
            technical_aid: { label: 'RWS-steunpunt / Signalisatie', types: [22], ext: /^Signalisatie/i },
            tow_trucks_large: { label: 'Berger-G', ext: /^Berger-G/i },
            fire_support_count: { label: 'Schuimblussing', ext: /^Schuimblus/i },
            brush_extension: { label: 'Natuurbrandbestrijding', ext: /^Natuurbrandbestrijding/i },
            thatched_fire: { label: 'Rietkapbrandbestrijding', ext: /^Rietkap/i },
            livestock_fire: { label: 'Veetakels', ext: /^Veetakel/i },
            industrial_response_fire: { label: 'Industriële Brandbestrijding', ext: /^Industri.le Brandbestrijding/i },
            hazard_response_fire: { label: 'Incidentbestrijding Gevaarlijke Stoffen', ext: /^Incidentbestrijding Gevaarlijke Stoffen/i },
            wasserrettung: { label: 'Waterongevallenbestrijding', ext: /^Waterongevallenbestrijding/i },
            airport: { label: 'Vliegtuigbrandbestrijding', ext: /^Vliegtuigbrandbestrijding/i },
            railway_fire: { label: 'Incidentenbestrijding spoor (uitbreiding)', ext: /^Incidentenbestrijding spoor/i },
            mass_casualty_count: { label: 'Grootschalige Geneeskundige Bijstand', ext: /^Grootschalige Geneeskundige Bijstand/i },
            disaster_response_count: { label: 'Specialisme Technische Hulpverlening', ext: /^Specialisme Technische Hulpverlening/i },
            search_and_rescue: { label: 'Urban Search and Rescue', ext: /^Urban Search and Rescue/i },
            care_service: { label: 'Verzorgingseenheid', ext: /^Verzorgingseenheid/i },
            clean_service: { label: 'Arbeidshygiëne', ext: /^Arbeidshygi/i },
            drone_fire: { label: 'Team Digitale Verkenning', ext: /^Team Digitale Verkenning/i },
            drone_police: { label: 'Drone Team Politie', ext: /^Drone Team Politie/i },
            traffic_police: { label: 'LE - Dienst Infrastructuur', ext: /^LE - Dienst Infrastructuur/i },
            hondengeleider: { label: 'Hondenbrigade', ext: /^Hondenbrigade/i },
            police_horse: { label: 'Bereden Brigade', ext: /^Bereden Brigade/i },
            riot_unit_count: { label: 'Mobiele Eenheid, Sectie', ext: /^Mobiele Eenheid, (2e )?Sectie/i },
            detention_unit_count: { label: 'Mobiele Eenheid, Aanhoudingseenheid', ext: /Aanhoudingseenheid/i },
            prisoner_transport_count: { label: 'Arrestantenvervoer', ext: /^Arrestantenvervoer/i },
            water_cannon: { label: 'Waterwerper', ext: /^Waterwerper/i },
            at: { label: 'Arrestatieteam', ext: /^Arrestatieteam/i },
            bomb_disposal_count: { label: 'Explosieven Opruimingsdienst', ext: /^Explosieven Opruimingsdienst/i },
            bomb_disposal_diver: { label: 'Defensie Duikgroep', ext: /^Defensie Duikgroep/i },
            bomb_disposal_patrol: { label: 'TEV', ext: /\bTEV\b|Technische Explosieven/i },
            coastal_rescue_small_count: { label: 'Boten', ext: /^Boten|\bboot/i },
        };
        // The building type a mission comes from must exist (main_building -1: none).
        const MAIN_BUILDING = { 0: 'fire_stations', 3: 'rescue_stations', 5: 'police_stations', 11: 'bereitschaftspolizei',
            16: 'water_rescue_2', 19: 'coastal_rescue_count', 24: 'tow_trucks', 25: 'military_police', 27: 'railway' };
        // Trained staff, counted from the (cached) personnel table.
        const EDU = {
            police_motorcycle: { label: 'Motoragent', re: /motoragent/i },
            wildfire: { label: 'Handcrew', re: /handcrew/i },
        };
        const SKIP_KEYS = new Set(['main_building', 'max_police_stations', 'personnel_educations']);

        // Extensions still under construction do not count yet.
        function countPrereqs(buildings) {
            const have = {};
            for (const [key, def] of Object.entries(PREREQ)) {
                let n = 0;
                for (const b of buildings) {
                    if (def.types && def.types.includes(b.building_type)) n++;
                    if (def.ext) n += (b.extensions || []).filter(x => x.available !== false && def.ext.test(x.caption || '')).length;
                }
                have[key] = n;
            }
            return have;
        }

        function countEducations() {
            const people = state.data && state.data.people;
            if (!people) return null;
            const have = {};
            for (const [key, def] of Object.entries(EDU)) have[key] = people.filter(p => p.educations.some(e => def.re.test(e))).length;
            return have;
        }

        async function loadMissionsTab(force) {
            if (state.mis && !force) { renderMissions(); return; }
            overlay.querySelector('#po-mis-body').innerHTML = '<div id="po-msg">Meldingen en gebouwen ophalen…</div>';
            try {
                // The mission list (~3 MB) only changes with game updates: fetched once per page.
                const missions = state.mis ? state.mis.missions : await fetchWithTimeout('/einsaetze.json', { headers: { Accept: 'application/json' } })
                    .then(r => { if (!r.ok) throw new Error(`GET /einsaetze.json failed: ${r.status}`); return r.json(); });
                const buildings = await getBuildings();
                state.mis = { missions, buildings, loadedAt: Date.now() };
                const unknown = new Set();
                missions.forEach(m => Object.keys(m.prerequisites || {}).forEach(k => { if (!PREREQ[k] && !SKIP_KEYS.has(k)) unknown.add(k); }));
                if (unknown.size) log('unknown mission prerequisites:', [...unknown]);
            } catch (e) {
                warn(e);
                if (overlay) overlay.querySelector('#po-mis-body').innerHTML = `<div id="po-msg">Laden mislukt: ${esc(e.message)}</div>`;
                return;
            }
            renderMissions();
        }

        // Gaps of one mission: [{ key, label, need, have }], have null = unknown.
        function missionGaps(m, have, edu) {
            const pre = m.prerequisites || {};
            const need = {};
            for (const [k, v] of Object.entries(pre)) if (typeof v === 'number' && !SKIP_KEYS.has(k)) need[k] = v;
            const main = MAIN_BUILDING[pre.main_building];
            if (main) need[main] = Math.max(need[main] || 0, 1);
            const gaps = [];
            for (const [k, v] of Object.entries(need)) {
                if (!PREREQ[k]) gaps.push({ key: k, label: k, need: v, have: null });
                else if (have[k] < v) gaps.push({ key: k, label: PREREQ[k].label, need: v, have: have[k] });
            }
            for (const [k, v] of Object.entries(pre.personnel_educations || {})) {
                const h = edu && typeof edu[k] === 'number' ? edu[k] : null;
                if (h === null || h < v) gaps.push({ key: `edu:${k}`, label: `personeel met ${EDU[k] ? EDU[k].label : k}`, need: v, have: h });
            }
            return gaps;
        }

        function renderMissions() {
            if (!overlay || !state.mis) return;
            const { missions, buildings } = state.mis;
            const have = countPrereqs(buildings);
            const edu = countEducations();
            const now = Date.now();

            // Event missions only count while their event runs.
            const live = missions.filter(m => {
                const a = m.additional || {};
                const start = Date.parse(a.date_start), end = Date.parse(a.date_end);
                return !(start > now) && !(end < now);
            });
            // One entry per mission name: the easiest variant decides when it shows up.
            const byName = new Map();
            const gone = new Set();
            for (const m of live) {
                const max = (m.prerequisites || {}).max_police_stations;
                if (typeof max === 'number' && have.police_stations > max) { gone.add(m.name); continue; }
                const gaps = missionGaps(m, have, edu);
                // Unknown counts (personnel not loaded) count as fully missing.
                const steps = gaps.reduce((s, g) => s + g.need - (g.have || 0), 0);
                const cur = byName.get(m.name);
                if (!cur || (cur.gaps.length && (!gaps.length || steps < cur.steps))) {
                    byName.set(m.name, { m, gaps, steps, event: !!(m.additional || {}).date_end });
                }
            }
            byName.forEach((x, name) => gone.delete(name));
            const all = [...byName.values()];
            const open = all.filter(x => !x.gaps.length);
            const locked = all.filter(x => x.gaps.length);

            // Group locked missions by exactly what is missing.
            const groups = new Map();
            for (const x of locked) {
                const k = x.gaps.map(g => `${g.key}:${g.need}`).sort().join('|');
                if (!groups.has(k)) groups.set(k, { gaps: x.gaps, steps: x.steps, list: [] });
                groups.get(k).list.push(x);
            }
            const gapText = (g) => (g.have === null ? `${g.need}× ${g.label} (?)` : `+${g.need - g.have} ${g.label}`);
            const q = state.misSearch;
            const rows = [...groups.values()]
                .filter(g => g.steps <= state.misMax)
                .filter(g => !q || `${g.gaps.map(gapText).join(' ')} ${g.list.map(x => x.m.name).join(' ')}`.toLowerCase().includes(q))
                .sort((a, b) => a.steps - b.steps || b.list.length - a.list.length);

            // What exactly one more building or extension unlocks.
            const single = new Map();
            for (const x of locked) {
                const g = x.gaps[0];
                if (x.gaps.length === 1 && g.have !== null && g.need - g.have === 1) single.set(g.label, (single.get(g.label) || 0) + 1);
            }
            const best = [...single.entries()].sort((a, b) => b[1] - a[1]);
            const oneMore = best.reduce((s, [, n]) => s + n, 0);

            const helpUrl = (m) => {
                const p = new URLSearchParams();
                if (m.additive_overlays) p.set('additive_overlays', m.additive_overlays);
                if (m.overlay_index !== null && m.overlay_index !== undefined) p.set('overlay_index', m.overlay_index);
                const qs = p.toString();
                return `/einsaetze/${m.base_mission_id ?? m.id}${qs ? `?${qs}` : ''}`;
            };
            const missionLink = (x) => `<a href="${helpUrl(x.m)}" target="_blank" title="± ${nl(x.m.average_credits || 0)} credits">${esc(x.m.name)}</a>`
                + (x.event ? '<span class="po-mis-ev" title="Tijdelijke evenementmelding"> 📅</span>' : '');
            const listHtml = (list) => {
                const sorted = list.slice().sort((a, b) => (b.m.average_credits || 0) - (a.m.average_credits || 0));
                const more = sorted.length > 8
                    ? `<details><summary>+ ${sorted.length - 8} meer</summary>${sorted.slice(8).map(missionLink).join('')}</details>` : '';
                return `<div class="po-mis-list">${sorted.slice(0, 8).map(missionLink).join('')}${more}</div>`;
            };
            const tile = (v, l) => `<div class="po-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            const shown = rows.reduce((s, g) => s + g.list.length, 0);

            overlay.querySelector('#po-mis-body').innerHTML = `
                <div class="po-tiles">
                  ${tile(nl(open.length), `meldingen vrijgespeeld (van ${nl(all.length)})`)}
                  ${tile(nl(locked.length), 'nog op slot')}
                  ${tile(nl(oneMore), 'vrij met 1 extra gebouw of uitbreiding')}
                </div>
                ${best.length ? `<div class="po-card"><h4>Bouw er nog één bij</h4>
                  <table class="po-table"><thead><tr><th>Nog 1 extra</th><th>Nieuwe meldingen</th></tr></thead><tbody>
                  ${best.map(([l, n]) => `<tr><td>${esc(l)}</td><td class="po-mis-n">+${nl(n)}</td></tr>`).join('')}
                  </tbody></table></div>` : ''}
                ${edu ? '' : '<div class="po-none">Personeel nog niet geladen: eisen voor opgeleid personeel (zoals Handcrew) zijn onbekend (?). Open de tab Tabel om het te laden.</div>'}
                <div class="po-card"><h4>Dichtst bij vrijspelen (${nl(shown)} meldingen)</h4>
                  ${rows.length ? `<table class="po-table"><thead><tr><th>Nog nodig</th><th>Meldingen</th><th>Welke</th></tr></thead><tbody>
                  ${rows.map(g => `<tr>
                      <td style="min-width:220px">${g.gaps.map(x => `<span class="po-gap${x.have === null ? ' unk' : ''}" title="${esc(x.label)}: je hebt ${x.have === null ? '?' : x.have}, nodig ${x.need}">${esc(gapText(x))}</span>`).join('')}</td>
                      <td class="po-mis-n">${nl(g.list.length)}</td>
                      <td>${listHtml(g.list)}</td></tr>`).join('')}
                  </tbody></table>` : '<span class="po-none">Geen meldingen binnen deze filter.</span>'}
                </div>
                <div class="po-none">Volgens de voorwaarden van het spel (/einsaetze.json). Uitbreidingen in aanbouw tellen nog niet mee.
                  ${gone.size ? `${nl(gone.size)} meldingen komen niet meer, omdat je meer politiebureaus hebt dan het maximum.` : ''}</div>`;

            overlay.querySelector('#po-count').textContent = `${nl(open.length)} van ${nl(all.length)} meldingen vrijgespeeld`;
            overlay.querySelector('#po-age').textContent = `Geladen: ${new Date(state.mis.loadedAt).toLocaleString('nl-NL')}`;
        }

        function exportCsv() {
            if (!state.data) return;
            const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const lines = [COLUMNS.map(c => q(c.label)).join(';')]
                .concat(filtered().map(p => COLUMNS.map(c => q(c.val(p))).join(';')));
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
            a.download = 'personeel.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        /* ========================================================================
         * ENTRY BUTTON
         * ==================================================================== */
        function addButton() {
            ctx.menu({ icon: '👥', label: 'Personeel', title: 'Alle personeel', run: () => { if (!overlay) open(); } });
            ctx.actions([{ label: 'Openen', kind: 'primary', run: () => { if (!overlay) open(); } }]);
        }

        addButton();
    },
});

/* ==== module: income-tracker ============================================== */
MKS.module({
    id: 'income-tracker',
    name: 'Inkomsten',
    icon: '💰',
    category: 'tools',
    description: 'Houdt op de achtergrond je credits bij en toont inkomsten per uur, per dag en per weekdag/uur, uitgaven, een spaardoel met verwachte datum '
        + 'en (uit het creditlogboek van het spel) welke inzetten het meeste opleveren.',
    tagline: 'Meet op de achtergrond',
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'navBadge', label: 'Tempo in navigatiebalk', type: 'bool', default: true,
            help: 'Toont credits per uur als los item in de navigatiebalk. Uit = alleen in het menu Wheeliecat\'s scripts.' },
        { key: 'sampleMin', label: 'Meten elke', type: 'number', default: 5, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rateHours', label: 'Tempo over de laatste', type: 'number', default: 3, min: 1, max: 24, step: 1, unit: 'uur' },
        { key: 'autoLog', label: 'Credit-logboek automatisch bijhouden', type: 'bool', default: true,
            help: 'Leest op de achtergrond de nieuwe regels van het credit-logboek en bewaart ze in je browser. Zo bouw je een geschiedenis op die langer is dan het spel zelf toont.' },
        { key: 'logMin', label: 'Logboek bijwerken elke', type: 'number', default: 15, min: 5, max: 120, step: 5, unit: 'min' },
    ],

    run(ctx) {

        /* ========================================================================
         * CONFIG
         * ==================================================================== */
        const CONFIG = {
            SAMPLE_MS: ctx.cfg.sampleMin * 60000, // regular /api/credits poll
            MIN_GAP_MS: 60000,         // never sample more often than this (all tabs together)
            LIVE_DEBOUNCE_MS: 60000,   // after a live credit update, sample once within this
            GAP_S: 20 * 60,            // interval longer than this = no tab open ("offline")
            RAW_DAYS: 14,              // keep every sample this long
            KEEP_DAYS: 400,            // after RAW_DAYS keep one sample per hour, until this
            RATE_WINDOW_H: ctx.cfg.rateHours,     // navbar rate: earned per online hour over this window
            BADGE_MS: 60000,
            LOG_MAX_PAGES: 30,         // credit log pages fetched on the first import
            LOG_SYNC_PAGES: 10,        // max pages per later sync (normally 1 is enough)
            LOG_DAYS: 14,              // first import: stop when rows get older than this
            LOG_RAW_DAYS: 14,          // keep single log rows this long, then fold them per day
            LOG_ANCHOR: 5,             // consecutive rows that must match to find the overlap
            LOG_SYNC_MS: ctx.cfg.logMin * 60000,
            LOG_DELAY_MS: 400,
            REQUEST_TIMEOUT_MS: 20000,
            SAMPLES_KEY: 'incomeTracker.samples.v1',
            LAST_KEY: 'incomeTracker.lastSample',
            GOAL_KEY: 'incomeTracker.goal',
            TAB_KEY: 'incomeTracker.tab',
            LOG_RANGE_KEY: 'incomeTracker.logRange',
            LOG_KEY: 'incomeTracker.log.v2',
            LOG_KEY_V1: 'incomeTracker.log.v1',
            LOG_LAST_KEY: 'incomeTracker.logLastSync',
        };

        const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const log = (...a) => console.log('[income-tracker]', ...a);
        const warn = (...a) => console.warn('[income-tracker]', ...a);
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        async function fetchWithTimeout(url, opts) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { credentials: 'same-origin', ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        /* ========================================================================
         * SAMPLING
         * ====================================================================
         * A sample is [unixSeconds, currentBalance, totalEverEarned].
         * credits_user_total only grows when you earn, so between two samples:
         *   earned = Δtotal
         *   spent  = Δtotal − Δbalance
         * No need to see every single transaction to get exact totals.
         * ==================================================================== */
        const loadSamples = () => {
            try { return JSON.parse(GM_getValue(CONFIG.SAMPLES_KEY, '[]')) || []; } catch (e) { return []; }
        };
        const saveSamples = (s) => GM_setValue(CONFIG.SAMPLES_KEY, JSON.stringify(s));

        async function getCredits() {
            const res = await fetchWithTimeout('/api/credits', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET /api/credits failed: ${res.status}`);
            const j = await res.json();
            const cur = Number(j.credits_user_current);
            const tot = Number(j.credits_user_total);
            if (!Number.isFinite(cur) || !Number.isFinite(tot)) throw new Error('unexpected /api/credits shape: ' + JSON.stringify(j).slice(0, 200));
            return { cur, tot };
        }

        // Keep every sample for RAW_DAYS; older ones thin out to the last sample
        // of each hour. Keeping interval end points keeps all totals exact.
        function compact(samples) {
            const now = Date.now() / 1000;
            const rawFrom = now - CONFIG.RAW_DAYS * 86400;
            const dropFrom = now - CONFIG.KEEP_DAYS * 86400;
            const out = [];
            for (let i = 0; i < samples.length; i++) {
                const s = samples[i];
                if (s[0] < dropFrom) continue;
                if (s[0] >= rawFrom) { out.push(s); continue; }
                const next = samples[i + 1];
                if (!next || Math.floor(next[0] / 3600) !== Math.floor(s[0] / 3600)) out.push(s);
            }
            return out;
        }

        let sampling = false;
        async function sample(force) {
            if (sampling) return;
            const last = Number(GM_getValue(CONFIG.LAST_KEY, 0));
            if (!force && Date.now() - last < CONFIG.MIN_GAP_MS) return;
            sampling = true;
            GM_setValue(CONFIG.LAST_KEY, Date.now());  // claim the slot before the request (other tabs)
            try {
                const { cur, tot } = await getCredits();
                const samples = loadSamples();
                const prev = samples[samples.length - 1];
                const t = Math.round(Date.now() / 1000);
                // Same values as last time and <1h apart: only move the end point.
                // Saves storage while idle, totals stay the same.
                const prev2 = samples[samples.length - 2];
                if (prev && prev2 && prev[1] === cur && prev[2] === tot && prev2[1] === cur && prev2[2] === tot
                    && t - prev2[0] < 3600 && t - prev[0] <= CONFIG.GAP_S) {
                    prev[0] = t;
                } else {
                    samples.push([t, cur, tot]);
                }
                saveSamples(compact(samples));
                live.cur = cur;
                live.tot = tot;
                updateBadge();
                if (overlay) render();
            } catch (e) {
                warn('sample failed', e);
            } finally {
                sampling = false;
            }
        }

        // creditsUpdate() is the game's live navbar updater. Wrap it so a change
        // triggers a (debounced) sample. Must go through unsafeWindow: the game
        // calls the page's global, not the sandbox copy.
        const live = { cur: null, tot: null };
        let liveTimer = null;
        function hookLive() {
            const orig = W.creditsUpdate;
            if (typeof orig !== 'function') return false;
            W.creditsUpdate = function (c) {
                try {
                    const n = Number(c);
                    if (Number.isFinite(n)) live.cur = n;
                    if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = null; sample(false); }, CONFIG.LIVE_DEBOUNCE_MS);
                } catch (e) { warn('hook error', e); }
                return orig.apply(this, arguments);
            };
            return true;
        }

        /* ========================================================================
         * ANALYSIS
         * ==================================================================== */
        // Intervals between consecutive samples, in ms.
        function intervals(samples) {
            const out = [];
            for (let i = 1; i < samples.length; i++) {
                const [t0, c0, s0] = samples[i - 1], [t1, c1, s1] = samples[i];
                if (t1 <= t0) continue;
                const earned = Math.max(0, s1 - s0);
                const spent = Math.max(0, earned - (c1 - c0));
                out.push({ t0: t0 * 1000, t1: t1 * 1000, earned, spent, online: t1 - t0 <= CONFIG.GAP_S });
            }
            return out;
        }

        // Local-time bucket boundaries (DST safe: Date does the calendar math).
        const floorHour = (t) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
        const nextHour = (t) => { const d = new Date(t); d.setMinutes(60, 0, 0); return d.getTime(); };
        const floorDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const nextDay = (t) => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
        const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

        // Spread each interval over hour or day buckets, pro rata by time.
        // Bucket: { earned, spent, earnedOn, onlineMs, trackedMs }.
        function bucketize(ivs, unit) {
            const floor = unit === 'day' ? floorDay : floorHour;
            const next = unit === 'day' ? nextDay : nextHour;
            const m = new Map();
            for (const iv of ivs) {
                const len = iv.t1 - iv.t0;
                let t = iv.t0;
                while (t < iv.t1) {
                    const b = floor(t);
                    const end = Math.min(next(t), iv.t1);
                    const f = (end - t) / len;
                    let k = m.get(b);
                    if (!k) m.set(b, k = { earned: 0, spent: 0, earnedOn: 0, onlineMs: 0, trackedMs: 0 });
                    k.earned += iv.earned * f;
                    k.spent += iv.spent * f;
                    k.trackedMs += end - t;
                    if (iv.online) { k.earnedOn += iv.earned * f; k.onlineMs += end - t; }
                    t = end;
                }
            }
            return m;
        }

        function sumRange(ivs, from, to) {
            const r = { earned: 0, spent: 0, earnedOn: 0, onlineMs: 0 };
            for (const iv of ivs) {
                const a = Math.max(iv.t0, from), b = Math.min(iv.t1, to);
                if (b <= a) continue;
                const f = (b - a) / (iv.t1 - iv.t0);
                r.earned += iv.earned * f;
                r.spent += iv.spent * f;
                if (iv.online) { r.earnedOn += iv.earned * f; r.onlineMs += b - a; }
            }
            return r;
        }

        function analyse() {
            const samples = loadSamples();
            const ivs = intervals(samples);
            const now = Date.now();
            const today = floorDay(now);
            const days = bucketize(ivs, 'day');
            const hours = bucketize(ivs, 'hour');

            const t = sumRange(ivs, today, now);
            // Yesterday from midnight up to the same clock time as now.
            const yesterdaySoFar = sumRange(ivs, addDays(today, -1), addDays(today, -1) + (now - today));
            const lastHour = sumRange(ivs, now - 3600e3, now);
            const rateWin = sumRange(ivs, now - CONFIG.RATE_WINDOW_H * 3600e3, now);
            const week = sumRange(ivs, addDays(today, -6), now);
            const month = sumRange(ivs, addDays(today, -29), now);

            let bestDay = null, bestHour = null;
            for (const [k, v] of days) if (!bestDay || v.earned > bestDay.v.earned) bestDay = { k, v };
            for (const [k, v] of hours) {
                // Only hours you were actually online for most of the time.
                if (v.onlineMs < 45 * 60e3) continue;
                if (!bestHour || v.earnedOn > bestHour.v.earnedOn) bestHour = { k, v };
            }

            // Net per wall-clock hour over up to 7 days, for the goal ETA.
            const etaFrom = Math.max(addDays(today, -6), samples.length ? samples[0][0] * 1000 : now);
            const etaSpan = (now - etaFrom) / 3600e3;
            const netPerHour = etaSpan >= 1 ? (week.earned - week.spent) / etaSpan : null;
            const grossPerHour = etaSpan >= 1 ? week.earned / etaSpan : null;

            const lastS = samples[samples.length - 1];
            return {
                samples, ivs, days, hours, now, today,
                cur: live.cur ?? (lastS ? lastS[1] : null),
                tot: lastS ? lastS[2] : null,
                first: samples.length ? samples[0][0] * 1000 : null,
                t, yesterdaySoFar, lastHour, week, month,
                rate: rateWin.onlineMs >= 15 * 60e3 ? rateWin.earnedOn / (rateWin.onlineMs / 3600e3) : null,
                todayRate: t.onlineMs >= 15 * 60e3 ? t.earnedOn / (t.onlineMs / 3600e3) : null,
                bestDay, bestHour, netPerHour, grossPerHour,
            };
        }

        /* ========================================================================
         * CREDIT LOG (game's /credits page)
         * ====================================================================
         * Parsed by content, not by fixed column position: amount = numeric
         * cell, date = date-like cell, description = the rest. Headers are used
         * when they are recognisable.
         * ==================================================================== */
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const AMOUNT_RE = /^[+\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\s*(?:credits?)?$/i;
        const MONTHS = { jan: 0, feb: 1, mrt: 2, maa: 2, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, dec: 11 };

        function parseAmount(text, td) {
            const neg = /^[\-−–]/.test(text.trim()) || /danger|negative|minus/i.test(td ? td.className + ' ' + td.innerHTML : '');
            const n = Number(text.replace(/,\d+$/, '').replace(/[^\d]/g, ''));
            return neg ? -n : n;
        }

        function parseDate(text) {
            const s = text.toLowerCase();
            const time = s.match(/(\d{1,2}):(\d{2})/);
            const hh = time ? +time[1] : 0, mm = time ? +time[2] : 0;
            let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (m) return new Date(+m[1], m[2] - 1, +m[3], hh, mm).getTime();
            m = s.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
            if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, m[2] - 1, +m[1], hh, mm).getTime(); }
            m = s.match(/(\d{1,2})\.?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/);
            if (m && m[2] in MONTHS) {
                const now = new Date();
                let y = m[3] ? +m[3] : now.getFullYear();
                let d = new Date(y, MONTHS[m[2]], +m[1], hh, mm);
                if (!m[3] && d.getTime() > now.getTime() + 86400e3) d = new Date(y - 1, MONTHS[m[2]], +m[1], hh, mm);
                return d.getTime();
            }
            if (/vandaag|today/.test(s) && time) { const d = new Date(); d.setHours(hh, mm, 0, 0); return d.getTime(); }
            if (/gisteren|yesterday/.test(s) && time) { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(hh, mm, 0, 0); return d.getTime(); }
            if (/geleden|ago/.test(s)) {
                const n = +(s.match(/(\d+)/) || [0, 0])[1];
                const unit = /min/.test(s) ? 60e3 : /uur|hour/.test(s) ? 3600e3 : /dag|day/.test(s) ? 86400e3 : 0;
                if (unit) return Date.now() - n * unit;
            }
            return null;
        }
        const DATE_LIKE = (s) => /\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|geleden|ago|vandaag|gisteren/i.test(s);

        function parseCreditLog(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            let best = null;
            for (const table of doc.querySelectorAll('table')) {
                const rows = [...table.querySelectorAll('tbody tr, tr')].filter(r => r.querySelector('td'));
                const hits = rows.filter(r => [...r.cells].some(td => AMOUNT_RE.test(clean(td.textContent)))).length;
                if (hits && (!best || hits > best.hits)) best = { table, rows, hits };
            }
            const pages = [...doc.querySelectorAll('.pagination a[href*="page="]')]
                .map(a => +(a.getAttribute('href').match(/page=(\d+)/) || [0, 0])[1]);
            const maxPage = pages.length ? Math.max(...pages) : 1;
            if (!best) return { rows: [], maxPage, headers: [] };

            const headers = [...best.table.querySelectorAll('thead th, tr:first-child th')].map(th => clean(th.textContent).toLowerCase());
            const hIdx = (re) => headers.findIndex(h => re.test(h));
            let amountIdx = hIdx(/credit|bedrag|amount/);
            let dateIdx = hIdx(/datum|date|tijd|time/);
            let descIdx = hIdx(/omschrijving|beschrijving|description|reden|inzet|melding/);

            const rows = [];
            for (const tr of best.rows) {
                const cells = [...tr.cells];
                const txt = cells.map(td => clean(td.textContent));
                const aI = amountIdx >= 0 && AMOUNT_RE.test(txt[amountIdx] || '') ? amountIdx : txt.findIndex(x => AMOUNT_RE.test(x));
                if (aI < 0) continue;
                const dI = dateIdx >= 0 && dateIdx !== aI ? dateIdx : txt.findIndex((x, i) => i !== aI && DATE_LIKE(x));
                let dsI = descIdx >= 0 && descIdx !== aI && descIdx !== dI ? descIdx : -1;
                if (dsI < 0) {
                    let len = -1;
                    txt.forEach((x, i) => { if (i !== aI && i !== dI && x.length > len) { len = x.length; dsI = i; } });
                }
                rows.push({
                    amount: parseAmount(txt[aI], cells[aI]),
                    desc: dsI >= 0 ? txt[dsI] : '(geen omschrijving)',
                    date: dI >= 0 ? parseDate(cells[dI].getAttribute('data-time') || cells[dI].title || txt[dI]) : null,
                    link: (cells[dsI] && cells[dsI].querySelector('a')) ? cells[dsI].querySelector('a').getAttribute('href') : null,
                });
            }
            return { rows, maxPage, headers };
        }

        function category(r) {
            const d = r.desc.toLowerCase();
            if (/verband|alliantie|alliance|team/.test(d)) return 'Verband';
            if (/opleiding|school|cursus|training/.test(d)) return 'Opleiding';
            if (/voertuig|gekocht|aankoop|koop|vehicle/.test(d)) return 'Voertuig';
            if (/uitbreiding|gebouw|kazerne|post|bureau|ziekenhuis|cel|bouw|building/.test(d)) return 'Gebouw';
            if (/patiënt|patient|transport|ziekenvervoer/.test(d)) return 'Patiënt/transport';
            if (/dagelijks|bonus|taak|task|beloning|award|login/.test(d)) return 'Bonus/taken';
            return r.amount >= 0 ? 'Inzet' : 'Overig';
        }

        /* ------------------------------------------------------------------------
         * Stored log: { at, headers, rows, days }
         *   rows: [{ amount, desc, date }] newest first, the last LOG_RAW_DAYS
         *   days: { dayStart: [[desc, sign, n, total, max, min], ...] } older rows,
         *         folded into one line per description per day
         * Sync reads /credits from page 1 until it finds the newest stored rows
         * again, so normally one request. Rows have no id: the match is on a
         * run of consecutive rows with the same amount, description and date.
         * Dates may be relative ("2 uur geleden"), so older rows get more slack.
         * Rows without a readable date get u: 1 and match on any date.
         * ---------------------------------------------------------------------- */
        const sameRow = (a, b) => a.amount === b.amount && a.desc === b.desc
            && (a.u || b.u || Math.abs(a.date - b.date) <= Math.max(120e3, (Date.now() - b.date) / 10));
        function findAnchor(fetched, stored) {
            const k = Math.min(CONFIG.LOG_ANCHOR, stored.length);
            if (!k) return -1;
            for (let i = 0; i + k <= fetched.length; i++) {
                let ok = true;
                for (let j = 0; j < k && ok; j++) ok = sameRow(fetched[i + j], stored[j]);
                if (ok) return i;
            }
            return -1;
        }

        function compactLog(data) {
            const cut = floorDay(Date.now() - CONFIG.LOG_RAW_DAYS * 86400e3);
            const drop = Date.now() - CONFIG.KEEP_DAYS * 86400e3;
            const keep = [];
            for (const r of data.rows) {
                if (r.date >= cut) { keep.push(r); continue; }
                const day = floorDay(r.date);
                const list = data.days[day] || (data.days[day] = []);
                const sign = r.amount < 0 ? -1 : 1;
                let e = list.find(x => x[0] === r.desc && x[1] === sign);
                if (!e) list.push(e = [r.desc, sign, 0, 0, 0, Infinity]);
                const abs = Math.abs(r.amount);
                e[2]++; e[3] += r.amount; e[4] = Math.max(e[4], abs); e[5] = Math.min(e[5], abs);
            }
            data.rows = keep;
            for (const d of Object.keys(data.days)) if (+d < drop) delete data.days[d];
        }

        const loadLog = () => {
            try {
                const d = JSON.parse(GM_getValue(CONFIG.LOG_KEY, 'null'));
                if (d) return d;
                // v1 (manual import, overwritten each time): carry it over once.
                const old = JSON.parse(GM_getValue(CONFIG.LOG_KEY_V1, 'null'));
                if (old) return { at: old.at, headers: old.headers || [], days: {},
                    rows: old.rows.map(r => ({ amount: r.amount, desc: r.desc, date: r.date || old.at })) };
            } catch (e) { warn('log load failed', e); }
            return null;
        };
        const saveLog = (d) => GM_setValue(CONFIG.LOG_KEY, JSON.stringify(d));
        const logBytes = () => (GM_getValue(CONFIG.LOG_KEY, '') || '').length;

        let importing = false;
        async function syncLog(onProgress, force) {
            if (importing) return;
            const last = Number(GM_getValue(CONFIG.LOG_LAST_KEY, 0));
            if (!force && Date.now() - last < CONFIG.LOG_SYNC_MS - 30e3) return;
            importing = true;
            GM_setValue(CONFIG.LOG_LAST_KEY, Date.now());  // claim the slot before the requests (other tabs)
            const say = onProgress || (() => {});
            try {
                const stored = loadLog();
                const now = Date.now();
                const newest = stored && stored.rows.length ? stored.rows[0].date : 0;
                const stopAt = Math.max(now - CONFIG.LOG_DAYS * 86400e3, newest - 3600e3);
                const maxPages = stored ? CONFIG.LOG_SYNC_PAGES : CONFIG.LOG_MAX_PAGES;
                const fetched = [];
                let headers = stored ? stored.headers : [];
                let anchor = -1;
                let maxPage = 1;
                for (let p = 1; p <= Math.min(maxPage, maxPages); p++) {
                    say(`Pagina ${p}${maxPage > 1 ? ' / ' + Math.min(maxPage, maxPages) : ''}…`);
                    const res = await fetchWithTimeout(`/credits?page=${p}`);
                    if (!res.ok) throw new Error(`GET /credits?page=${p} failed: ${res.status}`);
                    const parsed = parseCreditLog(await res.text());
                    if (p === 1 && parsed.headers.length) headers = parsed.headers;
                    maxPage = Math.max(maxPage, parsed.maxPage);
                    if (!parsed.rows.length) break;
                    fetched.push(...parsed.rows.map(r => r.date ? { amount: r.amount, desc: r.desc, date: r.date } : { amount: r.amount, desc: r.desc, date: now, u: 1 }));
                    if (stored && (anchor = findAnchor(fetched, stored.rows)) >= 0) break;
                    const dated = parsed.rows.filter(r => r.date);
                    if (dated.length && dated.every(r => r.date < stopAt)) break;
                    await sleep(CONFIG.LOG_DELAY_MS);
                }
                let fresh;
                if (!stored) fresh = fetched.filter(r => r.date >= now - CONFIG.LOG_DAYS * 86400e3);
                else if (anchor >= 0) fresh = fetched.slice(0, anchor);
                // No overlap found (long offline or changed text): only take rows
                // dated after the newest stored one, so nothing is counted twice.
                else fresh = fetched.filter(r => !r.u && r.date > newest);
                const data = stored || { days: {}, rows: [] };
                data.at = now;
                data.headers = headers;
                data.rows = fresh.concat(data.rows);
                compactLog(data);
                saveLog(data);
                if (fresh.length) log(`credit log: +${fresh.length} rows${stored && anchor < 0 ? ' (no overlap)' : ''}`);
                return data;
            } finally {
                importing = false;
            }
        }

        /* ========================================================================
         * FORMATTING
         * ==================================================================== */
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const nl = (n) => Math.round(n).toLocaleString('nl-NL');
        function compactNum(n) {
            const a = Math.abs(n);
            if (a >= 1e6) return (n / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'M';
            if (a >= 1e4) return (n / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'k';
            return nl(n);
        }
        const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + nl(Math.abs(n));
        const dur = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
        const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
        const dayLabel = (t) => { const d = new Date(t); return `${DOW[d.getDay()]} ${d.getDate()}-${d.getMonth() + 1}`; };
        const timeLabel = (t) => new Date(t).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

        /* ========================================================================
         * UI
         * ==================================================================== */
        // Series colours validated on the dark panel surface.
        const C = { earned: '#3987e5', spent: '#d95926', avg: '#c98500', net: '#199e70', grid: '#333841', muted: '#9aa1ab', panel: '#22262c' };

        const CSS = `
        #it-overlay { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.55); display: flex; }
        #it-panel { margin: 24px auto; width: min(1300px, calc(100vw - 32px)); background: #1e2126; color: #e4e6ea;
            border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; font: 13px/1.4 system-ui, sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,.5); }
        #it-panel * { box-sizing: border-box; }
        #it-head { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #333841; flex-wrap: wrap; }
        #it-head h3 { margin: 0 12px 0 0; font-size: 16px; color: #fff; }
        #it-panel input, #it-panel select, #it-panel button { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d;
            border-radius: 4px; padding: 5px 8px; font: inherit; }
        #it-panel button { cursor: pointer; }
        #it-panel button:hover { background: #353a43; }
        #it-panel button:disabled { opacity: .5; cursor: default; }
        #it-close { margin-left: auto; }
        .it-tabs { display: flex; gap: 2px; }
        .it-tabs button.on { background: #2f4a66 !important; border-color: #4a6f96 !important; color: #fff !important; }
        #it-body { flex: 1; overflow: auto; padding: 14px 18px; }
        #it-foot { padding: 6px 14px; border-top: 1px solid #333841; color: #9aa1ab; display: flex; gap: 16px; flex-wrap: wrap; }
        .it-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; margin-bottom: 18px; }
        .it-tile { background: #262a30; border: 1px solid #333841; border-radius: 6px; padding: 10px 12px; }
        .it-tile .v { font-size: 22px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .it-tile .l { color: #9aa1ab; font-size: 12px; }
        .it-tile .s { color: #9aa1ab; font-size: 11px; margin-top: 2px; }
        .it-up { color: #7fe0a8 !important; } .it-down { color: #ff9b8a !important; }
        .it-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 18px; margin-bottom: 18px; }
        .it-card { background: #22262c; border: 1px solid #333841; border-radius: 6px; padding: 10px 14px; min-width: 0; }
        .it-card h4 { margin: 0 0 8px; font-size: 13px; color: #fff; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
        .it-card h4 small { color: #9aa1ab; font-weight: normal; }
        .it-legend { display: flex; gap: 14px; font-size: 12px; color: #c9cdd3; margin-top: 4px; flex-wrap: wrap; }
        .it-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
        .it-chart svg { display: block; width: 100%; height: auto; }
        .it-chart rect.hit { fill: transparent; }
        .it-chart g.col:hover rect.hit { fill: rgba(255,255,255,.05); }
        .it-msg { padding: 40px; text-align: center; color: #9aa1ab; }
        .it-goal { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .it-prog { height: 10px; background: #2a2e35; border-radius: 5px; overflow: hidden; margin: 10px 0 6px; }
        .it-prog > span { display: block; height: 100%; background: #199e70; }
        table.it-table { width: 100%; border-collapse: collapse; }
        table.it-table th { position: sticky; top: 0; background: #262a30; text-align: left; padding: 6px 8px; cursor: pointer;
            user-select: none; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        table.it-table th.num, table.it-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        table.it-table td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; }
        table.it-table tr:hover td { background: #252930; }
        .it-barcell { width: 28%; }
        .it-barcell span { display: block; height: 10px; background: #3987e5; border-radius: 0 4px 4px 0; min-width: 2px; }
        .it-barcell span.neg { background: #d95926; }
        .it-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
        .it-ctl label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .it-note { color: #9aa1ab; font-size: 12px; }
        .it-heat td { width: calc(100% / 25); height: 18px; padding: 0; border: 1px solid #22262c; }
        .it-heat th { font-weight: normal; color: #9aa1ab; font-size: 11px; padding: 0 4px; text-align: right; }
        .it-heat thead th { text-align: center; padding: 0; }
        .it-scale { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9aa1ab; margin-top: 6px; }
        .it-scale span.g { height: 8px; width: 140px; border-radius: 2px; background: linear-gradient(90deg, #2a2e35, #3987e5); }
        #it-badge { font-variant-numeric: tabular-nums; }
        `;

        let overlay = null;
        const ui = {
            tab: GM_getValue(CONFIG.TAB_KEY, 'overview'),
            logSort: 'total', logDir: -1, logSearch: '', logSign: 'in',
            logStatus: '', logRange: Number(GM_getValue(CONFIG.LOG_RANGE_KEY, 14)),
        };

        function open() {
            if (!document.getElementById('it-style')) {
                const st = document.createElement('style');
                st.id = 'it-style';
                st.textContent = CSS;
                document.head.appendChild(st);
            }
            overlay = document.createElement('div');
            overlay.id = 'it-overlay';
            overlay.innerHTML = `
            <div id="it-panel">
              <div id="it-head">
                <h3>💰 Inkomsten</h3>
                <div class="it-tabs">
                  <button data-tab="overview">Overzicht</button>
                  <button data-tab="charts">📈 Grafieken</button>
                  <button data-tab="log">📜 Per inzet</button>
                  <button data-tab="settings">⚙️ Instellingen</button>
                </div>
                <button id="it-now" title="Nu saldo ophalen">↻ Nu meten</button>
                <button id="it-close">✕ Sluiten</button>
              </div>
              <div id="it-body"></div>
              <div id="it-foot"></div>
            </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            overlay.querySelector('#it-close').onclick = close;
            overlay.querySelector('#it-now').onclick = () => sample(true);
            overlay.querySelectorAll('.it-tabs button').forEach(b => b.onclick = () => {
                ui.tab = b.dataset.tab;
                GM_setValue(CONFIG.TAB_KEY, ui.tab);
                render();
            });
            document.addEventListener('keydown', onKey);
            render();
        }

        function close() {
            if (!overlay) return;
            overlay.remove();
            overlay = null;
            document.removeEventListener('keydown', onKey);
        }
        const onKey = (e) => { if (e.key === 'Escape') close(); };

        function render() {
            if (!overlay) return;
            overlay.querySelectorAll('.it-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
            const a = analyse();
            const body = overlay.querySelector('#it-body');
            const scroll = body.scrollTop;
            if (ui.tab === 'log') renderLog(body);
            else if (ui.tab === 'settings') renderSettings(body, a);
            else if (a.samples.length < 2) {
                body.innerHTML = `<div class="it-msg">Nog te weinig metingen. De tracker meet elke ${CONFIG.SAMPLE_MS / 60000} minuten
                    zolang er een meldkamerspel-tab open is.<br>Kom over een paar minuten terug, of klik “↻ Nu meten”.
                    <br><br>Tip: tab “📜 Per inzet” leest wel direct het credit-logboek van het spel.</div>`;
            } else if (ui.tab === 'charts') renderCharts(body, a);
            else renderOverview(body, a);
            body.scrollTop = scroll;

            const foot = overlay.querySelector('#it-foot');
            const last = a.samples[a.samples.length - 1];
            foot.innerHTML = `
                <span>${nl(a.samples.length)} metingen</span>
                ${a.first ? `<span>sinds ${esc(timeLabel(a.first))}</span>` : ''}
                ${last ? `<span>laatste meting ${esc(timeLabel(last[0] * 1000))}</span>` : ''}
                <span>Alleen-lezen: koopt of verstuurt niets.</span>`;
        }

        function tile(label, value, sub, cls) {
            return `<div class="it-tile"><div class="l">${esc(label)}</div><div class="v ${cls || ''}">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
        }

        function renderOverview(body, a) {
            const t = a.t;
            const vsY = a.yesterdaySoFar.earned > 0 ? (t.earned / a.yesterdaySoFar.earned - 1) * 100 : null;
            const days7 = Math.min(7, Math.max(1, (a.now - Math.max(a.first, addDays(a.today, -6))) / 86400e3));
            const net = t.earned - t.spent;

            body.innerHTML = `
            <div class="it-tiles">
              ${tile('Saldo', a.cur != null ? nl(a.cur) : '–', a.tot != null ? `totaal ooit verdiend ${nl(a.tot)}` : '')}
              ${tile('Verdiend vandaag', nl(t.earned),
                    vsY != null ? `<span class="${vsY >= 0 ? 'it-up' : 'it-down'}">${vsY >= 0 ? '▲' : '▼'} ${Math.abs(vsY).toFixed(0)}%</span> vs gisteren om deze tijd` : 'nog geen data van gisteren')}
              ${tile('Uitgegeven vandaag', nl(t.spent), '')}
              ${tile('Netto vandaag', signed(net), '', net >= 0 ? 'it-up' : 'it-down')}
              ${tile('Laatste 60 min', nl(a.lastHour.earned), a.lastHour.spent ? `uitgegeven ${nl(a.lastHour.spent)}` : '')}
              ${tile(`Tempo (${CONFIG.RATE_WINDOW_H} u)`, a.rate != null ? compactNum(a.rate) + '/u' : '–', 'per uur dat je online was')}
              ${tile('Gem. per online uur vandaag', a.todayRate != null ? compactNum(a.todayRate) + '/u' : '–', `online vandaag ${dur(t.onlineMs)}`)}
              ${tile('Laatste 7 dagen', compactNum(a.week.earned), `gem. ${compactNum(a.week.earned / days7)} per dag`)}
              ${tile('Laatste 30 dagen', compactNum(a.month.earned), `uitgegeven ${compactNum(a.month.spent)}`)}
              ${tile('Beste dag', a.bestDay ? compactNum(a.bestDay.v.earned) : '–', a.bestDay ? esc(dayLabel(a.bestDay.k)) : '')}
              ${tile('Beste uur', a.bestHour ? compactNum(a.bestHour.v.earnedOn) : '–',
                    a.bestHour ? esc(timeLabel(a.bestHour.k)) : 'nog geen volledig online uur')}
            </div>
            <div class="it-grid">
              ${goalCard(a)}
              ${hourlyTodayCard(a)}
            </div>
            <div class="it-grid">${dailyCard(a, 14)}</div>`;
            bindGoal(body);
        }

        function renderCharts(body, a) {
            body.innerHTML = `
            <div class="it-grid">${dailyCard(a, 30)}</div>
            <div class="it-grid">
              ${hourlyTodayCard(a)}
              ${heatCard(a)}
            </div>
            <div class="it-grid">${cumulativeCard(a)}</div>`;
        }

        /* ---------- goal ---------- */
        function goalCard(a) {
            const goal = Number(GM_getValue(CONFIG.GOAL_KEY, 0)) || 0;
            let inner = '<div class="it-note">Stel een doel in, bijvoorbeeld de prijs van je volgende kazerne. Je ziet dan wanneer je het haalt.</div>';
            if (goal > 0 && a.cur != null) {
                const left = goal - a.cur;
                const p = Math.max(0, Math.min(100, (a.cur / goal) * 100));
                let eta;
                if (left <= 0) eta = '<b class="it-up">Doel gehaald! 🎉</b>';
                else if (a.netPerHour && a.netPerHour > 0) {
                    const h = left / a.netPerHour;
                    const at = Date.now() + h * 3600e3;
                    eta = `Nog <b>${nl(left)}</b>. Bij je netto tempo van ${compactNum(a.netPerHour)}/u (laatste 7 dagen, inclusief offline tijd en uitgaven):
                        <b>${h < 48 ? dur(h * 3600e3) : Math.round(h / 24) + ' dagen'}</b>, rond <b>${esc(timeLabel(at))}</b>.`;
                    if (a.grossPerHour > a.netPerHour * 1.2) eta += `<br><span class="it-note">Zonder uitgeven: ${esc(dur((left / a.grossPerHour) * 3600e3))}.</span>`;
                } else eta = `Nog <b>${nl(left)}</b>. Je netto tempo is nu niet positief, dus geen schatting.`;
                inner = `<div class="it-prog"><span style="width:${p}%"></span></div>
                    <div>${nl(a.cur)} / ${nl(goal)} (${p.toFixed(1)}%)</div><div style="margin-top:6px">${eta}</div>`;
            }
            return `<div class="it-card"><h4>🎯 Spaardoel</h4>
                <div class="it-goal"><input id="it-goal" type="number" min="0" step="1000" placeholder="bijv. 300000" value="${goal || ''}" style="width:150px">
                <button id="it-goal-set">Opslaan</button>${goal ? '<button id="it-goal-clear">Wissen</button>' : ''}</div>${inner}</div>`;
        }
        function bindGoal(body) {
            const inp = body.querySelector('#it-goal');
            if (!inp) return;
            const save = () => { GM_setValue(CONFIG.GOAL_KEY, Math.max(0, Math.round(Number(inp.value) || 0))); render(); };
            body.querySelector('#it-goal-set').onclick = save;
            inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
            const clr = body.querySelector('#it-goal-clear');
            if (clr) clr.onclick = () => { GM_setValue(CONFIG.GOAL_KEY, 0); render(); };
        }

        /* ---------- chart helpers ---------- */
        const niceMax = (v) => {
            if (v <= 0) return 1;
            const p = Math.pow(10, Math.floor(Math.log10(v)));
            return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v);
        };

        // Bars going up (earned) and down (spent) from one zero line.
        function dailyCard(a, n) {
            const keys = [];
            for (let i = n - 1; i >= 0; i--) keys.push(addDays(a.today, -i));
            const vals = keys.map(k => a.days.get(k) || { earned: 0, spent: 0, onlineMs: 0, trackedMs: 0, earnedOn: 0 });
            const maxE = niceMax(Math.max(...vals.map(v => v.earned)));
            const maxS = Math.max(...vals.map(v => v.spent)) > 0 ? niceMax(Math.max(...vals.map(v => v.spent))) : 0;
            const Wd = 760, H = 240, L = 54, R = 8, T = 10, B = 28;
            const plotH = H - T - B;
            const zeroY = T + plotH * (maxE / (maxE + maxS));
            const scale = plotH / (maxE + maxS);
            const bw = (Wd - L - R) / n;
            const grid = [];
            for (const f of [0.5, 1]) {
                const y = zeroY - maxE * f * scale;
                grid.push(`<line x1="${L}" x2="${Wd - R}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-dasharray="2 3"/>
                    <text x="${L - 6}" y="${y + 4}" text-anchor="end" fill="${C.muted}" font-size="11">${compactNum(maxE * f)}</text>`);
            }
            if (maxS) grid.push(`<text x="${L - 6}" y="${zeroY + maxS * scale}" text-anchor="end" fill="${C.muted}" font-size="11">−${compactNum(maxS)}</text>`);
            const cols = vals.map((v, i) => {
                const x = L + i * bw, w = Math.max(2, bw - 3);
                const hE = v.earned * scale, hS = v.spent * scale;
                const offline = v.earned - v.earnedOn;
                const tip = `${dayLabel(keys[i])}\nVerdiend: ${nl(v.earned)}${offline > 1 ? ` (waarvan ${nl(offline)} terwijl er geen tab open was)` : ''}\nUitgegeven: ${nl(v.spent)}\nNetto: ${signed(v.earned - v.spent)}\nOnline: ${dur(v.onlineMs)}${v.trackedMs < 86400e3 * 0.9 && keys[i] !== a.today ? '\n(dag niet volledig gemeten)' : ''}`;
                const lbl = (n <= 14 || i % Math.ceil(n / 10) === (n - 1) % Math.ceil(n / 10))
                    ? `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" fill="${keys[i] === a.today ? '#fff' : C.muted}" font-size="10">${esc(n <= 14 ? dayLabel(keys[i]) : new Date(keys[i]).getDate() + '-' + (new Date(keys[i]).getMonth() + 1))}</text>` : '';
                return `<g class="col"><title>${esc(tip)}</title>
                    <rect class="hit" x="${x}" y="${T}" width="${bw}" height="${plotH}"/>
                    ${hE > 0 ? `<rect x="${x + 1.5}" y="${zeroY - hE}" width="${w}" height="${hE}" rx="2" fill="${C.earned}"/>` : ''}
                    ${hS > 0 ? `<rect x="${x + 1.5}" y="${zeroY}" width="${w}" height="${hS}" rx="2" fill="${C.spent}"/>` : ''}
                    ${lbl}</g>`;
            }).join('');
            const tot = vals.reduce((s, v) => ({ e: s.e + v.earned, s: s.s + v.spent }), { e: 0, s: 0 });
            return `<div class="it-card it-chart"><h4>Per dag <small>laatste ${n} dagen · verdiend ${compactNum(tot.e)} · uitgegeven ${compactNum(tot.s)}</small></h4>
                <svg viewBox="0 0 ${Wd} ${H}">${grid.join('')}${cols}
                  <line x1="${L}" x2="${Wd - R}" y1="${zeroY}" y2="${zeroY}" stroke="#555b66"/></svg>
                <div class="it-legend"><span><i style="background:${C.earned}"></i>Verdiend</span><span><i style="background:${C.spent}"></i>Uitgegeven</span>
                  <span class="it-note">Tijd zonder open tab wordt gelijk over die periode verdeeld.</span></div></div>`;
        }

        // Today per hour, with the average of the same hour over the 7 days before.
        function hourlyTodayCard(a) {
            const today = [], avg = [];
            for (let h = 0; h < 24; h++) {
                const k = new Date(a.today); k.setHours(h);
                const v = a.hours.get(k.getTime());
                today.push(v ? v.earned : 0);
                let sum = 0, cnt = 0;
                for (let d = 1; d <= 7; d++) {
                    const kd = new Date(addDays(a.today, -d)); kd.setHours(h);
                    const vd = a.hours.get(kd.getTime());
                    if (vd && vd.trackedMs > 0) { sum += vd.earned; cnt++; }
                    else if (kd.getTime() >= (a.first || Infinity)) cnt++;  // measured period, nothing earned
                }
                avg.push(cnt ? sum / cnt : null);
            }
            const nowH = new Date().getHours();
            const max = niceMax(Math.max(...today, ...avg.filter(x => x != null)));
            const Wd = 520, H = 220, L = 46, R = 6, T = 10, B = 24, plotH = H - T - B;
            const bw = (Wd - L - R) / 24;
            const y = (v) => T + plotH - (v / max) * plotH;
            const grid = [0.5, 1].map(f => `<line x1="${L}" x2="${Wd - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="${C.grid}" stroke-dasharray="2 3"/>
                <text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end" fill="${C.muted}" font-size="11">${compactNum(max * f)}</text>`).join('');
            const cols = today.map((v, h) => {
                const x = L + h * bw;
                const tip = `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00\nVandaag: ${nl(v)}${h === nowH ? ' (loopt nog)' : ''}${avg[h] != null ? `\nGem. vorige 7 dagen: ${nl(avg[h])}` : ''}`;
                return `<g class="col"><title>${esc(tip)}</title><rect class="hit" x="${x}" y="${T}" width="${bw}" height="${plotH}"/>
                    ${v > 0 ? `<rect x="${x + 1}" y="${y(v)}" width="${bw - 2}" height="${T + plotH - y(v)}" rx="2" fill="${C.earned}" opacity="${h > nowH ? 0.3 : h === nowH ? 0.7 : 1}"/>` : ''}
                    ${h % 3 === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" fill="${h === nowH ? '#fff' : C.muted}" font-size="10">${h}</text>` : ''}</g>`;
            }).join('');
            const pts = avg.map((v, h) => v == null ? null : `${L + h * bw + bw / 2},${y(v)}`).filter(Boolean).join(' ');
            return `<div class="it-card it-chart"><h4>Vandaag per uur <small>vs gemiddelde vorige 7 dagen</small></h4>
                <svg viewBox="0 0 ${Wd} ${H}">${grid}${cols}
                  <line x1="${L}" x2="${Wd - R}" y1="${T + plotH}" y2="${T + plotH}" stroke="#555b66"/>
                  ${pts ? `<polyline points="${pts}" fill="none" stroke="${C.avg}" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>` : ''}
                </svg>
                <div class="it-legend"><span><i style="background:${C.earned}"></i>Vandaag</span><span><i style="background:${C.avg}"></i>Gem. 7 dagen</span></div></div>`;
        }

        // Weekday × hour: earned per ONLINE hour, last 28 days. Answers
        // "when is playing worth it the most".
        function heatCard(a) {
            const from = addDays(a.today, -27);
            const cell = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ e: 0, ms: 0 })));
            for (const [k, v] of a.hours) {
                if (k < from || !v.onlineMs) continue;
                const d = new Date(k);
                const c = cell[(d.getDay() + 6) % 7][d.getHours()];
                c.e += v.earnedOn; c.ms += v.onlineMs;
            }
            let max = 0;
            const rate = cell.map(r => r.map(c => {
                const x = c.ms >= 10 * 60e3 ? c.e / (c.ms / 3600e3) : null;
                if (x != null) max = Math.max(max, x);
                return x;
            }));
            const order = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
            const mix = (f) => {  // #2a2e35 → #3987e5
                const a1 = [0x2a, 0x2e, 0x35], b1 = [0x39, 0x87, 0xe5];
                return `rgb(${a1.map((x, i) => Math.round(x + (b1[i] - x) * f)).join(',')})`;
            };
            const rows = rate.map((r, d) => `<tr><th>${order[d]}</th>${r.map((x, h) => {
                const tip = `${order[d]} ${h}:00–${h + 1}:00\n` + (x == null ? 'te weinig online gemeten' : `${nl(x)} per online uur\n(${dur(cell[d][h].ms)} online gemeten)`);
                return `<td title="${esc(tip)}" style="background:${x == null ? 'transparent' : mix(max ? Math.sqrt(x / max) : 0)}"></td>`;
            }).join('')}</tr>`).join('');
            const head = `<tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ''}</th>`).join('')}</tr>`;
            return `<div class="it-card"><h4>Wanneer verdien je het meest? <small>per online uur · laatste 4 weken</small></h4>
                <table class="it-heat" style="width:100%;border-collapse:collapse;table-layout:fixed"><thead>${head}</thead><tbody>${rows}</tbody></table>
                <div class="it-scale">0 <span class="g"></span> ${max ? compactNum(max) + '/u' : '–'} <span class="it-note" style="margin-left:10px">leeg = te weinig gemeten</span></div></div>`;
        }

        // Balance and total-ever over the last 30 days.
        function cumulativeCard(a) {
            const from = addDays(a.today, -29) / 1000;
            const s = a.samples.filter(x => x[0] >= from);
            if (s.length < 2) return '';
            const Wd = 1000, H = 220, L = 60, R = 10, T = 10, B = 24, plotH = H - T - B;
            const t0 = s[0][0], t1 = s[s.length - 1][0];
            const lo = Math.min(...s.map(x => x[1])), hi = Math.max(...s.map(x => x[1]));
            const span = hi - lo || 1;
            const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (Wd - L - R);
            const Y = (v) => T + plotH - ((v - lo) / span) * plotH;
            const pts = s.map(x => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');
            const ticks = [];
            for (let d = floorDay(t0 * 1000); d <= t1 * 1000; d = addDays(d, 1)) {
                if (d / 1000 < t0) continue;
                const day = new Date(d);
                if (day.getDay() === 1 || t1 - t0 < 8 * 86400) ticks.push(`<line x1="${X(d / 1000)}" x2="${X(d / 1000)}" y1="${T}" y2="${T + plotH}" stroke="${C.grid}" stroke-dasharray="2 3"/>
                    <text x="${X(d / 1000)}" y="${H - 8}" text-anchor="middle" fill="${C.muted}" font-size="10">${esc(dayLabel(d))}</text>`);
            }
            return `<div class="it-card it-chart"><h4>Saldo <small>laatste 30 dagen · laag ${nl(lo)} · hoog ${nl(hi)}</small></h4>
                <svg viewBox="0 0 ${Wd} ${H}">${ticks.join('')}
                  <text x="${L - 6}" y="${Y(hi) + 4}" text-anchor="end" fill="${C.muted}" font-size="11">${compactNum(hi)}</text>
                  <text x="${L - 6}" y="${Y(lo) + 4}" text-anchor="end" fill="${C.muted}" font-size="11">${compactNum(lo)}</text>
                  <polyline points="${pts}" fill="none" stroke="${C.net}" stroke-width="2" stroke-linejoin="round"/></svg>
                <div class="it-legend"><span class="it-note">Dalingen = aankopen. Stijgingen = inkomsten.</span></div></div>`;
        }

        /* ---------- per mission (credit log) ---------- */
        function renderLog(body) {
            const data = loadLog();
            const age = data ? Math.round((Date.now() - data.at) / 60e3) : null;
            // Single rows plus folded day lines, as { desc, amount, n, max, min, date }.
            const from = ui.logRange ? floorDay(addDays(Date.now(), -(ui.logRange - 1))) : 0;
            const rows = !data ? [] : data.rows.filter(r => r.date >= from)
                .map(r => ({ desc: r.desc, amount: r.amount, n: 1, max: Math.abs(r.amount), min: Math.abs(r.amount), date: r.date }))
                .concat(Object.entries(data.days).filter(([d]) => +d >= from)
                    .flatMap(([d, list]) => list.map(e => ({ desc: e[0], amount: e[3], n: e[2], max: e[4], min: e[5], date: +d }))));
            const oldest = data ? Math.min(Date.now(), ...data.rows.map(r => r.date), ...Object.keys(data.days).map(Number)) : null;
            const status = data
                ? `${ctx.cfg.autoLog ? 'Automatisch bijgewerkt' : 'Bijgewerkt'} ${age < 1 ? 'net' : age + ' min geleden'} · bewaard sinds ${dayLabel(oldest)} · ${(logBytes() / 1024).toFixed(0)} KB in je browser`
                : `Leest max. ${CONFIG.LOG_MAX_PAGES} pagina's van /credits (laatste ${CONFIG.LOG_DAYS} dagen).`;
            let html = `<div class="it-ctl">
                <button id="it-log-import" ${importing ? 'disabled' : ''}>${data ? '↻ Nu bijwerken' : '📥 Credit-logboek inlezen'}</button>
                ${data ? `<select id="it-log-range">${[[1, 'Vandaag'], [7, 'Laatste 7 dagen'], [14, 'Laatste 14 dagen'], [30, 'Laatste 30 dagen'], [90, 'Laatste 90 dagen'], [0, 'Alles']]
                    .map(([v, l]) => `<option value="${v}" ${ui.logRange === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
                <span class="it-note" id="it-log-status">${esc(ui.logStatus || status)}</span>
              </div>`;
            if (data && (data.rows.length || Object.keys(data.days).length)) {
                const spanTxt = rows.length ? `${timeLabel(Math.min(...rows.map(r => r.date)))} – ${timeLabel(Math.max(...rows.map(r => r.date)))}` : 'geen regels in deze periode';

                // Category summary.
                const cat = new Map();
                for (const r of rows) {
                    const k = category(r) + (r.amount < 0 ? ' (uit)' : '');
                    const c = cat.get(k) || { n: 0, sum: 0 };
                    c.n += r.n; c.sum += r.amount;
                    cat.set(k, c);
                }
                const catRows = [...cat.entries()].sort((x, y) => Math.abs(y[1].sum) - Math.abs(x[1].sum));
                const catMax = Math.max(...catRows.map(([, c]) => Math.abs(c.sum)), 1);

                // Group by description.
                const groups = new Map();
                for (const r of rows) {
                    if (ui.logSign === 'in' && r.amount < 0) continue;
                    if (ui.logSign === 'out' && r.amount >= 0) continue;
                    const g = groups.get(r.desc) || { desc: r.desc, n: 0, total: 0, max: 0, min: Infinity, last: 0, cat: category(r) };
                    g.n += r.n; g.total += r.amount;
                    g.max = Math.max(g.max, r.max); g.min = Math.min(g.min, r.min);
                    g.last = Math.max(g.last, r.date || 0);
                    groups.set(r.desc, g);
                }
                let list = [...groups.values()].map(g => ({ ...g, avg: g.total / g.n }));
                const q = ui.logSearch.toLowerCase();
                if (q) list = list.filter(g => g.desc.toLowerCase().includes(q) || g.cat.toLowerCase().includes(q));
                const key = ui.logSort;
                list.sort((x, y) => {
                    const va = key === 'desc' || key === 'cat' ? x[key].localeCompare(y[key], 'nl') : Math.abs(x[key]) - Math.abs(y[key]);
                    return va * ui.logDir;
                });
                const grand = list.reduce((s, g) => s + g.total, 0);
                const barMax = Math.max(...list.map(g => Math.abs(g[key === 'desc' || key === 'cat' ? 'total' : key])), 1);
                const th = (k, label, num) => `<th data-k="${k}" class="${num ? 'num' : ''}">${label}${ui.logSort === k ? (ui.logDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

                html += `<div class="it-grid">
                  <div class="it-card"><h4>Per soort <small>${esc(spanTxt)}</small></h4>
                    ${catRows.map(([k, c]) => `<div style="display:grid;grid-template-columns:150px 1fr 110px;gap:8px;align-items:center;padding:2px 0" title="${esc(k)}: ${nl(c.n)}× · ${signed(c.sum)}">
                      <span>${esc(k)}</span><span class="it-barcell" style="width:auto"><span class="${c.sum < 0 ? 'neg' : ''}" style="width:${Math.abs(c.sum) / catMax * 100}%"></span></span>
                      <span style="text-align:right;font-variant-numeric:tabular-nums">${signed(c.sum)}</span></div>`).join('')}
                    <div class="it-note" style="margin-top:6px">Soort is geraden uit de omschrijving.</div>
                  </div>
                  <div class="it-card"><h4>Top 5 per keer <small>hoogste gemiddelde, min. 2×</small></h4>
                    ${[...groups.values()].filter(g => g.n >= 2 && g.total > 0).map(g => ({ ...g, avg: g.total / g.n })).sort((x, y) => y.avg - x.avg).slice(0, 5)
                        .map((g, i) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #2a2e35"><b style="width:18px">${i + 1}</b><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.desc)}">${esc(g.desc)}</span><span style="font-variant-numeric:tabular-nums">${nl(g.avg)} × ${g.n}</span></div>`).join('')
                        || '<div class="it-note">Nog geen inzet die vaker dan 1× voorkomt.</div>'}
                  </div></div>
                <div class="it-ctl">
                  <input id="it-log-q" type="search" placeholder="Zoek omschrijving / soort…" value="${esc(ui.logSearch)}" size="28">
                  <label><input type="radio" name="it-sign" value="in" ${ui.logSign === 'in' ? 'checked' : ''}> Inkomsten</label>
                  <label><input type="radio" name="it-sign" value="out" ${ui.logSign === 'out' ? 'checked' : ''}> Uitgaven</label>
                  <label><input type="radio" name="it-sign" value="all" ${ui.logSign === 'all' ? 'checked' : ''}> Alles</label>
                  <span class="it-note">${nl(list.length)} omschrijvingen · samen ${signed(grand)}</span>
                </div>
                <table class="it-table"><thead><tr>
                  ${th('desc', 'Omschrijving')}${th('cat', 'Soort')}${th('n', 'Aantal', 1)}${th('total', 'Totaal', 1)}${th('avg', 'Gem.', 1)}${th('max', 'Hoogste', 1)}<th>Aandeel</th>
                </tr></thead><tbody>${list.slice(0, 500).map(g => `<tr>
                  <td>${esc(g.desc)}</td><td>${esc(g.cat)}</td><td class="num">${nl(g.n)}</td><td class="num">${signed(g.total)}</td>
                  <td class="num">${nl(Math.abs(g.avg))}</td><td class="num">${nl(g.max)}</td>
                  <td class="it-barcell"><span class="${g.total < 0 ? 'neg' : ''}" style="width:${Math.abs(g[key === 'desc' || key === 'cat' ? 'total' : key]) / barMax * 100}%"></span></td>
                </tr>`).join('')}</tbody></table>
                ${list.length > 500 ? `<div class="it-note">Eerste 500 van ${nl(list.length)} getoond.</div>` : ''}`;
            } else if (data) {
                html += `<div class="it-msg">Geen regels herkend op /credits.<br>Gevonden kolomkoppen: ${esc(data.headers.join(' | ') || '(geen)')}.
                    <br>Stuur deze regel naar wie het script onderhoudt, dan kan de parser worden aangepast.</div>`;
            } else {
                html += `<div class="it-msg">Nog niet ingelezen. Klik op de knop hierboven.<br>
                    Dit leest het credit-logboek van het spel en laat zien welke inzetten (en uitgaven) het meeste opleveren.</div>`;
            }
            body.innerHTML = html;

            body.querySelector('#it-log-import').onclick = async () => {
                const btn = body.querySelector('#it-log-import');
                btn.disabled = true;
                try {
                    await syncLog((m) => { ui.logStatus = m; const s = overlay && overlay.querySelector('#it-log-status'); if (s) s.textContent = m; }, true);
                    ui.logStatus = '';
                } catch (e) {
                    warn('log sync failed', e);
                    ui.logStatus = 'Inlezen mislukt: ' + e.message;
                }
                render();
            };
            const range = body.querySelector('#it-log-range');
            if (range) range.onchange = () => { ui.logRange = Number(range.value); GM_setValue(CONFIG.LOG_RANGE_KEY, ui.logRange); render(); };
            const q = body.querySelector('#it-log-q');
            if (q) q.oninput = () => {
                ui.logSearch = q.value;
                const pos = q.selectionStart;
                render();
                const q2 = overlay.querySelector('#it-log-q');
                q2.focus(); q2.setSelectionRange(pos, pos);
            };
            body.querySelectorAll('input[name="it-sign"]').forEach(r => r.onchange = () => { ui.logSign = r.value; render(); });
            body.querySelectorAll('table.it-table th[data-k]').forEach(h => h.onclick = () => {
                const k = h.dataset.k;
                if (ui.logSort === k) ui.logDir *= -1;
                else { ui.logSort = k; ui.logDir = k === 'desc' || k === 'cat' ? 1 : -1; }
                render();
            });
        }

        /* ---------- settings ---------- */
        function renderSettings(body, a) {
            const bytes = (GM_getValue(CONFIG.SAMPLES_KEY, '') || '').length;
            body.innerHTML = `
            <div class="it-grid">
              <div class="it-card"><h4>Gegevens</h4>
                <p>${nl(a.samples.length)} metingen · ${(bytes / 1024).toFixed(0)} KB opgeslagen in de userscript-opslag.</p>
                <p class="it-note">Elke ${CONFIG.SAMPLE_MS / 60000} min een meting, plus kort na elke live saldo-wijziging.
                  Na ${CONFIG.RAW_DAYS} dagen blijft 1 meting per uur over (totalen blijven exact). Na ${CONFIG.KEEP_DAYS} dagen verdwijnt data.</p>
                <p class="it-note">Meerdere tabs open? Geen probleem: tabs delen dezelfde opslag en meten niet dubbel.</p>
                <div class="it-ctl">
                  <button id="it-csv-s">⬇ Metingen als CSV</button>
                  <button id="it-csv-d">⬇ Per dag als CSV</button>
                  <button id="it-wipe" style="border-color:#6b2226">🗑 Alle metingen wissen</button>
                </div>
              </div>
              <div class="it-card"><h4>Hoe wordt er gerekend?</h4>
                <ul class="it-note" style="padding-left:18px;margin:0">
                  <li><b>Verdiend</b> = stijging van "totaal ooit verdiend" (credits_user_total). Daalt nooit, dus uitgaven vertroebelen dit niet.</li>
                  <li><b>Uitgegeven</b> = verdiend − stijging van je saldo.</li>
                  <li><b>Online</b> = tijd tussen twee metingen van max. ${CONFIG.GAP_S / 60} min. Langer = er stond geen tab open.</li>
                  <li>Credits die binnenkomen zonder open tab (bijv. inzetten die doorlopen) tellen wel mee, verdeeld over die offline periode. Ze tellen niet mee in "per online uur".</li>
                  <li><b>Tempo</b> in de menubalk = verdiend per online uur, laatste ${CONFIG.RATE_WINDOW_H} uur.</li>
                </ul>
              </div>
            </div>`;
            const dl = (name, text) => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
                const el = document.createElement('a');
                el.href = url; el.download = name; el.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            };
            const iso = (t) => new Date(t).toISOString();
            body.querySelector('#it-csv-s').onclick = () => dl('meldkamerspel-credits-metingen.csv',
                'tijd;saldo;totaal_verdiend\n' + a.samples.map(s => `${iso(s[0] * 1000)};${s[1]};${s[2]}`).join('\n'));
            body.querySelector('#it-csv-d').onclick = () => dl('meldkamerspel-credits-per-dag.csv',
                'dag;verdiend;uitgegeven;netto;online_minuten\n' + [...a.days.entries()].sort((x, y) => x[0] - y[0])
                    .map(([k, v]) => `${new Date(k).toLocaleDateString('nl-NL')};${Math.round(v.earned)};${Math.round(v.spent)};${Math.round(v.earned - v.spent)};${Math.round(v.onlineMs / 60e3)}`).join('\n'));
            body.querySelector('#it-wipe').onclick = () => {
                if (!confirm('Alle credit-metingen wissen? Dit kan niet ongedaan worden. (Het spel zelf verandert niet.)')) return;
                saveSamples([]);
                render();
            };
        }

        /* ========================================================================
         * NAVBAR BADGE
         * ==================================================================== */
        function addButton() {
            ctx.menu({ icon: '💰', label: 'Inkomsten', run: () => { if (!overlay) open(); } });
            ctx.actions([{ label: 'Openen', kind: 'primary', run: () => { if (!overlay) open(); } }]);
            if (!ctx.cfg.navBadge || document.getElementById('it-open')) return;
            const nav = document.querySelector('#navbar-main-collapse ul.nav.navbar-nav, .navbar ul.nav.navbar-nav');
            if (nav) {
                const li = document.createElement('li');
                li.innerHTML = '<a href="#" id="it-open" title="Inkomsten">💰 <span id="it-badge">Inkomsten</span></a>';
                nav.appendChild(li);
            } else {
                const b = document.createElement('button');
                b.id = 'it-open';
                b.innerHTML = '💰 <span id="it-badge">Inkomsten</span>';
                b.style.cssText = 'position:fixed;left:10px;bottom:44px;z-index:99999;padding:6px 10px;border-radius:6px;border:1px solid #3d434d;background:#2a2e35;color:#e4e6ea;cursor:pointer;';
                document.body.appendChild(b);
            }
            document.getElementById('it-open').addEventListener('click', e => { e.preventDefault(); if (!overlay) open(); });
        }

        function updateBadge() {
            const el = document.getElementById('it-badge');
            if (!el) return;
            const a = analyse();
            el.textContent = a.rate != null ? `${compactNum(a.rate)}/u` : 'Inkomsten';
            el.parentElement.title = `Inkomsten\nVandaag: ${nl(a.t.earned)} verdiend, ${nl(a.t.spent)} uitgegeven`
                + (a.rate != null ? `\nTempo: ${nl(a.rate)} per online uur (laatste ${CONFIG.RATE_WINDOW_H} u)` : '');
        }

        /* ========================================================================
         * START
         * ==================================================================== */
        addButton();
        if (!hookLive()) {
            // Game scripts may load after us; try a few more times.
            let tries = 0;
            const t = setInterval(() => { if (hookLive() || ++tries > 10) clearInterval(t); }, 2000);
        }
        sample(false);
        setInterval(() => sample(false), CONFIG.SAMPLE_MS);
        if (ctx.cfg.autoLog) {
            const autoSync = () => syncLog(null, false)
                .then(d => { if (d && overlay && ui.tab === 'log' && document.activeElement?.id !== 'it-log-q') render(); })
                .catch(e => warn('auto log sync failed', e));
            setTimeout(autoSync, 15e3);  // let the page settle first
            setInterval(autoSync, CONFIG.LOG_SYNC_MS);
        }
        setInterval(updateBadge, CONFIG.BADGE_MS);
        updateBadge();
        log('started');
    },
});

/* ==== module: daily-summary =============================================== */
MKS.module({
    id: 'daily-summary',
    name: 'Dagsamenvatting totalen',
    icon: '📊',
    category: 'tools',
    description: 'Boven de dagsamenvatting (Credits → Dagsamenvatting): inkomsten, uitgaven en netto van die dag, en per soort het aantal en de credits: '
        + 'eigen inzetten, teaminzetten, patiënten, arrestanten, teamopnames, taken en beloningen, geannuleerd en loos alarm, uitgaven. '
        + 'Klik een vak om de tabel daarop te filteren.',
    at: 'ready',
    frames: 'all',
    pages: /^\/credits\/daily/,
    pageNote: 'Alleen op de dagsamenvatting',
    live: true,

    run(ctx) {
        const table = document.querySelector('#iframe-inside-container table.table, #iframe-inside-container table');
        if (!table) return;

        // First match wins. `test` gets the description and the credits.
        const GROUPS = [
            { key: 'spend', label: 'Uitgaven', color: '#ef4a52', test: (d, c) => c < 0 },
            { key: 'patients', label: 'Patiënten', color: '#f0a83c', test: (d) => /^Patiënten behandeling/i.test(d) },
            { key: 'teamIn', label: 'Teamopnames', color: '#9b7bea', test: (d) => /Teamopname/i.test(d) },
            { key: 'prisoners', label: 'Arrestanten', color: '#3ecf8e', test: (d) => /^Arrestanten/i.test(d) },
            { key: 'tasks', label: 'Taken & beloningen', color: '#e0c341', test: (d) => /^Taak '|beloning|^Prestatie|^Bonus/i.test(d) },
            { key: 'void', label: 'Geannuleerd & loos alarm', color: '#8a96a3', test: (d) => / - (Gecanceld|Loos alarm)$/i.test(d) },
            { key: 'team', label: 'Teaminzetten', color: '#31c4dd', test: (d) => /^\[Team\]/.test(d) },
            { key: 'missions', label: 'Eigen inzetten', color: '#4f8df5', test: () => true },
        ];

        const num = (s) => {
            const m = String(s).match(/-?\d[\d.]*/);
            return m ? Number(m[0].replace(/\./g, '')) : 0;
        };

        // Column order is Credits | Ø | Aantal | Beschrijving; read the headers
        // anyway in case the game moves them.
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
        const col = (name, fallback) => { const i = heads.findIndex((h) => h.startsWith(name)); return i >= 0 ? i : fallback; };
        const iCredits = col('credits', 0);
        const iCount = col('aantal', 2);
        const iDesc = col('beschrijving', 3);

        const rows = [...table.querySelectorAll('tbody > tr')].map((tr) => {
            const credits = num(tr.cells[iCredits] && tr.cells[iCredits].textContent);
            const desc = (tr.cells[iDesc] ? tr.cells[iDesc].textContent : '').trim().replace(/\s+/g, ' ');
            const count = num(tr.cells[iCount] && tr.cells[iCount].textContent) || 1;
            const group = GROUPS.find((g) => g.test(desc, credits));
            return { tr, credits, count, desc, group: group.key };
        });

        const sums = Object.fromEntries(GROUPS.map((g) => [g.key, { n: 0, credits: 0 }]));
        let income = 0, spend = 0;
        for (const r of rows) {
            sums[r.group].n += r.count;
            sums[r.group].credits += r.credits;
            if (r.credits >= 0) income += r.credits; else spend += r.credits;
        }

        const style = document.createElement('style');
        style.textContent = `
            .mks-ds { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin: 8px 0 14px; }
            .mks-ds-card { border: 1px solid rgba(128,128,128,.35); border-left: 4px solid var(--c); border-radius: 6px; padding: 6px 10px;
                cursor: pointer; user-select: none; background: rgba(128,128,128,.06); }
            .mks-ds-card:hover { background: rgba(128,128,128,.14); }
            .mks-ds-card.on { background: rgba(128,128,128,.22); box-shadow: 0 0 0 2px var(--c) inset; }
            .mks-ds-card.total { cursor: default; }
            .mks-ds-card .l { font-size: 12px; opacity: .75; }
            .mks-ds-card .v { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
            .mks-ds-card .s { font-size: 12px; opacity: .75; font-variant-numeric: tabular-nums; }
            .mks-ds-hidden { display: none !important; }
        `;
        document.head.appendChild(style);

        const nl = ctx.nl;
        const signed = (n) => (n > 0 ? '+' : '') + nl(n);
        const box = document.createElement('div');
        box.className = 'mks-ds';
        const totalCards = [
            { label: 'Inkomsten', color: '#3ecf8e', v: nl(income) },
            { label: 'Uitgaven', color: '#ef4a52', v: nl(spend), g: 'spend', s: `${nl(sums.spend.n)}×` },
            { label: 'Netto', color: income + spend >= 0 ? '#3ecf8e' : '#ef4a52', v: signed(income + spend) },
        ].map((c) => `<div class="mks-ds-card${c.g ? '' : ' total'}" ${c.g ? `data-g="${c.g}" title="Klik: alleen deze regels tonen"` : ''} style="--c:${c.color}">`
            + `<div class="l">${c.label}</div><div class="v">${c.v}</div>${c.s ? `<div class="s">${c.s}</div>` : ''}</div>`);
        const groupCards = GROUPS.filter((g) => g.key !== 'spend' && sums[g.key].n).map((g) => {
            const s = sums[g.key];
            const avg = s.n ? Math.round(s.credits / s.n) : 0;
            return `<div class="mks-ds-card" data-g="${g.key}" style="--c:${g.color}" title="Klik: alleen deze regels tonen">
                <div class="l">${g.label}</div><div class="v">${nl(s.credits)}</div><div class="s">${nl(s.n)}× · Ø ${nl(avg)}</div></div>`;
        });
        box.innerHTML = totalCards.concat(groupCards).join('');
        table.insertAdjacentElement('beforebegin', box);

        let active = null;
        box.addEventListener('click', (ev) => {
            const card = ev.target.closest('.mks-ds-card[data-g]');
            if (!card) return;
            active = active === card.dataset.g ? null : card.dataset.g;
            box.querySelectorAll('.mks-ds-card[data-g]').forEach((c) => c.classList.toggle('on', c.dataset.g === active));
            for (const r of rows) r.tr.classList.toggle('mks-ds-hidden', !!active && r.group !== active);
        });

        return {
            stop() {
                rows.forEach((r) => r.tr.classList.remove('mks-ds-hidden'));
                box.remove();
                style.remove();
            },
        };
    },
});

/* ==== module: vehicle-status-bar ========================================== */
MKS.module({
    id: 'vehicle-status-bar',
    name: 'Voertuigstatusbalk',
    icon: '🚦',
    category: 'tools',
    description: 'Een balk onder de kaart met hoeveel voertuigen er per status zijn: beschikbaar, aanrijdend, ter plaatse, '
        + 'spraakaanvraag, transport en buiten dienst. Plus hoeveel procent van je inzetbare voertuigen bezig is. Werkt live mee.',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Alleen op de hoofdpagina met de kaart.',
    live: true,
    settings: [
        { key: 'place', label: 'Plaats', type: 'select', default: 'below',
            options: [['below', 'Onder de kaart'], ['above', 'Boven de kaart'], ['overlay', 'Op de kaart (linksonder)']] },
        { key: 'busy', label: 'Percentage bezig tonen', type: 'bool', default: true,
            help: 'Aanrijdend, ter plaatse, spraakaanvraag en transport, gedeeld door alles behalve buiten dienst.' },
        { key: 'hideZero', label: 'Statussen met 0 verbergen', type: 'bool', default: false },
    ],

    run(ctx) {
        const W = ctx.W;
        if (!W.map || typeof W.map.getContainer !== 'function') return;

        // Game FMS codes. Order = order in the bar.
        const STATUS = [
            { fms: 2, label: 'Op post', color: '#2e8b57', title: 'Beschikbaar op post' },
            { fms: 1, label: 'Vrij', color: '#3cb371', title: 'Beschikbaar via portofoon (vrij onderweg)' },
            { fms: 3, label: 'Aanrijdend', color: '#e08a00', title: 'Aanrijdend naar een inzet' },
            { fms: 4, label: 'Ter plaatse', color: '#c0392b', title: 'Ter plaatse' },
            { fms: 5, label: 'Spraak', color: '#d4ac0d', title: 'Spraakaanvraag' },
            { fms: 7, label: 'Transport', color: '#2874a6', title: 'Met patiënt of gevangene onderweg' },
            { fms: 8, label: 'Bij bestemming', color: '#7d3c98', title: 'Bij ziekenhuis of cel' },
            { fms: 6, label: 'Buiten dienst', color: '#7f8c8d', title: 'Buiten dienst' },
        ];
        const BUSY = [3, 4, 5, 7, 8];
        const RESYNC_MS = 5 * 60 * 1000;

        const state = new Map(); // vehicleId -> fms
        let stopped = false;

        const bar = document.createElement('div');
        bar.className = 'mks-vsb';
        const style = document.createElement('style');
        style.textContent = `
            .mks-vsb { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 6px;
                font-size: 12px; line-height: 1.4; background: rgba(0,0,0,.06); border-radius: 4px; margin: 4px 0; }
            .mks-vsb.mks-vsb-overlay { background: rgba(255,255,255,.88); color: #222; margin: 0;
                box-shadow: 0 1px 4px rgba(0,0,0,.3); max-width: 70vw; }
            .mks-vsb-chip { display: inline-flex; gap: 4px; align-items: center; padding: 1px 7px; border-radius: 10px;
                color: #fff; white-space: nowrap; cursor: default; }
            .mks-vsb-chip b { font-variant-numeric: tabular-nums; }
            .mks-vsb-busy { margin-left: auto; white-space: nowrap; font-weight: bold; padding: 0 4px; }
            .mks-vsb-meter { display: inline-block; width: 60px; height: 6px; border-radius: 3px; background: rgba(128,128,128,.35);
                vertical-align: middle; margin-left: 4px; overflow: hidden; }
            .mks-vsb-meter > span { display: block; height: 100%; }
        `;
        document.head.appendChild(style);

        let control = null;
        function place() {
            if (control) { control.remove(); control = null; }
            bar.remove();
            bar.classList.toggle('mks-vsb-overlay', ctx.cfg.place === 'overlay');
            const mapEl = W.map.getContainer();
            if (ctx.cfg.place === 'overlay' && W.L && W.L.Control) {
                const C = W.L.Control.extend({ onAdd: () => bar });
                control = new C({ position: 'bottomleft' }).addTo(W.map);
                W.L.DomEvent.disableClickPropagation(bar);
                return;
            }
            // #map_outer wraps the map (and its resize handle) on the main page.
            const anchor = document.getElementById('map_outer') || mapEl;
            anchor.insertAdjacentElement(ctx.cfg.place === 'above' ? 'beforebegin' : 'afterend', bar);
        }

        function render() {
            const count = {};
            for (const f of state.values()) count[f] = (count[f] || 0) + 1;
            const known = new Set(STATUS.map((s) => s.fms));
            const rows = STATUS.map((s) => ({ ...s, n: count[s.fms] || 0 }));
            for (const f of Object.keys(count)) {
                if (!known.has(Number(f))) rows.push({ fms: Number(f), label: `Status ${f}`, color: '#555', title: `Status ${f}`, n: count[f] });
            }
            const total = state.size;
            const usable = total - (count[6] || 0);
            const busy = BUSY.reduce((sum, f) => sum + (count[f] || 0), 0);
            const pct = usable ? Math.round((busy / usable) * 100) : 0;
            const meterColor = pct >= 75 ? '#c0392b' : pct >= 40 ? '#e08a00' : '#2e8b57';

            bar.innerHTML = rows
                .filter((r) => !ctx.cfg.hideZero || r.n)
                .map((r) => `<span class="mks-vsb-chip" style="background:${r.color}" title="${r.title} (status ${r.fms})">${r.label} <b>${r.n}</b></span>`)
                .join('')
                + (ctx.cfg.busy
                    ? `<span class="mks-vsb-busy" title="${busy} van ${usable} inzetbare voertuigen bezig (${total} totaal)">`
                        + `Bezig ${pct}%<span class="mks-vsb-meter"><span style="width:${pct}%;background:${meterColor}"></span></span></span>`
                    : '');
            ctx.status(`${busy}/${usable} bezig (${pct}%)`, { tone: 'ok' });
        }

        // Batch bursts of radio messages into one redraw.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; render(); }, 250);
        };

        async function load() {
            try {
                const list = await fetch('/api/vehicles', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
                if (stopped || !Array.isArray(list)) return;
                state.clear();
                for (const v of list) state.set(Number(v.id), Number(v.fms_real));
                render();
            } catch (e) { ctx.warn('could not load vehicles', e); }
        }

        // The game defines radioMessage in its own scripts; wait for it.
        let tries = 0;
        let hookTimer = null;
        (function hook() {
            const orig = W.radioMessage;
            if (typeof orig !== 'function') {
                if (++tries <= 30) hookTimer = setTimeout(hook, 1000);
                else ctx.warn('radioMessage not found; bar only updates every 5 minutes');
                return;
            }
            W.radioMessage = function (msg) {
                try {
                    if (!stopped && msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                        state.set(Number(msg.id), Number(msg.fms_real));
                        schedule();
                    }
                } catch (e) { ctx.warn('radio hook failed', e); }
                return orig.apply(this, arguments);
            };
        })();

        place();
        bar.textContent = 'Voertuigen laden...';
        load();
        // Bought, sold or scrapped vehicles do not come in over the radio.
        const resync = setInterval(load, RESYNC_MS);

        ctx.onSettings(() => { place(); render(); });

        return {
            stop() {
                stopped = true;
                clearInterval(resync);
                clearTimeout(timer);
                clearTimeout(hookTimer);
                if (control) control.remove();
                bar.remove();
                style.remove();
            },
        };
    },
});

/* ==== module: coverage-map ================================================ */
MKS.module({
    id: 'coverage-map',
    name: 'Dekkingskaart',
    icon: '🗺️',
    category: 'map',
    description: 'Kaartlaag die kleurt hoe snel je nearest (of 2e) brandweer-, ambulance- of politiepost ergens is: hemelsbreed of over echte wegen (OSRM). '
        + 'Laat zien waar een nieuwe post nodig is. Aan/uit en discipline kies je in het vakje rechtsboven op de kaart. Alleen lezen: koopt of verplaatst nooit iets.',
    tagline: 'Bediening rechtsboven op de kaart',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Alleen op de kaartpagina',
    settings: [
        { key: 'fireKmh', label: 'Snelheid brandweer', type: 'number', default: 60, min: 20, max: 150, step: 5, unit: 'km/u',
            help: 'Het spel rijdt elke weg even snel. IJk dit: vergelijk de reistijd van een voertuig in een inzet met wat de kaart daar toont.' },
        { key: 'ambuKmh', label: 'Snelheid ambulance', type: 'number', default: 70, min: 20, max: 150, step: 5, unit: 'km/u' },
        { key: 'policeKmh', label: 'Snelheid politie', type: 'number', default: 70, min: 20, max: 150, step: 5, unit: 'km/u' },
        { key: 'roadFactor', label: 'Omrijfactor hemelsbreed', type: 'number', default: 1.35, min: 1, max: 2, step: 0.05,
            help: 'Hemelsbrede afstand × deze factor ≈ afstand over de weg.' },
        { key: 'samplePx', label: 'Detail', type: 'range', default: 8, min: 4, max: 16, step: 2, unit: ' px', help: 'Grootte van een kleurvlak. Kleiner = scherper maar trager.' },
        { key: 'gridKm', label: 'Rasterafstand over de weg', type: 'number', default: 1.5, min: 0.5, max: 5, step: 0.5, unit: 'km',
            help: 'Kleiner = fijner, maar veel meer verzoeken aan de OSRM-server (eerste keer enkele minuten).' },
        { key: 'requireVehicles', label: 'Alleen posten met voertuigen', type: 'bool', default: true, help: 'Een lege post dekt niets.' },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * Two modes:
         *   - Hemelsbreed: straight-line distance x ROAD_FACTOR. Instant, but
         *     draws circles.
         *   - Over de weg: real driving distance from the public OSRM router
         *     (router.project-osrm.org, OpenStreetMap roads) to a grid of
         *     points GRID_KM apart. This sends your post locations to that
         *     server. First run takes a few minutes (max 1 request/second, the
         *     server's usage policy); results are cached in this browser, and
         *     only new posts cause new requests later.
         * Time = turnoutMin + distance / speedKmh (the game drives every road
         * at the same speed). Calibrate speedKmh: open a mission, compare the
         * game's travel time for a vehicle with what this layer shows there.
         *
         * NORM_MIN is the real Dutch response norm per discipline:
         *   brandweer 8 min (Besluit veiligheidsregio's, prio 1 woonfunctie),
         *   ambulance 15 min (A1), politie 15 min (prio 1).
         * Colour bands: green <= 60% of norm, yellow <= norm,
         * orange <= 150% of norm, red beyond that.
         * ==================================================================== */
        const CONFIG = {
            DEBUG: false,
            ROAD_FACTOR: ctx.cfg.roadFactor,
            REFRESH_MS: 5 * 60 * 1000,   // re-read /api/buildings + /api/vehicles
            SAMPLE_PX: ctx.cfg.samplePx,                // colour cell size in screen pixels; lower = sharper but slower
            DEFAULT_OPACITY: 0.35,
            // Road mode
            OSRM_URL: 'https://router.project-osrm.org/table/v1/driving/',
            OSRM_MAX_COORDS: 100,        // public server's table limit
            OSRM_DELAY_MS: 1100,         // public server allows 1 request/second
            GRID_KM: ctx.cfg.gridKm,                // road grid spacing; smaller = finer but many more requests
            MARGIN_KM: 12,               // only compute points within this distance of a post
            CANDIDATES: 4,               // route to this many straight-line-nearest posts per point
            SNAP_MAX_M: 1500,            // point further than this from any road (water, forest) = no colour
            ROAD_CACHE_KEY: 'mks-coverage-roads-v1',
            // Only count a building if it has at least one vehicle. A post you
            // bought but never filled covers nothing.
            REQUIRE_VEHICLES: ctx.cfg.requireVehicles,
            DISCIPLINES: {
                fire:      { label: 'Brandweer', types: [0, 17],     speedKmh: ctx.cfg.fireKmh, turnoutMin: 0, normMin: 8 },
                ambulance: { label: 'Ambulance', types: [3, 13],     speedKmh: ctx.cfg.ambuKmh, turnoutMin: 0, normMin: 15 },
                police:    { label: 'Politie',   types: [5, 11, 18], speedKmh: ctx.cfg.policeKmh, turnoutMin: 0, normMin: 15 },
            },
        };

        const STORE_KEY = 'mks-coverage-map';
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[CoverageMap]', 'color:#0a6', ...a); };
        const warn = (...a) => console.warn('[CoverageMap]', ...a);

        /* ========================================================================
         * SETTINGS (per browser, convenience only)
         * ==================================================================== */
        function loadSettings() {
            const def = { discipline: 'off', rank: 1, opacity: CONFIG.DEFAULT_OPACITY, mode: 'line' };
            try {
                return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
            } catch (e) {
                return def;
            }
        }
        function saveSettings(s) {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
        }
        const settings = loadSettings();

        /* ========================================================================
         * DATA
         * ==================================================================== */
        async function apiGet(path) {
            const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }

        // discipline -> [{ lat, lon, name, vehicles }]
        let stations = {};

        async function loadStations() {
            const [buildings, vehicles] = await Promise.all([
                apiGet('/api/buildings'),
                CONFIG.REQUIRE_VEHICLES ? apiGet('/api/vehicles') : Promise.resolve([]),
            ]);
            const vehicleCount = {};
            for (const v of vehicles) vehicleCount[v.building_id] = (vehicleCount[v.building_id] || 0) + 1;

            const out = {};
            for (const [key, d] of Object.entries(CONFIG.DISCIPLINES)) {
                const types = new Set(d.types);
                out[key] = buildings
                    .filter((b) => types.has(b.building_type))
                    .filter((b) => b.enabled !== false)
                    .filter((b) => !CONFIG.REQUIRE_VEHICLES || vehicleCount[b.id] > 0)
                    .map((b) => ({ lat: Number(b.latitude), lon: Number(b.longitude), name: b.caption, vehicles: vehicleCount[b.id] || 0 }))
                    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
            }
            stations = out;
            log('stations loaded', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
        }

        /* ========================================================================
         * TRAVEL TIME
         * ==================================================================== */
        const KM_PER_DEG_LAT = 110.57;

        // Minutes to the rank-th nearest station (rank 1 = nearest).
        function travelMinutes(lat, lon, list, d, rank) {
            const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
            let best1 = Infinity, best2 = Infinity;
            for (const s of list) {
                const dx = (s.lon - lon) * kmPerDegLon;
                const dy = (s.lat - lat) * KM_PER_DEG_LAT;
                const d2 = dx * dx + dy * dy;
                if (d2 < best1) { best2 = best1; best1 = d2; } else if (d2 < best2) { best2 = d2; }
            }
            const km = Math.sqrt(rank === 2 ? best2 : best1) * CONFIG.ROAD_FACTOR;
            return d.turnoutMin + (km / d.speedKmh) * 60;
        }

        /* ========================================================================
         * ROAD MODE
         * ====================================================================
         * Fixed lattice (same cells every time) so cache keys stay valid when
         * posts are added. Cache: "i,j" -> { "<post lat,lon>": metres | -1 }
         * plus x: 1 when the point itself is too far from any road.
         * ==================================================================== */
        const DLAT = CONFIG.GRID_KM / KM_PER_DEG_LAT;
        const DLON = CONFIG.GRID_KM / (111.32 * Math.cos((52.2 * Math.PI) / 180));
        const stationKey = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        ctx.actions([
            { label: 'Wegen-cache wissen', kind: 'danger', title: 'Alle berekende weg-afstanden vergeten (bijv. na een andere rasterafstand).',
                confirm: 'Alle opgeslagen weg-afstanden wissen? De volgende keer "Over de weg" rekent alles opnieuw uit.',
                run: () => { roadCache = {}; try { localStorage.removeItem(CONFIG.ROAD_CACHE_KEY); } catch (e) { /* ignore */ } } },
        ]);

        let roadCache = {};
        try { roadCache = JSON.parse(localStorage.getItem(CONFIG.ROAD_CACHE_KEY) || '{}'); } catch (e) { roadCache = {}; }
        function saveRoadCache() {
            try { localStorage.setItem(CONFIG.ROAD_CACHE_KEY, JSON.stringify(roadCache)); } catch (e) { warn('road cache not saved (storage full?)', e); }
        }

        function straightKm(lat, lon, s) {
            const dx = (s.lon - lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
            const dy = (s.lat - lat) * KM_PER_DEG_LAT;
            return Math.sqrt(dx * dx + dy * dy);
        }

        // Grid points near the posts, each with its nearest candidate posts.
        function gridPoints(list) {
            if (!list.length) return [];
            const lats = list.map((s) => s.lat), lons = list.map((s) => s.lon);
            const mLat = CONFIG.MARGIN_KM / KM_PER_DEG_LAT, mLon = CONFIG.MARGIN_KM / 68;
            const i0 = Math.floor((Math.min(...lats) - mLat) / DLAT), i1 = Math.ceil((Math.max(...lats) + mLat) / DLAT);
            const j0 = Math.floor((Math.min(...lons) - mLon) / DLON), j1 = Math.ceil((Math.max(...lons) + mLon) / DLON);
            const out = [];
            for (let i = i0; i <= i1; i++) {
                for (let j = j0; j <= j1; j++) {
                    const lat = i * DLAT, lon = j * DLON;
                    const near = list.map((s) => [straightKm(lat, lon, s), s]).sort((a, b) => a[0] - b[0]);
                    if (near[0][0] > CONFIG.MARGIN_KM) continue;
                    out.push({ i, j, lat, lon, key: `${i},${j}`, cands: near.slice(0, CONFIG.CANDIDATES).map((x) => x[1]) });
                }
            }
            return out;
        }

        async function osrmTable(srcs, dests) {
            const coords = srcs.concat(dests).map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
            const q = `sources=${srcs.map((_, k) => k).join(';')}&destinations=${dests.map((_, k) => k + srcs.length).join(';')}&annotations=distance`;
            for (let attempt = 0; ; attempt++) {
                const res = await fetch(`${CONFIG.OSRM_URL}${coords}?${q}`);
                if (res.status === 429 && attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
                if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
                const data = await res.json();
                if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);
                return data;
            }
        }

        // Fill the cache for one discipline. Only asks for pairs not cached yet.
        // Returns false when cancelled.
        async function computeRoads(list, isCancelled, onProgress, onBatch) {
            const todo = gridPoints(list).filter((p) => {
                const c = roadCache[p.key];
                return !(c && (c.x || p.cands.every((s) => stationKey(s) in c)));
            });
            // Group spatially so neighbouring points share their candidate posts.
            const blocks = new Map();
            for (const p of todo) {
                const bk = `${Math.floor(p.i / 6)},${Math.floor(p.j / 6)}`;
                if (!blocks.has(bk)) blocks.set(bk, []);
                blocks.get(bk).push(p);
            }
            const jobs = [];
            for (const pts of blocks.values()) {
                const srcMap = new Map();
                for (const p of pts) {
                    for (const s of p.cands) {
                        if (!(roadCache[p.key] && stationKey(s) in roadCache[p.key])) srcMap.set(stationKey(s), s);
                    }
                }
                const srcs = [...srcMap.values()];
                const room = Math.max(1, CONFIG.OSRM_MAX_COORDS - srcs.length);
                for (let k = 0; k < pts.length; k += room) jobs.push({ srcs, dests: pts.slice(k, k + room) });
            }
            log(`road mode: ${todo.length} points, ${jobs.length} requests`);
            for (let n = 0; n < jobs.length; n++) {
                if (isCancelled()) return false;
                onProgress(n, jobs.length);
                const { srcs, dests } = jobs[n];
                const data = await osrmTable(srcs, dests);
                dests.forEach((p, di) => {
                    const c = roadCache[p.key] = roadCache[p.key] || {};
                    if ((data.destinations[di]?.distance ?? 0) > CONFIG.SNAP_MAX_M) c.x = 1;
                    srcs.forEach((s, si) => {
                        const m = data.distances[si][di];
                        c[stationKey(s)] = m == null ? -1 : Math.round(m);
                    });
                });
                if (n % 5 === 4) { saveRoadCache(); onBatch(); }
                await sleep(CONFIG.OSRM_DELAY_MS);
            }
            saveRoadCache();
            onProgress(jobs.length, jobs.length);
            return true;
        }

        // "i,j" -> minutes to the rank-th nearest post by road, for rendering.
        function roadMinutesGrid(list, d, rank) {
            const keys = new Set(list.map(stationKey));
            const out = new Map();
            for (const [pk, c] of Object.entries(roadCache)) {
                if (c.x) continue;
                const metres = [];
                for (const [sk, m] of Object.entries(c)) if (m >= 0 && keys.has(sk)) metres.push(m);
                if (metres.length < rank) continue;
                metres.sort((a, b) => a - b);
                out.set(pk, d.turnoutMin + (metres[rank - 1] / 1000 / d.speedKmh) * 60);
            }
            return out;
        }

        // Bilinear blend of the 4 surrounding grid points; null when none known.
        function roadMinutesAt(grid, lat, lon) {
            const fi = lat / DLAT, fj = lon / DLON;
            const i = Math.floor(fi), j = Math.floor(fj), t = fi - i, u = fj - j;
            let sum = 0, w = 0;
            for (const [di, dj, wt] of [[0, 0, (1 - t) * (1 - u)], [1, 0, t * (1 - u)], [0, 1, (1 - t) * u], [1, 1, t * u]]) {
                const v = grid.get(`${i + di},${j + dj}`);
                if (v !== undefined && wt > 0) { sum += v * wt; w += wt; }
            }
            return w > 0.2 ? sum / w : null;
        }

        const BANDS = [
            { upTo: 0.6, color: [40, 167, 69], label: (n) => `≤ ${Math.round(n * 0.6)} min` },
            { upTo: 1.0, color: [255, 193, 7], label: (n) => `≤ ${n} min (norm)` },
            { upTo: 1.5, color: [253, 126, 20], label: (n) => `≤ ${Math.round(n * 1.5)} min` },
            { upTo: Infinity, color: [220, 53, 69], label: (n) => `> ${Math.round(n * 1.5)} min` },
        ];
        function bandColor(minutes, normMin) {
            const r = minutes / normMin;
            for (const b of BANDS) if (r <= b.upTo) return b.color;
            return BANDS[BANDS.length - 1].color;
        }

        /* ========================================================================
         * LAYER + CONTROL
         * ==================================================================== */
        function init(map, L) {
            const CoverageLayer = L.GridLayer.extend({
                createTile(coords) {
                    const size = this.getTileSize();
                    const canvas = L.DomUtil.create('canvas', 'mks-coverage-tile');
                    canvas.width = size.x;
                    canvas.height = size.y;
                    const key = settings.discipline;
                    const d = CONFIG.DISCIPLINES[key];
                    const list = stations[key] || [];
                    if (!d || !list.length) return canvas;

                    const ctx = canvas.getContext('2d');
                    const img = ctx.createImageData(size.x, size.y);
                    const step = CONFIG.SAMPLE_PX;
                    const origin = coords.scaleBy(size);
                    const rank = list.length >= 2 ? settings.rank : 1;
                    const road = settings.mode === 'road' ? roadGrid : null;

                    for (let y = 0; y < size.y; y += step) {
                        for (let x = 0; x < size.x; x += step) {
                            const ll = map.unproject(origin.add([x + step / 2, y + step / 2]), coords.z);
                            const min = road ? roadMinutesAt(road, ll.lat, ll.lng) : travelMinutes(ll.lat, ll.lng, list, d, rank);
                            if (min === null) continue;
                            const [r, g, b] = bandColor(min, d.normMin);
                            for (let yy = y; yy < Math.min(y + step, size.y); yy++) {
                                for (let xx = x; xx < Math.min(x + step, size.x); xx++) {
                                    const i = (yy * size.x + xx) * 4;
                                    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
                                }
                            }
                        }
                    }
                    ctx.putImageData(img, 0, 0);
                    return canvas;
                },
            });

            let roadGrid = new Map();
            let roadJob = null; // { discipline, cancelled }
            let roadStatus = '';

            const layer = new CoverageLayer({ opacity: settings.opacity, zIndex: 250, pane: 'overlayPane' });

            const Control = L.Control.extend({
                options: { position: 'topright' },
                onAdd() {
                    const box = L.DomUtil.create('div', 'leaflet-bar mks-coverage-control');
                    box.style.cssText = 'background:#fff;color:#222;padding:6px 8px;font-size:12px;line-height:1.5;min-width:170px;';
                    const discOptions = ['<option value="off">Uit</option>']
                        .concat(Object.entries(CONFIG.DISCIPLINES).map(([k, d]) => `<option value="${k}">${d.label}</option>`))
                        .join('');
                    box.innerHTML = `
                        <b>Dekking</b>
                        <select class="mks-cov-disc" style="width:100%;margin:2px 0;color:#222">${discOptions}</select>
                        <div class="mks-cov-more">
                            <select class="mks-cov-mode" style="width:100%;margin:2px 0;color:#222">
                                <option value="line">Hemelsbreed (snel)</option>
                                <option value="road">Over de weg</option>
                            </select>
                            <label style="font-weight:normal;margin:0"><input type="checkbox" class="mks-cov-rank"> 2e post (back-up)</label>
                            <input type="range" class="mks-cov-opacity" min="0.1" max="0.8" step="0.05" style="width:100%" title="Doorzichtigheid">
                            <div class="mks-cov-legend"></div>
                            <div class="mks-cov-status" style="color:#777"></div>
                        </div>`;
                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);

                    const sel = box.querySelector('.mks-cov-disc');
                    const rank = box.querySelector('.mks-cov-rank');
                    const opacity = box.querySelector('.mks-cov-opacity');
                    const mode = box.querySelector('.mks-cov-mode');
                    mode.value = settings.mode === 'road' ? 'road' : 'line';
                    mode.addEventListener('change', () => { settings.mode = mode.value; saveSettings(settings); apply(); });
                    sel.value = CONFIG.DISCIPLINES[settings.discipline] ? settings.discipline : 'off';
                    rank.checked = settings.rank === 2;
                    opacity.value = settings.opacity;

                    sel.addEventListener('change', () => { settings.discipline = sel.value; saveSettings(settings); apply(); });
                    rank.addEventListener('change', () => { settings.rank = rank.checked ? 2 : 1; saveSettings(settings); apply(); });
                    opacity.addEventListener('input', () => {
                        settings.opacity = Number(opacity.value);
                        layer.setOpacity(settings.opacity);
                        saveSettings(settings);
                    });

                    this.box = box;
                    return box;
                },
                render() {
                    const d = CONFIG.DISCIPLINES[settings.discipline];
                    this.box.querySelector('.mks-cov-more').style.display = d ? '' : 'none';
                    if (!d) return;
                    this.box.querySelector('.mks-cov-legend').innerHTML = BANDS.map((b) =>
                        `<div><span style="display:inline-block;width:10px;height:10px;margin-right:4px;background:rgb(${b.color.join(',')})"></span>${b.label(d.normMin)}</div>`
                    ).join('');
                    const n = (stations[settings.discipline] || []).length;
                    const status = n ? `${n} posten meegeteld` : 'Geen posten gevonden';
                    this.box.querySelector('.mks-cov-status').textContent = settings.mode === 'road' && roadStatus ? `${status} · ${roadStatus}` : status;
                },
            });
            const control = new Control();
            map.addControl(control);

            function rebuildRoadGrid() {
                const d = CONFIG.DISCIPLINES[settings.discipline];
                const list = stations[settings.discipline] || [];
                roadGrid = d ? roadMinutesGrid(list, d, list.length >= 2 ? settings.rank : 1) : new Map();
            }

            function startRoads() {
                const key = settings.discipline;
                if (roadJob && roadJob.discipline === key && !roadJob.cancelled) return;
                if (roadJob) roadJob.cancelled = true;
                const job = roadJob = { discipline: key, cancelled: false };
                const isCancelled = () => job.cancelled || settings.mode !== 'road' || settings.discipline !== key;
                computeRoads(stations[key] || [], isCancelled,
                    (done, total) => { roadStatus = done < total ? `wegen ${done}/${total}` : ''; control.render(); },
                    () => { rebuildRoadGrid(); layer.redraw(); })
                    .then((finished) => { if (finished) { rebuildRoadGrid(); layer.redraw(); } })
                    .catch((e) => { warn('road mode failed', e); roadStatus = `wegen mislukt: ${e.message}`; control.render(); })
                    .finally(() => { if (roadJob === job) roadJob = null; });
            }

            function apply() {
                const on = !!CONFIG.DISCIPLINES[settings.discipline];
                if (on && !map.hasLayer(layer)) layer.addTo(map);
                if (!on && map.hasLayer(layer)) map.removeLayer(layer);
                if (on && settings.mode === 'road') { rebuildRoadGrid(); startRoads(); }
                if (on) layer.redraw();
                control.render();
            }

            async function refresh() {
                try {
                    await loadStations();
                    apply();
                } catch (e) {
                    warn('could not load buildings/vehicles', e);
                }
            }

            control.render();
            refresh();
            setInterval(() => { if (map.hasLayer(layer)) refresh(); }, CONFIG.REFRESH_MS);
        }

        /* ========================================================================
         * BOOT — wait for the game's Leaflet map (global `map`)
         * ==================================================================== */
        let tries = 0;
        const timer = setInterval(() => {
            const L = ctx.W.L;
            const map = ctx.W.map;
            if (L && L.GridLayer && map && typeof map.addLayer === 'function') {
                clearInterval(timer);
                log('map found');
                init(map, L);
            } else if (++tries > 60) {
                clearInterval(timer);
                log('no Leaflet map on this page');
            }
        }, 500);
    },
});

/* ==== module: placement-advisor =========================================== */
MKS.module({
    id: 'placement-advisor',
    name: 'Plaatsingsadvies',
    icon: '📍',
    category: 'map',
    description: 'Echte hulpdienstposten uit OpenStreetMap (Nederland, België, Duitsland): brandweer, ambulance, politie, ziekenhuis, heli, KNRM, '
        + 'wegbeheer (RWS, Autobahnmeisterei), bergingsbedrijven en defensie. Tijdens het bouwen zie je de posten rond de marker; klik er een en de marker springt erheen. '
        + 'Op de kaart kun je een soort aanzetten: klik een post en "Hier bouwen" opent het bouwformulier met type, plek en naam ingevuld. '
        + 'Kopen doe je altijd zelf met de knop van het spel.',
    tagline: 'Bij gebouw plaatsen en via "Echte posten" op de kaart',
    at: 'load',
    frames: 'all',
    live: true,
    settings: [
        { key: 'radiusKm', label: 'Zoekstraal', type: 'range', default: 5, min: 0.5, max: 10, step: 0.5, unit: ' km' },
        { key: 'onlyType', label: 'Alleen posten van het gekozen gebouwtype', type: 'bool', default: true,
            help: 'Uit: alle soorten hulpdienstposten. Bij een gebouwtype zonder echte tegenhanger zie je altijd alles.' },
        { key: 'mapLayer', label: 'Kaartlaag "Echte posten"', type: 'bool', default: true,
            help: 'Vakje linksboven op de kaart: kies een soort post en die verschijnen als bolletjes. Grijs = daar heb je er al een.' },
        { key: 'prefillName', label: 'Echte naam invullen', type: 'bool', default: true,
            help: 'Bij "Hier bouwen" altijd; bij klikken op een post in de lijst alleen als je zelf nog geen naam typte.' },
        { key: 'address', label: 'Adres van de marker tonen (Nominatim)', type: 'bool', default: true },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * The posts come from dist/data/posts/ in the suite repo (made by
         * `node build.js osm`), not from a live Overpass query: that takes
         * minutes and the public server is often overloaded. The data is cut
         * into 1x1 degree tiles; only the tiles around the marker or the map
         * view are downloaded, and each is cached in GM storage until the
         * data is refreshed.
         *
         * This module never buys anything. It moves the game's own placement
         * marker, and "Hier bouwen" opens the game's own form and fills it in;
         * the player still presses the game's build button.
         * ==================================================================== */
        const CONFIG = {
            get DEBUG() { return ctx.cfg.debug; },
            get RADIUS_M() { return ctx.cfg.radiusKm * 1000; },
            POLL_MS: 500,       // how often to check whether the lat/lng fields changed
            DEBOUNCE_MS: 400,   // wait this long after the last change before searching
            DATA_BASE: 'https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/data/posts/',
            CACHE_PREFIX: 'mks.placementAdvisor.',
            INDEX_MAX_AGE_MS: 24 * 60 * 60 * 1000,
            MAX_TILES: 9,       // more than this in view = "zoom in"
            NOMINATIM_URL: 'https://nominatim.openstreetmap.org/reverse',
            // Sent only by the GM_xmlhttpRequest fallback; page fetch() cannot
            // set a User-Agent.
            USER_AGENT: 'Meldkamerspel-Suite (github.com/Wheeliecat-dev/meldkamerspel-suite)',
            REQUEST_TIMEOUT_MS: 20 * 1000,
            ON_SPOT_M: 60,      // marker this close to a post = "on" that post
            OWNED_M: 200,       // own building this close to a post = already built
            MAX_ROWS: 25,
            LAYER_MIN_ZOOM: 9,
            LAYER_MAX_MARKERS: 2000,
            LAYER_STORE_KEY: 'mks-placement-layer',
            PENDING_MS: 60 * 1000, // "Hier bouwen" waits this long for the form to open
        };

        const esc = ctx.esc;
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[PlacementAdvisor]', 'color:#a06', ...a); };
        const warn = (...a) => console.warn('[PlacementAdvisor]', ...a);

        /* ========================================================================
         * Post categories (codes as written by build.js) and which category
         * belongs to each game building type (<select id="building_building_type">).
         * Types without a real counterpart (e.g. uitgangsstelling) show all.
         * BUILD_TYPE is the type "Hier bouwen" picks for a category.
         * ==================================================================== */
        const CATS = {
            F: { icon: '🚒', label: 'Brandweerkazerne', color: '#e03131' },
            A: { icon: '🚑', label: 'Ambulancepost', color: '#f5c400' },
            P: { icon: '🚓', label: 'Politiebureau', color: '#1c7ed6' },
            H: { icon: '🏥', label: 'Ziekenhuis', color: '#e64980' },
            L: { icon: '🚁', label: 'Helikopterplatform', color: '#9c36b5' },
            W: { icon: '🛟', label: 'Reddingsbrigade / KNRM', color: '#f76707' },
            R: { icon: '🚧', label: 'Wegbeheer (RWS / Autobahnmeisterei)', color: '#0ca678' },
            T: { icon: '🛻', label: 'Bergingsbedrijf', color: '#8d6e63' },
            M: { icon: '🪖', label: 'Defensie', color: '#5c940d' },
        };
        const TYPE_CAT = {
            0: 'F', 17: 'F', 4: 'F',
            3: 'A', 13: 'A',
            2: 'H',
            5: 'P', 11: 'P', 18: 'P', 8: 'P',
            6: 'L', 9: 'L', 21: 'L',
            16: 'W', 19: 'W', 20: 'W',
            22: 'R',
            24: 'T',
            23: 'M', 25: 'M', 26: 'M',
        };
        const BUILD_TYPE = { F: '0', A: '3', P: '5', H: '2', L: '6', W: '16', R: '22', T: '24', M: '25' };

        /* ========================================================================
         * HTTP
         * ====================================================================
         * Page fetch() first (GitHub raw and Nominatim both allow CORS).
         * GM_xmlhttpRequest is the fallback when fetch is blocked.
         * ==================================================================== */
        class HttpError extends Error {
            constructor(status) { super(`HTTP ${status}`); this.status = status; }
        }

        async function pageFetch(url) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                const res = await fetch(url, { signal: ac.signal, credentials: 'omit' });
                if (!res.ok) throw new HttpError(res.status);
                return await res.text();
            } finally {
                clearTimeout(t);
            }
        }

        function gmFetch(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'User-Agent': CONFIG.USER_AGENT },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                        else reject(new HttpError(res.status));
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout')),
                });
            });
        }

        async function request(url) {
            try {
                return await pageFetch(url);
            } catch (e) {
                if (e instanceof HttpError) throw e;
                log(`fetch ${url} failed (${e.message}), trying GM_xmlhttpRequest`);
                return gmFetch(url);
            }
        }

        /* ========================================================================
         * DATA (tiles)
         * ==================================================================== */
        const readGM = (key) => { try { return JSON.parse(GM_getValue(CONFIG.CACHE_PREFIX + key, 'null')); } catch (e) { return null; } };
        const writeGM = (key, value) => { try { GM_setValue(CONFIG.CACHE_PREFIX + key, JSON.stringify(value)); } catch (e) { warn('cache write failed', e); } };
        // The single NL file from before the tiles.
        try { GM_deleteValue(`${CONFIG.CACHE_PREFIX}posts`); } catch (e) { /* ignore */ }

        let indexPromise = null;
        // -> { date, tiles: Set }
        function loadIndex() {
            if (indexPromise) return indexPromise;
            const cached = readGM('index');
            if (cached && Date.now() - cached.t < CONFIG.INDEX_MAX_AGE_MS) {
                indexPromise = Promise.resolve({ date: cached.date, tiles: new Set(cached.tiles) });
                return indexPromise;
            }
            indexPromise = request(`${CONFIG.DATA_BASE}index.json`)
                .then((text) => {
                    const data = JSON.parse(text);
                    writeGM('index', { t: Date.now(), date: data.date, tiles: data.tiles });
                    log(`index: ${data.tiles.length} tiles (OSM ${data.date})`);
                    return { date: data.date, tiles: new Set(data.tiles) };
                })
                .catch((e) => {
                    indexPromise = null;
                    if (cached) { warn('could not refresh tile index, using old copy', e); return { date: cached.date, tiles: new Set(cached.tiles) }; }
                    throw e;
                });
            return indexPromise;
        }

        const tiles = new Map();     // key -> Promise<posts>
        const tilesReady = new Set();
        function loadTile(key, date) {
            if (tiles.has(key)) return tiles.get(key);
            const cached = readGM(`tile.${key}`);
            const p = (cached && cached.date === date ? Promise.resolve(cached.posts)
                : request(`${CONFIG.DATA_BASE}${key}.json`).then((text) => {
                    const data = JSON.parse(text);
                    writeGM(`tile.${key}`, { date, posts: data.posts });
                    log(`tile ${key}: ${data.posts.length} posts`);
                    return data.posts;
                }))
                .then((posts) => { tilesReady.add(key); return posts; })
                .catch((e) => {
                    tiles.delete(key);
                    if (cached) { warn(`could not refresh tile ${key}, using old copy`, e); return cached.posts; }
                    throw e;
                });
            tiles.set(key, p);
            return p;
        }

        function tileKeys(s, w, n, e) {
            const keys = [];
            for (let lat = Math.floor(s); lat <= Math.floor(n); lat++) {
                for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) keys.push(`${lat}_${lon}`);
            }
            return keys;
        }

        // -> [[lat, lon, cat, name, osmId], ...], or null when the box needs too many tiles.
        async function postsInBox(s, w, n, e) {
            const keys = tileKeys(s, w, n, e);
            if (keys.length > CONFIG.MAX_TILES) return null;
            const index = await loadIndex();
            const parts = await Promise.all(keys.filter((k) => index.tiles.has(k)).map((k) => loadTile(k, index.date)));
            return parts.flat();
        }

        function boxAround(lat, lon, radiusM) {
            const dLat = radiusM / 111320;
            const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
            return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
        }
        const boxReady = (box) => tileKeys(...box).every((k) => tilesReady.has(k));

        async function reverseGeocode(lat, lon) {
            const url = `${CONFIG.NOMINATIM_URL}?format=jsonv2&zoom=18&addressdetails=1&accept-language=nl&lat=${lat}&lon=${lon}`;
            const data = JSON.parse(await request(url));
            const a = data.address || {};
            const street = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ');
            const place = a.city || a.town || a.village || a.hamlet || a.municipality || '';
            return [street, place].filter(Boolean).join(', ') || data.display_name || '';
        }

        // Haversine distance in meters.
        function distanceMeters(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const toRad = (d) => (d * Math.PI) / 180;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        function nearbyPosts(posts, lat, lon, cat) {
            const rows = [];
            for (const [plat, plon, pcat, name, osm] of posts) {
                if (cat && pcat !== cat) continue;
                const distance = distanceMeters(lat, lon, plat, plon);
                if (distance > CONFIG.RADIUS_M) continue;
                rows.push({ lat: plat, lon: plon, cat: pcat, name, osm, distance });
            }
            rows.sort((a, b) => a.distance - b.distance);
            return rows;
        }

        const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
        const osmUrl = (id) => `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[id[0]]}/${id.slice(1)}`;

        /* ========================================================================
         * GAME MARKER + FORM
         * ====================================================================
         * The game shows a draggable Leaflet marker while you place a building
         * and writes its position into #building_latitude/#building_longitude.
         * We find that marker on the map (the draggable one closest to the
         * current field values), move it, and fire the drag events so the
         * game's own handlers run as if you dragged it.
         * ==================================================================== */
        function gameMap() {
            // The form can sit in a lightbox iframe; the map lives in the top window.
            for (const w of [ctx.W, window.parent, window.top]) {
                try {
                    const W = w.wrappedJSObject || w;
                    if (W.map && W.L && typeof W.map.eachLayer === 'function') return { map: W.map, L: W.L, W };
                } catch (e) { /* cross-origin frame */ }
            }
            return null;
        }

        function findPlacementMarker(map, L, lat, lon) {
            let best = null;
            let bestD = Infinity;
            map.eachLayer((layer) => {
                if (!(layer instanceof L.Marker)) return;
                const draggable = layer.options.draggable || (layer.dragging && layer.dragging.enabled());
                if (!draggable) return;
                const ll = layer.getLatLng();
                const d = Math.abs(ll.lat - lat) + Math.abs(ll.lng - lon);
                if (d < bestD) { bestD = d; best = layer; }
            });
            return best;
        }

        function setField(input, value) {
            input.value = value;
            const $ = ctx.W.jQuery || ctx.W.$;
            if (typeof $ === 'function') $(input).trigger('change');
            else input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function moveMarker(lat, lon) {
            const fields = findLatLngInputs();
            const g = gameMap();
            let moved = false;
            if (g) {
                const curLat = fields ? Number(fields.lat.value) : lat;
                const curLon = fields ? Number(fields.lon.value) : lon;
                const marker = findPlacementMarker(g.map, g.L, curLat, curLon);
                if (marker) {
                    marker.setLatLng([lat, lon]);
                    marker.fire('dragstart');
                    marker.fire('drag');
                    marker.fire('dragend', { target: marker, distance: 1 });
                    g.map.panTo([lat, lon]);
                    moved = true;
                }
            }
            // Make sure the form has the new position even if the game's
            // handler did not write it.
            if (fields) {
                setField(fields.lat, lat);
                setField(fields.lon, lon);
            }
            if (!moved) warn('placement marker not found on the map; only the form fields were set');
            log(`moved marker to ${lat}, ${lon}`);
        }

        function findLatLngInputs() {
            const lat = document.querySelector('#building_latitude') || document.querySelector('input[name="building[latitude]"]');
            const lon = document.querySelector('#building_longitude') || document.querySelector('input[name="building[longitude]"]');
            return lat && lon ? { lat, lon } : null;
        }
        function findGebouwtypeSelect() {
            return document.querySelector('#building_building_type') || document.querySelector('select[name="building[building_type]"]');
        }
        function findNameInput() {
            return document.querySelector('#building_name') || document.querySelector('input[name="building[name]"]');
        }
        // The game's "Nieuw gebouw" button on the map page.
        function findBuildButton() {
            const direct = document.querySelector('#build_new_building, a[href$="/buildings/new"], button[data-url$="/buildings/new"]');
            if (direct) return direct;
            return [...document.querySelectorAll('a, button')].find((el) => /nieuw gebouw|gebouw bouwen|bouw nieuw/i.test(el.textContent || '')) || null;
        }

        // Name field: fill in the real name. Without force it never overwrites
        // a name you typed yourself, only an empty field or one we filled.
        let filledName = null;
        function fillName(p, force) {
            const input = findNameInput();
            if (!ctx.cfg.prefillName || !input || !p.name) return;
            const current = input.value.trim();
            if (!force && current && current !== filledName) return;
            setField(input, p.name);
            filledName = p.name;
        }

        // Fill the open form for post p: type, position, name.
        function fillForm(p) {
            const typeSelect = findGebouwtypeSelect();
            if (typeSelect && TYPE_CAT[typeSelect.value] !== p.cat) {
                const want = BUILD_TYPE[p.cat];
                const option = [...typeSelect.options].find((o) => o.value === want)
                    || [...typeSelect.options].find((o) => TYPE_CAT[o.value] === p.cat);
                if (option) setField(typeSelect, option.value);
            }
            moveMarker(p.lat, p.lon);
            fillName(p, true);
        }

        // "Hier bouwen": open the game's form (if needed) and fill it in once it is there.
        let pending = null; // { post, until }
        function buildHere(p) {
            if (findLatLngInputs()) { fillForm(p); return; }
            const g = gameMap();
            if (g) g.map.setView([p.lat, p.lon], Math.max(g.map.getZoom(), 15));
            pending = { post: p, until: Date.now() + CONFIG.PENDING_MS };
            const btn = findBuildButton();
            if (btn) { log('opening the build form'); btn.click(); } else {
                warn('build button not found');
                toast('Klik op "Nieuw gebouw" van het spel; type, plek en naam worden dan ingevuld.');
            }
        }

        function toast(text) {
            const el = document.createElement('div');
            el.textContent = text;
            el.style.cssText = 'position:fixed;left:50%;top:80px;transform:translateX(-50%);z-index:100000;background:#111;color:#eee;font:13px sans-serif;padding:8px 14px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.5);';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 6000);
        }

        /* ========================================================================
         * PANEL (while placing a building)
         * ==================================================================== */
        let panelEl = null;
        let dismissedKey = null; // coordinates the user closed the panel for
        let shownRows = [];

        function ensurePanel() {
            if (panelEl && document.body.contains(panelEl)) return panelEl;
            panelEl = document.createElement('div');
            panelEl.id = 'pa-panel';
            panelEl.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;background:#111;color:#eee;font:12px/1.4 sans-serif;padding:10px 12px;border-radius:6px;opacity:0.95;width:320px;max-height:70vh;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
            panelEl.addEventListener('click', (e) => {
                if (e.target.closest('.pa-close')) { dismissedKey = lastKey; removePanel(); return; }
                if (e.target.closest('.pa-retry')) { recheck(); return; }
                if (e.target.closest('.pa-all')) { ctx.set('onlyType', !ctx.cfg.onlyType); recheck(); return; }
                if (e.target.closest('a')) return; // OSM link
                const row = e.target.closest('.pa-row');
                if (row) {
                    const r = shownRows[Number(row.dataset.i)];
                    if (r) { moveMarker(r.lat, r.lon); fillName(r, false); }
                }
            });
            document.body.appendChild(panelEl);
            return panelEl;
        }

        function removePanel() {
            if (panelEl) panelEl.remove();
            panelEl = null;
        }

        function show(bodyHtml) {
            if (dismissedKey && dismissedKey === lastKey) return;
            ensurePanel().innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
                + '<b>📍 Plaatsingsadvies</b>'
                + '<span class="pa-close" title="Sluiten" style="cursor:pointer;color:#999;font-size:16px;line-height:1;padding:0 2px;">×</span></div>'
                + bodyHtml;
        }

        const muted = (s) => `<div style="color:#999;">${s}</div>`;
        const link = (cls, text) => `<span class="${cls}" style="color:#7ad;cursor:pointer;text-decoration:underline;">${text}</span>`;
        const ATTRIBUTION = 'Gegevens © OpenStreetMap-bijdragers (ODbL)';

        function renderIdle() {
            show(muted(`Typ een adres of sleep de marker. Je ziet dan de echte hulpdienstposten binnen ${fmtDist(CONFIG.RADIUS_M)}.`));
        }

        function renderLoading() {
            show(muted('Posten laden...'));
        }

        function renderError(msg) {
            show(`<div style="color:#e66;">${esc(msg)}</div><div style="margin-top:6px;">${link('pa-retry', 'Opnieuw proberen')}</div>`);
        }

        function renderResults(rows, typeLabel, cat, address) {
            const radius = fmtDist(CONFIG.RADIUS_M);
            let html = address ? `<div style="margin-bottom:2px;">🏠 ${esc(address)}</div>` : '';
            if (typeLabel) {
                html += `<div style="color:#7ad;">Gekozen type: ${esc(typeLabel)}</div>`;
            }
            if (cat) {
                html += muted(ctx.cfg.onlyType
                    ? `Alleen ${esc(CATS[cat].label.toLowerCase())} · ${link('pa-all', 'toon alle posten')}`
                    : `Alle posten · ${link('pa-all', `alleen ${esc(CATS[cat].label.toLowerCase())}`)}`);
            }
            const onSpot = rows.find((r) => r.distance <= CONFIG.ON_SPOT_M && (!cat || r.cat === cat));
            if (onSpot) html += `<div style="color:#5c5;margin-top:4px;">✔ Marker staat op ${esc(onSpot.name || CATS[onSpot.cat].label)}</div>`;
            html += '<div style="margin-bottom:4px;"></div>';

            shownRows = rows.slice(0, CONFIG.MAX_ROWS);
            if (!shownRows.length) {
                show(html + muted(`Geen echte ${cat && ctx.cfg.onlyType ? esc(CATS[cat].label.toLowerCase()) : 'hulpdienstpost'} binnen ${radius}.`));
                return;
            }
            html += shownRows.map((r, i) => {
                const c = CATS[r.cat];
                const match = cat && r.cat === cat;
                return `<div class="pa-row" data-i="${i}" title="Klik: marker hierheen" style="padding:4px 2px;border-top:1px solid #333;cursor:pointer;${match ? 'color:#5c5;' : ''}"`
                    + ' onmouseover="this.style.background=\'#222\'" onmouseout="this.style.background=\'\'">'
                    + `${c.icon} <b>${esc(r.name || '(zonder naam)')}</b><br>`
                    + `<span style="color:#999;">${esc(c.label)} · ${fmtDist(r.distance)} · `
                    + `<a href="${osmUrl(r.osm)}" target="_blank" rel="noopener" style="color:#999;">OSM</a></span></div>`;
            }).join('');
            if (rows.length > shownRows.length) html += muted(`+ ${rows.length - shownRows.length} verder weg`);
            html += muted(`<div style="margin-top:6px;">Klik op een post om de marker erheen te zetten.</div><div style="font-size:10px;">${ATTRIBUTION}</div>`);
            show(html);
        }

        /* ========================================================================
         * FORM WATCHER
         * ==================================================================== */
        let lastKey = null;
        let lastRawFieldValue = null;
        let lastAddress = { key: null, text: '' };
        let debounceTimer = null;
        let seq = 0;            // drops answers for coordinates that are no longer current
        let formOpen = false;

        function recheck() {
            lastKey = null;
            lastRawFieldValue = null;
        }

        function scheduleCheck(latVal, lonVal, typeSelect) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const lat = Number(latVal);
                const lon = Number(lonVal);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
                const typeValue = typeSelect ? typeSelect.value : '';
                const key = `${lat.toFixed(6)},${lon.toFixed(6)},${typeValue},${CONFIG.RADIUS_M},${ctx.cfg.onlyType}`;
                if (key === lastKey) return;
                lastKey = key;
                const mySeq = ++seq;

                const typeLabel = typeSelect?.selectedOptions[0]?.textContent.trim() || '';
                const typeCat = TYPE_CAT[typeValue] || null;
                const filterCat = ctx.cfg.onlyType ? typeCat : null;

                // Address only when the position changed, not on a type/filter change.
                const posKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
                const addressP = !ctx.cfg.address ? Promise.resolve('')
                    : lastAddress.key === posKey ? Promise.resolve(lastAddress.text)
                        : reverseGeocode(lat, lon)
                            .then((text) => { lastAddress = { key: posKey, text }; return text; })
                            .catch((e) => { warn('Nominatim failed', e); return ''; });

                const box = boxAround(lat, lon, CONFIG.RADIUS_M);
                if (!boxReady(box)) renderLoading();
                try {
                    const posts = (await postsInBox(...box)) || [];
                    if (mySeq !== seq) return;
                    const rows = nearbyPosts(posts, lat, lon, filterCat);
                    renderResults(rows, typeLabel, typeCat, lastAddress.key === posKey ? lastAddress.text : '');
                    log(`checked ${key}: ${rows.length} post(s)`);
                    // The address is slower; add it when it arrives.
                    const address = await addressP;
                    if (mySeq === seq && address) renderResults(rows, typeLabel, typeCat, address);
                } catch (e) {
                    if (mySeq !== seq) return;
                    warn('could not load posts', e);
                    renderError(`Kon de lijst met posten niet laden (${e.message}).`);
                }
            }, CONFIG.DEBOUNCE_MS);
        }

        function poll() {
            const fields = findLatLngInputs();
            if (!fields) {
                // Form closed: hide the panel and start fresh next time.
                if (formOpen) {
                    formOpen = false;
                    filledName = null;
                    clearTimeout(debounceTimer);
                    seq++;
                    lastKey = lastRawFieldValue = dismissedKey = null;
                    removePanel();
                }
                return;
            }
            if (!formOpen) { formOpen = true; renderIdle(); }
            const latVal = fields.lat.value;
            const lonVal = fields.lon.value;
            if (!latVal || !lonVal) return;
            if (pending) {
                const p = pending.post;
                const fresh = Date.now() < pending.until;
                pending = null;
                if (fresh) { fillForm(p); return; }
            }
            const typeSelect = findGebouwtypeSelect();
            // Only reschedule on a real change: scheduleCheck() resets its
            // debounce timer, so calling it every tick would never let it fire.
            const rawKey = `${latVal}|${lonVal}|${typeSelect ? typeSelect.value : ''}|${CONFIG.RADIUS_M}|${ctx.cfg.onlyType}`;
            if (rawKey === lastRawFieldValue) return;
            lastRawFieldValue = rawKey;
            scheduleCheck(latVal, lonVal, typeSelect);
        }

        /* ========================================================================
         * MAP LAYER "Echte posten" (map page, top window only)
         * ====================================================================
         * A box top-left on the map: pick a category and its real posts show
         * as dots. A post where you already own a building of that category
         * (within OWNED_M) is grey. Clicking a dot gives "Hier bouwen".
         * ==================================================================== */
        let layerHandle = null;

        function initLayer(map, L) {
            let choice = 'off';
            try { choice = localStorage.getItem(CONFIG.LAYER_STORE_KEY) || 'off'; } catch (e) { /* ignore */ }
            if (!CATS[choice]) choice = 'off';

            const group = L.layerGroup().addTo(map);
            let owned = null;     // [{ lat, lon, cat }] from /api/buildings
            let drawSeq = 0;
            let shown = [];       // posts behind the drawn dots, for popups

            async function loadOwned() {
                if (owned) return owned;
                try {
                    const res = await fetch('/api/buildings', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    const list = res.ok ? await res.json() : [];
                    owned = list.map((b) => ({ lat: Number(b.latitude), lon: Number(b.longitude), cat: TYPE_CAT[b.building_type] }))
                        .filter((b) => b.cat && Number.isFinite(b.lat));
                } catch (e) {
                    warn('could not load own buildings', e);
                    owned = [];
                }
                return owned;
            }

            const Control = L.Control.extend({
                options: { position: 'topleft' },
                onAdd() {
                    const box = L.DomUtil.create('div', 'leaflet-bar mks-pa-layer');
                    box.style.cssText = 'background:#fff;color:#222;padding:5px 7px;font-size:12px;line-height:1.4;max-width:190px;';
                    box.innerHTML = '<b>Echte posten</b>'
                        + `<select class="mks-pa-cat" style="width:100%;margin:2px 0;color:#222"><option value="off">Uit</option>${
                            Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.icon} ${esc(c.label)}</option>`).join('')}</select>`
                        + '<div class="mks-pa-status" style="color:#777"></div>';
                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);
                    const sel = box.querySelector('.mks-pa-cat');
                    sel.value = choice;
                    sel.addEventListener('change', () => {
                        choice = sel.value;
                        try { localStorage.setItem(CONFIG.LAYER_STORE_KEY, choice); } catch (e) { /* ignore */ }
                        draw();
                    });
                    this.status = box.querySelector('.mks-pa-status');
                    return box;
                },
            });
            const control = new Control();
            map.addControl(control);
            const status = (text) => { control.status.textContent = text; };

            async function draw() {
                const mySeq = ++drawSeq;
                group.clearLayers();
                shown = [];
                if (choice === 'off') { status(''); return; }
                if (map.getZoom() < CONFIG.LAYER_MIN_ZOOM) { status('Zoom verder in'); return; }
                const b = map.getBounds();
                const box = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
                if (!boxReady(box)) status('Laden...');
                let posts;
                let mine;
                try {
                    [posts, mine] = await Promise.all([postsInBox(...box), loadOwned()]);
                } catch (e) {
                    if (mySeq === drawSeq) status(`Laden mislukt (${e.message})`);
                    return;
                }
                if (mySeq !== drawSeq) return;
                if (!posts) { status('Zoom verder in'); return; }
                const c = CATS[choice];
                const inView = posts.filter((p) => p[2] === choice && b.contains([p[0], p[1]]));
                let free = 0;
                for (const p of inView.slice(0, CONFIG.LAYER_MAX_MARKERS)) {
                    const post = { lat: p[0], lon: p[1], cat: p[2], name: p[3], osm: p[4] };
                    post.owned = mine.some((o) => o.cat === choice && distanceMeters(o.lat, o.lon, post.lat, post.lon) <= CONFIG.OWNED_M);
                    if (!post.owned) free++;
                    const i = shown.push(post) - 1;
                    L.circleMarker([post.lat, post.lon], {
                        radius: 7, weight: 2, color: '#fff',
                        fillColor: post.owned ? '#868e96' : c.color, fillOpacity: post.owned ? 0.5 : 0.9,
                    })
                        .bindTooltip(esc(post.name || c.label))
                        .bindPopup(() => popupHtml(i))
                        .addTo(group);
                }
                const more = inView.length > CONFIG.LAYER_MAX_MARKERS ? ` (eerste ${CONFIG.LAYER_MAX_MARKERS})` : '';
                status(`${inView.length} in beeld${more}, ${free} nog niet van jou`);
            }

            function popupHtml(i) {
                const p = shown[i];
                const c = CATS[p.cat];
                const formOpenNow = !!findLatLngInputs();
                return `<div style="font-size:12px;min-width:170px">${c.icon} <b>${esc(p.name || '(zonder naam)')}</b><br>`
                    + `<span style="color:#777">${esc(c.label)} · <a href="${osmUrl(p.osm)}" target="_blank" rel="noopener">OSM</a></span>`
                    + (p.owned ? '<div style="color:#868e96;margin-top:3px">Hier heb je er al een.</div>' : '')
                    + `<div style="margin-top:6px"><button type="button" class="btn btn-xs btn-success mks-pa-build" data-i="${i}">`
                    + `${formOpenNow ? 'Marker hierheen' : 'Hier bouwen'}</button></div>`
                    + `<div style="color:#999;font-size:10px;margin-top:4px">${ATTRIBUTION}</div></div>`;
            }

            const onPopupClick = (e) => {
                const btn = e.target.closest && e.target.closest('.mks-pa-build');
                if (!btn) return;
                const p = shown[Number(btn.dataset.i)];
                if (!p) return;
                map.closePopup();
                buildHere(p);
            };
            const container = map.getContainer();
            container.addEventListener('click', onPopupClick);
            map.on('moveend', draw);
            draw();

            return {
                stop() {
                    map.off('moveend', draw);
                    container.removeEventListener('click', onPopupClick);
                    map.removeLayer(group);
                    map.removeControl(control);
                },
            };
        }

        function startLayer() {
            if (layerHandle || !ctx.cfg.mapLayer || window.top !== window.self || location.pathname !== '/') return;
            let tries = 0;
            const t = setInterval(() => {
                const L = ctx.W.L;
                const map = ctx.W.map;
                if (L && L.Control && map && typeof map.addLayer === 'function') {
                    clearInterval(t);
                    if (!layerHandle && ctx.cfg.mapLayer) layerHandle = initLayer(map, L);
                } else if (++tries > 60) {
                    clearInterval(t);
                }
            }, 500);
        }
        function stopLayer() {
            if (layerHandle) layerHandle.stop();
            layerHandle = null;
        }

        // Settings apply live; no reload needed.
        ctx.onSettings(() => {
            recheck();
            if (ctx.cfg.mapLayer) startLayer(); else stopLayer();
        });

        log('watching for building placement fields...');
        const timer = setInterval(poll, CONFIG.POLL_MS);
        startLayer();

        return {
            stop() {
                clearInterval(timer);
                clearTimeout(debounceTimer);
                seq++;
                removePanel();
                stopLayer();
            },
        };
    },
});

/* ==== module: building-price ============================================== */
MKS.module({
    id: 'building-price',
    name: 'Prijs volgend gebouw',
    short: 'Gebouwprijzen',
    icon: '🏗️',
    category: 'map',
    description: 'Wat je volgende gebouw van elk soort kost, in credits en coins, hoeveel je er al hebt en hoeveel credits je nog mist. '
        + 'De prijzen komen rechtstreeks uit het bouwscherm van het spel. Verandert niets.',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [],

    run(ctx) {
        const esc = ctx.esc;
        const num = (s) => Number(String(s || '').replace(/\D/g, '')) || 0;
        let data = null;
        let busy = false;

        // /buildings/new has one "Bouwen X Credits" button per building type
        // (id build_credits_<type>) with the coins button next to it.
        async function load() {
            if (busy) return;
            busy = true;
            ctx.status('Prijzen ophalen…', { tone: 'busy' });
            try {
                const [html, buildings, credits] = await Promise.all([
                    fetch('/buildings/new', { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(`/buildings/new: ${r.status}`); return r.text(); }),
                    fetch('/api/buildings', { credentials: 'same-origin' }).then((r) => r.json()),
                    fetch('/api/credits', { credentials: 'same-origin' }).then((r) => r.json()),
                ]);
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const names = {};
                doc.querySelectorAll('#building_building_type option').forEach((o) => { if (o.value !== '') names[o.value] = o.textContent.trim(); });
                const count = {};
                buildings.forEach((b) => { count[b.building_type] = (count[b.building_type] || 0) + 1; });
                // Types missing from the build menu (e.g. 12) cannot be built: skip them.
                const rows = [...doc.querySelectorAll('input[id^="build_credits_"]')].map((btn) => {
                    const type = btn.id.replace('build_credits_', '');
                    const coinsBtn = [...btn.parentElement.querySelectorAll('input[type="submit"]')].find((b) => /coins/i.test(b.value));
                    return { type, name: names[type], credits: num(btn.value), coins: coinsBtn ? num(coinsBtn.value) : null, have: count[type] || 0 };
                }).filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
                if (!rows.length) throw new Error('geen prijzen gevonden in het bouwscherm');
                data = { rows, credits: credits.credits_user_current, coins: credits.coins_user_current, at: new Date() };
                ctx.status(`${rows.length} gebouwsoorten, je hebt ${ctx.nl(data.credits)} credits`, { tone: 'idle' });
            } catch (e) {
                ctx.err(e);
                ctx.status(`Mislukt: ${e.message}`, { tone: 'error' });
            } finally {
                busy = false;
                ctx.refresh();
            }
        }

        ctx.panel((el) => {
            if (!data) { el.innerHTML = '<p class="mks-note">Laden…</p>'; return; }
            const rows = data.rows.map((r) => {
                const short = r.credits - data.credits;
                return `<tr><td>${esc(r.name)}</td><td class="mono">${r.have}</td>
                    <td class="mono">${ctx.nl(r.credits)}</td>
                    <td class="mono">${r.coins == null ? '' : ctx.nl(r.coins)}</td>
                    <td>${short > 0 ? `<span class="mks-dim">nog ${ctx.nl(short)}</span>` : '<span class="mks-pill t-ok">genoeg</span>'}</td></tr>`;
            }).join('');
            el.innerHTML = `<p class="mks-note">Je hebt <b>${ctx.nl(data.credits)}</b> credits en <b>${ctx.nl(data.coins)}</b> coins.
                Bijgewerkt om ${data.at.toLocaleTimeString('nl-NL')}.</p>
                <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Gebouw</th><th>Heb je</th><th>Credits</th><th>Coins</th><th></th></tr></thead>
                <tbody>${rows}</tbody></table></div>`;
        });

        ctx.actions([{ label: 'Vernieuwen', kind: 'primary', run: load }]);
        ctx.menu({ icon: '🏗️', label: 'Prijs volgend gebouw', run: () => { ctx.open(); load(); } });
        load();

        return { stop() {} };
    },
});

/* ==== module: building-share ============================================== */
MKS.module({
    id: 'building-share',
    name: 'Ziekenhuizen en cellen delen',
    short: 'Gebouwen delen',
    icon: '🤝',
    category: 'map',
    description: 'Geeft al je ziekenhuizen en politiebureaus met cellen in één keer vrij voor je team, met de vergoeding die je kiest '
        + '(gratis tot 50%). Of haal ze in één keer weer uit het team. Doet alleen iets als je op een knop klikt.',
    tagline: 'Handmatig starten',
    warning: '<b>Dit verandert je gebouwen in het spel.</b> Vrijgeven en de vergoeding gelden direct voor je hele team. '
        + 'Terugdraaien kan, maar dan per knop of per gebouw met de hand.',
    confirmOn: 'Let op: met deze module kun je al je ziekenhuizen en cellen in één keer vrijgeven of weghalen uit je team.\n\n'
        + 'Er gebeurt pas iets als je in het dashboard op een knop klikt.\n\nAanzetten?',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [
        { key: 'fee', label: 'Vergoeding voor het team', type: 'select', default: '1',
            options: [['0', 'Gratis'], ['1', '10%'], ['2', '20%'], ['3', '30%'], ['4', '40%'], ['5', '50%']] },
        { key: 'hospitals', label: 'Ziekenhuizen', type: 'bool', default: true },
        { key: 'cells', label: 'Politiebureaus met cellen', type: 'bool', default: true },
        { key: 'throttleSec', label: 'Pauze tussen gebouwen', type: 'number', default: 0.5, min: 0.2, max: 5, step: 0.1, unit: 'sec' },
    ],

    run(ctx) {
        const esc = ctx.esc;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const HOSPITAL = 2;
        // Cells are extensions on a police building ("Gevangeniscel", "Extra cel").
        const hasCells = (b) => (b.extensions || []).some((e) => /\bcel\b|cel$/i.test(e.caption || ''));

        let buildings = null;
        let busy = false;
        let stopped = false;
        const log = [];

        async function get(url) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 15000);
            try {
                // The game's own links are followed with jQuery, which sends this header.
                return await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal: ac.signal });
            } finally {
                clearTimeout(t);
            }
        }

        async function load() {
            const res = await get('/api/buildings');
            if (!res.ok) throw new Error(`GET /api/buildings: ${res.status}`);
            const all = await res.json();
            buildings = all.filter((b) => (ctx.cfg.hospitals && b.building_type === HOSPITAL) || (ctx.cfg.cells && hasCells(b)))
                .sort((a, b) => a.building_type - b.building_type || String(a.caption).localeCompare(String(b.caption)));
            ctx.refresh();
            status();
        }

        const shared = (b) => !!b.is_alliance_shared;
        const feeOf = (b) => Math.round((Number(b.alliance_share_credits_percentage) || 0) / 10);

        // share = true: share everything and set the fee. share = false: stop sharing.
        // /buildings/:id/alliance toggles, so it is only called when the state differs.
        async function apply(share) {
            if (busy) return;
            busy = true;
            try {
                await load();
                const fee = Number(ctx.cfg.fee);
                const todo = buildings.filter((b) => (share ? !shared(b) || feeOf(b) !== fee : shared(b)));
                let i = 0;
                let failed = 0;
                for (const b of todo) {
                    if (stopped) return;
                    ctx.status(`${share ? 'Vrijgeven' : 'Weghalen'} ${i + 1}/${todo.length}: ${b.caption}`, { tone: 'busy', progress: [i, todo.length], dock: true });
                    try {
                        if (shared(b) !== share) {
                            const r = await get(`/buildings/${b.id}/alliance`);
                            if (!r.ok) throw new Error(`status ${r.status}`);
                            await sleep(ctx.cfg.throttleSec * 1000);
                        }
                        if (share && feeOf(b) !== fee) {
                            const r = await get(`/buildings/${b.id}/alliance_costs/${fee}`);
                            if (!r.ok) throw new Error(`status ${r.status}`);
                            await sleep(ctx.cfg.throttleSec * 1000);
                        }
                        log.unshift(`${new Date().toLocaleTimeString('nl-NL')}  ${share ? 'vrijgegeven' : 'weggehaald'}: ${b.caption}`);
                    } catch (e) {
                        failed++;
                        log.unshift(`${new Date().toLocaleTimeString('nl-NL')}  MISLUKT: ${b.caption} (${e.message})`);
                    }
                    i++;
                    ctx.refresh();
                }
                // Read back what the game actually stored.
                await load();
                const wrong = buildings.filter((b) => (share ? !shared(b) || feeOf(b) !== fee : shared(b))).length;
                ctx.status(wrong || failed ? `Klaar, maar ${wrong} gebouw(en) staan nog niet goed. Zie logboek.` : `Klaar: ${todo.length} gebouw(en) aangepast.`,
                    { tone: wrong || failed ? 'warn' : 'ok' });
            } catch (e) {
                ctx.err(e);
                ctx.status(`Mislukt: ${e.message}`, { tone: 'error' });
            } finally {
                busy = false;
                ctx.refresh();
            }
        }

        function status() {
            if (busy || !buildings) return;
            const n = buildings.filter(shared).length;
            ctx.status(`${n} van ${buildings.length} gedeeld met je team`, { tone: 'idle' });
        }

        const feeLabel = (n) => (n ? `${n * 10}%` : 'gratis');

        ctx.actions([
            { label: 'Alles vrijgeven', kind: 'primary', run: () => apply(true),
                confirm: 'Alle gekozen ziekenhuizen en cellen vrijgeven voor je team, met de ingestelde vergoeding?' },
            { label: 'Alles weghalen uit team', kind: 'danger', run: () => apply(false),
                confirm: 'Alle gekozen ziekenhuizen en cellen NIET meer delen met je team?' },
            { label: 'Vernieuwen', run: () => load().catch((e) => ctx.status(`Mislukt: ${e.message}`, { tone: 'error' })) },
        ]);

        ctx.panel((el) => {
            if (!buildings) { el.innerHTML = '<p class="mks-note">Laden…</p>'; return; }
            const rows = buildings.map((b) => `<tr>
                <td><a href="/buildings/${b.id}" class="lightbox-open">${esc(b.caption)}</a></td>
                <td>${b.building_type === HOSPITAL ? 'Ziekenhuis' : 'Cellen'}</td>
                <td>${shared(b) ? '<span class="mks-pill t-ok">gedeeld</span>' : '<span class="mks-pill">niet gedeeld</span>'}</td>
                <td class="mono">${shared(b) ? feeLabel(feeOf(b)) : ''}</td></tr>`).join('');
            el.innerHTML = `<h4 class="mks-h">Gebouwen (${buildings.length})</h4>
                <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Gebouw</th><th>Soort</th><th>Team</th><th>Vergoeding</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="mks-dim">Geen ziekenhuizen of cellen gevonden.</td></tr>'}</tbody></table></div>
                ${log.length ? `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${log.slice(0, 200).map((l) => `<tr><td class="mono">${esc(l)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
        });

        ctx.onSettings((cfg, key) => {
            if (key === 'hospitals' || key === 'cells') load().catch((e) => ctx.err(e));
        });

        load().catch((e) => {
            ctx.err(e);
            ctx.status(`Kon gebouwen niet laden: ${e.message}`, { tone: 'error' });
        });

        return { stop() { stopped = true; } };
    },
});

/* ==== module: vehicle-scrap =============================================== */
MKS.module({
    id: 'vehicle-scrap',
    name: 'Voertuigen afvoeren',
    short: 'Afvoeren',
    icon: '🗑️',
    category: 'map',
    description: 'Op de pagina van een gebouw: een vinkje achter elk voertuig en een rode knop om de aangevinkte voertuigen in één keer '
        + 'te verwijderen (naar de sloop). Vraagt altijd eerst om bevestiging, met de lijst van voertuigen.',
    warning: '<b>Afvoeren kan NIET ongedaan worden gemaakt.</b> Het voertuig is weg; '
        + 'wil je het terug, dan moet je een nieuw voertuig kopen.',
    confirmOn: 'Let op: met deze module kun je voertuigen definitief verwijderen.\n\n'
        + 'Dat kan NIET ongedaan worden gemaakt. Er gebeurt pas iets als je voertuigen aanvinkt, op de rode knop klikt en bevestigt.\n\nAanzetten?',
    at: 'ready',
    frames: 'all',
    pages: /^\/buildings\/\d+\/?$/,
    pageNote: 'Alleen op de pagina van een gebouw',
    live: true,
    settings: [
        { key: 'throttleSec', label: 'Pauze tussen voertuigen', type: 'number', default: 0.5, min: 0.2, max: 5, step: 0.1, unit: 'sec' },
    ],

    run(ctx) {
        const table = document.querySelector('#vehicle_table');
        if (!table || !table.tHead || !table.tBodies[0]) return { stop() {} };
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const added = [];
        const idOf = (tr) => {
            const a = tr.querySelector('a[href^="/vehicles/"]');
            const m = a && a.getAttribute('href').match(/^\/vehicles\/(\d+)$/);
            return m ? { id: m[1], name: a.textContent.trim() } : null;
        };

        const th = document.createElement('th');
        th.className = 'sorter-false mks-scrap-col';
        th.innerHTML = '<input type="checkbox" title="Alles aan- of uitvinken">';
        table.tHead.rows[0].appendChild(th);
        added.push(th);
        const all = th.querySelector('input');

        const boxes = [];
        for (const tr of table.tBodies[0].rows) {
            const v = idOf(tr);
            const td = document.createElement('td');
            td.className = 'mks-scrap-col';
            if (v) {
                td.innerHTML = '<input type="checkbox">';
                const cb = td.firstChild;
                cb.dataset.id = v.id;
                cb.dataset.name = v.name;
                boxes.push(cb);
            }
            tr.appendChild(td);
            added.push(td);
        }

        const btn = document.createElement('a');
        btn.className = 'btn btn-xs btn-danger';
        btn.href = '#';
        btn.style.marginLeft = '4px';
        const anchor = document.querySelector('a[href$="/vehicles/new"]');
        if (anchor) anchor.after(btn);
        else table.before(btn);
        added.push(btn);

        const checked = () => boxes.filter((b) => b.checked);
        function label() {
            const n = checked().length;
            btn.textContent = n ? `${n} voertuig(en) afvoeren` : 'Voertuigen afvoeren';
            btn.classList.toggle('disabled', !n);
            all.checked = n > 0 && n === boxes.length;
        }
        all.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all.checked; }); label(); });
        boxes.forEach((b) => b.addEventListener('change', label));
        label();

        let busy = false;
        btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const list = checked();
            if (busy || !list.length) return;
            const names = list.map((b) => `- ${b.dataset.name}`);
            const shown = names.length > 25 ? [...names.slice(0, 25), `… en nog ${names.length - 25}`] : names;
            if (!confirm(`Deze ${list.length} voertuig(en) DEFINITIEF afvoeren?\n\n${shown.join('\n')}\n\nDit kan niet ongedaan worden gemaakt.`)) return;

            const token = document.querySelector('meta[name="csrf-token"]')?.content;
            if (!token) { alert('Geen CSRF-token gevonden op deze pagina. Er is niets afgevoerd.'); return; }
            busy = true;
            let failed = 0;
            for (let i = 0; i < list.length; i++) {
                const b = list[i];
                btn.textContent = `Afvoeren ${i + 1}/${list.length}…`;
                try {
                    // Same request as the game's own delete link (Rails data-method="delete").
                    const r = await fetch(`/vehicles/${b.dataset.id}`, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'X-CSRF-Token': token },
                        body: new URLSearchParams({ _method: 'delete', authenticity_token: token }),
                    });
                    if (!r.ok) throw new Error(`status ${r.status}`);
                    ctx.log(`afgevoerd: ${b.dataset.name}`);
                } catch (e) {
                    failed++;
                    ctx.warn(`afvoeren mislukt: ${b.dataset.name}`, e);
                }
                await sleep(ctx.cfg.throttleSec * 1000);
            }
            if (failed) alert(`${failed} van ${list.length} voertuig(en) konden niet worden afgevoerd. Zie console (F12).`);
            location.reload();
        });

        return { stop() { added.forEach((el) => el.remove()); } };
    },
});

/* ==== module: personnel-assign ============================================ */
MKS.module({
    id: 'personnel-assign',
    name: 'Personeel toewijzen',
    short: 'Toewijzen',
    icon: '🧑‍🚒',
    category: 'map',
    description: 'Op de pagina <i>Personeel toewijzen</i> van een voertuig: één knop vult het voertuig tot het maximum, met het personeel '
        + 'dat het opleidingsfilter van het spel toont. Kies je in het filter een opleiding, dan krijg je alleen mensen met die opleiding. '
        + 'Bij <i>Alles</i> gaan mensen met de minste opleidingen eerst, zodat je specialisten vrij blijven. '
        + 'Een tweede knop haalt al het personeel van het voertuig af.',
    warning: '<b>Dit verandert de bezetting van je voertuigen in het spel.</b> Het klikt voor je op de knoppen '
        + '<i>Voertuig toewijzen</i> en <i>Voertuigtoewijzing verwijderen</i>, precies zoals je dat zelf zou doen. '
        + 'Er gebeurt pas iets als je op een van de knoppen klikt.',
    confirmOn: 'Let op: deze module wijst personeel toe aan voertuigen in het spel (of haalt het eraf) als je op de knoppen klikt.\n\nAanzetten?',
    at: 'ready',
    frames: 'all',
    pages: /^\/vehicles\/\d+\/zuweisung\/?$/,
    pageNote: 'Alleen op de pagina Personeel toewijzen van een voertuig',
    live: true,
    settings: [
        { key: 'steal', label: 'Ook personeel van andere voertuigen', type: 'bool', default: false,
            help: 'Uit: alleen personeel dat nog op geen enkel voertuig staat (groene knop). Aan: daarna ook mensen van andere voertuigen (oranje knop).' },
        { key: 'delayMs', label: 'Pauze tussen klikken', type: 'number', default: 300, min: 100, max: 3000, step: 50, unit: 'ms' },
    ],

    run(ctx) {
        const table = document.querySelector('#personal_table');
        if (!table) return { stop() {} };
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // Rows: green "Voertuig toewijzen" = on no vehicle, orange = on another
        // vehicle, grey .btn-assigned = on this vehicle (click removes).
        const rows = () => [...table.querySelectorAll('tr[id^="personal_"]')];
        const btnOf = (tr) => tr.querySelector('a.btn[personal_id]');
        const assigned = () => rows().filter((tr) => btnOf(tr)?.classList.contains('btn-assigned'));
        const visible = (tr) => tr.offsetParent !== null && getComputedStyle(tr).display !== 'none';
        const trainings = (tr) => {
            try { return JSON.parse(tr.getAttribute('data-filterable-by') || '[]').length; } catch (e) { return 0; }
        };

        // The page script holds the seat count: `personal_max = N`.
        function maxSeats() {
            for (const s of document.querySelectorAll('script:not([src])')) {
                const m = s.textContent.match(/personal_max\s*=\s*(\d+)/);
                if (m) return Number(m[1]);
            }
            return null;
        }

        const bar = document.createElement('div');
        bar.className = 'mks-assign';
        bar.style.cssText = 'margin:8px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
        bar.innerHTML = `<a href="#" class="btn btn-success btn-sm" data-act="fill"></a>
            <a href="#" class="btn btn-default btn-sm" data-act="clear">Al het personeel eraf halen</a>
            <span class="mks-assign-msg" style="opacity:.8"></span>`;
        table.before(bar);
        const fillBtn = bar.querySelector('[data-act="fill"]');
        const msg = bar.querySelector('.mks-assign-msg');

        function label() {
            const max = maxSeats();
            const have = assigned().length;
            fillBtn.textContent = max == null ? 'Vul voertuig' : `Vul voertuig (${have}/${max})`;
            fillBtn.classList.toggle('disabled', max != null && have >= max);
        }

        // Click the game's own button and wait until the game has swapped it.
        async function press(tr) {
            const before = btnOf(tr);
            if (!before) return false;
            const wasAssigned = before.classList.contains('btn-assigned');
            before.click();
            for (let i = 0; i < 50; i++) {
                await sleep(100);
                // The game may redraw the row, so look it up again by id.
                const row = document.getElementById(tr.id) || tr;
                const now = btnOf(row);
                if (now && now.classList.contains('btn-assigned') !== wasAssigned) return true;
            }
            return false;
        }

        let busy = false;
        async function fill() {
            const max = maxSeats();
            if (max == null) { msg.textContent = 'Kon het maximum aantal zitplaatsen niet vinden.'; return; }
            const need = max - assigned().length;
            if (need <= 0) { msg.textContent = 'Voertuig is al vol.'; return; }
            const pick = (cls) => rows().filter((tr) => visible(tr) && btnOf(tr)?.classList.contains(cls))
                .sort((a, b) => trainings(a) - trainings(b));
            const pool = [...pick('btn-success'), ...(ctx.cfg.steal ? pick('btn-warning') : [])].slice(0, need);
            if (!pool.length) {
                msg.textContent = ctx.cfg.steal ? 'Geen passend personeel gevonden.' : 'Geen vrij passend personeel. Zet in het dashboard "Ook personeel van andere voertuigen" aan om ook die te gebruiken.';
                return;
            }
            let ok = 0;
            for (const tr of pool) {
                msg.textContent = `Toewijzen ${ok + 1}/${pool.length}…`;
                if (!(await press(tr))) { msg.textContent = `Gestopt: het spel reageerde niet op ${tr.cells[0]?.textContent.trim()}.`; label(); return; }
                ok++;
                label();
                await sleep(ctx.cfg.delayMs);
            }
            msg.textContent = ok < need ? `${ok} toegewezen; er was niet genoeg passend personeel voor ${need}.` : `${ok} toegewezen.`;
        }

        async function clear() {
            const list = assigned();
            if (!list.length) { msg.textContent = 'Er staat niemand op dit voertuig.'; return; }
            if (!confirm(`${list.length} personeelslid/-leden van dit voertuig afhalen?`)) return;
            let ok = 0;
            for (const tr of list) {
                msg.textContent = `Afhalen ${ok + 1}/${list.length}…`;
                if (!(await press(tr))) { msg.textContent = `Gestopt: het spel reageerde niet op ${tr.cells[0]?.textContent.trim()}.`; label(); return; }
                ok++;
                label();
                await sleep(ctx.cfg.delayMs);
            }
            msg.textContent = `${ok} afgehaald.`;
        }

        bar.addEventListener('click', async (ev) => {
            const a = ev.target.closest('[data-act]');
            if (!a) return;
            ev.preventDefault();
            if (busy || a.classList.contains('disabled')) return;
            busy = true;
            try { await (a.dataset.act === 'fill' ? fill() : clear()); } finally { busy = false; label(); }
        });

        // The game's own buttons change the count too.
        const obs = new MutationObserver(() => { if (!busy) label(); });
        obs.observe(table, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
        label();

        return { stop() { obs.disconnect(); bar.remove(); } };
    },
});

/* ==== module: auto-dispatch =============================================== */
MKS.module({
    id: 'auto-dispatch',
    name: 'Automatisch alarmeren',
    short: 'Auto-alarm',
    icon: '🤖',
    category: 'auto',
    description: 'Alarmeert je eigen nieuwe inzetten (rood, nog niets onderweg) voor je, één voor één, terwijl jij iets anders doet. '
        + 'Meldt het spel bij een inzet in rood "Missende voertuigen", dan stuurt het precies die erbij. '
        + 'Per inzet leest het de eisen uit de spelgegevens, laat het spel zelf de dichtstbijzijnde voertuigen kiezen (net als een inzetvoorstel) '
        + 'en drukt op Alarmeren. Alleen als alles beschikbaar is en binnen de maximale afstand; anders slaat het de inzet over. '
        + 'Spraakaanvragen (patiënten en gevangenen) krijgen vanzelf het beste passende ziekenhuis of de beste cel. '
        + 'Gebruikt de missiefilters: inzetten die je verbergt (ook met Creditfilter) worden niet aangeraakt. '
        + 'Start en stop met de knop in de missiefilterbalk of in het menu. Na herladen gaat het in hetzelfde tabblad vanzelf verder.',
    tagline: 'Handmatig starten',
    warning: '<b>Dit speelt het spel voor je.</b> Het verstuurt echte voertuigen naar echte inzetten en kiest ziekenhuizen en cellen, '
        + 'zonder dat jij elke keer kijkt. Automatisch spelen kan tegen de spelregels van Meldkamerspel zijn; je account is je eigen risico. '
        + 'Inzetten met eisen die het script niet kent (bijv. opleidingen of uitrusting) worden overgeslagen. '
        + 'Het draait zolang dit tabblad open is, ook na herladen; in een tweede tabblad start het niet.',
    confirmOn: 'Let op: deze module alarmeert inzetten automatisch voor je, met echte voertuigen.\n\n'
        + 'Automatisch spelen kan tegen de spelregels zijn. Er gebeurt pas iets als je op Start klikt.\n\nAanzetten?',
    at: 'ready',
    frames: 'all',
    pages: /^\/(missions\/\d+\/?|vehicles\/\d+(\/(patient|gefangener)\/-?\d+)?\/?)?$/,
    pageNote: 'Op de kaartpagina (en onzichtbaar in het alarmeer- en voertuigvenster)',
    live: true,
    settings: [
        { key: 'maxKm', label: 'Maximale afstand', type: 'number', default: 25, min: 1, max: 500, step: 1, unit: 'km',
            help: 'Hemelsbreed. Is één van de gekozen voertuigen verder weg, dan wordt de inzet overgeslagen.' },
        { key: 'airKm', label: 'Maximale afstand helikopters', type: 'number', default: 100, min: 1, max: 500, step: 5, unit: 'km',
            help: 'Lifeliner, Politiehelikopter, SAR-heli en FBO-Heli vliegen en mogen van verder komen.' },
        { key: 'needAll', label: 'Alleen als alles beschikbaar is', type: 'bool', default: true,
            help: 'Uit: stuurt ook als het spel meldt dat er voertuigen tekort zijn (stuurt dan wat er wel is).' },
        { key: 'ownJobOnly', label: 'Niet als gewone voertuigen', type: 'text', default: 'TS-BO, TS-GO',
            help: 'Voertuigsoorten met komma\'s ertussen die alleen gaan als een inzet ze zelf vraagt, niet als gewone tankautospuit, '
                + 'slangenwagen of voor water. Bijvoorbeeld: TS-BO, TS-GO, TS-IB, TS-Spoor, DB-RI.' },
        { key: 'ignoreShort', label: 'Tekort negeren bij', type: 'text', default: 'Incidentenbestrijder',
            help: 'Namen met komma\'s ertussen, zoals het spel ze noemt ("te weinig: 1 Incidentenbestrijder"). '
                + 'Is alleen hiervan te weinig, dan gaat de rest toch. Telt nog wel mee in de tekortlijst.' },
        { key: 'topUp', label: 'Bijsturen bij rode melding', type: 'bool', default: true,
            help: 'Ook inzetten waar al voertuigen zijn, maar het spel "Missende voertuigen" meldt: stuurt alleen wat daar staat. '
                + 'Wacht tot er niets meer onderweg is, zodat er niets dubbel gaat.' },
        { key: 'patients', label: 'Patiënten: ambulance, MMT en OvD-G', type: 'bool', default: true,
            help: 'Leest per patiënt wat nodig is ("We benodigen: MMT-Arts, OvD-G"): een ambulance per patiënt, '
                + 'één MMT tegelijk (de volgende in een latere ronde als het nog nodig is) en hooguit één OvD-G per inzet. '
                + 'Ook bij inzetten waar al voertuigen staan.' },
        { key: 'ovdgFrom', label: 'OvD-G vanaf zoveel patiënten', type: 'number', default: 5, min: 0, max: 100, step: 1,
            help: 'Een nieuwe inzet met zoveel patiënten of meer krijgt een OvD-G mee, ook als de inzet er zelf niet om vraagt, '
                + 'als die vrij is en binnen de maximale afstand. '
                + 'Geen OvD-G vrij: de rest gaat toch. 0 = uit.' },
        { key: 'bigCredits', label: 'Grote inzet vanaf', type: 'number', default: 15000, min: 0, max: 100000, step: 500, unit: 'credits',
            help: 'Inzetten gaan altijd op volgorde van credits, hoogste eerst. Wordt een grote inzet overgeslagen omdat er iets te weinig is, '
                + 'dan houdt het zijn zeldzame voertuigen vast: kleinere inzetten krijgen die even niet. Alleen voor inzetten met minstens twee keer zoveel credits. 0 = niets vasthouden.' },
        { key: 'rareMax', label: 'Zeldzaam: hooguit zoveel vrij', type: 'number', default: 2, min: 0, max: 20, step: 1,
            help: 'Een voertuigsoort die de grote inzet nodig heeft en waarvan er zoveel of minder vrij zijn (of geen), wordt voor die inzet bewaard.' },
        { key: 'holdMin', label: 'Bewaren voor grote inzet', type: 'number', default: 20, min: 1, max: 120, step: 1, unit: 'min',
            help: 'Daarna mogen kleinere inzetten ze weer gebruiken, zodat niets voorgoed vastloopt. De grote inzet wordt ondertussen elke minuut opnieuw bekeken.' },
        { key: 'bigPatients', label: 'Grote inzet: meer dan zoveel patiënten', type: 'number', default: 30, min: 0, max: 500, step: 5,
            help: 'Daar mogen ambulances in delen: te weinig of te ver weg houdt de rest niet tegen. De patiënten vragen daarna zelf '
                + 'om de rest ("We benodigen: ambulance") en die gaan in de volgende rondes. 0 = uit.' },
        { key: 'onlyVisible', label: 'Alleen zichtbare inzetten', type: 'bool', default: true,
            help: 'Je eigen inzetten die je met de missiefilters verbergt, worden overgeslagen. Teaminzetten gaan ook als ze verborgen zijn.' },
        { key: 'teamMissions', label: 'Teaminzetten: 1 noodhulp', type: 'bool', default: false,
            help: 'Ook de gedeelde teaminzetten van anderen: daar gaat precies één noodhulp heen (de dichtstbijzijnde, hoe ver ook), '
                + 'alleen als je er nog niet aan meedoet. Verder niets: geen bijsturen, geen andere voertuigen. Loopt naast je eigen inzetten, '
                + 'in een eigen onzichtbaar venster; een auto die net naar de ene kant ging, wordt niet ook naar de andere gestuurd. '
                + 'Ook als ze verborgen zijn (Teamfilter op rood, missiefilters): je hoeft ze niet te zien.' },
        { key: 'pauseSec', label: 'Pauze tussen inzetten', type: 'number', default: 4, min: 1, max: 60, step: 1, unit: 'sec' },
        { key: 'scanSec', label: 'Lijst opnieuw bekijken', type: 'number', default: 20, min: 5, max: 300, step: 5, unit: 'sec' },
        { key: 'retryMin', label: 'Overgeslagen inzet opnieuw proberen na', type: 'number', default: 5, min: 1, max: 120, step: 1, unit: 'min' },
        { key: 'maxPerHour', label: 'Maximaal per uur', type: 'number', default: 100, min: 1, max: 1000, step: 1 },
        { key: 'transport', label: 'Spraakaanvragen afhandelen', type: 'bool', default: true,
            help: 'Patiënten naar het beste passende ziekenhuis, gevangenen naar de beste cel: goedkoopst, dan dichtstbij. '
                + 'Volle, te dure of te verre bestemmingen en ziekenhuizen zonder de juiste afdeling vallen af.' },
        { key: 'destCost', label: 'Maximale kosten bestemming (team)', type: 'select', default: '20',
            options: [['0', '0 %'], ['10', '10 %'], ['20', '20 %'], ['30', '30 %'], ['40', '40 %'], ['50', '50 % (alles)']] },
        { key: 'destKm', label: 'Maximale afstand bestemming', type: 'number', default: 0, min: 0, max: 500, step: 5, unit: 'km', help: '0 = geen grens.' },
        { key: 'ownKm', label: 'Voorrang eigen ziekenhuis', type: 'number', default: 5, min: 0, max: 100, step: 1, unit: 'km',
            help: 'Bij gelijke kosten wint je eigen ziekenhuis of cel, zolang die niet meer dan zoveel km verder is.' },
        { key: 'release', label: 'Vrijlaten als er geen bestemming is', type: 'bool', default: false,
            help: 'Geen passend ziekenhuis of cel: patiënt niet vervoeren of gevangenen vrijlaten, zodat het voertuig weer vrij is. '
                + 'Kost je de credits voor dat vervoer. Uit: de spraakaanvraag blijft staan en komt in de tekortlijst.' },
        { key: 'sendBack', label: 'Klaar op patiënten na: rest terug naar post', type: 'bool', default: false,
            help: 'Staat de voortgangsbalk van een inzet op 100% en wacht die alleen nog op patiëntenzorg (ambulance, OvD-G, MMT, Lifeliner), '
                + 'dan gaan je andere voertuigen daar (ter plaatse en onderweg) terug naar de post. Niet bij inzetten met arrestanten.' },
        { key: 'reloadMin', label: 'Pagina verversen elke', type: 'number', default: 120, min: 0, max: 1440, step: 10, unit: 'min',
            help: 'Een lang open spelpagina wordt traag en zwaar. Ververst tussen twee rondes door en gaat daarna vanzelf verder. 0 = nooit '
                + '(behalve als het geheugen bijna vol is).' },
    ],

    run(ctx) {
        const W = ctx.W;
        const WORKER = 'mks-auto-worker:';
        const MSG = 'mks-auto-dispatch';
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const missionId = (location.pathname.match(/^\/missions\/(\d+)/) || [])[1];

        // Requirement key (einsaetze.json) -> AAO slot, or vt:<vehicle type id> for
        // vehicles that only exist as a type. Checked against the help pages.
        const MAP = {
            firetrucks: 'fire', battalion_chief_vehicles: 'elw', elw3: 'elw3', mobile_command_vehicles: 'elw2',
            platform_trucks: 'dlk', heavy_rescue_vehicles: 'rw', water_tankers: 'gwl2wasser', mobile_air_vehicles: 'gwa',
            gwmess: 'gwmesstechnik', hazmat_vehicles: 'gwgefahrgut', spokesman: 'spokesman', foam: 'foam', arff: 'arff',
            elw_airport: 'elw_airport', brush_truck: 'brush_truck', search_and_rescue: 'search_and_rescue', boats: 'boot',
            diver_units: 'gw_taucher', water_rescue: 'gw_wasserrettung',
            police_cars: 'fustw', police_motorcycle: 'police_motorcycle', police_helicopters: 'polizeihubschrauber',
            ovdp: 'ovd_p', hondengeleider: 'hondengeleider', lebefkw: 'lebefkw', grukw: 'grukw', gefkw: 'gefkw',
            // police_horse counts horses: the game's police_horse_count field adds up the
            // horses per truck (its riders), the police_horse field would count trucks.
            bike_police: 'bike_police', police_horse: 'police_horse_count', military_police: 'military_police',
            bomb_disposal: 'bomb_disposal', bomb_disposal_robot: 'bomb_disposal_robot', traffic_patrol: 'traffic_patrol',
            traffic_unit: 'any_traffic_unit', car_carrier: 'car_carrier', car_carrier_large: 'car_carrier_large',
            coastal_boat: 'coastal_boat',
            at_c: 'at_c', at_o: 'at_o', at_m: 'at_m',
            industrial_response_engine: 'industrial_response_engine', industrial_response_fire_engine: 'industrial_response_fire_engine',
            hazard_response_material: 'hazard_response_material', hazard_response_suits: 'hazard_response_suits',
            hazard_response_disinfection: 'hazard_response_disinfection', hazard_response_disinfection_large: 'hazard_response_disinfection_large',
            railway_fire_engine: 'railway_fire_engine', railway_fire_equipment_container: 'railway_fire_equipment_container',
            railway_electric_response: 'railway_electric_response', thatched_firefighting: 'thatched_firefighting',
            livestock_hoist: 'livestock_hoist',
            water_needed: 'wasser_amount', foam_needed: 'foam_amount', min_pump_speed: 'water_damage_pump_value',
            ambulances: 'rtw',
            // "tankautospuiten of hulpverleningsvoertuigen" / "hulpverleningsvoertuigen of redvoertuigen"
            oneof_fire_engine_or_rescue: 'fire', oneof_fire_rescue_or_ladder: 'rw',
            mass_casualty: 'vt:101', mass_casualty_advanced: 'vt:100', traffic_inspector: 'vt:99',
            railway_elw: 'vt:145', railway_recovery: 'vt:146', wildfire_command: 'vt:87',
            // The VW-NB carries it: its checkbox has wildfire_equipment="1" (seen in a mission window).
            wildfire_equipment: 'wildfire_equipment',
            disaster_response: 'vt:90', disaster_response_equipment: 'vt:91', drone_police: 'vt:128',
            bomb_disposal_dogs: 'vt:116', bomb_disposal_patrol: 'vt:119', bomb_disposal_diver: 'vt:117', bomb_disposal_boat: 'vt:118',
            railway_material: 'vt:148',
            // Not a slot on the game's preset form (or the slot picks another vehicle,
            // like care_service = Verzorger): send the exact vehicle type.
            care_service_command: 'vt:124', coastal_guard_boat: 'vt:77', coastal_helicopter: 'vt:80', drone_fire: 'vt:129',
            wasserwerfer: 'vt:84', detention_unit: 'vt:64', fire_aviation: 'vt:85', search_and_rescue_engine: 'vt:93', search_and_rescue_equipment: 'vt:94', rescue_dog_units: 'vt:97',
            // Only named in the red box ("Verzorgingseenheid"), not a requirement key: the DB-VZ.
            care_service: 'care_service',
        };

        // Trained personnel -> the vehicle whose whole crew has that training, and
        // its minimum crew. "2x Verzorger" = 1 DB-VZ (2 to 4 Verzorgers on board).
        // Keyed by the name in "Missende personeel" and by the einsaetze.json key.
        const PERSONNEL = [
            { names: ['verzorger', 'care_service'], to: 'care_service', crew: 2 },
            { names: ['hygiënemedewerker', 'clean_service'], to: 'vt:122', crew: 2 },
            { names: ['handcrew', 'wildfire'], to: 'vt:86', crew: 7 },
            { names: ['gevaarlijke stoffen eenheid', 'hazard_material_response'], to: 'vt:135', crew: 4 },
            { names: ['ontsmettings eenheid', 'hazard_suits_response'], to: 'vt:140', crew: 6 },
            { names: ['teamlid usar', 'search_and_rescue'], to: 'search_and_rescue', crew: 5 },
        ];
        const personnelFor = (name) => PERSONNEL.find((p) => p.names.includes(String(name).toLowerCase().trim()));
        const VT_CAPTION = { 64: 'ME Aanhoudingseenheid', 77: 'KW-boot', 80: 'SAR-heli', 84: 'Waterwerper', 85: 'FBO-Heli', 124: 'DB-PC-LOG', 129: 'DB-TDV', 87: 'DA-LA-NB', 90: 'TS-STH', 91: 'HVH-STH', 93: 'TS-USAR', 94: 'VW-USAR', 97: 'DB–Speurhonden', 99: 'DB-VOA',
            100: 'GGB', 101: 'NHT', 116: 'DB-Explosievenhonden', 117: 'DB-Explosievenduikers', 118: 'BA-DDG', 119: 'DB-TEV', 128: 'DB-DRONE',
            145: 'OvD-ICB', 146: 'VW-VZ-ICB', 148: 'GM-ICB', 86: 'DB-Handcrew', 122: 'DB-AH', 135: 'DB-GS', 140: 'DB-BO' };

        // Names the game uses in "Benodigde X" and in the red "Missende voertuigen"
        // box -> requirement key. Solved from 229 help pages against /einsaetze.json.
        const LABELS = {
            'tankautospuiten': 'firetrucks', 'slangenwagens': 'water_tankers', 'redvoertuigen': 'platform_trucks',
            "ovd-b's": 'battalion_chief_vehicles', 'water': 'water_needed', 'tankautospuiten (terreinvaardig)': 'brush_truck',
            'hulpverleningsvoertuigen': 'heavy_rescue_vehicles', 'signalisatie voertuigen': 'traffic_unit', 'noodhulpeenheden': 'police_cars',
            'schuimblusvoertuig': 'foam', 'svm': 'foam_needed', "hovd's": 'mobile_command_vehicles', 'biketeams': 'bike_police',
            'adviseurs gevaarlijke stoffen': 'hazmat_vehicles', 'me flexbussen': 'grukw', 'ambulances': 'ambulances', 'dm-p': 'police_motorcycle',
            'tankautospuiten of hulpverleningsvoertuigen': 'oneof_fire_engine_or_rescue', 'voorlichters': 'spokesman', 'da-la-nb': 'wildfire_command',
            'fbo-heli': 'fire_aviation', 'commandowagen': 'elw3', 'adembeschermingsvoertuigen': 'mobile_air_vehicles',
            'waterongevallenvoertuigen / oppervlaktereddingsteams': 'diver_units', 'min. pomp capaciteit': 'min_pump_speed',
            'officiers van dienst politie': 'ovdp', 'officieren van dienst - politie': 'ovdp', 'officieren van dienst politie': 'ovdp', 'natuurbrandbestrijding uitrusting': 'wildfire_equipment', 'natuurbrandbestrijding vrachtwagen of haakarmbak': 'wildfire_equipment', 'me commandovoertuigen': 'lebefkw',
            'crashtender': 'arff', 'afo/osc': 'elw_airport', 'bootaanhanger (woa of ba-rb)': 'boats', 'verkenningseenheden': 'gwmess',
            'hondengeleider': 'hondengeleider', 'aanhoudingseenheden': 'detention_unit', 'siv-p of dm-p': 'traffic_patrol', 'db-voa': 'traffic_inspector',
            'at operators': 'at_o', 'at commandanten': 'at_c', 'at materiaalwagens': 'at_m',
            'strandvoertuigen (quad, dat-rb of khv)': 'water_rescue', 'bereden brigade (paarden)': 'police_horse',
            'waterwerper': 'wasserwerfer', 'db-av': 'gefkw', 'rb-k of rb-g': 'coastal_boat', 'sar-heli(s)': 'coastal_helicopter', 'kw-boot': 'coastal_guard_boat',
            'politie helikopters': 'police_helicopters', 'nht': 'mass_casualty', 'ggb': 'mass_casualty_advanced', 'berger-k': 'car_carrier',
            'hulpverleningsvoertuigen of redvoertuigen': 'oneof_fire_rescue_or_ladder', 'kmar eenheid': 'military_police', 'db-tev': 'bomb_disposal_patrol',
            'db-icb of ts-spoor': 'railway_fire_engine', 'ovd-icb': 'railway_elw', 'ts-sth': 'disaster_response', 'hvh-sth': 'disaster_response_equipment',
            'berger-g': 'car_carrier_large', 'db-drone': 'drone_police', 'db-ri of ria': 'thatched_firefighting', 'sb-ba, sb-ib of as': 'industrial_response_engine',
            'db-tdv': 'drone_fire', 'gph, db-gp of rc-gaspakken': 'hazard_response_suits', 'db-bo, ts-bo of boh-dc': 'hazard_response_disinfection',
            'gsh, db-gs of rc-gevaarlijke stoffen': 'hazard_response_material', 'db-vi of via': 'livestock_hoist', 'db-pc-log': 'care_service_command',
            'dienstvoertuigen usar': 'search_and_rescue', 'db–speurhonden': 'rescue_dog_units', 'vw-usar': 'search_and_rescue_equipment',
            'ts-ib': 'industrial_response_fire_engine', 'db-go, ts-go of goh-dc': 'hazard_response_disinfection_large',
            'db-explosievenhonden': 'bomb_disposal_dogs', 'vw-vz-icb': 'railway_recovery', 'bm-vths of bu-vths': 'railway_electric_response',
            'gm-icb': 'railway_material', 'ts-usar': 'search_and_rescue_engine', 'hsh-icb of vw-hs': 'railway_fire_equipment_container',
            'eod eenheid': 'bomb_disposal', 'rc-explosievenrobot': 'bomb_disposal_robot', 'db-explosievenduikers': 'bomb_disposal_diver', 'ba-ddg': 'bomb_disposal_boat',
            // Seen only in the red box.
            'verzorgingseenheden': 'care_service', 'officier van dienst brandweer': 'battalion_chief_vehicles',
            'hoofd officier van dienst': 'mobile_command_vehicles', 'ab': 'mobile_air_vehicles',
            'slangenwagen, watertankwagen of gelijkwaardige haakarmbak': 'water_tankers',
        };
        // Every vehicle type by its full name, for red boxes that name the type
        // itself ("Officier van Dienst - Politie", "Dienstbus Arrestantenvervoer").
        // Last resort after LABELS: those cover more vehicles per name.
        const VT_NAMES = {
            "SI-2": 0, "TS 8/9": 1, "Autoladder": 2, "DA - Officier van Dienst": 3, "Hulpverleningsvoertuig": 4,
            "Adembeschermingsvoertuig": 5, "TST 8/9": 6, "TST 6/7": 7, "TST 4/5": 8, "TS 4/5": 9, "Slangenwagen": 10,
            "Verkenningseenheid Brandweer": 11, "TST-NB 8/9": 12, "TST-NB 6/7": 14, "TST-NB 4/5": 15, "Ambulance": 16,
            "TS 6/7": 17, "Hoogwerker": 18, "DA - Hoofdofficier van Dienst": 19, "DA": 20, "DB Klein": 21, "DA Noodhulp": 22,
            "Lifeliner": 23, "DA - Adviseur Gevaarlijke stoffen": 24, "DB Noodhulp": 25, "Haakarmvoertuig": 26,
            "Adembeschermingshaakarmbak": 27, "Politiehelikopter": 28, "Watertankhaakarmbak": 29, "Zorgambulance": 30,
            "Commandovoertuig": 31, "Commandohaakarmbak": 32, "Waterongevallenvoertuig": 33, "Watertankwagen": 34,
            "Officier van Dienst - Politie": 35, "Waterongevallenaanhanger": 36, "MMT-Auto": 37,
            "Officier van Dienst - Geneeskunde": 38, "ME Commandovoertuig": 39, "ME Flexbus": 40, "Crashtender (8x8)": 41,
            "Crashtender (6x6)": 42, "Crashtender (4x4)": 43, "Airport Fire Officer / On Scene Commander": 44,
            "Dompelpomphaakarmbak": 45, "DM-Politie": 46, "DA Hondengeleider": 47, "DB Hondengeleider": 48, "PM-OR": 49,
            "Materieelvoertuig - Oppervlakteredding": 49, "TS-OR": 50, "Tankautospuit - Oppervlakteredding": 50,
            "HulpverleningsHaakarmbak": 51, "Rapid Responder": 52, "AT-Commandant": 53, "AT-Operator": 54, "AT-Materiaalwagen": 55,
            "DA Voorlichter": 56, "DA Officier van Dienst - Geneeskundig / Rapid Responder": 57, "DB Arrestantenvervoer": 58,
            "Noodhulp - Onopvallend": 59, "DB Biketeam": 60, "Slangenhaakarmbak": 61, "TS-HV": 62,
            "Tankautospuit-Hulpverlening": 62, "DM - Rapid Responder": 63, "ME Aanhoudingseenheid": 64,
            "DA Terreinwaardig - Reddingsbrigade": 65, "Kusthulpverleningsvoertuig": 66, "Bootaanhanger Reddingsbrigade": 67,
            "SB": 68, "SBH": 69, "SBA": 70, "MSA": 71, "DPA": 72, "Vrachtwagen - Bereden Brigade": 73,
            "Bereden Brigade Aanhanger": 74, "Dienstauto terreinvaardig - Noodhulp": 75, "Quad": 76, "KW-boot": 77, "RB-K": 78,
            "RB-G": 79, "SAR-heli": 80, "DA-RWS": 81, "Dienstvoertuig weginspecteur Rijkswaterstaat": 81, "DM-RWS": 82,
            "Dienstmotor weginspecteur Rijkswaterstaat": 82, "DA-SIG": 83, "Signalisatievoertuig": 83, "Waterwerper": 84,
            "FBO-Heli": 85, "DB-Handcrew": 86, "DA-LA-NB": 87, "VW-NB": 88, "NBH": 89, "TS-STH": 90, "HVH-STH": 91, "DB-USAR": 92,
            "TS-USAR": 93, "VW-USAR": 94, "DM-USAR": 95, "Quad-USAR": 96, "DB–Speurhonden": 97, "SIV-P": 98, "DB-VOA": 99,
            "GGB": 100, "NHT": 101, "MC-Ambulance": 102, "MICU": 103, "Berger-K": 104, "Berger-G": 105, "Berger-K (RWS)": 106,
            "Berger-G (RWS)": 107, "Berger-K (Politie)": 108, "Berger-G (Politie)": 109, "DAT-KMAR": 110, "DB-KMAR": 111,
            "DM-KMAR": 112, "DAT-EOD": 113, "DB-EOD": 114, "VW-EOD": 115, "DB-Explosievenhonden": 116,
            "DB-Explosievenduikers": 117, "BA-DDG": 118, "DB-TEV": 119, "DB-VZ": 120, "VZH": 121, "DB-AH": 122, "VZH-AH": 123,
            "DB-PC-LOG": 124, "DB-LOG": 125, "VW-LOG": 126, "BMH-LOG": 127, "DB-DRONE": 128, "DB-TDV": 129, "SB-BA": 130,
            "SB-IB": 131, "AS": 132, "TS-IB": 133, "GSH": 134, "DB-GS": 135, "GPH": 136, "DB-GP": 137, "BOH-DC": 138, "TS-BO": 139,
            "DB-BO": 140, "GOH-DC": 141, "TS-GO": 142, "DB-GO": 143, "DB-ICB": 144, "OvD-ICB": 145, "VW-VZ-ICB": 146,
            "HA-ICB": 147, "GM-ICB": 148, "HSH-ICB": 149, "VW-HS": 150, "BM-VTHS": 151, "TS-Spoor": 152, "DB-RI": 153, "RIA": 154,
            "DB-VI": 155, "VIA": 156
        };

        // Lower case, no " - ", and the long words the game abbreviates in type names.
        const normName = (s) => String(s).toLowerCase().replace(/\s+[-–]\s+/g, ' ').replace(/\s+/g, ' ').trim()
            .replace(/^dienstbus\b/, 'db').replace(/^dienstauto\b/, 'da').replace(/^dienstmotor\b/, 'dm');
        const VT_BY_NAME = new Map(Object.entries(VT_NAMES).map(([n, id]) => [normName(n), id]));

        // Singular and plural of the same Dutch name, word by word: "Noodhulpeenheid" /
        // "noodhulpeenheden", "ME Flexbus" / "me flexbussen", "Slangenwagen" / "slangenwagens",
        // "Officier van Dienst Politie" / "officiers van dienst politie".
        const pluralsOf = (w) => [w, `${w}s`, `${w}en`, `${w}'s`, `${w}’s`, `${w}${w.slice(-1)}en`, w.replace(/heid$/, 'heden')];
        const sameWord = (a, b) => pluralsOf(a).includes(b) || pluralsOf(b).includes(a);
        function sameName(x, y) {
            const a = x.split(' '), b = y.split(' ');
            return a.length === b.length && a.every((w, i) => sameWord(w, b[i]));
        }

        // One name from the red box -> requirement key. Tries the exact name, a name
        // with extra words after it ("Berger-K om het slepen te beginnen"),
        // singular/plural, a vehicle type by its full name, and finally a vehicle
        // type caption from the page.
        function keyForName(name, typeIds) {
            const n = normName(name.replace(/\.$/, ''));
            if (LABELS[n]) return LABELS[n];
            const prefix = Object.keys(LABELS).filter((l) => n.startsWith(`${l} `)).sort((a, b) => b.length - a.length)[0];
            if (prefix) return LABELS[prefix];
            const loose = Object.keys(LABELS).find((l) => sameName(n, l));
            if (loose) return LABELS[loose];
            if (VT_BY_NAME.has(n)) return `vt:${VT_BY_NAME.get(n)}`;
            if (typeIds && typeIds[n]) return `vt:${typeIds[n]}`;
            return null;
        }

        // "Arrestanten moeten vervoerd worden." has no count. When a police car on scene
        // can take them, the mission window lists cells under that car and the worker
        // picks one (prisonerCell). Only when no car there can: one more Noodhulp each
        // round, and if the box is still red the next round sends another.
        const PRISONERS = /,?\s*arrestanten moeten (?:worden )?vervoerd(?: worden)?\.?/i;
        const addPrisonerCar = (plan) => { plan.slots.fustw = Math.max(plan.slots.fustw || 0, 1); };

        // Text of the red box -> { slots, vt, vtCaptions, unknown }.
        // "Missende voertuigen: 1 DB-PC-LOG, 2 SB-BA, SB-IB of AS, 2.000 Water"
        // Items start with a number; names can contain commas themselves.
        function fromMissing(text, typeIds) {
            const out = { slots: {}, vt: {}, vtCaptions: {}, unknown: [] };
            let body = String(text).replace(/\s+/g, ' ');
            if (PRISONERS.test(body)) { body = body.replace(PRISONERS, ''); addPrisonerCar(out); }
            body = body.replace(/^[^:]*:\s*/, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
            for (const item of body.split(/,\s*(?=[\d.]+\s)/)) {
                const m = item.trim().match(/^([\d.]+)\s+(.+?)\.?$/);
                if (!m) { if (item.trim()) out.unknown.push(item.trim()); continue; }
                const count = Number(m[1].replace(/\./g, ''));
                const key = keyForName(m[2], typeIds);
                const to = key && (key.startsWith('vt:') ? key : MAP[key]);
                if (!to) { out.unknown.push(m[2].trim()); continue; }
                if (to.startsWith('vt:')) {
                    const id = to.slice(3);
                    out.vt[id] = (out.vt[id] || 0) + count;
                    out.vtCaptions[id] = VT_CAPTION[id] || m[2].trim();
                } else out.slots[to] = (out.slots[to] || 0) + count;
            }
            return out;
        }

        // "Missende personeel: 2x Verzorger, 7x Handcrew" -> [[name, count]].
        const personnelItems = (text) => [...String(text).replace(/\s+/g, ' ').replace(/^[^:]*:\s*/, '')
            .matchAll(/(\d+)\s*x\s*([^,]+)/gi)].map((m) => [m[2].trim().replace(/\.$/, ''), Number(m[1])]);

        // Trained personnel -> vehicles, merged into a plan with max, not sum: a
        // DB-VZ the red box already asks for brings its Verzorgers along.
        function addPersonnel(plan, items, label = (n) => `Personeel: ${n}`) {
            for (const [name, n] of items) {
                const p = personnelFor(name);
                if (!p) { plan.unknown.push(label(name, n)); continue; }
                const need = Math.ceil(n / p.crew);
                if (p.to.startsWith('vt:')) {
                    const id = p.to.slice(3);
                    plan.vt[id] = Math.max(plan.vt[id] || 0, need);
                    plan.vtCaptions[id] = VT_CAPTION[id] || name;
                } else plan.slots[p.to] = Math.max(plan.slots[p.to] || 0, need);
            }
        }

        // Patient needs: "We benodigen: MMT-Arts, OvD-G" per patient (mission list)
        // or "5x We benodigen: OvD-G" for five patients (mission window).
        // One OvD-G leads all patients; MMT and ambulance are one per patient.
        const PATIENT_NEED = { 'ovd-g': 'ovdg', 'mmt-arts': 'mmt', 'mmt': 'mmt', 'ambulance': 'amb', 'ambulances': 'amb' };
        function patientNeeds(text) {
            const out = { ovdg: false, mmt: 0, amb: 0, unknown: [] };
            const re = /(?:(\d+)\s*x\s*)?We benodigen:\s*(.+?)(?=(?:\d+\s*x\s*)?We benodigen:|$)/gi;
            for (const m of String(text).replace(/\s+/g, ' ').matchAll(re)) {
                const n = Number(m[1] || 1);
                for (const raw of m[2].split(',')) {
                    const name = raw.trim().replace(/\.$/, '');
                    if (!name) continue;
                    const k = PATIENT_NEED[name.toLowerCase()];
                    if (k === 'ovdg') out.ovdg = true;
                    else if (k) out[k] += n;
                    else if (!out.unknown.includes(name)) out.unknown.push(name);
                }
            }
            return out;
        }

        const vehicleId = (location.pathname.match(/^\/vehicles\/(\d+)/) || [])[1];
        if (missionId || vehicleId) {
            // Inside a mission or vehicle window: only act in our own hidden iframe.
            if (window.top === window.self || !window.name.startsWith(WORKER)) return { stop() {} };
            if (missionId) worker();
            else if (/^\/vehicles\/\d+\/?$/.test(location.pathname)) transportWorker();
            return { stop() {} };
        }
        if (window.top !== window.self) return { stop() {} };
        return controller();

        /* ========================================================================
         * TRANSPORT WORKER — hidden iframe on /vehicles/:id for a vehicle in
         * status 5. Same choice as the Bestemmingfilter module: drop full,
         * too expensive, too far and wrong-department destinations, then
         * cheapest first, then nearest (own buildings get ownKm head start).
         * Clicking the button is the game's own GET to /patient/:id or
         * /gefangener/:id.
         * ==================================================================== */
        async function transportWorker() {
            let job;
            try { job = JSON.parse(window.name.slice(WORKER.length)); } catch (e) { return; }
            const report = (result, detail = {}) => window.parent.postMessage({ [MSG]: true, id: job.id, result, ...detail }, location.origin);
            const doneKey = `mks-auto-sent-v${job.id}-${job.token}`;
            if (job.kind !== 'transport' || String(job.id) !== vehicleId) return;
            try { if (sessionStorage.getItem(doneKey)) return; } catch (e) { /* ignore */ }
            const go = (a, detail) => {
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', detail);
                a.click();
            };

            try {
                if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
                await sleep(300);
                // A request page has the "Spraakaanvraag" heading or destination buttons
                // (cells may come without that heading). Neither: already answered.
                const asking = document.getElementById('h2_sprechwunsch')
                    || document.querySelector('a[href*="/patient/"], a[href*="/gefangener/"]');
                if (!asking) {
                    const h = [...document.querySelectorAll('h1, h2, h3')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3).join(' | ');
                    report('skip', { reason: `geen spraakaanvraag op de voertuigpagina (${h || 'geen kopjes'})`, gone: true });
                    return;
                }

                const all = destinations();
                const { best, why } = bestDestination(all, job);
                if (best) {
                    go(best.a, { mode: best.kind, dest: best.name, km: best.dist, cost: best.cost });
                    return;
                }

                // Nothing fits. Kind from the page when there are no candidates at all.
                // "...met een specialisatie vervoerd worden: Cardiologie" names the department.
                const kind = all[0]?.kind || (document.querySelector('a[href*="/gefangener/"]') ? 'cell' : 'hospital');
                const dep = ((document.querySelector('.alert')?.textContent || '').replace(/\s+/g, ' ').match(/worden:\s*([^.]+)/) || [])[1];
                const need = kind === 'cell'
                    ? (why.vol ? 'Cellen (alles vol)' : 'Cel binnen kosten/afstand')
                    : why['geen afdeling'] && !why.vol ? `Ziekenhuis met afdeling ${dep ? dep.trim() : '(onbekend)'}`
                        : why.vol ? 'Ziekenhuisbedden (alles vol)' : 'Ziekenhuis binnen kosten/afstand';
                const reasons = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ') || 'geen bestemmingen';
                const release = document.querySelector(`a[href$="/${kind === 'cell' ? 'gefangener' : 'patient'}/-1"]`);
                if (job.release && release) {
                    go(release, { mode: 'release', dest: kind === 'cell' ? 'gevangenen vrijgelaten' : 'patiënt niet vervoerd', unknownNeeds: [need] });
                    return;
                }
                // No candidates at all: keep what the page showed, to find out why from the log.
                const page = all.length ? undefined : {
                    alert: (document.querySelector('.alert')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                    links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /patient|gefangene|transport/i.test(h)).slice(0, 8),
                    buttons: [...document.querySelectorAll('#h2_sprechwunsch ~ * a.btn, .btn-group a.btn')].map((a) => a.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 8),
                };
                report('skip', { reason: `geen passende ${kind === 'cell' ? 'cel' : 'ziekenhuis'} (${reasons})`, unknownNeeds: [need], page });
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        // Drop what does not fit, then: enough room for everyone in the car first
        // (orange cell buttons have fewer free cells than prisoners on board),
        // cheapest, nearest (own buildings get ownKm head start).
        function bestDestination(all, job) {
            const why = {};
            const fit = all.filter((c) => {
                const r = destReason(c, job);
                if (r) why[r] = (why[r] || 0) + 1;
                return !r;
            });
            const rank = (c) => (isNaN(c.dist) ? 1e9 : c.dist) - (c.own ? job.ownKm : 0);
            const short = (c) => (c.a.classList.contains('btn-warning') ? 1 : 0);
            const best = fit.sort((x, y) => short(x) - short(y) || x.cost - y.cost || rank(x) - rank(y))[0];
            return { best, why };
        }

        // Destination rows, as the Bestemmingfilter module reads them. root: the
        // whole page, or one car's cell list in a mission window.
        function destinations(root = document) {
            const num = (s) => {
                const m = String(s).replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
                return m ? parseFloat(m[0].replace(',', '.')) : NaN;
            };
            const txt = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent.trim() : '');
            const isRed = (el) => !!el && (el.classList.contains('btn-danger') || el.classList.contains('danger') || el.classList.contains('label-danger'));
            const DEST = 'a[href*="/patient/"]:not([href$="/-1"]), a[href*="/gefangener/"]:not([href$="/-1"])';
            const out = [];
            const seen = new Set();
            for (const table of root.querySelectorAll('table')) {
                const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
                const iDist = heads.findIndex((h) => h.startsWith('afstand'));
                if (iDist < 0) continue;
                const iFree = heads.findIndex((h) => h.startsWith('vrij'));
                const iCost = heads.findIndex((h) => h.startsWith('kosten') || h.startsWith('belasting'));
                const iDep = heads.findIndex((h) => h.startsWith('afdeling'));
                for (const tr of table.querySelectorAll('tbody > tr')) {
                    const a = tr.querySelector(DEST);
                    if (!a) continue;
                    seen.add(a);
                    const kind = /\/gefangener\//.test(a.getAttribute('href')) ? 'cell' : 'hospital';
                    const free = iFree >= 0 ? num(txt(tr, iFree).split('/')[0]) : Infinity;
                    const red = isRed(a) || isRed(tr) || (iFree >= 0 && isRed(tr.cells[iFree] && tr.cells[iFree].querySelector('.label')));
                    out.push({
                        // The name cell also holds distance and bed badges: keep the part before them.
                        a, kind, own: table.id === 'own-hospitals', name: txt(tr, 0).replace(/\s+/g, ' ').split(/\s\d+(?:,\d+)?\s*km\b/)[0],
                        dist: num(txt(tr, iDist)),
                        free: red ? 0 : (isNaN(free) ? Infinity : free),
                        cost: iCost >= 0 ? num(txt(tr, iCost)) || 0 : 0,
                        dep: kind === 'cell' || iDep < 0 || !!(tr.cells[iDep] && tr.cells[iDep].querySelector('.label-success')),
                    });
                }
            }
            // Cells can also be loose buttons with distance, free cells and cost in the text.
            for (const a of root.querySelectorAll('a[href*="/gefangener/"]:not([href$="/-1"])')) {
                if (seen.has(a)) continue;
                const t = a.textContent.replace(/\s+/g, ' ');
                const km = t.match(/(\d+(?:[.,]\d+)?)\s*km/);
                const pct = t.match(/(\d+)\s*%/);
                const freeTxt = t.match(/vrij\w*\s*(?:cel\w*)?\s*:?\s*(\d+)/i);
                out.push({
                    // "Politiebureau Leusden (BT 33) (Vrije cellen: 0, afstand: 0,26 km)"; team cells
                    // have no space before the bracket and end with "Afdrachtpercentage: 0%".
                    a, kind: 'cell', own: !pct, name: t.split(/\s*\(vrij/i)[0].trim().slice(0, 60),
                    dist: km ? parseFloat(km[1].replace(',', '.')) : NaN,
                    free: isRed(a) ? 0 : (freeTxt ? Number(freeTxt[1]) : Infinity),
                    cost: pct ? Number(pct[1]) : 0,
                    dep: true,
                });
            }
            return out;
        }

        function destReason(c, job) {
            if (c.a.classList.contains('disabled')) return 'niet beschikbaar';
            if (c.free <= 0) return 'vol';
            if (c.kind === 'hospital' && !c.dep) return 'geen afdeling';
            if (c.cost > job.destCost) return 'te duur';
            if (job.destKm > 0 && c.dist > job.destKm) return 'te ver';
            return '';
        }

        /* ========================================================================
         * WORKER — runs in the hidden iframe on /missions/:id. The controller
         * puts the job in window.name. Selection is the game's own AAO code
         * (aaoClickHandler) on a hidden preset element, so nearest vehicles,
         * trailers, "X of Y" groups and ignore_aao work exactly as in the game.
         * ==================================================================== */
        async function worker() {
            let job;
            try { job = JSON.parse(window.name.slice(WORKER.length)); } catch (e) { return; }
            const report = (result, detail = {}) => window.parent.postMessage({ [MSG]: true, id: job.id, result, ...detail }, location.origin);
            // window.name survives the post after Alarmeren: never act twice on one job.
            const doneKey = `mks-auto-sent-${job.id}-${job.token}`;
            if (job.kind === 'transport' || String(job.id) !== missionId) return;
            try { if (sessionStorage.getItem(doneKey)) return; } catch (e) { /* ignore */ }

            try {
                // The game finishes its vehicle table (distances, AAO data) on load.
                if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
                await sleep(300);
                // A team mission first checks whether we are in already (nothing to load then).
                if (job.team) { await teamWorker(job, report, doneKey); return; }
                await loadMissing(); // all vehicles, not only the nearest listed
                dropAvoided(job.avoid);


                // The red "Missende voertuigen" box is what the mission still needs
                // now. It only counts vehicles that have arrived, so wait while
                // anything is still driving there.
                // "Shown" is the box's own display, not offsetParent: in our hidden
                // frame layout-based checks are not reliable.
                const shown = (el) => !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
                const box = document.getElementById('missing_text');
                const missingText = shown(box) ? box.textContent.replace(/\s+/g, ' ').trim() : '';
                const driving = !!document.querySelector('#mission_vehicle_driving tbody tr');
                const present = !!document.querySelector('#mission_vehicle_at_mission tbody tr');
                // What the patients still need ("5x We benodigen: OvD-G"): the box in
                // this window, or the per-patient lines the controller read in the list.
                const pBox = document.getElementById('patient_missing_requirements');
                const pText = !job.patients ? ''
                    : (shown(pBox) && pBox.textContent.replace(/\s+/g, ' ').trim()) || job.patientText || '';
                const pNeed = patientNeeds(pText);
                const mode = missingText ? 'missing' : present && pText ? 'patients' : 'full';
                // Arrestants on a car on scene: that car needs a cell, not another car
                // sent. Does not wait for vehicles still driving.
                const prisonerCars = [...document.querySelectorAll('.prison-select')].filter((b) => b.querySelector('a[href*="/gefangener/"]'));
                if (prisonerCars.length) { prisonerCell(job, prisonerCars[0], report, doneKey); return; }
                if (driving) { report('wait', { reason: 'wacht: voertuigen onderweg' }); return; }
                if (mode === 'full' && present) { report('skip', { reason: 'al voertuigen ter plaatse, geen rode melding' }); return; }
                if (mode !== 'full' && !job.topUp) { report('skip', { reason: 'rode melding, bijsturen staat uit' }); return; }
                if (pNeed.unknown.length) {
                    report('skip', { reason: `patiënten, kan niet sturen: ${pNeed.unknown.join(', ')}`, unknownNeeds: pNeed.unknown.map((u) => `Patiënt: ${u}`) });
                    return;
                }
                await loadAllVehicles();
                dropAvoided(job.avoid); // loadAllVehicles can add rows again

                let plan = mode === 'patients' ? { slots: {}, vt: {}, vtCaptions: {} }
                    : { slots: job.slots || {}, vt: job.vt || {}, vtCaptions: job.vtCaptions || {} };
                if (mode === 'missing') {
                    // Vehicle type captions in this window, for names that are a type ("DB-PC-LOG").
                    const typeIds = {};
                    document.querySelectorAll('input.vehicle_checkbox[vehicle_type_id]').forEach((c) => {
                        const cap = c.closest('tr')?.getAttribute('vehicle_type');
                        if (cap) typeIds[cap.toLowerCase()] = c.getAttribute('vehicle_type_id');
                    });
                    // Only the vehicles part: personnel or other lines are unknown, not ignored.
                    const parts = [...box.querySelectorAll('[data-requirement-type]')];
                    const vehText = parts.length ? parts.filter((p) => p.getAttribute('data-requirement-type') === 'vehicles').map((p) => p.textContent).join(', ') : missingText;
                    plan = fromMissing(vehText, typeIds);
                    // "Missende personeel: 2x Verzorger" becomes vehicles with that crew;
                    // any other kind of line is unknown, not ignored.
                    parts.filter((p) => p.getAttribute('data-requirement-type') !== 'vehicles').forEach((p) => {
                        const t = p.textContent.replace(/\s+/g, ' ').trim();
                        // "We missen: 34000 L. water"
                        const amount = t.match(/([\d.]+)\s*l\.?\s*(water|svm|schuim)/i);
                        if (PRISONERS.test(t)) addPrisonerCar(plan);
                        else if (/person/i.test(p.getAttribute('data-requirement-type')) || /^missende? personeel/i.test(t)) addPersonnel(plan, personnelItems(t));
                        else if (amount) {
                            const k = /water/i.test(amount[2]) ? 'wasser_amount' : 'foam_amount';
                            plan.slots[k] = (plan.slots[k] || 0) + Number(amount[1].replace(/\./g, ''));
                        } else plan.unknown.push(t);
                    });
                    if (plan.unknown.length) {
                        report('skip', { reason: `rode melding, kan niet sturen: ${plan.unknown.join(', ')}`, unknownNeeds: plan.unknown });
                        return;
                    }
                }

                const attrs = { ...plan.slots };
                if (job.patients) {
                    const m = (document.getElementById('patient_button_text')?.textContent || '').match(/(\d+)\s+onbehandelde/i);
                    const untreated = m ? Number(m[1]) : 0;
                    // A new mission: one ambulance per untreated patient (the patient lines
                    // do not always say "ambulance"). With vehicles there, only what the
                    // lines ask for: "1x We benodigen: OvD-G, ambulance" with 7 untreated = 1.
                    const amb = Math.max(Number(attrs.rtw) || 0, pNeed.amb, mode === 'full' ? untreated : 0);
                    if (amb) attrs.rtw = amb;
                    // Only a real OvD-G (kdow_orgl) counts for patients: with kdow_orgl_any a
                    // DA OVDG-RR went and the patients kept asking. MMT-Auto and Lifeliner are "nef".
                    // Never more than one OvD-G per mission.
                    if (pNeed.ovdg) attrs.kdow_orgl = 1;
                    // "8x We benodigen: MMT-Arts" does not mean 8 helicopters: send one, and
                    // another in a later round while the patients still ask for it.
                    if (pNeed.mmt) attrs.nef = Math.max(Number(attrs.nef) || 0, 1);
                }
                // Many patients on a new mission: an OvD-G along if one is free and near
                // enough (ovdgFrom or more patients), asked for or not. Optional: without one the rest still goes.
                const patientCount = Number(((document.getElementById('patient_button_text')?.textContent || '').match(/(\d+)\s+Pati/i) || [])[1] || 0);
                const optOvdg = job.patients && mode === 'full' && job.ovdgFrom > 0 && patientCount >= job.ovdgFrom && !attrs.kdow_orgl;
                if (!Object.keys(attrs).length && !Object.keys(plan.vt).length) { report('skip', { reason: 'niets te sturen' }); return; }

                // Vehicles held for a bigger mission that is waiting (key: slot or vt:<id>).
                const AMOUNT_KEYS = ['wasser_amount', 'foam_amount', 'water_damage_pump_value'];
                const needKeys = [...Object.keys(attrs).filter((k) => !AMOUNT_KEYS.includes(k)), ...Object.keys(plan.vt).map((id) => `vt:${id}`)];
                const caption = (k) => (k.startsWith('vt:') ? plan.vtCaptions[k.slice(3)] || k
                    : untranslated(((W.aao_types || []).find((t) => t[0] === k) || [])[1] || k));
                // How many of each needed kind are free right now, and how many this
                // mission wants. A (big) mission that has to wait reports these so the
                // controller can hold the rare ones for it.
                const avail = {};
                const caps = Object.fromEntries(needKeys.map((k) => [k, caption(k)]));
                const want = Object.fromEntries(needKeys.map((k) => [k, Number(k.startsWith('vt:') ? plan.vt[k.slice(3)] : attrs[k]) || 0]));
                for (const k of needKeys) {
                    // Most fields are "1", some carry a number (police_horse_count = horses on board).
                    const sel = k.startsWith('vt:') ? `input.vehicle_checkbox[vehicle_type_id="${k.slice(3)}"]`
                        : `input.vehicle_checkbox[${CSS.escape(k)}]:not([${CSS.escape(k)}="0"])`;
                    const boxes = new Map([...document.querySelectorAll(sel)].map((c) => [c.value, c]));
                    // Horses: the sum over the trucks (one per rider), not the number of trucks.
                    avail[k] = k === 'police_horse_count' ? [...boxes.values()].reduce((s, c) => s + (Number(c.getAttribute(k)) || 0), 0) : boxes.size;
                }
                // Held for a bigger mission: only if taking ours would leave too few for it.
                // Big needs 1 OvD-P and 2 are free: a small mission may still take one.
                const held = needKeys.filter((k) => job.reserved && job.reserved[k] && avail[k] - want[k] < job.reserved[k].need);
                if (held.length) {
                    report('skip', { held: true, reason: `bewaard voor ${job.reserved[held[0]].by}: ${held.map(caption).join(', ')}` });
                    return;
                }

                // The game's own selection, in three passes. In one pass the game fills its
                // slots in a fixed order: water first, and the big fields ("fire",
                // "fustw") long before specialist ones, so a nearby DB-RI or KMAR gets
                // used up as a plain tankautospuit or noodhulp. So: specialist slots and
                // vehicle types first, then the big fields, then the water, foam and pump
                // capacity still short after the tanks of the vehicles already chosen
                // (the game's water slot ignores those and would add a full load).
                const GENERIC = ['fire', 'fustw', 'gwl2wasser', 'rw', 'rtw'];
                const AMOUNTS = ['wasser_amount', 'foam_amount', 'water_damage_pump_value'];
                const only = (keep) => Object.fromEntries(Object.entries(attrs).filter(([k]) => keep(k)));
                const chosen = () => [...new Map([...document.querySelectorAll('input.vehicle_checkbox:checked')].map((c) => [c.value, c])).values()];
                let shortage = '';
                let firstPass = true;
                function pass(slots, vt = {}) {
                    if (!Object.keys(slots).length && !Object.keys(vt).length) return;
                    const el = document.createElement('a');
                    el.id = 'aao_mks_auto';
                    el.className = 'aao_btn';
                    el.style.display = 'none';
                    el.setAttribute('aao_id', 'mks_auto');
                    el.setAttribute('reset', firstPass ? 'true' : 'false');
                    firstPass = false;
                    el.setAttribute('building_ids', '');
                    el.setAttribute('equipment_mode', '0');
                    el.setAttribute('custom', '{}');
                    for (const [k, v] of Object.entries(slots)) el.setAttribute(k, String(v));
                    if (Object.keys(vt).length) {
                        el.setAttribute('vehicle_type_ids', JSON.stringify(vt));
                        el.setAttribute('vehicle_type_captions', JSON.stringify(plan.vtCaptions));
                    }
                    document.body.appendChild(el);
                    // On a shortage the game calls alert(): catch the text instead of a popup.
                    const realAlert = W.alert;
                    W.alert = (t) => { shortage += String(t); };
                    try {
                        W.aaoClickHandler(el);
                    } catch (e) {
                        // aao_update_after_click() does not know our fake preset; the selection is already made.
                        ctx.warn('aaoClickHandler', e);
                    } finally {
                        W.alert = realAlert;
                        el.remove();
                    }
                }
                // Vehicle types that only go for their own job (setting, e.g. TS-BO, TS-GO):
                // hide them from the big fields and water/foam by setting those attributes
                // to 0 on their unticked checkboxes for the pass, then put them back.
                const own = new Set((job.ownJobOnly || []).map(String));
                function hidingOwnJob(fn) {
                    const stash = [];
                    if (own.size) {
                        document.querySelectorAll('input.vehicle_checkbox:not(:checked)').forEach((c) => {
                            if (!own.has(c.getAttribute('vehicle_type_id'))) return;
                            for (const k of [...GENERIC, ...AMOUNTS]) {
                                if (c.hasAttribute(k)) { stash.push([c, k, c.getAttribute(k)]); c.setAttribute(k, '0'); }
                            }
                        });
                    }
                    try { fn(); } finally { stash.forEach(([c, k, v]) => c.setAttribute(k, v)); }
                }
                pass(only((k) => !GENERIC.includes(k) && !AMOUNTS.includes(k)), plan.vt);
                hidingOwnJob(() => pass(only((k) => GENERIC.includes(k))));
                const rest = {};
                for (const k of AMOUNTS) {
                    if (!attrs[k]) continue;
                    const have = chosen().reduce((sum, c) => sum + (Number(c.getAttribute(k)) || 0), 0);
                    if (Number(attrs[k]) > have) rest[k] = Number(attrs[k]) - have;
                }
                hidingOwnJob(() => pass(rest));
                // Its own pass, after the rest; its shortage does not stop the mission.
                if (optOvdg) { const before = shortage; pass({ kdow_orgl: 1 }); shortage = before; }
                await sleep(400);
                shortage = untranslated(shortage);

                // A vehicle can have two rows (helicopters: 22.95 and 36.94 km for one
                // Lifeliner). Count it once, at its shortest distance.
                const dist = (c) => Number(c.getAttribute('data-distance')) || 0;
                const selection = () => {
                    const byId = new Map();
                    document.querySelectorAll('input.vehicle_checkbox:checked').forEach((c) => {
                        const prev = byId.get(c.value);
                        if (!prev || dist(c) < dist(prev)) byId.set(c.value, c);
                    });
                    return [...byId.values()];
                };
                let picked = selection();
                const reset = () => { try { W.vehicleSelectionReset(); } catch (e) { picked.forEach((c) => c.checked && c.click()); } };
                if (!picked.length) { report('skip', { reason: shortage ? `te weinig: ${fewer(shortage)}` : 'geen voertuigen beschikbaar', shortText: shortage }); return; }
                // Shortages on the ignore list (setting) do not stop the rest from going. On a
                // big patient mission ("24 Patiënten - 5 onbehandelde") ambulances may come in
                // parts: the patient lines ask for the rest once these have arrived.
                const big = job.bigPatients > 0 && patientCount > job.bigPatients;
                const ignored = (job.ignoreShort || []).map((n) => n.toLowerCase());
                const blocking = [...String(shortage).matchAll(/beschikbaar:\s*\d+\s+([^.\n]+)/gi)]
                    .map((m) => m[1].trim()).filter((n) => !ignored.includes(n.toLowerCase()) && !(big && /ambulance/i.test(n)));
                if (shortage && job.needAll && (blocking.length || !/beschikbaar:/i.test(shortage))) {
                    reset();
                    report('skip', { reason: `te weinig: ${fewer(shortage)} (de rest is er wel)`, shortText: shortage, avail, caps, want });
                    return;
                }
                // Helicopters fly: they get their own, larger limit.
                const AIR = ['23', '28', '80', '85'];
                const tooFar = (c) => dist(c) > (AIR.includes(c.getAttribute('vehicle_type_id')) ? job.airKm : job.maxKm);
                if (big) {
                    // Big patient mission: leave the far ambulances home instead of skipping it all.
                    picked.filter((c) => tooFar(c) && c.getAttribute('rtw') === '1').forEach((c) => {
                        document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click());
                    });
                    picked = selection();
                    if (!picked.length) { report('skip', { reason: 'alle ambulances te ver', shortText: shortage }); return; }
                }
                const isOvdg = (c) => c.getAttribute('kdow_orgl') === '1';
                if (optOvdg) {
                    // The optional OvD-G from too far stays home; the rest still goes.
                    picked.filter((c) => tooFar(c) && isOvdg(c)).forEach((c) => {
                        document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click());
                    });
                    picked = selection();
                    if (!picked.length) { report('skip', { reason: 'niets te sturen' }); return; }
                }
                const ovdgNote = !optOvdg ? '' : picked.some(isOvdg) ? `met OvD-G (${patientCount} patiënten)` : `zonder OvD-G (geen vrij binnen ${job.maxKm} km)`;
                const far = Math.max(...picked.map(dist));
                if (picked.some(tooFar)) {
                    // Which types had to come from too far: those are the ones to buy closer by.
                    const farTypes = {};
                    picked.filter(tooFar).forEach((c) => {
                        const t = c.closest('tr')?.getAttribute('vehicle_type') || `type ${c.getAttribute('vehicle_type_id')}`;
                        farTypes[t] = (farTypes[t] || 0) + 1;
                    });
                    reset();
                    report('skip', { reason: `voertuig op ${far.toFixed(1)} km`, farTypes, shortText: shortage, avail, caps, want });
                    return;
                }

                const btn = document.getElementById('alert_btn');
                if (!btn) { reset(); report('error', { reason: 'knop Alarmeren niet gevonden' }); return; }
                const taken = await claimCars(picked.map((c) => c.value));
                if (taken.length) {
                    // The team window sent one of these meanwhile: look again in a minute.
                    reset();
                    report('wait', { reason: `${taken.length} voertuig(en) net door het andere venster gestuurd, zo opnieuw` });
                    return;
                }
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', { mode, n: picked.length, km: far, short: shortage ? fewer(shortage) : '', shortText: shortage, note: ovdgNote, ids: picked.map((c) => c.value) });
                btn.click();
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        /* ========================================================================
         * ARRESTANTEN in a mission window. Each police car on scene with
         * arrestants has a block under its row in "Voertuigen ter plaatse":
         *   <div id="prison-select-5848090" data-vehicle-id="5848090" class="prison-select">
         *     <a data-prison-id="1769528" class="btn btn-success"
         *        href="/vehicles/5848090/gefangener/1769528?...">Politie Amersfoort-Centrum
         *        (BT 31) (Vrije cellen: 2, afstand: 6,86 km)</a> ...
         * Red buttons are full; team cells add "Afdrachtpercentage: 0%". Same
         * choice as a spraakaanvraag. One car per job: the click loads another page.
         * ==================================================================== */
        // The window lists only the nearest vehicles; "Laad ontbrekende voertuigen" adds the rest.
        // Without it, free horse trucks 26.6 km away were never seen ("te weinig: 5 Police
        // Horses" with two full trucks free in Harderwijk).
        async function loadMissing() {
            const shownEl = (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none' && !el.closest('[style*="display: none"]');
            for (let i = 0; i < 3; i++) {
                const more = document.querySelector('a[href*="/missing_vehicles"]');
                if (!more || !shownEl(more)) break;
                const before = document.querySelectorAll('input.vehicle_checkbox').length;
                more.click();
                for (let t = 0; t < 40 && document.querySelectorAll('input.vehicle_checkbox').length === before; t++) await sleep(200);
                await sleep(300);
            }
        }

        // Own missions and team missions run side by side, each in its own hidden window. A
        // car one of them sent seconds ago can still look free in the other's window: those
        // (job.avoid) are taken out of the list before anything is chosen.
        // Right before Alarmeren: ask the controller whether these cars are still ours to send.
        // It answers one frame at a time and marks them taken at once, so two windows can never
        // both send the same car, however long ago their vehicle lists were loaded.
        function claimCars(ids) {
            return new Promise((resolve) => {
                const key = Math.random().toString(36).slice(2);
                let t = null;
                const on = (ev) => {
                    if (ev.source !== window.parent || !ev.data || !ev.data[MSG] || ev.data.claimReply !== key) return;
                    window.removeEventListener('message', on);
                    clearTimeout(t);
                    resolve(ev.data.taken || []);
                };
                window.addEventListener('message', on);
                // No answer (an older controller): go ahead as before.
                t = setTimeout(() => { window.removeEventListener('message', on); resolve([]); }, 3000);
                window.parent.postMessage({ [MSG]: true, claim: ids.map(String), key }, location.origin);
            });
        }

        function dropAvoided(ids) {
            if (!ids || !ids.length) return;
            const avoid = new Set(ids.map(String));
            document.querySelectorAll('input.vehicle_checkbox').forEach((c) => { if (avoid.has(c.value)) (c.closest('tr') || c).remove(); });
        }

        // One of our own vehicles driving to or at the mission. The owner column links the
        // owner's profile: with our user id known, only that counts (a team admin may also
        // see "terug naar post" on other players' cars). A row without any profile link
        // falls back to the "terug naar post" (backalarm) button.
        function ownRowOn(doc, me) {
            return [...doc.querySelectorAll('#mission_vehicle_driving tbody tr, #mission_vehicle_at_mission tbody tr')].some((tr) => {
                const profile = tr.querySelector('a[href*="/profile/"]');
                if (me && profile) return /\/profile\/(\d+)/.exec(profile.getAttribute('href'))?.[1] === String(me);
                return !!tr.querySelector('a[href*="/backalarm"]');
            });
        }

        /* ========================================================================
         * TEAM MISSION — another player's mission shared with the team. Exactly one
         * noodhulp (the game's own "fustw" slot, nearest first, any distance), and only when none
         * of our own vehicles is driving there or on scene: those rows have a
         * "terug naar post" (backalarm) button, which only your own vehicles get.
         * ==================================================================== */
        async function teamWorker(job, report, doneKey) {
            if (ownRowOn(document, job.me)) {
                const row = [...document.querySelectorAll('#mission_vehicle_driving tbody tr, #mission_vehicle_at_mission tbody tr')].find((tr) => ownRowOn({ querySelectorAll: () => [tr] }, job.me));
                const cells = row ? [...row.cells].map((c) => c.textContent.trim()).filter(Boolean).join(' · ') : '';
                report('skip', { reason: `eigen voertuig: ${clean(cells).slice(0, 80)}`, joined: true });
                return;
            }
            const dist = (c) => Number(c.getAttribute('data-distance')) || 0;
            async function select() {
                const el = document.createElement('a');
                el.id = 'aao_mks_team';
                el.className = 'aao_btn';
                el.style.display = 'none';
                for (const [k, v] of Object.entries({ aao_id: 'mks_team', reset: 'true', building_ids: '', equipment_mode: '0', custom: '{}', fustw: '1' })) el.setAttribute(k, v);
                document.body.appendChild(el);
                const realAlert = W.alert;
                W.alert = () => {}; // "Niet beschikbaar: 1 noodhulp": no popup in the hidden window
                try { W.aaoClickHandler(el); } catch (e) { ctx.warn('aaoClickHandler', e); } finally { W.alert = realAlert; el.remove(); }
                await sleep(400);
                return [...new Map([...document.querySelectorAll('input.vehicle_checkbox:checked')].map((c) => [c.value, c])).values()]
                    .sort((a, b) => dist(a) - dist(b));
            }
            dropAvoided(job.avoid);
            let picked = await select();
            // None among the nearest listed: any distance counts, so load the rest and look again.
            if (!picked.length) { await loadMissing(); dropAvoided(job.avoid); picked = await select(); }
            const reset = () => { try { W.vehicleSelectionReset(); } catch (e) { document.querySelectorAll('input.vehicle_checkbox:checked').forEach((c) => c.click()); } };
            if (!picked.length) { report('skip', { reason: 'geen noodhulp vrij', noCar: true }); return; }
            // Never more than one, whatever the game picked.
            picked.slice(1).forEach((c) => document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click()));
            const btn = document.getElementById('alert_btn');
            if (!btn) { reset(); report('error', { reason: 'knop Alarmeren niet gevonden' }); return; }
            // Taken by our own missions meanwhile: leave it out and pick the next one, once.
            for (let i = 0; i < 2; i++) {
                const taken = await claimCars([picked[0].value]);
                if (!taken.length) break;
                reset();
                dropAvoided(taken);
                picked = await select();
                picked.slice(1).forEach((c) => document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click()));
                if (!picked.length || i === 1) { reset(); report('wait', { reason: 'noodhulp net door je eigen inzetten gestuurd, zo opnieuw' }); return; }
            }
            const km = dist(picked[0]); // no distance limit for team missions
            try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
            report('sending', { mode: 'team', n: 1, km, car: (picked[0].closest('tr')?.getAttribute('vehicle_type') || 'noodhulp'), ids: [picked[0].value] });
            btn.click();
        }

        function prisonerCell(job, block, report, doneKey) {
            // The car's own row is the one above the cell list ("MD 33.01 NH-OV").
            const vid = block.getAttribute('data-vehicle-id');
            const car = clean(block.closest('tr')?.previousElementSibling?.querySelector(`a[href^="/vehicles/${vid}"]`)?.textContent || '')
                || `voertuig ${vid}`;
            if (!job.transport) { report('skip', { reason: `arrestanten wachten op een cel (${car}), spraakaanvragen afhandelen staat uit` }); return; }
            const go = (a, detail) => {
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', { mode: 'cell', car, ...detail });
                a.click();
            };
            const all = destinations(block);
            const { best, why } = bestDestination(all, job);
            if (best) { go(best.a, { dest: best.name, km: best.dist, cost: best.cost }); return; }
            const need = why.vol ? 'Cellen (alles vol)' : 'Cel binnen kosten/afstand';
            const reasons = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ') || 'geen cellen';
            // A release button for this one car if there is one, else the mission-wide
            // "Arrestant vrijlaten" (data-method="post"; jquery-ujs posts it on click).
            // Every car sees the same cells, so nothing fits for any of them.
            const release = block.querySelector('a[href$="/gefangener/-1"], a[href*="/gefangener/-1?"]')
                || document.querySelector('a[href$="/gefangene/entlassen"][data-method="post"]');
            if (job.release && release) { go(release, { release: true, dest: 'gevangenen vrijgelaten', unknownNeeds: [need] }); return; }
            report('skip', { reason: `arrestanten (${car}): geen passende cel (${reasons})`, unknownNeeds: [need], prisoners: true });
        }

        function clean(t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 160); }

        // The game's "Niet beschikbaar: 1 SIV-P of DM-P." counts what is missing, not
        // what it found: "1 SIV-P of DM-P, 1 BA-DDG" reads less like "none at all".
        // The game has no Dutch name for some preset fields and writes
        // '[missing "nl_NL.intervention_order.vehicles.<field>" translation]' instead.
        // Function declarations: the workers run before these lines are reached.
        function untranslated(t) {
            const NAMES = { hazard_response_disinfection_large: 'DB-GO, TS-GO of GOH-DC', hazard_response_disinfection: 'DB-BO, TS-BO of BOH-DC' };
            return String(t).replace(/\[missing\s+"[^"]*?\.vehicles\.(\w+)"\s+translation\]/g, (m, k) => NAMES[k] || k);
        }
        function fewer(t) {
            return clean(String(t).replace(/Niet beschikbaar:\s*/gi, '').replace(/\.\s*(?=\S)/g, ', ').replace(/\.\s*$/, ''));
        }

        // Same as the "load missing vehicles" module: click until the list stops growing.
        async function loadAllVehicles() {
            const count = () => document.querySelectorAll('input.vehicle_checkbox').length;
            let last = -1, stable = 0;
            for (let i = 0; i < 40 && stable < 3; i++) {
                const more = document.querySelector('a[href*="/missing_vehicles"]');
                if (more && !more.dataset.mksClicked) { more.dataset.mksClicked = '1'; more.click(); stable = 0; }
                await sleep(250);
                const n = count();
                stable = n === last && !document.querySelector('a[href*="/missing_vehicles"]:not([data-mks-clicked])') ? stable + 1 : 0;
                last = n;
            }
        }

        /* ========================================================================
         * CONTROLLER — map page. Picks own unattended missions, turns their
         * requirements (/einsaetze.json) into AAO slots and hands one at a
         * time to a hidden iframe.
         * ==================================================================== */
        function controller() {
            const DATA_KEY = 'mks.autoDispatch.missions.v2';
            try { GM_deleteValue('mks.autoDispatch.missions.v1'); } catch (e) { /* ignore */ }
            const DATA_MS = 24 * 3600 * 1000;

            let running = false;
            let busy = false;
            let stopped = false;
            let timer = null;
            let heartbeat = null;
            let missions = null;
            let errorStreak = 0;

            /* --------------------------------------------------------------------
             * SESSION — kept in sessionStorage, so it survives a reload of this
             * tab (auto mode resumes by itself) while a new tab starts clean.
             * A lock with a heartbeat in localStorage keeps it to one tab.
             * ------------------------------------------------------------------ */
            const SESSION_KEY = 'mks-auto-dispatch.session';
            const LOCK_KEY = 'mks-auto-dispatch.lock';
            const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const loadedAt = Date.now();
            let saved = null;
            try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { saved = null; }
            saved = saved || {};
            const tried = new Map(saved.tried || []); // mission id or v<vehicle id> -> time of last attempt
            // Team missions we joined (sent our noodhulp, or found our own vehicle there): id -> when.
            // Kept over reloads: our car may have left for a cell while the mission goes on.
            const teamDone = new Map(saved.teamJoined || []); // (teamDone of older versions is not trusted)
            const sent = saved.sent || [];            // send times, for the hourly cap
            const log = (saved.log || []).map((l) => ({ ...l, at: new Date(l.at) }));
            const stats = { sent: 0, skipped: 0, errors: 0, transports: 0, ...(saved.stats || {}) };
            // Kept across reloads, or a reload (beta update, memory recycle) let an ended hold
            // start over: Rietkapbrand held an OvD-P from 15:11 to 15:49.
            const holds = new Map(saved.holds || []); // mission id -> { until, name, credits, keys: { key: { cap, need } } }
            const holdExpired = new Map(saved.holdExpired || []); // mission id -> when its hold ran out

            function saveSession() {
                const now = Date.now();
                try {
                    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                        running, stats, sent,
                        tried: [...tried].filter(([, t]) => now - t < 3 * 3600000),
                        holds: [...holds].filter(([, h]) => h.until > now),
                        holdExpired: [...holdExpired].filter(([, t]) => now - t < 3 * 3600000),
                        teamJoined: [...teamDone].filter(([, t]) => now - t < 12 * 3600000),
                        log: log.slice(0, 100),
                    }));
                } catch (e) { /* ignore */ }
            }

            // Another live auto mode (other tab), or null.
            function lockHolder() {
                try {
                    const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                    return l && l.inst !== INSTANCE && Date.now() - l.at < 15000 ? l : null;
                } catch (e) { return null; }
            }
            const takeLock = () => { try { localStorage.setItem(LOCK_KEY, JSON.stringify({ inst: INSTANCE, at: Date.now() })); } catch (e) { /* ignore */ } };
            function releaseLock() {
                try {
                    const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                    if (l && l.inst === INSTANCE) localStorage.removeItem(LOCK_KEY);
                } catch (e) { /* ignore */ }
            }
            const onPageHide = () => { saveSession(); releaseLock(); };
            window.addEventListener('pagehide', onPageHide);

            function addLog(name, text, tone) {
                log.unshift({ at: new Date(), name, text, tone });
                if (log.length > 200) log.pop();
                saveSession();
                ctx.refresh();
            }

            /* --------------------------------------------------------------------
             * TRANSPORT REQUESTS — vehicles in status 5, oldest first. Filled
             * from /api/vehicles, then kept current by the game's radio messages
             * (same hook as the Verbeterde spraakaanvragen module).
             * ------------------------------------------------------------------ */
            const talk = new Map(); // vehicle id -> { caption, since }
            let talkLoaded = 0;
            async function loadTalk() {
                const list = await fetch('/api/vehicles', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []));
                const now = Date.now();
                const live = new Set();
                for (const v of list) {
                    if (v.fms_real !== 5) continue;
                    live.add(String(v.id));
                    if (!talk.has(String(v.id))) talk.set(String(v.id), { caption: v.caption, since: now });
                }
                for (const id of [...talk.keys()]) if (!live.has(id)) talk.delete(id);
                talkLoaded = now;
            }
            let radioTries = 0;
            (function hookRadio() {
                const orig = W.radioMessage;
                if (typeof orig !== 'function') {
                    if (++radioTries <= 30 && !stopped) setTimeout(hookRadio, 1000);
                    return;
                }
                W.radioMessage = function (msg) {
                    try {
                        if (!stopped && msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                            const id = String(msg.id);
                            if (Number(msg.fms_real) === 5) { if (!talk.has(id)) talk.set(id, { caption: msg.caption || id, since: Date.now() }); } else talk.delete(id);
                        }
                    } catch (e) { ctx.warn('radio hook failed', e); }
                    return orig.apply(this, arguments);
                };
            })();

            /* --------------------------------------------------------------------
             * NEEDS — every reason a mission could not be (fully) sent, kept
             * across sessions, so the dashboard shows which vehicle types to buy.
             *   short: the game had none of that type available
             *   far:   only available beyond the maximum distance
             *   other: a requirement this script cannot send (training, equipment)
             * Each mission counts once per type, however often it is retried.
             * ------------------------------------------------------------------ */
            const NEEDS_KEY = 'mks.autoDispatch.needs.v1';
            const UNKNOWN_LABEL = {
                wildfire_equipment: 'Natuurbrandbestrijding uitrusting', railway_material: 'Spoormaterieel',
                search_and_rescue_engine: 'TS-USAR', search_and_rescue_equipment: 'USAR uitrusting', rescue_dog_units: 'Speurhonden',
            };
            let needs;
            try { needs = JSON.parse(GM_getValue(NEEDS_KEY, 'null')); } catch (e) { needs = null; }
            if (!needs || !needs.types) needs = { since: Date.now(), types: {}, other: {} };
            const saveNeeds = () => { try { GM_setValue(NEEDS_KEY, JSON.stringify(needs)); } catch (e) { ctx.warn('needs not saved', e); } };

            // Where the mission being handled is ([lat, lon]) and what it pays, set by the
            // loop. Stored per need as [lat, lon, time, credits], so the expansion module
            // knows where to buy and how many credits a shortage blocked.
            let curPos = null;
            let curCredits = 0;
            function addNeed(kind, name, units, id, missionName) {
                const bucket = kind === 'other' ? needs.other : needs.types;
                const t = bucket[name] || (bucket[name] = { missions: 0, short: 0, far: 0, units: 0, ids: [], last: 0, example: '' });
                if (t.ids.includes(id)) return;
                t.ids.push(id);
                if (t.ids.length > 100) t.ids.shift();
                t.missions++;
                if (kind === 'short') t.short++;
                if (kind === 'far') t.far++;
                t.units += units || 0;
                t.last = Date.now();
                t.example = missionName;
                t.credits = (t.credits || 0) + (curCredits || 0);
                if (curPos) {
                    t.pos = t.pos || [];
                    t.pos.push([...curPos, Date.now(), curCredits || 0]);
                    if (t.pos.length > 200) t.pos.shift();
                }
            }

            /* --------------------------------------------------------------------
             * EVENTS — one line per mission or transport handled, the last 3000,
             * kept across sessions. Read by the expansion module, and on the page
             * as window.mksAutoData so it can be inspected from outside.
             * ------------------------------------------------------------------ */
            const EVENTS_KEY = 'mks.autoDispatch.events.v1';
            let events;
            try { events = JSON.parse(GM_getValue(EVENTS_KEY, '[]')) || []; } catch (e) { events = []; }
            let eventsTimer = null;
            function recordEvent(e) {
                events.push({ t: Date.now(), ...e });
                if (events.length > 3000) events.splice(0, events.length - 3000);
                clearTimeout(eventsTimer);
                eventsTimer = setTimeout(() => { try { GM_setValue(EVENTS_KEY, JSON.stringify(events)); } catch (x) { ctx.warn('events not saved', x); } }, 2000);
            }
            W.mksAutoData = {
                get needs() { return needs; },
                get events() { return events; },
                get stats() { return stats; },
                get holds() { return [...holds].map(([id, h]) => ({ id, ...h })); },
                get running() { return running; },
                get log() { return log; },
                get team() {
                    return { on: !!ctx.cfg.teamMissions, busy: teamBusy, pausedUntil: teamPauseUntil || null, joined: teamDone.size,
                        listed: document.querySelectorAll('#mission_list_alliance .missionSideBarEntry[mission_id]').length,
                        hidden: [...document.querySelectorAll('#mission_list_alliance .missionSideBarEntry[mission_id]')].filter((e) => getComputedStyle(e).display === 'none').length };
                },
            };

            // "Niet beschikbaar: 1 AT-Commandant. Niet beschikbaar: 2 TS 8/9. "
            function recordShortage(text, id, name) {
                if (!text) return;
                let hit = false;
                for (const m of String(text).matchAll(/beschikbaar:\s*(\d+)\s+([^.\n]+)/gi)) {
                    addNeed('short', m[2].trim(), Number(m[1]), id, name);
                    hit = true;
                }
                if (!hit) addNeed('short', clean(text), 0, id, name);
            }

            function recordResult(res, id, name) {
                recordShortage(res.shortText, id, name);
                (res.unknownNeeds || []).forEach((u) => addNeed('other', u, 0, id, name));
                for (const [type, n] of Object.entries(res.farTypes || {})) addNeed('far', type, n, id, name);
                saveNeeds();
            }

            // /einsaetze.json is ~2.7 MB: keep only the requirements, once a day.
            async function loadMissions() {
                if (missions) return missions;
                try {
                    const c = JSON.parse(GM_getValue(DATA_KEY, 'null'));
                    if (c && Date.now() - c.at < DATA_MS) return (missions = c.m);
                } catch (e) { /* refetch */ }
                ctx.status('Inzetgegevens ophalen…', { tone: 'busy', dock: true });
                const res = await fetch('/einsaetze.json', { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`/einsaetze.json: ${res.status}`);
                const m = {};
                for (const e of await res.json()) {
                    // Towing missions have no requirements: the cars to tow are in
                    // "additional" (cars = Berger-K, trucks = Berger-G).
                    const r = { ...(e.requirements || {}) };
                    const add = e.additional || {};
                    if (add.possible_crashed_car_max) r.car_carrier = Math.max(r.car_carrier || 0, add.possible_crashed_car_max);
                    if (add.possible_crashed_car_large_max) r.car_carrier_large = Math.max(r.car_carrier_large || 0, add.possible_crashed_car_large_max);
                    m[e.id] = r;
                }
                GM_setValue(DATA_KEY, JSON.stringify({ at: Date.now(), m }));
                return (missions = m);
            }

            const attr = (el, n) => (el.getAttribute(n) || '').replace(/^null$/, '');
            function keyOf(entry) {
                const idx = attr(entry, 'data-overlay-index');
                const ov = attr(entry, 'data-additive-overlays');
                return `${entry.getAttribute('mission_type_id')}${idx !== '' ? `-${idx}` : ''}${ov ? `/${ov}` : ''}`;
            }

            // Training keys as the game's education filter names them.
            const EDUCATION = { wildfire: 'Handcrew', care_service: 'Verzorger', clean_service: 'Hygiënemedewerker',
                hazard_material_response: 'Gevaarlijke Stoffen Eenheid', hazard_suits_response: 'Ontsmettings Eenheid', wechsellader: 'Brandweerchauffeur-zwaar' };

            // Requirements -> { slots, vt } plus readable names of what cannot be sent.
            function plan(req) {
                const slots = {}, vt = {}, vtCaptions = {}, unknown = [];
                let trained = [];
                for (const [k, v] of Object.entries(req)) {
                    if (k === 'personnel_educations' && v && typeof v === 'object') { trained = Object.entries(v); continue; }
                    if (typeof v !== 'number') { unknown.push(UNKNOWN_LABEL[k] || k); continue; }
                    if (v <= 0) continue;
                    const to = MAP[k];
                    if (!to) unknown.push(UNKNOWN_LABEL[k] || k);
                    else if (to.startsWith('vt:')) {
                        const id = to.slice(3);
                        vt[id] = (vt[id] || 0) + v;
                        vtCaptions[id] = VT_CAPTION[id] || id;
                    } else slots[to] = (slots[to] || 0) + v;
                }
                const out = { slots, vt, vtCaptions, unknown };
                // Trained personnel last, so a vehicle already required counts toward it.
                addPersonnel(out, trained, (e, n) => `Opleiding ${EDUCATION[e] || e} (${n} pers.)`);
                return out;
            }

            // The red "Missende voertuigen" box the game also shows in the mission list.
            const sidebarMissing = (e) => (document.getElementById(`mission_missing_${e.getAttribute('mission_id')}`)?.textContent || '').replace(/\s+/g, ' ').trim();

            // "We benodigen: ..." under the mission in the list: one red line per patient,
            // or with many patients one summary line ("8x We benodigen: OvD-G").
            const sidebarPatients = (e) => [...document.querySelectorAll(`#mission_patients_${e.getAttribute('mission_id')} .alert-danger`)]
                .filter((x) => x.style.display !== 'none').map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();

            // "Arrestanten moeten vervoerd worden." in the list: a police car is (or will
            // be) stuck there until it gets a cell.
            const prisonersWaiting = (e) => /arrestanten moeten/i.test(sidebarMissing(e));

            function candidates() {
                const now = Date.now();
                return [...document.querySelectorAll('#mission_list .missionSideBarEntry[mission_type_id]')].filter((e) => {
                    const red = ctx.cfg.topUp && (sidebarMissing(e) || (ctx.cfg.patients && sidebarPatients(e)));
                    if (e.getAttribute('data-mission-state-filter') !== 'unattended' && !red) return false;
                    // Arrestants also on hidden missions: our own car is blocked there.
                    if (ctx.cfg.onlyVisible && getComputedStyle(e).display === 'none' && !(ctx.cfg.transport && prisonersWaiting(e))) return false;
                    const t = tried.get(e.getAttribute('mission_id'));
                    return !t || now - t > ctx.cfg.retryMin * 60000;
                }).sort((a, b) => (ctx.cfg.transport ? prisonersWaiting(b) - prisonersWaiting(a) : 0)
                    || creditsOf(b) - creditsOf(a)); // arrestants first (a cell takes seconds), then big missions
            }

            const titleOf = (e) => {
                try { return JSON.parse(e.getAttribute('data-sortable-by')).caption; } catch (x) { return e.getAttribute('search_attribute') || e.getAttribute('mission_id'); }
            };
            // "TS-BO, TS-GO" (setting) -> vehicle type ids, via the full type names.
            const ownJobOnly = () => String(ctx.cfg.ownJobOnly || '').split(',').map((n) => VT_BY_NAME.get(normName(n))).filter((id) => id != null);
            const creditsOf = (e) => {
                try { return Number(JSON.parse(e.getAttribute('data-sortable-by')).average_credits) || 0; } catch (x) { return 0; }
            };

            /* --------------------------------------------------------------------
             * HOLDS — a big mission that has to wait (something short) holds its
             * rare vehicles (rareMax or fewer free, missing ones too), so smaller
             * missions do not take them in the meantime. A hold ends when the
             * mission is sent or gone, or after holdMin, so nothing stays stuck.
             * ------------------------------------------------------------------ */
            const HOLD_NEVER = ['rtw', 'fustw', 'fire', 'gwl2wasser', 'rw', 'wasser_amount', 'foam_amount', 'water_damage_pump_value'];
            // What bigger waiting missions hold: { key: { by, need } }, needs added up.
            function reservedFor(id, credits) {
                const now = Date.now();
                const out = {};
                for (const [hid, h] of holds) {
                    if (h.until < now) { holdExpired.set(hid, now); holds.delete(hid); continue; }
                    if (!document.getElementById(`mission_${hid}`)) { holds.delete(hid); continue; }
                    // Only worth it for a clearly bigger mission: twice the credits or more. A
                    // 7,190 garage fire held units back from 6,000 missions for no gain.
                    if (hid === id || h.credits < credits * 2) continue;
                    for (const [k, v] of Object.entries(h.keys)) {
                        if (!out[k]) out[k] = { by: `${h.name} (${ctx.nl(h.credits)} cr)`, need: 0 };
                        out[k].need += v.need;
                    }
                }
                return out;
            }
            // A mission whose hold ran out is not held again for twice the hold time: before
            // this, it was held again on its next try and kept rare vehicles idle for an hour
            // (Brand in ziekenhuis held an OvD-P from 12:34 while 13 missions waited).
            function updateHold(id, name, credits, res) {
                if (res.result === 'sent' || res.result === 'unconfirmed') { holds.delete(id); return; }
                const out = holdExpired.get(id);
                if (out && Date.now() - out < ctx.cfg.holdMin * 2 * 60000) return;
                if (res.result !== 'skip' || !res.avail || !(ctx.cfg.bigCredits > 0) || credits < ctx.cfg.bigCredits) return;
                const keys = {};
                for (const [k, n] of Object.entries(res.avail)) {
                    // Plain units (ambulances, fire engines, police cars) are only "rare" for a
                    // moment when many are out: holding them starved a dozen missions for one
                    // 10k Brand in kantoorgebouw. Only specialist units are held.
                    if (HOLD_NEVER.includes(k)) continue;
                    if (n <= ctx.cfg.rareMax) keys[k] = { cap: (res.caps && res.caps[k]) || k, need: (res.want && res.want[k]) || 1 };
                }
                if (!Object.keys(keys).length) return;
                // The end time is set once: retries do not keep a hold alive forever.
                const known = holds.get(id);
                holds.set(id, { until: known ? known.until : Date.now() + ctx.cfg.holdMin * 60000, name, credits, keys });
                // Look again in a minute, to catch a held vehicle as soon as it is back.
                tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
            }

            // One mission in a hidden iframe. Resolves with the worker's report.
            // Mission jobs running right now in either loop, so maxPerHour holds for both together.
            let inFlight = 0;
            function runJob(job) {
                const counts = job.kind !== 'transport';
                if (counts) inFlight++;
                return runFrame(job).finally(() => { if (counts) inFlight--; });
            }
            function runFrame(job) {
                return new Promise((resolve) => {
                    const frame = document.createElement('iframe');
                    frame.name = WORKER + JSON.stringify(job);
                    frame.setAttribute('aria-hidden', 'true');
                    frame.tabIndex = -1;
                    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none';
                    let result = null;
                    let finish, poll;
                    let done = false;
                    const cleanup = (r) => {
                        if (done) return;
                        done = true;
                        clearTimeout(finish);
                        clearInterval(poll);
                        window.removeEventListener('message', onMsg);
                        setTimeout(() => frame.remove(), 200);
                        resolve(r);
                    };
                    const transport = job.kind === 'transport';
                    function onMsg(ev) {
                        if (ev.origin !== location.origin || ev.source !== frame.contentWindow || !ev.data || !ev.data[MSG]) return;
                        if (ev.data.claim) {
                            // Check and mark in one go (one message at a time): see claimCars().
                            avoidCars();
                            const taken = ev.data.claim.filter((v) => recentCars.has(v));
                            if (!taken.length) ev.data.claim.forEach((v) => recentCars.set(v, Date.now()));
                            ev.source.postMessage({ [MSG]: true, claimReply: ev.data.key, taken }, location.origin);
                            return;
                        }
                        result = ev.data;
                        if (result.result !== 'sending') return cleanup(result);
                        (result.ids || []).forEach((v) => recentCars.set(String(v), Date.now()));
                        // Confirmed by our own list (mission no longer red, vehicle no longer
                        // status 5) or by the page the frame lands on afterwards. A top-up
                        // starts from a mission that is not red, so it waits for the page.
                        clearTimeout(finish);
                        finish = setTimeout(() => cleanup({ ...result, result: 'unconfirmed' }), 20000);
                        poll = setInterval(() => {
                            if (transport) { if (!talk.has(String(job.id))) cleanup({ ...result, result: 'sent' }); return; }
                            if (result.mode !== 'full') return;
                            const entry = document.getElementById(`mission_${job.id}`);
                            if (!entry || entry.getAttribute('data-mission-state-filter') !== 'unattended') cleanup({ ...result, result: 'sent' });
                        }, 500);
                        frame.addEventListener('load', () => {
                            let ok = false;
                            try {
                                // A team mission always has other players' rows: only our own counts.
                                ok = result.mode === 'cell' || (transport
                                    ? /^\/vehicles\/\d+\/(patient|gefangener)\/-?\d+/.test(frame.contentWindow.location.pathname)
                                    : result.mode === 'team' ? ownRowOn(frame.contentDocument, job.me)
                                        : !!frame.contentDocument.querySelector('#mission_vehicle_driving tbody tr, #mission_vehicle_at_mission tbody tr'));
                            } catch (e) { /* ignore */ }
                            if (ok) cleanup({ ...result, result: 'sent' });
                        }, { once: true });
                    }
                    window.addEventListener('message', onMsg);
                    finish = setTimeout(() => cleanup({ result: 'error', reason: `${transport ? 'voertuigvenster' : 'alarmeervenster'} reageerde niet (60 s)` }), 60000);
                    frame.src = transport ? `/vehicles/${job.id}` : `/missions/${job.id}`;
                    document.body.appendChild(frame);
                });
            }

            // Answer transport requests first: they keep ambulances and police cars busy.
            async function transports() {
                if (!ctx.cfg.transport) return;
                if (Date.now() - talkLoaded > 5 * 60000) await loadTalk();
                const now = Date.now();
                const todo = [...talk].sort((a, b) => a[1].since - b[1].since)
                    .filter(([vid]) => { const t = tried.get(`v${vid}`); return !t || now - t > ctx.cfg.retryMin * 60000; });
                for (const [vid, v] of todo) {
                    if (!running || stopped) return;
                    tried.set(`v${vid}`, Date.now());
                    status(`Spraakaanvraag: ${v.caption}`, 'busy');
                    const res = await runJob({ kind: 'transport', id: vid, token: Date.now(), destCost: Number(ctx.cfg.destCost),
                        destKm: Number(ctx.cfg.destKm), ownKm: Number(ctx.cfg.ownKm), release: ctx.cfg.release });
                    curPos = null;
                    curCredits = 0;
                    recordResult(res, `v${vid}`, v.caption);
                    recordEvent({ kind: 'transport', vehicle: vid, name: v.caption, result: res.result, mode: res.mode, dest: res.dest, km: res.km, cost: res.cost, reason: res.reason, page: res.page });
                    if (res.result === 'sent' || res.result === 'unconfirmed') {
                        stats.transports++;
                        errorStreak = 0;
                        talk.delete(vid);
                        const where = res.mode === 'release' ? res.dest
                            : `naar ${res.dest}${isNaN(res.km) ? '' : `, ${Number(res.km).toFixed(1)} km`}${res.cost ? `, ${res.cost}%` : ''}`;
                        addLog(v.caption, `${res.result === 'sent' ? '' : '(niet bevestigd) '}${where}`, res.mode === 'release' ? 'warn' : 'ok');
                    } else if (res.result === 'skip' && res.gone) {
                        // Logged, not silent: a page we cannot read looked like this before.
                        talk.delete(vid);
                        addLog(v.caption, res.reason, 'idle');
                    } else if (res.result === 'skip') {
                        stats.skipped++;
                        errorStreak = 0;
                        addLog(v.caption, `spraakaanvraag blijft staan: ${res.reason}`, 'warn');
                    } else {
                        stats.errors++;
                        addLog(v.caption, `fout: ${res.reason}`, 'error');
                        if (++errorStreak >= 3) { threeErrors(res.reason); return; }
                    }
                    await sleep(ctx.cfg.pauseSec * 1000);
                }
            }

            // Mission done except for its patients (bar at 100%): our other units there or on
            // the way are only waiting, so send them back to their posts. Patient units
            // (ambulances, OvD-G, MMT, Lifeliner, rapid responders) stay. Missions with
            // arrestants are left alone: the police cars there carry them.
            const PATIENT_VT = new Set(Object.entries(VT_NAMES)
                .filter(([n]) => /ambulance|lifeliner|mmt|geneesk|rapid responder|\bnht\b|\bggb\b/i.test(n)).map(([, id]) => String(id)));
            const sentBack = new Map(); // mission id -> when we last looked
            // A full bar is not enough: a red (progress-bar-danger) bar is also 100% wide when
            // units are missing (Rietkapbrand, 8 TS short, had 40 units sent back). Only a
            // full bar that is not red counts as done.
            const isDone = (bar) => !!bar && parseFloat(bar.style.width) >= 100
                && !/progress-bar-(danger|warning)/.test(bar.className) && /progress-bar-success/.test(bar.className);
            async function sendBackDone() {
                if (!ctx.cfg.sendBack) return;
                const done = [...document.querySelectorAll('#mission_list .missionSideBarEntry[mission_id]')].filter((e) => {
                    const bar = document.getElementById(`mission_bar_${e.getAttribute('mission_id')}`);
                    return isDone(bar);
                });
                let looked = 0;
                for (const e of done) {
                    const id = e.getAttribute('mission_id');
                    if (Date.now() - (sentBack.get(id) || 0) < 3 * 60000) continue;
                    if (++looked > 5 || !running || stopped) break;
                    sentBack.set(id, Date.now());
                    try {
                        const r = await fetch(`/missions/${id}`, { credentials: 'same-origin' });
                        if (!r.ok) continue;
                        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
                        const bar = doc.getElementById(`mission_bar_${id}`);
                        if (!isDone(bar)) continue;
                        // Anything still asked for in the red box: the mission is not done.
                        if ((doc.getElementById('missing_text')?.textContent || '').trim()) continue;
                        if (doc.querySelector('[id*="prisoner"], [id*="gefangene"], a[href*="/gefangener/"]') || /arrestant/i.test(doc.getElementById('missing_text')?.textContent || '')) continue;
                        const back = [...doc.querySelectorAll('#mission_vehicle_at_mission tbody tr, #mission_vehicle_driving tbody tr')]
                            .map((tr) => ({ vt: tr.querySelector('a[vehicle_type_id]')?.getAttribute('vehicle_type_id'), a: tr.querySelector('a.btn-backalarm-ajax[href*="/backalarm"]'),
                                name: (tr.querySelector('a[href^="/vehicles/"]')?.textContent || '').trim() }))
                            .filter((x) => x.a && x.vt && !PATIENT_VT.has(x.vt));
                        if (!back.length) continue;
                        for (const x of back) {
                            await fetch(x.a.getAttribute('href'), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
                            await sleep(300);
                        }
                        const name = (doc.getElementById('missionH1')?.textContent || titleOf(e)).replace(/\s+/g, ' ').trim();
                        addLog(name, `klaar op patiënten na: ${back.length} voertuig(en) terug naar post`, 'ok');
                        recordEvent({ kind: 'sendback', id, name, n: back.length, vehicles: back.map((x) => x.name).slice(0, 10) });
                    } catch (err) { ctx.warn('send back', id, err); }
                }
            }

            // Three errors in a row. Windows that do not answer mean a slow or stuck game
            // page (14:46-14:48 three timeouts stopped auto mode for good): reload, and
            // auto mode resumes. More than three such reloads in an hour, or other
            // errors: stop.
            function threeErrors(reason) {
                const KEY = 'mks-auto-dispatch.timeoutReloads';
                let list = [];
                try { list = (JSON.parse(sessionStorage.getItem(KEY) || '[]') || []).filter((t) => Date.now() - t < 3600000); } catch (e) { /* ignore */ }
                if (/reageerde niet/.test(String(reason)) && list.length < 3) {
                    list.push(Date.now());
                    try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
                    addLog('—', '3 keer geen reactie van een venster: pagina ververst, gaat zo verder', 'warn');
                    reloadWhenIdle();
                    return;
                }
                stop('Gestopt na 3 fouten op rij. Zie logboek.');
            }

            // A game page that stays open for hours gets slow and heavy. Reload
            // between two rounds; the session makes auto mode resume afterwards.
            function maybeReload() {
                if (!running || stopped) return;
                const mem = W.performance && W.performance.memory;
                const heavy = !!(mem && mem.jsHeapSizeLimit && mem.usedJSHeapSize > 0.7 * mem.jsHeapSizeLimit);
                const old = ctx.cfg.reloadMin > 0 && Date.now() - loadedAt > ctx.cfg.reloadMin * 60000;
                if (!heavy && !old) return;
                addLog('—', heavy ? 'pagina ververst (geheugen bijna vol), gaat zo verder' : 'pagina ververst, gaat zo verder', 'idle');
                reloadWhenIdle();
            }
            // Never in the middle of a job: the other loop may just be pressing Alarmeren. Both
            // loops stop starting new jobs, and the last one to finish reloads.
            let reloadWanted = false;
            function reloadWhenIdle() {
                reloadWanted = true;
                if (busy || teamBusy) return;
                onPageHide();
                location.reload();
            }

            /* --------------------------------------------------------------------
             * TEAM MISSIONS — after our own missions: one noodhulp to each shared
             * team mission we are not in yet. Joined (sent, or found our own
             * vehicle there) = never looked at again while it is in the list.
             * ------------------------------------------------------------------ */
            // Why no team mission gets a car, in the log at most once per 10 minutes.
            const teamNoted = new Map();
            const teamNote = (text) => {
                if (Date.now() - (teamNoted.get(text) || 0) < 10 * 60000) return;
                teamNoted.set(text, Date.now());
                addLog('Teaminzetten', text, 'idle');
            };
            // Cars either loop sent in the last 2 minutes: vehicle id -> when.
            const recentCars = new Map();
            function avoidCars() {
                const now = Date.now();
                for (const [v, t] of recentCars) if (now - t > 120000) recentCars.delete(v);
                return [...recentCars.keys()];
            }
            // The team loop runs next to cycle(), in its own hidden window, on its own timer.
            let teamBusy = false, teamTimer = null, teamKick = null, teamErrors = 0, teamPauseUntil = 0;
            async function teamCycle() {
                if (!running || stopped || teamBusy || reloadWanted || !ctx.cfg.teamMissions || Date.now() < teamPauseUntil) return;
                teamBusy = true;
                try { await teamRound(); } catch (e) { ctx.err(e); addLog('Teaminzetten', `fout: ${e.message}`, 'error'); } finally { teamBusy = false; saveSession(); }
                if (reloadWanted && !busy) reloadWhenIdle();
            }
            async function teamRound() {
                const entries = [...document.querySelectorAll('#mission_list_alliance .missionSideBarEntry[mission_id]')];
                const live = new Set(entries.map((e) => e.getAttribute('mission_id')));
                for (const id of [...teamDone.keys()]) if (!live.has(id)) teamDone.delete(id);
                if (!entries.length) { teamNote('geen teaminzetten in de lijst'); return; }
                const now = Date.now();
                // Hidden ones too (Teamfilter, mission filters): "Alleen zichtbare inzetten" is for
                // our own missions; team missions are often hidden just to keep the list short.
                let joined = 0;
                const todo = entries.filter((e) => {
                    const id = e.getAttribute('mission_id');
                    if (teamDone.has(id)) { joined++; return false; }
                    const t = tried.get(id);
                    return !t || now - t > ctx.cfg.retryMin * 60000;
                }).sort((a, b) => creditsOf(b) - creditsOf(a));
                if (!todo.length) {
                    if (joined === entries.length) teamNote(`je doet al mee aan alle ${joined} teaminzetten`);
                    return;
                }
                for (const entry of todo) {
                    if (!running || stopped || !ctx.cfg.teamMissions || reloadWanted) return;
                    const hourAgo = Date.now() - 3600000;
                    while (sent.length && sent[0] < hourAgo) sent.shift();
                    if (sent.length + inFlight >= ctx.cfg.maxPerHour) { status(`Maximum van ${ctx.cfg.maxPerHour} per uur bereikt, wacht…`, 'warn'); return; }
                    const id = entry.getAttribute('mission_id');
                    // Ended while the round ran (other players' missions finish all the time).
                    if (!entry.isConnected || !document.getElementById(`mission_${id}`)) continue;
                    const name = `Team: ${titleOf(entry)}`;
                    tried.set(id, Date.now());
                    const res = await runJob({ id, token: Date.now(), team: true, avoid: avoidCars(), me: W.user_id != null ? String(W.user_id) : '' });
                    recordEvent({ kind: 'team', id, name: titleOf(entry), credits: creditsOf(entry), hidden: getComputedStyle(entry).display === 'none' || undefined,
                        result: res.result, km: res.km, reason: res.reason, joined: res.joined || undefined });
                    if (res.result === 'sent') {
                        teamDone.set(id, Date.now());
                        stats.sent++;
                        teamErrors = 0;
                        sent.push(Date.now());
                        addLog(name, `1 ${res.car || 'noodhulp'}, ${Number(res.km).toFixed(1)} km`, 'ok');
                    } else if (res.result === 'unconfirmed') {
                        // Not seen on the mission, so not marked joined. The retry after retryMin
                        // looks for our own vehicle first, so it never sends a second one.
                        teamErrors = 0;
                        addLog(name, `niet bevestigd: 1 ${res.car || 'noodhulp'}, ${Number(res.km).toFixed(1)} km`, 'warn');
                    } else if (res.result === 'skip' && res.joined) {
                        teamDone.set(id, Date.now());
                        addLog(name, `doet al mee (${res.reason})`, 'idle');
                        continue;
                    } else if (res.result === 'skip' && res.noCar) {
                        // No noodhulp free anywhere: the same for every other team mission now.
                        teamErrors = 0;
                        teamNote('geen noodhulp vrij, de teaminzetten volgen later');
                        return;
                    } else if (res.result === 'skip') {
                        teamErrors = 0;
                        addLog(name, `overgeslagen: ${res.reason}`, 'idle');
                    } else {
                        // Errors here pause only the team loop; own missions go on.
                        stats.errors++;
                        addLog(name, `fout: ${res.reason}`, 'error');
                        if (++teamErrors >= 3) {
                            teamErrors = 0;
                            teamPauseUntil = Date.now() + 10 * 60000;
                            addLog('Teaminzetten', '3 fouten op rij: teaminzetten 10 minuten gepauzeerd', 'warn');
                            return;
                        }
                    }
                    await sleep(ctx.cfg.pauseSec * 1000);
                }
            }

            async function cycle() {
                if (!running || busy || stopped) return;
                if (reloadWanted) { reloadWhenIdle(); return; }
                busy = true;
                try {
                    await transports();
                    await sendBackDone();
                    const req = await loadMissions();
                    const list = candidates();
                    const cellRuns = new Map();
                    for (const entry of list) {
                        // A round over many missions takes minutes: answer new
                        // transport requests in between, not only at the start.
                        await transports();
                        if (!running || stopped || reloadWanted) break;
                        const hourAgo = Date.now() - 3600000;
                        while (sent.length && sent[0] < hourAgo) sent.shift();
                        if (sent.length + inFlight >= ctx.cfg.maxPerHour) { status(`Maximum van ${ctx.cfg.maxPerHour} per uur bereikt, wacht…`, 'warn'); break; }

                        const id = entry.getAttribute('mission_id');
                        const name = titleOf(entry);
                        const credits = creditsOf(entry);
                        const lat = Number(entry.getAttribute('latitude')), lon = Number(entry.getAttribute('longitude'));
                        curPos = Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
                        curCredits = credits;
                        tried.set(id, Date.now());
                        const patientText = ctx.cfg.patients ? sidebarPatients(entry) : '';
                        const red = ctx.cfg.topUp && (sidebarMissing(entry) || patientText);
                        const r = req[keyOf(entry)];
                        const p = r ? plan(r) : { slots: {}, vt: {}, vtCaptions: {}, unknown: [] };
                        // With a red box the worker sends only what that box lists, so
                        // unknown full requirements do not matter.
                        if (!r && !red) {
                            stats.skipped++;
                            addNeed('other', 'Onbekend inzettype (inzetgegevens vernieuwen)', 0, id, name);
                            saveNeeds();
                            addLog(name, `overgeslagen: onbekend inzettype ${keyOf(entry)}`, 'warn');
                            continue;
                        }
                        if (p.unknown.length && !red) {
                            stats.skipped++;
                            p.unknown.forEach((u) => addNeed('other', u, 0, id, name));
                            saveNeeds();
                            addLog(name, `overgeslagen: kan niet sturen: ${p.unknown.join(', ')}`, 'warn');
                            continue;
                        }

                        status(`Bezig: ${name}`, 'busy');
                        const res = await runJob({ id, token: Date.now(), slots: p.slots, vt: p.vt, vtCaptions: p.vtCaptions,
                            maxKm: ctx.cfg.maxKm, airKm: ctx.cfg.airKm, needAll: ctx.cfg.needAll, patients: ctx.cfg.patients, patientText, topUp: ctx.cfg.topUp,
                            ignoreShort: String(ctx.cfg.ignoreShort || '').split(',').map((s) => s.trim()).filter(Boolean),
                            bigPatients: Number(ctx.cfg.bigPatients) || 0, reserved: reservedFor(id, credits), ownJobOnly: ownJobOnly(),
                            ovdgFrom: Number(ctx.cfg.ovdgFrom) || 0, avoid: avoidCars(), transport: ctx.cfg.transport, destCost: Number(ctx.cfg.destCost), destKm: Number(ctx.cfg.destKm), ownKm: Number(ctx.cfg.ownKm), release: ctx.cfg.release });
                        // Sent short (needAll off) or skipped: both say what to buy.
                        recordResult(res, id, name);
                        recordEvent({ kind: 'mission', id, name, type: keyOf(entry), credits, pos: curPos, result: res.result, mode: res.mode, n: res.n, km: res.km,
                            reason: res.reason, short: res.shortText ? fewer(res.shortText) : undefined, far: res.farTypes, held: res.held || undefined,
                            ...(res.result === 'skip' && res.want ? { avail: res.avail, want: res.want } : {}) });
                        if (res.mode !== 'cell') updateHold(id, name, credits, res);
                        if (res.mode === 'cell' && (res.result === 'sent' || res.result === 'unconfirmed')) {
                            // More cars with arrestants: the next one in a minute.
                            stats.transports++;
                            errorStreak = 0;
                            tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
                            // Next car with arrestants right away, not next round (a round
                            // can take many minutes). A release frees them all.
                            const runs = (cellRuns.get(id) || 0) + 1;
                            cellRuns.set(id, runs);
                            if (!res.release && runs < 6) list.splice(list.indexOf(entry) + 1, 0, entry);
                            const where = res.release ? res.dest
                                : `naar ${res.dest}${isNaN(res.km) ? '' : `, ${Number(res.km).toFixed(1)} km`}${res.cost ? `, ${res.cost}%` : ''}`;
                            addLog(name, `arrestanten ${res.car}: ${res.result === 'sent' ? '' : '(niet bevestigd) '}${where}`, res.release ? 'warn' : 'ok');
                        } else if (res.result === 'skip' && res.held) {
                            // Not a shortage: the vehicle is there, but kept for a bigger mission.
                            errorStreak = 0;
                            addLog(name, res.reason, 'idle');
                        } else if (res.result === 'sent' || res.result === 'unconfirmed') {
                            stats.sent++;
                            errorStreak = 0;
                            sent.push(Date.now());
                            const verb = res.mode === 'full' ? 'gealarmeerd' : 'bijgestuurd';
                            addLog(name, `${res.result === 'sent' ? verb : `${verb} (niet bevestigd)`}: ${res.n} voertuig(en), verste ${Number(res.km).toFixed(1)} km${res.note ? `, ${res.note}` : ''}${res.short ? `, te weinig: ${res.short}` : ''}`, 'ok');
                        } else if (res.result === 'wait') {
                            // Vehicles still driving: look again in a minute, not after retryMin.
                            tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
                            addLog(name, res.reason, 'idle');
                        } else if (res.result === 'skip') {
                            stats.skipped++;
                            errorStreak = 0;
                            addLog(name, `overgeslagen: ${res.reason}`, 'warn');
                        } else {
                            stats.errors++;
                            addLog(name, `fout: ${res.reason}`, 'error');
                            if (++errorStreak >= 3) { threeErrors(res.reason); break; }
                        }
                        await sleep(ctx.cfg.pauseSec * 1000);
                    }
                    if (running) status();
                } catch (e) {
                    ctx.err(e);
                    stop(`Gestopt: ${e.message}`);
                } finally {
                    busy = false;
                    saveSession();
                }
                maybeReload();
                if (reloadWanted) reloadWhenIdle(); // e.g. after 3 timeouts in this round
            }

            function status(text, tone) {
                const done = `${stats.sent} gealarmeerd, ${stats.transports} vervoerd, ${stats.skipped} overgeslagen`;
                if (!running) ctx.status(text || `Uit. ${done} deze sessie.`, { tone: tone || 'idle' });
                else ctx.status(text || `Actief: ${done}`, { tone: tone || 'ok', dock: true });
                paint();
            }

            function start(resumed) {
                if (running || stopped) return;
                const other = lockHolder();
                if (other) {
                    status('Draait al in een ander tabblad. Stop het daar eerst.', 'warn');
                    if (!resumed) alert('Automatisch alarmeren draait al in een ander tabblad. Stop het daar eerst.');
                    return;
                }
                running = true;
                errorStreak = 0;
                takeLock();
                heartbeat = setInterval(takeLock, 5000);
                addLog('—', resumed ? 'hervat na herladen' : 'gestart', 'ok');
                status();
                cycle();
                timer = setInterval(cycle, ctx.cfg.scanSec * 1000);
                // Team missions side by side with our own, a few seconds later so the two hidden
                // windows do not load at the same moment.
                teamKick = setTimeout(teamCycle, 5000);
                teamTimer = setInterval(teamCycle, ctx.cfg.scanSec * 1000);
            }

            function stop(text) {
                if (!running) return;
                running = false;
                clearInterval(timer);
                clearInterval(teamTimer);
                clearTimeout(teamKick);
                clearInterval(heartbeat);
                releaseLock();
                addLog('—', text || 'gestopt', text ? 'error' : 'idle');
                status(text, text ? 'error' : 'idle');
            }

            // Resume after a reload. Right after a crash the old page's lock can
            // still look alive for up to 15 s, so try a few times.
            function resume(tries = 0) {
                if (stopped || running) return;
                if (lockHolder() && tries < 3) {
                    status('Wacht even om te hervatten…', 'busy');
                    setTimeout(() => resume(tries + 1), 6000);
                    return;
                }
                start(true);
            }

            // Start/stop button in the mission filter bar.
            const row = document.querySelector('.mission-filters-row');
            const btn = document.createElement('a');
            btn.href = '#';
            btn.className = 'btn btn-xs';
            btn.style.marginLeft = '4px';
            btn.onclick = (ev) => {
                ev.preventDefault();
                if (running) stop();
                else if (confirm('Automatisch alarmeren starten?\n\nHet script alarmeert je nieuwe inzetten met echte voertuigen tot je op Stop klikt.')) start();
            };
            if (row) row.appendChild(btn);
            function paint() {
                btn.classList.toggle('btn-danger', running);
                btn.classList.toggle('btn-default', !running);
                btn.innerHTML = running ? `<span class="glyphicon glyphicon-stop"></span> Auto ${stats.sent}` : '<span class="glyphicon glyphicon-play"></span> Auto';
                btn.title = running ? 'Automatisch alarmeren staat aan. Klik om te stoppen.' : 'Automatisch alarmeren starten';
            }

            ctx.actions([
                { label: 'Start', kind: 'primary', run: start,
                    confirm: 'Automatisch alarmeren starten?\n\nHet script alarmeert je nieuwe inzetten met echte voertuigen tot je op Stop klikt.' },
                { label: 'Stop', kind: 'danger', run: () => stop() },
                { label: 'Inzetgegevens vernieuwen', run: async () => {
                    missions = null;
                    GM_deleteValue(DATA_KEY);
                    try { await loadMissions(); status(); } catch (e) { status(`Mislukt: ${e.message}`, 'error'); }
                } },
                { label: 'Tekortlijst kopiëren', run: async () => {
                    const rows = (b) => sorted(b).map(([n, t]) => `${n}\t${t.missions}\t${t.short}\t${t.far}\t${t.units}\t${t.example}`);
                    const text = ['Voertuig\tInzetten\tNiet beschikbaar\tTe ver\tEenheden\tLaatste inzet', ...rows(needs.types),
                        '', 'Kan script niet sturen\tInzetten', ...sorted(needs.other).map(([n, t]) => `${n}\t${t.missions}`)].join('\n');
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
                { label: 'Tekortlijst wissen', kind: 'danger', run: () => {
                    needs = { since: Date.now(), types: {}, other: {} };
                    saveNeeds();
                    ctx.refresh();
                }, confirm: 'De tekortlijst leegmaken en opnieuw beginnen met tellen?' },
            ]);
            ctx.menu({ icon: '🤖', label: 'Automatisch alarmeren', title: 'Start of stop', run: () => (running ? stop() : ctx.open()) });

            const sorted = (bucket) => Object.entries(bucket).sort((a, b) => b[1].missions - a[1].missions || b[1].last - a[1].last);
            const ago = (t) => {
                const m = Math.round((Date.now() - t) / 60000);
                return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} uur` : `${Math.round(m / 1440)} d`;
            };

            ctx.panel((el) => {
                const esc = ctx.esc;
                const tone = { ok: 't-ok', warn: 't-warn', error: 't-error', idle: '' };
                const types = sorted(needs.types);
                const other = sorted(needs.other);
                const now = Date.now();
                const live = [...holds].filter(([, h]) => h.until > now).sort((a, b) => b[1].credits - a[1].credits);
                const holdHtml = live.length ? `<h4 class="mks-h">Bewaard voor grote inzetten</h4>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Inzet</th><th>Credits</th><th>Bewaard</th><th>Nog</th></tr></thead><tbody>
                    ${live.map(([, h]) => `<tr><td>${esc(h.name)}</td><td class="mono">${ctx.nl(h.credits)}</td><td>${esc(Object.values(h.keys).map((v) => `${v.need}× ${v.cap}`).join(', '))}</td>
                        <td class="mono mks-dim">${Math.ceil((h.until - now) / 60000)} min</td></tr>`).join('')}</tbody></table></div>` : '';
                el.innerHTML = `<div class="mks-tiles">
                        <div class="mks-tile"><div class="v">${stats.sent}</div><div class="k">gealarmeerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.transports}</div><div class="k">vervoerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.skipped}</div><div class="k">overgeslagen</div></div>
                        <div class="mks-tile ${stats.errors ? 't-error' : ''}"><div class="v">${stats.errors}</div><div class="k">fouten</div></div>
                    </div>
                    ${holdHtml}
                    <h4 class="mks-h">Tekort per voertuigtype</h4>
                    <p class="mks-note">Sinds ${new Date(needs.since).toLocaleDateString('nl-NL')}. Elke inzet telt één keer per type.
                        <b>Niet beschikbaar</b>: het spel had er niet genoeg vrij (de andere gingen wel). <b>Te ver</b>: alleen verder dan ${ctx.cfg.maxKm} km (helikopters ${ctx.cfg.airKm} km).
                        Bovenaan staat wat je het vaakst mist: daar heb je er meer van nodig (of dichterbij).</p>
                    ${types.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Voertuig</th><th>Inzetten</th>
                        <th>Niet beschikbaar</th><th>Te ver</th><th>Eenheden</th><th>Laatst</th></tr></thead><tbody>
                        ${types.map(([n, t]) => `<tr title="${esc(`Laatste inzet: ${t.example}`)}"><td>${esc(n)}</td><td class="mono"><b>${t.missions}</b></td>
                            <td class="mono">${t.short || ''}</td><td class="mono">${t.far || ''}</td><td class="mono">${t.units || ''}</td>
                            <td class="mono mks-dim">${ago(t.last)}</td></tr>`).join('')}</tbody></table></div>`
                        : '<p class="mks-note">Nog geen tekorten geteld.</p>'}
                    ${other.length ? `<h4 class="mks-h">Kan het script niet sturen</h4>
                        <p class="mks-note">Eisen die dit script (nog) niet kan vervullen. Deze inzetten moet je zelf alarmeren.</p>
                        <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Eis</th><th>Inzetten</th><th>Laatst</th></tr></thead><tbody>
                        ${other.map(([n, t]) => `<tr title="${esc(`Laatste inzet: ${t.example}`)}"><td>${esc(n)}</td><td class="mono"><b>${t.missions}</b></td>
                            <td class="mono mks-dim">${ago(t.last)}</td></tr>`).join('')}</tbody></table></div>` : ''}
                    ${log.length ? `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                        ${log.map((l) => `<tr><td class="mono">${l.at.toLocaleTimeString('nl-NL')}</td><td>${esc(l.name)}</td>
                        <td><span class="mks-pill ${tone[l.tone] || ''}">${esc(l.text)}</span></td></tr>`).join('')}</tbody></table></div>`
                        : '<p class="mks-note">Nog niets gedaan. Klik op Start of op de knop <b>Auto</b> in de missiefilterbalk.</p>'}`;
            });

            ctx.onSettings((cfg, key) => {
                // key null = settings reset to defaults.
                if ((key === 'scanSec' || key == null) && running) {
                    clearInterval(timer);
                    timer = setInterval(cycle, ctx.cfg.scanSec * 1000);
                    clearInterval(teamTimer);
                    teamTimer = setInterval(teamCycle, ctx.cfg.scanSec * 1000);
                }
            });
            status();
            if (saved.running) resume();

            return {
                stop() {
                    // Turning the module off ends the session: no resume after a reload.
                    stopped = true;
                    running = false;
                    clearInterval(timer);
                    clearInterval(teamTimer);
                    clearTimeout(teamKick);
                    clearInterval(heartbeat);
                    saveSession();
                    releaseLock();
                    window.removeEventListener('pagehide', onPageHide);
                    btn.remove();
                    document.querySelectorAll('iframe').forEach((f) => { if (f.name.startsWith(WORKER)) f.remove(); });
                },
            };
        }
    },
});

/* ==== module: auto-expand ================================================= */
MKS.module({
    id: 'auto-expand',
    name: 'Automatisch uitbreiden',
    short: 'Uitbreiden',
    icon: '🏗️',
    category: 'auto',
    description: 'Geeft je credits uit aan wat Automatisch alarmeren tekortkomt: eerst speciale voertuigen, daarna gewone. '
        + 'Koopt voertuigen in het gebouw dat het dichtst bij de inzetten ligt waar ze misten, koopt daarvoor de nodige uitbreiding '
        + 'of een hoger level als de parkeerplaatsen vol zijn, en bouwt een nieuw gebouw op een echte post (Plaatsingsadvies) als er '
        + 'in de buurt geen geschikt gebouw is. Ook: ziekenhuisafdelingen en cellen die tekortkwamen, en personeelswerving op '
        + 'automatisch met doel 300 in elk gebouw. Koopt nooit een voertuig zonder opgeleid personeel ervoor, '
        + 'betaalt nooit met coins en houdt altijd je buffer over. Eén aankoop tegelijk.',
    tagline: 'Gebruikt de tekortlijst van Automatisch alarmeren',
    warning: '<b>Dit geeft je credits uit, zonder dat jij elke aankoop ziet.</b> Gebouwen, uitbreidingen, levels en voertuigen '
        + 'kosten veel en zijn niet terug te draaien. Het houdt altijd de buffer over (standaard 100.000, nooit minder) en betaalt nooit met coins. '
        + 'Elke aankoop staat in het logboek. Automatisch spelen kan tegen de spelregels zijn; je account is je eigen risico.',
    confirmOn: 'Let op: deze module koopt automatisch gebouwen, uitbreidingen, levels en voertuigen met je credits.\n\n'
        + 'Dat kan niet ongedaan worden gemaakt. Het houdt je buffer over en gebruikt nooit coins.\n\nAanzetten?',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Op de kaartpagina',
    live: true,
    settings: [
        // Same keys as before, so saved values stay; only order, groups and texts changed.
        { group: 'Geld', key: 'buffer', label: 'Buffer (nooit uitgeven)', type: 'number', default: 100000, min: 100000, max: 100000000, step: 50000, unit: 'credits',
            help: 'Zoveel blijft altijd staan. Minimaal 100.000.' },
        { group: 'Geld', key: 'intervalMin', label: 'Eén aankoop per', type: 'number', default: 3, min: 1, max: 120, step: 1, unit: 'min' },

        { group: 'Wat het mag kopen', key: 'doVehicles', label: 'Voertuigen', type: 'bool', default: true },
        { group: 'Wat het mag kopen', key: 'doExtensions', label: 'Uitbreidingen', type: 'bool', default: true },
        { group: 'Wat het mag kopen', key: 'doLevels', label: 'Levels en kleine posten vergroten', type: 'bool', default: true,
            help: 'Meer parkeerplaatsen. Een kleine post wordt een gewone post (24 uur) als hij vol is, '
                + 'of als een uitbreiding daar niet lukte omdat hij klein is.' },
        { group: 'Wat het mag kopen', key: 'doBuild', label: 'Nieuwe gebouwen', type: 'bool', default: true,
            help: 'Op een echte post (Plaatsingsadvies): voor tekorten als er in de buurt geen geschikt gebouw is, en om te groeien. '
                + 'Uit = nooit een nieuw gebouw, behalve in Bouwmodus.' },

        { group: 'Groeien', key: 'doGrow', label: 'Nieuwe posten in lege gebieden', type: 'bool', default: true,
            help: 'Een brandweerkazerne, politiebureau of ambulancepost op de vrije echte post die het dichtst bij je gebouwen ligt '
                + '(minstens 3 km van je andere van die soort). Meer gebouwen = meer inzetten. Waarde = je gemiddelde weekinkomen per gebouw. '
                + 'Alleen als "Nieuwe gebouwen" aan staat.' },
        { group: 'Groeien', key: 'buildMode', label: 'Bouwmodus: vooral nieuwe posten', type: 'bool', default: false,
            help: 'Bouwt de ene nieuwe post na de andere, zodra er geld is (brandweer, politie en ambulance om de beurt), en maakt elke post af: '
                + 'brandweer level 2 met een TST 4/5, ambulancepost level 1 met een ambulance, politie met noodhulp; de rest van de plekken '
                + 'naar het grootste tekort dat er past. Tekorten en opleidingen wachten zolang. Werkt ook als "Nieuwe gebouwen" uit staat.' },
        { group: 'Groeien', key: 'buildCity', label: 'Bouwmodus: stad', type: 'text', default: '', placeholder: 'bijv. Utrecht',
            help: 'Leeg = overal. Met een stad: eerst alle vrije echte posten in die stad, het dichtst bij het centrum eerst. '
                + 'Is de stad vol, dan gaat het verder rond je andere gebouwen.' },

        { group: 'Personeel', key: 'doHire', label: 'Werving op automatisch zetten', type: 'bool', default: true },
        { group: 'Personeel', key: 'hireTarget', label: 'Doel per gebouw', type: 'number', default: 300, min: 0, max: 1000, step: 10, unit: 'mensen' },

        { advanced: true, key: 'minMissions', label: 'Pas kopen na zoveel gemiste inzetten', type: 'number', default: 2, min: 1, max: 50, step: 1,
            help: 'Een voertuigsoort komt pas in aanmerking als die zo vaak in de tekortlijst van Automatisch alarmeren staat.' },
        { advanced: true, key: 'specialWeight', label: 'Voorrang speciale voertuigen', type: 'number', default: 3, min: 1, max: 10, step: 1,
            help: 'Zoveel keer zwaarder dan tankautospuiten, ambulances en noodhulp, bij hetzelfde aantal gemiste inzetten.' },
        { advanced: true, key: 'unlockWeight', label: 'Nieuwe meldingen: keer per week', type: 'number', default: 1, min: 0, max: 20, step: 0.5,
            help: 'Een gebouw of uitbreiding die nieuwe meldingsoorten vrijspeelt telt hun gemiddelde credits zoveel keer per week. 0 = niet.' },
        { advanced: true, key: 'nearKm', label: 'Gebouw telt als "in de buurt" tot', type: 'number', default: 15, min: 2, max: 100, step: 1, unit: 'km',
            help: 'Van het midden van de inzetten waar het voertuig miste. Verder weg: een nieuw gebouw (als dat mag).' },
        { advanced: true, key: 'planDepth', label: 'Opties vergelijken per stap', type: 'number', default: 6, min: 1, max: 15, step: 1,
            help: 'Zoveel van de waardevolste tekorten worden uitgewerkt; de stap met de meeste credits per uitgegeven credit wint.' },
        { advanced: true, key: 'groupMax', label: 'Gebouwen per opleiding', type: 'number', default: 5, min: 1, max: 10, step: 1,
            help: 'Eén opleiding kan meerdere gebouwen tegelijk een voertuig geven: de gebouwen die het dichtst liggen bij de meeste plekken waar het miste.' },
        { advanced: true, key: 'trainSeats', label: 'Plaatsen per opleiding', type: 'number', default: 10, min: 1, max: 10, step: 1,
            help: 'Eerst personeel van de gebouwen die het voertuig krijgen. Een klas start pas met alle plaatsen bezet: de rest gaat naar vrij personeel '
                + 'van gebouwen die dat voertuig kunnen hebben (dichtstbij eerst), daarna van andere gebouwen.' },
    ],

    run(ctx) {
        const W = ctx.W;
        const esc = ctx.esc;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
        const NEEDS_KEY = 'mks.autoDispatch.needs.v1';
        const STATE_KEY = 'mks.autoExpand.state.v1';
        const LOCK_KEY = 'mks-auto-expand.lock';
        const DATA_BASE = 'https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/data/posts/';
        const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const STARTED = Date.now();

        /* ========================================================================
         * VEHICLE TYPES (LSSM data): id: [name, credits, min crew, building types,
         * training, rule, max crew]. rule "all" = the whole crew needs that training. "?" =
         * the training is not known: such a vehicle is never bought.
         * ==================================================================== */
        const VT = {
            0: ["SI-2", 5000, 1, [0,17], null, null, 2], 1: ["TS 8/9", 5000, 1, [0,17], null, null, 9],
            2: ["Autoladder", 10000, 1, [0,17], null, null, 3], 3: ["DA - Officier van Dienst", 10000, 1, [0,17], null, null, 1],
            4: ["Hulpverleningsvoertuig", 12180, 1, [0,17], null, null, 3],
            5: ["Adembeschermingsvoertuig", 11680, 1, [0,17], null, null, 3], 6: ["TST 8/9", 5000, 1, [0,17], null, null, 9],
            7: ["TST 6/7", 5000, 1, [0,17], null, null, 7], 8: ["TST 4/5", 5000, 1, [0,17], null, null, 5],
            9: ["TS 4/5", 5000, 1, [0,17], null, null, 5], 10: ["Slangenwagen", 17300, 1, [0,17], null, null, 9],
            11: ["Verkenningseenheid Brandweer", 18300, 1, [0,17], "Verkenningseenheid Brandweer", "all", 4],
            12: ["TST-NB 8/9", 5000, 1, [0,17], null, null, 9], 14: ["TST-NB 6/7", 5000, 1, [0,17], null, null, 7],
            15: ["TST-NB 4/5", 5000, 1, [0,17], null, null, 5], 16: ["Ambulance", 5000, 1, [0,3,13,17], null, null, 2],
            17: ["TS 6/7", 5000, 1, [0,17], null, null, 7], 18: ["Hoogwerker", 10000, 1, [0,17], null, null, 3],
            19: ["DA - Hoofdofficier van Dienst", 25500, 1, [0,17], "Hoofd Officier van Dienst - Brandweer", "all", 1],
            20: ["DA", 2000, 1, [0,17], null, null, 4], 21: ["DB Klein", 2500, 1, [0,17], null, null, 9],
            22: ["DA Noodhulp", 5000, 1, [5,18], null, null, 2], 23: ["Lifeliner", 500000, 1, [6], "MMT-Bemanningslid", "all", 4],
            24: ["DA - Adviseur Gevaarlijke stoffen", 19200, 1, [0,17], "Adviseur Gevaarlijke Stoffen", "all", 2],
            25: ["DB Noodhulp", 6000, 1, [5,18], null, null, 2],
            26: ["Haakarmvoertuig", 5000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            27: ["Adembeschermingshaakarmbak", 6000, 0, [0,17], null, null, 0],
            28: ["Politiehelikopter", 300000, 1, [9], "Politiehelikopter", "all", 3],
            29: ["Watertankhaakarmbak", 6000, 0, [0,17], null, null, 0], 30: ["Zorgambulance", 5000, 1, [0,3,13,17], null, null, 2],
            31: ["Commandovoertuig", 27500, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            32: ["Commandohaakarmbak", 6000, 0, [0,17], null, null, 0],
            33: ["Waterongevallenvoertuig", 10000, 4, [0,17], "Duiker/Duikploegleider", "all", 6],
            34: ["Watertankwagen", 17000, 1, [0,17], null, null, 3],
            35: ["Officier van Dienst - Politie", 10000, 1, [11], "Officier van Dienst - Politie", "all", 1],
            36: ["Waterongevallenaanhanger", 9000, 0, [0,17], null, null, 0],
            37: ["MMT-Auto", 30000, 1, [6], "MMT-Bemanningslid", "all", 4],
            38: ["Officier van Dienst - Geneeskunde", 25000, 1, [3,6,13], "Officier van Dienst Geneeskunde", "all", 1],
            39: ["ME Commandovoertuig", 10000, 2, [11], "Mobiele Eenheid", "all", 4],
            40: ["ME Flexbus", 10000, 4, [11], "Mobiele Eenheid", "all", 8],
            41: ["Crashtender (8x8)", 60000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            42: ["Crashtender (6x6)", 40000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            43: ["Crashtender (4x4)", 15000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            44: ["Airport Fire Officer / On Scene Commander", 12000, 1, [0,17], "Airport Fire Officer / On Scene Commander", "all", 2],
            45: ["Dompelpomphaakarmbak", 6000, 0, [0,17], null, null, 0], 46: ["DM-Politie", 15000, 1, [5,18], "Motoragent", "all", 1],
            47: ["DA Hondengeleider", 8000, 1, [11], "Hondengeleider", "all", 2],
            48: ["DB Hondengeleider", 10000, 1, [11], "Hondengeleider", "all", 2],
            49: ["PM-OR", 10000, 4, [0,17], "Oppervlakteredder", "all", 9],
            50: ["TS-OR", 10000, 4, [0,17], "Oppervlakteredder", "all", 9],
            51: ["HulpverleningsHaakarmbak", 6000, 0, [0,17], null, null, 0],
            52: ["Rapid Responder", 2500, 1, [0,3,13,17], null, null, 1],
            53: ["AT-Commandant", 10000, 1, [11], "Operator AT", "all", 2],
            54: ["AT-Operator", 10000, 2, [11], "Operator AT", "all", 4],
            55: ["AT-Materiaalwagen", 15000, 1, [11], "Operator AT", "all", 2],
            56: ["DA Voorlichter", 15000, 1, [0,17], "Voorlichter", "all", 1],
            57: ["DA Officier van Dienst - Geneeskundig / Rapid Responder", 25000, 1, [3,6,13], "Officier van Dienst Geneeskunde", "all", 1],
            58: ["DB Arrestantenvervoer", 20000, 1, [11], null, null, 2],
            59: ["Noodhulp - Onopvallend", 6000, 1, [5,18], null, null, 2], 60: ["DB Biketeam", 8000, 1, [5,18], "Biketeam", "all", 2],
            61: ["Slangenhaakarmbak", 6000, 0, [0,17], null, null, 0], 62: ["TS-HV", 20000, 3, [0,17], null, null, 7],
            63: ["DM - Rapid Responder", 2500, 1, [0,3,13,17], null, null, 1],
            64: ["ME Aanhoudingseenheid", 20000, 6, [11], "ME - Aanhoudingseenheid", "all", 8],
            65: ["DA Terreinwaardig - Reddingsbrigade", 7500, 2, [16], "Waterredding", "all", 4],
            66: ["Kusthulpverleningsvoertuig", 8000, 2, [16], "Waterredding", "all", 6],
            67: ["Bootaanhanger Reddingsbrigade", 5000, 0, [16], null, null, 0],
            68: ["SB", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3], 69: ["SBH", 10000, 0, [0,17], null, null, 0],
            70: ["SBA", 15000, 0, [0,17], null, null, 0], 71: ["MSA", 10000, 0, [0,17], null, null, 0],
            72: ["DPA", 15000, 0, [0,17], null, null, 0],
            73: ["Vrachtwagen - Bereden Brigade", 35000, 1, [11], "Bereden Brigade", "all", 4],
            74: ["Bereden Brigade Aanhanger", 15000, 0, [11], "Bereden Brigade", "all", 0],
            75: ["Dienstauto terreinvaardig - Noodhulp", 10000, 1, [11], null, null, 2],
            76: ["Quad", 5000, 1, [16], "Waterredding", "all", 1], 77: ["KW-boot", 50000, 2, [19], "Groot vaarbewijs", 1, 6],
            78: ["RB-K", 35000, 2, [16,19], "Groot vaarbewijs", "all", 4],
            79: ["RB-G", 45000, 2, [16,19], "Groot vaarbewijs", "all", 6],
            80: ["SAR-heli", 300000, 2, [21], "SAR Helicopter", "all", 3], 81: ["DA-RWS", 25000, 1, [22], "Weginspecteur", "all", 2],
            82: ["DM-RWS", 15000, 1, [22], "Weginspecteur", "all", 1], 83: ["DA-SIG", 25000, 1, [0,17], "Weginspecteur", "all", 2],
            84: ["Waterwerper", 50000, 4, [11], "ME - Waterwerper", "all", 4],
            85: ["FBO-Heli", 300000, 2, [23], "Fire Bucket Operator", "all", 3],
            86: ["DB-Handcrew", 30000, 7, [0,17], "Handcrew", "all", 9],
            87: ["DA-LA-NB", 30000, 1, [0,17], "Landelijk Adviseur Natuurbranden", "all", 1],
            88: ["VW-NB", 12000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 2], 89: ["NBH", 12000, 0, [0,17], null, null, 0],
            90: ["TS-STH", 25000, 7, [0,17], "Teamleider STH", 2, 7], 91: ["HVH-STH", 6000, 0, [0,17], null, null, 0],
            92: ["DB-USAR", 8000, 5, [0,17], "Teamlid USAR", "all", 9], 93: ["TS-USAR", 10000, 4, [0,17], "Teamlid USAR", "all", 9],
            94: ["VW-USAR", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 2],
            95: ["DM-USAR", 5000, 1, [0,17], "Teamlid USAR", "all", 1], 96: ["Quad-USAR", 5000, 1, [0,17], "Teamlid USAR", "all", 2],
            97: ["DB–Speurhonden", 10000, 2, [0,17], "Hondengeleider USAR", "all", 4],
            98: ["SIV-P", 35000, 1, [5,18], "Chauffeur Dienst Infra", "all", 2],
            99: ["DB-VOA", 50000, 1, [5,18], "Verkeersongevallen Analist", "all", 2],
            100: ["GGB", 45000, 6, [0,3,13], "Geneeskundige bijstandsverlener", "all", 6],
            101: ["NHT", 15000, 4, [0,3,13], "Noodhulpteam", "all", 8], 102: ["MC-Ambulance", 5000, 2, [3,13], null, null, 2],
            103: ["MICU", 30000, 3, [3,13], "Intensive Care Team", "all", 3],
            104: ["Berger-K", 25000, 1, [24], "Berger Training", "all", 2],
            105: ["Berger-G", 50000, 1, [24], "Berger Training", "all", 2],
            106: ["Berger-K (RWS)", 25000, 1, [22], "Berger Training", "all", 2],
            107: ["Berger-G (RWS)", 50000, 1, [22], "Berger Training", "all", 2],
            108: ["Berger-K (Politie)", 25000, 1, [5,18], "Berger Training", "all", 2],
            109: ["Berger-G (Politie)", 50000, 1, [5], "Berger Training", "all", 2],
            110: ["DAT-KMAR", 10000, 1, [25], "Marechaussee", "all", 2], 111: ["DB-KMAR", 10000, 1, [25], "Marechaussee", "all", 2],
            112: ["DM-KMAR", 10000, 1, [25], "Marechaussee", "all", 1], 113: ["DAT-EOD", 40000, 1, [25], "Bomontmanteling", "all", 2],
            114: ["DB-EOD", 45000, 2, [25], "Bomontmanteling", "all", 2], 115: ["VW-EOD", 45000, 2, [25], "Bomontmanteling", "all", 2],
            116: ["DB-Explosievenhonden", 40000, 2, [25], "Hondengeleider EOD", "all", 2],
            117: ["DB-Explosievenduikers", 30000, 2, [25], "Duiker Defensie", "all", 2], 118: ["BA-DDG", 15000, 0, [25], null, null, 0],
            119: ["DB-TEV", 25000, 1, [5,18], "Bomverkenner", "all", 1], 120: ["DB-VZ", 12000, 2, [0,17], "Verzorger", "all", 4],
            121: ["VZH", 12000, 0, [0,17], null, null, 0], 122: ["DB-AH", 12000, 2, [0,17], "Hygiënemedewerker", "all", 4],
            123: ["VZH-AH", 12000, 0, [0,17], null, null, 0],
            124: ["DB-PC-LOG", 40000, 1, [0,17], "Pelotonscommandant Logistiek", "all", 1],
            125: ["DB-LOG", 10000, 1, [0,17], null, null, 3], 126: ["VW-LOG", 15000, 1, [0,17], null, null, 3],
            127: ["BMH-LOG", 6000, 0, [0,17], null, null, 0], 128: ["DB-DRONE", 60000, 3, [11], "Drone Flightcrew", "all", 3],
            129: ["DB-TDV", 60000, 3, [0,17], "TDV Drone Flightcrew", "all", 3],
            130: ["SB-BA", 45000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            131: ["SB-IB", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            132: ["AS", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            133: ["TS-IB", 35000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 7], 134: ["GSH", 12000, 0, [0,17], null, null, 0],
            135: ["DB-GS", 35000, 4, [0,17], "Gevaarlijke Stoffen Eenheid", "all", 6], 136: ["GPH", 12000, 0, [0,17], null, null, 0],
            137: ["DB-GP", 35000, 4, [0,17], "Gevaarlijke Stoffen Eenheid", "all", 6], 138: ["BOH-DC", 35000, 0, [0,17], null, null, 0],
            139: ["TS-BO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 7],
            140: ["DB-BO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 8], 141: ["GOH-DC", 35000, 0, [0,17], null, null, 0],
            142: ["TS-GO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 7],
            143: ["DB-GO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 8],
            144: ["DB-ICB", 12000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            145: ["OvD-ICB", 25000, 1, [0,17,27], "Officier van Dienst Incidentenbestrijder spoor", "all", 1],
            146: ["VW-VZ-ICB", 15000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            147: ["HA-ICB", 6000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            148: ["GM-ICB", 6000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            149: ["HSH-ICB", 10000, 1, [0,17,27], null, null, 2],
            150: ["VW-HS", 15000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            151: ["BM-VTHS", 40000, 2, [0,17], null, null, 8],
            152: ["TS-Spoor", 25000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            153: ["DB-RI", 25000, 2, [0,17], "?", "all", 6], 154: ["RIA", 6000, 0, [0,17], null, null, 0],
            155: ["DB-VI", 25000, 4, [0,17], "?", "all", 6], 156: ["VIA", 6000, 0, [0,17], null, null, 0],
        };
        // Plain vehicles: fire engines, ambulances, police cars. Specialist ones weigh more.
        const PLAIN = new Set([0, 1, 6, 7, 8, 9, 12, 14, 15, 17, 16, 22, 25, 59, 75, 20, 21]);
        const norm = (s) => String(s).toLowerCase().replace(/\s+[-–]\s+/g, ' ').replace(/\s+/g, ' ').replace(/^(een|elke)\s+/, '').trim();
        // Names the game uses in shortages ("Niet beschikbaar: 1 X") and row captions -> type to buy.
        const ALIAS = {
            'tankautospuit': 1, 'tankautospuiten': 1, 'ts': 1, 'officier van dienst brandweer': 3, 'da-ovd': 3, 'ovd-b': 3,
            'hoofdofficier van dienst brandweer': 19, 'hoofd officier van dienst': 19, 'da-hod': 19, 'hovd': 19,
            'commandovoertuig of haakarmbak': 31, 'commandowagen': 31, 'co': 31, 'redvoertuig': 18, 'hw': 18, 'al': 2,
            'hv of ts-hv': 4, 'hv': 4, 'hulpverleningsvoertuig': 4, 'slangenwagen': 10, 'sl': 10, 'wt': 34,
            'adembeschermingsvoertuig of haakarmbak': 5, 'ab': 5, 'dienstbus verkenningseenheid brandweer': 11, 'verkenningseenheid': 11, 'db-veb': 11,
            'adviseur gevaarlijke stoffen': 24, 'da-ags': 24, 'voorlichters': 56, 'voorlichter': 56, 'da-vl': 56,
            'ambulance voertuigen': 16, 'ambulance': 16, 'amb': 16, 'noodhulpeenheden': 22, 'noodhulpeenheid': 22, 'nh': 22, 'da noodhulp': 22,
            'officier van dienst politie': 35, 'ovd-p': 35, 'politiehelikopter': 28, 'kmar eenheden': 110, 'kmar eenheid': 110,
            'db-bike': 60, 'biketeam': 60, 'dm-p': 46, 'police horses': 73, 'vw-bb of bb-a': 73, 'hondengeleider': 47, 'me flexbus': 40,
            'me commandovoertuig': 39, 'aanhoudingseenheid': 64, 'dienstbus arrestantenvervoer': 58, 'db-av': 58, 'db arrestantenvervoer': 58,
            'ovd-g': 38, 'officier van dienst geneeskunde': 38, 'mmt-auto of lifeliner': 37, 'ggb': 100, 'nht': 101,
            'verzorgingseenheid': 120, 'verzorger': 120, 'signalisatie voertuig (da-rws, da-sig of dm-rws)': 83,
            'signalisatie voertuigen': 83, 'signalisatievoertuig': 83, 'tankautospuiten (terreinvaardig)': 6, 'schuimblusvoertuig': 130,
            'me flexbussen': 40, 'natuurbrandbestrijding uitrusting': 88, 'natuurbrandbestrijding vrachtwagen of haakarmbak': 88, 'bootaanhanger (woa of ba-rb)': 67, 'at materiaalwagens': 55,
            'strandvoertuigen (quad, dat-rb of khv)': 65, 'bereden brigade (paarden)': 73, 'politie helikopters': 28, 'politie helikopter': 28,
            'dienstvoertuigen usar': 92, 'politie noodhulp': 22, 'me-ae': 64, 'vw-bb': 73, 'bb-a': 74,
        };
        const BY_NAME = {};
        for (const [id, v] of Object.entries(VT)) BY_NAME[norm(v[0])] = Number(id);
        // Shortage name -> every vehicle type it can mean, in order. "DB-RI of RIA" and
        // "DB-GO, TS-GO of GOH-DC" name alternatives; "Een Berger-K" also matches the
        // variants "Berger-K (RWS)" and "Berger-K (Politie)". planVehicle picks the one
        // the player has a building for.
        const STOP = new Set(['politie', 'brandweer', 'voertuig', 'eenheid', 'of', 'en', 'een', 'de', 'het', 'van']);
        const singular = (w) => w.replace(/heden$/, 'heid').replace(/'s$/, '').replace(/(?<=[a-z]{3})(en|s)$/, '');
        function vehiclesFor(name) {
            const out = [];
            const add = (id) => { if (id != null && !out.includes(id)) out.push(id); };
            const n = norm(name).replace(/\(s\)/g, '');
            const parts = [n, ...n.split(/,\s*|\s+of\s+|\s*\/\s*/).map((x) => x.trim())];
            for (const p of parts) {
                // Plurals as the red box writes them: "Redvoertuigen", "Officiers van
                // dienst politie", "Aanhoudingseenheden": each word singular in turn, then all.
                const ws = p.split(' ');
                const forms = [p, ...ws.map((w, i) => ws.map((x, k) => (k === i ? singular(x) : x)).join(' ')), ws.map(singular).join(' ')];
                for (const a of forms) {
                    add(ALIAS[a]);
                    add(BY_NAME[a]);
                    for (const [cap, id] of Object.entries(BY_NAME)) if (cap.startsWith(`${a} (`)) add(id);
                }
            }
            if (!out.length) {
                // Names the game makes up for a requirement ("Politie Noodhulp"): every
                // vehicle whose name has all the meaningful words, cheapest kind first.
                const words = n.split(/[\s,/()]+/).map(singular).filter((w) => w.length >= 2 && !STOP.has(w));
                if (words.length) {
                    for (const [cap, id] of Object.entries(BY_NAME)) {
                        const capWords = cap.split(/[\s,/()-]+/).map(singular);
                        if (words.every((w) => capWords.includes(w))) add(id);
                    }
                    out.sort((a, b) => a - b);
                }
            }
            return out;
        }
        // Does an extension row ("Voertuigen: DB-RI en RIA ...") unlock this type?
        function unlocks(text, vt) {
            const t = ` ${String(text).toLowerCase().replace(/[,.;:()]/g, ' ').replace(/\s+/g, ' ')} `;
            const names = [VT[vt][0], ...Object.entries(ALIAS).filter(([, id]) => id === vt).map(([k]) => k)]
                .map((x) => x.toLowerCase()).filter((x) => x.length >= 3);
            return names.some((x) => t.includes(` ${x} `));
        }

        /* ========================================================================
         * STATE — log, cooldowns and spending, kept across reloads.
         * ==================================================================== */
        let state;
        try { state = JSON.parse(GM_getValue(STATE_KEY, 'null')); } catch (e) { state = null; }
        state = state || {};
        state.log = state.log || [];
        state.cool = state.cool || {};
        // Growth used to wait 2 hours per kind; drop those waits (a failed build still waits 1 hour).
        for (const k of Object.keys(state.cool)) if (k.startsWith('Groei:') && state.cool[k] > Date.now() + 61 * 60000) delete state.cool[k];
        state.spent = state.spent || {};
        state.wishes = state.wishes || {};
        const save = () => { try { GM_setValue(STATE_KEY, JSON.stringify(state)); } catch (e) { ctx.warn('state not saved', e); } };
        function addLog(text, tone = 'ok', cost = 0) {
            state.log.unshift({ at: Date.now(), text, tone, cost });
            if (state.log.length > 300) state.log.length = 300;
            if (cost) {
                const day = new Date().toISOString().slice(0, 10);
                state.spent[day] = (state.spent[day] || 0) + cost;
            }
            save();
            ctx.refresh();
        }
        let next = null;        // what it wants to do now, for the panel
        let ranking = [];       // the planned options this round, best return first
        let unlocksAt = 0;
        let skipped = [];       // why other needs were passed over this round
        let failStreak = 0;
        let lastSaid = ''; // the game's message after the last purchase
        let stopped = false;
        let busy = false;
        W.mksAutoExpand = {
            get state() { return state; }, get next() { return next; }, get skipped() { return skipped; },
            get ranking() { return ranking.map(({ run, check, ...r }) => r); }, get unlocks() { return unlocks7d; },
        };

        /* ========================================================================
         * GAME ACCESS — credits only: every buying URL is checked for "coins".
         * ==================================================================== */
        const token = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
        async function getDoc(url) {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error(`${url}: ${r.status}`);
            return new DOMParser().parseFromString(await r.text(), 'text/html');
        }
        const api = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
        function creditsOnly(url) {
            if (/coins/i.test(url)) throw new Error(`weigert coins-link: ${url}`);
            return url;
        }
        async function hit(url, post) {
            creditsOnly(url);
            const opts = { credentials: 'same-origin' };
            if (post) {
                opts.method = 'POST';
                opts.headers = { 'X-CSRF-Token': token() };
                opts.body = post === true ? new URLSearchParams({ authenticity_token: token() }) : post;
            }
            const r = await fetch(url, opts);
            if (!r.ok) throw new Error(`${url}: ${r.status}`);
            return r;
        }
        const km = (a, b) => {
            const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
            const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(x));
        };
        const posOf = (b) => [Number(b.latitude), Number(b.longitude)];
        // Brandweerkazerne (klein) and Politieopkomstbureau (klein): the API lists them as the
        // normal kind with small_building set. Some extensions cannot be built there: the
        // game refuses the purchase until the station is upgraded to a full one (24 hours).
        // Extensions are tried as usual; only when one fails at a small station does that
        // extension wait for an upgrade there (extFailed).
        const isSmall = (b) => !!b.small_building || [17, 18].includes(b.building_type);
        // Upgrading: still small for the API for a while, so no extension tries for 25 hours.
        const upgrading = (b) => Date.now() - ((state.upgrading || {})[b.id] || 0) < 25 * 3600000;
        const upgradeStep = (b, se, why, extra = {}) => ({ label: `${b.caption} uitbouwen tot groot station (24 uur, ${why})`, cost: se.cost,
            run: () => hit(se.href, true), check: async () => !(await buildingInfo(b.id)).smallExpand,
            done: () => { state.upgrading = { ...(state.upgrading || {}), [b.id]: Date.now() }; }, ...extra });
        // Extensions that failed at a building: { "building:extension": { at, small } }. At a
        // small station it waits for the upgrade; elsewhere it is left alone for a day.
        const extKey = (b, e) => `${b.id}:${e.id}`;
        function extBlocked(b, e) {
            const f = (state.extFailed || {})[extKey(b, e)];
            if (!f) return '';
            if (f.small) {
                if (isSmall(b) || upgrading(b)) return 'small';
                delete state.extFailed[extKey(b, e)]; // a full station now: try again
                return '';
            }
            return Date.now() - f.at < 24 * 3600000 ? 'failed' : '';
        }
        // The game's message after a purchase (the page it redirects to), for the log.
        async function gameSays(r) {
            try {
                const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
                return [...doc.querySelectorAll('.alert-danger, .alert-warning')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 200);
            } catch (e) { return ''; }
        }
        // An extension purchase: on failure, note whether the station being small is why.
        const extStep = (b, ext, label, extra) => ({ label, cost: ext.cost,
            run: async () => { lastSaid = await gameSays(await hit(ext.href, true)); },
            check: async () => !(await buildingInfo(b.id)).exts.some((e) => e.id === ext.id),
            onFail: async () => {
                let small = isSmall(b);
                try { small = small && !!(await buildingInfo(b.id)).smallExpand; } catch (e) { /* keep the API's answer */ }
                state.extFailed = { ...(state.extFailed || {}), [extKey(b, ext)]: { at: Date.now(), small } };
                return small ? { known: true, note: 'klein station: deze uitbreiding kan daar waarschijnlijk pas na uitbouwen tot groot station' }
                    : { note: 'niet opnieuw geprobeerd in dit gebouw voor 24 uur' };
            }, ...extra });

        // Building page: parking "Voertuigen: 29 van maximaal 29" and the extensions
        // that can still be bought, with what they unlock.
        async function buildingInfo(id) {
            const doc = await getDoc(`/buildings/${id}`);
            const text = doc.body.textContent.replace(/\s+/g, ' ');
            const cap = text.match(/Voertuigen:?\s*(\d+)\s*van maximaal\s*(\d+)/i);
            const exts = [...doc.querySelectorAll('a[href*="/extension/credits/"]')].map((a) => {
                const row = a.closest('tr');
                return { id: (a.getAttribute('href').match(/credits\/(\d+)/) || [])[1], href: a.getAttribute('href').split('?')[0],
                    cost: num(a.textContent), text: row ? row.textContent.replace(/\s+/g, ' ').trim() : '' };
            });
            const vehicleIds = [...doc.querySelectorAll('#vehicle_table a[href^="/vehicles/"]')]
                .map((a) => (a.getAttribute('href').match(/^\/vehicles\/(\d+)$/) || [])[1]).filter(Boolean);
            // Small station: "Gebouw upgraden (630.736 credits)" turns it into a full one (24 h).
            const up = [...doc.querySelectorAll('a[href]')].find((a) => /\/small_expand$/.test((a.getAttribute('href') || '').split('?')[0]));
            const smallExpand = up ? { href: up.getAttribute('href'), cost: num(up.textContent) } : null;
            return { used: cap ? Number(cap[1]) : null, max: cap ? Number(cap[2]) : null, exts, vehicleIds, smallExpand };
        }
        // The next level on the "Uitbouwen" page: the cheapest credits link.
        async function nextLevel(id) {
            const doc = await getDoc(`/buildings/${id}/expand`);
            const links = [...doc.querySelectorAll('a[href*="/expand_do/credits"]')]
                .map((a) => ({ href: a.getAttribute('href'), cost: num(a.textContent), level: Number((a.getAttribute('href').match(/level=(\d+)/) || [])[1]) }))
                .filter((l) => l.cost > 0).sort((a, b) => a.cost - b.cost);
            return links[0] || null;
        }
        // Crew a vehicle needs to go out: its minimum, but 2 when it holds 2 or more
        // (an ambulance listed as 1-2 really needs 2).
        const crewOf = (vt) => { const v = VT[vt]; if (!v) return 2; return v[6] >= 2 ? Math.max(v[2], 2) : Math.max(1, v[2]); };
        // Personnel not yet on a vehicle, with or without a given training.
        async function freeCrew(id, training) {
            const doc = await getDoc(`/buildings/${id}/personals`);
            const table = doc.querySelector('#personal_table') || [...doc.querySelectorAll('table')].find((t) => /opleiding/i.test(t.textContent));
            if (!table) return 0;
            const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
            const iEdu = Math.max(0, heads.findIndex((h) => /opleiding/.test(h)));
            let n = 0;
            for (const tr of table.querySelectorAll('tbody tr')) {
                if (tr.querySelector('a[href*="/vehicles/"]')) continue; // already on a vehicle
                const edu = (tr.cells[iEdu]?.textContent || '').toLowerCase();
                if (!training || edu.includes(training.toLowerCase())) n++;
            }
            return n;
        }

        /* ========================================================================
         * NEEDS — the shortage list of Automatisch alarmeren. A vehicle type gets a
         * score from how often it was short or too far, recent weighing more, plain
         * vehicles less. "Other" needs give hospital departments, cells, trainings.
         * ==================================================================== */
        function readNeeds() {
            let needs = null;
            try { needs = JSON.parse(GM_getValue(NEEDS_KEY, 'null')); } catch (e) { needs = null; }
            return needs || { types: {}, other: {} };
        }
        const centroid = (pos) => {
            if (!pos || !pos.length) return null;
            const recent = pos.slice(-15);
            return [recent.reduce((s, p) => s + p[0], 0) / recent.length, recent.reduce((s, p) => s + p[1], 0) / recent.length];
        };
        // Credits a shortage blocked in the last 7 days. Entries are [lat, lon, time,
        // credits]; older data without credits counts 1.000 per missed mission.
        // Each purchase for a need halves what the shortages from before it still weigh:
        // the new vehicle should fix those, so only later shortages keep the full value.
        function value7d(t, name) {
            const since = Date.now() - 7 * 86400000;
            const buys = ((state.bought || {})[name] || []).filter((x) => x >= since);
            const weight = (at) => 0.5 ** buys.filter((x) => x > at).length;
            const recent = (t.pos || []).filter((p) => p[2] >= since);
            // Places recorded before credits were tracked (or with unknown credits) count
            // 1,000 each; counting them as 0 put OvD-P (122 missions) below 5-mission needs.
            if (recent.length) return recent.reduce((s, p) => s + (p[3] || 1000) * weight(p[2]), 0);
            const age = (Date.now() - (t.last || 0)) / 3600000;
            // No places with times (recorded by an older version): the all-time count says
            // little about now. Capped, and fading fast once the last shortage is a day old
            // (291 old Noodhulp shortages bought two levels and two cars a day later).
            return Math.min(t.missions, 30) * 1000 * (age < 24 ? 1 : age < 72 ? 0.3 : 0.05) * 0.5 ** buys.length;
        }
        function candidates(needs) {
            const now = Date.now();
            const out = [];
            for (const [name, t] of Object.entries(needs.types || {})) {
                if (t.missions < ctx.cfg.minMissions) continue;
                if ((state.cool[name] || 0) > now) continue;
                // A project for this need is still under way (training, extension being
                // built): wait for it instead of planning a second answer (a 400k police
                // building for OvD-P while Ede's OvD-P crew waited for a classroom).
                if (projects().some((p) => p.need === name)) continue;
                const vts = vehiclesFor(name);
                const value = value7d(t, name) * (vts.length && PLAIN.has(vts[0]) ? 1 : ctx.cfg.specialWeight);
                out.push({ kind: 'vehicle', name, vts, value, at: centroid(t.pos), t });
            }
            for (const [name, t] of Object.entries(needs.other || {})) {
                if (t.missions < ctx.cfg.minMissions || (state.cool[name] || 0) > now) continue;
                const dep = name.match(/^Ziekenhuis met afdeling (.+)$/i);
                const cells = /^Cel(len)? /i.test(name);
                const edu = name.match(/^Opleiding (.+?) \(/);
                const pers = name.match(/^Personeel: (.+)$/);
                if (edu || pers) { state.wishes[(edu || pers)[1]] = t.missions; continue; }
                const value = value7d(t, name) * ctx.cfg.specialWeight;
                if (dep) out.push({ kind: 'ext', name, types: [2], match: new RegExp(dep[1].trim(), 'i'), value, at: centroid(t.pos), t });
                else if (cells) out.push({ kind: 'ext', name, types: [5, 11, 18], match: /\bcel\b|cel$/i, value, at: centroid(t.pos), t });
            }
            for (const u of unlocks7d) if ((state.cool[u.name] || 0) <= now) out.push(u);
            return out.sort((a, b) => b.value - a.value);
        }

        /* ========================================================================
         * NEW MISSION TYPES — missions need a number of buildings or extensions
         * (prerequisites in /einsaetze.json, same table as the Personeel module).
         * For each building or extension: the mission types one more would unlock
         * (that being their only gap), valued at their average credits ×
         * unlockWeight, as if each turns up that often per week.
         * ==================================================================== */
        const PREREQ = {
            fire_stations: { label: 'Brandweerkazerne', types: [0, 17] }, rescue_stations: { label: 'Ambulancestandplaats', types: [3, 13] },
            police_stations: { label: 'Politiebureau', types: [5, 18] }, bereitschaftspolizei: { label: 'Politie hoofdbureau', types: [11] },
            police_helicopter_stations: { label: 'Politiehelikopter standplaats', types: [9] }, water_rescue_2: { label: 'Waterreddingspost', types: [16] },
            coastal_rescue_count: { label: 'Kustwacht haven', types: [19] }, coastal_helicopter_count: { label: 'SAR Helikopter platform', types: [21] },
            tow_trucks: { label: 'Berger standplaats / Berger-K', types: [24], ext: /^Berger-K/i }, railway: { label: 'Standplaats Incidentenbestrijding spoor', types: [27] },
            military_police: { label: 'Kazerne defensie', types: [25] }, fire_aviation_count: { label: 'Militaire hangar', types: [23] },
            technical_aid: { label: 'RWS-steunpunt / Signalisatie', types: [22], ext: /^Signalisatie/i }, tow_trucks_large: { label: 'Berger-G', ext: /^Berger-G/i },
            fire_support_count: { label: 'Schuimblussing', ext: /^Schuimblus/i }, brush_extension: { label: 'Natuurbrandbestrijding', ext: /^Natuurbrandbestrijding/i },
            thatched_fire: { label: 'Rietkapbrandbestrijding', ext: /^Rietkap/i }, livestock_fire: { label: 'Veetakels', ext: /^Veetakel/i },
            industrial_response_fire: { label: 'Industriële Brandbestrijding', ext: /^Industri.le Brandbestrijding/i },
            hazard_response_fire: { label: 'Incidentbestrijding Gevaarlijke Stoffen', ext: /^Incidentbestrijding Gevaarlijke Stoffen/i },
            wasserrettung: { label: 'Waterongevallenbestrijding', ext: /^Waterongevallenbestrijding/i }, airport: { label: 'Vliegtuigbrandbestrijding', ext: /^Vliegtuigbrandbestrijding/i },
            railway_fire: { label: 'Incidentenbestrijding spoor (uitbreiding)', ext: /^Incidentenbestrijding spoor/i },
            mass_casualty_count: { label: 'Grootschalige Geneeskundige Bijstand', ext: /^Grootschalige Geneeskundige Bijstand/i },
            disaster_response_count: { label: 'Specialisme Technische Hulpverlening', ext: /^Specialisme Technische Hulpverlening/i },
            search_and_rescue: { label: 'Urban Search and Rescue', ext: /^Urban Search and Rescue/i }, care_service: { label: 'Verzorgingseenheid', ext: /^Verzorgingseenheid/i },
            clean_service: { label: 'Arbeidshygiëne', ext: /^Arbeidshygi/i }, drone_fire: { label: 'Team Digitale Verkenning', ext: /^Team Digitale Verkenning/i },
            drone_police: { label: 'Drone Team Politie', ext: /^Drone Team Politie/i }, traffic_police: { label: 'LE - Dienst Infrastructuur', ext: /^LE - Dienst Infrastructuur/i },
            hondengeleider: { label: 'Hondenbrigade', ext: /^Hondenbrigade/i }, police_horse: { label: 'Bereden Brigade', ext: /^Bereden Brigade/i },
            riot_unit_count: { label: 'Mobiele Eenheid, Sectie', ext: /^Mobiele Eenheid, (2e )?Sectie/i },
            detention_unit_count: { label: 'Mobiele Eenheid, Aanhoudingseenheid', ext: /Aanhoudingseenheid/i },
            prisoner_transport_count: { label: 'Arrestantenvervoer', ext: /^Arrestantenvervoer/i }, water_cannon: { label: 'Waterwerper', ext: /^Waterwerper/i },
            at: { label: 'Arrestatieteam', ext: /^Arrestatieteam/i }, bomb_disposal_count: { label: 'Explosieven Opruimingsdienst', ext: /^Explosieven Opruimingsdienst/i },
            bomb_disposal_diver: { label: 'Defensie Duikgroep', ext: /^Defensie Duikgroep/i }, bomb_disposal_patrol: { label: 'TEV', ext: /\bTEV\b|Technische Explosieven/i },
            coastal_rescue_small_count: { label: 'Boten', ext: /^Boten|\bboot/i },
        };
        const MAIN_BUILDING = { 0: 'fire_stations', 3: 'rescue_stations', 5: 'police_stations', 11: 'bereitschaftspolizei',
            16: 'water_rescue_2', 19: 'coastal_rescue_count', 24: 'tow_trucks', 25: 'military_police', 27: 'railway' };
        let missionTypes = null; // /einsaetze.json, once per page (~3 MB)
        let unlocks7d = [];
        async function computeUnlocks(data) {
            if (!missionTypes) missionTypes = await api('/einsaetze.json');
            const have = {};
            for (const [key, def] of Object.entries(PREREQ)) {
                let n = 0;
                for (const b of data.buildings) {
                    if (def.types && def.types.includes(b.building_type)) n++;
                    // Extensions still being built count too, or the next round buys a second one elsewhere.
                    if (def.ext) n += (b.extensions || []).filter((x) => def.ext.test(x.caption || '')).length;
                }
                have[key] = n;
            }
            const now = Date.now();
            const gain = {};
            for (const m of missionTypes) {
                const a = m.additional || {};
                if (Date.parse(a.date_start) > now || Date.parse(a.date_end) < now) continue; // events out of season
                const pre = m.prerequisites || {};
                if (typeof pre.max_police_stations === 'number' && have.police_stations > pre.max_police_stations) continue;
                const need = {};
                for (const [k, v] of Object.entries(pre)) if (typeof v === 'number' && PREREQ[k]) need[k] = v;
                const main = MAIN_BUILDING[pre.main_building];
                if (main) need[main] = Math.max(need[main] || 0, 1);
                const gaps = Object.entries(need).filter(([k, v]) => have[k] < v);
                if (gaps.length !== 1 || gaps[0][1] - have[gaps[0][0]] !== 1) continue;
                const k = gaps[0][0];
                gain[k] = gain[k] || { credits: 0, names: new Set() };
                if (gain[k].names.has(m.name)) continue; // variants of one mission count once
                gain[k].names.add(m.name);
                gain[k].credits += m.average_credits || 0;
            }
            unlocks7d = Object.entries(gain).map(([key, g]) => ({
                kind: 'unlock', key, def: PREREQ[key], name: `Nieuwe meldingen: ${PREREQ[key].label}`,
                value: g.credits * ctx.cfg.unlockWeight, unlockCount: g.names.size, examples: [...g.names].slice(0, 5),
            }));
        }

        /* ========================================================================
         * PLANNING — for one need, the first thing in this order that is possible:
         * an extension the nearest suitable building lacks, a level when its
         * parking is full, the vehicle itself, or else a new building on a real post.
         * ==================================================================== */
        /* ========================================================================
         * PROJECTS — a vehicle that needs trained crew goes in steps, saved across
         * reloads: train (free people go to a school), buy (when they are trained,
         * a level first if the parking is full), assign (those people are linked to
         * the new vehicle). One project per building at a time.
         * ==================================================================== */
        const projects = () => (state.projects = state.projects || []);
        const SCHOOL_TYPES = [4, 7, 8, 20, 26];
        const cleanEdu = (t) => norm(String(t).replace(/\(\d+\s*dag(en)?\)/i, ''));
        let eduCache = null; // per round: training name -> { key, value, school, form }
        // The training's key ("care_service") and a school with a free classroom that gives it.
        async function education(name) {
            if (!eduCache) {
                eduCache = {};
                for (const s of (await api('/api/buildings')).filter((b) => SCHOOL_TYPES.includes(b.building_type))) {
                    const doc = await getDoc(`/buildings/${s.id}`);
                    const form = [...doc.forms].find((f) => /\/education$/.test(f.getAttribute('action') || ''));
                    if (!form) continue; // all classrooms in use
                    for (const o of form.querySelectorAll('select[name="education_select"] option')) {
                        if (!o.value) continue;
                        const n = cleanEdu(o.textContent);
                        state.eduKeys = state.eduKeys || {};
                        state.eduKeys[n] = o.value.split(':')[0];
                        if (!eduCache[n]) eduCache[n] = { key: o.value.split(':')[0], value: o.value, school: s.id, form };
                    }
                }
            }
            const n = cleanEdu(name);
            return eduCache[n] || { key: (state.eduKeys || {})[n] || null };
        }
        // People of a building as the school form lists them: has the training, free
        // (not bound to a vehicle, not in training, not reserved by another project).
        async function peopleAt(buildingId, key) {
            const doc = await getDoc(`/buildings/${buildingId}/schooling_personal_select`);
            const reserved = new Set(projects().flatMap((p) => p.people || []));
            return [...doc.querySelectorAll('input.schooling_checkbox')].map((cb) => {
                const tr = cb.closest('tr');
                const bound = (tr?.cells[tr.cells.length - 1]?.textContent || '').trim();
                const pid = cb.value;
                const idle = !bound && !cb.disabled;
                return { pid, has: cb.getAttribute(key) === 'true', idle, free: idle && !reserved.has(pid) };
            });
        }
        // A class only starts when all 10 seats are taken. Empty seats go first to free
        // people in buildings that can hold the vehicle (a crew each, trained ahead for a
        // later purchase there), nearest first, then to free people from any building.
        async function fillSeats(data, edu, have, vt, ref) {
            const missing = 10 - have.length;
            if (missing <= 0) return [];
            const prefTypes = (VT[vt] || [])[3] || [];
            const per = crewOf(vt);
            const taken = new Set(have);
            const dist = (b) => (ref ? km(posOf(b), ref) : 0);
            const usable = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type) && b.enabled !== false);
            const lists = [[usable.filter((b) => prefTypes.includes(b.building_type)).sort((a, b) => dist(a) - dist(b)), per],
                [usable.filter((b) => !prefTypes.includes(b.building_type)).sort((a, b) => dist(a) - dist(b)), 10]];
            const out = [];
            let looked = 0;
            for (const [list, max] of lists) {
                for (const b of list) {
                    if (out.length >= missing || looked >= 40) break;
                    looked++;
                    const free = (await peopleAt(b.id, edu.key)).filter((p) => p.free && !p.has && !taken.has(p.pid)).slice(0, Math.min(max, missing - out.length));
                    free.forEach((p) => { out.push(p.pid); taken.add(p.pid); });
                }
            }
            return out;
        }
        // Start a class with these people, the empty seats filled; the step's label says how many extra.
        async function startFull(step, data, edu, pids, vt, ref) {
            const extra = await fillSeats(data, edu, pids, vt, ref);
            if (extra.length) step.label += `, ${extra.length} extra om de klas vol te maken`;
            await startTraining(edu, [...pids, ...extra]);
        }
        // People of a building in a class for this training right now ("In opleiding:
        // Drone Flightcrew" on its personnel page); the school form does not list them.
        async function inTraining(buildingId, training) {
            const doc = await getDoc(`/buildings/${buildingId}/personals`);
            const t = cleanEdu(training);
            return [...doc.querySelectorAll('table tbody tr')].filter((tr) => {
                const m = tr.textContent.replace(/\s+/g, ' ').match(/In opleiding:\s*([^|]+?)(?:\s{2,}|$)/i);
                return m && cleanEdu(m[1]).includes(t);
            }).length;
        }
        async function startTraining(edu, pids) {
            const fd = new FormData(edu.form);
            fd.set('education_select', edu.value);
            fd.set('alliance[duration]', '0'); // "Nu starten", not shared with the team
            fd.set('alliance[cost]', '0');
            fd.delete('personal_ids[]');
            pids.forEach((pid) => fd.append('personal_ids[]', pid));
            const submit = edu.form.querySelector('input[type="submit"][name="commit"]');
            if (submit) fd.set('commit', submit.value);
            await hit(edu.form.getAttribute('action'), new URLSearchParams(fd));
        }
        // Link people to a vehicle: the assign button is a POST that toggles, so
        // only people not yet on this vehicle are sent.
        async function assignPeople(vehicleId, pids) {
            const doc = await getDoc(`/vehicles/${vehicleId}/zuweisung`);
            let done = 0;
            for (const pid of pids) {
                const btn = doc.querySelector(`a[personal_id="${pid}"]`);
                if (!btn) continue;
                if (!btn.classList.contains('btn-assigned')) {
                    await hit(`/vehicles/${vehicleId}/zuweisungDo/${pid}`, true);
                    await sleep(400);
                }
                done++;
            }
            const after = await getDoc(`/vehicles/${vehicleId}/zuweisung`);
            return pids.filter((pid) => after.querySelector(`a[personal_id="${pid}"]`)?.classList.contains('btn-assigned')).length === pids.length && done > 0;
        }
        async function buyAction(b, c, v, info, d) {
            const market = await getDoc(`/buildings/${b.id}/vehicles/new`);
            const btn = [...market.querySelectorAll('a.buy-vehicle-btn')].find((a) => new RegExp(`/vehicle/\\d+/${c.vt}/credits`).test(a.getAttribute('href')));
            if (!btn || btn.classList.contains('disabled')) return { skip: `${b.caption}: ${v[0]} niet te koop` };
            return { label: `${v[0]} voor ${b.caption}${d != null ? ` (${d.toFixed(1)} km van de inzetten)` : ''}`, cost: v[1], building: b.id, vt: c.vt, before: info.vehicleIds,
                run: () => hit(btn.getAttribute('href')),
                check: async () => ((await buildingInfo(b.id)).used || 0) > (info.used || 0) };
        }
        // Free steps of running projects (training done? assign people), and the
        // paid step (level or vehicle) of the first one that is ready to buy.
        async function advanceProjects(data) {
            for (const p of [...projects()]) {
                if (stopped) return null;
                const b = data.byId[p.building];
                if (!b || Date.now() - p.started > 14 * 86400000) {
                    state.projects = projects().filter((x) => x !== p);
                    addLog(`project gestopt: ${VT[p.vt]?.[0]} voor ${p.caption} (${b ? 'te lang' : 'gebouw weg'})`, 'warn');
                    continue;
                }
                if (p.stage === 'grow') {
                    // A new post from build mode: levels up to what its first staff can man,
                    // then vehicles that need few people, until the parking is full.
                    const G = GROW_FILL[p.kind] || GROW_FILL.brandweerkazerne;
                    const info = await buildingInfo(p.building);
                    if (p.levels < G.levels && ctx.cfg.doLevels) {
                        const lvl = await nextLevel(p.building);
                        if (lvl) {
                            return { label: `level voor nieuwe post ${p.caption} (${p.levels + 1}/${G.levels}, bouwmodus)`, cost: lvl.cost, need: p.need,
                                run: () => hit(lvl.href), check: async () => ((await buildingInfo(p.building)).max || 0) > (info.max || 0),
                                done: () => { p.levels++; } };
                        }
                        p.levels = G.levels; // no more levels to buy here
                    }
                    if (info.used != null && info.max != null && info.used < info.max && ctx.cfg.doVehicles) {
                        const have = data.vehicles.filter((x) => x.building_id === p.building).map((x) => x.vehicle_type);
                        let vt = have.length ? null : G.first;
                        if (vt == null) {
                            for (const c of candidates(readNeeds())) {
                                if (c.kind !== 'vehicle') continue;
                                const t = c.vts.find((id) => VT[id] && VT[id][3].includes(b.building_type) && !VT[id][4] && crewOf(id) <= staffLeft(b, data));
                                if (t != null) { vt = t; break; }
                            }
                        }
                        if (vt == null) {
                            state.projects = projects().filter((x) => x !== p);
                            addLog(`nieuwe post klaar: ${p.caption} (${have.length} voertuig(en), geen passend tekort meer)`, 'ok');
                            continue;
                        }
                        // Only as many vehicles as its people can man (a new post has few):
                        // the rest of the parking stays free for later.
                        if (staffLeft(b, data) < crewOf(vt)) {
                            // A new post starts without people: wait for the hiring to bring the
                            // first crew. Once it has vehicles, stop where its people run out.
                            if (!have.length && Date.now() - p.started < 3 * 86400000) { p.wait = `wacht op personeel (${b.personal_count || 0})`; continue; }
                            state.projects = projects().filter((x) => x !== p);
                            addLog(`nieuwe post zo ver als het personeel toelaat: ${p.caption} (${have.length} voertuig(en))`, 'ok');
                            continue;
                        }
                        const buy = await buyAction(b, { vt }, VT[vt], info, null);
                        if (!buy.skip) return { ...buy, need: p.need, label: `${buy.label} (nieuwe post, bouwmodus)` };
                        p.wait = buy.skip;
                        continue;
                    }
                    state.projects = projects().filter((x) => x !== p);
                    addLog(`nieuwe post klaar: ${p.caption}`, 'ok');
                    continue;
                }
                if (p.stage === 'prep') {
                    // Extension bought: crew first (in parallel with the building work).
                    const v = VT[p.vt];
                    if (!v || !v[4]) { p.stage = 'buy'; p.people = []; }
                    else {
                        const edu = await education(v[4]);
                        const want = v[5] === 'all' ? crewOf(p.vt) : Number(v[5]) || crewOf(p.vt);
                        const people = edu.key ? await peopleAt(p.building, edu.key) : [];
                        const trained = people.filter((x) => x.free && x.has);
                        p.training = v[4];
                        if (trained.length >= want) {
                            Object.assign(p, { stage: 'buy', key: edu.key, people: trained.slice(0, want).map((x) => x.pid) });
                        } else if (trained.length + await inTraining(p.building, v[4]) >= want) {
                            // Already in a class (a team training joined by hand, or our own):
                            // wait for it instead of starting a second one.
                            p.wait = 'personeel al in opleiding';
                            continue;
                        } else if (!edu.key || !edu.school) {
                            p.wait = 'wacht op een vrij klaslokaal';
                            markBlocked(p.vt, 20000);
                            continue;
                        } else {
                            const learners = people.filter((x) => x.free && !x.has).slice(0, want - trained.length);
                            if (learners.length < want - trained.length) { p.wait = 'te weinig vrij personeel om op te leiden'; continue; }
                            const crew = trained.map((x) => x.pid);
                            // At most 10 per class: the rest follows as soon as a classroom is free.
                            const all = learners.map((x) => x.pid);
                            const learnIds = all.slice(0, 10);
                            const later = all.slice(10);
                            const step = { label: `opleiding ${v[4]} voor ${learnIds.length} pers. van ${p.caption} (voor ${v[0]}, terwijl de uitbreiding gebouwd wordt)`, cost: 0, need: p.need,
                                run: () => startFull(step, data, edu, learnIds, p.vt, posOf(b)),
                                check: async () => (await peopleAt(p.building, edu.key)).filter((x) => learnIds.includes(x.pid) && x.idle).length === 0,
                                done: () => Object.assign(p, { stage: 'train', key: edu.key, people: [...crew, ...all], queue: later.length ? later : undefined, started: Date.now(), wait: null }) };
                            return step;
                        }
                    }
                }
                if (p.stage === 'train' && p.queue && p.queue.length) {
                    // More people than one class holds: the rest goes as soon as a school
                    // has a free classroom. Whoever left meanwhile is replaced from the same building.
                    const people = await peopleAt(p.building, p.key);
                    const want = p.queue.length;
                    p.people = p.people.filter((pid) => !p.queue.includes(pid));
                    const still = p.queue.filter((pid) => people.find((x) => x.pid === pid && x.idle && !x.has));
                    const fill = people.filter((x) => x.free && !x.has && !still.includes(x.pid)).slice(0, want - still.length).map((x) => x.pid);
                    p.queue = [...still, ...fill];
                    p.people.push(...p.queue);
                    if (p.queue.length < want) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`project gestopt: ${VT[p.vt]?.[0]} voor ${p.caption} (te weinig vrij personeel voor de volgende opleiding)`, 'warn');
                        continue;
                    }
                    const edu = await education(p.training);
                    if (!edu.school) { p.wait = 'wacht op een vrij klaslokaal'; markBlocked(p.vt, 20000); continue; }
                    const batch = p.queue.slice(0, Math.min(10, ctx.cfg.trainSeats));
                    const step = { label: `opleiding ${p.training} voor ${batch.length} pers. van ${p.caption} (vervolg, project)`, cost: 0, need: p.need,
                        run: () => startFull(step, data, edu, batch, p.vt, posOf(b)),
                        check: async () => (await peopleAt(p.building, p.key)).filter((x) => batch.includes(x.pid) && x.idle).length === 0,
                        done: () => { p.queue = p.queue.filter((pid) => !batch.includes(pid)); p.wait = null; p.started = Date.now(); } };
                    return step;
                }
                if (p.stage === 'train') {
                    const people = await peopleAt(p.building, p.key);
                    const ready = p.people.every((pid) => people.find((x) => x.pid === pid)?.has);
                    if (ready) { p.stage = p.fill ? 'assign' : 'buy'; p.assignTries = 0; addLog(`opleiding klaar: ${p.training} in ${p.caption}`, 'idle'); }
                }
                if (p.stage === 'assign') {
                    if (await assignPeople(p.vehicle, p.people)) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`personeel gekoppeld: ${p.people.length} pers. met ${p.training} aan ${VT[p.vt]?.[0]} in ${p.caption}`, 'ok');
                    } else if (++p.assignTries > 5) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`koppelen mislukt: ${VT[p.vt]?.[0]} in ${p.caption}`, 'error');
                    }
                }
                if (p.stage === 'buy') {
                    const v = VT[p.vt];
                    // Waiting for an extension that brings the parking spot: no level meanwhile
                    // (Voorthuizen wanted level 2 for 100k while its ambulance post was being built).
                    if ((b.extensions || []).some((x) => x.available === false)) { p.wait = 'uitbreiding wordt nog gebouwd'; continue; }
                    const info = await buildingInfo(p.building);
                    if (info.used != null && info.max != null && info.used >= info.max) {
                        const lvl = ctx.cfg.doLevels ? await nextLevel(p.building) : null;
                        if (!lvl) { p.wait = 'parkeerplaats vol, geen level meer'; continue; }
                        return { label: `level ${lvl.level} voor ${p.caption} (plek voor ${v[0]}, project)`, cost: lvl.cost, need: p.need,
                            run: () => hit(lvl.href), check: async () => ((await buildingInfo(p.building)).max || 0) > (info.max || 0) };
                    }
                    const buy = await buyAction(b, { vt: p.vt }, v, info, null);
                    if (buy.skip) { p.wait = buy.skip; continue; }
                    return { ...buy, need: p.need, label: `${buy.label} (project)`, project: p };
                }
            }
            return null;
        }

        // Vehicles whose capacity is their crew: a horse truck carries one horse per
        // rider (tested: 6 trucks with 1 person each count as 6 Police Horses).
        // Filling the trucks you have is cheaper than buying more.
        const FILL_VT = { 73: 4 };
        async function planFill(c, data) {
            const v = VT[c.vt];
            const max = FILL_VT[c.vt];
            const edu = await education(v[4]);
            if (!edu.key) return null;
            const filling = new Set(projects().filter((p) => p.fill).map((p) => String(p.vehicle)));
            const ref = c.at || data.home;
            const trucks = data.vehicles.filter((x) => x.vehicle_type === c.vt && (x.assigned_personnel_count || 0) < max && !filling.has(String(x.id)))
                .map((x) => ({ x, b: data.byId[x.building_id] })).filter((t) => t.b)
                .sort((a, b) => km(posOf(a.b), ref) - km(posOf(b.b), ref));
            if (!trucks.length) return null;
            // Trained riders already free in a truck's building: link them now (free).
            for (const { x, b } of trucks) {
                const trained = (await peopleAt(b.id, edu.key)).filter((p) => p.free && p.has).slice(0, max - (x.assigned_personnel_count || 0));
                if (!trained.length) continue;
                let ok = false;
                return { label: `${trained.length} ruiter(s) erbij op ${x.caption} in ${b.caption} (${x.assigned_personnel_count || 0} → ${(x.assigned_personnel_count || 0) + trained.length} paarden)`, cost: 0,
                    run: async () => { ok = await assignPeople(x.id, trained.map((p) => p.pid)); }, check: async () => ok };
            }
            // Otherwise train free people of the truck's own building, several trucks of one
            // building in one class; each truck is a project that links them when done.
            if (!edu.school) { markBlocked(c.vt, c.value); return { skip: `${c.name}: ${v[4]} nodig om paardentrucks te vullen, geen vrij klaslokaal` }; }
            const seats = Math.min(10, ctx.cfg.trainSeats);
            for (const { b } of trucks) {
                const here = trucks.filter((t) => t.b.id === b.id);
                const free = (await peopleAt(b.id, edu.key)).filter((p) => p.free && !p.has);
                const group = [];
                let used = 0;
                for (const { x } of here) {
                    const n = Math.min(max - (x.assigned_personnel_count || 0), free.length - used, seats - used);
                    if (n <= 0) break;
                    const pids = free.slice(used, used + n).map((p) => p.pid);
                    used += n;
                    group.push({ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'train', key: edu.key, training: v[4],
                        people: pids, vehicle: x.id, fill: true, started: Date.now() });
                }
                if (!group.length) continue;
                const learnIds = group.flatMap((p) => p.people);
                const step = { label: `opleiding ${v[4]} voor ${learnIds.length} pers. van ${b.caption}, daarna op ${group.length} paardentruck(s)`, cost: 0,
                    run: () => startFull(step, data, edu, learnIds, c.vt, posOf(b)),
                    check: async () => (await peopleAt(b.id, edu.key)).filter((p) => learnIds.includes(p.pid) && p.idle).length === 0,
                    projects: group };
                return step;
            }
            return null;
        }

        /* Empty parking spots: every building page is read in turns (a few per round,
         * oldest first) and remembered as { used, max, at }. A building with room gets
         * the most valuable shortage its type can hold, when its staff can crew it now. */
        const NO_VEHICLES = new Set([1, 2, ...SCHOOL_TYPES]);
        async function scanSpots(data, n = 15) {
            state.spots = state.spots || {};
            const ids = new Set(data.buildings.map((b) => String(b.id)));
            for (const id of Object.keys(state.spots)) if (!ids.has(id)) delete state.spots[id];
            const todo = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type) && b.enabled !== false)
                .sort((a, b) => ((state.spots[a.id] || {}).at || 0) - ((state.spots[b.id] || {}).at || 0)).slice(0, n);
            for (const b of todo) {
                if (stopped) return;
                if (Date.now() - ((state.spots[b.id] || {}).at || 0) < 3600000) continue;
                try {
                    const info = await buildingInfo(b.id);
                    if (info.max != null) state.spots[b.id] = { used: info.used, max: info.max, at: Date.now() };
                } catch (e) { ctx.warn('spot scan', b.id, e); }
                await sleep(300);
            }
        }
        async function planSpots(cands, data) {
            const out = [];
            const free = data.buildings.filter((b) => { const f = (state.spots || {})[b.id]; return f && f.max > f.used; });
            if (!free.length) return out;
            const types = cands.filter((c) => c.kind === 'vehicle' && c.vts.length);
            for (const b of free) {
                if (projects().some((p) => p.building === b.id)) continue;
                const here = data.vehicles.filter((x) => x.building_id === b.id);
                const left = (b.personal_count || 0) - here.reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
                let info = null;
                for (const c of types) {
                    const vt = c.vts.find((id) => VT[id] && VT[id][3].includes(b.building_type));
                    if (vt == null || VT[vt][4] === '?') continue;
                    const v = VT[vt];
                    if (left < crewOf(vt)) continue;
                    const d = c.at ? km(posOf(b), c.at) : 0;
                    // Worth less the further it is from where the shortage was.
                    const factor = !c.at || d <= ctx.cfg.nearKm ? 1 : d <= ctx.cfg.nearKm * 3 ? 0.5 : 0.25;
                    if (!info) {
                        info = await buildingInfo(b.id);
                        state.spots[b.id] = { used: info.used, max: info.max, at: Date.now() };
                    }
                    if (info.used >= info.max) break;
                    if (info.exts.some((e) => unlocks(e.text, vt))) continue;
                    let people;
                    if (v[4]) {
                        const edu = await education(v[4]);
                        if (!edu.key) continue;
                        const want = v[5] === 'all' ? crewOf(vt) : Number(v[5]) || crewOf(vt);
                        const trained = (await peopleAt(b.id, edu.key)).filter((p) => p.free && p.has);
                        if (trained.length < want) continue; // training goes through the normal plan
                        people = trained.slice(0, want).map((p) => p.pid);
                    }
                    const buy = await buyAction(b, { vt }, v, info, c.at ? d : null);
                    if (buy.skip) continue;
                    const value = c.value * factor;
                    out.push({ ...buy, people, need: c.name, value, label: `lege plek: ${buy.label}`, ratio: value / Math.max(buy.cost, 2000) });
                    break; // one option per building
                }
                if (out.length >= 3) break;
            }
            return out;
        }

        async function planVehicle(c, data) {
            // Of the types the name can mean, the first one an own building type can hold.
            const types = new Set(data.buildings.map((b) => b.building_type));
            c.vt = c.vts.find((id) => VT[id] && VT[id][3].some((t) => types.has(t))) ?? c.vts[0];
            const v = VT[c.vt];
            if (!v) return { skip: `${c.name}: onbekend voertuig` };
            if (FILL_VT[c.vt] && ctx.cfg.doVehicles) {
                const fill = await planFill(c, data);
                if (fill) return fill;
            }
            if (v[4] === '?') return { skip: `${c.name}: opleiding voor ${v[0]} onbekend` };
            const ref = c.at || data.home;
            const own = data.buildings.filter((b) => v[3].includes(b.building_type) && b.enabled !== false)
                .map((b) => ({ b, d: km(posOf(b), ref) })).sort((a, b) => a.d - b.d);
            // Near buildings with an empty parking spot first (known from the spot scan),
            // so a free spot is used before money goes into a level elsewhere.
            const hasRoom = (b) => { const f = (state.spots || {})[b.id]; return f && f.max > f.used ? 1 : 0; };
            const near = own.filter((o) => !c.at || o.d <= ctx.cfg.nearKm)
                .sort((x, y) => hasRoom(y.b) - hasRoom(x.b) || x.d - y.d).slice(0, 3);
            const reasons = [];
            let upgradeOpt = null; // a small station whose extension failed: upgrade it if nothing else fits
            for (const { b, d } of near) {
                const info = await buildingInfo(b.id);
                const gate = info.exts.find((e) => unlocks(e.text, c.vt));
                const blockedHow = gate ? extBlocked(b, gate) : '';
                if (blockedHow === 'small') {
                    // The extension failed here because the station is small: upgrade it first
                    // (when allowed), unless a later building in the list can take the vehicle.
                    if (!upgradeOpt && !upgrading(b) && info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && ctx.cfg.doExtensions
                        && staffLeft(b, data) >= crewOf(c.vt) && !projects().some((p) => p.building === b.id)) {
                        upgradeOpt = upgradeStep(b, info.smallExpand, `uitbreiding "${extName(gate.text)}" voor ${v[0]} lukte niet in de kleine post`);
                    }
                    reasons.push(`${b.caption}: uitbreiding lukte niet, klein station${upgrading(b) ? ' (wordt uitgebouwd)' : ', eerst uitbouwen tot groot'}`);
                    continue;
                }
                if (blockedHow === 'failed') { reasons.push(`${b.caption}: uitbreiding "${extName(gate.text)}" lukte eerder niet`); continue; }
                if (gate) {
                    // An extension takes days to build. When the vehicle has a building type of
                    // its own (an ambulance post for an ambulance), a new one of those is ready
                    // at once: build that instead (the "Ambulance standplaats" at Voorthuizen
                    // would have kept the ambulance waiting for days).
                    const own = v[3].find((t) => t !== b.building_type && CAT_OF[t] && !NO_NEW_BUILDING.has(t) && ![17, 18].includes(t));
                    if (own != null && ctx.cfg.doBuild && c.at) {
                        const nb = await planBuilding(c, [own], `voor ${v[0]}, direct klaar in plaats van uitbreiding in ${b.caption}`, data);
                        if (!nb.skip) return nb;
                    }
                    if (staffLeft(b, data) < crewOf(c.vt)) { reasons.push(`${b.caption}: uitbreiding nodig, maar personeel ${Math.max(0, staffLeft(b, data))}/${crewOf(c.vt)} over`); continue; }
                    if (ctx.cfg.doExtensions && gate.cost) {
                        return extStep(b, gate, `uitbreiding "${extName(gate.text)}" in ${b.caption} (voor ${v[0]})`,
                            { projects: projects().some((p) => p.building === b.id) ? [] : prepProject(b, c.vt, c.name) });
                    }
                    reasons.push(`${b.caption}: uitbreiding nodig`);
                    continue;
                }
                // Full: a level only after the staff and crew checks below, and always with
                // a project that buys the vehicle (and links trained crew) right after it.
                const full = info.used != null && info.max != null && info.used >= info.max;
                const lvl = full && ctx.cfg.doLevels ? await nextLevel(b.id) : null;
                if (full && !lvl) {
                    // A small station at its limit: upgrade it to a full one (24 hours), then a
                    // project buys the vehicle once there is room.
                    if (info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && staffLeft(b, data) >= crewOf(c.vt) && !projects().some((p) => p.building === b.id)) {
                        const se = info.smallExpand;
                        return { label: `${b.caption} uitbouwen tot groot station (24 uur, voor ${v[0]})`, cost: se.cost,
                            run: () => hit(se.href, true), check: async () => !(await buildingInfo(b.id)).smallExpand,
                            projects: [{ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'buy', people: [], started: Date.now() }] };
                    }
                    reasons.push(`${b.caption}: vol${ctx.cfg.doLevels ? ', hoogste level' : ''}`);
                    continue;
                }
                const levelStep = (crew) => ({ label: `level ${lvl.level} voor ${b.caption} (parkeerplaats voor ${v[0]}, daarna kopen)`, cost: lvl.cost,
                    run: () => hit(lvl.href), check: async () => ((await buildingInfo(b.id)).max || 0) > (info.max || 0),
                    projects: [{ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'buy', training: v[4] || null, people: crew, started: Date.now() }] });
                // Staff is shared by the building's vehicles: what is left after the
                // ones it has must crew this one too (5 staff, 2 ambulances = 1 left: no).
                const here = data.vehicles.filter((x) => x.building_id === b.id);
                const left = (b.personal_count || 0) - here.reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
                const need = crewOf(c.vt);
                if (left < need) {
                    reasons.push(`${b.caption}: personeel ${Math.max(0, left)}/${need} over`);
                    continue;
                }
                if (projects().some((p) => p.building === b.id)) { reasons.push(`${b.caption}: al een project bezig`); continue; }
                if (!ctx.cfg.doVehicles) return { skip: `${c.name}: voertuigen kopen staat uit` };
                if (v[4]) {
                    // Trained crew: buy now with people who have it, or send free
                    // people to training first (a project that buys and assigns later).
                    const want = v[5] === 'all' ? need : Number(v[5]) || need;
                    const edu = await education(v[4]);
                    if (!edu.key) { markBlocked(c.vt, c.value); reasons.push(`${b.caption}: opleiding ${v[4]} onbekend (alle klaslokalen bezet)`); continue; }
                    const people = await peopleAt(b.id, edu.key);
                    const trained = people.filter((p) => p.free && p.has);
                    if (trained.length >= want) {
                        if (full) return levelStep(trained.slice(0, want).map((p) => p.pid));
                        const buy = await buyAction(b, c, v, info, d);
                        if (buy.skip) { reasons.push(buy.skip); continue; }
                        return { ...buy, people: trained.slice(0, want).map((p) => p.pid) };
                    }
                    const missing = want - trained.length;
                    const learners = people.filter((p) => p.free && !p.has).slice(0, missing);
                    if (learners.length < missing) {
                        state.wishes[v[4]] = (state.wishes[v[4]] || 0) + 1;
                        reasons.push(`${b.caption}: ${trained.length}/${want} met ${v[4]}, te weinig vrij personeel om op te leiden`);
                        continue;
                    }
                    if (!edu.school) { markBlocked(c.vt, c.value); reasons.push(`${b.caption}: ${v[4]} nodig, geen vrij klaslokaal`); continue; }
                    const seats = Math.min(10, ctx.cfg.trainSeats);
                    const mk = (bb, crew, learn) => ({ building: bb.id, caption: bb.caption, vt: c.vt, need: c.name, stage: 'train', key: edu.key,
                        training: v[4], people: [...crew, ...learn], started: Date.now() });
                    const group = [mk(b, trained.slice(0, want).map((p) => p.pid), learners.map((p) => p.pid))];
                    const firstClass = learners.slice(0, seats);
                    const learnIds = firstClass.map((p) => p.pid); // who goes to the school now
                    if (learners.length > seats) group[0].queue = learners.slice(seats).map((p) => p.pid);
                    // More buildings in the same training, each its own project (train, level,
                    // buy, link): the ones nearest to the most places where the vehicle
                    // was missing, so the new vehicles spread over the problem areas.
                    const hits = new Map();
                    for (const at of (c.t.pos || []).map((p) => [p[0], p[1]])) {
                        const nearest = own.filter((o) => km(posOf(o.b), at) <= ctx.cfg.nearKm * 2).sort((x, y) => km(posOf(x.b), at) - km(posOf(y.b), at))[0];
                        if (nearest) hits.set(nearest.b.id, (hits.get(nearest.b.id) || 0) + 1);
                    }
                    const extraBuildings = own.filter((o) => o.b.id !== b.id && hits.has(o.b.id)).sort((x, y) => hits.get(y.b.id) - hits.get(x.b.id));
                    for (const { b: ob } of extraBuildings) {
                        if (group.length >= ctx.cfg.groupMax || learnIds.length >= seats) break;
                        if (projects().some((p) => p.building === ob.id)) continue;
                        const oinfo = await buildingInfo(ob.id);
                        if (oinfo.exts.some((e) => unlocks(e.text, c.vt))) continue; // needs an extension first
                        if (oinfo.used >= oinfo.max && !(ctx.cfg.doLevels && await nextLevel(ob.id))) continue; // full for good
                        const oleft = (ob.personal_count || 0) - data.vehicles.filter((x) => x.building_id === ob.id).reduce((s, x) => s + crewOf(x.vehicle_type), 0);
                        if (oleft < need) continue;
                        const oppl = await peopleAt(ob.id, edu.key);
                        const otrained = oppl.filter((p) => p.free && p.has).slice(0, want);
                        const olearn = oppl.filter((p) => p.free && !p.has).slice(0, want - otrained.length);
                        if (otrained.length + olearn.length < want || learnIds.length + olearn.length > seats) continue;
                        group.push(mk(ob, otrained.map((p) => p.pid), olearn.map((p) => p.pid)));
                        learnIds.push(...olearn.map((p) => p.pid));
                    }
                    const step = {
                        label: `opleiding ${v[4]} voor ${learnIds.length} pers.: ${group.length} gebouw(en) met project`
                            + ` (voor ${group.length}× ${v[0]}, elk met eigen personeel)`
                            + `${group[0].queue ? `, ${group[0].queue.length} later zodra er een klaslokaal vrij is` : ''}`, cost: 0,
                        run: () => startFull(step, data, edu, learnIds, c.vt, c.at || posOf(b)),
                        check: async () => (await peopleAt(b.id, edu.key)).filter((p) => learnIds.includes(p.pid) && p.idle).length === 0,
                        projects: group,
                    };
                    return step;
                }
                if (full) return levelStep([]);
                const buy = await buyAction(b, c, v, info, d);
                if (buy.skip) { reasons.push(buy.skip); continue; }
                return buy;
            }
            if (upgradeOpt) return upgradeOpt;
            if (!near.length && ctx.cfg.doBuild && c.at) return planBuilding(c, v[3], `voor ${v[0]}`, data);
            return { skip: `${c.name} (${v[0]}): ${reasons.join('; ') || 'geen geschikt gebouw'}` };
        }

        // "Drone Team Politie Drone Team Politie Voertuigen: DB-DRONE Parkeerplaatsen: ..."
        const extName = (text) => {
            const head = String(text).split(/\s(?:Voertuigen:|Parkeerplaatsen:|Biedt|Deze uitbreiding)/)[0].trim();
            const half = head.slice(0, Math.floor(head.length / 2)).trim();
            return half && head === `${half} ${half}` ? half : head;
        };
        const extVehicle = (text) => {
            const list = (String(text).match(/Voertuigen:\s*(.+?)\s*(?:Parkeerplaatsen|$)/) || [])[1];
            if (!list) return null;
            for (const n of list.split(/,\s*|\s+en\s+/)) {
                const vt = vehiclesFor(n.trim())[0];
                if (vt != null) { (state.extVt = state.extVt || {})[extName(text)] = vt; return vt; }
            }
            return null;
        };
        // Extensions still being built (bought here or by hand) whose vehicle the building
        // does not have yet and no project trains for: give them a crew project.
        const EXT_VT = { 'Drone Team Politie': 128, 'Mobiele Eenheid, Aanhoudingseenheid': 64, 'Waterwerper Uitbreiding': 84, 'Waterwerper': 84, 'Bereden Brigade': 73 };
        // Stations without a single vehicle and no project (a build whose follow-up got
        // lost, like Ambulancepost Nijmegen Centrum): give them their first vehicle.
        const EMPTY_KIND = { 0: 'brandweerkazerne', 17: 'brandweerkazerne', 5: 'politiebureau', 18: 'politiebureau', 3: 'ambulancepost', 13: 'ambulancepost' };
        function emptySweep(data) {
            if (!ctx.cfg.doVehicles) return;
            for (const b of data.buildings) {
                const kind = EMPTY_KIND[b.building_type];
                if (!kind || b.enabled === false) continue;
                if (data.vehicles.some((v) => v.building_id === b.id) || projects().some((p) => p.building === b.id)) continue;
                const first = GROW_FILL[kind].first;
                projects().push(ctx.cfg.buildMode
                    ? { building: b.id, caption: b.caption, vt: first, need: `Groei: ${kind}`, stage: 'grow', kind, levels: 0, people: [], started: Date.now() }
                    : { building: b.id, caption: b.caption, vt: first, need: `Groei: ${kind}`, stage: 'buy', people: [], started: Date.now() });
                addLog(`project: eerste voertuig voor ${b.caption} (nog geen voertuigen)`, 'idle');
            }
        }
        function prepSweep(data) {
            for (const b of data.buildings) {
                for (const x of b.extensions || []) {
                    if (x.available !== false) continue;
                    const vt = (state.extVt || {})[x.caption] ?? EXT_VT[x.caption];
                    if (vt == null || !VT[vt]) continue;
                    if (data.vehicles.some((v) => v.building_id === b.id && v.vehicle_type === vt)) continue;
                    const made = prepProject(b, vt, `uitbreiding ${x.caption}`);
                    if (made.length) { projects().push(...made); addLog(`project: personeel voor ${VT[vt][0]} in ${b.caption} (uitbreiding ${x.caption} wordt gebouwd)`, 'idle'); }
                }
            }
        }
        // After buying an extension that brings a vehicle: a project that trains its crew
        // now, while the extension is being built, then buys and links (see advanceProjects).
        // Several per building are fine (Drone Team and ME-AE at Veenendaal): each has its
        // own vehicle and its own people; only the same vehicle twice is not.
        const prepProject = (b, vt, need) => (vt == null || projects().some((p) => p.building === b.id && p.vt === vt) ? []
            : [{ building: b.id, caption: b.caption, vt, need, stage: 'prep', ext: true, people: [], started: Date.now() }]);

        // Staff a building still has for one more vehicle: its people minus the crews of
        // its vehicles and of the vehicles its running projects will buy.
        function staffLeft(b, data) {
            const crews = data.vehicles.filter((x) => x.building_id === b.id).reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
            const planned = projects().filter((p) => p.building === b.id && p.stage !== 'assign').reduce((sum, p) => sum + crewOf(p.vt), 0);
            return (b.personal_count || 0) - crews - planned;
        }
        async function planExtension(c, data, tries = 3) {
            const ref = c.at || data.home;
            const own = data.buildings.filter((b) => c.types.includes(b.building_type))
                .map((b) => ({ b, d: km(posOf(b), ref) })).sort((a, b) => a.d - b.d).slice(0, tries);
            const why = [];
            const fits = [];
            let upgrade = null; // a small station where this extension failed: upgrade it if nothing else fits
            for (const { b, d } of own) {
                const info = await buildingInfo(b.id);
                const ext = info.exts.find((e) => c.match.test(e.text));
                if (!ext || !ext.cost || !ctx.cfg.doExtensions) continue;
                const blockedHow = extBlocked(b, ext);
                if (blockedHow === 'small') {
                    const evt = extVehicle(ext.text);
                    const crewOk = evt == null || staffLeft(b, data) >= crewOf(evt);
                    if (!upgrade && crewOk && !upgrading(b) && info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && !projects().some((p) => p.building === b.id)) upgrade = { b, se: info.smallExpand, ext };
                    why.push(`${b.caption}: uitbreiding lukte niet, klein station${upgrading(b) ? ' (wordt uitgebouwd)' : ', eerst uitbouwen tot groot'}`);
                    continue;
                }
                if (blockedHow === 'failed') { why.push(`${b.caption}: lukte eerder niet`); continue; }
                const vt = extVehicle(ext.text);
                // The vehicle needs people: this building must have them to spare. Four
                // extensions went to Veenendaal (15 people needed) because it was nearest.
                const left = staffLeft(b, data);
                if (vt != null && left < crewOf(vt)) { why.push(`${b.caption}: personeel ${Math.max(0, left)}/${crewOf(vt)} over`); continue; }
                // No parking of its own ("Maakt het mogelijk om STH voertuigen te kopen."):
                // the vehicles use normal spots, so a full building at its top level is no use.
                if (vt != null && !/Parkeerplaatsen/i.test(ext.text) && info.used != null && info.max != null && info.used >= info.max
                    && !(ctx.cfg.doLevels && await nextLevel(b.id))) { why.push(`${b.caption}: vol, hoogste level`); continue; }
                fits.push({ b, d, ext, vt, left });
            }
            // Among the buildings that can take it: the most spare people first, then the nearest.
            fits.sort((x, y) => (y.left - x.left) || (x.d - y.d));
            const f = fits[0];
            if (f) {
                return extStep(f.b, f.ext, `uitbreiding "${extName(f.ext.text)}" in ${f.b.caption}`, { projects: prepProject(f.b, f.vt, c.name) });
            }
            if (upgrade) return upgradeStep(upgrade.b, upgrade.se, `uitbreiding "${extName(upgrade.ext.text)}" lukte niet in de kleine post`);
            return { skip: `${c.name}: ${why.join('; ') || 'geen gebouw in de buurt om uit te breiden'}` };
        }

        // New mission types: an extension where one can be bought (cheaper), else a
        // new building near the dispatch centre.
        async function planUnlock(c, data) {
            const why = `${c.unlockCount} nieuwe meldingen, o.a. ${c.examples.slice(0, 2).join(', ')}`;
            if (c.def.ext && ctx.cfg.doExtensions) {
                // Which building type sells this extension is learned once (the nearest
                // building of every own type is looked at) and remembered, e.g. Drone
                // Team Politie and Aanhoudingseenheid: Politiebureau (type 11).
                state.extTypes = state.extTypes || {};
                let types = state.extTypes[c.key];
                if (!types) {
                    const ref = data.home;
                    const firstOfType = {};
                    for (const b of data.buildings) {
                        if (SCHOOL_TYPES.includes(b.building_type) || b.building_type === 1) continue;
                        const cur = firstOfType[b.building_type];
                        if (!cur || km(posOf(b), ref) < km(posOf(cur), ref)) firstOfType[b.building_type] = b;
                    }
                    types = [];
                    for (const b of Object.values(firstOfType)) {
                        if ((await buildingInfo(b.id)).exts.some((e) => c.def.ext.test(e.text))) types.push(b.building_type);
                    }
                    // Not offered anywhere (yet): look again in a day.
                    if (types.length) state.extTypes[c.key] = types;
                    else state.cool[c.name] = Date.now() + 24 * 3600000;
                }
                if (types.length) {
                    const ext = await planExtension({ ...c, types, match: c.def.ext, at: data.home }, data, 12);
                    if (!ext.skip) return { ...ext, label: `${ext.label} (${why})` };
                    if (!c.def.types || !ctx.cfg.doBuild) return { skip: `${c.name}: alle ${ext.skip.split(': ').pop()}` };
                }
            }
            if (c.def.types && ctx.cfg.doBuild) return planBuilding({ ...c, at: data.home }, c.def.types, why, data, 80);
            return { skip: `${c.name}: geen eigen gebouw biedt deze uitbreiding aan${c.def.types ? '' : ' (en het is geen los gebouw)'}` };
        }

        // Real posts from the Plaatsingsadvies data (1x1 degree tiles on GitHub).
        const CAT_OF = { 0: 'F', 17: 'F', 3: 'A', 13: 'A', 2: 'H', 5: 'P', 11: 'P', 18: 'P', 6: 'L', 9: 'L', 21: 'L', 16: 'W', 19: 'W', 22: 'R', 24: 'T', 25: 'M' };
        const tiles = {};
        async function postsNear(at) {
            const out = [];
            for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
                const key = `${Math.floor(at[0]) + dl}_${Math.floor(at[1]) + dn}`;
                if (!(key in tiles)) {
                    try { tiles[key] = (await (await fetch(`${DATA_BASE}${key}.json`)).json()).posts || []; } catch (e) { tiles[key] = []; }
                }
                out.push(...tiles[key]);
            }
            return out;
        }
        /* Schools: trainings that wait for a classroom are counted per school type each
         * round. Blocked for 2 hours or more: an "Extra klaslokaal" at an own school of
         * that type (400k, 7 days), or when none can be added, a new academy (500k). */
        const schoolFor = (vt) => {
            const t = (VT[vt] || [])[3] || [];
            if (t.some((x) => [5, 11, 18].includes(x))) return 8;      // police academy
            if (t.some((x) => [0, 17].includes(x))) return 4;          // fire academy
            if (t.some((x) => [2, 3, 6, 13].includes(x))) return 7;    // medical faculty
            if (t.some((x) => [16, 19, 21].includes(x))) return 20;    // SAR academy
            if (t.includes(25)) return 26;                             // military academy
            return null;
        };
        const SCHOOL_NAME = { 4: 'brandweeracademie', 7: 'faculteit geneeskunde', 8: 'politieacademie', 20: 'SAR academie', 26: 'militaire academie' };
        const SCHOOL_CAT = { 4: 'F', 7: 'H', 8: 'P', 20: 'W', 26: 'M' };
        let blocked = {};
        function markBlocked(vt, value) {
            const t = schoolFor(vt);
            if (t == null) return;
            blocked[t] = (blocked[t] || 0) + (value || 20000);
        }
        function updateBlocked() {
            state.classBlocked = state.classBlocked || {};
            for (const t of Object.keys(state.classBlocked)) if (!blocked[t]) delete state.classBlocked[t];
            for (const [t, v] of Object.entries(blocked)) state.classBlocked[t] = { since: (state.classBlocked[t] || {}).since || Date.now(), value: v };
        }
        async function planSchools(data) {
            const out = [];
            for (const [t, b] of Object.entries(state.classBlocked || {})) {
                const type = Number(t);
                const hours = (Date.now() - b.since) / 3600000;
                if (hours < 2) continue;
                const need = `Klaslokalen ${SCHOOL_NAME[type] || type}`;
                if ((state.cool[need] || 0) > Date.now()) continue;
                // Classrooms are used again and again: value the blocked trainings three times.
                const value = b.value * 3;
                const why = `opleidingen wachten al ${Math.floor(hours)} u op een klaslokaal`;
                const schools = data.buildings.filter((x) => x.building_type === type);
                if (schools.some((x) => (x.extensions || []).some((e) => /klaslokaal/i.test(e.caption || '') && e.available === false))) continue; // one is coming
                let plan = null;
                for (const sb of schools) {
                    const info = await buildingInfo(sb.id);
                    const ext = info.exts.find((e) => /klaslokaal/i.test(e.text) && e.cost);
                    if (ext && ctx.cfg.doExtensions) {
                        plan = { label: `extra klaslokaal in ${sb.caption} (${why})`, cost: ext.cost,
                            run: () => hit(ext.href, true), check: async () => !(await buildingInfo(sb.id)).exts.some((e) => e.id === ext.id) };
                        break;
                    }
                }
                if (!plan && ctx.cfg.doBuild) {
                    const p = await planBuilding({ name: need, at: data.home }, [type], why, data, 60, { cat: SCHOOL_CAT[type], prefix: SCHOOL_NAME[type] });
                    if (!p.skip) plan = p;
                    else skipped.push(p.skip);
                }
                if (plan) out.push({ ...plan, need, value, ratio: value / Math.max(plan.cost, 2000) });
            }
            return out;
        }

        /* Growth: more buildings, more missions. Per kind (fire, police, ambulance) the
         * free real post nearest to any own building (3 km at least from the own ones
         * of that kind, no limit from the dispatch centre), valued at the average weekly
         * income per building. After building it, a project buys its first vehicle. */
        // The small kinds (Brandweerkazerne (klein), Politieopkomstbureau (klein)) are
        // cheaper: fewer parking spots, but more new areas for the money. Both go into the
        // ranking; the better return wins. No wait between builds: a spot just built on is
        // skipped for 30 minutes instead (recentSpots), as the API can lag behind.
        const GROW = [
            { types: [0, 17], same: [0, 17], vt: 1, name: 'brandweerkazerne' },
            { types: [5, 18], same: [5, 11, 18], vt: 22, name: 'politiebureau' },
            { types: [3, 13], same: [3, 13], vt: 16, name: 'ambulancepost' }, // 13 = Ambulance, VWS-post (100k vs 200k)
        ];
        // Build mode: per kind the levels its first staff can man and its first vehicle
        // (fire: TST 4/5, ambulance post: ambulance, police: DA Noodhulp). The rest of
        // the spots: the most valuable shortage that fits and needs no training.
        const GROW_FILL = {
            brandweerkazerne: { levels: 2, first: 8 },
            ambulancepost: { levels: 1, first: 16 },
            politiebureau: { levels: 0, first: 22 },
        };
        // Spots built on in the last 30 minutes: the API can take a while to list the new
        // building, and without this the next round could build on the same post again.
        function recentSpots() {
            state.recentSpots = (state.recentSpots || []).filter((x) => Date.now() - x[2] < 30 * 60000);
            return state.recentSpots.map((x) => [x[0], x[1]]);
        }
        // A city name -> its centre and outline box (OpenStreetMap Nominatim), kept for a week.
        async function cityArea(name) {
            const key = name.toLowerCase();
            state.cities = state.cities || {};
            let c = state.cities[key];
            if (!c || Date.now() - c.at > 7 * 86400000) {
                try {
                    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de&q=${encodeURIComponent(name)}`;
                    const r = (await (await fetch(url)).json())[0];
                    c = r ? { at: Date.now(), center: [Number(r.lat), Number(r.lon)], box: r.boundingbox.map(Number), name: r.display_name.split(',')[0] } : null;
                } catch (e) { c = null; }
                if (!c) { skipped.push(`Bouwmodus: stad "${name}" niet gevonden`); return null; }
                state.cities[key] = c;
            }
            // boundingbox = [south, north, west, east]; a little margin for posts on the edge.
            const [s, n, w, e] = c.box;
            const m = 0.005;
            return { name: c.name, center: c.center, inside: (p) => p[0] >= s - m && p[0] <= n + m && p[1] >= w - m && p[1] <= e + m };
        }
        async function planGrow(data) {
            const out = [];
            if (!ctx.cfg.buildMode && !ctx.cfg.doGrow) return out;
            if (!ctx.cfg.buildMode && !ctx.cfg.doBuild) { skipped.push('Groei: "Nieuwe gebouwen" staat uit'); return out; }
            const rate = incomeRate();
            if (!rate || !rate.perHour) return out;
            const withVehicles = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type)).length || 1;
            const value = (rate.perHour * 168) / withVehicles;
            // Real posts around every own building (1x1 degree tiles, each fetched once).
            const seen = new Set();
            const posts = [];
            for (const b of data.buildings) {
                const key = `${Math.floor(Number(b.latitude))}_${Math.floor(Number(b.longitude))}`;
                if (seen.has(key)) continue;
                seen.add(key);
                for (const p of await postsNear(posOf(b))) posts.push(p);
            }
            // Build mode with a city: its free real posts first, nearest to its centre.
            const city = ctx.cfg.buildMode && String(ctx.cfg.buildCity || '').trim() ? await cityArea(String(ctx.cfg.buildCity).trim()) : null;
            if (city) for (const p of await postsNear(city.center)) posts.push(p);
            const uniq = [...new Set(posts)]; // neighbouring tiles overlap
            const owned = [...data.buildings.map(posOf), ...recentSpots()];
            for (const g of GROW) {
                const need = `Groei: ${g.name}`;
                if ((state.cool[need] || 0) > Date.now()) continue;
                // Plus ones of this kind built in the last 30 minutes that the API may not list yet.
                const mine = [...data.buildings.filter((b) => g.same.includes(b.building_type)).map(posOf),
                    ...(state.recentSpots || []).filter((x) => x[3] === CAT_OF[g.types[0]]).map((x) => [x[0], x[1]])];
                let best = null;
                if (city) {
                    for (const p of uniq) {
                        if (p[2] !== CAT_OF[g.types[0]] || !city.inside(p)) continue;
                        const at = [p[0], p[1]];
                        if (owned.some((o) => km(o, at) < 0.3)) continue;
                        const mid = km(city.center, at);
                        if (!best || mid < best.mid) best = { at, mid, why: `${city.name}: ${mid.toFixed(1)} km van het centrum` };
                    }
                    if (!best) skipped.push(`Groei: ${g.name}: geen vrije echte post meer in ${city.name}, verder rond je gebouwen`);
                }
                if (!best) for (const p of uniq) {
                    if (p[2] !== CAT_OF[g.types[0]]) continue;
                    const at = [p[0], p[1]];
                    if (owned.some((o) => km(o, at) < 0.3)) continue;
                    // Not on top of one of this kind (3 km at least, so it covers new ground),
                    // and of those the one nearest to anything you have: the network grows
                    // outward step by step instead of jumping to far gaps (long drives).
                    const gap = mine.length ? Math.min(...mine.map((o) => km(o, at))) : 99;
                    if (gap < 3) continue;
                    const near = Math.min(...owned.map((o) => km(o, at)));
                    if (!best || near < best.near) best = { at, gap, near, why: `groei: ${near.toFixed(1)} km van je dichtstbijzijnde gebouw, ${gap.toFixed(1)} km van je dichtstbijzijnde ${g.name}` };
                }
                if (!best) continue;
                // Full-size and small for the same spot: only the better return goes on the list.
                let pick = null;
                for (const type of g.types) {
                    const plan = await planBuilding({ name: need, at: best.at }, [type], best.why, data, 0.5);
                    if (plan.skip) { skipped.push(plan.skip); continue; }
                    if (pick && plan.cost >= pick.cost) continue;
                    const run = plan.run;
                    // Build mode: new posts win outright, taking turns between fire, police and
                    // ambulance (else the 100k VWS-post would always be cheapest).
                    const boost = !ctx.cfg.buildMode ? 1 : g.name === state.growLast ? 100 : 1000;
                    pick = { ...plan, need, value, ratio: (boost * value) / Math.max(plan.cost, 2000),
                        run: async () => {
                            const before = new Set(data.buildings.map((b) => b.id));
                            await run();
                            state.growLast = g.name;
                            await sleep(1500);
                            // Its first vehicle as a project: bought as soon as the game sells it.
                            // The API lists small ones as the normal kind with small_building set.
                            const kind = { 17: 0, 18: 5, 13: 3 }[type] ?? type;
                            let nb = null;
                            for (let i = 0; i < 10 && !nb; i++) {
                                nb = (await api('/api/buildings')).find((b) => !before.has(b.id) && (b.building_type === type || b.building_type === kind));
                                if (!nb) await sleep(2000);
                            }
                            if (nb && ctx.cfg.buildMode) projects().push({ building: nb.id, caption: nb.caption, vt: g.vt, need, stage: 'grow', kind: g.name, levels: 0, people: [], started: Date.now() });
                            else if (nb) projects().push({ building: nb.id, caption: nb.caption, vt: g.vt, need, stage: 'buy', people: [], started: Date.now() });
                        } };
                }
                if (pick) out.push(pick);
            }
            return out;
        }

        // A new building of one of these types on the nearest free real post.
        const NO_NEW_BUILDING = new Set([6, 9, 21, 23, 24]); // trauma, police and SAR helicopters, military hangar, tow trucks
        async function planBuilding(c, buildTypes, why, data, maxKm = ctx.cfg.nearKm * 2, opts = {}) {
            const type = buildTypes.find((t) => CAT_OF[t] && ![17, 18].includes(t)) ?? buildTypes[0];
            // Helicopter bases and tow-truck posts: the OSM data does not place these well
            // enough yet. Never built new; existing ones still get levels and vehicles.
            if (NO_NEW_BUILDING.has(type)) return { skip: `${c.name}: geen nieuw gebouw voor dit type (helikopter/berger), alleen bestaande uitbreiden` };
            const cat = opts.cat || CAT_OF[type];
            if (!cat) return { skip: `${c.name}: geen echte post voor gebouwtype ${type}` };
            const owned = [...data.buildings.map(posOf), ...recentSpots()];
            const posts = (await postsNear(c.at)).filter((p) => p[2] === cat)
                .map((p) => ({ p, d: km([p[0], p[1]], c.at) }))
                .filter((x) => x.d <= maxKm && !owned.some((o) => km(o, [x.p[0], x.p[1]]) < 0.3))
                .sort((a, b) => a.d - b.d);
            if (!posts.length) return { skip: `${c.name}: geen vrije echte post binnen ${maxKm} km` };
            const post = posts[0].p;
            const bname = opts.prefix ? `${opts.prefix[0].toUpperCase()}${opts.prefix.slice(1)} ${post[3]}` : post[3];
            const doc = await getDoc('/buildings/new');
            const form = [...doc.forms].find((f) => /\/buildings$/.test(f.getAttribute('action') || ''));
            const btn = form && form.querySelector(`#build_credits_${type}`);
            if (!btn) return { skip: `${c.name}: gebouwtype ${type} niet te bouwen` };
            const cost = num(btn.value);
            return {
                label: `nieuw gebouw "${bname}" (${posts[0].d.toFixed(1)} km, ${why})`, cost, newBuilding: true,
                run: () => {
                    const fd = new FormData(form);
                    fd.set('building[building_type]', String(type));
                    fd.set('building[name]', bname);
                    fd.set('building[latitude]', String(post[0]));
                    fd.set('building[longitude]', String(post[1]));
                    fd.set('build_with_coins', '');
                    const ls = [...form.querySelectorAll('select[name="building[leitstelle_building_id]"] option')].find((o) => o.value);
                    if (ls) fd.set('building[leitstelle_building_id]', ls.value);
                    fd.set('commit', btn.value);
                    state.recentSpots = [...(state.recentSpots || []), [post[0], post[1], Date.now(), post[2]]];
                    save(); // a reload during the purchase must not lose it
                    return hit('/buildings', new URLSearchParams(fd));
                },
                // One building more than before (the price check failed for the VWS-post,
                // which always costs 100,000). The API can lag, so look a few times.
                check: async () => {
                    // One building more, or the credits went down by about its price: the API
                    // can take well over 10 seconds to list a new building.
                    for (let i = 0; i < 8; i++) {
                        if ((await api('/api/buildings')).length > data.buildings.length) return true;
                        const c = await api('/api/credits');
                        if (Number(c.credits_user_current) <= data.credits - cost * 0.9) return true;
                        await sleep(3000);
                    }
                    return false;
                },
            };
        }

        /* ========================================================================
         * HIRING — free, so done for every building that needs it, each round:
         * "Personeel (Doel)" to the target and the hiring phase on "Automatisch".
         * ==================================================================== */
        const NO_STAFF = new Set([1, 2, 4, 7, 8, 10, 20, 26]);
        async function fixHiring(data) {
            let n = 0;
            for (const b of data.buildings) {
                if (n >= 10 || stopped) break;
                if (NO_STAFF.has(b.building_type) || !('personal_count_target' in b)) continue;
                const target = ctx.cfg.hireTarget;
                if (b.personal_count_target === target && b.hiring_automatic) continue;
                try {
                    if (b.personal_count_target !== target) {
                        const doc = await getDoc(`/buildings/${b.id}/personalCountTarget`);
                        const form = doc.forms[0];
                        const fd = new FormData(form);
                        fd.set('building[personal_count_target]', String(target));
                        await hit(form.getAttribute('action'), new URLSearchParams(fd));
                    }
                    if (!b.hiring_automatic) await hit(`/buildings/${b.id}/hire_do/automatic`);
                    addLog(`werving: ${b.caption} op automatisch, doel ${target}`, 'idle');
                } catch (e) {
                    addLog(`werving mislukt: ${b.caption} (${e.message})`, 'warn');
                }
                n++;
                await sleep(800);
            }
        }

        /* ========================================================================
         * ROUND — hiring, then one purchase if the credits allow it.
         * ==================================================================== */
        /* Income per hour, for when a saved-for step can be paid: the samples of the
         * Inkomsten module ([seconds, balance, total earned], shared GM storage) over
         * the last 7 days per wall-clock hour, so offline hours count too. Without
         * them, its own samples of the total earned (one per round). */
        function incomeRate() {
            const from = Date.now() / 1000 - 7 * 86400;
            let samples = [];
            try { samples = (JSON.parse(GM_getValue('incomeTracker.samples.v1', '[]')) || []).filter((x) => x[0] >= from); } catch (e) { /* none */ }
            let src = 'Inkomsten';
            if (samples.length < 2) { samples = (state.earn || []).filter((x) => x[0] >= from).map((x) => [x[0], 0, x[1]]); src = 'eigen metingen'; }
            if (samples.length < 2) return null;
            const a = samples[0];
            const b = samples[samples.length - 1];
            const hours = (b[0] - a[0]) / 3600;
            if (hours < 1) return null;
            return { perHour: Math.max(0, (b[2] - a[2]) / hours), hours, src };
        }
        function recordEarn(total) {
            if (!Number.isFinite(Number(total))) return;
            state.earn = state.earn || [];
            const now = Math.floor(Date.now() / 1000);
            const last = state.earn[state.earn.length - 1];
            if (last && now - last[0] < 600) return;
            state.earn.push([now, Number(total)]);
            if (state.earn.length > 1100) state.earn.splice(0, state.earn.length - 1100);
        }
        // How long until "cost" can be paid with the buffer kept: null = now.
        function etaFor(cost, credits) {
            const missing = ctx.cfg.buffer + cost - credits;
            if (missing <= 0) return { now: true };
            const rate = incomeRate();
            if (!rate || !rate.perHour) return { unknown: true, missing };
            const ms = (missing / rate.perHour) * 3600000;
            return { ms, at: Date.now() + ms, missing };
        }
        function etaText(e) {
            if (!e || e.now) return 'nu';
            if (e.unknown) return 'onbekend';
            const m = Math.round(e.ms / 60000);
            const span = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${Math.round(m / 1440)} dagen`;
            const at = new Date(e.at).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            return `~${span} (${at})`;
        }

        async function loadData() {
            const [buildings, vehicles, credits] = await Promise.all([api('/api/buildings'), api('/api/vehicles'), api('/api/credits')]);
            const byId = Object.fromEntries(buildings.map((b) => [b.id, b]));
            const ls = buildings.find((b) => b.building_type === 1) || buildings[0];
            return { buildings, vehicles, byId, credits: credits.credits_user_current, total: credits.credits_user_total, home: ls ? posOf(ls) : [52.1, 5.3] };
        }

        async function round() {
            if (busy || stopped) return;
            const other = lockHolder();
            if (other) {
                const ago = (t) => `${Math.round((Date.now() - t) / 1000)} s`;
                const who = other.since ? ` (pagina ${other.url}, versie ${other.version}, gestart ${ago(other.since)} geleden)` : ' (oude versie, of de vorige pagina is net herladen)';
                ctx.status(`Draait al in een ander tabblad${who}. Nieuwe poging over 40 seconden.`, { tone: 'warn' });
                addLog(`wacht op ander tabblad${who}`, 'warn');
                setTimeout(() => { if (!stopped) round(); }, 40000);
                return;
            }
            busy = true;
            takeLock();
            try {
                const data = await loadData();
                if (ctx.cfg.doHire) await fixHiring(data);
                const spendable = data.credits - ctx.cfg.buffer;
                recordEarn(data.total);
                skipped = [];
                blocked = {};
                eduCache = null;
                prepSweep(data);
                emptySweep(data);
                // Running projects first: their free steps now, their paid step before new needs.
                next = await advanceProjects(data);
                if (!next) {
                    if (Date.now() - unlocksAt > 3600000) { await computeUnlocks(data); unlocksAt = Date.now(); }
                    // Plan the most valuable needs, then take the step with the most blocked
                    // credits per credit spent (a free training step wins outright).
                    ranking = [];
                    const cands = candidates(readNeeds());
                    if (ctx.cfg.doVehicles) {
                        await scanSpots(data);
                        for (const r of await planSpots(cands, data)) ranking.push(r);
                    }
                    for (const c of cands.slice(0, ctx.cfg.planDepth)) {
                        if (stopped) return;
                        const plan = c.kind === 'ext' ? await planExtension(c, data)
                            : c.kind === 'unlock' ? await planUnlock(c, data) : await planVehicle(c, data);
                        if (plan.skip) { skipped.push(plan.skip); continue; }
                        ranking.push({ need: c.name, value: c.value, ...plan, ratio: c.value / Math.max(plan.cost, 2000) });
                    }
                    updateBlocked();
                    for (const r of await planSchools(data)) ranking.push(r);
                    for (const r of await planGrow(data)) ranking.push(r);
                    ranking.sort((a, b) => b.ratio - a.ratio);
                    for (const r of ranking) r.eta = etaFor(r.cost, data.credits);
                    next = ranking[0] || null;
                }
                // Saved, so Log naar GitHub uploads them from any tab.
                state.lastRound = { at: Date.now(), credits: data.credits, spendable, skipped,
                    spots: { scanned: Object.keys(state.spots || {}).length, free: Object.values(state.spots || {}).filter((f) => f.max > f.used).length }, next: next ? { label: next.label, cost: next.cost, need: next.need } : null,
                    ranking: ranking.map(({ need, label, cost, value, ratio, eta }) => ({ need, label, cost, value: Math.round(value || 0), ratio: Math.round((ratio || 0) * 1000) / 1000, eta: etaText(eta) })),
                    income: incomeRate(), classBlocked: state.classBlocked };
                if (!next) {
                    ctx.status(skipped.length ? 'Niets te kopen nu (zie "Overgeslagen").' : 'Geen tekorten om op te lossen.', { tone: 'idle' });
                    return;
                }
                if (next.cost > spendable) {
                    state.lastRound.result = `spaart: ${next.cost} nodig, ${Math.max(0, spendable)} vrij boven de buffer`;
                    const eta = etaText(etaFor(next.cost, data.credits));
                    state.lastRound.eta = eta;
                    ctx.status(`Spaart voor ${next.label}: ${ctx.nl(next.cost)} nodig, ${ctx.nl(Math.max(0, spendable))} vrij boven de buffer. Genoeg over ${eta}.`, { tone: 'idle' });
                    return;
                }
                ctx.status(`Bezig: ${next.label}`, { tone: 'busy', dock: true });
                lastSaid = '';
                await next.run();
                await sleep(1500);
                // Checked on the game's pages: /api/buildings and /api/credits lag behind
                // (tested: a bought level and ambulance only showed there later).
                if (await next.check()) {
                    failStreak = 0;
                    unlocksAt = 0; // what is unlocked may have changed
                    // A new building: plan its vehicle again soon, not after half an hour.
                    // Growth has no wait: the next post may follow at once (recentSpots keeps it off this one).
                    if (!String(next.need).startsWith('Groei:')) state.cool[next.need] = Math.max(state.cool[next.need] || 0, Date.now() + (next.newBuilding ? 5 : 30) * 60000);
                    if (next.cost) {
                        state.bought = state.bought || {};
                        const list = (state.bought[next.need] = (state.bought[next.need] || []).filter((x) => x > Date.now() - 7 * 86400000));
                        list.push(Date.now());
                    }
                    addLog(`${next.cost ? 'gekocht' : 'gestart'}: ${next.label}`, 'ok', next.cost);
                    ctx.status(`Gedaan: ${next.label}`, { tone: 'ok' });
                    state.lastRound.result = 'gedaan';
                    // Training started: a new project. Vehicle bought for trained people
                    // (now, or the buy step of a project): find it and assign them next.
                    if (next.done) next.done();
                    for (const p of next.projects || []) if (!projects().includes(p)) projects().push(p);
                    const people = next.project && next.project.stage === 'buy' ? next.project.people : next.people;
                    if (next.project && next.project.stage === 'buy' && !(people && people.length)) {
                        state.projects = projects().filter((x) => x !== next.project);
                    } else if (people && people.length && next.before) {
                        const fresh = (await buildingInfo(next.building)).vehicleIds.filter((id) => !next.before.includes(id));
                        if (fresh.length) {
                            const p = next.project && next.project.stage === 'buy' ? next.project
                                : { building: next.building, caption: data.byId[next.building]?.caption, vt: next.vt, training: VT[next.vt]?.[4], need: next.need, started: Date.now() };
                            Object.assign(p, { stage: 'assign', vehicle: fresh[fresh.length - 1], people, assignTries: 0 });
                            if (!projects().includes(p)) projects().push(p);
                        }
                    }
                } else {
                    state.cool[next.need] = Date.now() + 60 * 60000;
                    const why = (next.onFail && await next.onFail()) || {};
                    addLog(`niet gelukt: ${next.label}${lastSaid ? ` (spel: "${lastSaid}")` : ''}${why.note ? ` — ${why.note}` : ''}`, why.known ? 'warn' : 'error');
                    if (state.lastRound) state.lastRound.result = 'niet gelukt';
                    // A failure the script understands (an extension a small station cannot
                    // have yet) is handled, not a reason to stop everything.
                    if (!why.known && ++failStreak >= 3) { stopped = true; ctx.status('Gestopt na 3 mislukte aankopen op rij. Zet de module uit en aan om opnieuw te starten.', { tone: 'error' }); }
                }
            } catch (e) {
                ctx.err(e);
                addLog(`fout: ${e.message}`, 'error');
            } finally {
                busy = false;
                save();
                ctx.refresh();
            }
        }

        // One tab at a time (heartbeat in localStorage, like Automatisch alarmeren).
        function lockHolder() {
            try {
                const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                return l && l.inst !== INSTANCE && Date.now() - l.at < 30000 ? l : null;
            } catch (e) { return null; }
        }
        const takeLock = () => { try { localStorage.setItem(LOCK_KEY, JSON.stringify({ inst: INSTANCE, at: Date.now(), since: STARTED, url: location.pathname + location.search, version: '1.7.0.20261009170800' })); } catch (e) { /* ignore */ } };
        const heartbeat = setInterval(() => { if (!lockHolder()) takeLock(); }, 10000);
        // Let go on reload or close, or the reloaded page waits 30 s for its own old lock
        // ("Draait al in een ander tabblad" with only one tab open).
        const releaseLock = () => { try { const l = JSON.parse(localStorage.getItem(LOCK_KEY)); if (l && l.inst === INSTANCE) localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ } };
        window.addEventListener('pagehide', releaseLock);

        ctx.panel((el) => {
            const day = new Date().toISOString().slice(0, 10);
            const tone = { ok: 't-ok', warn: 't-warn', error: 't-error', idle: '' };
            const wishes = Object.entries(state.wishes).sort((a, b) => b[1] - a[1]);
            el.innerHTML = `<div class="mks-tiles">
                    <div class="mks-tile"><div class="v">${ctx.nl(state.spent[day] || 0)}</div><div class="k">uitgegeven vandaag</div></div>
                    <div class="mks-tile"><div class="v">${ctx.nl(ctx.cfg.buffer)}</div><div class="k">buffer</div></div>
                </div>
                ${projects().length ? `<h4 class="mks-h">Projecten (opleiden → kopen → koppelen)</h4>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Voertuig</th><th>Gebouw</th><th>Stap</th><th>Sinds</th></tr></thead><tbody>
                    ${projects().map((p) => `<tr><td>${esc(VT[p.vt]?.[0] || p.vt)}</td><td>${esc(p.caption || '')}</td>
                        <td>${{ train: `opleiding ${esc(p.training || '')} (${p.people.length} pers.)`, buy: 'kopen', assign: 'personeel koppelen' }[p.stage] || p.stage}${p.wait ? ` <span class="mks-dim">— ${esc(p.wait)}</span>` : ''}</td>
                        <td class="mono mks-dim">${new Date(p.started).toLocaleDateString('nl-NL')}</td></tr>`).join('')}</tbody></table></div>` : ''}
                ${ranking.length ? `<h4 class="mks-h">Afweging (beste rendement eerst)</h4>
                    <p class="mks-note">Waarde = credits van inzetten die hierdoor misten in 7 dagen (speciale voertuigen ×${ctx.cfg.specialWeight}),
                    of van nieuwe meldingsoorten. Rendement = waarde per uitgegeven credit.</p>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Stap</th><th>Waarde</th><th>Kosten</th><th>Rendement</th><th>Te betalen</th></tr></thead><tbody>
                    ${ranking.map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${ctx.nl(r.value)}</td><td class="mono">${ctx.nl(r.cost)}</td>
                        <td class="mono">${r.cost ? r.ratio.toFixed(2) : 'gratis'}</td><td class="mono">${r.cost ? esc(etaText(r.eta)) : 'nu'}</td></tr>`).join('')}</tbody></table></div>` : ''}
                <h4 class="mks-h">Volgende stap</h4>
                <p class="mks-note">${next ? `${esc(next.label)} — ${ctx.nl(next.cost)} credits` : 'Nog niets gepland.'}</p>
                ${(() => { const r = incomeRate(); return `<p class="mks-note">Inkomen: ${r ? `${ctx.nl(r.perHour)} credits per uur (gemiddeld over ${Math.round(r.hours)} u, ${esc(r.src)})` : 'nog onbekend (zet Inkomsten aan, of wacht een uur)'}. "Te betalen" = wanneer er genoeg is met de buffer erbij.</p>`; })()}
                ${skipped.length ? `<h4 class="mks-h">Overgeslagen</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${skipped.map((s) => `<tr><td>${esc(s)}</td></tr>`).join('')}</tbody></table></div>` : ''}
                ${wishes.length ? `<h4 class="mks-h">Opleidingen nodig</h4>
                    <p class="mks-note">Voertuigen die het niet kocht omdat opgeleid personeel ontbrak. Start deze opleidingen (nog niet automatisch).</p>
                    <div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${wishes.map(([n, k]) => `<tr><td>${esc(n)}</td><td class="mono">${k}</td></tr>`).join('')}</tbody></table></div>` : ''}
                <h4 class="mks-h">Logboek</h4>
                ${state.log.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${state.log.slice(0, 100).map((l) => `<tr><td class="mono">${new Date(l.at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td><span class="mks-pill ${tone[l.tone] || ''}">${esc(l.text)}</span></td><td class="mono">${l.cost ? ctx.nl(l.cost) : ''}</td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="mks-note">Nog niets gedaan.</p>'}`;
        });
        ctx.actions([
            { label: 'Nu een stap', kind: 'primary', run: () => round() },
            { label: 'Wachttijden wissen', run: () => { state.cool = {}; save(); ctx.refresh(); }, title: 'Tekorten die net zijn aangepakt mogen meteen weer.' },
            { label: 'Opleidingslijst wissen', run: () => { state.wishes = {}; save(); ctx.refresh(); } },
        ]);

        const first = setTimeout(round, 20000);
        let timer = setInterval(round, ctx.cfg.intervalMin * 60000);
        ctx.onSettings((cfg, key) => {
            if (key === 'intervalMin') { clearInterval(timer); timer = setInterval(round, ctx.cfg.intervalMin * 60000); }
            ctx.refresh();
        });
        ctx.status('Start over 20 seconden.', { tone: 'idle' });

        return {
            stop() {
                stopped = true;
                clearTimeout(first);
                clearInterval(timer);
                clearInterval(heartbeat);
                window.removeEventListener('pagehide', releaseLock);
                releaseLock();
            },
        };
    },
});

/* ==== module: log-github ================================================== */
MKS.module({
    id: 'log-github',
    name: 'Log naar GitHub',
    short: 'Log naar GitHub',
    icon: '📤',
    category: 'auto',
    description: 'Zet elk uur (instelbaar) de logboeken van Automatisch alarmeren en Automatisch uitbreiden in een bestand in je eigen '
        + '(privé) GitHub-repository, zodat ze daar te lezen zijn zonder dat het spel open hoeft te staan. Verandert niets in het spel.',
    at: 'ready',
    frames: 'top',
    live: true,
    warning: 'Gebruik een <b>privé</b> repository en een fine-grained token met alleen "Contents: read and write" op die ene repository. '
        + 'In een openbare repository kan iedereen je spelgegevens lezen.',
    settings: [
        { key: 'repo', label: 'Repository', type: 'text', default: '', placeholder: 'gebruiker/mks-logs', help: 'eigenaar/naam van een privé repository' },
        { key: 'file', label: 'Bestand', type: 'text', default: 'status.json' },
        { key: 'intervalMin', label: 'Elke', type: 'number', default: 60, min: 2, max: 240, unit: 'min' },
        { key: 'eventHours', label: 'Gebeurtenissen van de laatste', type: 'number', default: 24, min: 1, max: 168, unit: 'uur' },
    ],

    run(ctx) {
        const W = ctx.W;
        const TOKEN_KEY = 'mks.logGithub.token';
        const LAST_KEY = 'mks.logGithub.last';
        const SHA_KEY = 'mks.logGithub.sha';
        const read = (key, fallback) => { try { return JSON.parse(GM_getValue(key, '')) || fallback; } catch (e) { return fallback; } };
        let busy = false;
        let lastResult = null;

        const token = () => GM_getValue(TOKEN_KEY, '');

        function gh(method, path, body) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method,
                    url: `https://api.github.com${path}`,
                    headers: {
                        Authorization: `Bearer ${token()}`,
                        Accept: 'application/vnd.github+json',
                        'Content-Type': 'application/json',
                    },
                    data: body ? JSON.stringify(body) : undefined,
                    timeout: 30000,
                    onload: (r) => {
                        let json = null;
                        try { json = JSON.parse(r.responseText); } catch (e) { /* empty body */ }
                        resolve({ status: r.status, json });
                    },
                    onerror: () => reject(new Error('geen verbinding met GitHub')),
                    ontimeout: () => reject(new Error('GitHub reageert niet')),
                });
            });
        }

        // UTF-8 safe base64 for the contents API.
        function b64(text) {
            const bytes = new TextEncoder().encode(text);
            let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(s);
        }

        // Everything both automation modules keep: GM storage is shared by all
        // tabs, the live extras (stats, ranking) only exist in the tab that runs them.
        function snapshot() {
            const since = Date.now() - ctx.cfg.eventHours * 3600 * 1000;
            const dispatch = W.mksAutoData;
            const expand = W.mksAutoExpand;
            const strip = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } };
            return {
                at: new Date().toISOString(),
                version: '1.7.0.20261009170800',
                page: location.pathname,
                dispatch: {
                    events: read('mks.autoDispatch.events.v1', []).filter((e) => e.t >= since),
                    needs: read('mks.autoDispatch.needs.v1', {}),
                    live: dispatch ? strip({ running: dispatch.running, stats: dispatch.stats, holds: dispatch.holds, team: dispatch.team,
                        log: (dispatch.log || []).slice(0, 200) }) : null,
                },
                expand: {
                    state: read('mks.autoExpand.state.v1', {}),
                    live: expand ? strip({ next: expand.next, skipped: expand.skipped, ranking: expand.ranking, unlocks: expand.unlocks }) : null,
                },
            };
        }

        async function upload(force) {
            if (busy) return;
            const repo = String(ctx.cfg.repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
            if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { ctx.status('Vul eerst de repository in (eigenaar/naam)', { tone: 'warn' }); return; }
            if (!token()) { ctx.status('Stel eerst een token in', { tone: 'warn' }); return; }
            // One upload per interval across all tabs.
            const last = Number(GM_getValue(LAST_KEY, 0)) || 0;
            if (!force && Date.now() - last < ctx.cfg.intervalMin * 60 * 1000) return;
            GM_setValue(LAST_KEY, Date.now());
            busy = true;
            ctx.status('Uploaden…', { tone: 'busy' });
            try {
                const file = String(ctx.cfg.file || 'status.json').trim().replace(/^\/+/, '');
                const path = `/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
                const content = b64(JSON.stringify(snapshot(), null, 1));
                const put = (sha) => gh('PUT', path, { message: `Log ${new Date().toLocaleString('nl-NL')}`, content, ...(sha ? { sha } : {}) });
                let r = await put(GM_getValue(SHA_KEY, '') || undefined);
                if (r.status === 409 || r.status === 422) {
                    // Stored sha is stale (or missing): ask GitHub for the current one.
                    const cur = await gh('GET', path);
                    r = await put(cur.status === 200 ? cur.json.sha : undefined);
                }
                if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub ${r.status}: ${r.json?.message || 'onbekende fout'}`);
                GM_setValue(SHA_KEY, r.json.content.sha);
                lastResult = { ok: true, at: new Date(), kb: Math.round(content.length * 0.75 / 1024) };
                ctx.status(`Geüpload om ${lastResult.at.toLocaleTimeString('nl-NL')} (${lastResult.kb} KB)`, { tone: 'ok' });
            } catch (e) {
                ctx.err(e);
                lastResult = { ok: false, at: new Date(), error: e.message };
                ctx.status(`Mislukt: ${e.message}`, { tone: 'error' });
            } finally {
                busy = false;
                ctx.refresh();
            }
        }

        ctx.actions([
            { label: 'Nu uploaden', kind: 'primary', run: () => upload(true) },
            {
                label: 'Token instellen',
                run: () => {
                    const t = prompt('GitHub fine-grained token (alleen Contents: read and write op je log-repository). Leeg laten = token verwijderen.', '');
                    if (t === null) return;
                    GM_setValue(TOKEN_KEY, t.trim());
                    GM_setValue(SHA_KEY, '');
                    ctx.status(t.trim() ? 'Token opgeslagen' : 'Token verwijderd', { tone: 'idle' });
                    ctx.refresh();
                },
            },
        ]);

        ctx.panel((el) => {
            const last = Number(GM_getValue(LAST_KEY, 0)) || 0;
            el.innerHTML = `<p class="mks-note">Token: ${token() ? 'ingesteld' : '<b>niet ingesteld</b>'}. `
                + `Laatste upload (alle tabbladen): ${last ? new Date(last).toLocaleString('nl-NL') : 'nog nooit'}.`
                + (lastResult && !lastResult.ok ? `<br>Fout: ${ctx.esc(lastResult.error)}` : '') + '</p>';
        });

        ctx.onSettings(() => ctx.refresh());
        const timer = setInterval(() => upload(false), 60 * 1000);
        setTimeout(() => upload(false), 15 * 1000);
        return { stop() { clearInterval(timer); } };
    },
});

MKS.boot();
