MKS.module({
    id: 'vehicle-namer',
    name: 'Voertuignamen',
    short: 'Voertuignamen',
    icon: '🚒',
    category: 'names',
    description: 'Geeft je voertuigen echte Nederlandse roepnummers waar die bekend zijn, en anders een verzonnen roepnummer in hetzelfde systeem. '
        + 'Nooit dubbele namen. Pakt nieuw gekochte voertuigen vanzelf op.',
    defaultOn: false,
    warning: '<b>Werk in uitvoering. Hernoemen kan niet ongedaan worden gemaakt.</b> Zodra je dit aanzet, verandert het de namen van je voertuigen '
        + 'in het spel zelf. De oude namen worden nergens bewaard. De nummering is nog niet af en kan in een volgende versie weer veranderen.',
    confirmOn: 'Let op: dit hernoemt direct je voertuigen in het spel.\n\nDat kan NIET ongedaan worden gemaakt: de oude namen worden niet bewaard. '
        + 'Het script is nog in ontwikkeling.\n\nToch aanzetten?',
    at: 'load',
    frames: 'top',
    settings: [
        { key: 'defaultRegio', label: 'Standaard regio', type: 'select', default: '09',
            options: [['01', '01 Groningen'], ['02', '02 Fryslân'], ['03', '03 Drenthe'], ['04', '04 IJsselland'], ['05', '05 Twente'],
                ['06', '06 Noord- en Oost-Gelderland'], ['07', '07 Gelderland-Midden'], ['08', '08 Gelderland-Zuid'], ['09', '09 Utrecht'],
                ['10', '10 Noord-Holland Noord'], ['11', '11 Zaanstreek-Waterland'], ['12', '12 Kennemerland'], ['13', '13 Amsterdam-Amstelland'],
                ['14', '14 Gooi en Vechtstreek'], ['15', '15 Haaglanden'], ['16', '16 Hollands Midden'], ['17', '17 Rotterdam-Rijnmond'],
                ['18', '18 Zuid-Holland Zuid'], ['19', '19 Zeeland'], ['20', '20 Midden- en West-Brabant'], ['21', '21 Brabant-Noord'],
                ['22', '22 Brabant-Zuidoost'], ['23', '23 Limburg-Noord'], ['24', '24 Limburg-Zuid'], ['25', '25 Flevoland']],
            help: 'Voor gebouwen waarvan de plaatsnaam niet herkend wordt.' },
        { key: 'pollMin', label: 'Zoeken naar nieuwe voertuigen', type: 'number', default: 1, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rescanMin', label: 'Volledige controle', type: 'number', default: 30, min: 5, max: 240, step: 5, unit: 'min' },
        { key: 'throttleSec', label: 'Pauze tussen hernoemingen', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.5, unit: 'sec' },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG — read this first
         * ====================================================================
         * DRY_RUN starts as `true` on purpose: the very first time you run this
         * script it will only PRINT what it *would* rename in the browser
         * console (F12) instead of actually renaming anything. Check the
         * console, make sure the names look right, and only then set
         * DRY_RUN to false.
         *
         * The in-game rename mechanism this script uses is the same one the
         * community's LSS Manager tool uses (GET /vehicles/:id/editName, fill
         * in the form, click submit). It's about as compatible as a userscript
         * can be, but if meldkamerspel.com changes its markup this may need a
         * small selector tweak — see renameVehicleInGame() below, it logs
         * loudly on failure.
         * ==================================================================== */
        const CONFIG = {
            DRY_RUN: false,
            get DEBUG() { return !!ctx.cfg.debug; },
            // Region used for buildings whose place name we can't recognise at all.
            get DEFAULT_REGIO_CODE() { return ctx.cfg.defaultRegio; },
            get POLL_NEW_VEHICLES_MS() { return ctx.cfg.pollMin * 60000; }, // look for newly bought vehicles
            get FULL_RESCAN_MS() { return ctx.cfg.rescanMin * 60000; }, // self-healing full re-check
            get RENAME_THROTTLE_MS() { return ctx.cfg.throttleSec * 1000; }, // pause between individual rename calls
            REQUEST_TIMEOUT_MS: 10 * 1000, // abort any single network request that hangs this long
            MAX_NAME_LENGTH: 150,
        };

        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[VehicleNamer]', 'color:#0a7', ...a); };
        const warn = (...a) => console.warn('[VehicleNamer]', ...a);
        const err = (...a) => console.error('[VehicleNamer]', ...a);

        /* ========================================================================
         * PERSISTENT STORAGE
         * ==================================================================== */
        const store = {
            get(key, def) {
                try {
                    const v = GM_getValue(key, undefined);
                    return v === undefined ? def : JSON.parse(v);
                } catch (e) { return def; }
            },
            set(key, val) {
                try { GM_setValue(key, JSON.stringify(val)); } catch (e) { warn('store.set failed', key, e); }
            },
        };

        // Bump this whenever the reference data (fire type dictionary, known
        // afkortingen, exact station lists, etc.) changes meaningfully. On
        // mismatch, every vehicle's stored assignment is wiped so the next scan
        // re-classifies everyone from scratch with the new data — not just the
        // handful that happen to already look wrong.
        const DATA_VERSION = 11;

        // Memory guard was removed: everything runs live. Old standalone
        // memory can still be imported via Overzicht before turning this on.
        // renumber the fleet, so wait until the user imports or starts fresh.
        const hasMemory = true;

        // vehicleId -> { name, seqKey, exact }
        let assignments = store.get('vn_assignments', {});
        // seqKey -> highest sequence number used
        let seqCounters = store.get('vn_seqCounters', {});
        // regio code -> { buildingId: postNumber }
        let postNumbers = store.get('vn_postNumbers', {});
        // every vehicle id we've ever seen (to detect newly bought vehicles)
        let knownVehicleIds = store.get('vn_knownVehicleIds', []);
        // vehicleId -> { building, typeCaption, currentName, generatedName } — every
        // vehicle whose real type text we didn't recognize (fell back to OVR).
        let ovrLog = store.get('vn_ovrLog', {});

        const storedDataVersion = store.get('vn_dataVersion', 0);
        if (storedDataVersion !== DATA_VERSION) {
            log(`data version changed (${storedDataVersion} -> ${DATA_VERSION}) — clearing all stored assignments for a full recheck with the new reference data`);
            assignments = {};
            seqCounters = {};
            store.set('vn_dataVersion', DATA_VERSION);
        }

        function persistAll() {
            store.set('vn_assignments', assignments);
            store.set('vn_seqCounters', seqCounters);
            store.set('vn_postNumbers', postNumbers);
            store.set('vn_knownVehicleIds', knownVehicleIds);
            store.set('vn_ovrLog', ovrLog);
        }

        // A vehicle we genuinely can't classify (empty type text AND no parseable
        // real-format current name) — left completely untouched in-game, just
        // logged here so you can tell Claude about it.
        function recordUnclassified(building, vehicle) {
            ovrLog[vehicle.id] = {
                vehicleId: vehicle.id,
                building: building.caption,
                typeCaption: resolveTypeCaption(vehicle) || '(empty)',
                vehicleTypeId: vehicle.vehicle_type,
                currentName: vehicle.caption,
            };
        }

        function printOvrLog() {
            const rows = Object.values(ovrLog);
            if (!rows.length) {
                log('nothing left unclassified — every vehicle could be matched to a role.');
                return;
            }
            console.log(`%c[VehicleNamer] ${rows.length} vehicle(s) left untouched (couldn't work out their role):`, 'color:#e90');
            console.table(rows);
            console.log('[VehicleNamer] copy/paste this to Claude:\n' + JSON.stringify(rows, null, 2));
        }

        /* ========================================================================
         * TEXT HELPERS
         * ==================================================================== */
        function normalize(s) {
            return (s || '')
                .toString()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[()]/g, ' ')
                .replace(/[^a-z0-9\- ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Generic words we strip off the front of a building caption to get at
        // the place name, e.g. "Brandweer Kazerne Amersfoort-Noord" -> "amersfoort-noord"
        const PREFIX_WORDS = [
            'brandweerkazerne', 'brandweerpost', 'brandweer kazerne', 'brandweer post', 'brandweer',
            'ambulance standplaats', 'standplaats', 'ambulance',
            'politiebureau', 'politiepost', 'politie hoofdbureau', 'politie',
            'ravu', 'rav',
            'kazerne',
        ];
        function stripPrefix(normCaption) {
            let out = normCaption;
            let changed = true;
            while (changed) {
                changed = false;
                for (const w of PREFIX_WORDS) {
                    const re = new RegExp('^' + w + '\\s+');
                    if (re.test(out)) { out = out.replace(re, '').trim(); changed = true; }
                }
            }
            return out;
        }

        function deriveStationCode(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const firstWord = stripped.split(' ')[0] || stripped;
            const letters = firstWord.replace(/[^a-z]/g, '').toUpperCase();
            return letters.slice(0, 8) || 'VZ';
        }

        // Matches `needle` inside `haystack` only on a whole-word boundary, so
        // e.g. "doorn" does NOT match inside "apeldoorn".
        function wordBoundaryIncludes(haystack, needle) {
            if (!needle) return false;
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])');
            return re.test(' ' + haystack + ' ');
        }

        /* ========================================================================
         * REFERENCE DATA — Veiligheidsregio's (official, 25 regions)
         * Source: "Nationaal Nummerplan Brandweer Nederland" v1.5 (NVBR/LNM, 2008)
         * ==================================================================== */
        const VEILIGHEIDSREGIO = {
            '01': 'Groningen', '02': 'Fryslan', '03': 'Drenthe', '04': 'IJsselland',
            '05': 'Twente', '06': 'Noord- en Oost-Gelderland', '07': 'Gelderland-Midden',
            '08': 'Gelderland-Zuid', '09': 'Utrecht', '10': 'Noord-Holland Noord',
            '11': 'Zaanstreek-Waterland', '12': 'Kennemerland', '13': 'Amsterdam-Amstelland',
            '14': 'Gooi en Vechtstreek', '15': 'Haaglanden', '16': 'Hollands Midden',
            '17': 'Rotterdam-Rijnmond', '18': 'Zuid-Holland Zuid', '19': 'Zeeland',
            '20': 'Midden- en West-Brabant', '21': 'Brabant-Noord', '22': 'Brabant-Zuidoost',
            '23': 'Limburg-Noord', '24': 'Limburg-Zuid', '25': 'Flevoland',
        };

        // Place name (normalized, lowercase) -> regio code.
        // Not exhaustive for all ~1700 kazernes in NL — covers your current
        // buildings plus the main city of every region so new buildings have a
        // fighting chance of landing in the right region automatically.
        // Add more entries here any time; format: 'placename': 'regiocode'.
        const PLACE_TO_REGIO = {
            // Utrecht (09) — every VRU post
            'amersfoort-centrum': '09', 'amersfoort-noord': '09', 'amersfoort n-oost': '09', 'amersfoort': '09',
            'baarn': '09', 'bunschoten': '09', 'bunnik': '09', 'werkhoven': '09', 'bilthoven': '09',
            'de bilt': '09', 'groenekan': '09', 'maartensdijk': '09', 'westbroek': '09', 'abcoude': '09',
            'mijdrecht': '09', 'vinkeveen': '09', 'wilnis': '09', 'eemnes': '09', 'houten': '09',
            'houten-oost': '09', 'houten-west': '09', 'schalkwijk': '09', 'ijsselstein': '09',
            'achterveld': '09', 'leusden': '09', 'benschop': '09', 'lopik': '09', 'linschoten': '09',
            'montfoort': '09', 'nieuwegein': '09', 'oudewater': '09', 'renswoude': '09', 'elst': '09',
            'rhenen': '09', 'rhenen-achterberg': '09', 'soest': '09', 'soesterberg': '09', 'breukelen': '09',
            'kockengen': '09', 'loenen': '09', 'maarssen': '09', 'nieuwer ter aa': '09', 'nigtevecht': '09',
            'de meern': '09', 'utrecht': '09', 'vleuten': '09', 'amerongen': '09', 'driebergen': '09',
            'doorn': '09', 'leersum': '09', 'maarn-maarsbergen': '09', 'maarn': '09', 'veenendaal': '09',
            'hagestein': '09', 'vianen': '09', 'wijk bij duurstede': '09', 'harmelen': '09', 'kamerik': '09',
            'woerden': '09', 'zegveld': '09', 'woudenberg': '09', 'den dolder': '09', 'zeist': '09',
            'ameide': '09', 'leerdam': '09', 'lexmond': '09', 'meerkerk': '09', 'schoonrewoerd': '09',
            'nieuwegein-noord': '09', 'nieuwegein-zuid': '09',

            // Noord- en Oost-Gelderland (06) — Apeldoorn/Harderwijk/Putten area
            'apeldoorn': '06', 'harderwijk': '06', 'putten': '06', 'nunspeet': '06', 'elburg': '06',
            'epe': '06', 'oldebroek': '06', 'hattem': '06', 'zutphen': '06', 'doetinchem': '06',
            'winterswijk': '06', 'lochem': '06', 'voorst': '06', 'garderen': '06',

            // Gelderland-Midden (07) — Ede/Barneveld area
            'ede': '07', 'ederveen': '07', 'nijkerk': '07', 'scherpenzeel': '07', 'otterlo': '07',
            'barneveld': '07', 'arnhem': '07', 'wageningen': '07', 'renkum': '07', 'de valk': '07',

            // Gelderland-Zuid (08)
            'nijmegen': '08', 'tiel': '08', 'zaltbommel': '08', 'wijchen': '08', 'culemborg': '08',

            // Rest of NL — provincial anchor cities per region, extend as needed
            'groningen': '01', 'leeuwarden': '02', 'assen': '03', 'zwolle': '04', 'enschede': '05',
            'hilversum': '14', 'alkmaar': '10', 'den helder': '10', 'zaandam': '11', 'purmerend': '11',
            'haarlem': '12', 'haarlemmermeer': '12', 'schiphol': '12', 'ijmuiden': '12',
            'amsterdam': '13', 'amstelveen': '13', 'den haag': '15', 's-gravenhage': '15', 'delft': '15',
            'leiden': '16', 'alphen aan den rijn': '16', 'gouda': '16', 'rotterdam': '17', 'schiedam': '17',
            'dordrecht': '18', 'gorinchem': '18', 'middelburg': '19', 'vlissingen': '19', 'goes': '19',
            'breda': '20', 'tilburg': '20', 'den bosch': '21', 's-hertogenbosch': '21', 'oss': '21',
            'eindhoven': '22', 'helmond': '22', 'venlo': '23', 'roermond': '23', 'maastricht': '24',
            'heerlen': '24', 'sittard': '24', 'almere': '25', 'lelystad': '25',
        };

        /* ========================================================================
         * REFERENCE DATA — Brandweer (fire) vehicle-type -> digit/label
         * Empirically derived from ~14,000 real Dutch emergency vehicle records
         * (hulpdienstvoertuigenbenelux.nl national database, cross-referenced
         * against real roepnummers so the digit is measured, not guessed): for
         * each real "TypeVoertuig" description, this is the type-digit and
         * abbreviation real vehicles of that type actually carry.
         * ==================================================================== */
        const FIRE_TYPE_DICT = {
            "dienstbus": { digit: "0", label: "DB" },
            "tankautospuit": { digit: "3", label: "TS" },
            "personeel/materieelvoertuig": { digit: "0", label: "PM" },
            "officier van dienst brandweer": { digit: "9", label: "OVD-B" },
            "dienstauto": { digit: "0", label: "DA" },
            "grootschalige ontsmetting haakarmbak logistiek": { digit: "2", label: "GOH-LO" },
            "veetakel installatie aanhanger": { digit: "7", label: "VIA" },
            "haakarmvoertuig": { digit: "8", label: "HA" },
            "verlichtingsaanhanger": { digit: "8", label: "LIA" },
            "grootschalige ontsmetting haakarmbak decontaminatie": { digit: "2", label: "GOH-DC" },
            "oppervlakte reddingsteam voertuig": { digit: "1", label: "OR" },
            "brandweervaartuig middel": { digit: "1", label: "BRV-M" },
            "slangenhaakarmbak grootschalige watervoorziening": { digit: "6", label: "SLH-GW" },
            "dompelpompaanhanger grootschalige watervoorziening": { digit: "6", label: "DPA-GW" },
            "verkenningsvoertuig team digitale verkenning": { digit: "8", label: "VK-TDV" },
            "technische dienst": { digit: "0", label: "TD" },
            "hulpverleningsvoertuig": { digit: "7", label: "HV" },
            "gereedschap/materieelvoertuig": { digit: "0", label: "GM" },
            "adviseur gevaarlijke stoffen": { digit: "2", label: "AGS" },
            "logistiek voertuig": { digit: "8", label: "LO" },
            "hoofdofficier van dienst brandweer": { digit: "9", label: "HOVD-B" },
            "informatiemanager copi": { digit: "9", label: "IM-COPI" },
            "voorlichter brandweer": { digit: "9", label: "VL-B" },
            "team brandonderzoek": { digit: "0", label: "TBO" },
            "officier van dienst bevolkingszorg": { digit: "9", label: "OVD-BZ" },
            "waterongevallenvoertuig": { digit: "1", label: "WO" },
            "basis ontsmetting haakarmbak decontaminatie": { digit: "2", label: "BOH-DC" },
            "gevaarlijke stoffen haakarmbak": { digit: "2", label: "GSH" },
            "olieschermen haakarmbak": { digit: "2", label: "OSH" },
            "hoogwerker": { digit: "5", label: "HW" },
            "schuimblushaakarmbak": { digit: "6", label: "SBH" },
            "ondersteuningsteam grootschalige watervoorziening": { digit: "6", label: "ON-GW" },
            "hulpverleningsvoertuig met kraan": { digit: "7", label: "HV-KR" },
            "verlichtingshaakarmbak rampterrein verlichting": { digit: "7", label: "LIH-RTV" },
            "commandant van dienst brandweer": { digit: "9", label: "CVD-B" },
            "verzorgingshaakarmbak": { digit: "8", label: "VZH" },
            "commando voertuig multidisciplinair": { digit: "9", label: "CO-MU" },
            "hulpverleningshaakarmbak": { digit: "7", label: "HVH" },
            "specialistische technische hulpverlening haakarmbak stutmaterieel": { digit: "7", label: "SHH-ST" },
            "watertankhaakarmbak": { digit: "6", label: "WTH" },
            "schuimblusvoertuig": { digit: "6", label: "SB" },
            "personeel/materieelvoertuig bedrijfsbrandweer": { digit: "0", label: "PM-BB" },
            "schuimblusvoertuig bedrijfsbrandweer": { digit: "6", label: "SB-BB" },
            "haakarmvoertuig bedrijfsbrandweer": { digit: "8", label: "HA-BB" },
            "tankautospuit terreinvaardig natuurbrandbestrijding": { digit: "4", label: "TST-NB" },
            "tankautospuit terreinvaardig": { digit: "4", label: "TST" },
            "autoladder": { digit: "5", label: "AL" },
            "personeel/materieelvoertuig terreinvaardig": { digit: "0", label: "PMT" },
            "haakarmvoertuig met kraan": { digit: "8", label: "HA-KR" },
            "brandweervaartuig klein": { digit: "1", label: "BRV-K" },
            "dompelpomphaakarmbak grootschalige watervoorziening": { digit: "6", label: "DPH-GW" },
            "gevaarlijke stoffen voertuig": { digit: "2", label: "GS" },
            "waterbassinhaakarmbak": { digit: "6", label: "WBH" },
            "watertankwagen terreinvaardig": { digit: "6", label: "WTT" },
            "specialistische technische hulpverlening haakarmbak redding": { digit: "7", label: "SHH-RD" },
            "specialistische technische hulpverlening haakarmbak logistiek": { digit: "8", label: "SHH-LO" },
            "tankautospuit bedrijfsbrandweer": { digit: "3", label: "TS-BB" },
            "watertankwagen": { digit: "6", label: "WT" },
            "logistiek haakarmbak open uitvoering": { digit: "8", label: "LOH-O" },
            "algemeen commandant brandweer": { digit: "9", label: "AC-B" },
            "verbindingsdienst voertuig mobiel opstelpunt": { digit: "8", label: "VD-MOP" },
            "trekker klein": { digit: "0", label: "TK-K" },
            "motorspuitaanhanger": { digit: "6", label: "MSA" },
            "arbeidshygiene voertuig": { digit: "8", label: "AH" },
            "bijzonder materieel haakarmbak t.b.v. opleiding, training en oefenen": { digit: "8", label: "BMH-OTO" },
            "waterongevallen materieel aanhanger": { digit: "1", label: "WOA" },
            "verzorgingsvoertuig": { digit: "8", label: "VZ" },
            "verzorgingsaanhanger": { digit: "0", label: "VZA" },
            "trekker groot": { digit: "8", label: "TK-G" },
            "crashtender": { digit: "6", label: "CT" },
            "multifunctioneel voertuig terreinvaardig": { digit: "8", label: "MFT" },
            "kleinschalige watervoorziening voertuig": { digit: "6", label: "KW" },
            "adembescherming voertuig": { digit: "8", label: "AB" },
            "poederblusaanhanger": { digit: "6", label: "PBA" },
            "algemeen commandant crisiscommunicatie": { digit: "8", label: "AC-CC" },
            "slangenvoertuig kleinschalige watervoorziening": { digit: "6", label: "SL-KW" },
            "rietdak brandbestrijdingsteam": { digit: "6", label: "RI" },
            "handcrew voertuig": { digit: "0", label: "HC" },
            "brandstoftankaanhanger": { digit: "8", label: "BSA" },
            "tankautospuit t.b.v. opleiding, training en oefenen": { digit: "3", label: "TS-OTO" },
            "adembescherming haakarmbak": { digit: "8", label: "ABH" },
            "brandstoftankhaakarmbak": { digit: "8", label: "BSH" },
            "commando haakarmbak multidisciplinair": { digit: "9", label: "COH-MU" },
            "bijzonder materieel aanhanger t.b.v. opleiding, training en oefenen": { digit: "8", label: "BMA-OTO" },
            "verkenningsvoertuig ibgs": { digit: "2", label: "VK-GS" },
            "slangenaanhanger kleinschalige watervoorziening": { digit: "6", label: "SLA-KW" },
            "logistiek haakarmbak": { digit: "8", label: "LOH" },
            "gaspakteam voertuig": { digit: "2", label: "GP" },
            "logistiek voertuig ict": { digit: "0", label: "LO-ICT" },
            "stroom aggregaat aanhanger": { digit: "8", label: "SAA" },
            "haakarmvoertuig terreinvaardig": { digit: "8", label: "HAT" },
            "natuurbrandbestrijdingshaakarmbak": { digit: "4", label: "NBH" },
            "first responder brandweer": { digit: "8", label: "FR-B" },
            "ondersteuningsteam grootschalige ontsmetting": { digit: "2", label: "ON-GO" },
            "ondersteuningsteam logistiek": { digit: "0", label: "ON-LO" },
            "veetakel installatie voertuig": { digit: "7", label: "VI" },
            "pelotonscommandant logistiek": { digit: "8", label: "PC-L" },
            "centralist brandweer": { digit: "0", label: "CTL-B" },
            "commando voertuig fire bucket operations": { digit: "0", label: "CO-FBO" },
            "coordinatie- en informatievoorzieningsvoertuig brandweer": { digit: "9", label: "CI-B" },
            "schuimblusaanhanger": { digit: "6", label: "SBA" },
            "bijzondere uitrusting slangen opneem apparaat": { digit: "8", label: "BU-SO" },
            "bron-/buispomp aanhanger": { digit: "6", label: "BPA" },
            "watertankwagen groot": { digit: "6", label: "WT-G" },
            "bijzondere uitrusting vaartuig sonar": { digit: "8", label: "BUV-SN" },
            "brandweervaartuig groot": { digit: "6", label: "BRV-G" },
            "opleidingsvoertuig": { digit: "8", label: "OO" },
            "verkenningsvoertuig terreinvaardig natuurbrandbestrijding": { digit: "8", label: "VKT-NB" },
            "verzorgingsaanhanger met wc": { digit: "8", label: "VZA-WC" },
            "logistiek aanhanger": { digit: "8", label: "LOA" },
            "quick response team": { digit: "7", label: "QR" },
            "teamleider quick response team": { digit: "9", label: "TL-QRT" },
            "hulpverleningsvoertuig terreinvaardig": { digit: "7", label: "HVT" },
            "rietdak brandbestrijdingsteam aanhanger": { digit: "6", label: "RIA" },
            "bron-/buispomp haakarmbak": { digit: "6", label: "BPH" },
            "verzorgingshaakarmbak met wc": { digit: "8", label: "VZH-WC" },
            "verbindingscommando voertuig": { digit: "9", label: "VC" },
            "multifunctioneel voertuig terreinvaardig verreiker": { digit: "7", label: "MFT-VER" },
            "preventie": { digit: "0", label: "PR" },
            "snel inzetbaar voertuig": { digit: "6", label: "SI" },
            "schuimblusvoertuig met blusarm": { digit: "6", label: "SB-BA" },
            "schuimvormend middel aanhanger": { digit: "6", label: "SVA" },
            "coordinator verkenningseenheden": { digit: "2", label: "C-VE" },
            "geo informatie medewerker copi": { digit: "9", label: "GIMCOPI" },
            "arbeidshygiene haakarmbak": { digit: "8", label: "AHH" },
            "verbindingsdienst": { digit: "0", label: "VD" },
            "informatiemanager rot": { digit: "9", label: "IM-ROT" },
            "leider copi": { digit: "9", label: "L-COPI" },
            "geo informatie medewerker rot": { digit: "0", label: "GIM-ROT" },
            "schuimvormend middel haakarmbak": { digit: "6", label: "SVH" },
            "verkenningsvoertuig terreinvaardig": { digit: "0", label: "VKT" },
            "dompelpompvoertuig grootschalige watervoorziening": { digit: "6", label: "DP-GW" },
            "bijzonder materieel haakarmbak met bijzondere brandbestrijdingsmiddelen": { digit: "6", label: "BMH-BBM" },
            "dienstbus bedrijfsbrandweer": { digit: "0", label: "DB-BB" },
            "tankautospuit industrie brandbestrijding": { digit: "3", label: "TS-IB" },
            "officier van dienst bedrijfsbrandweer": { digit: "9", label: "OVD-BB" },
            "bedrijfsbrandweer": { digit: "5", label: "BB" },
            "gereedschap/materieelhaakarmbak": { digit: "7", label: "GMH" },
            "dienstauto terreinvaardig": { digit: "0", label: "DAT" },
            "dompelpomphaakarmbak tankput brandbestrijding": { digit: "6", label: "DPH-TPB" },
            "bijzonder materieel haakarmbak tankput brandbestrijding": { digit: "6", label: "BMH-TPB" },
            "schuimvormend middel haakarmbak tankput brandbestrijding": { digit: "6", label: "SVH-TPB" },
            "slangenhaakarmbak tankput brandbestrijding": { digit: "6", label: "SLH-TPB" },
            "waterkanonaanhanger tankput brandbestrijding": { digit: "6", label: "WKA-TPB" },
            "motorspuit/boosterpomphaakarmbak tankput brandbestrijding": { digit: "6", label: "MSH-TPB" },
            "tactisch officier meldkamer brandweer": { digit: "9", label: "TO-MKB" },
            "ts slagkracht": { digit: "3", label: "TS-SK" },
            "brandweervaartuig zeer groot": { digit: "6", label: "BRV-Z" },
            "autospuit industrie brandbestrijding": { digit: "6", label: "AS-IB" },
            "redteam hoogteverschillen": { digit: "7", label: "RH" },
            "stroom aggregaat haakarmbak": { digit: "8", label: "SAH" },
            "watertankhaakarmbak groot": { digit: "6", label: "WTH-G" },
            "ondersteuningsteam brandweervaartuig": { digit: "1", label: "ON-BRV" },
            "functionaris logistiek": { digit: "9", label: "FL" },
            "waterongevallenvaartuig middel": { digit: "1", label: "WOV-M" },
            "bijzonder materieel haakarmbak met blusrobot": { digit: "8", label: "BMH-BRB" },
            "brandweer motor": { digit: "6", label: "BRM" },
            "dienstauto bedrijfsbrandweer": { digit: "0", label: "DA-BB" },
            "bijzonder materieel haakarmbak met natuurbrand bestrijdingmaterieel": { digit: "4", label: "BMH-NB" },
            "personeel/materieelvoertuig ultra hoge druk blussysteem": { digit: "6", label: "PM-UHD" },
            "ondersteuningsteam verzorging": { digit: "0", label: "ON-VZ" },
            "bijzonder materieel veiligheidstester hoogspanning": { digit: "7", label: "BM-VTHS" },
            "bijzonder materieel haakarmbak scheepsincidentbestrijding": { digit: "8", label: "BMH-SIB" },
            "slangenopneemhaakarmbak tankput brandbestrijding": { digit: "8", label: "SOH-TPB" },
            "schuimvormend middel aanhanger tankput brandbestrijding": { digit: "6", label: "SVA-TPB" },
            "hoogwerker industrie brandbestrijding": { digit: "5", label: "HW-IB" },
            "bijzonder materieel aanhanger met natuurbrandbestrijding waterscherm": { digit: "4", label: "BMA-NWS" },
            "personeel/materieelvoertuig met bijzondere brandbestrijdingsmiddelen": { digit: "6", label: "PM-BBM" },
            "verkenningsvoertuig": { digit: "2", label: "VK" },
            "officier van dienst havenbedrijf": { digit: "9", label: "OVD-HB" },
            "hoofdofficier van dienst havenbedrijf": { digit: "9", label: "HOVD-HB" },
            "algemeen commandant havenbedrijf": { digit: "9", label: "AC-HB" },
            "test eenheid": { digit: "0", label: "BM-TES" },
            "teamleider team digitale verkenning": { digit: "0", label: "TL-TDV" },
            "regionaal operationeel leider": { digit: "9", label: "ROL" },
            "bijzonder materieel aanhanger spoorsloot overbrugging": { digit: "8", label: "BMA-SOB" },
            "personeel/materieelvoertuig terreinvaardig usar": { digit: "0", label: "PMT-USR" },
            "gereedschap/materieelvoertuig terreinvaardig": { digit: "7", label: "GMT" },
            "schuimblusvoertuig terreinvaardig": { digit: "6", label: "SBT" },
            "watertankaanhanger groot": { digit: "6", label: "WTA-G" },
            "ondersteuningsteam hulpverlening": { digit: "7", label: "ON-HV" },
            "poederblushaakarmbak": { digit: "6", label: "PBH" },
            "medische assistentie voertuig": { digit: "8", label: "MA" },
            "dienstbus defensie": { digit: "0", label: "DB-DF" },
            "tankautospuit terreinvaardig defensie": { digit: "4", label: "TST-DF" },
            "watertankwagen defensie": { digit: "6", label: "WT-DF" },
            "watertankhaakarmbak defensie": { digit: "6", label: "WTH-DF" },
            "motorspuitaanhanger defensie": { digit: "6", label: "MSA-DF" },
            "haakarmvoertuig defensie": { digit: "8", label: "HA-DF" },
            "logistiek haakarmbak defensie": { digit: "8", label: "LOH-DF" },
            "officier van dienst defensie": { digit: "9", label: "OVD-DF" },
            "tankautospuit defensie": { digit: "3", label: "TS-DF" },
            "crashtender defensie": { digit: "6", label: "CT-DF" },
            "on scene commander defensie": { digit: "9", label: "OSC-DF" },
            "hoogwerker defensie": { digit: "5", label: "HW-DF" },
            "bijzonder materieel haakarmbak defensie": { digit: "6", label: "BMH-DF" },
            "olieschermen haakarmbak defensie": { digit: "8", label: "OSH-DF" },
            "waterongevallenvoertuig defensie": { digit: "1", label: "WO-DF" },
        };
        const FIRE_TYPE_KEYS_BY_LENGTH = Object.keys(FIRE_TYPE_DICT).sort((a, b) => b.length - a.length);

        // Real abbreviations actually used on Dutch emergency vehicles nationally
        // (same source as above). Used to sanity-check a label we read off a
        // vehicle's own current name before trusting it.
        const KNOWN_AFKORTINGEN = new Set([
            "AB", "ABH", "AC-B", "AC-CC", "AC-G", "AC-HB", "AFO", "AGS", "AGS-G", "AGS-ROT", "AH", "AHH", "AL", "AL-OTO", "AMBU-DF", "AMBU-EH", "AMBU-HC", "AMBU-IT", "AMBU-LC", "AMBU-MC", "AMBU-RK", "AMBU-SC", "ARTS-HP", "ARTS-SC", "AS", "AS-BB", "AS-IB", "ATP", "BB", "BM-BBM", "BM-BRB", "BM-TES", "BM-VTHS", "BMA-NB", "BMA-NWS", "BMA-OTO", "BMA-SOB", "BMA-USR", "BMH", "BMH-BB", "BMH-BBM", "BMH-BRB", "BMH-DF", "BMH-KR", "BMH-NB", "BMH-OTO", "BMH-SIB", "BMH-SOB", "BMH-TPB", "BOH-DC", "BPA", "BPH", "BRM", "BRV-G", "BRV-K", "BRV-M", "BRV-WSC", "BRV-Z", "BSA", "BSB", "BSH", "BT-EH", "BT-RA", "BT-RK", "BTV", "BU-BRB", "BU-SO", "BU-UHD", "BUV-OWD", "BUV-SN", "C-VE", "CA-EH", "CAH-BH", "CDT-B", "CGV", "CI-B", "CI-RB", "CO-FBO", "CO-MU", "CO-RA", "CO-RK", "COH-B", "COH-MU", "COP-DCU", "COP-RB", "CT", "CT-DF", "CTL-B", "CVD-B", "CVD-G", "DA", "DA-BB", "DA-DF", "DA-PL", "DA-RA", "DA-WAIS", "DAT", "DB", "DB-BB", "DB-DF", "DB-ICB", "DB-RA", "DB-RK", "DP-GW", "DPA-GW", "DPH-BB", "DPH-GW", "DPH-TPB", "EH", "EHH-MP", "FL", "FR-B", "FR-DF", "GGB", "GIM-ROT", "GIMCOPI", "GM", "GMH", "GMH-BB", "GMT", "GOH-DC", "GOH-LO", "GP", "GPH", "GS", "GS-BB", "GS-S", "GSA", "GSH", "GSH-BB", "GSH-PBM", "HA", "HA-BB", "HA-DF", "HA-ICB", "HA-KR", "HA-RA", "HA-RK", "HART", "HAT", "HAT-KR", "HBV", "HC", "HIN-B", "HIN-RA", "HON-B", "HON-RA", "HOVD-B", "HOVD-G", "HOVD-HB", "HRB", "HSCH", "HV", "HV-BB", "HV-KR", "HV-OTO", "HVA", "HVH", "HVH-BB", "HVT", "HW", "HW-BB", "HW-DF", "HW-IB", "IM-COPI", "IM-ROT", "KMCGS", "KW", "L-COPI", "LA-NB", "LA-TDV", "LBO", "LG", "LIA", "LIH-RTV", "LO", "LO-BB", "LO-ICT", "LO-KR", "LO-RA", "LO-RK", "LOA", "LOA-RA", "LOH", "LOH-DF", "LOH-KR", "LOH-O", "MA", "MFT", "MFT-EH", "MFT-RB", "MFT-VER", "MICU", "MMT", "MMTL", "MSA", "MSA-BB", "MSA-DF", "MSH-TPB", "NBH", "NHT", "NICU", "NRV", "OG", "ON-BRV", "ON-GO", "ON-GW", "ON-HV", "ON-LO", "ON-UHD", "ON-VZ", "OO", "OO-RA", "OPSCENT", "OR", "OS", "OSC", "OSC-DF", "OSH", "OSH-DF", "OVD-B", "OVD-BB", "OVD-BZ", "OVD-DF", "OVD-G", "OVD-HB", "OVD-MB", "OVDG-DF", "OVDG-N", "OVDG-NO", "OVDG-RR", "OVDG-Z", "OVDG-ZW", "PAL-RA", "PAT", "PBA", "PBH", "PBH-BB", "PC-B", "PC-L", "PICU", "PM", "PM-BB", "PM-BBM", "PM-DF", "PM-UHD", "PMT", "PMT-USR", "PR", "QR", "RA", "RAA", "RAH", "RAV", "RB", "RBT", "RBV", "RBV-WSC", "RES-PKT", "RGF", "RH", "RHIB", "RI", "RIA", "RK", "RKA", "RKA-MP", "RKH", "RKH-MP", "RMT-KHV", "RMV", "RMV-WSC", "ROL", "RR", "RR-EH", "RR-RK", "RR-VS", "RRM", "RRM-EH", "SAA", "SAH", "SB", "SB-BA", "SB-BB", "SBA", "SBH", "SBT", "SC", "SHH-LO", "SHH-RD", "SHH-ST", "SI", "SI-BB", "SL-GW", "SL-KW", "SLA-KW", "SLH-BB", "SLH-GW", "SLH-TPB", "SN", "SOA", "SOH-TPB", "SORT", "SPL", "STAF", "SVA", "SVA-TPB", "SVH", "SVH-BB", "SVH-DF", "SVH-TPB", "TBO", "TC-B", "TD", "TK-G", "TK-K", "TK-RK", "TL-QRT", "TL-STH", "TL-TDV", "TO-MKB", "TS", "TS-4", "TS-BB", "TS-DF", "TS-IB", "TS-OTO", "TS-RO", "TS-SK", "TST", "TST-DF", "TST-NB", "VC", "VC-BB", "VC-DF", "VD", "VD-MOP", "VI", "VIA", "VK", "VK-GS", "VK-TDV", "VKL-DRG", "VKT", "VKT-NB", "VL-B", "VNA", "VZ", "VZA", "VZA-WC", "VZH", "VZH-KA", "VZH-WC", "WBH", "WKA-TPB", "WKH-BB", "WO", "WO-DF", "WOA", "WOH", "WOV", "WOV-K", "WOV-M", "WT", "WT-DF", "WT-G", "WTA-G", "WTH", "WTH-DF", "WTH-G", "WTT", "ZSC", "ZWB",
        ]);

        /* ========================================================================
         * REFERENCE DATA — numeric vehicle_type -> Dutch caption.
         * The API's `vehicle_type_caption` text field is empty/null for a lot of
         * vehicles (this is what was causing everything to fall back to OVR), but
         * every vehicle always carries a numeric `vehicle_type` id. This table
         * (game-internal ids, sourced from the community LSS Manager tool's own
         * Dutch translations, which it needs for its UI) maps that id straight to
         * the real Dutch vehicle name — bypassing the unreliable text field
         * entirely. Confirmed correct against this save: e.g. id 106 "Berger-K
         * (RWS)" and id 144/145 "DB-ICB"/"OvD-ICB" match vehicles you already own.
         * ==================================================================== */
        const VEHICLE_TYPE_ID_MAP = {
            0: "SI-2", 1: "TS 8/9", 2: "Autoladder", 3: "DA - Officier van Dienst", 4: "Hulpverleningsvoertuig",
            5: "Adembeschermingsvoertuig", 6: "TST 8/9", 7: "TST 6/7", 8: "TST 4/5", 9: "TS 4/5",
            10: "Slangenwagen", 11: "Verkenningseenheid Brandweer", 12: "TST-NB 8/9", 14: "TST-NB 6/7", 15: "TST-NB 4/5",
            16: "Ambulance", 17: "TS 6/7", 18: "Hoogwerker", 19: "DA - Hoofdofficier van Dienst", 20: "DA",
            21: "DB Klein", 22: "DA Noodhulp", 23: "Lifeliner", 24: "DA - Adviseur Gevaarlijke stoffen", 25: "DB Noodhulp",
            26: "Haakarmvoertuig", 27: "Adembeschermingshaakarmbak", 28: "Politiehelikopter", 29: "Watertankhaakarmbak", 30: "Zorgambulance",
            31: "Commandovoertuig", 32: "Commandohaakarmbak", 33: "Waterongevallenvoertuig", 34: "Watertankwagen", 35: "Officier van Dienst - Politie",
            36: "Waterongevallenaanhanger", 37: "MMT-Auto", 38: "Officier van Dienst - Geneeskunde", 39: "ME Commandovoertuig", 40: "ME Flexbus",
            41: "Crashtender (8x8)", 42: "Crashtender (6x6)", 43: "Crashtender (4x4)", 44: "Airport Fire Officer / On Scene Commander", 45: "Dompelpomphaakarmbak",
            46: "DM-Politie", 47: "DA Hondengeleider", 48: "DB Hondengeleider", 49: "PM-OR | Materieelvoertuig - Oppervlakteredding", 50: "TS-OR | Tankautospuit - Oppervlakteredding",
            51: "HulpverleningsHaakarmbak", 52: "Rapid Responder", 53: "AT-Commandant", 54: "AT-Operator", 55: "AT-Materiaalwagen",
            56: "DA Voorlichter", 57: "DA Officier van Dienst - Geneeskundig / Rapid Responder", 58: "DB Arrestantenvervoer", 59: "Noodhulp - Onopvallend", 60: "DB Biketeam",
            61: "Slangenhaakarmbak", 62: "TS-HV | Tankautospuit-Hulpverlening", 63: "DM - Rapid Responder", 64: "ME Aanhoudingseenheid", 65: "DA Terreinwaardig - Reddingsbrigade",
            66: "Kusthulpverleningsvoertuig", 67: "Bootaanhanger Reddingsbrigade", 68: "SB", 69: "SBH", 70: "SBA",
            71: "MSA", 72: "DPA", 73: "Vrachtwagen - Bereden Brigade", 74: "Bereden Brigade Aanhanger", 75: "Dienstauto terreinvaardig - Noodhulp",
            76: "Quad", 77: "KW-boot", 78: "RB-K", 79: "RB-G", 80: "SAR-heli",
            81: "DA-RWS | Dienstvoertuig weginspecteur Rijkswaterstaat", 82: "DM-RWS | Dienstmotor weginspecteur Rijkswaterstaat", 83: "DA-SIG | Signalisatievoertuig", 84: "Waterwerper", 85: "FBO-Heli",
            86: "DB-Handcrew", 87: "DA-LA-NB", 88: "VW-NB", 89: "NBH", 90: "TS-STH",
            91: "HVH-STH", 92: "DB-USAR", 93: "TS-USAR", 94: "VW-USAR", 95: "DM-USAR",
            96: "Quad-USAR", 97: "DB–Speurhonden", 98: "SIV-P", 99: "DB-VOA", 100: "GGB",
            101: "NHT", 102: "MC-Ambulance", 103: "MICU", 104: "Berger-K", 105: "Berger-G",
            106: "Berger-K (RWS)", 107: "Berger-G (RWS)", 108: "Berger-K (Politie)", 109: "Berger-G (Politie)", 110: "DAT-KMAR",
            111: "DB-KMAR", 112: "DM-KMAR", 113: "DAT-EOD", 114: "DB-EOD", 115: "VW-EOD",
            116: "DB-Explosievenhonden", 117: "DB-Explosievenduikers", 118: "BA-DDG", 119: "DB-TEV", 120: "DB-VZ",
            121: "VZH", 122: "DB-AH", 123: "VZH-AH", 124: "DB-PC-LOG", 125: "DB-LOG",
            126: "VW-LOG", 127: "BMH-LOG", 128: "DB-DRONE", 129: "DB-TDV", 130: "SB-BA",
            131: "SB-IB", 132: "AS", 133: "TS-IB", 134: "GSH", 135: "DB-GS",
            136: "GPH", 137: "DB-GP", 138: "BOH-DC", 139: "TS-BO", 140: "DB-BO",
            141: "GOH-DC", 142: "TS-GO", 143: "DB-GO", 144: "DB-ICB", 145: "OvD-ICB",
            146: "VW-VZ-ICB", 147: "HA-ICB", 148: "GM-ICB", 149: "HSH-ICB", 150: "VW-HS",
            151: "BM-VTHS", 152: "TS-Spoor",
        };

        // The one caption source that's actually reliable: prefer the API's own
        // text if present (rare, but possible), otherwise resolve it from the
        // numeric type id, which is always populated.
        function resolveTypeCaption(vehicle) {
            return vehicle.vehicle_type_caption || VEHICLE_TYPE_ID_MAP[vehicle.vehicle_type] || '';
        }

        // Fire-relevant entries of VEHICLE_TYPE_ID_MAP, classified directly into
        // the official numbering plan's digit bucket. This is the fix for the
        // real bug: VEHICLE_TYPE_ID_MAP gives short game captions like "TS 6/7",
        // which never matched FIRE_TYPE_DICT's full Dutch descriptions (like
        // "tankautospuit") — so classification was silently failing and falling
        // through to trusting the vehicle's own current name, which is circular
        // when that name is already wrong. This table is name-independent and
        // always available, so it's now checked FIRST.
        const VEHICLE_TYPE_ID_TO_ROLE = {
            0: { digit: '8', label: 'SI-2' }, 1: { digit: '3', label: 'TS 8/9' }, 2: { digit: '5', label: 'AL' },
            3: { digit: '9', label: 'DA-OVD' }, 4: { digit: '7', label: 'HV' }, 5: { digit: '8', label: 'AB' },
            6: { digit: '4', label: 'TST 8/9' }, 7: { digit: '4', label: 'TST 6/7' }, 8: { digit: '4', label: 'TST 4/5' },
            9: { digit: '3', label: 'TS 4/5' }, 10: { digit: '6', label: 'SL' }, 11: { digit: '2', label: 'VEB' },
            12: { digit: '4', label: 'TST-NB 8/9' }, 14: { digit: '4', label: 'TST-NB 6/7' }, 15: { digit: '4', label: 'TST-NB 4/5' },
            17: { digit: '3', label: 'TS 6/7' }, 18: { digit: '5', label: 'HW' }, 19: { digit: '9', label: 'DA-HOVD' },
            20: { digit: '0', label: 'DA' }, 21: { digit: '0', label: 'DB' }, 24: { digit: '2', label: 'DA-AGS' },
            26: { digit: '8', label: 'HA' }, 27: { digit: '8', label: 'ABH' }, 29: { digit: '6', label: 'WTH' },
            31: { digit: '9', label: 'CO' }, 32: { digit: '9', label: 'COH' }, 33: { digit: '1', label: 'WO' },
            34: { digit: '6', label: 'WT' }, 36: { digit: '1', label: 'WOA' }, 41: { digit: '6', label: 'CT' },
            42: { digit: '6', label: 'CT' }, 43: { digit: '6', label: 'CT' }, 44: { digit: '9', label: 'AFO' },
            45: { digit: '6', label: 'DPH' }, 49: { digit: '1', label: 'PM-OR' }, 50: { digit: '1', label: 'TS-OR' },
            51: { digit: '7', label: 'HVH' }, 56: { digit: '9', label: 'VL-B' }, 61: { digit: '6', label: 'SLH' },
            62: { digit: '3', label: 'TS-HV' }, 68: { digit: '6', label: 'SB' }, 69: { digit: '6', label: 'SBH' },
            70: { digit: '6', label: 'SBA' }, 71: { digit: '6', label: 'MSA' }, 72: { digit: '6', label: 'DPA' },
            76: { digit: '8', label: 'Quad' }, 77: { digit: '6', label: 'KW-boot' }, 84: { digit: '6', label: 'WKA' },
            86: { digit: '0', label: 'DB-Handcrew' }, 87: { digit: '9', label: 'LA-NB' }, 88: { digit: '8', label: 'VW-NB' },
            89: { digit: '4', label: 'NBH' }, 90: { digit: '7', label: 'TS-STH' }, 91: { digit: '7', label: 'HVH-STH' },
            92: { digit: '7', label: 'DB-USAR' }, 93: { digit: '7', label: 'TS-USAR' }, 94: { digit: '7', label: 'VW-USAR' },
            95: { digit: '7', label: 'DM-USAR' }, 96: { digit: '7', label: 'Quad-USAR' }, 97: { digit: '8', label: 'DB-Speurhonden' },
            119: { digit: '8', label: 'DB-TEV' }, 120: { digit: '8', label: 'DB-VZ' }, 121: { digit: '8', label: 'VZH' },
            122: { digit: '8', label: 'DB-AH' }, 123: { digit: '8', label: 'VZH-AH' }, 124: { digit: '8', label: 'DB-PC-LOG' },
            125: { digit: '8', label: 'DB-LOG' }, 126: { digit: '8', label: 'VW-LOG' }, 127: { digit: '8', label: 'BMH-LOG' },
            128: { digit: '8', label: 'DB-DRONE' }, 129: { digit: '8', label: 'DB-TDV' }, 130: { digit: '6', label: 'SB-BA' },
            131: { digit: '6', label: 'SB-IB' }, 132: { digit: '3', label: 'AS' }, 133: { digit: '3', label: 'TS-IB' },
            134: { digit: '2', label: 'GSH' }, 135: { digit: '2', label: 'DB-GS' }, 136: { digit: '2', label: 'GPH' },
            137: { digit: '2', label: 'DB-GP' }, 138: { digit: '2', label: 'BOH-DC' }, 139: { digit: '2', label: 'TS-BO' },
            140: { digit: '2', label: 'DB-BO' }, 141: { digit: '2', label: 'GOH-DC' }, 142: { digit: '2', label: 'TS-GO' },
            143: { digit: '2', label: 'DB-GO' }, 144: { digit: '9', label: 'DB-ICB' }, 145: { digit: '9', label: 'OvD-ICB' },
            146: { digit: '8', label: 'VW-VZ-ICB' }, 147: { digit: '8', label: 'HA-ICB' }, 148: { digit: '0', label: 'GM-ICB' },
            149: { digit: '7', label: 'HSH-ICB' }, 150: { digit: '8', label: 'VW-HS' }, 151: { digit: '7', label: 'BM-VTHS' },
            152: { digit: '3', label: 'TS-Spoor' },
        };

        // Type captions/vehicles that already got a "can't classify" warning this
        // session — avoids spamming the console with the same one repeatedly.
        const warnedUnclassified = new Set();

        // Turns out `vehicle_type_caption` from the API is empty/null for a lot of
        // vehicles on this site — it is NOT a reliable signal on its own. But every
        // vehicle that already has a real-format name ("NN-NNNN LABEL") has its
        // role encoded right there in the number and the label text itself, and
        // that's ground truth (it's either the real roepnummer, or a name this
        // very script assigned before) — far more reliable than keyword-guessing.
        // We NEVER invent a generic "OVR" placeholder name any more: if we can't
        // work out a vehicle's role from either signal, we leave it untouched
        // rather than assign it a meaningless name.
        function classifyFireVehicle(typeCaption, currentName, vehicleTypeId) {
            // Priority 1: the numeric vehicle_type id — name-independent, always
            // populated, and can never be circular the way trusting the current
            // name could be.
            if (vehicleTypeId !== undefined && VEHICLE_TYPE_ID_TO_ROLE[vehicleTypeId]) {
                return VEHICLE_TYPE_ID_TO_ROLE[vehicleTypeId];
            }

            // Priority 2: the (rarely populated) API type-caption text, matched
            // against the real-world Dutch type dictionary.
            const norm = normalize(typeCaption);
            if (norm) {
                if (FIRE_TYPE_DICT[norm]) return FIRE_TYPE_DICT[norm];
                for (const key of FIRE_TYPE_KEYS_BY_LENGTH) {
                    if (wordBoundaryIncludes(norm, key)) return FIRE_TYPE_DICT[key];
                }
            }

            // Priority 3 (last resort): trust the vehicle's own current name IF
            // it's already in real format with a plausible-looking label. Kept
            // low-priority on purpose — trusting it FIRST was circular (a vehicle
            // mislabeled by an old bug would just keep re-confirming its own
            // mistake forever, since the name matches "itself" every time).
            const parsedCurrent = currentName ? parseFireCallsign(currentName) : null;
            if (parsedCurrent) {
                const firstToken = (parsedCurrent.label || '').split(' ')[0];
                const prefix = firstToken.split('-')[0];
                const looksLikeRealAfkorting = /^[A-Z0-9][A-Z0-9\-/]{0,12}$/.test(firstToken);
                const isLeftoverOvr = /^OVR(-\d+)?$/i.test(firstToken);
                if (!isLeftoverOvr && (KNOWN_AFKORTINGEN.has(firstToken) || KNOWN_AFKORTINGEN.has(prefix) || looksLikeRealAfkorting)) {
                    return { digit: parsedCurrent.typeDigit, label: parsedCurrent.label };
                }
            }

            const warnKey = `${typeCaption}|${currentName}|${vehicleTypeId}`;
            if (!warnedUnclassified.has(warnKey)) {
                warnedUnclassified.add(warnKey);
                warn(`can't classify vehicle "${currentName}" (type text: "${typeCaption || '(empty)'}", type id: ${vehicleTypeId}) — leaving it untouched. Tell Claude the exact vehicle name/type so it can be taught.`);
            }
            return null;
        }

        function parseFireCallsign(cs) {
            const m = cs.match(/^(\d{2})-(\d{2})(\d)(\d)(?:\s+(.*))?$/);
            if (!m) return null;
            return { regio: m[1], post: m[2], typeDigit: m[3], seq: m[4], label: m[5] || '' };
        }

        /* ========================================================================
         * REFERENCE DATA — exact real Utrecht (09) brandweer roepnummers
         * Source: user-supplied "Utrecht vehicle naming" reference sheet.
         * Parenthesised notes stripped as instructed.
         * ==================================================================== */
        const UTRECHT_FIRE_STATIONS = {
            "Amersfoort-Centrum": ["09-0101 DB", "09-0111 WO", "09-0131 TS", "09-0132 TS", "09-0133 TS", "09-0134 TSC", "09-0144 TST-NB", "09-0152 AL", "09-0181 HA", "09-8031 TS", "09-8030 TS", "09-8052 AL", "09-8182 HA", "09-8641 TST", "09-8684 HA", "09-9093 Leiding & Coordinatie Unit", "09-9297 MC", "09-9471 PM-QRT", "09-9491 DA-QRT"],
            "Amersfoort-Noord": ["09-0231 TS", "09-0271 HV"],
            "Baarn": ["09-0301 DB", "09-0331 TS", "09-0341 TST", "09-0372 MFT", "09-0374 HVT", "09-0380 PMT"],
            "Bunschoten": ["09-0401 DB", "09-0411 WO", "09-0412 WOV", "09-0431 TS", "09-0432 TS", "09-0468 MSA"],
            "Bunnik": ["09-0501 DB", "09-0531 TS", "09-0571 HV"],
            "Werkhoven": ["09-0601 DB", "09-0631 TS", "09-0667 RIA", "09-0668 MSA", "09-0680 PM"],
            "Bilthoven": ["09-0701 DB", "09-0734 TSC", "09-0744 TST-NB", "09-0762 SLH", "09-0774 HVT", "09-0781 HA", "09-9187 ABH"],
            "De Bilt": ["09-0801 PM", "09-0831 TS"],
            "Groenekan": ["09-0931 TS"],
            "Maartensdijk": ["09-1034 TSC", "09-1044 TST-NB"],
            "Westbroek": ["09-1131 TS"],
            "Abcoude": ["09-1201 DB", "09-1210 PM-OR", "09-1231 TS", "09-1280 GM"],
            "Mijdrecht": ["09-1311 WO", "09-1321 DV-VK", "09-1331 TS", "09-1332 TS", "09-1351 HW"],
            "Vinkeveen": ["09-1401 DB", "09-1412 BRV", "09-1431 TS", "09-1468 MSA", "09-1480 PM"],
            "Wilnis": ["09-1501 DB", "09-1531 TS", "09-1571 HV", "09-1568 MSA", "09-1578 VT"],
            "Eemnes": ["09-1601 DB", "09-1621 DB-VK", "09-1631 TS", "09-1632 TS"],
            "Houten": ["09-1731 TS", "09-1801 DB", "09-1812 WOV", "09-1831 TS", "09-1832 TS", "09-1880 DB", "09-9063 WT", "09-9197 MC"],
            "Schalkwijk": ["09-1901 DB", "09-1921 DB-VK", "09-1931 TS"],
            "IJsselstein": ["09-2001 DB", "09-2031 TS", "09-2032 TS", "09-2052 AL"],
            "Achterveld": ["09-2101 DB", "09-2131 TS", "09-2168 MSA", "09-2178 PM-VI", "09-2180 DB-K"],
            "Leusden": ["09-2231 TS", "09-2241 TST-NB", "09-2261 WTS-2500", "09-2265 WTH", "09-2286 HAT"],
            "Benschop": ["09-2301 DB", "09-2331 TS", "09-2368 MSA", "09-2378 VIA", "09-2380 PM"],
            "Lopik": ["09-2401 DB", "09-2431 TS", "09-2432 TS"],
            "Linschoten": ["09-2531 TS", "09-2571 HV"],
            "Montfoort": ["09-2601 DB", "09-2631 TS", "09-2661 DPH", "09-2668 MSA", "09-2680 PM", "09-2681 HA"],
            "Nieuwegein-Noord": ["09-2701 DB", "09-2731 TS", "09-2732 TS", "09-2771 HV", "09-9472 PM-QRT", "09-9492 DA-QRT"],
            "Nieuwegein-Zuid": ["09-2801 DB", "09-2831 TS", "09-2869 PM-KSH"],
            "Oudewater": ["09-2901 PM", "09-2931 TS", "09-2932 TS", "09-2978 VTI", "09-9183 PM-VZ"],
            "Renswoude": ["09-3001 DB", "09-3041 TS", "09-3068 MSA", "09-3080 PM"],
            "Elst": ["09-3134 TSC", "09-3144 TST-NB", "09-3172 MFT", "09-3180 PMT"],
            "Rhenen": ["09-3201 DB", "09-3231 TS", "09-3241 TST-NB", "09-3268 MSA", "09-3278 VIA"],
            "Soest": ["09-3301 DB", "09-3341 TST-NB", "09-3351 HW", "09-3364 BPH", "09-3366 WBH", "09-3386 HAT", "09-3387 BSH"],
            "Soest-Nevenpost": ["09-3441 TST-NB"],
            "Soesterberg": ["09-3501 DB", "09-3534 TSC", "09-3541 TST-NB", "09-9283 PM-VZ"],
            "Breukelen": ["09-3601 DB", "09-3612 WOV", "09-3631 TS", "09-3632 TS", "09-3671 HV"],
            "Kockengen": ["09-3731 TS", "09-3767 PM-RI"],
            "Loenen": ["09-3801 DB", "09-3831 TS", "09-8131 TS"],
            "Maarssen": ["09-3911 WO", "09-3931 TS", "09-3932 TS", "09-3952 AL", "09-3961 DPH", "09-8132 TS", "09-8202 PM-TD"],
            "Nieuwer ter Aa": ["09-4101 DB", "09-4131 TS", "09-4181 HA"],
            "Nigtevecht": ["09-4201 DB", "09-4231 TS"],
            "De Meern": ["09-4301 DB", "09-4321 DB-VK", "09-4331 TS"],
            "Utrecht-Leidsche Rijn": ["09-4401 DB", "09-4411 WO", "09-4412 WOV", "09-4431 TS", "09-4452 AL", "09-4471 HV", "09-4480 PM5", "09-4481 HA", "09-4482 HA", "09-8181 HA", "09-8301 VW", "09-8531 TS", "09-9075 HVH-LI", "09-9080 VW", "09-9082 HA", "09-9083 VZH-WC", "09-9084 VZH", "09-9085 VW", "09-9088 PM5"],
            "Utrecht-Schepenbuurt": ["09-4501 DB", "09-4522 GSH-DE", "09-4531 TS", "09-4581 HA"],
            "Utrecht-Tolsteeg": ["09-4601 PM", "09-4631 TS"],
            "Vleuten": ["09-4701 DB", "09-4731 TS", "09-8532 TS"],
            "Amerongen": ["09-5001 PM", "09-5034 TSC", "09-5044 TST-NB", "09-5071 HV"],
            "Driebergen": ["09-5101 DB", "09-5131 TS", "09-5144 TST-NB", "09-5169 WT"],
            "Doorn": ["09-5201 DB", "09-5234 TSC", "09-5244 TST-NB", "09-5252 AL", "09-8832 TS"],
            "Leersum": ["09-5301 DB", "09-5321 DB-VK", "09-5334 TSC", "09-5344 TST-NB", "09-8831 TS", "09-9473 PM-QRT", "09-9493 DA-QRT"],
            "Maarn-Maarsbergen": ["09-5401 DB", "09-5431 TS", "09-5434 TSC", "09-5444 TST-NB", "09-5474 HVT"],
            "Veenendaal": ["09-5501 DB", "09-5522 MIH", "09-5531 TS", "09-5532 TS", "09-5541 TST-NB", "09-5552 AL", "09-5561 DPH", "09-5571 HV", "09-5581 HA", "09-5586 HAT", "09-8502 DA", "09-9272 BMH-Log"],
            "Hagestein": ["09-5631 TS"],
            "Vianen": ["09-5710 PM-OR", "09-5712 WOV", "09-5731 TS", "09-5751 HW", "09-5780 PMT"],
            "Wijk bij Duurstede": ["09-5901 DB", "09-5911 WO", "09-5912 WOV", "09-5931 TS", "09-5934 TSC", "09-5944 TST-NB"],
            "Harmelen": ["09-6001 DB", "09-6031 TS", "09-6068 MSA"],
            "Kamerik": ["09-6131 TS", "09-6167 RI"],
            "Woerden": ["09-6210 PM-OR", "09-6231 TS", "09-6232 TS", "09-6252 AL"],
            "Zegveld": ["09-6301 DB", "09-6331 TS"],
            "Woudenberg": ["09-6434 TSC", "09-6444 TST-NB", "09-6464 WBH", "09-6466 BPH", "09-6486 HAT", "09-8481 HA", "09-8633 TS"],
            "Den Dolder": ["09-6531 TS"],
            "Zeist": ["09-6621 DV-VK", "09-6631 TS", "09-6644 TST-NB", "09-6652 AL", "09-6662 SLH", "09-6665 WTH", "09-6686 HAT", "09-8032 TS"],
            "Ameide": ["09-6701 DB", "09-6731 TS"],
            "Leerdam": ["09-6801 PM", "09-6802 DV-BVD", "09-6831 TS", "09-6851 HW"],
            "Lexmond": ["09-6901 PM", "09-6931 TS"],
            "Meerkerk": ["09-7001 DB", "09-7031 TS", "09-7071 HV2"],
            "Schoonrewoerd": ["09-7101 DB", "09-7131 TS", "09-7169 WT"],
        };

        // Partial, community-sourced (forum.meldkamerspel.com) real Gelderland-Midden (07)
        // roepnummers for the handful of your buildings that fall in this region.
        const GELDERLAND_MIDDEN_FIRE_STATIONS = {
            "Ede": ["07-2701 DB", "07-2704 DA", "07-2705 DA"],
            "Ederveen": ["07-2531 TS", "07-2580 DB-FRB"],
            "Nijkerk": ["07-1101 DB", "07-1103 DA", "07-1104 DA", "07-1131 TST"],
            "Scherpenzeel": ["07-1931 TST", "07-1961 PM-FRB"],
            "Garderen": ["07-1341 TST-NBB", "07-1380 DB-FRB"],
            "Otterlo": ["07-2341 TST-NBB", "07-2380 DA-FRB"],
        };

        // Alias fixes for building names that don't match a place key directly.
        const FIRE_BUILDING_ALIASES = {
            'brandweer kazerne de valk': 'de valk',
            'brandweer kazerne houten': 'houten',
            'brandweer kazerne putten': 'putten',
            'brandweer kazerne harderwijk': 'harderwijk',
            'brandweer post schiphol rijk': 'schiphol',
            'brandweer post schiphol sloten': 'schiphol',
            'brandweer post schiphol vijfhuizen': 'schiphol',
        };

        /* ========================================================================
         * REFERENCE DATA — Ambulance (generic RAVU-style; 1xx regular / 3xx rapid
         * responder-solo-motor / 4xx B-ambulance). Region code reused from the
         * fire/veiligheidsregio table since RAV regions use the same numbering.
         * ==================================================================== */
        // Direct numeric vehicle_type -> role, same rationale as the fire table:
        // name-independent and always populated, so this is checked first and is
        // what actually lets you tell MICU/OVDG/regular ambulance apart at a
        // glance instead of every ambulance just being a bare number.
        const AMBULANCE_TYPE_ID_TO_ROLE = {
            16: { block: '1', label: 'AMB' },
            30: { block: '1', label: 'ZA' },
            37: { block: '1', label: 'MMT' },
            38: { block: '3', label: 'OVDG' },
            52: { block: '3', label: 'RR' },
            57: { block: '3', label: 'OVDG-RR' },
            63: { block: '3', label: 'RR' },
            100: { block: '4', label: 'GGB' },
            101: { block: '4', label: 'NHT' },
            102: { block: '1', label: 'MC' },
            103: { block: '3', label: 'MICU' },
        };
        const AMBULANCE_TYPE_RULES = [
            { block: '4', label: 'B-Amb', kw: ['b-ambulance', 'ziekenvervoer', 'bestelbus'] },
            { block: '3', label: 'RR', kw: ['rapid responder', 'solo', 'motor', 'micu', 'snelle interventie', 'bike'] },
            { block: '1', label: 'AMB', kw: [] },
        ];
        function classifyAmbulance(typeCaption, vehicleTypeId) {
            if (vehicleTypeId !== undefined && AMBULANCE_TYPE_ID_TO_ROLE[vehicleTypeId]) {
                return AMBULANCE_TYPE_ID_TO_ROLE[vehicleTypeId];
            }
            const norm = normalize(typeCaption);
            for (const r of AMBULANCE_TYPE_RULES) { if (r.kw.some((k) => norm.includes(k))) return r; }
            return AMBULANCE_TYPE_RULES[AMBULANCE_TYPE_RULES.length - 1];
        }

        /* ========================================================================
         * REFERENCE DATA — Politie. MD basisteam numbers are real (Politie
         * Midden-Nederland, district Oost-Utrecht); everywhere else falls back
         * to a generic-but-plausible "<eenheid> <team>.<seq> <rol>" pattern.
         * ==================================================================== */
        const POLICE_UNIT_ABBR = {
            '01': 'NN', '02': 'NN', '03': 'NN', '04': 'ON', '05': 'ON', '06': 'ON', '07': 'ON', '08': 'ON',
            '09': 'MD', '10': 'NH', '11': 'NH', '12': 'NH', '13': 'AM', '14': 'MD', '15': 'HR', '16': 'HR',
            '17': 'RN', '18': 'RN', '19': 'ZWB', '20': 'ZWB', '21': 'OB', '22': 'OB', '23': 'LI', '24': 'LI', '25': 'MD',
        };
        // Real basisteam numbers, Politie Midden-Nederland / district Oost-Utrecht
        const MD_BASISTEAMS = {
            'amersfoort': 31,
            'baarn': 32, 'eemland': 32, 'soest': 32,
            'zeist': 33, 'bunnik': 33, 'leusden': 33, 'woudenberg': 33,
            'veenendaal': 34, 'doorn': 34, 'heuvelrug': 34, 'wijk bij duurstede': 34,
        };

        /* ========================================================================
         * REFERENCE DATA — known real aircraft (trauma heli's & politiehelikopters)
         * These are exact and finite, matched by keyword in the building caption.
         * ==================================================================== */
        const KNOWN_AIRCRAFT = [];

        // Real ANWB Medical Air Assistance LifeLiner trauma heli registrations
        // (Airbus H135). Assigned in order per building via a counter, same
        // mechanism as POLICE_HELI_LIST, so a base with several LifeLiners gets
        // several distinct real tail numbers instead of one shared placeholder.
        const LIFELINER_MAIN_LIST = ['LifeLiner - PH-LLN', 'LifeLiner - PH-UMC', 'LifeLiner - PH-DOC', 'LifeLiner - PH-HIP', 'LifeLiner - PH-HLP'];
        const LIFELINER_MAIN_BUILDING_MATCH = /amsterdam.*heliport|vumc|\bamc\b|radboud|nijmeg|traumaheli|traumacentrum/i;
        // Wadden/patiëntenvervoer variant — separate pool for bases serving the
        // Waddeneilanden (e.g. "Vliegbasis Traumacentrum Zuidwest").
        const LIFELINER_WADDEN_LIST = ['Medic 01 - PH-OOP', 'PH-HOW'];
        const LIFELINER_WADDEN_BUILDING_MATCH = /wadden|zeeland|zuidwest/i;

        // Real Landelijke Eenheid politiehelikopter roepnamen. Source: forum.meldkamerspel.com
        // thread "roepnummers-landelijke-eenheid". One entry consumed per vehicle,
        // in order, via a per-building counter — so multiple heli's at the same
        // police-aviation building each get a distinct real tail number instead of
        // all sharing the single "PH-PXD - ZULU" placeholder used before.
        const POLICE_HELI_LIST = [
            'Zulu 80.11 - PH-PXA', 'Zulu 80.12 - PH-PXB', 'Zulu 80.13 - PH-PXC',
            'Zulu 80.14 - PH-PXD', 'Zulu 80.15 - PH-PXE', 'Zulu 80.16 - PH-PXF',
            'Zulu 80.24 - PH-PXX', 'Zulu 80.25 - PH-PXY', 'Zulu 80.26 - PH-PXZ',
        ];
        const POLICE_HELI_BUILDING_MATCH = /luchtvaartpolitie|politiehelikopter/i;

        /* ========================================================================
         * REFERENCE DATA — building_type -> discipline
         * Source: verified against the game's own nl_NL translation strings.
         * ==================================================================== */
        const BUILDING_TYPE_DISCIPLINE = {
            0: 'fire', 17: 'fire',
            3: 'ambulance', 13: 'ambulance',
            5: 'police', 11: 'police', 18: 'police',
            6: 'aviation', 9: 'aviation', 19: 'aviation', 21: 'aviation',
            22: 'rws',
            23: 'military',
            25: 'kmar',
            27: 'prorail',
        };
        function classifyDiscipline(buildingType) {
            return BUILDING_TYPE_DISCIPLINE[buildingType] || 'other';
        }

        /* ========================================================================
         * Manual overrides — put exact names you want here, keyed by vehicle id.
         * Always wins over everything else.
         * ==================================================================== */
        const MANUAL_VEHICLE_OVERRIDES = {
            // 123456: '09-5001 PM',

            // NOTE: the old 63-entry "known-good backup" list that used to live
            // here has been removed. It was captured back when vehicle_type_id
            // classification didn't exist yet, and — because manual overrides
            // always win — it was actively forcing those vehicles back to their
            // OLD (often wrong) names every scan, overriding the now-correct
            // vehicle_type-based classifier. E.g. vehicle 9825247 was locked to
            // "09-1801 DB" here even though its real vehicle_type_id (9) is
            // "TS 4/5". If you need to hard-lock a specific vehicle again, add
            // it below — but check it against the classifier first.
        };

        /* ========================================================================
         * NAME GENERATION ENGINE
         * ==================================================================== */

        function regioForBuilding(building) {
            const stripped = stripPrefix(normalize(building.caption));
            if (FIRE_BUILDING_ALIASES[stripped] && PLACE_TO_REGIO[FIRE_BUILDING_ALIASES[stripped]]) {
                return PLACE_TO_REGIO[FIRE_BUILDING_ALIASES[stripped]];
            }
            // exact place match first
            if (PLACE_TO_REGIO[stripped]) return PLACE_TO_REGIO[stripped];
            // then longest whole-word match (never a bare substring — "doorn" must not match inside "apeldoorn")
            let best = null;
            for (const place of Object.keys(PLACE_TO_REGIO)) {
                if (wordBoundaryIncludes(stripped, place) || wordBoundaryIncludes(place, stripped)) {
                    if (!best || place.length > best.length) best = place;
                }
            }
            return best ? PLACE_TO_REGIO[best] : CONFIG.DEFAULT_REGIO_CODE;
        }

        function getOrAssignPostNumber(regio, buildingId) {
            postNumbers[regio] = postNumbers[regio] || {};
            if (postNumbers[regio][buildingId]) return postNumbers[regio][buildingId];
            const used = new Set(Object.values(postNumbers[regio]));
            let n = 1;
            while (used.has(n) && n < 99) n++;
            postNumbers[regio][buildingId] = n;
            return n;
        }

        function nextSeq(seqKey) {
            seqCounters[seqKey] = (seqCounters[seqKey] || 0) + 1;
            return seqCounters[seqKey];
        }

        function findFireStationData(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const alias = FIRE_BUILDING_ALIASES[stripped];
            const tryKey = (dict) => {
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (nkey === stripped || (alias && nkey === alias)) return { list: dict[key], regio: dict === UTRECHT_FIRE_STATIONS ? '09' : '07' };
                }
                // whole-word fallback match (handles "Rhenen-Achterberg" -> "Rhenen" etc.,
                // but never lets "doorn" match inside "apeldoorn")
                let best = null;
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (wordBoundaryIncludes(stripped, nkey) || wordBoundaryIncludes(nkey, stripped)) {
                        if (!best || nkey.length > best.nkey.length) best = { key, nkey };
                    }
                }
                if (best) return { list: dict[best.key], regio: dict === UTRECHT_FIRE_STATIONS ? '09' : '07' };
                return null;
            };
            return tryKey(UTRECHT_FIRE_STATIONS) || tryKey(GELDERLAND_MIDDEN_FIRE_STATIONS) || null;
        }

        // Which exact target strings are already claimed by OTHER vehicles at this building?
        function claimedExactTargets(building, vehicles) {
            const claimed = new Set();
            for (const v of vehicles) {
                const a = assignments[v.id];
                if (a && a.exact && a.building === building.id) claimed.add(a.name);
            }
            return claimed;
        }

        // Returns null when the vehicle's role genuinely can't be worked out —
        // callers must leave that vehicle untouched rather than invent a name.
        function generateFireTarget(building, vehicle, regio, post, exactData, claimed) {
            const rule = classifyFireVehicle(resolveTypeCaption(vehicle), vehicle.caption || '', vehicle.vehicle_type);
            if (!rule) return null;

            if (exactData) {
                const targets = exactData.list.map((raw) => ({ raw, parsed: parseFireCallsign(raw) }));
                // Only ever take a real roepnummer whose role actually matches this
                // vehicle's classified role. Previously this fell back to grabbing
                // *any* leftover real entry regardless of role when none matched,
                // which is how a hoogwerker (HW) could end up wearing a real "DB"
                // callsign that actually belongs to a completely different vehicle.
                const pick = targets.find((t) => !claimed.has(t.raw) && t.parsed && t.parsed.typeDigit === rule.digit);
                if (pick) {
                    // IMPORTANT: only ever borrow the NUMBER from the reference
                    // data. The class/label (DB, TS, VEB, ...) always comes from
                    // what the game itself says this vehicle is (`rule`, derived
                    // from vehicle_type) — never from the reference list's own
                    // label text, which describes a DIFFERENT real vehicle that
                    // happens to share this digit slot, not this one. Pasting
                    // that label wholesale is exactly what caused e.g. a VEB
                    // vehicle to get labeled "MFT" and a TS to get labeled "DB".
                    const p = pick.parsed;
                    const label = rule.label ? ` ${rule.label}` : '';
                    return { name: `${p.regio}-${p.post}${p.typeDigit}${p.seq}${label}`, seqKey: null, exact: true };
                }
                // No real slot of the right role left (or this station's real list
                // simply has none of this role) -> fall through to a generated
                // name, same regio+post. Seed the counter so it continues numerically
                // after the real roepnummers for this role instead of restarting at 1
                // (avoids e.g. a fictional "5001 DB" next to the real "5001 PM").
            }
            const seqKey = `fire:${building.id}:${rule.digit}`;
            if (!(seqKey in seqCounters) && exactData) {
                seqCounters[seqKey] = exactData.list.filter((raw) => {
                    const p = parseFireCallsign(raw);
                    return p && p.typeDigit === rule.digit;
                }).length;
            }
            const seq = Math.min(nextSeq(seqKey), 9);
            const label = rule.label ? ` ${rule.label}` : '';
            return { name: `${regio}-${String(post).padStart(2, '0')}${rule.digit}${seq}${label}`, seqKey, exact: false };
        }

        function generateAmbulanceTarget(building, vehicle, regio) {
            const rule = classifyAmbulance(resolveTypeCaption(vehicle), vehicle.vehicle_type);
            const seqKey = `amb:${building.id}:${rule.block}`;
            const seq = nextSeq(seqKey);
            return { name: `${regio}-${rule.block}${String(seq).padStart(2, '0')} ${rule.label}`, seqKey, exact: false };
        }

        // Direct numeric vehicle_type -> role, same rationale as the fire/ambulance
        // tables: the type caption text is often empty or doesn't contain the
        // keyword the old text-scan looked for (e.g. "ME Flexbus" matched the
        // 'bus' keyword meant for arrestantenbussen and got labeled DB; "DM-Politie"
        // doesn't contain "motor" so it fell through to the generic "NH" default
        // along with several other real police types). Checked first, so every
        // vehicle_type below is name-independent and can't silently collapse to NH.
        const POLICE_TYPE_ID_TO_ROLE = {
            22: 'NH', 25: 'NH', 28: 'HELI', 35: 'OVD-P', 39: 'ME-CO', 40: 'ME-FB',
            46: 'DM-P', 47: 'HK9', 48: 'HK9', 58: 'DB', 59: 'NH-OV', 60: 'BIKE',
            64: 'ME-AE', 73: 'BER', 74: 'BER-AH', 98: 'SIV', 99: 'VOA',
            108: 'BRG-K', 109: 'BRG-G', 110: 'KMAR', 111: 'KMAR', 112: 'KMAR-M',
        };
        function generatePoliceTarget(building, vehicle) {
            const stripped = stripPrefix(normalize(building.caption));
            const regio = regioForBuilding(building);
            const unitAbbr = POLICE_UNIT_ABBR[regio] || 'PL';
            let teamNum = null;
            for (const [place, num] of Object.entries(MD_BASISTEAMS)) {
                // whole-word match only — plain .includes() let unrelated place
                // names collide (same class of bug as "doorn" matching inside
                // "apeldoorn" before).
                if (wordBoundaryIncludes(stripped, place)) { teamNum = num; break; }
            }
            const prefix = teamNum ? `${unitAbbr} ${teamNum}` : `${unitAbbr} ${getOrAssignPostNumber('police:' + regio, building.id) + 30}`;
            let role = POLICE_TYPE_ID_TO_ROLE[vehicle.vehicle_type];
            if (!role) {
                const typeNorm = normalize(resolveTypeCaption(vehicle));
                role = 'NH';
                if (typeNorm.includes('officier')) role = 'OVD-P';
                else if (typeNorm.includes('motor')) role = 'DM-P';
                else if (typeNorm.includes('bus') || typeNorm.includes('arrestant')) role = 'DB';
                else if (typeNorm.includes('hond')) role = 'HK9';
                else if (typeNorm.includes('paard')) role = 'BP';
            }
            // IMPORTANT: a real basisteam number (e.g. "MD 34") can cover MULTIPLE
            // physical buildings in this save (Doorn and Veenendaal are both team
            // 34) — the sequence must be shared across all of them, not restart at
            // .01 per building, or two different stations both produce "MD 34.01
            // NH". Only the auto-assigned fallback prefix is genuinely unique per
            // building, so that one can stay scoped to the building.
            const seqScope = teamNum ? `team:${unitAbbr}${teamNum}` : `building:${building.id}`;
            const seqKey = `pol:${seqScope}:${role}`;
            const seq = nextSeq(seqKey);
            return { name: `${prefix}.${String(seq).padStart(2, '0')} ${role}`, seqKey, exact: false };
        }

        function generateAviationTarget(building) {
            for (const ac of KNOWN_AIRCRAFT) {
                if (ac.match.test(building.caption)) return { name: ac.name, seqKey: null, exact: true, aviation: true };
            }
            if (POLICE_HELI_BUILDING_MATCH.test(building.caption)) {
                const seqKey = `heli:${building.id}`;
                const idx = nextSeq(seqKey) - 1;
                if (idx < POLICE_HELI_LIST.length) {
                    return { name: POLICE_HELI_LIST[idx], seqKey: null, exact: true, aviation: true };
                }
            }
            // Checked before LIFELINER_MAIN since a Wadden base's caption can also
            // contain "traumacentrum" (e.g. "Vliegbasis Traumacentrum Zuidwest").
            if (LIFELINER_WADDEN_BUILDING_MATCH.test(building.caption)) {
                const seqKey = `lifelinerw:${building.id}`;
                const idx = nextSeq(seqKey) - 1;
                if (idx < LIFELINER_WADDEN_LIST.length) {
                    return { name: LIFELINER_WADDEN_LIST[idx], seqKey: null, exact: true, aviation: true };
                }
            }
            if (LIFELINER_MAIN_BUILDING_MATCH.test(building.caption)) {
                const seqKey = `lifeliner:${building.id}`;
                const idx = nextSeq(seqKey) - 1;
                if (idx < LIFELINER_MAIN_LIST.length) {
                    return { name: LIFELINER_MAIN_LIST[idx], seqKey: null, exact: true, aviation: true };
                }
            }
            return null;
        }

        const ORG_CODE = { rws: 'RWS', prorail: 'PR', kmar: 'KMAR' };
        const OTHER_TYPE_LABEL = {
            81: 'DA-RWS', 82: 'DM-RWS', 83: 'DA-SIG', 104: 'BRG-K', 105: 'BRG-G',
            106: 'BRG-K', 107: 'BRG-G', 108: 'BRG-K', 109: 'BRG-G',
            110: 'DAT', 111: 'DB', 112: 'DM', 113: 'DAT-EOD', 114: 'DB-EOD', 115: 'VW-EOD',
            116: 'DB-EXH', 117: 'DB-EXD', 118: 'BA-DDG', 144: 'DB-ICB', 145: 'OVD-ICB',
            146: 'VW-VZ-ICB', 147: 'HA-ICB', 148: 'GM-ICB', 149: 'HSH-ICB', 150: 'VW-HS',
            151: 'BM-VTHS', 152: 'TS-SPOOR',
        };
        function generateGenericTarget(building, discipline, vehicle) {
            const code = ORG_CODE[discipline] || deriveStationCode(building);
            let label = OTHER_TYPE_LABEL[vehicle && vehicle.vehicle_type];
            if (!label && vehicle) label = (VEHICLE_TYPE_ID_MAP[vehicle.vehicle_type] || '').split(' | ')[0];
            // Counter is shared per org+label (not per building) so two sites of
            // the same org never both produce e.g. "RWS-1 DA-RWS".
            const seqKey = `gen:${discipline}:${label || building.id}`;
            const seq = nextSeq(seqKey);
            return { name: `${code}-${seq}${label ? ' ' + label : ''}`, seqKey, exact: false };
        }

        function computeTarget(building, vehicle, vehiclesAtBuilding) {
            if (MANUAL_VEHICLE_OVERRIDES[vehicle.id]) {
                return { name: MANUAL_VEHICLE_OVERRIDES[vehicle.id], seqKey: null, exact: true, manual: true };
            }
            const discipline = classifyDiscipline(building.building_type);
            if (discipline === 'fire') {
                const exactData = findFireStationData(building);
                // If this station has a known real post number, reuse it for any
                // overflow vehicles too (so they read as "the same station", not
                // as an unrelated auto-numbered one). Only fall back to an
                // auto-assigned post number when we have no real data at all.
                const realPost = exactData && exactData.list.length
                    ? (parseFireCallsign(exactData.list[0]) || {}).post
                    : null;
                const regio = exactData ? exactData.regio : regioForBuilding(building);
                const post = realPost || getOrAssignPostNumber(regio, building.id);
                const claimed = claimedExactTargets(building, vehiclesAtBuilding);
                return generateFireTarget(building, vehicle, regio, post, exactData, claimed);
            }
            if (discipline === 'ambulance') {
                const regio = regioForBuilding(building);
                return generateAmbulanceTarget(building, vehicle, regio);
            }
            if (discipline === 'police') {
                return generatePoliceTarget(building, vehicle);
            }
            if (discipline === 'aviation') {
                const aviationTarget = generateAviationTarget(building);
                if (aviationTarget) return aviationTarget;
                return generateGenericTarget(building, discipline, vehicle);
            }
            return generateGenericTarget(building, discipline, vehicle);
        }

        /* ========================================================================
         * UNIQUENESS
         * ==================================================================== */
        function countCaptions(vehicles) {
            const m = new Map();
            for (const v of vehicles) m.set(v.caption, (m.get(v.caption) || 0) + 1);
            return m;
        }
        // Keep a vehicle's current name when it already is the computed name
        // and no other vehicle has it; otherwise it would collide with itself.
        function keepOrUnique(name, vehicle, usedNames, captionCount) {
            if (name === vehicle.caption && captionCount.get(name) === 1) return name;
            return ensureUnique(name, usedNames);
        }

        function ensureUnique(name, usedNames) {
            if (!usedNames.has(name)) { usedNames.add(name); return name; }

            // For a real-format callsign ("NN-NNNN LABEL"), a collision should
            // count up the 4-digit number itself (0181 -> 0182 -> ...) so it still
            // reads as a real roepnummer, instead of tacking on an ugly "-2".
            const parsed = parseFireCallsign(name);
            if (parsed) {
                let n = Number(parsed.post + parsed.typeDigit + parsed.seq);
                for (let i = 0; i < 9000; i++) {
                    n++;
                    const numStr = String(n % 10000).padStart(4, '0');
                    const candidate = `${parsed.regio}-${numStr}${parsed.label ? ' ' + parsed.label : ''}`;
                    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
                }
            }

            // Same idea for the ambulance-style "NN-NNN LABEL" (3-digit) format.
            const parsedAmb = name.match(/^(\d{2})-(\d{3})\s+(.*)$/);
            if (parsedAmb) {
                let n = Number(parsedAmb[2]);
                for (let i = 0; i < 900; i++) {
                    n++;
                    const numStr = String(n % 1000).padStart(3, '0');
                    const candidate = `${parsedAmb[1]}-${numStr} ${parsedAmb[3]}`;
                    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
                }
            }

            // Fallback for anything not in real-callsign format.
            let n = 2;
            let candidate = `${name}-${n}`;
            while (usedNames.has(candidate) && n < 200) { n++; candidate = `${name}-${n}`; }
            usedNames.add(candidate);
            return candidate;
        }

        /* ========================================================================
         * GAME API
         * ==================================================================== */
        async function fetchWithTimeout(url, opts, timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs || CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        async function apiGet(path) {
            const res = await fetchWithTimeout(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }
        const getVehicles = () => apiGet('/api/vehicles');
        const getBuildings = () => apiGet('/api/buildings');
        const getVehicle = (id) => apiGet(`/api/vehicles/${id}`);

        /* ========================================================================
         * IN-GAME RENAME MECHANISM
         *
         * IMPORTANT: earlier versions injected the rename form into the live page
         * and clicked its submit button — turns out that form does a REAL
         * (non-AJAX) submit on meldkamerspel.com, which navigates/reloads the
         * whole page and kills the script's in-memory rename queue after the
         * very first vehicle. Fixed by never touching the live DOM at all: we
         * parse the fetched form fragment off-screen (DOMParser, not attached to
         * document), copy every field it has (CSRF token, Rails _method
         * override, etc.), swap in our new name, and POST it ourselves via
         * fetch(). fetch() never navigates the page no matter what the server
         * responds with, so the queue can never be interrupted this way again.
         * ==================================================================== */
        async function renameVehicleInGame(vehicleId, newName) {
            const trimmed = newName.slice(0, CONFIG.MAX_NAME_LENGTH);

            if (CONFIG.DRY_RUN) {
                log(`[DRY RUN] would rename vehicle ${vehicleId} -> "${trimmed}"`);
                return true;
            }

            log(`(${vehicleId}) fetching rename form...`);
            const html = await fetchWithTimeout(`/vehicles/${vehicleId}/editName`, { credentials: 'same-origin' }).then((r) => r.text());

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const form = doc.querySelector(`#vehicle_form_${vehicleId}`) || doc.querySelector('form');
            if (!form) {
                err(`(${vehicleId}) no <form> found in the fetched rename fragment. Raw HTML:`, html);
                return false;
            }

            const nameInput = form.querySelector(`#vehicle_new_name_${vehicleId}`)
                || form.querySelector('input[name*=caption]')
                || form.querySelector('input[name*=name]')
                || form.querySelector('input[type=text]');
            if (!nameInput || !nameInput.name) {
                err(`(${vehicleId}) no usable name <input> (with a "name" attribute) found. Form HTML:`, form.outerHTML);
                return false;
            }

            const action = form.getAttribute('action') || `/vehicles/${vehicleId}`;
            const url = new URL(action, location.origin);

            const body = new URLSearchParams();
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
                if (el === nameInput) return;
                if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
                body.append(el.name, el.value);
            });
            body.append(nameInput.name, trimmed);

            log(`(${vehicleId}) posting to ${url.pathname} ...`);
            let res;
            try {
                res = await fetchWithTimeout(url.toString(), {
                    method: 'POST', // Rails method-override (_method=patch) still physically POSTs
                    credentials: 'same-origin',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: body.toString(),
                });
            } catch (e) {
                err(`(${vehicleId}) rename POST failed/timed out`, e);
                return false;
            }
            if (!res.ok) {
                err(`(${vehicleId}) rename POST returned HTTP ${res.status}`);
                return false;
            }

            // Verify: re-fetch the vehicle and confirm the caption actually changed
            // server-side, rather than just trusting a 200 status.
            try {
                const fresh = await getVehicle(vehicleId);
                if (fresh && fresh.caption === trimmed) {
                    log(`(${vehicleId}) confirmed: caption is now "${trimmed}"`);
                    return true;
                }
                err(`(${vehicleId}) POST succeeded but caption is still "${fresh && fresh.caption}" (expected "${trimmed}") — the form field name may be wrong for this site version.`);
                return false;
            } catch (e) {
                warn(`(${vehicleId}) could not verify rename (network error on re-fetch), assuming it worked since POST returned OK`, e);
                return true;
            }
        }

        /* ========================================================================
         * MAIN ENGINE
         * ==================================================================== */
        const renameQueue = [];
        let queueRunning = false;
        let queueTotal = 0;
        let queueDone = 0;
        let queueFailed = 0;

        // What the dashboard shows. captionById is refreshed on every scan.
        const captionById = new Map();
        const planned = new Map();   // dry run: vehicleId -> { from, to }
        const recent = [];           // last renames: { id, from, to, at, ok }
        const stats = { vehicles: 0, lastScan: 0, scanning: false };

        function enqueueRename(vehicleId, name) {
            if (CONFIG.DRY_RUN) {
                planned.set(vehicleId, { from: captionById.get(vehicleId) || '', to: name });
                return;
            }
            if (renameQueue.some((q) => q.vehicleId === vehicleId)) return;
            renameQueue.push({ vehicleId, name });
            queueTotal++;
            if (!queueRunning) runQueue();
        }

        async function runQueue() {
            queueRunning = true;
            while (renameQueue.length) {
                const { vehicleId, name } = renameQueue.shift();
                setStatus(`Hernoemen ${queueDone + 1}/${queueTotal}: ${name}`, 'busy', [queueDone, queueTotal]);
                try {
                    const ok = await renameVehicleInGame(vehicleId, name);
                    recent.unshift({ id: vehicleId, from: captionById.get(vehicleId) || '', to: name, at: Date.now(), ok });
                    recent.length = Math.min(recent.length, 100);
                    if (ok) captionById.set(vehicleId, name);
                    if (ok) { log(`renamed vehicle ${vehicleId} -> "${name}"`); queueDone++; }
                    else { queueFailed++; }
                } catch (e) {
                    err(`failed to rename vehicle ${vehicleId}`, e);
                    queueFailed++;
                }
                ctx.refresh();
                await new Promise((r) => setTimeout(r, CONFIG.RENAME_THROTTLE_MS));
            }
            queueRunning = false;
            queueTotal = 0; queueDone = 0; queueFailed = 0;
            idleStatus();
            persistAll();
            ctx.refresh();
        }

        async function fullScan() {
            if (!hasMemory) return memoryMissing();
            if (stats.scanning) return;
            stats.scanning = true;
            setStatus('Controleren…', 'busy');
            if (CONFIG.DRY_RUN) planned.clear();
            try { await fullScanInner(); } finally { stats.scanning = false; }
            if (!queueRunning) idleStatus();
            ctx.refresh();
        }

        async function fullScanInner() {
            log('running full scan...');
            let vehicles, buildings;
            try {
                [vehicles, buildings] = await Promise.all([getVehicles(), getBuildings()]);
            } catch (e) {
                err('could not fetch /api/vehicles or /api/buildings', e);
                setStatus(`Kon voertuigen niet ophalen: ${e.message}`, 'error');
                return;
            }
            ovrLog = {}; // rebuilt fresh each full pass so fixed vehicles drop off the log

            const buildingsById = {};
            for (const b of buildings) buildingsById[b.id] = b;

            const vehiclesByBuilding = {};
            for (const v of vehicles) {
                (vehiclesByBuilding[v.building_id] = vehiclesByBuilding[v.building_id] || []).push(v);
            }

            // Self-heal: clear any persisted "exact" assignment whose role no longer
            // matches the vehicle's classified type. Fixes vehicles that were
            // mislabeled with an unrelated real callsign by the old "grab any
            // leftover real slot" fallback (e.g. a hoogwerker labeled "DB") — only
            // touches the specific vehicles actually affected, not the whole fleet.
            let mismatchFixed = 0;
            for (const vehicle of vehicles) {
                const a = assignments[vehicle.id];
                if (!a || !a.exact) continue;
                const building = buildingsById[vehicle.building_id];
                if (!building || classifyDiscipline(building.building_type) !== 'fire') continue;
                const parsed = parseFireCallsign(a.name);
                if (!parsed) continue;
                const rule = classifyFireVehicle(resolveTypeCaption(vehicle), vehicle.caption || '', vehicle.vehicle_type);
                if (rule && parsed.typeDigit !== rule.digit) {
                    delete assignments[vehicle.id];
                    mismatchFixed++;
                }
            }
            if (mismatchFixed) log(`cleared ${mismatchFixed} mismatched real-callsign assignment(s), will recompute below`);

            // Self-heal pass #2: any vehicle *currently named* with a leftover "OVR"
            // from an older version of this script gets its stored assignment wiped
            // so it's re-evaluated fresh below — this picks up the 63 known-good
            // vehicles via MANUAL_VEHICLE_OVERRIDES automatically. Anything else
            // that's genuinely unrecoverable (no manual override, no usable type
            // text) will show up in the unclassified log so you know it needs
            // attention rather than silently staying wrong forever.
            let ovrNamedFound = 0;
            for (const vehicle of vehicles) {
                if (/\bOVR(-\d+)?$/i.test(vehicle.caption || '')) {
                    ovrNamedFound++;
                    delete assignments[vehicle.id];
                }
            }
            if (ovrNamedFound) log(`found ${ovrNamedFound} vehicle(s) still named with a leftover "OVR" — re-evaluating them now`);

            const usedNames = new Set(vehicles.map((v) => v.caption));
            const captionCount = countCaptions(vehicles);
            captionById.clear();
            vehicles.forEach((v) => captionById.set(v.id, v.caption));
            stats.vehicles = vehicles.length;
            stats.lastScan = Date.now();

            let renameCount = 0;
            for (const building of buildings) {
                const vehiclesHere = (vehiclesByBuilding[building.id] || []).slice().sort((a, b) => a.id - b.id);
                for (const vehicle of vehiclesHere) {
                    const existing = assignments[vehicle.id];

                    // Already has a stable assignment and the in-game name matches it -> nothing to do.
                    if (existing && existing.name === vehicle.caption) continue;

                    let target;
                    if (existing) {
                        // Re-apply a previously computed assignment (self-healing).
                        // Still register it in usedNames — a reused assignment
                        // whose rename hasn't landed in-game yet wasn't otherwise
                        // accounted for, and a different vehicle computing a fresh
                        // name later in this same pass could collide with it.
                        target = existing;
                        usedNames.add(target.name);
                    } else {
                        target = computeTarget(building, vehicle, vehiclesHere);
                        if (!target) {
                            recordUnclassified(building, vehicle);
                            continue; // can't work out its role -> leave it exactly as-is
                        }
                        target.name = keepOrUnique(target.name, vehicle, usedNames, captionCount);
                        target.building = building.id;
                        assignments[vehicle.id] = target;
                    }

                    if (target.name !== vehicle.caption) {
                        enqueueRename(vehicle.id, target.name);
                        renameCount++;
                    }
                }
            }

            // Explicit final audit: guarantee no two vehicles ever end up sharing
            // a name, even if some path above missed a collision. Belt-and-braces
            // on top of the ensureUnique() checks during assignment above.
            const finalNameOwner = new Map(); // name -> vehicleId
            let duplicatesFixed = 0;
            for (const vehicle of vehicles) {
                const a = assignments[vehicle.id];
                const finalName = a ? a.name : vehicle.caption;
                const owner = finalNameOwner.get(finalName);
                if (owner === undefined) {
                    finalNameOwner.set(finalName, vehicle.id);
                } else if (owner !== vehicle.id) {
                    const fixed = ensureUnique(finalName, usedNames);
                    warn(`duplicate name "${finalName}" on vehicles ${owner} and ${vehicle.id} — reassigned the latter to "${fixed}"`);
                    assignments[vehicle.id] = { ...(a || {}), name: fixed, building: vehicle.building_id };
                    finalNameOwner.set(fixed, vehicle.id);
                    if (fixed !== vehicle.caption) { enqueueRename(vehicle.id, fixed); renameCount++; }
                    duplicatesFixed++;
                }
            }
            if (duplicatesFixed) log(`duplicate-name audit: found and fixed ${duplicatesFixed} collision(s)`);

            knownVehicleIds = vehicles.map((v) => v.id);
            persistAll();
            log(`full scan complete — ${renameCount} vehicle(s) queued for rename`);
            if (CONFIG.DEBUG) printOvrLog();
        }

        async function pollNewVehicles() {
            if (!hasMemory || stats.scanning) return;
            let vehicles;
            try {
                vehicles = await getVehicles();
            } catch (e) {
                err('poll: could not fetch /api/vehicles', e);
                return;
            }
            const known = new Set(knownVehicleIds);
            const fresh = vehicles.filter((v) => !known.has(v.id));
            if (!fresh.length) return;

            log(`found ${fresh.length} newly bought vehicle(s)`);
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('poll: could not fetch /api/buildings', e);
                return;
            }
            const buildingsById = {};
            for (const b of buildings) buildingsById[b.id] = b;

            const vehiclesByBuilding = {};
            for (const v of vehicles) {
                (vehiclesByBuilding[v.building_id] = vehiclesByBuilding[v.building_id] || []).push(v);
            }
            const usedNames = new Set(vehicles.map((v) => v.caption));
            const captionCount = countCaptions(vehicles);
            vehicles.forEach((v) => captionById.set(v.id, v.caption));
            stats.vehicles = vehicles.length;

            for (const vehicle of fresh) {
                const building = buildingsById[vehicle.building_id];
                if (!building) continue;
                const vehiclesHere = (vehiclesByBuilding[building.id] || []).sort((a, b) => a.id - b.id);
                const target = computeTarget(building, vehicle, vehiclesHere);
                if (!target) { recordUnclassified(building, vehicle); continue; }
                target.name = keepOrUnique(target.name, vehicle, usedNames, captionCount);
                target.building = building.id;
                assignments[vehicle.id] = target;
                if (target.name !== vehicle.caption) enqueueRename(vehicle.id, target.name);
            }

            knownVehicleIds = vehicles.map((v) => v.id);
            persistAll();
            if (CONFIG.DEBUG) printOvrLog();
            ctx.refresh();
        }

        /* ========================================================================
         * DASHBOARD
         * ==================================================================== */
        function setStatus(text, tone = 'idle', progress) {
            // Only busy/error states go to the dock; idle stays in the dashboard.
            ctx.status(text, { tone, progress, dock: tone === 'busy' || tone === 'error' });
            if (CONFIG.DEBUG) log('status:', text);
        }

        function idleStatus() {
            if (!hasMemory) return memoryMissing();
            const unknown = Object.keys(ovrLog).length;
            const when = stats.lastScan ? new Date(stats.lastScan).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
            setStatus(`${stats.vehicles} voertuigen in orde · controle ${when}${unknown ? ` · ${unknown} onbekend` : ''}`, unknown ? 'warn' : 'ok');
        }

        function memoryMissing() {
            setStatus('Wacht: geheugen van het oude script ontbreekt', 'warn');
        }

        const esc = ctx.esc;
        const table = (head, rows) => `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        const vLink = (id, text) => `<a href="/vehicles/${id}" target="_blank">${esc(text)}</a>`;

        ctx.panel((el) => {
            const unknown = Object.values(ovrLog);
            const failed = recent.filter((r) => !r.ok).length;
            let html = `<h4 class="mks-h">Stand</h4><div class="mks-tiles">
                <div class="mks-tile"><div class="v">${ctx.nl(stats.vehicles)}</div><div class="k">voertuigen</div></div>
                <div class="mks-tile"><div class="v">${renameQueue.length}</div><div class="k">in wachtrij</div></div>
                <div class="mks-tile"><div class="v">${recent.filter((r) => r.ok).length}</div><div class="k">hernoemd (deze sessie)</div></div>
                <div class="mks-tile ${failed ? 't-error' : ''}"><div class="v">${failed}</div><div class="k">mislukt</div></div>
                <div class="mks-tile ${unknown.length ? 't-warn' : ''}"><div class="v">${unknown.length}</div><div class="k">rol onbekend</div></div>
            </div>`;

            if (recent.length) {
                html += '<h4 class="mks-h">Laatst hernoemd</h4>' + table(['Tijd', 'Was', 'Nu', ''], recent.slice(0, 50).map((r) => `<tr>
                    <td class="mono">${new Date(r.at).toLocaleTimeString('nl-NL')}</td><td>${esc(r.from)}</td><td>${vLink(r.id, r.to)}</td>
                    <td>${r.ok ? '<span class="mks-pill t-ok">ok</span>' : '<span class="mks-pill t-error">mislukt</span>'}</td></tr>`));
            }

            if (unknown.length) {
                html += `<h4 class="mks-h">Rol onbekend (${unknown.length})</h4>
                    <p class="mks-note">Deze voertuigen blijven ongemoeid: hun type kon niet aan een rol gekoppeld worden.
                    Kopieer de lijst en geef hem aan Claude om ze toe te voegen.</p>`
                    + table(['Voertuig', 'Gebouw', 'Type', 'Type-id'], unknown.map((u) => `<tr><td>${vLink(u.vehicleId, u.currentName)}</td>
                        <td>${esc(u.building)}</td><td>${esc(u.typeCaption)}</td><td class="mono">${esc(u.vehicleTypeId)}</td></tr>`));
            }
            el.innerHTML = html;
        });

        if (hasMemory) {
            ctx.actions([
                { label: 'Nu controleren', kind: 'primary', run: () => fullScan(), title: 'Alle voertuigen nalopen' },
                { label: 'Kopieer onbekende (JSON)', run: async () => {
                    const text = JSON.stringify(Object.values(ovrLog), null, 2);
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
            ]);
        }

        // Proefdraaien toggled: rescan so the preview (or the real renames)
        // follows right away. New timings apply after a reload.
        ctx.onSettings(() => {
            {
                idleStatus();
            }
        });

        /* ========================================================================
         * BOOT
         * ==================================================================== */
        log('starting — DRY_RUN =', CONFIG.DRY_RUN);
        if (!hasMemory) {
            memoryMissing();
            return;
        }
        fullScan();
        setInterval(pollNewVehicles, CONFIG.POLL_NEW_VEHICLES_MS);
        setInterval(fullScan, CONFIG.FULL_RESCAN_MS);
    },
});
