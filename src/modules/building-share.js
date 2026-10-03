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
