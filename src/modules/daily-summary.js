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
