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
