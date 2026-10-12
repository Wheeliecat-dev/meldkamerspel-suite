MKS.module({
    id: 'main-destinations',
    name: 'Alleen ziekenhuizen en cellen van één speler',
    icon: '🤝',
    category: 'missions',
    description: 'Voor een tweede account: patiënten en arrestanten gaan alleen naar de ziekenhuizen en cellen van één teamspeler (bijvoorbeeld je hoofdaccount). '
        + 'Eigen gebouwen en die van andere teamleden worden overgeslagen. '
        + 'Auto-alarmeren volgt dit bij elke spraakaanvraag en elke arrestant; in het voertuigvenster worden de andere bestemmingen grijs. '
        + 'De eigenaar van een gebouw wordt één keer opgezocht (gebouwpagina, "Eigenaar") en onthouden.',
    at: 'ready',
    frames: 'all',
    settings: [
        { key: 'owner', label: 'Naam van de speler', type: 'text', default: '',
            help: 'Precies zoals in het team (bijvoorbeeld de naam van je hoofdaccount).' },
    ],

    run(ctx) {
        // Shared with Auto-alarmeren, which reads the same cache when it picks a destination.
        const OWNERS = 'mks.mainDest.owners';
        const owner = String(ctx.cfg.owner || '').trim();
        const load = () => { try { return JSON.parse(GM_getValue(OWNERS, '{}')) || {}; } catch (e) { return {}; } };

        async function ownerOf(bid) {
            const cache = load();
            if (bid in cache) return cache[bid];
            const r = await fetch(`/buildings/${bid}`, { credentials: 'same-origin' });
            if (!r.ok) return null;
            const d = new DOMParser().parseFromString(await r.text(), 'text/html');
            const dt = [...d.querySelectorAll('dt')].find((e) => /Eigenaar/i.test(e.textContent));
            const name = (dt?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim();
            const now = load();
            now[bid] = name;
            GM_setValue(OWNERS, JSON.stringify(now));
            return name;
        }

        // The vehicle window with a transport request: grey out what is not the player's.
        if (/^\/vehicles\/\d+\/?$/.test(location.pathname)) {
            if (!owner) return;
            (async () => {
                const links = [...document.querySelectorAll('a[href*="/patient/"]:not([href$="/-1"]), a[href*="/gefangener/"]:not([href$="/-1"])')];
                for (const a of links) {
                    const bid = (a.getAttribute('href').match(/\/(?:patient|gefangener)\/(\d+)/) || [])[1];
                    if (!bid) continue;
                    const o = await ownerOf(bid);
                    if (String(o || '').toLowerCase() === owner.toLowerCase()) continue;
                    const row = a.closest('tr') || a;
                    row.style.opacity = '0.3';
                    a.title = `Niet van ${owner}`;
                }
            })().catch((e) => ctx.err(e));
            return;
        }
        if (window.top !== window) return;

        ctx.panel((el) => {
            const cache = load();
            const all = Object.values(cache);
            const theirs = owner ? all.filter((n) => n.toLowerCase() === owner.toLowerCase()).length : 0;
            el.innerHTML = owner
                ? `<p class="mks-note">Bestemmingen alleen van <b>${ctx.esc(owner)}</b>. Auto-alarmeren slaat de rest over; past er niets, dan blijft de spraakaanvraag staan
                    (of wordt de patiënt/arrestant vrijgelaten als dat in Auto-alarmeren aan staat).</p>
                    <p class="mks-note">${all.length} gebouwen opgezocht, waarvan ${theirs} van ${ctx.esc(owner)}.</p>`
                : '<p class="mks-note">Vul bij de instellingen de naam van de speler in. Zonder naam doet deze module niets.</p>';
        });
        ctx.actions([
            { label: 'Eigenaren opnieuw opzoeken', confirm: 'De onthouden eigenaren van gebouwen wissen?', run: () => { GM_setValue(OWNERS, '{}'); ctx.refresh(); } },
        ]);
        ctx.status(owner ? `Alleen bestemmingen van ${owner}` : 'Geen speler ingevuld', { tone: owner ? 'ok' : 'warn' });
    },
});
