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
            help: 'Toont credits per uur als los item in de navigatiebalk. Uit = alleen in het Scripts-menu.' },
        { key: 'sampleMin', label: 'Meten elke', type: 'number', default: 5, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rateHours', label: 'Tempo over de laatste', type: 'number', default: 3, min: 1, max: 24, step: 1, unit: 'uur' },
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
            LOG_MAX_PAGES: 30,         // credit log pages fetched per import
            LOG_DAYS: 14,              // stop importing when rows get older than this
            LOG_DELAY_MS: 400,
            REQUEST_TIMEOUT_MS: 20000,
            SAMPLES_KEY: 'incomeTracker.samples.v1',
            LAST_KEY: 'incomeTracker.lastSample',
            GOAL_KEY: 'incomeTracker.goal',
            TAB_KEY: 'incomeTracker.tab',
            LOG_KEY: 'incomeTracker.log.v1',
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

        let importing = false;
        async function importLog(onProgress) {
            if (importing) return;
            importing = true;
            const all = [];
            let headers = [];
            const stopAt = Date.now() - CONFIG.LOG_DAYS * 86400e3;
            try {
                let maxPage = 1;
                for (let p = 1; p <= Math.min(maxPage, CONFIG.LOG_MAX_PAGES); p++) {
                    onProgress(`Pagina ${p}${maxPage > 1 ? ' / ' + Math.min(maxPage, CONFIG.LOG_MAX_PAGES) : ''}…`);
                    const res = await fetchWithTimeout(`/credits?page=${p}`);
                    if (!res.ok) throw new Error(`GET /credits?page=${p} failed: ${res.status}`);
                    const parsed = parseCreditLog(await res.text());
                    if (p === 1) { headers = parsed.headers; }
                    maxPage = Math.max(maxPage, parsed.maxPage);
                    if (!parsed.rows.length) break;
                    all.push(...parsed.rows);
                    const dated = parsed.rows.filter(r => r.date);
                    if (dated.length && dated.every(r => r.date < stopAt)) break;
                    await sleep(CONFIG.LOG_DELAY_MS);
                }
                const data = { at: Date.now(), headers, rows: all.filter(r => !r.date || r.date >= stopAt) };
                GM_setValue(CONFIG.LOG_KEY, JSON.stringify(data));
                log(`credit log: ${all.length} rows, headers:`, headers);
                return data;
            } finally {
                importing = false;
            }
        }
        const loadLog = () => { try { return JSON.parse(GM_getValue(CONFIG.LOG_KEY, 'null')); } catch (e) { return null; } };

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
            logStatus: '',
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
            let html = `<div class="it-ctl">
                <button id="it-log-import" ${importing ? 'disabled' : ''}>${data ? '↻ Logboek opnieuw inlezen' : '📥 Credit-logboek inlezen'}</button>
                <span class="it-note" id="it-log-status">${esc(ui.logStatus || (data ? `Ingelezen ${age < 1 ? 'net' : age + ' min geleden'} · ${nl(data.rows.length)} regels` : `Leest max. ${CONFIG.LOG_MAX_PAGES} pagina's van /credits (laatste ${CONFIG.LOG_DAYS} dagen).`))}</span>
              </div>`;
            if (data && data.rows.length) {
                const rows = data.rows;
                const dated = rows.filter(r => r.date);
                const spanTxt = dated.length ? `${timeLabel(Math.min(...dated.map(r => r.date)))} – ${timeLabel(Math.max(...dated.map(r => r.date)))}` : 'datum onbekend';

                // Category summary.
                const cat = new Map();
                for (const r of rows) {
                    const k = category(r) + (r.amount < 0 ? ' (uit)' : '');
                    const c = cat.get(k) || { n: 0, sum: 0 };
                    c.n++; c.sum += r.amount;
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
                    g.n++; g.total += r.amount;
                    g.max = Math.max(g.max, Math.abs(r.amount)); g.min = Math.min(g.min, Math.abs(r.amount));
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
                    await importLog((m) => { ui.logStatus = m; const s = overlay && overlay.querySelector('#it-log-status'); if (s) s.textContent = m; });
                    ui.logStatus = '';
                } catch (e) {
                    warn('log import failed', e);
                    ui.logStatus = 'Inlezen mislukt: ' + e.message;
                }
                render();
            };
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
        setInterval(updateBadge, CONFIG.BADGE_MS);
        updateBadge();
        log('started');
    },
});
