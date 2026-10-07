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
 *   settings: [{ key, label, type, default, help, min, max, step, unit, options }]
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
    const VERSION = '{{VERSION}}';
    const CHANNEL = '{{CHANNEL}}';
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
            box.innerHTML = `<h4 class="mks-h">Instellingen</h4>` + list.map((s, i) => {
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
            }).join('') + `<div class="mks-reset"><a class="mks-link">Standaardwaarden herstellen</a></div>`;

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
