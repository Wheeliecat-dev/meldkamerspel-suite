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
