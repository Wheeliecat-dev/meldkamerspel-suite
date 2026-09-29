MKS.module({
    id: 'crew-shortage',
    name: 'Bemanningstekort',
    icon: '🎓',
    category: 'tools',
    description: 'Zoekt voertuigen die niet kunnen uitrukken omdat hun gebouw te weinig (opgeleid) personeel heeft, en maakt daar een opleidingsplan van: '
        + 'welke opleiding, hoeveel mensen, bij welk gebouw. Alleen lezen: start nooit een opleiding en verplaatst niemand.',
    tagline: 'Openen via Scripts-menu',
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'concurrency', label: 'Gelijktijdige verzoeken', type: 'number', default: 3, min: 1, max: 6, step: 1 },
        { key: 'delayMs', label: 'Pauze per verzoek', type: 'number', default: 150, min: 0, max: 2000, step: 50, unit: 'ms' },
        { key: 'ignoreOffDuty', label: 'Voertuigen buiten dienst negeren', type: 'bool', default: true, help: 'Status 6 telt niet mee.' },
    ],

    run(ctx) {

        /* ========================================================================
         * CONFIG
         * ==================================================================== */
        const CONFIG = {
            CONCURRENCY: ctx.cfg.concurrency, // parallel building page requests
            DELAY_MS: ctx.cfg.delayMs,        // pause between requests per worker
            REQUEST_TIMEOUT_MS: 20000,
            CACHE_KEY: 'crewShortage.cache.v1',
            // Personnel whose status matches this are away on a course and can't
            // crew anything right now. They still count as "coming", so a
            // shortage they will fix is shown as "wacht op opleiding", not red.
            IN_TRAINING_STATUS: /opleiding|training|school/i,
            // Vehicles in these FMS states are ignored (6 = buiten dienst).
            IGNORE_FMS: ctx.cfg.ignoreOffDuty ? [6] : [],
        };

        const log = (...a) => console.log('[crew-shortage]', ...a);
        const warn = (...a) => console.warn('[crew-shortage]', ...a);

        /* ========================================================================
         * VEHICLE TYPE REQUIREMENTS
         * ====================================================================
         * vehicle_type -> [caption, minimum crew, { opleiding: n }]
         * n = 0 means EVERY crew member needs that opleiding (so min crew of
         * them); n > 0 means at least n crew members need it.
         * Generated 2026-09-26 from api.lss-manager.de/nl_NL/vehicles +
         * /nl_NL/schoolings (copies in research/lssm_*_nl.json). Opleiding names
         * containing "_" had no Dutch caption in that source and can't be
         * matched against the personnel page — those checks are skipped and
         * shown as "niet gecontroleerd".
         * ==================================================================== */
        const VEHICLE_REQUIREMENTS = {"0":["SI-2",1],"1":["TS 8/9",1],"2":["Autoladder",1],"3":["DA - Officier van Dienst",1],"4":["Hulpverleningsvoertuig",1],"5":["Adembeschermingsvoertuig",1],"6":["TST 8/9",1],"7":["TST 6/7",1],"8":["TST 4/5",1],"9":["TS 4/5",1],"10":["Slangenwagen",1],"11":["Verkenningseenheid Brandweer",1,{"Verkenningseenheid Brandweer":0}],"12":["TST-NB 8/9",1],"14":["TST-NB 6/7",1],"15":["TST-NB 4/5",1],"16":["Ambulance",1],"17":["TS 6/7",1],"18":["Hoogwerker",1],"19":["DA - Hoofdofficier van Dienst",1,{"Hoofd Officier van Dienst - Brandweer":0}],"20":["DA",1],"21":["DB Klein",1],"22":["DA Noodhulp",1],"23":["Lifeliner",1,{"MMT-Bemanningslid":0}],"24":["DA - Adviseur Gevaarlijke stoffen",1,{"Adviseur Gevaarlijke Stoffen":0}],"25":["DB Noodhulp",1],"26":["Haakarmvoertuig",1,{"Brandweerchauffeur-zwaar":0}],"27":["Adembeschermingshaakarmbak",0],"28":["Politiehelikopter",1,{"Politiehelikopter":0}],"29":["Watertankhaakarmbak",0],"30":["Zorgambulance",1],"31":["Commandovoertuig",1,{"Brandweerchauffeur-zwaar":0}],"32":["Commandohaakarmbak",0],"33":["Waterongevallenvoertuig",4,{"Duiker/Duikploegleider":0}],"34":["Watertankwagen",1],"35":["Officier van Dienst - Politie",1,{"Officier van Dienst - Politie":0}],"36":["Waterongevallenaanhanger",0],"37":["MMT-Auto",1,{"MMT-Bemanningslid":0}],"38":["Officier van Dienst - Geneeskunde",1,{"Officier van Dienst Geneeskunde":0}],"39":["ME Commandovoertuig",2,{"Mobiele Eenheid":0}],"40":["ME Flexbus",4,{"Mobiele Eenheid":0}],"41":["Crashtender (8x8)",2,{"Vliegtuigbrandbestrijding":0}],"42":["Crashtender (6x6)",2,{"Vliegtuigbrandbestrijding":0}],"43":["Crashtender (4x4)",2,{"Vliegtuigbrandbestrijding":0}],"44":["Airport Fire Officer / On Scene Commander",1,{"Airport Fire Officer / On Scene Commander":0}],"45":["Dompelpomphaakarmbak",0],"46":["DM-Politie",1,{"Motoragent":0}],"47":["DA Hondengeleider",1,{"Hondengeleider":0}],"48":["DB Hondengeleider",1,{"Hondengeleider":0}],"49":["PM-OR | Materieelvoertuig - Oppervlakteredding",4,{"Oppervlakteredder":0}],"50":["TS-OR | Tankautospuit - Oppervlakteredding",4,{"Oppervlakteredder":0}],"51":["HulpverleningsHaakarmbak",0],"52":["Rapid Responder",1],"53":["AT-Commandant",1,{"Operator AT":0}],"54":["AT-Operator",2,{"Operator AT":0}],"55":["AT-Materiaalwagen",1,{"Operator AT":0}],"56":["DA Voorlichter",1,{"Voorlichter":0}],"57":["DA Officier van Dienst - Geneeskundig / Rapid Responder",1,{"Officier van Dienst Geneeskunde":0}],"58":["DB Arrestantenvervoer",1],"59":["Noodhulp - Onopvallend",1],"60":["DB Biketeam",1,{"Biketeam":0}],"61":["Slangenhaakarmbak",0],"62":["TS-HV | Tankautospuit-Hulpverlening",3],"63":["DM - Rapid Responder",1],"64":["ME Aanhoudingseenheid",6,{"ME - Aanhoudingseenheid":0}],"65":["DA Terreinwaardig - Reddingsbrigade",2,{"Waterredding":0}],"66":["Kusthulpverleningsvoertuig",2,{"Waterredding":0}],"67":["Bootaanhanger Reddingsbrigade",0],"68":["SB",2,{"Brandweerchauffeur-zwaar":0}],"69":["SBH",0],"70":["SBA",0],"71":["MSA",0],"72":["DPA",0],"73":["Vrachtwagen - Bereden Brigade",1,{"Bereden Brigade":0}],"74":["Bereden Brigade Aanhanger",0,{"Bereden Brigade":0}],"75":["Dienstauto terreinvaardig - Noodhulp",1],"76":["Quad",1,{"Waterredding":0}],"77":["KW-boot",2,{"Groot vaarbewijs":1,"Water handhaving":1}],"78":["RB-K",2,{"Groot vaarbewijs":0}],"79":["RB-G",2,{"Groot vaarbewijs":0}],"80":["SAR-heli",2,{"SAR Helicopter":0}],"81":["DA-RWS | Dienstvoertuig weginspecteur Rijkswaterstaat",1,{"Weginspecteur":0}],"82":["DM-RWS | Dienstmotor weginspecteur Rijkswaterstaat",1,{"Weginspecteur":0}],"83":["DA-SIG | Signalisatievoertuig",1,{"Weginspecteur":0}],"84":["Waterwerper",4,{"ME - Waterwerper":0}],"85":["FBO-Heli",2,{"Fire Bucket Operator":0}],"86":["DB-Handcrew",7,{"Handcrew":0}],"87":["DA-LA-NB",1,{"Landelijk Adviseur Natuurbranden":0}],"88":["VW-NB",1,{"Brandweerchauffeur-zwaar":0}],"89":["NBH",0],"90":["TS-STH",7,{"Teamleider STH":2,"Teamlid STH":5}],"91":["HVH-STH",0],"92":["DB-USAR",5,{"Teamlid USAR":0}],"93":["TS-USAR",4,{"Teamlid USAR":0}],"94":["VW-USAR",2,{"Brandweerchauffeur-zwaar":0}],"95":["DM-USAR",1,{"Teamlid USAR":0}],"96":["Quad-USAR",1,{"Teamlid USAR":0}],"97":["DB\u2013Speurhonden",2,{"Hondengeleider USAR":0}],"98":["SIV-P",1,{"Chauffeur Dienst Infra":0}],"99":["DB-VOA",1,{"Verkeersongevallen Analist":0}],"100":["GGB",6,{"Geneeskundige bijstandsverlener":0}],"101":["NHT",4,{"Noodhulpteam":0}],"102":["MC-Ambulance",2],"103":["MICU",3,{"Intensive Care Team":0}],"104":["Berger-K",1,{"Berger Training":0}],"105":["Berger-G",1,{"Berger Training":0}],"106":["Berger-K (RWS)",1,{"Berger Training":0}],"107":["Berger-G (RWS)",1,{"Berger Training":0}],"108":["Berger-K (Politie)",1,{"Berger Training":0}],"109":["Berger-G (Politie)",1,{"Berger Training":0}],"110":["DAT-KMAR",1,{"Marechaussee":0}],"111":["DB-KMAR",1,{"Marechaussee":0}],"112":["DM-KMAR",1,{"Marechaussee":0}],"113":["DAT-EOD",1,{"Bomontmanteling":0}],"114":["DB-EOD",2,{"Bomontmanteling":0}],"115":["VW-EOD",2,{"Bomontmanteling":0}],"116":["DB-Explosievenhonden",2,{"Hondengeleider EOD":0}],"117":["DB-Explosievenduikers",2,{"Duiker Defensie":0}],"118":["BA-DDG",0],"119":["DB-TEV",1,{"Bomverkenner":0}],"120":["DB-VZ",2,{"Verzorger":0}],"121":["VZH",0],"122":["DB-AH",2,{"Hygi\u00ebnemedewerker":0}],"123":["VZH-AH",0],"124":["DB-PC-LOG",1,{"Pelotonscommandant Logistiek":0}],"125":["DB-LOG",1],"126":["VW-LOG",1],"127":["BMH-LOG",0],"128":["DB-DRONE",3,{"Drone Flightcrew":0}],"129":["DB-TDV",3,{"TDV Drone Flightcrew":0}],"130":["SB-BA",2,{"Brandweerchauffeur-zwaar":0}],"131":["SB-IB",2,{"Brandweerchauffeur-zwaar":0}],"132":["AS",2,{"Brandweerchauffeur-zwaar":0}],"133":["TS-IB",1,{"Brandweerchauffeur-zwaar":0}],"134":["GSH",0],"135":["DB-GS",4,{"Gevaarlijke Stoffen Eenheid":0}],"136":["GPH",0],"137":["DB-GP",4,{"Gevaarlijke Stoffen Eenheid":0}],"138":["BOH-DC",0],"139":["TS-BO",6,{"Ontsmettings Eenheid":0}],"140":["DB-BO",6,{"Ontsmettings Eenheid":0}],"141":["GOH-DC",0],"142":["TS-GO",6,{"Ontsmettings Eenheid":0}],"143":["DB-GO",6,{"Ontsmettings Eenheid":0}],"144":["DB-ICB",1,{"Incidentenbestrijder spoor":0}],"145":["OvD-ICB",1,{"Officier van Dienst Incidentenbestrijder spoor":0}],"146":["VW-VZ-ICB",1,{"Brandweerchauffeur-zwaar":0}],"147":["HA-ICB",1,{"Brandweerchauffeur-zwaar":0}],"148":["GM-ICB",1,{"Brandweerchauffeur-zwaar":0}],"149":["HSH-ICB",1],"150":["VW-HS",1,{"Incidentenbestrijder spoor":0}],"151":["BM-VTHS",2],"152":["TS-Spoor",1,{"Incidentenbestrijder spoor":0}],"153":["DB-RI",2,{"thatched_roof_firefighting":0}],"154":["RIA",0],"155":["DB-VI",4,{"livestock_fire_count":0}],"156":["VIA",0]};

        /* ========================================================================
         * FETCHING
         * ==================================================================== */
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        async function fetchWithTimeout(url, opts) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { credentials: 'same-origin', ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        async function apiGet(path) {
            const res = await fetchWithTimeout(path, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }

        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        // Compare opleiding names without case, accents or punctuation.
        const norm = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Same parsing as the Personnel Overview script: columns found by
        // header text, bound vehicle found by an actual /vehicles/<id> link.
        function parsePersonnel(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const table = doc.querySelector('#personal_table')
                || [...doc.querySelectorAll('table')].find(t => /opleiding|education|schooling/i.test(t.textContent));
            if (!table) return [];
            const headers = [...table.querySelectorAll('thead th')].map(th => clean(th.textContent).toLowerCase());
            const col = (re, fallback) => {
                const i = headers.findIndex(h => re.test(h));
                return i >= 0 ? i : fallback;
            };
            const iName = col(/naam|name/, 0);
            const iEdu = col(/opleiding|education|schooling|training/, 1);
            const iVeh = col(/gekoppeld|voertuig|vehicle|bound/, 2);
            const iStatus = col(/status/, 3);

            const out = [];
            table.querySelectorAll('tbody tr').forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (!cells.length || !clean(cells[iName]?.textContent)) return;
                let educations = [];
                if (cells[iEdu]) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = cells[iEdu].innerHTML.replace(/<br\s*\/?>/gi, ',');
                    educations = tmp.textContent.split(',').map(clean).filter(Boolean);
                }
                const vehLink = cells[iVeh]?.querySelector('a[href*="/vehicles/"]')
                    || [...tr.querySelectorAll('a[href*="/vehicles/"]')].find(a => /\/vehicles\/\d+/.test(a.getAttribute('href')));
                const vehicleId = vehLink ? Number((vehLink.getAttribute('href').match(/\/vehicles\/(\d+)/) || [])[1]) || null : null;
                out.push({
                    edu: educations.map(norm),
                    vehicleId,
                    status: clean(cells[iStatus]?.textContent),
                });
            });
            return out;
        }

        async function loadAll(onProgress) {
            const [buildings, vehicles] = await Promise.all([apiGet('/api/buildings'), apiGet('/api/vehicles')]);
            const byBuilding = new Map();
            for (const v of vehicles) {
                if (CONFIG.IGNORE_FMS.includes(Number(v.fms_real))) continue;
                if (!byBuilding.has(v.building_id)) byBuilding.set(v.building_id, []);
                byBuilding.get(v.building_id).push({ id: v.id, caption: v.caption, type: v.vehicle_type });
            }
            // Only buildings that own vehicles matter here.
            const todo = buildings.filter(b => byBuilding.has(b.id));
            const result = [];
            const failed = [];
            let done = 0;
            let next = 0;
            const statuses = new Set();

            async function worker() {
                while (next < todo.length) {
                    const b = todo[next++];
                    try {
                        const res = await fetchWithTimeout(`/buildings/${b.id}/personals`);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const people = parsePersonnel(await res.text());
                        people.forEach(p => statuses.add(p.status));
                        result.push({ id: b.id, caption: b.caption, vehicles: byBuilding.get(b.id), people });
                    } catch (e) {
                        warn('building failed', b.id, b.caption, e);
                        failed.push(b.caption);
                    }
                    onProgress(++done, todo.length);
                    await sleep(CONFIG.DELAY_MS);
                }
            }
            await Promise.all(Array.from({ length: CONFIG.CONCURRENCY }, worker));
            log(`loaded ${todo.length} buildings, ${failed.length} failed; personnel statuses seen:`, [...statuses]);
            return { buildings: result, failed, loadedAt: Date.now() };
        }

        const cache = {
            get() { try { return JSON.parse(GM_getValue(CONFIG.CACHE_KEY, 'null')); } catch (e) { return null; } },
            set(v) { try { GM_setValue(CONFIG.CACHE_KEY, JSON.stringify(v)); } catch (e) { warn('cache write failed', e); } },
        };

        /* ========================================================================
         * ANALYSIS
         * ====================================================================
         * Game rule used: a vehicle with personnel bound to it (gekoppeld) only
         * takes those people; other vehicles share the building's unbound
         * people. Two kinds of problem:
         *   - "blocked": the vehicle can't leave even when it is the only one
         *     going (hard shortage).
         *   - "not all at once": each vehicle can leave alone, but the shared
         *     pool can't crew all of them together (soft shortage).
         * ==================================================================== */
        function requirementsOf(type) {
            const r = VEHICLE_REQUIREMENTS[type];
            if (!r) return null;
            const [caption, crew, edu = {}] = r;
            const known = [], unknown = [];
            for (const [name, n] of Object.entries(edu)) {
                (name.includes('_') ? unknown : known).push({ name, key: norm(name), need: n === 0 ? crew : n, all: n === 0 });
            }
            return { caption, crew, known, unknown };
        }

        // How short is `pool` for requirement `req`?
        // Returns { heads, edu: { opleiding: missing } } with only non-zero entries.
        function shortfall(pool, req) {
            const out = { heads: Math.max(0, req.crew - pool.length), edu: {} };
            const allReqs = req.known.filter(e => e.all);
            if (allReqs.length) {
                // "Everyone needs it": count people who have every such opleiding.
                const have = pool.filter(p => allReqs.every(e => p.edu.includes(e.key))).length;
                for (const e of allReqs) if (e.need > have) out.edu[e.name] = e.need - have;
            }
            for (const e of req.known.filter(x => !x.all)) {
                const miss = e.need - pool.filter(p => p.edu.includes(e.key)).length;
                if (miss > 0) out.edu[e.name] = miss;
            }
            return out;
        }
        const isShort = (s) => s.heads > 0 || Object.keys(s.edu).length > 0;

        function analyse(data) {
            const vehicleRows = [];   // blocked / waiting vehicles
            const buildingRows = [];  // not-all-at-once warnings
            const plan = {};          // opleiding -> { hard, soft, buildings: { id: { caption, hard, soft, vehicles } } }
            const unknownTypes = new Set();

            const addPlan = (edu, b, n, kind, vehicle) => {
                plan[edu] = plan[edu] || { hard: 0, soft: 0, buildings: {} };
                const pb = plan[edu].buildings[b.id] = plan[edu].buildings[b.id] || { caption: b.caption, hard: 0, soft: 0, vehicles: [] };
                plan[edu][kind] += n;
                pb[kind] += n;
                if (vehicle) pb.vehicles.push(vehicle);
            };

            for (const b of data.buildings) {
                const isReady = (p) => !CONFIG.IN_TRAINING_STATUS.test(p.status);
                const shared = [];

                for (const v of b.vehicles) {
                    const req = requirementsOf(v.type);
                    if (!req) { unknownTypes.add(v.type); continue; }
                    if (req.crew <= 0) continue; // trailers etc. carry no crew
                    const bound = b.people.some(p => p.vehicleId === v.id);
                    const poolAll = b.people.filter(p => (bound ? p.vehicleId === v.id : !p.vehicleId));
                    if (!bound) shared.push(req);

                    const now = shortfall(poolAll.filter(isReady), req);
                    if (!isShort(now)) continue;
                    const later = shortfall(poolAll, req);
                    const waiting = !isShort(later);
                    vehicleRows.push({ b, v, req, bound, short: now, waiting });
                    if (!waiting) for (const [edu, n] of Object.entries(later.edu)) addPlan(edu, b, n, 'hard', v.caption);
                }

                // Shared pool: can all unbound vehicles leave at the same time?
                if (shared.length > 1) {
                    const pool = b.people.filter(p => !p.vehicleId);
                    const heads = shared.reduce((s, req) => s + req.crew, 0);
                    const eduNeed = {};
                    for (const req of shared) for (const e of req.known) eduNeed[e.name] = (eduNeed[e.name] || 0) + e.need;
                    const eduShort = {};
                    for (const [name, need] of Object.entries(eduNeed)) {
                        const have = pool.filter(p => p.edu.includes(norm(name))).length;
                        if (need > have) eduShort[name] = need - have;
                    }
                    if (heads > pool.length || Object.keys(eduShort).length) {
                        buildingRows.push({ b, vehicles: shared.length, heads, pool: pool.length, eduShort });
                        for (const [edu, n] of Object.entries(eduShort)) {
                            // Only the part not already counted as a hard shortage.
                            const hard = plan[edu]?.buildings[b.id]?.hard || 0;
                            if (n > hard) addPlan(edu, b, n - hard, 'soft');
                        }
                    }
                }
            }
            if (unknownTypes.size) log('vehicle types without requirement data:', [...unknownTypes]);
            return { vehicleRows, buildingRows, plan, unknownTypes: [...unknownTypes] };
        }

        /* ========================================================================
         * UI
         * ==================================================================== */
        const CSS = `
        #cs-overlay { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.55); display: flex; }
        #cs-panel { margin: 24px auto; width: min(1200px, calc(100vw - 32px)); background: #1e2126; color: #e4e6ea;
            border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; font: 13px/1.4 system-ui, sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,.5); }
        #cs-panel * { box-sizing: border-box; }
        #cs-head { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #333841; flex-wrap: wrap; }
        #cs-head h3 { margin: 0 12px 0 0; font-size: 16px; color: #fff; }
        #cs-head button { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d; border-radius: 4px; padding: 5px 8px; font: inherit; cursor: pointer; }
        #cs-head button:hover { background: #353a43; }
        #cs-head button.on { background: #2f4a66; border-color: #4a6f96; color: #fff; }
        #cs-close { margin-left: auto; }
        #cs-body { flex: 1; overflow: auto; padding: 12px 14px; }
        #cs-body table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        #cs-body th { position: sticky; top: -12px; background: #262a30; text-align: left; padding: 6px 8px; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #cs-body td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #cs-body tr:hover td { background: #252930; }
        #cs-body a { color: #6fb3ff; }
        #cs-body p.note { color: #9aa1ab; margin: 0 0 10px; }
        .cs-tag { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
        .cs-red { background: #5c2328; color: #ffd6d9; }
        .cs-orange { background: #5c4020; color: #ffe2bf; }
        .cs-blue { background: #2f4a66; color: #d6e8ff; }
        .cs-grey { background: #33373e; color: #b9bec6; }
        .cs-dim { color: #9aa1ab; }
        #cs-foot { padding: 6px 14px; border-top: 1px solid #333841; color: #9aa1ab; }
        #cs-msg { padding: 40px; text-align: center; color: #9aa1ab; }
        `;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const bLink = (id, caption) => `<a href="/buildings/${id}/personals" target="_blank">${esc(caption)}</a>`;
        const tag = (cls, text) => `<span class="cs-tag ${cls}">${esc(text)}</span>`;
        const eduTags = (obj, cls) => Object.entries(obj).map(([e, n]) => tag(cls, `${e} −${n}`)).join(' ');

        const state = { data: null, result: null, tab: 'plan' };
        let overlay;

        function open() {
            if (!document.getElementById('cs-style')) {
                const st = document.createElement('style');
                st.id = 'cs-style';
                st.textContent = CSS;
                document.head.appendChild(st);
            }
            overlay = document.createElement('div');
            overlay.id = 'cs-overlay';
            overlay.innerHTML = `
            <div id="cs-panel">
              <div id="cs-head">
                <h3>Bemanningstekort</h3>
                <button data-tab="plan">Opleidingsplan</button>
                <button data-tab="vehicles">Voertuigen</button>
                <button data-tab="buildings">Niet alles tegelijk</button>
                <button id="cs-refresh">Vernieuwen</button>
                <button id="cs-close">✕</button>
              </div>
              <div id="cs-body"></div>
              <div id="cs-foot"></div>
            </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
            overlay.querySelector('#cs-close').onclick = close;
            overlay.querySelector('#cs-refresh').onclick = () => refresh();
            overlay.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; if (state.result) render(); });

            state.data = cache.get();
            if (state.data) { state.result = analyse(state.data); render(); } else refresh();
        }

        function close() {
            overlay?.remove();
            overlay = null;
        }

        async function refresh() {
            const body = overlay.querySelector('#cs-body');
            body.innerHTML = '<div id="cs-msg">Personeel laden…</div>';
            try {
                state.data = await loadAll((d, t) => {
                    const m = overlay?.querySelector('#cs-msg');
                    if (m) m.textContent = `Personeel laden… ${d} / ${t} gebouwen`;
                });
                cache.set(state.data);
                state.result = analyse(state.data);
                if (overlay) render();
            } catch (e) {
                warn(e);
                if (overlay) body.innerHTML = `<div id="cs-msg">Laden mislukt: ${esc(e.message)}</div>`;
            }
        }

        function renderPlan() {
            const rows = Object.entries(state.result.plan).sort((a, b) => b[1].hard - a[1].hard || b[1].soft - a[1].soft);
            if (!rows.length) return '<div id="cs-msg">Geen opleidingen nodig. Alles kan uitrukken. 🎉</div>';
            return `
                <p class="note">${tag('cs-red', 'nodig')} = zonder deze mensen kan een voertuig nooit uitrukken.
                ${tag('cs-orange', 'extra')} = nodig om alle voertuigen van een gebouw tegelijk te laten rijden.</p>
                <table><thead><tr><th>Opleiding</th><th>Nodig</th><th>Extra</th><th>Waar</th></tr></thead><tbody>
                ${rows.map(([edu, p]) => `<tr>
                    <td><b>${esc(edu)}</b></td>
                    <td>${p.hard ? tag('cs-red', p.hard) : ''}</td>
                    <td>${p.soft ? tag('cs-orange', p.soft) : ''}</td>
                    <td>${Object.entries(p.buildings).map(([id, pb]) => [
                        bLink(id, pb.caption) + ':',
                        pb.hard ? tag('cs-red', pb.hard) : '',
                        pb.soft ? tag('cs-orange', `+${pb.soft}`) : '',
                        pb.vehicles.length ? `<span class="cs-dim">(${esc(pb.vehicles.join(', '))})</span>` : '',
                    ].filter(Boolean).join(' ')).join('<br>')}</td>
                </tr>`).join('')}
                </tbody></table>`;
        }

        function renderVehicles() {
            const rows = state.result.vehicleRows.slice().sort((a, b) => a.waiting - b.waiting || a.b.caption.localeCompare(b.b.caption));
            if (!rows.length) return '<div id="cs-msg">Geen geblokkeerde voertuigen.</div>';
            return `
                <table><thead><tr><th>Gebouw</th><th>Voertuig</th><th>Type</th><th>Status</th><th>Tekort</th></tr></thead><tbody>
                ${rows.map(r => `<tr>
                    <td>${bLink(r.b.id, r.b.caption)}</td>
                    <td><a href="/vehicles/${r.v.id}" target="_blank">${esc(r.v.caption)}</a>${r.bound ? ' <span class="cs-tag cs-grey" title="Alleen gekoppeld personeel telt">gekoppeld</span>' : ''}</td>
                    <td>${esc(r.req.caption)} <span class="cs-dim">(min ${r.req.crew})</span></td>
                    <td>${r.waiting ? tag('cs-blue', 'wacht op opleiding') : tag('cs-red', 'kan niet uitrukken')}</td>
                    <td>${r.short.heads ? tag('cs-red', `personeel −${r.short.heads}`) + ' ' : ''}${eduTags(r.short.edu, 'cs-red')}</td>
                </tr>`).join('')}
                </tbody></table>`;
        }

        function renderBuildings() {
            const rows = state.result.buildingRows;
            if (!rows.length) return '<div id="cs-msg">Alle gebouwen kunnen alles tegelijk laten rijden.</div>';
            return `
                <p class="note">Elk voertuig kan apart uitrukken, maar het gedeelde (niet-gekoppelde) personeel is te weinig om alles tegelijk te laten rijden.</p>
                <table><thead><tr><th>Gebouw</th><th>Voertuigen</th><th>Personeel</th><th>Opleidingen tekort</th></tr></thead><tbody>
                ${rows.map(r => `<tr>
                    <td>${bLink(r.b.id, r.b.caption)}</td>
                    <td>${r.vehicles}</td>
                    <td>${r.pool} / ${r.heads} nodig${r.heads > r.pool ? ' ' + tag('cs-orange', `−${r.heads - r.pool}`) : ''}</td>
                    <td>${eduTags(r.eduShort, 'cs-orange')}</td>
                </tr>`).join('')}
                </tbody></table>`;
        }

        function render() {
            overlay.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
            const view = { plan: renderPlan, vehicles: renderVehicles, buildings: renderBuildings }[state.tab];
            overlay.querySelector('#cs-body').innerHTML = view();

            const d = state.data;
            const unknownEdu = new Set();
            for (const b of d.buildings) for (const v of b.vehicles) requirementsOf(v.type)?.unknown.forEach(u => unknownEdu.add(u.name));
            overlay.querySelector('#cs-foot').innerHTML = [
                `${d.buildings.length} gebouwen geladen ${esc(new Date(d.loadedAt).toLocaleString('nl-NL'))}`,
                d.failed.length ? `<span style="color:#ff9a9a">${d.failed.length} mislukt</span>` : '',
                state.result.unknownTypes.length ? `onbekende voertuigtypes: ${esc(state.result.unknownTypes.join(', '))}` : '',
                unknownEdu.size ? `niet gecontroleerd: ${esc([...unknownEdu].join(', '))}` : '',
            ].filter(Boolean).join(' · ');
        }

        /* ========================================================================
         * ENTRY BUTTON
         * ==================================================================== */
        function addButton() {
            ctx.menu({ icon: '🎓', label: 'Bemanningstekort', title: 'Voertuigen zonder (opgeleide) bemanning', run: () => { if (!overlay) open(); } });
            ctx.actions([{ label: 'Openen', kind: 'primary', run: () => { if (!overlay) open(); } }]);
        }

        addButton();
    },
});
