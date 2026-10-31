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
 *   ctx.fold(id, title, html, { open, count })  a folding panel section; open/closed is remembered
 *   ctx.menu(item)          entry in the navbar menu: { icon, label, title, run }
 *   ctx.onSettings(fn)      settings apply live; without it a change asks for a reload
 *   ctx.settingExtra(key, render)  that setting's label unfolds; render(el) draws more under it
 *   setting.parent: 'key'   shown inside that setting's unfolding part instead of in the list
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
     * COUNTRY BY POSITION — 'nl', 'be' or 'de' (ctx.countryAt). Inside an NL
     * outline = NL, inside the BE outline = BE, otherwise east of 5.8° = DE.
     * Outlines: Natural Earth 10m admin-0, simplified to about 400 m, so a spot
     * right on the border can land on the wrong side.
     * ---------------------------------------------------------------------- */
    const NL_OUTLINES = [
        [[53.245,7.195],[53.185,7.195],[53.138,7.172],[53.105,7.185],[53.034,7.194],[52.998,7.193],[52.966,7.184],[52.933,7.162],[52.854,7.08],[52.824,7.062],[52.647,7.037],[52.626,7.018],[52.637,6.968],[52.632,6.918],[52.642,6.865],[52.641,6.771],[52.635,6.737],[52.619,6.702],[52.609,6.71],[52.583,6.704],[52.56,6.744],[52.542,6.672],[52.526,6.684],[52.476,6.695],[52.462,6.715],[52.432,6.9],[52.437,6.951],[52.451,6.973],[52.391,7.034],[52.365,7.048],[52.329,7.04],[52.285,7.012],[52.267,7.012],[52.236,7.029],[52.231,7.026],[52.214,6.982],[52.172,6.928],[52.16,6.885],[52.113,6.831],[52.103,6.75],[52.067,6.711],[52.06,6.68],[52.05,6.673],[52.035,6.675],[52.001,6.778],[51.98,6.809],[51.961,6.811],[51.951,6.79],[51.908,6.744],[51.899,6.717],[51.898,6.628],[51.876,6.529],[51.848,6.463],[51.86,6.378],[51.838,6.387],[51.828,6.382],[51.821,6.345],[51.837,6.342],[51.846,6.287],[51.866,6.265],[51.863,6.225],[51.897,6.127],[51.885,6.093],[51.842,6.156],[51.854,6.084],[51.816,5.931],[51.807,5.928],[51.796,5.951],[51.777,5.964],[51.756,5.962],[51.743,5.94],[51.732,5.939],[51.73,5.978],[51.716,6.012],[51.71,6.022],[51.681,6.009],[51.663,6.031],[51.644,6.099],[51.608,6.082],[51.596,6.086],[51.509,6.193],[51.458,6.205],[51.399,6.193],[51.388,6.208],[51.345,6.194],[51.318,6.148],[51.232,6.065],[51.212,6.057],[51.189,6.054],[51.171,6.061],[51.163,6.084],[51.184,6.134],[51.179,6.157],[51.165,6.126],[51.152,6.147],[51.14,6.132],[51.12,6.075],[51.075,5.983],[51.031,5.938],[51.03,5.92],[51.052,5.88],[51.043,5.852],[50.991,5.874],[50.965,5.875],[50.978,5.928],[50.971,5.968],[50.974,6.004],[50.952,5.996],[50.929,6.0],[50.908,6.064],[50.891,6.055],[50.871,6.063],[50.853,6.057],[50.844,6.046],[50.84,6.009],[50.83,6.0],[50.813,6.004],[50.801,5.998],[50.792,5.984],[50.795,5.969],[50.782,5.973],[50.763,5.997],[50.75,5.995],[50.752,5.793],[50.773,5.752],[50.754,5.728],[50.754,5.707],[50.761,5.688],[50.796,5.7],[50.815,5.641],[50.83,5.624],[50.853,5.622],[50.904,5.694],[50.912,5.722],[50.959,5.764],[50.959,5.722],[51.024,5.778],[51.035,5.764],[51.058,5.771],[51.061,5.78],[51.055,5.791],[51.061,5.799],[51.082,5.812],[51.097,5.805],[51.103,5.846],[51.119,5.823],[51.13,5.826],[51.139,5.841],[51.156,5.829],[51.152,5.781],[51.184,5.731],[51.179,5.659],[51.197,5.625],[51.208,5.568],[51.22,5.546],[51.262,5.535],[51.287,5.493],[51.288,5.472],[51.259,5.389],[51.262,5.271],[51.259,5.215],[51.294,5.215],[51.308,5.197],[51.307,5.14],[51.313,5.123],[51.351,5.103],[51.384,5.062],[51.439,5.08],[51.462,5.06],[51.477,5.028],[51.474,5.012],[51.447,4.996],[51.411,4.957],[51.396,4.932],[51.392,4.91],[51.406,4.853],[51.408,4.783],[51.413,4.762],[51.425,4.768],[51.426,4.779],[51.414,4.823],[51.431,4.815],[51.461,4.826],[51.476,4.824],[51.495,4.779],[51.486,4.731],[51.426,4.654],[51.418,4.63],[51.42,4.541],[51.429,4.522],[51.468,4.533],[51.476,4.525],[51.474,4.483],[51.443,4.377],[51.435,4.389],[51.41,4.38],[51.374,4.416],[51.357,4.411],[51.35,4.392],[51.352,4.346],[51.369,4.29],[51.369,4.261],[51.384,4.249],[51.414,4.245],[51.419,4.235],[51.409,4.223],[51.405,4.201],[51.407,4.111],[51.419,4.07],[51.453,3.999],[51.456,3.957],[51.45,3.943],[51.405,3.902],[51.391,3.827],[51.412,3.789],[51.431,3.729],[51.454,3.69],[51.445,3.61],[51.459,3.535],[51.501,3.495],[51.53,3.451],[51.546,3.447],[51.555,3.458],[51.595,3.56],[51.611,3.851],[51.596,3.882],[51.569,3.906],[51.556,3.872],[51.549,3.872],[51.543,3.967],[51.531,4.016],[51.508,4.057],[51.458,4.09],[51.446,4.105],[51.441,4.129],[51.446,4.181],[51.44,4.2],[51.448,4.283],[51.471,4.297],[51.492,4.289],[51.508,4.268],[51.535,4.153],[51.535,4.091],[51.59,3.988],[51.611,4.068],[51.608,4.157],[51.59,4.207],[51.609,4.203],[51.617,4.19],[51.62,4.136],[51.639,4.113],[51.671,4.113],[51.684,4.143],[51.686,4.177],[51.704,4.141],[51.717,4.072],[51.73,4.057],[51.763,4.051],[51.784,4.034],[51.81,3.981],[51.801,3.963],[51.788,3.872],[51.816,3.862],[51.828,3.891],[51.84,3.954],[51.847,3.963],[51.844,4.016],[51.834,4.048],[51.844,4.078],[51.882,4.032],[51.896,4.032],[51.909,4.043],[51.98,4.01],[51.988,4.016],[51.994,4.022],[51.988,4.069],[51.992,4.108],[52.006,4.142],[52.113,4.285],[52.223,4.407],[52.336,4.508],[52.445,4.569],[52.481,4.577],[52.507,4.597],[52.701,4.639],[52.797,4.669],[52.863,4.712],[52.959,4.734],[52.968,4.745],[52.962,4.807],[52.968,4.817],[52.96,4.824],[52.93,4.809],[52.911,4.833],[52.904,4.874],[52.906,4.913],[52.936,4.978],[52.954,5.078],[53.083,5.313],[53.097,5.379],[53.122,5.4],[53.19,5.427],[53.221,5.447],[53.257,5.504],[53.267,5.541],[53.303,5.592],[53.312,5.66],[53.33,5.695],[53.406,5.981],[53.413,6.274],[53.399,6.312],[53.413,6.346],[53.439,6.494],[53.461,6.73],[53.451,6.829],[53.434,6.867],[53.352,6.901],[53.326,6.949],[53.306,7.02],[53.31,7.038],[53.302,7.058],[53.31,7.085],[53.303,7.085],[53.296,7.073],[53.267,7.081],[53.256,7.111],[53.245,7.195]],
        [[51.375,3.349],[51.417,3.541],[51.391,3.605],[51.374,3.702],[51.35,3.756],[51.343,3.834],[51.372,3.956],[51.382,3.969],[51.402,3.975],[51.41,3.984],[51.41,4.006],[51.399,4.043],[51.371,4.07],[51.359,4.122],[51.358,4.157],[51.377,4.18],[51.368,4.221],[51.331,4.208],[51.297,4.169],[51.272,4.119],[51.233,3.995],[51.211,3.949],[51.205,3.809],[51.22,3.781],[51.255,3.776],[51.29,3.61],[51.281,3.514],[51.274,3.503],[51.24,3.501],[51.236,3.454],[51.247,3.392],[51.263,3.367],[51.289,3.353],[51.337,3.358],[51.375,3.349]],
        [[51.686,4.037],[51.67,4.097],[51.654,4.099],[51.644,4.089],[51.633,4.055],[51.624,3.96],[51.642,3.902],[51.668,3.886],[51.676,3.87],[51.7,3.796],[51.678,3.765],[51.681,3.7],[51.693,3.687],[51.725,3.689],[51.74,3.726],[51.748,3.814],[51.741,3.94],[51.73,3.978],[51.686,4.037]],
        [[53.111,4.893],[53.105,4.893],[53.105,4.913],[53.05,4.865],[53.027,4.818],[53.0,4.796],[52.994,4.762],[53.003,4.727],[53.028,4.708],[53.055,4.714],[53.108,4.758],[53.133,4.806],[53.188,4.854],[53.187,4.886],[53.181,4.89],[53.171,4.891],[53.166,4.886],[53.135,4.91],[53.119,4.91],[53.111,4.893]],
        [[53.43,5.424],[53.436,5.437],[53.454,5.585],[53.434,5.562],[53.427,5.475],[53.413,5.482],[53.395,5.382],[53.353,5.208],[53.353,5.18],[53.368,5.168],[53.385,5.179],[53.397,5.232],[53.406,5.25],[53.423,5.407],[53.43,5.424]],
        [[53.509,6.212],[53.514,6.311],[53.509,6.339],[53.502,6.339],[53.469,6.153],[53.454,6.133],[53.46,6.127],[53.468,6.133],[53.482,6.123],[53.495,6.148],[53.509,6.212]],
        [[53.221,4.879],[53.254,4.921],[53.29,4.987],[53.314,5.054],[53.31,5.105],[53.303,5.105],[53.303,5.078],[53.292,5.036],[53.212,4.91],[53.221,4.879]],
        [[53.468,5.674],[53.474,5.914],[53.461,5.955],[53.447,5.856],[53.447,5.753],[53.43,5.679],[53.434,5.654],[53.449,5.636],[53.463,5.642],[53.472,5.659],[53.468,5.674]],
        [[53.557,6.441],[53.558,6.455],[53.544,6.51],[53.54,6.499],[53.543,6.461],[53.55,6.443],[53.557,6.441]],
    ];
    const BE_OUTLINE = [[51.088,2.522],[51.105,2.58],[51.17,2.716],[51.246,2.924],[51.33,3.125],[51.375,3.349],[51.337,3.358],[51.289,3.353],[51.263,3.367],[51.247,3.392],[51.236,3.454],[51.24,3.501],[51.274,3.503],[51.281,3.514],[51.29,3.61],[51.255,3.776],[51.22,3.781],[51.205,3.809],[51.206,3.927],[51.272,4.119],[51.297,4.169],[51.331,4.208],[51.368,4.221],[51.357,4.241],[51.328,4.256],[51.296,4.303],[51.284,4.308],[51.268,4.297],[51.271,4.308],[51.296,4.331],[51.309,4.289],[51.35,4.283],[51.369,4.261],[51.369,4.29],[51.352,4.346],[51.35,4.392],[51.357,4.411],[51.374,4.416],[51.41,4.38],[51.435,4.389],[51.443,4.377],[51.462,4.429],[51.474,4.483],[51.476,4.525],[51.468,4.533],[51.429,4.522],[51.42,4.541],[51.418,4.63],[51.426,4.654],[51.486,4.731],[51.495,4.779],[51.476,4.824],[51.461,4.826],[51.431,4.815],[51.414,4.823],[51.426,4.779],[51.425,4.768],[51.413,4.762],[51.408,4.783],[51.406,4.853],[51.392,4.91],[51.396,4.932],[51.411,4.957],[51.447,4.996],[51.474,5.012],[51.477,5.028],[51.462,5.06],[51.439,5.08],[51.406,5.065],[51.384,5.062],[51.375,5.068],[51.351,5.103],[51.313,5.123],[51.307,5.14],[51.308,5.197],[51.294,5.215],[51.259,5.215],[51.259,5.389],[51.288,5.472],[51.287,5.493],[51.262,5.535],[51.22,5.546],[51.208,5.568],[51.197,5.625],[51.179,5.659],[51.184,5.731],[51.152,5.781],[51.156,5.829],[51.139,5.841],[51.13,5.826],[51.119,5.823],[51.103,5.846],[51.097,5.805],[51.082,5.812],[51.061,5.799],[51.055,5.791],[51.061,5.78],[51.058,5.771],[51.035,5.764],[51.024,5.778],[50.959,5.722],[50.959,5.764],[50.912,5.722],[50.904,5.694],[50.853,5.622],[50.83,5.624],[50.815,5.641],[50.796,5.7],[50.761,5.688],[50.754,5.707],[50.754,5.728],[50.773,5.752],[50.752,5.793],[50.75,5.995],[50.743,5.994],[50.737,6.011],[50.709,6.012],[50.713,6.081],[50.642,6.161],[50.637,6.148],[50.622,6.159],[50.616,6.18],[50.614,6.249],[50.608,6.251],[50.587,6.233],[50.562,6.179],[50.544,6.161],[50.53,6.177],[50.518,6.171],[50.515,6.191],[50.507,6.183],[50.49,6.199],[50.486,6.217],[50.495,6.256],[50.481,6.337],[50.466,6.323],[50.447,6.332],[50.434,6.351],[50.368,6.338],[50.329,6.372],[50.315,6.375],[50.307,6.362],[50.309,6.299],[50.304,6.286],[50.286,6.269],[50.267,6.272],[50.257,6.253],[50.243,6.19],[50.223,6.157],[50.214,6.147],[50.205,6.16],[50.182,6.165],[50.169,6.152],[50.165,6.123],[50.145,6.116],[50.134,6.129],[50.12,6.117],[50.125,6.103],[50.151,6.097],[50.159,6.084],[50.151,6.061],[50.149,6.027],[50.154,6.014],[50.175,5.998],[50.166,5.962],[50.128,5.941],[50.097,5.872],[50.074,5.867],[50.047,5.838],[50.019,5.836],[50.002,5.803],[49.989,5.802],[49.978,5.813],[49.964,5.802],[49.947,5.764],[49.882,5.715],[49.858,5.758],[49.86,5.732],[49.845,5.727],[49.839,5.737],[49.834,5.725],[49.825,5.72],[49.8,5.728],[49.789,5.738],[49.773,5.778],[49.743,5.802],[49.722,5.805],[49.714,5.85],[49.7,5.857],[49.674,5.842],[49.667,5.846],[49.658,5.88],[49.644,5.885],[49.583,5.83],[49.577,5.847],[49.561,5.837],[49.545,5.814],[49.538,5.791],[49.549,5.746],[49.531,5.71],[49.544,5.645],[49.536,5.62],[49.514,5.602],[49.523,5.548],[49.495,5.478],[49.499,5.456],[49.508,5.45],[49.537,5.454],[49.546,5.45],[49.602,5.402],[49.613,5.383],[49.626,5.335],[49.613,5.322],[49.613,5.298],[49.626,5.291],[49.641,5.294],[49.648,5.306],[49.662,5.299],[49.691,5.259],[49.683,5.192],[49.687,5.169],[49.705,5.136],[49.753,5.082],[49.767,5.026],[49.797,4.971],[49.784,4.884],[49.787,4.858],[49.794,4.849],[49.832,4.849],[49.853,4.835],[49.892,4.859],[49.913,4.86],[49.932,4.845],[49.944,4.797],[49.958,4.784],[50.036,4.827],[50.064,4.827],[50.091,4.846],[50.084,4.863],[50.14,4.872],[50.148,4.863],[50.146,4.82],[50.161,4.816],[50.153,4.789],[50.084,4.682],[50.066,4.673],[50.048,4.681],[50.016,4.673],[49.989,4.657],[49.98,4.604],[49.936,4.465],[49.932,4.435],[49.96,4.278],[49.953,4.201],[49.975,4.132],[49.975,4.14],[50.004,4.133],[50.006,4.128],[50.025,4.137],[50.06,4.21],[50.127,4.181],[50.13,4.171],[50.124,4.14],[50.128,4.126],[50.205,4.153],[50.222,4.168],[50.242,4.201],[50.252,4.204],[50.258,4.198],[50.273,4.163],[50.27,4.15],[50.256,4.151],[50.252,4.144],[50.257,4.125],[50.295,4.098],[50.344,4.003],[50.325,3.896],[50.345,3.84],[50.346,3.755],[50.337,3.733],[50.298,3.697],[50.319,3.662],[50.446,3.644],[50.477,3.608],[50.487,3.564],[50.487,3.499],[50.493,3.487],[50.512,3.498],[50.52,3.477],[50.519,3.463],[50.502,3.429],[50.49,3.361],[50.507,3.3],[50.527,3.271],[50.57,3.264],[50.655,3.23],[50.672,3.244],[50.696,3.232],[50.705,3.224],[50.715,3.189],[50.769,3.146],[50.779,3.129],[50.784,3.103],[50.758,2.971],[50.736,2.93],[50.703,2.9],[50.697,2.887],[50.723,2.787],[50.733,2.768],[50.766,2.744],[50.789,2.707],[50.809,2.692],[50.816,2.62],[50.835,2.607],[50.845,2.587],[50.868,2.597],[50.912,2.577],[50.941,2.612],[50.961,2.608],[51.001,2.557],[51.065,2.537],[51.088,2.522]];
    function insideRing(lat, lon, poly) {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [ya, xa] = poly[i];
            const [yb, xb] = poly[j];
            if ((ya > lat) !== (yb > lat) && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) c = !c;
        }
        return c;
    }
    function countryAt(lat, lon) {
        if (!isFinite(lat) || !isFinite(lon)) return 'nl';
        if (NL_OUTLINES.some((r) => insideRing(lat, lon, r))) return 'nl';
        if (insideRing(lat, lon, BE_OUTLINE)) return 'be';
        return lon > 5.8 && lat > 50.3 && lat < 53.7 ? 'de' : 'nl';
    }

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
    // Which folding panel sections are open (ctx.fold), by "module:section".
    const FOLDS_KEY = 'mks.suite.folds.v1';
    const folds = (() => { try { return JSON.parse(GM_getValue(FOLDS_KEY, '{}')) || {}; } catch (e) { return {}; } })();

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
                status: null, actions: [], panel: null, menus: [], onSettings: null, extras: {},
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
            countryAt,
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
            fold(id, title, html, opts = {}) {
                const key = `${def.id}:${id}`;
                const open = key in folds ? folds[key] : !!opts.open;
                const count = opts.count != null ? `<span class="n">${esc(opts.count)}</span>` : '';
                return `<details class="mks-fold" data-fold="${esc(key)}" ${open ? 'open' : ''}><summary><span class="t">${esc(title)}</span>${count}</summary><div class="b">${html}</div></details>`;
            },
            menu(item) { r.menus.push(item); nav.render(); },
            onSettings(fn) { r.onSettings = fn; },
            settingExtra(key, render) { r.extras[key] = render; },
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
        --m-bg:#0b1118; --m-s1:#0e151e; --m-s2:#121a24; --m-s3:#151e29; --m-s4:#1a2533; --m-s5:#2b3644;
        --m-bd:#1f2a38; --m-bd2:#243041; --m-tx:#e6edf3; --m-tx2:#c3ccd6; --m-dim:#aab5c2; --m-faint:#8b98a8; --m-mute:#5d6a7a;
        --m-ac:#22c3e6; --m-ac-t:#5fd4ef; --m-ac-d:#0f2e37; --m-ok:#3fcf7f; --m-ok-t:#7ee2a8; --m-ok-d:#12291f;
        --m-wa:#f0a36b; --m-wa-d:#21170f; --m-wa-b:#5a3a22; --m-er:#ff8a8f; --m-er-d:#24161a; --m-er-b:#3a2a2e;
        --m-sans:'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
        --m-mono:'IBM Plex Mono', ui-monospace, Consolas, monospace;
    }
    #mks-dash { position:fixed; inset:0; z-index:100050; background:rgba(3,6,10,.66); display:flex;
        align-items:center; justify-content:center; padding:24px; font:14px/1.5 var(--m-sans); color:var(--m-tx); }
    #mks-dash *, #mks-dock * { box-sizing:border-box; }
    #mks-dash .mks-win { width:min(1280px,100%); height:min(860px,100%); background:var(--m-s1); border:1px solid var(--m-bd);
        border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 90px -20px rgba(0,0,0,.75); }

    /* top bar */
    #mks-dash .mks-top { height:56px; flex:none; display:flex; align-items:center; gap:12px; padding:0 16px 0 20px; border-bottom:1px solid var(--m-bd); }
    #mks-dash .mks-brand { display:flex; align-items:center; gap:12px; white-space:nowrap; min-width:0; }
    #mks-dash .mks-brand b { font-size:15px; font-weight:600; }
    #mks-dash .mks-logo { width:28px; height:28px; border-radius:7px; background:var(--m-ac); color:#06222b; display:grid; place-items:center; font-weight:600; font-size:14px; flex:none; }
    #mks-dash .mks-ver { font:400 12px var(--m-mono); color:var(--m-faint); }
    #mks-dash .mks-sp { flex:1; }
    #mks-dash .mks-find { display:flex; align-items:center; gap:8px; width:260px; height:34px; padding:0 12px; border-radius:8px;
        background:var(--m-s3); border:1px solid var(--m-bd2); color:var(--m-faint); }
    #mks-dash .mks-find:focus-within { border-color:var(--m-ac); }
    #mks-dash .mks-find svg { flex:none; }
    #mks-dash .mks-find input.mks-search { background:none !important; border:0 !important; padding:0 !important; width:100%; height:auto !important; }
    #mks-dash .mks-iconbtn { width:34px; height:34px; flex:none; border-radius:8px; background:none !important; border:1px solid var(--m-bd2) !important;
        color:var(--m-tx2) !important; display:grid; place-items:center; cursor:pointer; padding:0 !important; }
    #mks-dash .mks-iconbtn:hover { background:var(--m-s3) !important; color:var(--m-tx) !important; }
    #mks-dash .mks-reload { display:flex; align-items:center; gap:12px; padding:9px 20px; background:var(--m-wa-d); color:#f6cfae;
        border-bottom:1px solid var(--m-wa-b); font-size:13px; }
    #mks-dash .mks-reload[hidden] { display:none; }
    #mks-dash .mks-reload button { margin-left:auto; }
    #mks-dash .mks-wip { display:flex; align-items:center; gap:8px; padding:7px 20px; color:var(--m-faint); border-bottom:1px solid var(--m-bd); font-size:12.5px; }
    #mks-dash .mks-wip svg { color:var(--m-wa); flex:none; }
    #mks-dash .mks-wip b { color:var(--m-tx2); font-weight:500; }
    #mks-dash .mks-main { flex:1; display:flex; min-height:0; }

    /* sidebar */
    #mks-dash .mks-side { width:264px; flex:none; display:flex; flex-direction:column; border-right:1px solid var(--m-bd); background:var(--m-bg); min-height:0; }
    #mks-dash .mks-nav { flex:1; overflow:auto; padding:12px 10px; display:flex; flex-direction:column; gap:2px; }
    #mks-dash .mks-count { padding:12px 20px; font:400 12px var(--m-mono); color:var(--m-faint); border-top:1px solid var(--m-bd); white-space:nowrap; }
    #mks-dash .mks-gh { display:flex; align-items:center; gap:8px; width:100%; height:34px; padding:0 10px; margin-top:6px; border:0 !important; border-radius:7px !important;
        background:none !important; color:var(--m-faint) !important; font:500 11px var(--m-sans) !important; letter-spacing:.08em; text-transform:uppercase;
        cursor:pointer; text-align:left; box-shadow:none !important; }
    #mks-dash .mks-gh:hover { color:var(--m-tx2) !important; }
    #mks-dash .mks-gh svg { flex:none; transition:transform .15s; }
    #mks-dash .mks-grp.open .mks-gh svg { transform:rotate(90deg); }
    #mks-dash .mks-gh span { flex:1; }
    #mks-dash .mks-gh .n { flex:none; font:400 12px var(--m-mono); letter-spacing:0; text-transform:none; }
    #mks-dash .mks-gl { display:none; flex-direction:column; gap:2px; }
    #mks-dash .mks-grp.open .mks-gl { display:flex; }
    #mks-dash .mks-row { display:flex; align-items:center; gap:10px; min-height:40px; padding:6px 10px 6px 12px; border-radius:7px; cursor:pointer; color:var(--m-tx2); }
    #mks-dash .mks-row:hover { background:var(--m-s2); }
    #mks-dash .mks-row:focus-visible { outline:2px solid var(--m-ac); outline-offset:-2px; }
    #mks-dash .mks-row.sel { background:var(--m-s4); color:#fff; box-shadow:inset 2px 0 0 var(--m-ac); }
    #mks-dash .mks-row.off { color:#7f8b9a; }
    #mks-dash .mks-rt { flex:1; min-width:0; display:flex; flex-direction:column; }
    #mks-dash .mks-nm { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #mks-dash .mks-row.sel .mks-nm { font-weight:500; }
    #mks-dash .mks-nm .mks-wsign { color:var(--m-wa); font-size:12px; }
    #mks-dash .mks-st { font-size:12px; color:var(--m-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #mks-dash .mks-st.t-ok { color:var(--m-ok-t); } #mks-dash .mks-st.t-warn { color:var(--m-wa); }
    #mks-dash .mks-st.t-error { color:var(--m-er); } #mks-dash .mks-st.t-busy { color:var(--m-ac-t); }
    #mks-dash .mks-led { width:7px; height:7px; border-radius:50%; background:#3a4655; flex:none; }
    #mks-dash .mks-led.on { background:var(--m-ac); }
    #mks-dash .mks-led.t-error { background:var(--m-er); }

    /* detail */
    #mks-dash .mks-detail { flex:1; overflow:auto; padding:36px 56px 48px; min-width:0; }
    #mks-dash .mks-detail > * { max-width:820px; }
    #mks-dash .mks-detail > .mks-panel { max-width:none; }
    #mks-dash .mks-dh { display:flex; align-items:center; gap:16px; }
    #mks-dash .mks-dht { flex:1; min-width:0; display:flex; align-items:center; gap:8px 14px; flex-wrap:wrap; }
    #mks-dash .mks-dh h2 { margin:0; font:600 24px/1.25 var(--m-sans); color:var(--m-tx); }
    #mks-dash .mks-dh .mks-pills { display:flex; gap:6px; flex-wrap:wrap; }
    #mks-dash .mks-dh .mks-sw { margin-left:auto !important; }
    #mks-dash ::-webkit-scrollbar { width:10px; height:10px; }
    #mks-dash ::-webkit-scrollbar-track { background:transparent; }
    #mks-dash ::-webkit-scrollbar-thumb { background:#243041; border-radius:5px; border:2px solid transparent; background-clip:padding-box; }
    #mks-dash ::-webkit-scrollbar-thumb:hover { background:#2f3d50; background-clip:padding-box; border:2px solid transparent; }
    #mks-dash ::-webkit-scrollbar-button { display:none; height:0; width:0; }
    #mks-dash * { scrollbar-color:#243041 transparent; scrollbar-width:thin; }
    #mks-dash .mks-desc { color:var(--m-dim); margin:10px 0 0; font-size:14px; line-height:1.55; }
    #mks-dash .mks-desc a { color:var(--m-ac-t); }
    #mks-dash h4.mks-h { font:500 12px var(--m-sans); letter-spacing:.08em; text-transform:uppercase; color:var(--m-faint); margin:32px 0 6px; }
    #mks-dash .mks-status { margin-top:24px; background:var(--m-s2); border:1px solid var(--m-bd); border-radius:16px; padding:22px 24px; display:flex; flex-direction:column; gap:8px; }
    #mks-dash .mks-status .mks-line { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--m-faint); }
    #mks-dash .mks-status.t-ok .mks-line { color:var(--m-ok-t); } #mks-dash .mks-status.t-busy .mks-line { color:var(--m-ac-t); }
    #mks-dash .mks-status.t-warn .mks-line { color:var(--m-wa); } #mks-dash .mks-status.t-error { border-color:var(--m-er-b); }
    #mks-dash .mks-status.t-error .mks-line { color:var(--m-er); }
    #mks-dash .mks-status .t { font-size:20px; font-weight:600; line-height:1.35; color:var(--m-tx); word-break:break-word; }
    #mks-dash .mks-dot { width:8px; height:8px; border-radius:50%; background:var(--m-faint); flex:none; }
    .mks-dot.t-ok { background:var(--m-ok) !important; } .mks-dot.t-warn { background:var(--m-wa) !important; }
    .mks-dot.t-error { background:var(--m-er) !important; } .mks-dot.t-busy { background:var(--m-ac) !important; animation:mks-pulse 1.2s ease-in-out infinite; }
    @keyframes mks-pulse { 50% { opacity:.35; } }
    @media (prefers-reduced-motion: reduce) { .mks-dot.t-busy, #mks-dash .mks-btn.busy::before { animation:none; } }
    #mks-dash .mks-bar { height:6px; background:var(--m-s5); border-radius:3px; overflow:hidden; margin-top:6px; }
    #mks-dash .mks-bar i { display:block; height:100%; background:var(--m-ac); border-radius:3px; transition:width .3s; }
    #mks-dash .mks-acts { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
    #mks-dash .mks-acts:empty { display:none; }
    #mks-dash .mks-panel { margin-top:8px; }
    #mks-dash .mks-panel:empty { display:none; }

    /* settings */
    #mks-dash .mks-set { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:6px 32px; align-items:center;
        padding:14px 0; border-bottom:1px solid var(--m-bd); }
    #mks-dash .mks-set .c input[type=text], #mks-dash .mks-set .c select { width:260px; max-width:100%; }
    #mks-dash .mks-set .l { font-weight:400; color:var(--m-tx); }
    #mks-dash .mks-sg { font:600 13px var(--m-sans); color:var(--m-tx2); padding:26px 0 4px; }
    #mks-dash h4.mks-h + .mks-sg { padding-top:6px; }
    #mks-dash .mks-adv { margin-top:18px; border:1px solid var(--m-bd); border-radius:12px; padding:0 18px; }
    #mks-dash .mks-adv > summary { display:list-item; cursor:pointer; color:var(--m-dim); font-weight:500; padding:12px 0; }
    #mks-dash .mks-adv[open] > summary { border-bottom:1px solid var(--m-bd); }
    #mks-dash .mks-adv .mks-set:last-child { border-bottom:0; }
    #mks-dash .mks-set .h { display:block; color:var(--m-faint); font-size:12.5px; font-weight:400; margin-top:2px; line-height:1.45; max-width:68ch; }
    #mks-dash .mks-set .c { display:flex; align-items:center; gap:8px; justify-content:flex-end; color:var(--m-faint); }
    #mks-dash .mks-set .l.mks-xl { cursor:pointer; }
    #mks-dash .mks-set .l.mks-xl:hover { color:var(--m-ac-t); }
    #mks-dash .mks-set-x { padding:2px 0 12px 18px; margin-left:2px; border-left:2px solid var(--m-bd); border-bottom:1px solid var(--m-bd); }
    #mks-dash .mks-xn { color:var(--m-faint); font-weight:400; }
    #mks-dash .mks-set .u { color:var(--m-faint); font-size:13px; white-space:nowrap; }
    #mks-dash .mks-set .rv { font:500 12px var(--m-mono); color:var(--m-tx); min-width:42px; text-align:right; }
    #mks-dash .mks-reset { margin-top:16px; }
    #mks-dash .mks-empty { color:var(--m-faint); padding:20px 0; }

    /* controls — !important because the dark theme styles every input/button on the page */
    #mks-dash input[type=text], #mks-dash input[type=search], #mks-dash input[type=number], #mks-dash select, #mks-dash textarea,
    .mks-ui input[type=text], .mks-ui input[type=number], .mks-ui textarea {
        background:var(--m-bg) !important; color:var(--m-tx) !important; border:1px solid var(--m-bd2) !important; border-radius:6px !important;
        padding:5px 9px !important; font:14px var(--m-sans) !important; height:auto !important; box-shadow:none !important; margin:0 !important; width:100%; }
    #mks-dash textarea { font:12px var(--m-mono) !important; resize:vertical; }
    #mks-dash input:focus, #mks-dash select:focus, #mks-dash textarea:focus { outline:none !important; border-color:var(--m-ac) !important; }
    #mks-dash input[type=number] { width:90px; text-align:right; font-variant-numeric:tabular-nums; }
    #mks-dash input[type=range] { width:170px; accent-color:var(--m-ac); margin:0; }
    #mks-dash .mks-btn, .mks-ui .mks-btn { display:inline-flex; align-items:center; gap:6px; height:34px; background:var(--m-s3) !important; color:var(--m-tx) !important;
        border:1px solid var(--m-bd2) !important; border-radius:8px !important; padding:0 14px !important; font:500 13.5px var(--m-sans) !important;
        cursor:pointer; text-shadow:none !important; box-shadow:none !important; line-height:1 !important; }
    #mks-dash .mks-btn:hover, .mks-ui .mks-btn:hover { background:var(--m-s4) !important; border-color:#2f3d50 !important; }
    #mks-dash .mks-btn.primary, .mks-ui .mks-btn.primary { background:var(--m-ac) !important; border-color:var(--m-ac) !important; color:#06222b !important; }
    #mks-dash .mks-btn.primary:hover { filter:brightness(1.08); }
    #mks-dash .mks-btn.danger { color:#ffb3b6 !important; border-color:var(--m-er-b) !important; background:var(--m-er-d) !important; }
    #mks-dash .mks-btn.danger:hover { border-color:#5a3438 !important; }
    #mks-dash .mks-btn[disabled] { opacity:.5; cursor:default; }
    #mks-dash .mks-btn:focus-visible, #mks-dash .mks-iconbtn:focus-visible, #mks-dash .mks-gh:focus-visible { outline:2px solid var(--m-ac) !important; outline-offset:2px; }
    #mks-dash .mks-btn.busy::before { content:''; width:11px; height:11px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:mks-spin .7s linear infinite; }
    @keyframes mks-spin { to { transform:rotate(360deg); } }
    #mks-dash a.mks-link { color:var(--m-ac-t); cursor:pointer; text-decoration:none; }
    #mks-dash a.mks-link:hover { color:#9be5f6; text-decoration:underline; }

    /* switch */
    .mks-sw { position:relative; display:inline-block; width:36px; height:20px; flex:none; margin:0 !important; cursor:pointer; }
    .mks-sw input { position:absolute; opacity:0; width:0; height:0; margin:0; }
    .mks-sw i { position:absolute; inset:0; background:#2b3644; border-radius:10px; transition:background .15s; }
    .mks-sw i::after { content:''; position:absolute; left:2px; top:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
    .mks-sw input:checked + i { background:#22c3e6; }
    .mks-sw input:checked + i::after { transform:translateX(16px); }
    .mks-sw input:focus-visible + i { outline:2px solid #22c3e6; outline-offset:2px; }
    .mks-sw.lg { width:44px; height:24px; } .mks-sw.lg i { border-radius:12px; } .mks-sw.lg i::after { width:20px; height:20px; } .mks-sw.lg input:checked + i::after { transform:translateX(20px); }

    /* pills, tags, tables, tiles — also used by module panels */
    .mks-pill { display:inline-flex; align-items:center; gap:6px; font:500 12px var(--m-sans); padding:3px 10px; border-radius:999px; background:var(--m-s3); color:var(--m-faint); white-space:nowrap; }
    .mks-pill.t-ok { background:var(--m-ok-d); color:var(--m-ok-t); } .mks-pill.t-warn { background:var(--m-wa-d); color:var(--m-wa); box-shadow:inset 0 0 0 1px var(--m-wa-b); }
    .mks-pill.t-error { background:var(--m-er-d); color:var(--m-er); box-shadow:inset 0 0 0 1px var(--m-er-b); } .mks-pill.t-busy { background:var(--m-ac-d); color:var(--m-ac-t); }
    #mks-dash .mks-dh .mks-pill.t-ok::before, #mks-dash .mks-dh .mks-pill.t-busy::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
    #mks-dash .mks-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px; margin-top:6px; }
    #mks-dash .mks-tile { background:transparent; border:1px solid var(--m-bd); border-radius:12px; padding:16px 18px; }
    #mks-dash .mks-tile .v { font:600 22px var(--m-sans); color:var(--m-tx); font-variant-numeric:tabular-nums; }
    #mks-dash .mks-tile .k { color:var(--m-faint); font-size:13px; margin-top:2px; }
    #mks-dash .mks-tile.t-warn { border-color:var(--m-wa-b); } #mks-dash .mks-tile.t-error { border-color:var(--m-er-b); }
    #mks-dash .mks-tile.t-warn .v { color:var(--m-wa); } #mks-dash .mks-tile.t-error .v { color:var(--m-er); } #mks-dash .mks-tile.t-ok .v { color:var(--m-ok-t); }
    #mks-dash details.mks-fold { border:1px solid var(--m-bd); border-radius:12px; background:transparent; margin:12px 0; }
    #mks-dash details.mks-fold[open] { background:var(--m-s2); }
    #mks-dash details.mks-fold > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; min-height:46px; padding:0 16px;
        font:500 14px var(--m-sans); color:var(--m-tx); user-select:none; border-radius:12px; }
    #mks-dash details.mks-fold > summary::-webkit-details-marker { display:none; }
    #mks-dash details.mks-fold > summary::before { content:''; width:7px; height:7px; border-right:2px solid var(--m-faint); border-bottom:2px solid var(--m-faint);
        transform:rotate(-45deg); transition:transform .15s; flex:none; margin-right:2px; }
    #mks-dash details.mks-fold[open] > summary::before { transform:rotate(45deg); }
    #mks-dash details.mks-fold > summary:hover { background:var(--m-s2); }
    #mks-dash details.mks-fold > summary .n { margin-left:auto; font:400 13px var(--m-mono); color:var(--m-faint); background:none; padding:0; }
    #mks-dash details.mks-fold > .b { padding:2px 16px 16px; }
    #mks-dash details.mks-fold > .b > .mks-note:first-child { margin-top:0; }
    #mks-dash .mks-hero { background:var(--m-s2); border:1px solid var(--m-bd); border-radius:16px; padding:20px 24px; margin:6px 0 14px; }
    #mks-dash .mks-hero .k { font-size:13px; color:var(--m-faint); }
    #mks-dash .mks-hero .t { font:600 20px var(--m-sans); color:var(--m-tx); margin-top:4px; line-height:1.35; }
    #mks-dash .mks-hero .s { color:var(--m-faint); font-size:13.5px; margin-top:6px; line-height:1.5; }
    #mks-dash .mks-hero.t-ok .k { color:var(--m-ok-t); } #mks-dash .mks-hero.t-warn .k { color:var(--m-wa); } #mks-dash .mks-hero.t-busy .k { color:var(--m-ac-t); }
    #mks-dash .mks-hero.t-warn { border-color:var(--m-wa-b); }
    #mks-dash table.mks-tbl td.mks-tone { width:3px; padding:0 !important; }
    #mks-dash table.mks-tbl td.mks-tone.t-ok { background:var(--m-ok) !important; } #mks-dash table.mks-tbl td.mks-tone.t-warn { background:var(--m-wa) !important; }
    #mks-dash table.mks-tbl td.mks-tone.t-error { background:var(--m-er) !important; }
    #mks-dash .mks-tblwrap { max-height:360px; overflow:auto; border:1px solid var(--m-bd); border-radius:10px; background:var(--m-s1); }
    #mks-dash table.mks-tbl { width:100%; border-collapse:collapse; font-size:13px; background:transparent !important; margin:0; font-variant-numeric:tabular-nums; }
    #mks-dash table.mks-tbl th { position:sticky; top:0; background:var(--m-s3) !important; color:var(--m-faint) !important; text-align:left; font-weight:500;
        padding:8px 12px !important; border:0 !important; border-bottom:1px solid var(--m-bd) !important; white-space:nowrap; }
    #mks-dash table.mks-tbl td { padding:8px 12px !important; border:0 !important; border-bottom:1px solid #1a2431 !important; color:var(--m-tx) !important;
        background:transparent !important; vertical-align:top; }
    #mks-dash table.mks-tbl tbody tr:hover td { background:var(--m-s2) !important; }
    #mks-dash table.mks-tbl tr:last-child td { border-bottom:0 !important; }
    #mks-dash table.mks-tbl td.mono, #mks-dash .mono { font-family:var(--m-mono); font-size:12.5px; }
    #mks-dash table.mks-tbl a { color:var(--m-ac-t); }
    #mks-dash .mks-dim { color:var(--m-faint); }
    #mks-dash .mks-note { color:var(--m-faint); font-size:13px; margin:8px 0; max-width:760px; line-height:1.5; }
    #mks-dash .mks-callout { border:1px solid var(--m-bd); background:var(--m-s2); color:var(--m-dim); border-radius:12px; padding:16px 18px; margin-top:20px; }
    #mks-dash .mks-callout b { color:var(--m-tx); }
    #mks-dash .mks-callout .mks-acts { margin-top:12px; }
    #mks-dash .mks-warn { display:flex; gap:10px; align-items:flex-start; color:#f2c4a0; font-size:13px; line-height:1.5; margin-top:14px;
        padding:12px 14px; border:1px solid var(--m-wa-b); background:var(--m-wa-d); border-radius:10px; }
    #mks-dash .mks-warn svg { flex:none; color:var(--m-wa); margin-top:2px; }
    #mks-dash .mks-warn b { color:#ffe2cc; }
    #mks-dash .mks-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px; }
    #mks-dash .mks-card { background:transparent; border:1px solid var(--m-bd); border-radius:12px; padding:18px 20px; }
    #mks-dash .mks-stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); margin-top:24px; border:1px solid var(--m-bd); border-radius:12px; background:var(--m-s2); overflow:hidden; }
    #mks-dash .mks-stats > div { padding:16px 18px; border-right:1px solid var(--m-bd); min-width:0; }
    #mks-dash .mks-stats > div:last-child { border-right:0; }
    #mks-dash .mks-stats b { display:block; font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; color:var(--m-tx); }
    #mks-dash .mks-stats span { font-size:12px; color:var(--m-faint); }
    #mks-dash .mks-stats .t-error b { color:var(--m-er); } #mks-dash .mks-stats .t-ok b { color:var(--m-ok-t); }
    #mks-dash .mks-now { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px; }
    #mks-dash .mks-now .mks-row { border:1px solid var(--m-bd); border-radius:10px; min-height:56px; padding:10px 14px; }
    #mks-dash .mks-now .mks-row:hover { border-color:var(--m-bd2); }
    #mks-dash kbd { font:12px var(--m-mono); background:var(--m-s3); border:1px solid var(--m-bd2); border-radius:4px; padding:0 5px; color:var(--m-tx); }

    /* dock */
    #mks-dock { position:fixed; left:8px; bottom:8px; z-index:99990; display:flex; flex-direction:column-reverse; gap:6px; align-items:flex-start;
        font:12.5px/1.3 var(--m-sans); pointer-events:none; }
    #mks-dock .mks-chip { pointer-events:auto; display:flex; align-items:center; gap:8px; max-width:340px; background:rgba(14,21,30,.95); color:var(--m-tx);
        border:1px solid var(--m-bd2); border-radius:999px; padding:5px 12px 5px 10px; cursor:pointer; box-shadow:0 8px 22px -8px rgba(0,0,0,.65); }
    #mks-dock .mks-chip:hover { border-color:var(--m-ac); }
    #mks-dock .mks-chip .n { font-weight:600; white-space:nowrap; }
    #mks-dock .mks-chip .s { color:var(--m-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
    #mks-dock .mks-chip .mks-dot { width:7px; height:7px; border-radius:50%; background:var(--m-faint); flex:none; }
    #mks-dock .mks-chip .mks-bar { width:60px; height:4px; background:var(--m-s5); border-radius:2px; overflow:hidden; flex:none; }
    #mks-dock .mks-chip .mks-bar i { display:block; height:100%; background:var(--m-ac); }

    @media (max-width: 860px) {
        #mks-dash .mks-detail { padding:24px 24px 36px; }
        #mks-dash .mks-find { width:180px; }
    }
    @media (max-width: 760px) {
        #mks-dash { padding:0; }
        #mks-dash .mks-win { height:100%; border-radius:0; }
        #mks-dash .mks-main { flex-direction:column; }
        #mks-dash .mks-side { width:auto; max-height:40vh; border-right:0; border-bottom:1px solid var(--m-bd); }
        #mks-dash .mks-count { display:none; }
        #mks-dash .mks-detail { padding:18px 16px 28px; }
        #mks-dash .mks-dh h2 { font-size:20px; }
        #mks-dash .mks-set { grid-template-columns:1fr; }
        #mks-dash .mks-stats { grid-template-columns:repeat(2, minmax(0, 1fr)); }
        #mks-dash .mks-set .c { justify-content:flex-start; }
        #mks-dash .mks-find { width:auto; flex:1; min-width:0; }
        #mks-dash .mks-brand b, #mks-dash .mks-ver { display:none; }
    }
    `;

    const ICON = {
        search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>',
        close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
        pip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><rect x="12" y="12" width="7" height="5" rx="1"></rect></svg>',
        chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>',
        warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"></path><path d="M12 10v4M12 17v.5"></path></svg>',
    };

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
            html, body { margin:0; height:100%; background:#0e151e; }
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
                <div class="mks-brand"><span class="mks-logo">W</span><b>Wheeliecat's scripts</b><span class="mks-ver">v${VERSION}${CHANNEL === 'beta' ? ' · beta' : ''}</span></div>
                <span class="mks-sp"></span>
                <label class="mks-find">${ICON.search}<input class="mks-search" type="search" placeholder="Zoek script…" aria-label="Zoek script"></label>
                ${canPip() ? `<button class="mks-iconbtn mks-pipbtn" title="Zwevend venster: blijft boven alles, ook als je het spel gebruikt" aria-label="Zwevend venster">${ICON.pip}</button>` : ''}
                <button class="mks-iconbtn mks-close" title="Sluiten (Esc)" aria-label="Sluiten">${ICON.close}</button>
              </div>
              <div class="mks-wip">${ICON.warn}<span><b>Werk in uitvoering.</b> Deze scripts worden nog volop aangepast. Er kunnen fouten in zitten;
                gebruik ze op eigen risico en controleer wat ze doen.</span></div>
              <div class="mks-reload" hidden><span>Sommige wijzigingen werken pas na herladen van de pagina.</span>
                <button class="mks-btn primary">Nu herladen</button></div>
              <div class="mks-main">
                <div class="mks-side"><nav class="mks-nav" aria-label="Scripts"></nav><div class="mks-count"></div></div>
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

        // A sidebar group is open unless folded away (remembered); a search opens all,
        // and so does the group of the script that is shown.
        const groupOpen = (cat) => !!query || folds[`side:${cat}`] !== false || (byId[view] && byId[view].category === cat);
        function renderSide() {
            if (!root) return;
            const side = root.querySelector('.mks-nav');
            const match = (d) => !query || `${d.name} ${d.description} ${d.id}`.toLowerCase().includes(query);
            const row = (id, name, tone, text, cls, led) => `<div class="mks-row ${view === id ? 'sel' : ''} ${cls}" data-id="${id}" role="button" tabindex="0">
                <span class="mks-rt"><span class="mks-nm">${name}</span><span class="mks-st ${tone}">${esc(text)}</span></span>${led}</div>`;
            let html = row(HOME, 'Overzicht', '', 'Status, importeren, back-up', '', '');
            for (const cat of CATEGORIES) {
                const list = defs.filter((d) => d.category === cat.id && match(d));
                if (!list.length) continue;
                const on = list.filter(isEnabled).length;
                html += `<div class="mks-grp ${groupOpen(cat.id) ? 'open' : ''}" data-cat="${cat.id}">
                    <button class="mks-gh" aria-expanded="${groupOpen(cat.id)}">${ICON.chevron}<span>${esc(cat.label)}</span><span class="n">${on}/${list.length}</span></button>
                    <div class="mks-gl">`;
                for (const d of list) {
                    const [tone, text] = rowStatus(d);
                    const name = `${esc(d.name)}${d.warning ? ' <span class="mks-wsign" title="Let op: zie waarschuwing">⚠</span>' : ''}`;
                    html += row(d.id, name, tone, text, isEnabled(d) ? '' : 'off', `<span class="mks-led ${isEnabled(d) ? 'on' : ''} ${runtime(d).error ? 't-error' : ''}" aria-hidden="true"></span>`);
                }
                html += '</div></div>';
            }
            side.innerHTML = html;
            side.querySelectorAll('.mks-row').forEach((r) => {
                r.addEventListener('click', () => select(r.dataset.id));
                r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.dataset.id); } });
            });
            side.querySelectorAll('.mks-gh').forEach((b) => b.addEventListener('click', () => {
                const g = b.parentNode;
                const open = !g.classList.contains('open');
                g.classList.toggle('open', open);
                b.setAttribute('aria-expanded', String(open));
                folds[`side:${g.dataset.cat}`] = open;
                try { GM_setValue(FOLDS_KEY, JSON.stringify(folds)); } catch (e) { /* ignore */ }
            }));
            const on = defs.filter(isEnabled).length;
            root.querySelector('.mks-count').textContent = `${on} van ${defs.length} scripts aan`;
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
                  <div class="mks-dht"><h2>${esc(def.name)}</h2><div class="mks-pills">${pillsFor(def)}</div></div>
                  ${switchHtml(isEnabled(def), 'lg')}
                </div>
                <p class="mks-desc">${def.description || ''}</p>
                ${def.warning ? `<div class="mks-warn">${ICON.warn}<div>${def.warning}</div></div>` : ''}
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
            const label = { ok: 'Loopt in dit tabblad', busy: 'Bezig', warn: 'Let op', error: 'Fout' }[s.tone] || 'Status';
            slot.innerHTML = `<div class="mks-status t-${esc(s.tone)}"><div class="mks-line"><span class="mks-dot t-${esc(s.tone)}"></span><span>${label}</span></div>
                <div class="t">${esc(s.text)}</div>
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
            box.querySelectorAll('details.mks-fold[data-fold]').forEach((d) => d.addEventListener('toggle', () => {
                folds[d.dataset.fold] = d.open;
                try { GM_setValue(FOLDS_KEY, JSON.stringify(folds)); } catch (e) { /* ignore */ }
            }));
        }

        // Unfolded setting extras (ctx.settingExtra), by "module:key".
        const openExtras = new Set();
        function renderSettings(def, box) {
            const list = def.settings || [];
            const extras = runtime(def).extras || {};
            if (!list.length) { box.innerHTML = ''; return; }
            const cfg = settingsOf(def);
            // s.group: a sub-heading above the first setting of each group (a group's settings
            // are kept together, in the order the groups first appear).
            // s.advanced: tucked away under "Geavanceerd" (fine-tuning).
            // s.parent: inside that setting's unfolding part.
            let lastGroup = null;
            const rows = (items) => items.map(([s, i]) => {
                const head = s.group && s.group !== lastGroup ? `<div class="mks-sg">${esc(s.group)}</div>` : '';
                if (s.group) lastGroup = s.group;
                return head + rowHtml(s, i);
            }).join('');
            const keys = new Set(list.map((s) => s.key));
            const childrenOf = {};
            list.forEach((s, i) => { if (s.parent && keys.has(s.parent)) (childrenOf[s.parent] = childrenOf[s.parent] || []).push([s, i]); });
            const indexed = list.map((s, i) => [s, i]).filter(([s]) => !(s.parent && keys.has(s.parent)));
            const order = [];
            indexed.forEach(([s]) => { const g = s.group || ''; if (!order.includes(g)) order.push(g); });
            const byGroup = (items) => order.flatMap((g) => items.filter(([s]) => (s.group || '') === g));
            const main = byGroup(indexed.filter(([s]) => !s.advanced));
            const adv = byGroup(indexed.filter(([s]) => s.advanced));
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
                const kids = childrenOf[s.key] || [];
                if (extras[s.key] || kids.length) {
                    const open = openExtras.has(`${def.id}:${s.key}`);
                    const more = kids.length ? ` <span class="mks-xn">(${kids.length})</span>` : '';
                    return `<div class="mks-set" data-i="${i}"><div class="l mks-xl" title="Klik voor meer">${open ? '▾' : '▸'} ${esc(s.label)}${more}${s.help ? `<span class="h">${s.help}</span>` : ''}</div><div class="c">${control}</div></div>`
                        + `<div class="mks-set-x" data-x="${i}" ${open ? '' : 'hidden'}>${kids.map(([k, j]) => rowHtml(k, j)).join('')}<div class="mks-set-xc"></div></div>`;
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
            box.querySelectorAll('.mks-set-x').forEach((x) => {
                const s = list[Number(x.dataset.x)];
                const id = `${def.id}:${s.key}`;
                const xc = x.querySelector(':scope > .mks-set-xc');
                const draw = () => { if (!extras[s.key]) return; try { extras[s.key](xc); } catch (e) { xc.textContent = `Kon niet laden: ${e.message}`; console.error(e); } };
                if (!x.hidden) draw();
                const label = x.previousElementSibling.querySelector('.l');
                label.addEventListener('click', () => {
                    x.hidden = !x.hidden;
                    if (x.hidden) openExtras.delete(id); else { openExtras.add(id); draw(); }
                    label.firstChild.textContent = `${x.hidden ? '▸' : '▾'} ${s.label}`;
                });
            });
            box.querySelector('.mks-reset a').addEventListener('click', () => resetSettings(def));
        }

        const fmtRange = (s, v) => (s.format ? s.format(Number(v)) : `${v}${s.unit || ''}`);

        function renderHome(el) {
            const running = defs.filter((d) => runtime(d).running && runtime(d).status);
            const on = defs.filter(isEnabled).length;
            const errors = defs.filter((d) => runtime(d).error).length;
            el.innerHTML = `
                <div class="mks-dh"><h2>Overzicht</h2></div>
                <div class="mks-stats">
                  <div class="t-ok"><b>${on}</b><span>aan</span></div>
                  <div><b>${defs.length - on}</b><span>uit</span></div>
                  <div><b>${running.length}</b><span>actief op deze pagina</span></div>
                  <div class="${errors ? 't-error' : ''}"><b>${errors}</b><span>fouten</span></div>
                </div>
                ${on ? '' : `<div class="mks-callout"><b>Alles staat nog uit.</b> Kies links welke scripts je wilt gebruiken:
                  klik op een script om te lezen wat het doet, en zet het aan met het schuifje rechtsboven.</div>`}
                <p class="mks-desc">Wheeliecat's scripts voor Meldkamerspel, allemaal in één. Kies links een script om te lezen wat het doet, zet het aan met het schuifje en pas de instellingen aan.
                  De meeste wijzigingen werken direct; anders verschijnt bovenin een knop om te herladen.</p>
                <h4 class="mks-h">Nu actief op deze pagina</h4>
                <div class="mks-now">${running.length ? running.map((d) => {
                    const s = runtime(d).status;
                    return `<div class="mks-row" data-go="${d.id}" role="button" tabindex="0"><span class="mks-rt">
                        <span class="mks-nm">${esc(d.name)}</span><span class="mks-st t-${esc(s.tone)}">${esc(s.text)}</span></span><span class="mks-dot t-${esc(s.tone)}"></span></div>`;
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

    /* ------------------------------------------------------------------------
     * REMOTE OFF SWITCH — a file named STOP in the Log naar GitHub repository
     * (same repo and token) stops the automation modules on every computer
     * that runs them, at their next round. Delete the file to allow a restart.
     * Checked at most once a minute; no token or repo = never stopped.
     * ---------------------------------------------------------------------- */
    let stopCache = { at: 0, val: false };
    function remoteStop() {
        if (Date.now() - stopCache.at < 60000) return Promise.resolve(stopCache.val);
        const token = GM_getValue('mks.logGithub.token', '');
        const repo = String((state.settings['log-github'] || {}).repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
        if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return Promise.resolve(false);
        return new Promise((resolve) => {
            const done = (val) => { stopCache = { at: Date.now(), val }; resolve(val); };
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://api.github.com/repos/${repo}/contents/STOP?t=${Date.now()}`,
                    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
                    timeout: 15000,
                    onload: (r) => done(r.status === 200),
                    onerror: () => done(false),
                    ontimeout: () => done(false),
                });
            } catch (e) { done(false); }
        });
    }

    return { module, boot, esc, nl, W, IS_TOP, remoteStop };
})();
