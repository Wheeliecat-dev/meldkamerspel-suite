MKS.module({
    id: 'personnel-assign',
    name: 'Personeel toewijzen',
    short: 'Toewijzen',
    icon: '🧑‍🚒',
    category: 'map',
    description: 'Op de pagina <i>Personeel toewijzen</i> van een voertuig: één knop vult het voertuig tot het maximum, met het personeel '
        + 'dat het opleidingsfilter van het spel toont. Kies je in het filter een opleiding, dan krijg je alleen mensen met die opleiding. '
        + 'Bij <i>Alles</i> gaan mensen met de minste opleidingen eerst, zodat je specialisten vrij blijven. '
        + 'Een tweede knop haalt al het personeel van het voertuig af. '
        + 'In het dashboard: <b>Alle voertuigen met een opleiding bemannen</b> loopt al je voertuigen langs die een opleiding vragen en zet er '
        + 'precies het minimum aantal mensen met die opleiding op, alleen vrij personeel uit hetzelfde gebouw (groene knop). '
        + 'Er wordt nooit iemand afgehaald en nooit iemand van een ander voertuig gepakt.',
    warning: '<b>Dit verandert de bezetting van je voertuigen in het spel.</b> Het klikt voor je op de knoppen '
        + '<i>Voertuig toewijzen</i> en <i>Voertuigtoewijzing verwijderen</i>, precies zoals je dat zelf zou doen. '
        + 'Er gebeurt pas iets als je op een van de knoppen klikt.',
    confirmOn: 'Let op: deze module wijst personeel toe aan voertuigen in het spel (of haalt het eraf) als je op de knoppen klikt.\n\nAanzetten?',
    at: 'ready',
    frames: 'all',
    live: true,
    settings: [
        { key: 'steal', label: 'Ook personeel van andere voertuigen', type: 'bool', default: false,
            help: 'Uit: alleen personeel dat nog op geen enkel voertuig staat (groene knop). Aan: daarna ook mensen van andere voertuigen (oranje knop).' },
        { key: 'delayMs', label: 'Pauze tussen klikken', type: 'number', default: 300, min: 100, max: 3000, step: 50, unit: 'ms' },
    ],

    run(ctx) {
        if (!/^\/vehicles\/\d+\/zuweisung\/?$/.test(location.pathname)) return window.top === window ? sweepAll(ctx) : { stop() {} };
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

/* ============================================================================
 * SWEEP — every vehicle whose type needs a training gets the minimum number of
 * trained people: free people of its own building only (green button), fewest
 * other trainings first. Nobody is taken off a vehicle; orange buttons (people
 * on another vehicle) are never used.
 * ========================================================================== */
function sweepAll(ctx) {
    // Vehicle type: [minimum crew, training, trained needed (0 = the whole minimum crew)].
    const TRAINED = {
            11: [1, "Verkenningseenheid Brandweer", 0], 19: [1, "Hoofd Officier van Dienst - Brandweer", 0], 23: [1, "MMT-Bemanningslid", 0],
            24: [1, "Adviseur Gevaarlijke Stoffen", 0], 26: [1, "Brandweerchauffeur-zwaar", 0], 28: [1, "Politiehelikopter", 0],
            31: [1, "Brandweerchauffeur-zwaar", 0], 33: [4, "Duiker/Duikploegleider", 0], 35: [1, "Officier van Dienst - Politie", 0],
            37: [1, "MMT-Bemanningslid", 0], 38: [1, "Officier van Dienst Geneeskunde", 0], 39: [2, "Mobiele Eenheid", 0], 40: [4, "Mobiele Eenheid", 0],
            41: [2, "Vliegtuigbrandbestrijding", 0], 42: [2, "Vliegtuigbrandbestrijding", 0], 43: [2, "Vliegtuigbrandbestrijding", 0],
            44: [1, "Airport Fire Officer / On Scene Commander", 0], 46: [1, "Motoragent", 0], 47: [1, "Hondengeleider", 0], 48: [1, "Hondengeleider", 0],
            49: [4, "Oppervlakteredder", 0], 50: [4, "Oppervlakteredder", 0], 53: [1, "Operator AT", 0], 54: [2, "Operator AT", 0], 55: [1, "Operator AT", 0],
            56: [1, "Voorlichter", 0], 57: [1, "Officier van Dienst Geneeskunde", 0], 60: [1, "Biketeam", 0], 64: [6, "ME - Aanhoudingseenheid", 0],
            65: [2, "Waterredding", 0], 66: [2, "Waterredding", 0], 68: [2, "Brandweerchauffeur-zwaar", 0], 73: [1, "Bereden Brigade", 0],
            74: [0, "Bereden Brigade", 0], 76: [1, "Waterredding", 0], 77: [2, "Groot vaarbewijs", 1], 78: [2, "Groot vaarbewijs", 0],
            79: [2, "Groot vaarbewijs", 0], 80: [2, "SAR Helicopter", 0], 81: [1, "Weginspecteur", 0], 82: [1, "Weginspecteur", 0], 83: [1, "Weginspecteur", 0],
            84: [4, "ME - Waterwerper", 0], 85: [2, "Fire Bucket Operator", 0], 86: [7, "Handcrew", 0], 87: [1, "Landelijk Adviseur Natuurbranden", 0],
            88: [1, "Brandweerchauffeur-zwaar", 0], 90: [7, "Teamleider STH", 2], 92: [5, "Teamlid USAR", 0], 93: [4, "Teamlid USAR", 0],
            94: [2, "Brandweerchauffeur-zwaar", 0], 95: [1, "Teamlid USAR", 0], 96: [1, "Teamlid USAR", 0], 97: [2, "Hondengeleider USAR", 0],
            98: [1, "Chauffeur Dienst Infra", 0], 99: [1, "Verkeersongevallen Analist", 0], 100: [6, "Geneeskundige bijstandsverlener", 0],
            101: [4, "Noodhulpteam", 0], 103: [3, "Intensive Care Team", 0], 104: [1, "Berger Training", 0], 105: [1, "Berger Training", 0],
            106: [1, "Berger Training", 0], 107: [1, "Berger Training", 0], 108: [1, "Berger Training", 0], 109: [1, "Berger Training", 0],
            110: [1, "Marechaussee", 0], 111: [1, "Marechaussee", 0], 112: [1, "Marechaussee", 0], 113: [1, "Bomontmanteling", 0], 114: [2, "Bomontmanteling", 0],
            115: [2, "Bomontmanteling", 0], 116: [2, "Hondengeleider EOD", 0], 117: [2, "Duiker Defensie", 0], 119: [1, "Bomverkenner", 0],
            120: [2, "Verzorger", 0], 122: [2, "Hygiënemedewerker", 0], 124: [1, "Pelotonscommandant Logistiek", 0], 128: [3, "Drone Flightcrew", 0],
            129: [3, "TDV Drone Flightcrew", 0], 130: [2, "Brandweerchauffeur-zwaar", 0], 131: [2, "Brandweerchauffeur-zwaar", 0],
            132: [2, "Brandweerchauffeur-zwaar", 0], 133: [1, "Brandweerchauffeur-zwaar", 0], 135: [4, "Gevaarlijke Stoffen Eenheid", 0],
            137: [4, "Gevaarlijke Stoffen Eenheid", 0], 139: [6, "Ontsmettings Eenheid", 0], 140: [6, "Ontsmettings Eenheid", 0],
            142: [6, "Ontsmettings Eenheid", 0], 143: [6, "Ontsmettings Eenheid", 0], 144: [1, "Incidentenbestrijder spoor", 0],
            145: [1, "Officier van Dienst Incidentenbestrijder spoor", 0], 146: [1, "Brandweerchauffeur-zwaar", 0], 147: [1, "Brandweerchauffeur-zwaar", 0],
            148: [1, "Brandweerchauffeur-zwaar", 0], 150: [1, "Incidentenbestrijder spoor", 0], 152: [1, "Incidentenbestrijder spoor", 0],
    };
    // Trainings the assign page names differently (its filter: key = label).
    const ALIAS = { 'Verkenningseenheid Brandweer': 'gw_messtechnik', 'Hoofd Officier van Dienst - Brandweer': 'elw2',
        'Adviseur Gevaarlijke Stoffen': 'gw_gefahrgut', 'ME - Aanhoudingseenheid': 'detention_unit', 'Bereden Brigade': 'police_horse',
        'Noodhulpteam': 'mass_casualty' };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (t) => String(t || '').toLowerCase().replace(/\(\d+\s*dag(en)?\)/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const token = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
    const getDoc = async (url) => {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return new DOMParser().parseFromString(await r.text(), 'text/html');
    };
    const log = [];
    const note = (t, tone = 'idle') => { log.unshift({ at: new Date().toLocaleTimeString('nl-NL'), t, tone }); log.length = Math.min(log.length, 200); ctx.refresh(); };
    let busy = false, stopAsked = false;

    async function run() {
        if (busy) return;
        busy = true;
        stopAsked = false;
        let done = 0, people = 0, short = 0;
        try {
            const vehicles = await (await fetch('/api/vehicles', { credentials: 'same-origin' })).json();
            const todo = vehicles.filter((v) => TRAINED[v.vehicle_type] && (Number(v.assigned_personnel_count) || 0) < TRAINED[v.vehicle_type][0]);
            note(`${todo.length} voertuig(en) met een opleiding hebben minder dan het minimum aan personeel`);
            for (const [i, v] of todo.entries()) {
                if (stopAsked) { note('gestopt'); break; }
                ctx.status(`Bemannen ${i + 1}/${todo.length}: ${v.caption}`, { tone: 'busy', progress: [i, todo.length] });
                const [minCrew, training, rule] = TRAINED[v.vehicle_type];
                const doc = await getDoc(`/vehicles/${v.id}/zuweisung`);
                // The training's key ("ovd_p") from the page's own filter list.
                const opt = (ALIAS[training] && [...doc.querySelectorAll('select option')].find((o) => o.value === ALIAS[training]))
                    || [...doc.querySelectorAll('select option')].find((o) => norm(o.textContent) === norm(training))
                    || [...doc.querySelectorAll('select option')].find((o) => o.value !== 'all' && norm(o.textContent).startsWith(norm(training)))
                    || [...doc.querySelectorAll('select option')].find((o) => o.value !== 'all' && norm(training).startsWith(norm(o.textContent)));
                if (!opt) { note(`${v.caption}: opleiding "${training}" niet gevonden op de pagina`, 'warn'); continue; }
                const key = opt.value;
                const rows = [...doc.querySelectorAll('tr[id^="personal_"]')].map((tr) => {
                    let keys = [];
                    try { keys = JSON.parse(tr.getAttribute('data-filterable-by') || '[]'); } catch (e) { /* none */ }
                    const btn = tr.querySelector('a.btn[personal_id]');
                    return { pid: btn?.getAttribute('personal_id'), keys, btn, busyNow: /In opleiding/i.test(tr.textContent) };
                }).filter((r) => r.pid);
                const onIt = rows.filter((r) => r.btn.classList.contains('btn-assigned'));
                let seatsMax = null;
                for (const sc of doc.scripts) { const m = sc.textContent.match(/personal_max\s*=\s*(\d+)/); if (m) seatsMax = Number(m[1]); }
                const want = rule ? rule : minCrew; // trained people needed
                const haveTrained = onIt.filter((r) => r.keys.includes(key)).length;
                let need = Math.max(0, want - haveTrained);
                if (seatsMax != null) need = Math.min(need, Math.max(0, seatsMax - onIt.length));
                if (!need) continue;
                const pool = rows.filter((r) => r.btn.classList.contains('btn-success') && !r.busyNow && r.keys.includes(key))
                    .sort((a, b) => a.keys.length - b.keys.length).slice(0, need);
                let ok = 0;
                for (const r of pool) {
                    await fetch(`/vehicles/${v.id}/zuweisungDo/${r.pid}`, { method: 'POST', credentials: 'same-origin',
                        headers: { 'X-CSRF-Token': token() }, body: new URLSearchParams({ authenticity_token: token() }) });
                    ok++;
                    await sleep(ctx.cfg.delayMs);
                }
                // Check on the page itself.
                const after = await getDoc(`/vehicles/${v.id}/zuweisung`);
                const confirmed = pool.filter((r) => after.querySelector(`a[personal_id="${r.pid}"]`)?.classList.contains('btn-assigned')).length;
                people += confirmed;
                if (confirmed) done++;
                // Out of service by Auto-alarmeren for missing crew: back in service now.
                if (confirmed) {
                    try {
                        const m = JSON.parse(GM_getValue('mks.autoDispatch.uncrewed.v1', '{}')) || {};
                        if (m[v.id]) {
                            await fetch(`/vehicles/${v.id}/set_fms/2`, { credentials: 'same-origin' });
                            delete m[v.id];
                            GM_setValue('mks.autoDispatch.uncrewed.v1', JSON.stringify(m));
                            note(`${v.caption}: weer in dienst (stond uit dienst wegens ontbrekend personeel)`, 'ok');
                        }
                    } catch (e) { /* ignore */ }
                }
                if (confirmed < need) {
                    short++;
                    note(`${v.caption}: ${confirmed} van ${need} met "${opt.textContent.trim()}" gekoppeld${pool.length < need ? ' (niet genoeg vrij opgeleid personeel in dit gebouw)' : ''}`, 'warn');
                } else note(`${v.caption}: ${confirmed} met "${opt.textContent.trim()}" gekoppeld`, 'ok');
                if (ok !== confirmed) await sleep(1000);
            }
            ctx.status(`Klaar: ${people} personeelsleden op ${done} voertuig(en)${short ? `, ${short} nog niet compleet` : ''}`, { tone: short ? 'warn' : 'ok' });
            note(`klaar: ${people} personeelsleden op ${done} voertuig(en)${short ? `, ${short} nog niet compleet` : ''}`, short ? 'warn' : 'ok');
        } catch (e) {
            ctx.err(e);
            ctx.status(`Fout: ${e.message}`, { tone: 'error' });
            note(`fout: ${e.message}`, 'error');
        } finally { busy = false; ctx.refresh(); }
    }

    ctx.actions([
        { label: 'Alle voertuigen met een opleiding bemannen', kind: 'primary',
            confirm: 'Alle voertuigen langslopen die een opleiding vragen en er het minimum aan opgeleid, vrij personeel uit hetzelfde gebouw op zetten?\n\nEr wordt niemand afgehaald of van een ander voertuig gepakt.',
            run: () => run() },
        { label: 'Stoppen', run: () => { stopAsked = true; } },
    ]);
    ctx.panel((el) => {
        el.innerHTML = log.length
            ? `<div class="mks-tblwrap"><table class="mks-tbl"><tbody>${log.map((l) => `<tr><td class="mono mks-dim">${ctx.esc(l.at)}</td><td class="${l.tone === 'warn' ? 't-warn' : l.tone === 'error' ? 't-error' : ''}">${ctx.esc(l.t)}</td></tr>`).join('')}</tbody></table></div>`
            : '<p class="mks-note">Klik op <b>Alle voertuigen met een opleiding bemannen</b>. Alleen vrij personeel met de juiste opleiding uit hetzelfde gebouw, precies het minimum.</p>';
    });
    ctx.status('Klaar om te bemannen', { tone: 'idle' });
    return { stop() { stopAsked = true; } };
}
