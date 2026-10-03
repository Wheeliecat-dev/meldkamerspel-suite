MKS.module({
    id: 'vehicle-status-bar',
    name: 'Voertuigstatusbalk',
    icon: '🚦',
    category: 'tools',
    description: 'Een balk onder de kaart met hoeveel voertuigen er per status zijn: beschikbaar, aanrijdend, ter plaatse, '
        + 'spraakaanvraag, transport en buiten dienst. Plus hoeveel procent van je inzetbare voertuigen bezig is. Werkt live mee.',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Alleen op de hoofdpagina met de kaart.',
    live: true,
    settings: [
        { key: 'place', label: 'Plaats', type: 'select', default: 'below',
            options: [['below', 'Onder de kaart'], ['above', 'Boven de kaart'], ['overlay', 'Op de kaart (linksonder)']] },
        { key: 'busy', label: 'Percentage bezig tonen', type: 'bool', default: true,
            help: 'Aanrijdend, ter plaatse, spraakaanvraag en transport, gedeeld door alles behalve buiten dienst.' },
        { key: 'hideZero', label: 'Statussen met 0 verbergen', type: 'bool', default: false },
    ],

    run(ctx) {
        const W = ctx.W;
        if (!W.map || typeof W.map.getContainer !== 'function') return;

        // Game FMS codes. Order = order in the bar.
        const STATUS = [
            { fms: 2, label: 'Op post', color: '#2e8b57', title: 'Beschikbaar op post' },
            { fms: 1, label: 'Vrij', color: '#3cb371', title: 'Beschikbaar via portofoon (vrij onderweg)' },
            { fms: 3, label: 'Aanrijdend', color: '#e08a00', title: 'Aanrijdend naar een inzet' },
            { fms: 4, label: 'Ter plaatse', color: '#c0392b', title: 'Ter plaatse' },
            { fms: 5, label: 'Spraak', color: '#d4ac0d', title: 'Spraakaanvraag' },
            { fms: 7, label: 'Transport', color: '#2874a6', title: 'Met patiënt of gevangene onderweg' },
            { fms: 8, label: 'Bij bestemming', color: '#7d3c98', title: 'Bij ziekenhuis of cel' },
            { fms: 6, label: 'Buiten dienst', color: '#7f8c8d', title: 'Buiten dienst' },
        ];
        const BUSY = [3, 4, 5, 7, 8];
        const RESYNC_MS = 5 * 60 * 1000;

        const state = new Map(); // vehicleId -> fms
        let stopped = false;

        const bar = document.createElement('div');
        bar.className = 'mks-vsb';
        const style = document.createElement('style');
        style.textContent = `
            .mks-vsb { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 6px;
                font-size: 12px; line-height: 1.4; background: rgba(0,0,0,.06); border-radius: 4px; margin: 4px 0; }
            .mks-vsb.mks-vsb-overlay { background: rgba(255,255,255,.88); color: #222; margin: 0;
                box-shadow: 0 1px 4px rgba(0,0,0,.3); max-width: 70vw; }
            .mks-vsb-chip { display: inline-flex; gap: 4px; align-items: center; padding: 1px 7px; border-radius: 10px;
                color: #fff; white-space: nowrap; cursor: default; }
            .mks-vsb-chip b { font-variant-numeric: tabular-nums; }
            .mks-vsb-busy { margin-left: auto; white-space: nowrap; font-weight: bold; padding: 0 4px; }
            .mks-vsb-meter { display: inline-block; width: 60px; height: 6px; border-radius: 3px; background: rgba(128,128,128,.35);
                vertical-align: middle; margin-left: 4px; overflow: hidden; }
            .mks-vsb-meter > span { display: block; height: 100%; }
        `;
        document.head.appendChild(style);

        let control = null;
        function place() {
            if (control) { control.remove(); control = null; }
            bar.remove();
            bar.classList.toggle('mks-vsb-overlay', ctx.cfg.place === 'overlay');
            const mapEl = W.map.getContainer();
            if (ctx.cfg.place === 'overlay' && W.L && W.L.Control) {
                const C = W.L.Control.extend({ onAdd: () => bar });
                control = new C({ position: 'bottomleft' }).addTo(W.map);
                W.L.DomEvent.disableClickPropagation(bar);
                return;
            }
            // #map_outer wraps the map (and its resize handle) on the main page.
            const anchor = document.getElementById('map_outer') || mapEl;
            anchor.insertAdjacentElement(ctx.cfg.place === 'above' ? 'beforebegin' : 'afterend', bar);
        }

        function render() {
            const count = {};
            for (const f of state.values()) count[f] = (count[f] || 0) + 1;
            const known = new Set(STATUS.map((s) => s.fms));
            const rows = STATUS.map((s) => ({ ...s, n: count[s.fms] || 0 }));
            for (const f of Object.keys(count)) {
                if (!known.has(Number(f))) rows.push({ fms: Number(f), label: `Status ${f}`, color: '#555', title: `Status ${f}`, n: count[f] });
            }
            const total = state.size;
            const usable = total - (count[6] || 0);
            const busy = BUSY.reduce((sum, f) => sum + (count[f] || 0), 0);
            const pct = usable ? Math.round((busy / usable) * 100) : 0;
            const meterColor = pct >= 75 ? '#c0392b' : pct >= 40 ? '#e08a00' : '#2e8b57';

            bar.innerHTML = rows
                .filter((r) => !ctx.cfg.hideZero || r.n)
                .map((r) => `<span class="mks-vsb-chip" style="background:${r.color}" title="${r.title} (status ${r.fms})">${r.label} <b>${r.n}</b></span>`)
                .join('')
                + (ctx.cfg.busy
                    ? `<span class="mks-vsb-busy" title="${busy} van ${usable} inzetbare voertuigen bezig (${total} totaal)">`
                        + `Bezig ${pct}%<span class="mks-vsb-meter"><span style="width:${pct}%;background:${meterColor}"></span></span></span>`
                    : '');
            ctx.status(`${busy}/${usable} bezig (${pct}%)`, { tone: 'ok' });
        }

        // Batch bursts of radio messages into one redraw.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; render(); }, 250);
        };

        async function load() {
            try {
                const list = await fetch('/api/vehicles', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
                if (stopped || !Array.isArray(list)) return;
                state.clear();
                for (const v of list) state.set(Number(v.id), Number(v.fms_real));
                render();
            } catch (e) { ctx.warn('could not load vehicles', e); }
        }

        // The game defines radioMessage in its own scripts; wait for it.
        let tries = 0;
        let hookTimer = null;
        (function hook() {
            const orig = W.radioMessage;
            if (typeof orig !== 'function') {
                if (++tries <= 30) hookTimer = setTimeout(hook, 1000);
                else ctx.warn('radioMessage not found; bar only updates every 5 minutes');
                return;
            }
            W.radioMessage = function (msg) {
                try {
                    if (!stopped && msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                        state.set(Number(msg.id), Number(msg.fms_real));
                        schedule();
                    }
                } catch (e) { ctx.warn('radio hook failed', e); }
                return orig.apply(this, arguments);
            };
        })();

        place();
        bar.textContent = 'Voertuigen laden...';
        load();
        // Bought, sold or scrapped vehicles do not come in over the radio.
        const resync = setInterval(load, RESYNC_MS);

        ctx.onSettings(() => { place(); render(); });

        return {
            stop() {
                stopped = true;
                clearInterval(resync);
                clearTimeout(timer);
                clearTimeout(hookTimer);
                if (control) control.remove();
                bar.remove();
                style.remove();
            },
        };
    },
});
