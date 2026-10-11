MKS.module({
    id: 'build-queue',
    name: 'Bouwwachtrij',
    icon: '🏗️',
    category: 'map',
    description: 'Zet nieuwe gebouwen in een wachtrij vanuit het gewone bouwmenu (knop "In wachtrij" naast "Bouwen"). '
        + 'Zodra je genoeg credits hebt, wordt de eerste in de rij gebouwd, precies zoals je hem had ingevuld: soort, naam, plek, meldkamer en startvoertuig. '
        + 'De prijs wordt vlak voor het bouwen opnieuw opgehaald, dus een duurdere volgende kazerne wordt gewoon meegenomen.',
    at: 'ready',
    frames: 'top',
    live: true,
    warning: 'Deze module <b>geeft credits uit</b>: hij bouwt de gebouwen in je wachtrij zodra er genoeg geld is. Nooit met coins.',
    confirmOn: 'Bouwwachtrij bouwt automatisch de gebouwen die je in de wachtrij zet, zodra je genoeg credits hebt. Dat kost credits en kan niet ongedaan worden gemaakt.\n\nAanzetten?',
    settings: [
        { key: 'buffer', label: 'Buffer (nooit uitgeven)', type: 'number', default: 0, min: 0, max: 100000000, step: 10000, unit: 'credits',
            help: 'Zoveel blijft altijd staan.' },
        { key: 'checkSec', label: 'Kijken elke', type: 'number', default: 60, min: 15, max: 3600, step: 15, unit: 'sec' },
    ],

    run(ctx) {
        const esc = ctx.esc;
        const KEY = 'mks.buildQueue.v1';
        const LAST = 'mks.buildQueue.lastCheck';
        const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
        const load = () => { try { return JSON.parse(GM_getValue(KEY, '[]')) || []; } catch (e) { return []; } };
        const save = (q) => GM_setValue(KEY, JSON.stringify(q));
        const log = [];
        const note = (t) => { log.unshift(`${new Date().toLocaleTimeString('nl-NL')} ${t}`); log.length = Math.min(log.length, 100); };
        let prices = {}; // building type -> current price (credits), refreshed each check
        let names = {};
        let busy = false;

        /* ---- The "In wachtrij" buttons in the game's build form ------------------ */
        // The form (#new_building) has one "Bouwen … Credits" button per building type
        // (#build_credits_<type>); the type select decides which section is shown.
        function decorate() {
            const form = document.getElementById('new_building');
            if (!form) return;
            form.querySelectorAll('input[id^="build_credits_"]').forEach((btn) => {
                if (btn.dataset.mksQueue) return;
                btn.dataset.mksQueue = '1';
                const q = document.createElement('button');
                q.type = 'button';
                q.className = 'btn btn-default';
                q.style.marginLeft = '6px';
                q.textContent = 'In wachtrij';
                q.title = 'Niet nu bouwen, maar zodra er genoeg credits zijn (Bouwwachtrij)';
                q.addEventListener('click', () => enqueue(form, btn.id.replace('build_credits_', ''), q));
                btn.insertAdjacentElement('afterend', q);
            });
        }
        function enqueue(form, type, button) {
            const fd = new FormData(form);
            const lat = fd.get('building[latitude]'), lon = fd.get('building[longitude]');
            if (!lat || !lon) { alert('Zet eerst de marker op de kaart (plek voor het gebouw).'); return; }
            fd.set('building[building_type]', type);
            // Everything the game would send, except what is fetched fresh when building.
            const fields = [...fd.entries()].filter(([k]) => !['authenticity_token', 'commit', 'build_with_coins', 'utf8'].includes(k));
            const typeName = form.querySelector(`#building_building_type option[value="${type}"]`)?.textContent.trim() || `type ${type}`;
            const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, typeName,
                name: String(fd.get('building[name]') || typeName), address: String(fd.get('building[address]') || ''), fields, added: Date.now() };
            const q = load();
            q.push(item);
            save(q);
            note(`in wachtrij: ${item.name} (${typeName})`);
            if (button) { button.textContent = '✓ In wachtrij'; button.disabled = true; }
            ctx.status(`${q.length} in wachtrij`, { tone: 'idle' });
            ctx.refresh();
        }

        /* ---- Building when there is money -------------------------------------- */
        async function getNew() {
            const r = await fetch('/buildings/new', { credentials: 'same-origin' });
            if (!r.ok) throw new Error(`/buildings/new: ${r.status}`);
            return new DOMParser().parseFromString(await r.text(), 'text/html');
        }
        async function check(force) {
            if (busy) return;
            const q = load();
            if (!q.length) { ctx.status('Wachtrij leeg', { tone: 'idle' }); return; }
            // One tab at a time: the last check by any tab counts.
            const last = Number(GM_getValue(LAST, 0)) || 0;
            if (!force && Date.now() - last < ctx.cfg.checkSec * 1000 * 0.8) return;
            GM_setValue(LAST, Date.now());
            busy = true;
            try {
                const doc = await getNew();
                prices = {};
                doc.querySelectorAll('input[id^="build_credits_"]').forEach((b) => { prices[b.id.replace('build_credits_', '')] = num(b.value); });
                doc.querySelectorAll('#building_building_type option').forEach((o) => { if (o.value) names[o.value] = o.textContent.trim(); });
                const credits = Number((await (await fetch('/api/credits', { credentials: 'same-origin' })).json()).credits_user_current) || 0;
                const item = q[0];
                const price = prices[item.type];
                const btn = doc.querySelector(`#build_credits_${item.type}`);
                const form = [...doc.forms].find((f) => /\/buildings$/.test(f.getAttribute('action') || ''));
                if (!btn || !form || !price) { ctx.status(`${item.name}: dit gebouw kan nu niet gebouwd worden`, { tone: 'warn' }); return; }
                const free = credits - ctx.cfg.buffer;
                if (free < price) {
                    ctx.status(`Spaart voor ${item.name}: ${ctx.nl(price)} nodig, ${ctx.nl(Math.max(0, free))} vrij (${q.length} in wachtrij)`, { tone: 'idle' });
                    return;
                }
                const before = (await (await fetch('/api/buildings', { credentials: 'same-origin' })).json()).length;
                const body = new URLSearchParams();
                body.set('utf8', '✓');
                body.set('authenticity_token', form.querySelector('input[name="authenticity_token"]')?.value || document.querySelector('meta[name="csrf-token"]')?.content || '');
                for (const [k, v] of item.fields) body.append(k, v);
                body.set('build_with_coins', ''); // credits, never coins
                body.set('commit', btn.value);
                const r = await fetch('/buildings', { method: 'POST', body, credentials: 'same-origin' });
                if (!r.ok) throw new Error(`bouwen: ${r.status}`);
                // Built? One building more, or the credits went down by about the price.
                let ok = false;
                for (let i = 0; i < 6 && !ok; i++) {
                    await new Promise((res) => setTimeout(res, 2000));
                    const n = (await (await fetch('/api/buildings', { credentials: 'same-origin' })).json()).length;
                    const c = Number((await (await fetch('/api/credits', { credentials: 'same-origin' })).json()).credits_user_current) || 0;
                    ok = n > before || c <= credits - price * 0.9;
                }
                if (ok) {
                    save(load().filter((x) => x.id !== item.id));
                    note(`gebouwd: ${item.name} (${item.typeName}) voor ${ctx.nl(price)} credits`);
                    ctx.status(`Gebouwd: ${item.name}`, { tone: 'ok' });
                } else {
                    note(`niet gelukt: ${item.name} (blijft in de wachtrij)`);
                    ctx.status(`Bouwen van ${item.name} lukte niet; blijft in de wachtrij`, { tone: 'warn' });
                }
            } catch (e) {
                ctx.err(e);
                note(`fout: ${e.message}`);
                ctx.status(`Fout: ${e.message}`, { tone: 'error' });
            } finally {
                busy = false;
                ctx.refresh();
            }
        }

        /* ---- Dashboard -------------------------------------------------------- */
        ctx.panel((el) => {
            const q = load();
            const seen = {};
            const rows = q.map((it, i) => {
                // The next building of a type costs more: only the first one of each type has
                // a known price; later ones show "meer".
                const first = !seen[it.type];
                seen[it.type] = true;
                const p = prices[it.type];
                return `<tr><td class="mono">${i + 1}</td><td>${esc(it.name)}<br><span class="mks-dim">${esc(it.typeName)}${it.address ? ` · ${esc(it.address)}` : ''}</span></td>
                    <td class="mono">${p ? (first ? ctx.nl(p) : `meer dan ${ctx.nl(p)}`) : '?'}</td>
                    <td><a class="mks-link" data-up="${esc(it.id)}">↑</a> <a class="mks-link" data-down="${esc(it.id)}">↓</a> <a class="mks-link" data-del="${esc(it.id)}">verwijderen</a></td></tr>`;
            }).join('');
            el.innerHTML = `<p class="mks-note">Open het bouwmenu (Nieuw gebouw maken), kies soort, plek en naam, en klik <b>In wachtrij</b> in plaats van Bouwen.
                    De bovenste wordt gebouwd zodra er genoeg credits zijn (prijs wordt vlak ervoor opnieuw opgehaald).</p>
                <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>#</th><th>Gebouw</th><th>Prijs</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="mks-dim">Wachtrij leeg.</td></tr>'}</tbody></table></div>
                ${log.length ? `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${log.map((l) => `<tr><td class="mono">${esc(l)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
            const move = (id, d) => {
                const list = load();
                const i = list.findIndex((x) => x.id === id);
                const j = i + d;
                if (i < 0 || j < 0 || j >= list.length) return;
                [list[i], list[j]] = [list[j], list[i]];
                save(list);
                ctx.refresh();
            };
            el.querySelectorAll('[data-up]').forEach((a) => a.addEventListener('click', () => move(a.dataset.up, -1)));
            el.querySelectorAll('[data-down]').forEach((a) => a.addEventListener('click', () => move(a.dataset.down, 1)));
            el.querySelectorAll('[data-del]').forEach((a) => a.addEventListener('click', () => { save(load().filter((x) => x.id !== a.dataset.del)); ctx.refresh(); }));
        });
        ctx.actions([
            { label: 'Nu kijken', kind: 'primary', run: () => check(true) },
            { label: 'Wachtrij leegmaken', kind: 'danger', confirm: 'Alle gebouwen uit de wachtrij halen?', run: () => { save([]); ctx.refresh(); } },
        ]);
        ctx.onSettings(() => { clearInterval(timer); timer = setInterval(check, ctx.cfg.checkSec * 1000); });

        // The build form is loaded into the side panel on demand: look for it every second
        // (an observer on the whole page would fire on every map update).
        const deco = setInterval(decorate, 1000);
        decorate();
        let timer = setInterval(check, ctx.cfg.checkSec * 1000);
        setTimeout(() => check(false), 5000);
        ctx.status(`${load().length} in wachtrij`, { tone: 'idle' });

        return { stop() { clearInterval(timer); clearInterval(deco); } };
    },
});
