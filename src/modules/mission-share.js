MKS.module({
    id: 'mission-share',
    name: 'Grote inzetten delen met je team',
    short: 'Inzetten delen',
    icon: '📣',
    category: 'auto',
    description: 'Deelt je eigen inzetten die minstens zoveel credits opleveren (standaard 2.000) automatisch met je team, '
        + 'zodat teamleden kunnen meehelpen. Elke inzet één keer.',
    tagline: 'Automatisch',
    warning: '<b>Dit verandert je inzetten in het spel.</b> Gedeelde inzetten zijn direct zichtbaar voor je hele team; '
        + 'delen kan niet worden teruggedraaid.',
    confirmOn: 'Let op: deze module deelt je inzetten vanaf de ingestelde credits automatisch met je team.\n\n'
        + 'Delen kan niet ongedaan worden gemaakt.\n\nAanzetten?',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [
        { key: 'minCredits', label: 'Delen vanaf', type: 'number', default: 2000, min: 0, max: 100000, step: 500, unit: 'credits',
            help: 'Gemiddelde credits van de inzet, zoals het spel ze in de lijst toont.' },
        { key: 'onlyVisible', label: 'Alleen zichtbare inzetten', type: 'bool', default: false,
            help: 'Inzetten die je met de missiefilters verbergt, worden niet gedeeld.' },
        { key: 'scanSec', label: 'Lijst opnieuw bekijken', type: 'number', default: 30, min: 10, max: 600, step: 10, unit: 'sec' },
        { key: 'pauseSec', label: 'Pauze tussen inzetten', type: 'number', default: 2, min: 1, max: 30, step: 1, unit: 'sec' },
    ],

    run(ctx) {
        const esc = ctx.esc;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // Missions handled (shared by us, or found already shared): id -> when. Kept over
        // reloads, so a mission is never looked at twice.
        const DONE_KEY = 'mks.missionShare.done.v1';
        let done;
        try { done = new Map(JSON.parse(GM_getValue(DONE_KEY, '[]'))); } catch (e) { done = new Map(); }
        const save = () => {
            const cut = Date.now() - 48 * 3600000;
            for (const [id, t] of done) if (t < cut) done.delete(id);
            try { GM_setValue(DONE_KEY, JSON.stringify([...done])); } catch (e) { /* ignore */ }
        };
        const log = [];
        const stats = { shared: 0, already: 0, failed: 0 };
        let busy = false, stopped = false, noButton = 0;

        const caption = (e) => { try { return JSON.parse(e.getAttribute('data-sortable-by')).caption; } catch (x) { return e.getAttribute('mission_id'); } };
        const creditsOf = (e) => { try { return Number(JSON.parse(e.getAttribute('data-sortable-by')).average_credits) || 0; } catch (x) { return 0; } };
        const addLog = (name, text, tone) => {
            log.unshift({ t: new Date().toLocaleTimeString('nl-NL'), name, text, tone });
            if (log.length > 200) log.length = 200;
            ctx.refresh();
        };

        async function get(url) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 15000);
            try {
                return await fetch(url, { credentials: 'same-origin', signal: ac.signal });
            } finally {
                clearTimeout(t);
            }
        }

        // One mission: its page has the share button ("Delen met team") only while it is
        // not shared yet. Following that link shares it, like a click.
        async function share(id) {
            const res = await get(`/missions/${id}`);
            if (!res.ok) throw new Error(`status ${res.status}`);
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const btn = doc.getElementById('mission_alliance_share_btn');
            if (!btn || !btn.getAttribute('href')) {
                // Shared already, or the game gives this account no share button at all.
                const next = doc.querySelector('.alert_next_alliance');
                return next ? 'no-button' : 'already';
            }
            const r = await get(btn.getAttribute('href'));
            if (!r.ok) throw new Error(`delen: status ${r.status}`);
            return 'shared';
        }

        async function round() {
            if (busy || stopped) return;
            busy = true;
            try {
                const min = Number(ctx.cfg.minCredits) || 0;
                const todo = [...document.querySelectorAll('#mission_list .missionSideBarEntry[mission_id]')]
                    .filter((e) => !done.has(e.getAttribute('mission_id')) && creditsOf(e) >= min
                        && !(ctx.cfg.onlyVisible && getComputedStyle(e).display === 'none'))
                    .sort((a, b) => creditsOf(b) - creditsOf(a));
                for (const e of todo) {
                    if (stopped) return;
                    const id = e.getAttribute('mission_id');
                    if (!document.getElementById(`mission_${id}`)) continue; // ended meanwhile
                    const name = caption(e);
                    ctx.status(`Delen: ${name}`, { tone: 'busy' });
                    try {
                        const r = await share(id);
                        if (r === 'shared') { stats.shared++; done.set(id, Date.now()); noButton = 0; addLog(name, `gedeeld (${ctx.nl(creditsOf(e))} cr)`, 'ok'); }
                        else if (r === 'already') { stats.already++; done.set(id, Date.now()); }
                        else {
                            // No share button anywhere: the account may not be allowed to share.
                            done.set(id, Date.now());
                            if (++noButton === 3) addLog('—', 'het spel toont geen deelknop: delen lijkt voor dit account niet mogelijk', 'warn');
                        }
                    } catch (x) {
                        stats.failed++;
                        addLog(name, `mislukt: ${x.message}`, 'error');
                    }
                    save();
                    await sleep(ctx.cfg.pauseSec * 1000);
                }
                status();
            } catch (x) {
                ctx.err(x);
            } finally {
                busy = false;
            }
        }

        function status() {
            ctx.status(noButton >= 3 ? 'Geen deelknop: delen lijkt geblokkeerd voor dit account'
                : `Actief: ${stats.shared} gedeeld deze sessie (vanaf ${ctx.nl(Number(ctx.cfg.minCredits) || 0)} cr)`,
            { tone: noButton >= 3 ? 'warn' : 'ok' });
        }

        ctx.panel((el) => {
            el.innerHTML = `<p class="mks-note">${stats.shared} gedeeld, ${stats.already} waren al gedeeld, ${stats.failed} mislukt (deze sessie).</p>
                ${log.length ? `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${log.map((l) => `<tr><td class="mono">${esc(l.t)}</td><td>${esc(l.name)}</td><td class="mks-st t-${l.tone}">${esc(l.text)}</td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="mks-dim">Nog niets gedeeld.</p>'}`;
        });

        let timer = null;
        const restart = () => { clearInterval(timer); timer = setInterval(round, Math.max(10, Number(ctx.cfg.scanSec) || 30) * 1000); };
        ctx.onSettings((cfg, key) => { if (key === 'scanSec') restart(); else round(); });
        status();
        restart();
        setTimeout(round, 4000);

        return { stop() { stopped = true; clearInterval(timer); } };
    },
});
