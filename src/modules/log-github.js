MKS.module({
    id: 'log-github',
    name: 'Log naar GitHub',
    short: 'Log naar GitHub',
    icon: '📤',
    category: 'auto',
    description: 'Zet elk uur (instelbaar) de logboeken van Automatisch alarmeren en Automatisch uitbreiden in een bestand in je eigen '
        + '(privé) GitHub-repository, zodat ze daar te lezen zijn zonder dat het spel open hoeft te staan. Verandert niets in het spel.',
    at: 'ready',
    frames: 'top',
    live: true,
    warning: 'Gebruik een <b>privé</b> repository en een fine-grained token met alleen "Contents: read and write" op die ene repository. '
        + 'In een openbare repository kan iedereen je spelgegevens lezen.',
    settings: [
        { key: 'repo', label: 'Repository', type: 'text', default: '', placeholder: 'gebruiker/mks-logs', help: 'eigenaar/naam van een privé repository' },
        { key: 'file', label: 'Bestand', type: 'text', default: 'status.json' },
        { key: 'intervalMin', label: 'Elke', type: 'number', default: 60, min: 2, max: 240, unit: 'min' },
        { key: 'eventHours', label: 'Gebeurtenissen van de laatste', type: 'number', default: 24, min: 1, max: 168, unit: 'uur' },
    ],

    run(ctx) {
        const W = ctx.W;
        const TOKEN_KEY = 'mks.logGithub.token';
        const LAST_KEY = 'mks.logGithub.last';
        const SHA_KEY = 'mks.logGithub.sha';
        const read = (key, fallback) => { try { return JSON.parse(GM_getValue(key, '')) || fallback; } catch (e) { return fallback; } };
        let busy = false;
        let lastResult = null;

        const token = () => GM_getValue(TOKEN_KEY, '');

        function gh(method, path, body) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method,
                    url: `https://api.github.com${path}`,
                    headers: {
                        Authorization: `Bearer ${token()}`,
                        Accept: 'application/vnd.github+json',
                        'Content-Type': 'application/json',
                    },
                    data: body ? JSON.stringify(body) : undefined,
                    timeout: 30000,
                    onload: (r) => {
                        let json = null;
                        try { json = JSON.parse(r.responseText); } catch (e) { /* empty body */ }
                        resolve({ status: r.status, json });
                    },
                    onerror: () => reject(new Error('geen verbinding met GitHub')),
                    ontimeout: () => reject(new Error('GitHub reageert niet')),
                });
            });
        }

        // UTF-8 safe base64 for the contents API.
        function b64(text) {
            const bytes = new TextEncoder().encode(text);
            let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(s);
        }

        // Everything both automation modules keep: GM storage is shared by all
        // tabs, the live extras (stats, ranking) only exist in the tab that runs them.
        function snapshot() {
            const since = Date.now() - ctx.cfg.eventHours * 3600 * 1000;
            const dispatch = W.mksAutoData;
            const expand = W.mksAutoExpand;
            const strip = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } };
            return {
                at: new Date().toISOString(),
                version: '{{VERSION}}',
                page: location.pathname,
                dispatch: {
                    events: read('mks.autoDispatch.events.v1', []).filter((e) => e.t >= since),
                    needs: read('mks.autoDispatch.needs.v1', {}),
                    live: dispatch ? strip({ running: dispatch.running, stats: dispatch.stats, holds: dispatch.holds, team: dispatch.team,
                        log: (dispatch.log || []).slice(0, 200) }) : null,
                },
                expand: {
                    state: read('mks.autoExpand.state.v1', {}),
                    live: expand ? strip({ next: expand.next, skipped: expand.skipped, ranking: expand.ranking, unlocks: expand.unlocks }) : null,
                },
            };
        }

        async function upload(force) {
            if (busy) return;
            const repo = String(ctx.cfg.repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
            if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { ctx.status('Vul eerst de repository in (eigenaar/naam)', { tone: 'warn' }); return; }
            if (!token()) { ctx.status('Stel eerst een token in', { tone: 'warn' }); return; }
            // One upload per interval across all tabs.
            const last = Number(GM_getValue(LAST_KEY, 0)) || 0;
            if (!force && Date.now() - last < ctx.cfg.intervalMin * 60 * 1000) return;
            GM_setValue(LAST_KEY, Date.now());
            busy = true;
            ctx.status('Uploaden…', { tone: 'busy' });
            try {
                const file = String(ctx.cfg.file || 'status.json').trim().replace(/^\/+/, '');
                const path = `/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
                const content = b64(JSON.stringify(snapshot(), null, 1));
                const put = (sha) => gh('PUT', path, { message: `Log ${new Date().toLocaleString('nl-NL')}`, content, ...(sha ? { sha } : {}) });
                let r = await put(GM_getValue(SHA_KEY, '') || undefined);
                if (r.status === 409 || r.status === 422) {
                    // Stored sha is stale (or missing): ask GitHub for the current one.
                    const cur = await gh('GET', path);
                    r = await put(cur.status === 200 ? cur.json.sha : undefined);
                }
                if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub ${r.status}: ${r.json?.message || 'onbekende fout'}`);
                GM_setValue(SHA_KEY, r.json.content.sha);
                lastResult = { ok: true, at: new Date(), kb: Math.round(content.length * 0.75 / 1024) };
                ctx.status(`Geüpload om ${lastResult.at.toLocaleTimeString('nl-NL')} (${lastResult.kb} KB)`, { tone: 'ok' });
            } catch (e) {
                ctx.err(e);
                lastResult = { ok: false, at: new Date(), error: e.message };
                ctx.status(`Mislukt: ${e.message}`, { tone: 'error' });
            } finally {
                busy = false;
                ctx.refresh();
            }
        }

        ctx.actions([
            { label: 'Nu uploaden', kind: 'primary', run: () => upload(true) },
            {
                label: 'Token instellen',
                run: () => {
                    const t = prompt('GitHub fine-grained token (alleen Contents: read and write op je log-repository). Leeg laten = token verwijderen.', '');
                    if (t === null) return;
                    GM_setValue(TOKEN_KEY, t.trim());
                    GM_setValue(SHA_KEY, '');
                    ctx.status(t.trim() ? 'Token opgeslagen' : 'Token verwijderd', { tone: 'idle' });
                    ctx.refresh();
                },
            },
        ]);

        ctx.panel((el) => {
            const last = Number(GM_getValue(LAST_KEY, 0)) || 0;
            el.innerHTML = `<p class="mks-note">Token: ${token() ? 'ingesteld' : '<b>niet ingesteld</b>'}. `
                + `Laatste upload (alle tabbladen): ${last ? new Date(last).toLocaleString('nl-NL') : 'nog nooit'}.`
                + (lastResult && !lastResult.ok ? `<br>Fout: ${ctx.esc(lastResult.error)}` : '') + '</p>';
        });

        ctx.onSettings(() => ctx.refresh());
        const timer = setInterval(() => upload(false), 60 * 1000);
        setTimeout(() => upload(false), 15 * 1000);
        return { stop() { clearInterval(timer); } };
    },
});
