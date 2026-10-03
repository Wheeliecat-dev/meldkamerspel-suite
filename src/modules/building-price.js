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
