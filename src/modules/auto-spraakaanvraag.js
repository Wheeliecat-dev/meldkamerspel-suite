MKS.module({
    id: 'auto-spraakaanvraag',
    name: 'Spraakaanvragen beantwoorden',
    short: 'Spraak',
    icon: '📻',
    category: 'auto',
    description: 'Beantwoordt spraakaanvragen (status 5) op de achtergrond: na een willekeurige wachttijd gaat het voertuig naar het dichtstbijzijnde ziekenhuis of de dichtstbijzijnde cel die niets kost. Opent nooit een voertuigvenster.',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Alleen op de kaartpagina',
    live: true,
    settings: [
        { key: 'minWaitSec', label: 'Minimale wachttijd', type: 'number', default: 5, min: 0, max: 300, step: 1, unit: 'sec' },
        { key: 'maxWaitSec', label: 'Maximale wachttijd', type: 'number', default: 15, min: 0, max: 600, step: 1, unit: 'sec',
            help: 'Elke aanvraag wacht een willekeurige tijd tussen minimum en maximum.' },
        { key: 'maxCost', label: 'Maximale kosten', type: 'number', default: 0, min: 0, max: 50, step: 1, unit: '%',
            help: 'Alleen ziekenhuizen/cellen met deze kosten of minder. Eigen gebouwen kosten 0 %.' },
        { key: 'pollMin', label: 'Controle op gemiste aanvragen', type: 'number', default: 2, min: 1, max: 30, step: 1, unit: 'min' },
        { key: 'showChip', label: 'Teller linksonder', type: 'bool', default: true, help: 'Klein label met het aantal beantwoorde aanvragen.' },
    ],

    run(ctx) {

        /* ========================================================================
         * CONFIG
         * ==================================================================== */
        const CONFIG = {
            get MIN_WAIT_MS() { return Math.min(ctx.cfg.minWaitSec, ctx.cfg.maxWaitSec) * 1000; },
            get MAX_WAIT_MS() { return Math.max(ctx.cfg.minWaitSec, ctx.cfg.maxWaitSec) * 1000; },
            get MAX_COST_PERCENT() { return ctx.cfg.maxCost; },
            get POLL_MS() { return ctx.cfg.pollMin * 60000; },
            RETRY_NO_TARGET_MS: 60000, // no valid target: try again after this
            REQUEST_TIMEOUT_MS: 20000,
        };

        const { log, warn } = ctx;
        const W = ctx.W;

        // vehicleId -> 'pending' | timestamp until which we skip it
        const state = new Map();
        let enabled = true;
        let lastText = '';
        let answered = 0;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const randomWait = () =>
            CONFIG.MIN_WAIT_MS + Math.random() * (CONFIG.MAX_WAIT_MS - CONFIG.MIN_WAIT_MS);

        async function fetchWithTimeout(url, opts) {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { credentials: 'same-origin', ...opts, signal: ctrl.signal });
            } finally {
                clearTimeout(t);
            }
        }

        /* ========================================================================
         * TARGET SELECTION
         * ====================================================================
         * The vehicle page has one table per target group (own-hospitals,
         * alliance-hospitals, and the cell tables for prisoners). Each row has an
         * "Aanrijden" button linking to /vehicles/{id}/{kind}/{buildingId}.
         * Own buildings have no "Kosten" column, so they count as 0 %.
         * ==================================================================== */
        const parseNumber = (s) => parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(',', '.'));

        function findTargets(doc, vehicleId) {
            const linkRe = new RegExp(`^/vehicles/${vehicleId}/[a-z_]+/\\d+$`);
            const targets = [];
            for (const table of doc.querySelectorAll('table')) {
                const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim().toLowerCase());
                const iDist = heads.findIndex(h => h.startsWith('afstand'));
                if (iDist < 0) continue;
                const iCost = heads.findIndex(h => h.startsWith('kosten'));
                const iFree = heads.findIndex(h => h.startsWith('vrij'));

                for (const tr of table.querySelectorAll('tbody tr')) {
                    const a = [...tr.querySelectorAll('a.btn')].find(x => linkRe.test(x.getAttribute('href') || ''));
                    if (!a || a.classList.contains('disabled')) continue;
                    const tds = tr.children;
                    const cost = iCost >= 0 ? parseNumber(tds[iCost].textContent) : 0;
                    const dist = parseNumber(tds[iDist].textContent);
                    const free = iFree >= 0 ? parseNumber(tds[iFree].textContent.split('/')[0]) : 1;
                    targets.push({
                        href: a.getAttribute('href'),
                        name: tds[0].childNodes[0].textContent.trim(),
                        table: table.id,
                        dist, cost, free,
                    });
                }
            }
            return targets;
        }

        function pickTarget(targets) {
            return targets
                .filter(t => t.cost <= CONFIG.MAX_COST_PERCENT && t.free > 0 && !isNaN(t.dist))
                .sort((a, b) => a.dist - b.dist)[0] || null;
        }

        /* ========================================================================
         * ANSWERING
         * ==================================================================== */
        async function answer(vehicleId, caption) {
            if (!enabled || state.get(vehicleId) === 'pending') return;
            const skipUntil = state.get(vehicleId);
            if (typeof skipUntil === 'number' && Date.now() < skipUntil) return;
            state.set(vehicleId, 'pending');

            try {
                await sleep(randomWait());
                if (!enabled) return;

                const res = await fetchWithTimeout(`/vehicles/${vehicleId}`);
                if (!res.ok) throw new Error(`vehicle page HTTP ${res.status}`);
                const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
                const targets = findTargets(doc, vehicleId);
                if (!targets.length) {
                    // Request was already answered, or it is not a transport request.
                    state.delete(vehicleId);
                    return;
                }
                const target = pickTarget(targets);
                if (!target) {
                    warn(`${caption || vehicleId}: no target at ${CONFIG.MAX_COST_PERCENT} % with free space`);
                    state.set(vehicleId, Date.now() + CONFIG.RETRY_NO_TARGET_MS);
                    return;
                }

                const go = await fetchWithTimeout(target.href);
                if (!go.ok) throw new Error(`send HTTP ${go.status}`);
                answered++;
                lastText = `${caption || vehicleId} → ${target.name}`;
                updateBadge();
                log(`${caption || vehicleId} -> ${target.name} (${target.dist} km, ${target.cost} %)`);
                state.delete(vehicleId);
            } catch (e) {
                warn(`${caption || vehicleId}: failed`, e);
                state.set(vehicleId, Date.now() + CONFIG.RETRY_NO_TARGET_MS);
            }
        }

        /* ========================================================================
         * DETECTION
         * ====================================================================
         * radioMessage() is the game's live status-change handler. Wrap it so
         * every status-5 vehicle is picked up right away. A slow poll of
         * /api/vehicles catches requests that were open before page load.
         * ==================================================================== */
        function hookRadio() {
            // Hook once per page. A restart from the dashboard only swaps the
            // handler, so the game's function never gets wrapped twice.
            if (W.__mksSpraakHooked) return true;
            const orig = W.radioMessage;
            if (typeof orig !== 'function') return false;
            W.__mksSpraakHooked = true;
            W.radioMessage = function (msg) {
                try {
                    if (msg && msg.type === 'vehicle_fms' && Number(msg.fms_real) === 5 && msg.user_id === W.user_id) {
                        W.__mksSpraakAnswer?.(msg.id, msg.caption);
                    }
                } catch (e) { warn('hook error', e); }
                return orig.apply(this, arguments);
            };
            return true;
        }

        async function poll() {
            if (!enabled) return;
            try {
                const res = await fetchWithTimeout('/api/vehicles');
                if (!res.ok) return;
                for (const v of await res.json()) {
                    if (v.fms_real === 5) answer(v.id, v.caption);
                }
            } catch (e) { warn('poll failed', e); }
        }

        /* ========================================================================
         * BADGE (click to turn on/off)
         * ==================================================================== */
        function updateBadge() {
            const tail = lastText ? ` · laatste: ${lastText}` : '';
            ctx.status(`${answered} beantwoord${tail}`, { tone: 'ok', dock: ctx.cfg.showChip });
        }
        ctx.onSettings(updateBadge);

        /* ========================================================================
         * START
         * ==================================================================== */
        W.__mksSpraakAnswer = answer;
        let pollTimer = null;
        const schedulePoll = () => { clearTimeout(pollTimer); pollTimer = setTimeout(() => { poll(); schedulePoll(); }, CONFIG.POLL_MS); };
        (async function start() {
            ctx.status('Wacht op het spel…', { tone: 'busy' });
            for (let i = 0; i < 30 && enabled && !hookRadio(); i++) await sleep(1000);
            if (!enabled) return;
            updateBadge();
            poll();
            schedulePoll();
            log('ready');
        })();

        return {
            stop() {
                enabled = false;
                clearTimeout(pollTimer);
                if (W.__mksSpraakAnswer === answer) W.__mksSpraakAnswer = null;
            },
        };
    },
});
