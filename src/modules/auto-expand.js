MKS.module({
    id: 'auto-expand',
    name: 'Automatisch uitbreiden',
    short: 'Uitbreiden',
    icon: '🏗️',
    category: 'auto',
    description: 'Geeft je credits uit aan wat Automatisch alarmeren tekortkomt: eerst speciale voertuigen, daarna gewone. '
        + 'Koopt voertuigen in het gebouw dat het dichtst bij de inzetten ligt waar ze misten, koopt daarvoor de nodige uitbreiding '
        + 'of een hoger level als de parkeerplaatsen vol zijn, en bouwt een nieuw gebouw op een echte post (Plaatsingsadvies) als er '
        + 'in de buurt geen geschikt gebouw is. Ook: ziekenhuisafdelingen en cellen die tekortkwamen, en personeelswerving op '
        + 'automatisch met doel 300 in elk gebouw. Koopt nooit een voertuig zonder opgeleid personeel ervoor, '
        + 'betaalt nooit met coins en houdt altijd je buffer over. Eén aankoop tegelijk.',
    tagline: 'Gebruikt de tekortlijst van Automatisch alarmeren',
    warning: '<b>Dit geeft je credits uit, zonder dat jij elke aankoop ziet.</b> Gebouwen, uitbreidingen, levels en voertuigen '
        + 'kosten veel en zijn niet terug te draaien. Het houdt altijd de buffer over (standaard 100.000, instelbaar) en betaalt nooit met coins. '
        + 'Elke aankoop staat in het logboek. Automatisch spelen kan tegen de spelregels zijn; je account is je eigen risico.',
    confirmOn: 'Let op: deze module koopt automatisch gebouwen, uitbreidingen, levels en voertuigen met je credits.\n\n'
        + 'Dat kan niet ongedaan worden gemaakt. Het houdt je buffer over en gebruikt nooit coins.\n\nAanzetten?',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Op de kaartpagina',
    live: true,
    settings: [
        // Same keys as before, so saved values stay; only order, groups and texts changed.
        { group: 'Geld', key: 'buffer', label: 'Buffer (nooit uitgeven)', type: 'number', default: 100000, min: 0, max: 100000000, step: 10000, unit: 'credits',
            help: 'Zoveel blijft altijd staan. 0 = alles mag op.' },
        { group: 'Geld', key: 'intervalMin', label: 'Eén aankoop per', type: 'number', default: 3, min: 1, max: 120, step: 1, unit: 'min' },

        { group: 'Wat het mag kopen', key: 'doVehicles', label: 'Voertuigen', type: 'bool', default: true },
        { group: 'Wat het mag kopen', key: 'doExtensions', label: 'Uitbreidingen', type: 'bool', default: true },
        { group: 'Wat het mag kopen', key: 'doLevels', label: 'Levels en kleine posten vergroten', type: 'bool', default: true,
            help: 'Meer parkeerplaatsen. Een kleine post wordt een gewone post (24 uur) als hij vol is, '
                + 'of als een uitbreiding daar niet lukte omdat hij klein is.' },
        { group: 'Wat het mag kopen', key: 'doBuild', label: 'Nieuwe gebouwen', type: 'bool', default: true,
            help: 'Op een echte post (Plaatsingsadvies): voor tekorten als er in de buurt geen geschikt gebouw is, en om te groeien. '
                + 'Uit = nooit een nieuw gebouw, behalve in Bouwmodus.' },

        { group: 'Groeien', key: 'doGrow', label: 'Nieuwe posten in lege gebieden', type: 'bool', default: true,
            help: 'Een brandweerkazerne, politiebureau of ambulancepost op de vrije echte post die het dichtst bij je gebouwen ligt '
                + '(minstens 3 km van je andere van die soort). Meer gebouwen = meer inzetten. Waarde = je gemiddelde weekinkomen per gebouw. '
                + 'Alleen als "Nieuwe gebouwen" aan staat.' },
        { group: 'Groeien', key: 'buildMode', label: 'Bouwmodus: vooral nieuwe posten', type: 'bool', default: false,
            help: 'Bouwt de ene nieuwe post na de andere, zodra er geld is (brandweer, politie en ambulance om de beurt), en maakt elke post af: '
                + 'brandweer level 2 met een TST 4/5, ambulancepost level 1 met een ambulance, politie met noodhulp; de rest van de plekken '
                + 'naar het grootste tekort dat er past. Tekorten en opleidingen wachten zolang. Werkt ook als "Nieuwe gebouwen" uit staat.' },
        { group: 'Groeien', key: 'buildCity', label: 'Bouwmodus: stad', type: 'text', default: '', placeholder: 'bijv. Utrecht',
            help: 'Leeg = overal. Met een stad: eerst alle vrije echte posten in die stad, het dichtst bij het centrum eerst. '
                + 'Is de stad vol, dan gaat het verder rond je andere gebouwen.' },

        { group: 'Personeel', key: 'doHire', label: 'Werving op automatisch zetten', type: 'bool', default: true },
        { group: 'Personeel', key: 'hireTarget', label: 'Doel per gebouw', type: 'number', default: 300, min: 0, max: 1000, step: 10, unit: 'mensen' },

        { advanced: true, key: 'minMissions', label: 'Pas kopen na zoveel gemiste inzetten', type: 'number', default: 2, min: 1, max: 50, step: 1,
            help: 'Een voertuigsoort komt pas in aanmerking als die zo vaak in de tekortlijst van Automatisch alarmeren staat.' },
        { advanced: true, key: 'specialWeight', label: 'Voorrang speciale voertuigen', type: 'number', default: 3, min: 1, max: 10, step: 1,
            help: 'Zoveel keer zwaarder dan tankautospuiten, ambulances en noodhulp, bij hetzelfde aantal gemiste inzetten.' },
        { advanced: true, key: 'unlockWeight', label: 'Nieuwe meldingen: keer per week', type: 'number', default: 1, min: 0, max: 20, step: 0.5,
            help: 'Een gebouw of uitbreiding die nieuwe meldingsoorten vrijspeelt telt hun gemiddelde credits zoveel keer per week. 0 = niet.' },
        { advanced: true, key: 'nearKm', label: 'Gebouw telt als "in de buurt" tot', type: 'number', default: 15, min: 2, max: 100, step: 1, unit: 'km',
            help: 'Van het midden van de inzetten waar het voertuig miste. Verder weg: een nieuw gebouw (als dat mag).' },
        { advanced: true, key: 'planDepth', label: 'Opties vergelijken per stap', type: 'number', default: 6, min: 1, max: 15, step: 1,
            help: 'Zoveel van de waardevolste tekorten worden uitgewerkt; de stap met de meeste credits per uitgegeven credit wint.' },
        { advanced: true, key: 'groupMax', label: 'Gebouwen per opleiding', type: 'number', default: 5, min: 1, max: 10, step: 1,
            help: 'Eén opleiding kan meerdere gebouwen tegelijk een voertuig geven: de gebouwen die het dichtst liggen bij de meeste plekken waar het miste.' },
        { advanced: true, key: 'trainSeats', label: 'Plaatsen per opleiding', type: 'number', default: 10, min: 1, max: 10, step: 1,
            help: 'Eerst personeel van de gebouwen die het voertuig krijgen. Een klas start pas met alle plaatsen bezet: de rest gaat naar vrij personeel '
                + 'van gebouwen die dat voertuig kunnen hebben (dichtstbij eerst), daarna van andere gebouwen.' },
    ],

    run(ctx) {
        const W = ctx.W;
        const esc = ctx.esc;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
        const NEEDS_KEY = 'mks.autoDispatch.needs.v1';
        const STATE_KEY = 'mks.autoExpand.state.v1';
        const LOCK_KEY = 'mks-auto-expand.lock';
        const DATA_BASE = '{{DATA_BASE}}';
        const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const STARTED = Date.now();

        /* ========================================================================
         * VEHICLE TYPES (LSSM data): id: [name, credits, min crew, building types,
         * training, rule, max crew]. rule "all" = the whole crew needs that training. "?" =
         * the training is not known: such a vehicle is never bought.
         * ==================================================================== */
        const VT = {
            0: ["SI-2", 5000, 1, [0,17], null, null, 2], 1: ["TS 8/9", 5000, 1, [0,17], null, null, 9],
            2: ["Autoladder", 10000, 1, [0,17], null, null, 3], 3: ["DA - Officier van Dienst", 10000, 1, [0,17], null, null, 1],
            4: ["Hulpverleningsvoertuig", 12180, 1, [0,17], null, null, 3],
            5: ["Adembeschermingsvoertuig", 11680, 1, [0,17], null, null, 3], 6: ["TST 8/9", 5000, 1, [0,17], null, null, 9],
            7: ["TST 6/7", 5000, 1, [0,17], null, null, 7], 8: ["TST 4/5", 5000, 1, [0,17], null, null, 5],
            9: ["TS 4/5", 5000, 1, [0,17], null, null, 5], 10: ["Slangenwagen", 17300, 1, [0,17], null, null, 9],
            11: ["Verkenningseenheid Brandweer", 18300, 1, [0,17], "Verkenningseenheid Brandweer", "all", 4],
            12: ["TST-NB 8/9", 5000, 1, [0,17], null, null, 9], 14: ["TST-NB 6/7", 5000, 1, [0,17], null, null, 7],
            15: ["TST-NB 4/5", 5000, 1, [0,17], null, null, 5], 16: ["Ambulance", 5000, 1, [0,3,13,17], null, null, 2],
            17: ["TS 6/7", 5000, 1, [0,17], null, null, 7], 18: ["Hoogwerker", 10000, 1, [0,17], null, null, 3],
            19: ["DA - Hoofdofficier van Dienst", 25500, 1, [0,17], "Hoofd Officier van Dienst - Brandweer", "all", 1],
            20: ["DA", 2000, 1, [0,17], null, null, 4], 21: ["DB Klein", 2500, 1, [0,17], null, null, 9],
            22: ["DA Noodhulp", 5000, 1, [5,18], null, null, 2], 23: ["Lifeliner", 500000, 1, [6], "MMT-Bemanningslid", "all", 4],
            24: ["DA - Adviseur Gevaarlijke stoffen", 19200, 1, [0,17], "Adviseur Gevaarlijke Stoffen", "all", 2],
            25: ["DB Noodhulp", 6000, 1, [5,18], null, null, 2],
            26: ["Haakarmvoertuig", 5000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            27: ["Adembeschermingshaakarmbak", 6000, 0, [0,17], null, null, 0],
            28: ["Politiehelikopter", 300000, 1, [9], "Politiehelikopter", "all", 3],
            29: ["Watertankhaakarmbak", 6000, 0, [0,17], null, null, 0], 30: ["Zorgambulance", 5000, 1, [0,3,13,17], null, null, 2],
            31: ["Commandovoertuig", 27500, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            32: ["Commandohaakarmbak", 6000, 0, [0,17], null, null, 0],
            33: ["Waterongevallenvoertuig", 10000, 4, [0,17], "Duiker/Duikploegleider", "all", 6],
            34: ["Watertankwagen", 17000, 1, [0,17], null, null, 3],
            35: ["Officier van Dienst - Politie", 10000, 1, [11], "Officier van Dienst - Politie", "all", 1],
            36: ["Waterongevallenaanhanger", 9000, 0, [0,17], null, null, 0],
            37: ["MMT-Auto", 30000, 1, [6], "MMT-Bemanningslid", "all", 4],
            38: ["Officier van Dienst - Geneeskunde", 25000, 1, [3,6,13], "Officier van Dienst Geneeskunde", "all", 1],
            39: ["ME Commandovoertuig", 10000, 2, [11], "Mobiele Eenheid", "all", 4],
            40: ["ME Flexbus", 10000, 4, [11], "Mobiele Eenheid", "all", 8],
            41: ["Crashtender (8x8)", 60000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            42: ["Crashtender (6x6)", 40000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            43: ["Crashtender (4x4)", 15000, 2, [0,17], "Vliegtuigbrandbestrijding", "all", 3],
            44: ["Airport Fire Officer / On Scene Commander", 12000, 1, [0,17], "Airport Fire Officer / On Scene Commander", "all", 2],
            45: ["Dompelpomphaakarmbak", 6000, 0, [0,17], null, null, 0], 46: ["DM-Politie", 15000, 1, [5,18], "Motoragent", "all", 1],
            47: ["DA Hondengeleider", 8000, 1, [11], "Hondengeleider", "all", 2],
            48: ["DB Hondengeleider", 10000, 1, [11], "Hondengeleider", "all", 2],
            49: ["PM-OR", 10000, 4, [0,17], "Oppervlakteredder", "all", 9],
            50: ["TS-OR", 10000, 4, [0,17], "Oppervlakteredder", "all", 9],
            51: ["HulpverleningsHaakarmbak", 6000, 0, [0,17], null, null, 0],
            52: ["Rapid Responder", 2500, 1, [0,3,13,17], null, null, 1],
            53: ["AT-Commandant", 10000, 1, [11], "Operator AT", "all", 2],
            54: ["AT-Operator", 10000, 2, [11], "Operator AT", "all", 4],
            55: ["AT-Materiaalwagen", 15000, 1, [11], "Operator AT", "all", 2],
            56: ["DA Voorlichter", 15000, 1, [0,17], "Voorlichter", "all", 1],
            57: ["DA Officier van Dienst - Geneeskundig / Rapid Responder", 25000, 1, [3,6,13], "Officier van Dienst Geneeskunde", "all", 1],
            58: ["DB Arrestantenvervoer", 20000, 1, [11], null, null, 2],
            59: ["Noodhulp - Onopvallend", 6000, 1, [5,18], null, null, 2], 60: ["DB Biketeam", 8000, 1, [5,18], "Biketeam", "all", 2],
            61: ["Slangenhaakarmbak", 6000, 0, [0,17], null, null, 0], 62: ["TS-HV", 20000, 3, [0,17], null, null, 7],
            63: ["DM - Rapid Responder", 2500, 1, [0,3,13,17], null, null, 1],
            64: ["ME Aanhoudingseenheid", 20000, 6, [11], "ME - Aanhoudingseenheid", "all", 8],
            65: ["DA Terreinwaardig - Reddingsbrigade", 7500, 2, [16], "Waterredding", "all", 4],
            66: ["Kusthulpverleningsvoertuig", 8000, 2, [16], "Waterredding", "all", 6],
            67: ["Bootaanhanger Reddingsbrigade", 5000, 0, [16], null, null, 0],
            68: ["SB", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3], 69: ["SBH", 10000, 0, [0,17], null, null, 0],
            70: ["SBA", 15000, 0, [0,17], null, null, 0], 71: ["MSA", 10000, 0, [0,17], null, null, 0],
            72: ["DPA", 15000, 0, [0,17], null, null, 0],
            73: ["Vrachtwagen - Bereden Brigade", 35000, 1, [11], "Bereden Brigade", "all", 4],
            74: ["Bereden Brigade Aanhanger", 15000, 0, [11], "Bereden Brigade", "all", 0],
            75: ["Dienstauto terreinvaardig - Noodhulp", 10000, 1, [11], null, null, 2],
            76: ["Quad", 5000, 1, [16], "Waterredding", "all", 1], 77: ["KW-boot", 50000, 2, [19], "Groot vaarbewijs", 1, 6],
            78: ["RB-K", 35000, 2, [16,19], "Groot vaarbewijs", "all", 4],
            79: ["RB-G", 45000, 2, [16,19], "Groot vaarbewijs", "all", 6],
            80: ["SAR-heli", 300000, 2, [21], "SAR Helicopter", "all", 3], 81: ["DA-RWS", 25000, 1, [22], "Weginspecteur", "all", 2],
            82: ["DM-RWS", 15000, 1, [22], "Weginspecteur", "all", 1], 83: ["DA-SIG", 25000, 1, [0,17], "Weginspecteur", "all", 2],
            84: ["Waterwerper", 50000, 4, [11], "ME - Waterwerper", "all", 4],
            85: ["FBO-Heli", 300000, 2, [23], "Fire Bucket Operator", "all", 3],
            86: ["DB-Handcrew", 30000, 7, [0,17], "Handcrew", "all", 9],
            87: ["DA-LA-NB", 30000, 1, [0,17], "Landelijk Adviseur Natuurbranden", "all", 1],
            88: ["VW-NB", 12000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 2], 89: ["NBH", 12000, 0, [0,17], null, null, 0],
            90: ["TS-STH", 25000, 7, [0,17], "Teamleider STH", 2, 7], 91: ["HVH-STH", 6000, 0, [0,17], null, null, 0],
            92: ["DB-USAR", 8000, 5, [0,17], "Teamlid USAR", "all", 9], 93: ["TS-USAR", 10000, 4, [0,17], "Teamlid USAR", "all", 9],
            94: ["VW-USAR", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 2],
            95: ["DM-USAR", 5000, 1, [0,17], "Teamlid USAR", "all", 1], 96: ["Quad-USAR", 5000, 1, [0,17], "Teamlid USAR", "all", 2],
            97: ["DB–Speurhonden", 10000, 2, [0,17], "Hondengeleider USAR", "all", 4],
            98: ["SIV-P", 35000, 1, [5,18], "Chauffeur Dienst Infra", "all", 2],
            99: ["DB-VOA", 50000, 1, [5,18], "Verkeersongevallen Analist", "all", 2],
            100: ["GGB", 45000, 6, [0,3,13], "Geneeskundige bijstandsverlener", "all", 6],
            101: ["NHT", 15000, 4, [0,3,13], "Noodhulpteam", "all", 8], 102: ["MC-Ambulance", 5000, 2, [3,13], null, null, 2],
            103: ["MICU", 30000, 3, [3,13], "Intensive Care Team", "all", 3],
            104: ["Berger-K", 25000, 1, [24], "Berger Training", "all", 2],
            105: ["Berger-G", 50000, 1, [24], "Berger Training", "all", 2],
            106: ["Berger-K (RWS)", 25000, 1, [22], "Berger Training", "all", 2],
            107: ["Berger-G (RWS)", 50000, 1, [22], "Berger Training", "all", 2],
            108: ["Berger-K (Politie)", 25000, 1, [5,18], "Berger Training", "all", 2],
            109: ["Berger-G (Politie)", 50000, 1, [5], "Berger Training", "all", 2],
            110: ["DAT-KMAR", 10000, 1, [25], "Marechaussee", "all", 2], 111: ["DB-KMAR", 10000, 1, [25], "Marechaussee", "all", 2],
            112: ["DM-KMAR", 10000, 1, [25], "Marechaussee", "all", 1], 113: ["DAT-EOD", 40000, 1, [25], "Bomontmanteling", "all", 2],
            114: ["DB-EOD", 45000, 2, [25], "Bomontmanteling", "all", 2], 115: ["VW-EOD", 45000, 2, [25], "Bomontmanteling", "all", 2],
            116: ["DB-Explosievenhonden", 40000, 2, [25], "Hondengeleider EOD", "all", 2],
            117: ["DB-Explosievenduikers", 30000, 2, [25], "Duiker Defensie", "all", 2], 118: ["BA-DDG", 15000, 0, [25], null, null, 0],
            119: ["DB-TEV", 25000, 1, [5,18], "Bomverkenner", "all", 1], 120: ["DB-VZ", 12000, 2, [0,17], "Verzorger", "all", 4],
            121: ["VZH", 12000, 0, [0,17], null, null, 0], 122: ["DB-AH", 12000, 2, [0,17], "Hygiënemedewerker", "all", 4],
            123: ["VZH-AH", 12000, 0, [0,17], null, null, 0],
            124: ["DB-PC-LOG", 40000, 1, [0,17], "Pelotonscommandant Logistiek", "all", 1],
            125: ["DB-LOG", 10000, 1, [0,17], null, null, 3], 126: ["VW-LOG", 15000, 1, [0,17], null, null, 3],
            127: ["BMH-LOG", 6000, 0, [0,17], null, null, 0], 128: ["DB-DRONE", 60000, 3, [11], "Drone Flightcrew", "all", 3],
            129: ["DB-TDV", 60000, 3, [0,17], "TDV Drone Flightcrew", "all", 3],
            130: ["SB-BA", 45000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            131: ["SB-IB", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            132: ["AS", 35000, 2, [0,17], "Brandweerchauffeur-zwaar", "all", 3],
            133: ["TS-IB", 35000, 1, [0,17], "Brandweerchauffeur-zwaar", "all", 7], 134: ["GSH", 12000, 0, [0,17], null, null, 0],
            135: ["DB-GS", 35000, 4, [0,17], "Gevaarlijke Stoffen Eenheid", "all", 6], 136: ["GPH", 12000, 0, [0,17], null, null, 0],
            137: ["DB-GP", 35000, 4, [0,17], "Gevaarlijke Stoffen Eenheid", "all", 6], 138: ["BOH-DC", 35000, 0, [0,17], null, null, 0],
            139: ["TS-BO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 7],
            140: ["DB-BO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 8], 141: ["GOH-DC", 35000, 0, [0,17], null, null, 0],
            142: ["TS-GO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 7],
            143: ["DB-GO", 35000, 6, [0,17], "Ontsmettings Eenheid", "all", 8],
            144: ["DB-ICB", 12000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            145: ["OvD-ICB", 25000, 1, [0,17,27], "Officier van Dienst Incidentenbestrijder spoor", "all", 1],
            146: ["VW-VZ-ICB", 15000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            147: ["HA-ICB", 6000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            148: ["GM-ICB", 6000, 1, [0,17,27], "Brandweerchauffeur-zwaar", "all", 2],
            149: ["HSH-ICB", 10000, 1, [0,17,27], null, null, 2],
            150: ["VW-HS", 15000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            151: ["BM-VTHS", 40000, 2, [0,17], null, null, 8],
            152: ["TS-Spoor", 25000, 1, [0,17,27], "Incidentenbestrijder spoor", "all", 2],
            153: ["DB-RI", 25000, 2, [0,17], "?", "all", 6], 154: ["RIA", 6000, 0, [0,17], null, null, 0],
            155: ["DB-VI", 25000, 4, [0,17], "?", "all", 6], 156: ["VIA", 6000, 0, [0,17], null, null, 0],
        };
        // Plain vehicles: fire engines, ambulances, police cars. Specialist ones weigh more.
        const PLAIN = new Set([0, 1, 6, 7, 8, 9, 12, 14, 15, 17, 16, 22, 25, 59, 75, 20, 21]);
        const norm = (s) => String(s).toLowerCase().replace(/\s+[-–]\s+/g, ' ').replace(/\s+/g, ' ').replace(/^(een|elke)\s+/, '').trim();
        // Names the game uses in shortages ("Niet beschikbaar: 1 X") and row captions -> type to buy.
        const ALIAS = {
            'tankautospuit': 1, 'tankautospuiten': 1, 'ts': 1, 'officier van dienst brandweer': 3, 'da-ovd': 3, 'ovd-b': 3,
            'hoofdofficier van dienst brandweer': 19, 'hoofd officier van dienst': 19, 'da-hod': 19, 'hovd': 19,
            'commandovoertuig of haakarmbak': 31, 'commandowagen': 31, 'co': 31, 'redvoertuig': 18, 'hw': 18, 'al': 2,
            'hv of ts-hv': 4, 'hv': 4, 'hulpverleningsvoertuig': 4, 'slangenwagen': 10, 'sl': 10, 'wt': 34,
            'adembeschermingsvoertuig of haakarmbak': 5, 'ab': 5, 'dienstbus verkenningseenheid brandweer': 11, 'verkenningseenheid': 11, 'db-veb': 11,
            'adviseur gevaarlijke stoffen': 24, 'da-ags': 24, 'voorlichters': 56, 'voorlichter': 56, 'da-vl': 56,
            'ambulance voertuigen': 16, 'ambulance': 16, 'amb': 16, 'noodhulpeenheden': 22, 'noodhulpeenheid': 22, 'nh': 22, 'da noodhulp': 22,
            'officier van dienst politie': 35, 'ovd-p': 35, 'politiehelikopter': 28, 'kmar eenheden': 110, 'kmar eenheid': 110,
            'db-bike': 60, 'biketeam': 60, 'dm-p': 46, 'police horses': 73, 'vw-bb of bb-a': 73, 'hondengeleider': 47, 'me flexbus': 40,
            'me commandovoertuig': 39, 'aanhoudingseenheid': 64, 'dienstbus arrestantenvervoer': 58, 'db-av': 58, 'db arrestantenvervoer': 58,
            'ovd-g': 38, 'officier van dienst geneeskunde': 38, 'mmt-auto of lifeliner': 37, 'ggb': 100, 'nht': 101,
            'verzorgingseenheid': 120, 'verzorger': 120, 'signalisatie voertuig (da-rws, da-sig of dm-rws)': 83,
            'signalisatie voertuigen': 83, 'signalisatievoertuig': 83, 'tankautospuiten (terreinvaardig)': 6, 'schuimblusvoertuig': 130,
            'me flexbussen': 40, 'natuurbrandbestrijding uitrusting': 88, 'natuurbrandbestrijding vrachtwagen of haakarmbak': 88, 'bootaanhanger (woa of ba-rb)': 67, 'at materiaalwagens': 55,
            'strandvoertuigen (quad, dat-rb of khv)': 65, 'bereden brigade (paarden)': 73, 'politie helikopters': 28, 'politie helikopter': 28,
            'dienstvoertuigen usar': 92, 'politie noodhulp': 22, 'me-ae': 64, 'vw-bb': 73, 'bb-a': 74,
        };
        const BY_NAME = {};
        for (const [id, v] of Object.entries(VT)) BY_NAME[norm(v[0])] = Number(id);
        // Shortage name -> every vehicle type it can mean, in order. "DB-RI of RIA" and
        // "DB-GO, TS-GO of GOH-DC" name alternatives; "Een Berger-K" also matches the
        // variants "Berger-K (RWS)" and "Berger-K (Politie)". planVehicle picks the one
        // the player has a building for.
        const STOP = new Set(['politie', 'brandweer', 'voertuig', 'eenheid', 'of', 'en', 'een', 'de', 'het', 'van']);
        const singular = (w) => w.replace(/heden$/, 'heid').replace(/'s$/, '').replace(/(?<=[a-z]{3})(en|s)$/, '');
        function vehiclesFor(name) {
            const out = [];
            const add = (id) => { if (id != null && !out.includes(id)) out.push(id); };
            const n = norm(name).replace(/\(s\)/g, '');
            const parts = [n, ...n.split(/,\s*|\s+of\s+|\s*\/\s*/).map((x) => x.trim())];
            for (const p of parts) {
                // Plurals as the red box writes them: "Redvoertuigen", "Officiers van
                // dienst politie", "Aanhoudingseenheden": each word singular in turn, then all.
                const ws = p.split(' ');
                const forms = [p, ...ws.map((w, i) => ws.map((x, k) => (k === i ? singular(x) : x)).join(' ')), ws.map(singular).join(' ')];
                for (const a of forms) {
                    add(ALIAS[a]);
                    add(BY_NAME[a]);
                    for (const [cap, id] of Object.entries(BY_NAME)) if (cap.startsWith(`${a} (`)) add(id);
                }
            }
            if (!out.length) {
                // Names the game makes up for a requirement ("Politie Noodhulp"): every
                // vehicle whose name has all the meaningful words, cheapest kind first.
                const words = n.split(/[\s,/()]+/).map(singular).filter((w) => w.length >= 2 && !STOP.has(w));
                if (words.length) {
                    for (const [cap, id] of Object.entries(BY_NAME)) {
                        const capWords = cap.split(/[\s,/()-]+/).map(singular);
                        if (words.every((w) => capWords.includes(w))) add(id);
                    }
                    out.sort((a, b) => a - b);
                }
            }
            return out;
        }
        // Does an extension row ("Voertuigen: DB-RI en RIA ...") unlock this type?
        function unlocks(text, vt) {
            const t = ` ${String(text).toLowerCase().replace(/[,.;:()]/g, ' ').replace(/\s+/g, ' ')} `;
            const names = [VT[vt][0], ...Object.entries(ALIAS).filter(([, id]) => id === vt).map(([k]) => k)]
                .map((x) => x.toLowerCase()).filter((x) => x.length >= 3);
            return names.some((x) => t.includes(` ${x} `));
        }

        /* ========================================================================
         * STATE — log, cooldowns and spending, kept across reloads.
         * ==================================================================== */
        let state;
        try { state = JSON.parse(GM_getValue(STATE_KEY, 'null')); } catch (e) { state = null; }
        state = state || {};
        state.log = state.log || [];
        state.cool = state.cool || {};
        // Growth used to wait 2 hours per kind; drop those waits (a failed build still waits 1 hour).
        for (const k of Object.keys(state.cool)) if (k.startsWith('Groei:') && state.cool[k] > Date.now() + 61 * 60000) delete state.cool[k];
        state.spent = state.spent || {};
        state.wishes = state.wishes || {};
        const save = () => { try { GM_setValue(STATE_KEY, JSON.stringify(state)); } catch (e) { ctx.warn('state not saved', e); } };
        function addLog(text, tone = 'ok', cost = 0) {
            state.log.unshift({ at: Date.now(), text, tone, cost });
            if (state.log.length > 300) state.log.length = 300;
            if (cost) {
                const day = new Date().toISOString().slice(0, 10);
                state.spent[day] = (state.spent[day] || 0) + cost;
            }
            save();
            ctx.refresh();
        }
        let next = null;        // what it wants to do now, for the panel
        let ranking = [];       // the planned options this round, best return first
        let unlocksAt = 0;
        let skipped = [];       // why other needs were passed over this round
        let failStreak = 0;
        let lastSaid = ''; // the game's message after the last purchase
        let stopped = false;
        let busy = false;
        W.mksAutoExpand = {
            get state() { return state; }, get next() { return next; }, get skipped() { return skipped; },
            get ranking() { return ranking.map(({ run, check, ...r }) => r); }, get unlocks() { return unlocks7d; },
        };

        /* ========================================================================
         * GAME ACCESS — credits only: every buying URL is checked for "coins".
         * ==================================================================== */
        const token = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
        async function getDoc(url) {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error(`${url}: ${r.status}`);
            return new DOMParser().parseFromString(await r.text(), 'text/html');
        }
        const api = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
        function creditsOnly(url) {
            if (/coins/i.test(url)) throw new Error(`weigert coins-link: ${url}`);
            return url;
        }
        async function hit(url, post) {
            creditsOnly(url);
            const opts = { credentials: 'same-origin' };
            if (post) {
                opts.method = 'POST';
                opts.headers = { 'X-CSRF-Token': token() };
                opts.body = post === true ? new URLSearchParams({ authenticity_token: token() }) : post;
            }
            const r = await fetch(url, opts);
            if (!r.ok) throw new Error(`${url}: ${r.status}`);
            return r;
        }
        const km = (a, b) => {
            const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
            const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(x));
        };
        const posOf = (b) => [Number(b.latitude), Number(b.longitude)];
        // Brandweerkazerne (klein) and Politieopkomstbureau (klein): the API lists them as the
        // normal kind with small_building set. Some extensions cannot be built there: the
        // game refuses the purchase until the station is upgraded to a full one (24 hours).
        // Extensions are tried as usual; only when one fails at a small station does that
        // extension wait for an upgrade there (extFailed).
        const isSmall = (b) => !!b.small_building || [17, 18].includes(b.building_type);
        // Upgrading: still small for the API for a while, so no extension tries for 25 hours.
        const upgrading = (b) => Date.now() - ((state.upgrading || {})[b.id] || 0) < 25 * 3600000;
        const upgradeStep = (b, se, why, extra = {}) => ({ label: `${b.caption} uitbouwen tot groot station (24 uur, ${why})`, cost: se.cost,
            run: () => hit(se.href, true), check: async () => !(await buildingInfo(b.id)).smallExpand,
            done: () => { state.upgrading = { ...(state.upgrading || {}), [b.id]: Date.now() }; }, ...extra });
        // Extensions that failed at a building: { "building:extension": { at, small } }. At a
        // small station it waits for the upgrade; elsewhere it is left alone for a day.
        const extKey = (b, e) => `${b.id}:${e.id}`;
        function extBlocked(b, e) {
            const f = (state.extFailed || {})[extKey(b, e)];
            if (!f) return '';
            if (f.small) {
                if (isSmall(b) || upgrading(b)) return 'small';
                delete state.extFailed[extKey(b, e)]; // a full station now: try again
                return '';
            }
            return Date.now() - f.at < 24 * 3600000 ? 'failed' : '';
        }
        // The game's message after a purchase (the page it redirects to), for the log.
        async function gameSays(r) {
            try {
                const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
                return [...doc.querySelectorAll('.alert-danger, .alert-warning')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 200);
            } catch (e) { return ''; }
        }
        // An extension purchase: on failure, note whether the station being small is why.
        const extStep = (b, ext, label, extra) => ({ label, cost: ext.cost,
            run: async () => { lastSaid = await gameSays(await hit(ext.href, true)); },
            check: async () => !(await buildingInfo(b.id)).exts.some((e) => e.id === ext.id),
            onFail: async () => {
                let small = isSmall(b);
                try { small = small && !!(await buildingInfo(b.id)).smallExpand; } catch (e) { /* keep the API's answer */ }
                state.extFailed = { ...(state.extFailed || {}), [extKey(b, ext)]: { at: Date.now(), small } };
                return small ? { known: true, note: 'klein station: deze uitbreiding kan daar waarschijnlijk pas na uitbouwen tot groot station' }
                    : { note: 'niet opnieuw geprobeerd in dit gebouw voor 24 uur' };
            }, ...extra });

        // Building page: parking "Voertuigen: 29 van maximaal 29" and the extensions
        // that can still be bought, with what they unlock.
        async function buildingInfo(id) {
            const doc = await getDoc(`/buildings/${id}`);
            const text = doc.body.textContent.replace(/\s+/g, ' ');
            const cap = text.match(/Voertuigen:?\s*(\d+)\s*van maximaal\s*(\d+)/i);
            const exts = [...doc.querySelectorAll('a[href*="/extension/credits/"]')].map((a) => {
                const row = a.closest('tr');
                return { id: (a.getAttribute('href').match(/credits\/(\d+)/) || [])[1], href: a.getAttribute('href').split('?')[0],
                    cost: num(a.textContent), text: row ? row.textContent.replace(/\s+/g, ' ').trim() : '' };
            });
            const vehicleIds = [...doc.querySelectorAll('#vehicle_table a[href^="/vehicles/"]')]
                .map((a) => (a.getAttribute('href').match(/^\/vehicles\/(\d+)$/) || [])[1]).filter(Boolean);
            // Small station: "Gebouw upgraden (630.736 credits)" turns it into a full one (24 h).
            const up = [...doc.querySelectorAll('a[href]')].find((a) => /\/small_expand$/.test((a.getAttribute('href') || '').split('?')[0]));
            const smallExpand = up ? { href: up.getAttribute('href'), cost: num(up.textContent) } : null;
            return { used: cap ? Number(cap[1]) : null, max: cap ? Number(cap[2]) : null, exts, vehicleIds, smallExpand };
        }
        // The next level on the "Uitbouwen" page: the cheapest credits link.
        async function nextLevel(id) {
            const doc = await getDoc(`/buildings/${id}/expand`);
            const links = [...doc.querySelectorAll('a[href*="/expand_do/credits"]')]
                .map((a) => ({ href: a.getAttribute('href'), cost: num(a.textContent), level: Number((a.getAttribute('href').match(/level=(\d+)/) || [])[1]) }))
                .filter((l) => l.cost > 0).sort((a, b) => a.cost - b.cost);
            return links[0] || null;
        }
        // Crew a vehicle needs to go out: its minimum, but 2 when it holds 2 or more
        // (an ambulance listed as 1-2 really needs 2).
        const crewOf = (vt) => { const v = VT[vt]; if (!v) return 2; return v[6] >= 2 ? Math.max(v[2], 2) : Math.max(1, v[2]); };
        // Personnel not yet on a vehicle, with or without a given training.
        async function freeCrew(id, training) {
            const doc = await getDoc(`/buildings/${id}/personals`);
            const table = doc.querySelector('#personal_table') || [...doc.querySelectorAll('table')].find((t) => /opleiding/i.test(t.textContent));
            if (!table) return 0;
            const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
            const iEdu = Math.max(0, heads.findIndex((h) => /opleiding/.test(h)));
            let n = 0;
            for (const tr of table.querySelectorAll('tbody tr')) {
                if (tr.querySelector('a[href*="/vehicles/"]')) continue; // already on a vehicle
                const edu = (tr.cells[iEdu]?.textContent || '').toLowerCase();
                if (!training || edu.includes(training.toLowerCase())) n++;
            }
            return n;
        }

        /* ========================================================================
         * NEEDS — the shortage list of Automatisch alarmeren. A vehicle type gets a
         * score from how often it was short or too far, recent weighing more, plain
         * vehicles less. "Other" needs give hospital departments, cells, trainings.
         * ==================================================================== */
        function readNeeds() {
            let needs = null;
            try { needs = JSON.parse(GM_getValue(NEEDS_KEY, 'null')); } catch (e) { needs = null; }
            return needs || { types: {}, other: {} };
        }
        const centroid = (pos) => {
            if (!pos || !pos.length) return null;
            const recent = pos.slice(-15);
            return [recent.reduce((s, p) => s + p[0], 0) / recent.length, recent.reduce((s, p) => s + p[1], 0) / recent.length];
        };
        // Credits a shortage blocked in the last 7 days. Entries are [lat, lon, time,
        // credits]; older data without credits counts 1.000 per missed mission.
        // Each purchase for a need halves what the shortages from before it still weigh:
        // the new vehicle should fix those, so only later shortages keep the full value.
        function value7d(t, name) {
            const since = Date.now() - 7 * 86400000;
            const buys = ((state.bought || {})[name] || []).filter((x) => x >= since);
            const weight = (at) => 0.5 ** buys.filter((x) => x > at).length;
            const recent = (t.pos || []).filter((p) => p[2] >= since);
            // Places recorded before credits were tracked (or with unknown credits) count
            // 1,000 each; counting them as 0 put OvD-P (122 missions) below 5-mission needs.
            if (recent.length) return recent.reduce((s, p) => s + (p[3] || 1000) * weight(p[2]), 0);
            const age = (Date.now() - (t.last || 0)) / 3600000;
            // No places with times (recorded by an older version): the all-time count says
            // little about now. Capped, and fading fast once the last shortage is a day old
            // (291 old Noodhulp shortages bought two levels and two cars a day later).
            return Math.min(t.missions, 30) * 1000 * (age < 24 ? 1 : age < 72 ? 0.3 : 0.05) * 0.5 ** buys.length;
        }
        function candidates(needs) {
            const now = Date.now();
            const out = [];
            for (const [name, t] of Object.entries(needs.types || {})) {
                if (t.missions < ctx.cfg.minMissions) continue;
                if ((state.cool[name] || 0) > now) continue;
                // A project for this need is still under way (training, extension being
                // built): wait for it instead of planning a second answer (a 400k police
                // building for OvD-P while Ede's OvD-P crew waited for a classroom).
                if (projects().some((p) => p.need === name)) continue;
                const vts = vehiclesFor(name);
                const value = value7d(t, name) * (vts.length && PLAIN.has(vts[0]) ? 1 : ctx.cfg.specialWeight);
                out.push({ kind: 'vehicle', name, vts, value, at: centroid(t.pos), t });
            }
            for (const [name, t] of Object.entries(needs.other || {})) {
                if (t.missions < ctx.cfg.minMissions || (state.cool[name] || 0) > now) continue;
                const dep = name.match(/^Ziekenhuis met afdeling (.+)$/i);
                const cells = /^Cel(len)? /i.test(name);
                const edu = name.match(/^Opleiding (.+?) \(/);
                const pers = name.match(/^Personeel: (.+)$/);
                if (edu || pers) { state.wishes[(edu || pers)[1]] = t.missions; continue; }
                const value = value7d(t, name) * ctx.cfg.specialWeight;
                if (dep) out.push({ kind: 'ext', name, types: [2], match: new RegExp(dep[1].trim(), 'i'), value, at: centroid(t.pos), t });
                else if (cells) out.push({ kind: 'ext', name, types: [5, 11, 18], match: /\bcel\b|cel$/i, value, at: centroid(t.pos), t });
            }
            for (const u of unlocks7d) if ((state.cool[u.name] || 0) <= now) out.push(u);
            return out.sort((a, b) => b.value - a.value);
        }

        /* ========================================================================
         * NEW MISSION TYPES — missions need a number of buildings or extensions
         * (prerequisites in /einsaetze.json, same table as the Personeel module).
         * For each building or extension: the mission types one more would unlock
         * (that being their only gap), valued at their average credits ×
         * unlockWeight, as if each turns up that often per week.
         * ==================================================================== */
        const PREREQ = {
            fire_stations: { label: 'Brandweerkazerne', types: [0, 17] }, rescue_stations: { label: 'Ambulancestandplaats', types: [3, 13] },
            police_stations: { label: 'Politiebureau', types: [5, 18] }, bereitschaftspolizei: { label: 'Politie hoofdbureau', types: [11] },
            police_helicopter_stations: { label: 'Politiehelikopter standplaats', types: [9] }, water_rescue_2: { label: 'Waterreddingspost', types: [16] },
            coastal_rescue_count: { label: 'Kustwacht haven', types: [19] }, coastal_helicopter_count: { label: 'SAR Helikopter platform', types: [21] },
            tow_trucks: { label: 'Berger standplaats / Berger-K', types: [24], ext: /^Berger-K/i }, railway: { label: 'Standplaats Incidentenbestrijding spoor', types: [27] },
            military_police: { label: 'Kazerne defensie', types: [25] }, fire_aviation_count: { label: 'Militaire hangar', types: [23] },
            technical_aid: { label: 'RWS-steunpunt / Signalisatie', types: [22], ext: /^Signalisatie/i }, tow_trucks_large: { label: 'Berger-G', ext: /^Berger-G/i },
            fire_support_count: { label: 'Schuimblussing', ext: /^Schuimblus/i }, brush_extension: { label: 'Natuurbrandbestrijding', ext: /^Natuurbrandbestrijding/i },
            thatched_fire: { label: 'Rietkapbrandbestrijding', ext: /^Rietkap/i }, livestock_fire: { label: 'Veetakels', ext: /^Veetakel/i },
            industrial_response_fire: { label: 'Industriële Brandbestrijding', ext: /^Industri.le Brandbestrijding/i },
            hazard_response_fire: { label: 'Incidentbestrijding Gevaarlijke Stoffen', ext: /^Incidentbestrijding Gevaarlijke Stoffen/i },
            wasserrettung: { label: 'Waterongevallenbestrijding', ext: /^Waterongevallenbestrijding/i }, airport: { label: 'Vliegtuigbrandbestrijding', ext: /^Vliegtuigbrandbestrijding/i },
            railway_fire: { label: 'Incidentenbestrijding spoor (uitbreiding)', ext: /^Incidentenbestrijding spoor/i },
            mass_casualty_count: { label: 'Grootschalige Geneeskundige Bijstand', ext: /^Grootschalige Geneeskundige Bijstand/i },
            disaster_response_count: { label: 'Specialisme Technische Hulpverlening', ext: /^Specialisme Technische Hulpverlening/i },
            search_and_rescue: { label: 'Urban Search and Rescue', ext: /^Urban Search and Rescue/i }, care_service: { label: 'Verzorgingseenheid', ext: /^Verzorgingseenheid/i },
            clean_service: { label: 'Arbeidshygiëne', ext: /^Arbeidshygi/i }, drone_fire: { label: 'Team Digitale Verkenning', ext: /^Team Digitale Verkenning/i },
            drone_police: { label: 'Drone Team Politie', ext: /^Drone Team Politie/i }, traffic_police: { label: 'LE - Dienst Infrastructuur', ext: /^LE - Dienst Infrastructuur/i },
            hondengeleider: { label: 'Hondenbrigade', ext: /^Hondenbrigade/i }, police_horse: { label: 'Bereden Brigade', ext: /^Bereden Brigade/i },
            riot_unit_count: { label: 'Mobiele Eenheid, Sectie', ext: /^Mobiele Eenheid, (2e )?Sectie/i },
            detention_unit_count: { label: 'Mobiele Eenheid, Aanhoudingseenheid', ext: /Aanhoudingseenheid/i },
            prisoner_transport_count: { label: 'Arrestantenvervoer', ext: /^Arrestantenvervoer/i }, water_cannon: { label: 'Waterwerper', ext: /^Waterwerper/i },
            at: { label: 'Arrestatieteam', ext: /^Arrestatieteam/i }, bomb_disposal_count: { label: 'Explosieven Opruimingsdienst', ext: /^Explosieven Opruimingsdienst/i },
            bomb_disposal_diver: { label: 'Defensie Duikgroep', ext: /^Defensie Duikgroep/i }, bomb_disposal_patrol: { label: 'TEV', ext: /\bTEV\b|Technische Explosieven/i },
            coastal_rescue_small_count: { label: 'Boten', ext: /^Boten|\bboot/i },
        };
        const MAIN_BUILDING = { 0: 'fire_stations', 3: 'rescue_stations', 5: 'police_stations', 11: 'bereitschaftspolizei',
            16: 'water_rescue_2', 19: 'coastal_rescue_count', 24: 'tow_trucks', 25: 'military_police', 27: 'railway' };
        let missionTypes = null; // /einsaetze.json, once per page (~3 MB)
        let unlocks7d = [];
        async function computeUnlocks(data) {
            if (!missionTypes) missionTypes = await api('/einsaetze.json');
            const have = {};
            for (const [key, def] of Object.entries(PREREQ)) {
                let n = 0;
                for (const b of data.buildings) {
                    if (def.types && def.types.includes(b.building_type)) n++;
                    // Extensions still being built count too, or the next round buys a second one elsewhere.
                    if (def.ext) n += (b.extensions || []).filter((x) => def.ext.test(x.caption || '')).length;
                }
                have[key] = n;
            }
            const now = Date.now();
            const gain = {};
            for (const m of missionTypes) {
                const a = m.additional || {};
                if (Date.parse(a.date_start) > now || Date.parse(a.date_end) < now) continue; // events out of season
                const pre = m.prerequisites || {};
                if (typeof pre.max_police_stations === 'number' && have.police_stations > pre.max_police_stations) continue;
                const need = {};
                for (const [k, v] of Object.entries(pre)) if (typeof v === 'number' && PREREQ[k]) need[k] = v;
                const main = MAIN_BUILDING[pre.main_building];
                if (main) need[main] = Math.max(need[main] || 0, 1);
                const gaps = Object.entries(need).filter(([k, v]) => have[k] < v);
                if (gaps.length !== 1 || gaps[0][1] - have[gaps[0][0]] !== 1) continue;
                const k = gaps[0][0];
                gain[k] = gain[k] || { credits: 0, names: new Set() };
                if (gain[k].names.has(m.name)) continue; // variants of one mission count once
                gain[k].names.add(m.name);
                gain[k].credits += m.average_credits || 0;
            }
            unlocks7d = Object.entries(gain).map(([key, g]) => ({
                kind: 'unlock', key, def: PREREQ[key], name: `Nieuwe meldingen: ${PREREQ[key].label}`,
                value: g.credits * ctx.cfg.unlockWeight, unlockCount: g.names.size, examples: [...g.names].slice(0, 5),
            }));
        }

        /* ========================================================================
         * PLANNING — for one need, the first thing in this order that is possible:
         * an extension the nearest suitable building lacks, a level when its
         * parking is full, the vehicle itself, or else a new building on a real post.
         * ==================================================================== */
        /* ========================================================================
         * PROJECTS — a vehicle that needs trained crew goes in steps, saved across
         * reloads: train (free people go to a school), buy (when they are trained,
         * a level first if the parking is full), assign (those people are linked to
         * the new vehicle). One project per building at a time.
         * ==================================================================== */
        const projects = () => (state.projects = state.projects || []);
        const SCHOOL_TYPES = [4, 7, 8, 20, 26];
        const cleanEdu = (t) => norm(String(t).replace(/\(\d+\s*dag(en)?\)/i, ''));
        let eduCache = null; // per round: training name -> { key, value, school, form }
        // The training's key ("care_service") and a school with a free classroom that gives it.
        async function education(name) {
            if (!eduCache) {
                eduCache = {};
                for (const s of (await api('/api/buildings')).filter((b) => SCHOOL_TYPES.includes(b.building_type))) {
                    const doc = await getDoc(`/buildings/${s.id}`);
                    const form = [...doc.forms].find((f) => /\/education$/.test(f.getAttribute('action') || ''));
                    if (!form) continue; // all classrooms in use
                    for (const o of form.querySelectorAll('select[name="education_select"] option')) {
                        if (!o.value) continue;
                        const n = cleanEdu(o.textContent);
                        state.eduKeys = state.eduKeys || {};
                        state.eduKeys[n] = o.value.split(':')[0];
                        if (!eduCache[n]) eduCache[n] = { key: o.value.split(':')[0], value: o.value, school: s.id, form };
                    }
                }
            }
            const n = cleanEdu(name);
            return eduCache[n] || { key: (state.eduKeys || {})[n] || null };
        }
        // People of a building as the school form lists them: has the training, free
        // (not bound to a vehicle, not in training, not reserved by another project).
        async function peopleAt(buildingId, key) {
            const doc = await getDoc(`/buildings/${buildingId}/schooling_personal_select`);
            const reserved = new Set(projects().flatMap((p) => p.people || []));
            return [...doc.querySelectorAll('input.schooling_checkbox')].map((cb) => {
                const tr = cb.closest('tr');
                const bound = (tr?.cells[tr.cells.length - 1]?.textContent || '').trim();
                const pid = cb.value;
                const idle = !bound && !cb.disabled;
                return { pid, has: cb.getAttribute(key) === 'true', idle, free: idle && !reserved.has(pid) };
            });
        }
        // A class only starts when all 10 seats are taken. Empty seats go first to free
        // people in buildings that can hold the vehicle (a crew each, trained ahead for a
        // later purchase there), nearest first, then to free people from any building.
        async function fillSeats(data, edu, have, vt, ref) {
            const missing = 10 - have.length;
            if (missing <= 0) return [];
            const prefTypes = (VT[vt] || [])[3] || [];
            const per = crewOf(vt);
            const taken = new Set(have);
            const dist = (b) => (ref ? km(posOf(b), ref) : 0);
            const usable = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type) && b.enabled !== false);
            const lists = [[usable.filter((b) => prefTypes.includes(b.building_type)).sort((a, b) => dist(a) - dist(b)), per],
                [usable.filter((b) => !prefTypes.includes(b.building_type)).sort((a, b) => dist(a) - dist(b)), 10]];
            const out = [];
            let looked = 0;
            for (const [list, max] of lists) {
                for (const b of list) {
                    if (out.length >= missing || looked >= 40) break;
                    looked++;
                    const free = (await peopleAt(b.id, edu.key)).filter((p) => p.free && !p.has && !taken.has(p.pid)).slice(0, Math.min(max, missing - out.length));
                    free.forEach((p) => { out.push(p.pid); taken.add(p.pid); });
                }
            }
            return out;
        }
        // Start a class with these people, the empty seats filled; the step's label says how many extra.
        async function startFull(step, data, edu, pids, vt, ref) {
            const extra = await fillSeats(data, edu, pids, vt, ref);
            if (extra.length) step.label += `, ${extra.length} extra om de klas vol te maken`;
            await startTraining(edu, [...pids, ...extra]);
        }
        // People of a building in a class for this training right now ("In opleiding:
        // Drone Flightcrew" on its personnel page); the school form does not list them.
        async function inTraining(buildingId, training) {
            const doc = await getDoc(`/buildings/${buildingId}/personals`);
            const t = cleanEdu(training);
            return [...doc.querySelectorAll('table tbody tr')].filter((tr) => {
                const m = tr.textContent.replace(/\s+/g, ' ').match(/In opleiding:\s*([^|]+?)(?:\s{2,}|$)/i);
                return m && cleanEdu(m[1]).includes(t);
            }).length;
        }
        async function startTraining(edu, pids) {
            const fd = new FormData(edu.form);
            fd.set('education_select', edu.value);
            fd.set('alliance[duration]', '0'); // "Nu starten", not shared with the team
            fd.set('alliance[cost]', '0');
            fd.delete('personal_ids[]');
            pids.forEach((pid) => fd.append('personal_ids[]', pid));
            const submit = edu.form.querySelector('input[type="submit"][name="commit"]');
            if (submit) fd.set('commit', submit.value);
            await hit(edu.form.getAttribute('action'), new URLSearchParams(fd));
        }
        // Link people to a vehicle: the assign button is a POST that toggles, so
        // only people not yet on this vehicle are sent.
        async function assignPeople(vehicleId, pids) {
            const doc = await getDoc(`/vehicles/${vehicleId}/zuweisung`);
            let done = 0;
            for (const pid of pids) {
                const btn = doc.querySelector(`a[personal_id="${pid}"]`);
                if (!btn) continue;
                if (!btn.classList.contains('btn-assigned')) {
                    await hit(`/vehicles/${vehicleId}/zuweisungDo/${pid}`, true);
                    await sleep(400);
                }
                done++;
            }
            const after = await getDoc(`/vehicles/${vehicleId}/zuweisung`);
            return pids.filter((pid) => after.querySelector(`a[personal_id="${pid}"]`)?.classList.contains('btn-assigned')).length === pids.length && done > 0;
        }
        async function buyAction(b, c, v, info, d) {
            const market = await getDoc(`/buildings/${b.id}/vehicles/new`);
            const btn = [...market.querySelectorAll('a.buy-vehicle-btn')].find((a) => new RegExp(`/vehicle/\\d+/${c.vt}/credits`).test(a.getAttribute('href')));
            if (!btn || btn.classList.contains('disabled')) return { skip: `${b.caption}: ${v[0]} niet te koop` };
            return { label: `${v[0]} voor ${b.caption}${d != null ? ` (${d.toFixed(1)} km van de inzetten)` : ''}`, cost: v[1], building: b.id, vt: c.vt, before: info.vehicleIds,
                run: () => hit(btn.getAttribute('href')),
                check: async () => ((await buildingInfo(b.id)).used || 0) > (info.used || 0) };
        }
        // Free steps of running projects (training done? assign people), and the
        // paid step (level or vehicle) of the first one that is ready to buy.
        async function advanceProjects(data) {
            for (const p of [...projects()]) {
                if (stopped) return null;
                const b = data.byId[p.building];
                if (!b || Date.now() - p.started > 14 * 86400000) {
                    state.projects = projects().filter((x) => x !== p);
                    addLog(`project gestopt: ${VT[p.vt]?.[0]} voor ${p.caption} (${b ? 'te lang' : 'gebouw weg'})`, 'warn');
                    continue;
                }
                if (p.stage === 'grow') {
                    // A new post from build mode: levels up to what its first staff can man,
                    // then vehicles that need few people, until the parking is full.
                    const G = GROW_FILL[p.kind] || GROW_FILL.brandweerkazerne;
                    const info = await buildingInfo(p.building);
                    if (p.levels < G.levels && ctx.cfg.doLevels) {
                        const lvl = await nextLevel(p.building);
                        if (lvl) {
                            return { label: `level voor nieuwe post ${p.caption} (${p.levels + 1}/${G.levels}, bouwmodus)`, cost: lvl.cost, need: p.need,
                                run: () => hit(lvl.href), check: async () => ((await buildingInfo(p.building)).max || 0) > (info.max || 0),
                                done: () => { p.levels++; } };
                        }
                        p.levels = G.levels; // no more levels to buy here
                    }
                    if (info.used != null && info.max != null && info.used < info.max && ctx.cfg.doVehicles) {
                        const have = data.vehicles.filter((x) => x.building_id === p.building).map((x) => x.vehicle_type);
                        let vt = have.length ? null : G.first;
                        if (vt == null) {
                            for (const c of candidates(readNeeds())) {
                                if (c.kind !== 'vehicle') continue;
                                const t = c.vts.find((id) => VT[id] && VT[id][3].includes(b.building_type) && !VT[id][4] && crewOf(id) <= staffLeft(b, data));
                                if (t != null) { vt = t; break; }
                            }
                        }
                        if (vt == null) {
                            state.projects = projects().filter((x) => x !== p);
                            addLog(`nieuwe post klaar: ${p.caption} (${have.length} voertuig(en), geen passend tekort meer)`, 'ok');
                            continue;
                        }
                        // Only as many vehicles as its people can man (a new post has few):
                        // the rest of the parking stays free for later.
                        if (staffLeft(b, data) < crewOf(vt)) {
                            // A new post starts without people: wait for the hiring to bring the
                            // first crew. Once it has vehicles, stop where its people run out.
                            if (!have.length && Date.now() - p.started < 3 * 86400000) { p.wait = `wacht op personeel (${b.personal_count || 0})`; continue; }
                            state.projects = projects().filter((x) => x !== p);
                            addLog(`nieuwe post zo ver als het personeel toelaat: ${p.caption} (${have.length} voertuig(en))`, 'ok');
                            continue;
                        }
                        const buy = await buyAction(b, { vt }, VT[vt], info, null);
                        if (!buy.skip) return { ...buy, need: p.need, label: `${buy.label} (nieuwe post, bouwmodus)` };
                        p.wait = buy.skip;
                        continue;
                    }
                    state.projects = projects().filter((x) => x !== p);
                    addLog(`nieuwe post klaar: ${p.caption}`, 'ok');
                    continue;
                }
                if (p.stage === 'prep') {
                    // Extension bought: crew first (in parallel with the building work).
                    const v = VT[p.vt];
                    if (!v || !v[4]) { p.stage = 'buy'; p.people = []; }
                    else {
                        const edu = await education(v[4]);
                        const want = v[5] === 'all' ? crewOf(p.vt) : Number(v[5]) || crewOf(p.vt);
                        const people = edu.key ? await peopleAt(p.building, edu.key) : [];
                        const trained = people.filter((x) => x.free && x.has);
                        p.training = v[4];
                        if (trained.length >= want) {
                            Object.assign(p, { stage: 'buy', key: edu.key, people: trained.slice(0, want).map((x) => x.pid) });
                        } else if (trained.length + await inTraining(p.building, v[4]) >= want) {
                            // Already in a class (a team training joined by hand, or our own):
                            // wait for it instead of starting a second one.
                            p.wait = 'personeel al in opleiding';
                            continue;
                        } else if (!edu.key || !edu.school) {
                            p.wait = 'wacht op een vrij klaslokaal';
                            markBlocked(p.vt, 20000);
                            continue;
                        } else {
                            const learners = people.filter((x) => x.free && !x.has).slice(0, want - trained.length);
                            if (learners.length < want - trained.length) { p.wait = 'te weinig vrij personeel om op te leiden'; continue; }
                            const crew = trained.map((x) => x.pid);
                            // At most 10 per class: the rest follows as soon as a classroom is free.
                            const all = learners.map((x) => x.pid);
                            const learnIds = all.slice(0, 10);
                            const later = all.slice(10);
                            const step = { label: `opleiding ${v[4]} voor ${learnIds.length} pers. van ${p.caption} (voor ${v[0]}, terwijl de uitbreiding gebouwd wordt)`, cost: 0, need: p.need,
                                run: () => startFull(step, data, edu, learnIds, p.vt, posOf(b)),
                                check: async () => (await peopleAt(p.building, edu.key)).filter((x) => learnIds.includes(x.pid) && x.idle).length === 0,
                                done: () => Object.assign(p, { stage: 'train', key: edu.key, people: [...crew, ...all], queue: later.length ? later : undefined, started: Date.now(), wait: null }) };
                            return step;
                        }
                    }
                }
                if (p.stage === 'train' && p.queue && p.queue.length) {
                    // More people than one class holds: the rest goes as soon as a school
                    // has a free classroom. Whoever left meanwhile is replaced from the same building.
                    const people = await peopleAt(p.building, p.key);
                    const want = p.queue.length;
                    p.people = p.people.filter((pid) => !p.queue.includes(pid));
                    const still = p.queue.filter((pid) => people.find((x) => x.pid === pid && x.idle && !x.has));
                    const fill = people.filter((x) => x.free && !x.has && !still.includes(x.pid)).slice(0, want - still.length).map((x) => x.pid);
                    p.queue = [...still, ...fill];
                    p.people.push(...p.queue);
                    if (p.queue.length < want) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`project gestopt: ${VT[p.vt]?.[0]} voor ${p.caption} (te weinig vrij personeel voor de volgende opleiding)`, 'warn');
                        continue;
                    }
                    const edu = await education(p.training);
                    if (!edu.school) { p.wait = 'wacht op een vrij klaslokaal'; markBlocked(p.vt, 20000); continue; }
                    const batch = p.queue.slice(0, Math.min(10, ctx.cfg.trainSeats));
                    const step = { label: `opleiding ${p.training} voor ${batch.length} pers. van ${p.caption} (vervolg, project)`, cost: 0, need: p.need,
                        run: () => startFull(step, data, edu, batch, p.vt, posOf(b)),
                        check: async () => (await peopleAt(p.building, p.key)).filter((x) => batch.includes(x.pid) && x.idle).length === 0,
                        done: () => { p.queue = p.queue.filter((pid) => !batch.includes(pid)); p.wait = null; p.started = Date.now(); } };
                    return step;
                }
                if (p.stage === 'train') {
                    const people = await peopleAt(p.building, p.key);
                    const ready = p.people.every((pid) => people.find((x) => x.pid === pid)?.has);
                    if (ready) { p.stage = p.fill ? 'assign' : 'buy'; p.assignTries = 0; addLog(`opleiding klaar: ${p.training} in ${p.caption}`, 'idle'); }
                }
                if (p.stage === 'assign') {
                    if (await assignPeople(p.vehicle, p.people)) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`personeel gekoppeld: ${p.people.length} pers. met ${p.training} aan ${VT[p.vt]?.[0]} in ${p.caption}`, 'ok');
                    } else if (++p.assignTries > 5) {
                        state.projects = projects().filter((x) => x !== p);
                        addLog(`koppelen mislukt: ${VT[p.vt]?.[0]} in ${p.caption}`, 'error');
                    }
                }
                if (p.stage === 'buy') {
                    const v = VT[p.vt];
                    // Waiting for an extension that brings the parking spot: no level meanwhile
                    // (Voorthuizen wanted level 2 for 100k while its ambulance post was being built).
                    if ((b.extensions || []).some((x) => x.available === false)) { p.wait = 'uitbreiding wordt nog gebouwd'; continue; }
                    const info = await buildingInfo(p.building);
                    if (info.used != null && info.max != null && info.used >= info.max) {
                        const lvl = ctx.cfg.doLevels ? await nextLevel(p.building) : null;
                        if (!lvl) { p.wait = 'parkeerplaats vol, geen level meer'; continue; }
                        return { label: `level ${lvl.level} voor ${p.caption} (plek voor ${v[0]}, project)`, cost: lvl.cost, need: p.need,
                            run: () => hit(lvl.href), check: async () => ((await buildingInfo(p.building)).max || 0) > (info.max || 0) };
                    }
                    const buy = await buyAction(b, { vt: p.vt }, v, info, null);
                    if (buy.skip) { p.wait = buy.skip; continue; }
                    return { ...buy, need: p.need, label: `${buy.label} (project)`, project: p };
                }
            }
            return null;
        }

        // Vehicles whose capacity is their crew: a horse truck carries one horse per
        // rider (tested: 6 trucks with 1 person each count as 6 Police Horses).
        // Filling the trucks you have is cheaper than buying more.
        const FILL_VT = { 73: 4 };
        async function planFill(c, data) {
            const v = VT[c.vt];
            const max = FILL_VT[c.vt];
            const edu = await education(v[4]);
            if (!edu.key) return null;
            const filling = new Set(projects().filter((p) => p.fill).map((p) => String(p.vehicle)));
            const ref = c.at || data.home;
            const trucks = data.vehicles.filter((x) => x.vehicle_type === c.vt && (x.assigned_personnel_count || 0) < max && !filling.has(String(x.id)))
                .map((x) => ({ x, b: data.byId[x.building_id] })).filter((t) => t.b)
                .sort((a, b) => km(posOf(a.b), ref) - km(posOf(b.b), ref));
            if (!trucks.length) return null;
            // Trained riders already free in a truck's building: link them now (free).
            for (const { x, b } of trucks) {
                const trained = (await peopleAt(b.id, edu.key)).filter((p) => p.free && p.has).slice(0, max - (x.assigned_personnel_count || 0));
                if (!trained.length) continue;
                let ok = false;
                return { label: `${trained.length} ruiter(s) erbij op ${x.caption} in ${b.caption} (${x.assigned_personnel_count || 0} → ${(x.assigned_personnel_count || 0) + trained.length} paarden)`, cost: 0,
                    run: async () => { ok = await assignPeople(x.id, trained.map((p) => p.pid)); }, check: async () => ok };
            }
            // Otherwise train free people of the truck's own building, several trucks of one
            // building in one class; each truck is a project that links them when done.
            if (!edu.school) { markBlocked(c.vt, c.value); return { skip: `${c.name}: ${v[4]} nodig om paardentrucks te vullen, geen vrij klaslokaal` }; }
            const seats = Math.min(10, ctx.cfg.trainSeats);
            for (const { b } of trucks) {
                const here = trucks.filter((t) => t.b.id === b.id);
                const free = (await peopleAt(b.id, edu.key)).filter((p) => p.free && !p.has);
                const group = [];
                let used = 0;
                for (const { x } of here) {
                    const n = Math.min(max - (x.assigned_personnel_count || 0), free.length - used, seats - used);
                    if (n <= 0) break;
                    const pids = free.slice(used, used + n).map((p) => p.pid);
                    used += n;
                    group.push({ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'train', key: edu.key, training: v[4],
                        people: pids, vehicle: x.id, fill: true, started: Date.now() });
                }
                if (!group.length) continue;
                const learnIds = group.flatMap((p) => p.people);
                const step = { label: `opleiding ${v[4]} voor ${learnIds.length} pers. van ${b.caption}, daarna op ${group.length} paardentruck(s)`, cost: 0,
                    run: () => startFull(step, data, edu, learnIds, c.vt, posOf(b)),
                    check: async () => (await peopleAt(b.id, edu.key)).filter((p) => learnIds.includes(p.pid) && p.idle).length === 0,
                    projects: group };
                return step;
            }
            return null;
        }

        /* Empty parking spots: every building page is read in turns (a few per round,
         * oldest first) and remembered as { used, max, at }. A building with room gets
         * the most valuable shortage its type can hold, when its staff can crew it now. */
        const NO_VEHICLES = new Set([1, 2, ...SCHOOL_TYPES]);
        async function scanSpots(data, n = 15) {
            state.spots = state.spots || {};
            const ids = new Set(data.buildings.map((b) => String(b.id)));
            for (const id of Object.keys(state.spots)) if (!ids.has(id)) delete state.spots[id];
            const todo = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type) && b.enabled !== false)
                .sort((a, b) => ((state.spots[a.id] || {}).at || 0) - ((state.spots[b.id] || {}).at || 0)).slice(0, n);
            for (const b of todo) {
                if (stopped) return;
                if (Date.now() - ((state.spots[b.id] || {}).at || 0) < 3600000) continue;
                try {
                    const info = await buildingInfo(b.id);
                    if (info.max != null) state.spots[b.id] = { used: info.used, max: info.max, at: Date.now() };
                } catch (e) { ctx.warn('spot scan', b.id, e); }
                await sleep(300);
            }
        }
        async function planSpots(cands, data) {
            const out = [];
            const free = data.buildings.filter((b) => { const f = (state.spots || {})[b.id]; return f && f.max > f.used; });
            if (!free.length) return out;
            const types = cands.filter((c) => c.kind === 'vehicle' && c.vts.length);
            for (const b of free) {
                if (projects().some((p) => p.building === b.id)) continue;
                const here = data.vehicles.filter((x) => x.building_id === b.id);
                const left = (b.personal_count || 0) - here.reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
                let info = null;
                for (const c of types) {
                    const vt = c.vts.find((id) => VT[id] && VT[id][3].includes(b.building_type));
                    if (vt == null || VT[vt][4] === '?') continue;
                    const v = VT[vt];
                    if (left < crewOf(vt)) continue;
                    const d = c.at ? km(posOf(b), c.at) : 0;
                    // Worth less the further it is from where the shortage was.
                    const factor = !c.at || d <= ctx.cfg.nearKm ? 1 : d <= ctx.cfg.nearKm * 3 ? 0.5 : 0.25;
                    if (!info) {
                        info = await buildingInfo(b.id);
                        state.spots[b.id] = { used: info.used, max: info.max, at: Date.now() };
                    }
                    if (info.used >= info.max) break;
                    if (info.exts.some((e) => unlocks(e.text, vt))) continue;
                    let people;
                    if (v[4]) {
                        const edu = await education(v[4]);
                        if (!edu.key) continue;
                        const want = v[5] === 'all' ? crewOf(vt) : Number(v[5]) || crewOf(vt);
                        const trained = (await peopleAt(b.id, edu.key)).filter((p) => p.free && p.has);
                        if (trained.length < want) continue; // training goes through the normal plan
                        people = trained.slice(0, want).map((p) => p.pid);
                    }
                    const buy = await buyAction(b, { vt }, v, info, c.at ? d : null);
                    if (buy.skip) continue;
                    const value = c.value * factor;
                    out.push({ ...buy, people, need: c.name, value, label: `lege plek: ${buy.label}`, ratio: value / Math.max(buy.cost, 2000) });
                    break; // one option per building
                }
                if (out.length >= 3) break;
            }
            return out;
        }

        async function planVehicle(c, data) {
            // Of the types the name can mean, the first one an own building type can hold.
            const types = new Set(data.buildings.map((b) => b.building_type));
            c.vt = c.vts.find((id) => VT[id] && VT[id][3].some((t) => types.has(t))) ?? c.vts[0];
            const v = VT[c.vt];
            if (!v) return { skip: `${c.name}: onbekend voertuig` };
            if (FILL_VT[c.vt] && ctx.cfg.doVehicles) {
                const fill = await planFill(c, data);
                if (fill) return fill;
            }
            if (v[4] === '?') return { skip: `${c.name}: opleiding voor ${v[0]} onbekend` };
            const ref = c.at || data.home;
            const own = data.buildings.filter((b) => v[3].includes(b.building_type) && b.enabled !== false)
                .map((b) => ({ b, d: km(posOf(b), ref) })).sort((a, b) => a.d - b.d);
            // Near buildings with an empty parking spot first (known from the spot scan),
            // so a free spot is used before money goes into a level elsewhere.
            const hasRoom = (b) => { const f = (state.spots || {})[b.id]; return f && f.max > f.used ? 1 : 0; };
            const near = own.filter((o) => !c.at || o.d <= ctx.cfg.nearKm)
                .sort((x, y) => hasRoom(y.b) - hasRoom(x.b) || x.d - y.d).slice(0, 3);
            const reasons = [];
            let upgradeOpt = null; // a small station whose extension failed: upgrade it if nothing else fits
            for (const { b, d } of near) {
                const info = await buildingInfo(b.id);
                const gate = info.exts.find((e) => unlocks(e.text, c.vt));
                const blockedHow = gate ? extBlocked(b, gate) : '';
                if (blockedHow === 'small') {
                    // The extension failed here because the station is small: upgrade it first
                    // (when allowed), unless a later building in the list can take the vehicle.
                    if (!upgradeOpt && !upgrading(b) && info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && ctx.cfg.doExtensions
                        && staffLeft(b, data) >= crewOf(c.vt) && !projects().some((p) => p.building === b.id)) {
                        upgradeOpt = upgradeStep(b, info.smallExpand, `uitbreiding "${extName(gate.text)}" voor ${v[0]} lukte niet in de kleine post`);
                    }
                    reasons.push(`${b.caption}: uitbreiding lukte niet, klein station${upgrading(b) ? ' (wordt uitgebouwd)' : ', eerst uitbouwen tot groot'}`);
                    continue;
                }
                if (blockedHow === 'failed') { reasons.push(`${b.caption}: uitbreiding "${extName(gate.text)}" lukte eerder niet`); continue; }
                if (gate) {
                    // An extension takes days to build. When the vehicle has a building type of
                    // its own (an ambulance post for an ambulance), a new one of those is ready
                    // at once: build that instead (the "Ambulance standplaats" at Voorthuizen
                    // would have kept the ambulance waiting for days).
                    const own = v[3].find((t) => t !== b.building_type && CAT_OF[t] && !NO_NEW_BUILDING.has(t) && ![17, 18].includes(t));
                    if (own != null && ctx.cfg.doBuild && c.at) {
                        const nb = await planBuilding(c, [own], `voor ${v[0]}, direct klaar in plaats van uitbreiding in ${b.caption}`, data);
                        if (!nb.skip) return nb;
                    }
                    if (staffLeft(b, data) < crewOf(c.vt)) { reasons.push(`${b.caption}: uitbreiding nodig, maar personeel ${Math.max(0, staffLeft(b, data))}/${crewOf(c.vt)} over`); continue; }
                    if (ctx.cfg.doExtensions && gate.cost) {
                        return extStep(b, gate, `uitbreiding "${extName(gate.text)}" in ${b.caption} (voor ${v[0]})`,
                            { projects: projects().some((p) => p.building === b.id) ? [] : prepProject(b, c.vt, c.name) });
                    }
                    reasons.push(`${b.caption}: uitbreiding nodig`);
                    continue;
                }
                // Full: a level only after the staff and crew checks below, and always with
                // a project that buys the vehicle (and links trained crew) right after it.
                const full = info.used != null && info.max != null && info.used >= info.max;
                const lvl = full && ctx.cfg.doLevels ? await nextLevel(b.id) : null;
                if (full && !lvl) {
                    // A small station at its limit: upgrade it to a full one (24 hours), then a
                    // project buys the vehicle once there is room.
                    if (info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && staffLeft(b, data) >= crewOf(c.vt) && !projects().some((p) => p.building === b.id)) {
                        const se = info.smallExpand;
                        return { label: `${b.caption} uitbouwen tot groot station (24 uur, voor ${v[0]})`, cost: se.cost,
                            run: () => hit(se.href, true), check: async () => !(await buildingInfo(b.id)).smallExpand,
                            projects: [{ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'buy', people: [], started: Date.now() }] };
                    }
                    reasons.push(`${b.caption}: vol${ctx.cfg.doLevels ? ', hoogste level' : ''}`);
                    continue;
                }
                const levelStep = (crew) => ({ label: `level ${lvl.level} voor ${b.caption} (parkeerplaats voor ${v[0]}, daarna kopen)`, cost: lvl.cost,
                    run: () => hit(lvl.href), check: async () => ((await buildingInfo(b.id)).max || 0) > (info.max || 0),
                    projects: [{ building: b.id, caption: b.caption, vt: c.vt, need: c.name, stage: 'buy', training: v[4] || null, people: crew, started: Date.now() }] });
                // Staff is shared by the building's vehicles: what is left after the
                // ones it has must crew this one too (5 staff, 2 ambulances = 1 left: no).
                const here = data.vehicles.filter((x) => x.building_id === b.id);
                const left = (b.personal_count || 0) - here.reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
                const need = crewOf(c.vt);
                if (left < need) {
                    reasons.push(`${b.caption}: personeel ${Math.max(0, left)}/${need} over`);
                    continue;
                }
                if (projects().some((p) => p.building === b.id)) { reasons.push(`${b.caption}: al een project bezig`); continue; }
                if (!ctx.cfg.doVehicles) return { skip: `${c.name}: voertuigen kopen staat uit` };
                if (v[4]) {
                    // Trained crew: buy now with people who have it, or send free
                    // people to training first (a project that buys and assigns later).
                    const want = v[5] === 'all' ? need : Number(v[5]) || need;
                    const edu = await education(v[4]);
                    if (!edu.key) { markBlocked(c.vt, c.value); reasons.push(`${b.caption}: opleiding ${v[4]} onbekend (alle klaslokalen bezet)`); continue; }
                    const people = await peopleAt(b.id, edu.key);
                    const trained = people.filter((p) => p.free && p.has);
                    if (trained.length >= want) {
                        if (full) return levelStep(trained.slice(0, want).map((p) => p.pid));
                        const buy = await buyAction(b, c, v, info, d);
                        if (buy.skip) { reasons.push(buy.skip); continue; }
                        return { ...buy, people: trained.slice(0, want).map((p) => p.pid) };
                    }
                    const missing = want - trained.length;
                    const learners = people.filter((p) => p.free && !p.has).slice(0, missing);
                    if (learners.length < missing) {
                        state.wishes[v[4]] = (state.wishes[v[4]] || 0) + 1;
                        reasons.push(`${b.caption}: ${trained.length}/${want} met ${v[4]}, te weinig vrij personeel om op te leiden`);
                        continue;
                    }
                    if (!edu.school) { markBlocked(c.vt, c.value); reasons.push(`${b.caption}: ${v[4]} nodig, geen vrij klaslokaal`); continue; }
                    const seats = Math.min(10, ctx.cfg.trainSeats);
                    const mk = (bb, crew, learn) => ({ building: bb.id, caption: bb.caption, vt: c.vt, need: c.name, stage: 'train', key: edu.key,
                        training: v[4], people: [...crew, ...learn], started: Date.now() });
                    const group = [mk(b, trained.slice(0, want).map((p) => p.pid), learners.map((p) => p.pid))];
                    const firstClass = learners.slice(0, seats);
                    const learnIds = firstClass.map((p) => p.pid); // who goes to the school now
                    if (learners.length > seats) group[0].queue = learners.slice(seats).map((p) => p.pid);
                    // More buildings in the same training, each its own project (train, level,
                    // buy, link): the ones nearest to the most places where the vehicle
                    // was missing, so the new vehicles spread over the problem areas.
                    const hits = new Map();
                    for (const at of (c.t.pos || []).map((p) => [p[0], p[1]])) {
                        const nearest = own.filter((o) => km(posOf(o.b), at) <= ctx.cfg.nearKm * 2).sort((x, y) => km(posOf(x.b), at) - km(posOf(y.b), at))[0];
                        if (nearest) hits.set(nearest.b.id, (hits.get(nearest.b.id) || 0) + 1);
                    }
                    const extraBuildings = own.filter((o) => o.b.id !== b.id && hits.has(o.b.id)).sort((x, y) => hits.get(y.b.id) - hits.get(x.b.id));
                    for (const { b: ob } of extraBuildings) {
                        if (group.length >= ctx.cfg.groupMax || learnIds.length >= seats) break;
                        if (projects().some((p) => p.building === ob.id)) continue;
                        const oinfo = await buildingInfo(ob.id);
                        if (oinfo.exts.some((e) => unlocks(e.text, c.vt))) continue; // needs an extension first
                        if (oinfo.used >= oinfo.max && !(ctx.cfg.doLevels && await nextLevel(ob.id))) continue; // full for good
                        const oleft = (ob.personal_count || 0) - data.vehicles.filter((x) => x.building_id === ob.id).reduce((s, x) => s + crewOf(x.vehicle_type), 0);
                        if (oleft < need) continue;
                        const oppl = await peopleAt(ob.id, edu.key);
                        const otrained = oppl.filter((p) => p.free && p.has).slice(0, want);
                        const olearn = oppl.filter((p) => p.free && !p.has).slice(0, want - otrained.length);
                        if (otrained.length + olearn.length < want || learnIds.length + olearn.length > seats) continue;
                        group.push(mk(ob, otrained.map((p) => p.pid), olearn.map((p) => p.pid)));
                        learnIds.push(...olearn.map((p) => p.pid));
                    }
                    const step = {
                        label: `opleiding ${v[4]} voor ${learnIds.length} pers.: ${group.length} gebouw(en) met project`
                            + ` (voor ${group.length}× ${v[0]}, elk met eigen personeel)`
                            + `${group[0].queue ? `, ${group[0].queue.length} later zodra er een klaslokaal vrij is` : ''}`, cost: 0,
                        run: () => startFull(step, data, edu, learnIds, c.vt, c.at || posOf(b)),
                        check: async () => (await peopleAt(b.id, edu.key)).filter((p) => learnIds.includes(p.pid) && p.idle).length === 0,
                        projects: group,
                    };
                    return step;
                }
                if (full) return levelStep([]);
                const buy = await buyAction(b, c, v, info, d);
                if (buy.skip) { reasons.push(buy.skip); continue; }
                return buy;
            }
            if (upgradeOpt) return upgradeOpt;
            if (!near.length && ctx.cfg.doBuild && c.at) return planBuilding(c, v[3], `voor ${v[0]}`, data);
            return { skip: `${c.name} (${v[0]}): ${reasons.join('; ') || 'geen geschikt gebouw'}` };
        }

        // "Drone Team Politie Drone Team Politie Voertuigen: DB-DRONE Parkeerplaatsen: ..."
        const extName = (text) => {
            const head = String(text).split(/\s(?:Voertuigen:|Parkeerplaatsen:|Biedt|Deze uitbreiding)/)[0].trim();
            const half = head.slice(0, Math.floor(head.length / 2)).trim();
            return half && head === `${half} ${half}` ? half : head;
        };
        const extVehicle = (text) => {
            const list = (String(text).match(/Voertuigen:\s*(.+?)\s*(?:Parkeerplaatsen|$)/) || [])[1];
            if (!list) return null;
            for (const n of list.split(/,\s*|\s+en\s+/)) {
                const vt = vehiclesFor(n.trim())[0];
                if (vt != null) { (state.extVt = state.extVt || {})[extName(text)] = vt; return vt; }
            }
            return null;
        };
        // Extensions still being built (bought here or by hand) whose vehicle the building
        // does not have yet and no project trains for: give them a crew project.
        const EXT_VT = { 'Drone Team Politie': 128, 'Mobiele Eenheid, Aanhoudingseenheid': 64, 'Waterwerper Uitbreiding': 84, 'Waterwerper': 84, 'Bereden Brigade': 73 };
        // Stations without a single vehicle and no project (a build whose follow-up got
        // lost, like Ambulancepost Nijmegen Centrum): give them their first vehicle.
        const EMPTY_KIND = { 0: 'brandweerkazerne', 17: 'brandweerkazerne', 5: 'politiebureau', 18: 'politiebureau', 3: 'ambulancepost', 13: 'ambulancepost' };
        function emptySweep(data) {
            if (!ctx.cfg.doVehicles) return;
            for (const b of data.buildings) {
                const kind = EMPTY_KIND[b.building_type];
                if (!kind || b.enabled === false) continue;
                if (data.vehicles.some((v) => v.building_id === b.id) || projects().some((p) => p.building === b.id)) continue;
                const first = GROW_FILL[kind].first;
                projects().push(ctx.cfg.buildMode
                    ? { building: b.id, caption: b.caption, vt: first, need: `Groei: ${kind}`, stage: 'grow', kind, levels: 0, people: [], started: Date.now() }
                    : { building: b.id, caption: b.caption, vt: first, need: `Groei: ${kind}`, stage: 'buy', people: [], started: Date.now() });
                addLog(`project: eerste voertuig voor ${b.caption} (nog geen voertuigen)`, 'idle');
            }
        }
        function prepSweep(data) {
            for (const b of data.buildings) {
                for (const x of b.extensions || []) {
                    if (x.available !== false) continue;
                    const vt = (state.extVt || {})[x.caption] ?? EXT_VT[x.caption];
                    if (vt == null || !VT[vt]) continue;
                    if (data.vehicles.some((v) => v.building_id === b.id && v.vehicle_type === vt)) continue;
                    const made = prepProject(b, vt, `uitbreiding ${x.caption}`);
                    if (made.length) { projects().push(...made); addLog(`project: personeel voor ${VT[vt][0]} in ${b.caption} (uitbreiding ${x.caption} wordt gebouwd)`, 'idle'); }
                }
            }
        }
        // After buying an extension that brings a vehicle: a project that trains its crew
        // now, while the extension is being built, then buys and links (see advanceProjects).
        // Several per building are fine (Drone Team and ME-AE at Veenendaal): each has its
        // own vehicle and its own people; only the same vehicle twice is not.
        const prepProject = (b, vt, need) => (vt == null || projects().some((p) => p.building === b.id && p.vt === vt) ? []
            : [{ building: b.id, caption: b.caption, vt, need, stage: 'prep', ext: true, people: [], started: Date.now() }]);

        // Staff a building still has for one more vehicle: its people minus the crews of
        // its vehicles and of the vehicles its running projects will buy.
        function staffLeft(b, data) {
            const crews = data.vehicles.filter((x) => x.building_id === b.id).reduce((sum, x) => sum + crewOf(x.vehicle_type), 0);
            const planned = projects().filter((p) => p.building === b.id && p.stage !== 'assign').reduce((sum, p) => sum + crewOf(p.vt), 0);
            return (b.personal_count || 0) - crews - planned;
        }
        async function planExtension(c, data, tries = 3) {
            const ref = c.at || data.home;
            const own = data.buildings.filter((b) => c.types.includes(b.building_type))
                .map((b) => ({ b, d: km(posOf(b), ref) })).sort((a, b) => a.d - b.d).slice(0, tries);
            const why = [];
            const fits = [];
            let upgrade = null; // a small station where this extension failed: upgrade it if nothing else fits
            for (const { b, d } of own) {
                const info = await buildingInfo(b.id);
                const ext = info.exts.find((e) => c.match.test(e.text));
                if (!ext || !ext.cost || !ctx.cfg.doExtensions) continue;
                const blockedHow = extBlocked(b, ext);
                if (blockedHow === 'small') {
                    const evt = extVehicle(ext.text);
                    const crewOk = evt == null || staffLeft(b, data) >= crewOf(evt);
                    if (!upgrade && crewOk && !upgrading(b) && info.smallExpand && info.smallExpand.cost && ctx.cfg.doLevels && !projects().some((p) => p.building === b.id)) upgrade = { b, se: info.smallExpand, ext };
                    why.push(`${b.caption}: uitbreiding lukte niet, klein station${upgrading(b) ? ' (wordt uitgebouwd)' : ', eerst uitbouwen tot groot'}`);
                    continue;
                }
                if (blockedHow === 'failed') { why.push(`${b.caption}: lukte eerder niet`); continue; }
                const vt = extVehicle(ext.text);
                // The vehicle needs people: this building must have them to spare. Four
                // extensions went to Veenendaal (15 people needed) because it was nearest.
                const left = staffLeft(b, data);
                if (vt != null && left < crewOf(vt)) { why.push(`${b.caption}: personeel ${Math.max(0, left)}/${crewOf(vt)} over`); continue; }
                // No parking of its own ("Maakt het mogelijk om STH voertuigen te kopen."):
                // the vehicles use normal spots, so a full building at its top level is no use.
                if (vt != null && !/Parkeerplaatsen/i.test(ext.text) && info.used != null && info.max != null && info.used >= info.max
                    && !(ctx.cfg.doLevels && await nextLevel(b.id))) { why.push(`${b.caption}: vol, hoogste level`); continue; }
                fits.push({ b, d, ext, vt, left });
            }
            // Among the buildings that can take it: the most spare people first, then the nearest.
            fits.sort((x, y) => (y.left - x.left) || (x.d - y.d));
            const f = fits[0];
            if (f) {
                return extStep(f.b, f.ext, `uitbreiding "${extName(f.ext.text)}" in ${f.b.caption}`, { projects: prepProject(f.b, f.vt, c.name) });
            }
            if (upgrade) return upgradeStep(upgrade.b, upgrade.se, `uitbreiding "${extName(upgrade.ext.text)}" lukte niet in de kleine post`);
            return { skip: `${c.name}: ${why.join('; ') || 'geen gebouw in de buurt om uit te breiden'}` };
        }

        // New mission types: an extension where one can be bought (cheaper), else a
        // new building near the dispatch centre.
        async function planUnlock(c, data) {
            const why = `${c.unlockCount} nieuwe meldingen, o.a. ${c.examples.slice(0, 2).join(', ')}`;
            if (c.def.ext && ctx.cfg.doExtensions) {
                // Which building type sells this extension is learned once (the nearest
                // building of every own type is looked at) and remembered, e.g. Drone
                // Team Politie and Aanhoudingseenheid: Politiebureau (type 11).
                state.extTypes = state.extTypes || {};
                let types = state.extTypes[c.key];
                if (!types) {
                    const ref = data.home;
                    const firstOfType = {};
                    for (const b of data.buildings) {
                        if (SCHOOL_TYPES.includes(b.building_type) || b.building_type === 1) continue;
                        const cur = firstOfType[b.building_type];
                        if (!cur || km(posOf(b), ref) < km(posOf(cur), ref)) firstOfType[b.building_type] = b;
                    }
                    types = [];
                    for (const b of Object.values(firstOfType)) {
                        if ((await buildingInfo(b.id)).exts.some((e) => c.def.ext.test(e.text))) types.push(b.building_type);
                    }
                    // Not offered anywhere (yet): look again in a day.
                    if (types.length) state.extTypes[c.key] = types;
                    else state.cool[c.name] = Date.now() + 24 * 3600000;
                }
                if (types.length) {
                    const ext = await planExtension({ ...c, types, match: c.def.ext, at: data.home }, data, 12);
                    if (!ext.skip) return { ...ext, label: `${ext.label} (${why})` };
                    if (!c.def.types || !ctx.cfg.doBuild) return { skip: `${c.name}: alle ${ext.skip.split(': ').pop()}` };
                }
            }
            if (c.def.types && ctx.cfg.doBuild) return planBuilding({ ...c, at: data.home }, c.def.types, why, data, 80);
            return { skip: `${c.name}: geen eigen gebouw biedt deze uitbreiding aan${c.def.types ? '' : ' (en het is geen los gebouw)'}` };
        }

        // Real posts from the Plaatsingsadvies data (1x1 degree tiles on GitHub).
        const CAT_OF = { 0: 'F', 17: 'F', 3: 'A', 13: 'A', 2: 'H', 5: 'P', 11: 'P', 18: 'P', 6: 'L', 9: 'L', 21: 'L', 16: 'W', 19: 'W', 22: 'R', 24: 'T', 25: 'M' };
        const tiles = {};
        async function postsNear(at) {
            const out = [];
            for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
                const key = `${Math.floor(at[0]) + dl}_${Math.floor(at[1]) + dn}`;
                if (!(key in tiles)) {
                    try { tiles[key] = (await (await fetch(`${DATA_BASE}${key}.json`)).json()).posts || []; } catch (e) { tiles[key] = []; }
                }
                out.push(...tiles[key]);
            }
            return out;
        }
        /* Schools: trainings that wait for a classroom are counted per school type each
         * round. Blocked for 2 hours or more: an "Extra klaslokaal" at an own school of
         * that type (400k, 7 days), or when none can be added, a new academy (500k). */
        const schoolFor = (vt) => {
            const t = (VT[vt] || [])[3] || [];
            if (t.some((x) => [5, 11, 18].includes(x))) return 8;      // police academy
            if (t.some((x) => [0, 17].includes(x))) return 4;          // fire academy
            if (t.some((x) => [2, 3, 6, 13].includes(x))) return 7;    // medical faculty
            if (t.some((x) => [16, 19, 21].includes(x))) return 20;    // SAR academy
            if (t.includes(25)) return 26;                             // military academy
            return null;
        };
        const SCHOOL_NAME = { 4: 'brandweeracademie', 7: 'faculteit geneeskunde', 8: 'politieacademie', 20: 'SAR academie', 26: 'militaire academie' };
        const SCHOOL_CAT = { 4: 'F', 7: 'H', 8: 'P', 20: 'W', 26: 'M' };
        let blocked = {};
        function markBlocked(vt, value) {
            const t = schoolFor(vt);
            if (t == null) return;
            blocked[t] = (blocked[t] || 0) + (value || 20000);
        }
        function updateBlocked() {
            state.classBlocked = state.classBlocked || {};
            for (const t of Object.keys(state.classBlocked)) if (!blocked[t]) delete state.classBlocked[t];
            for (const [t, v] of Object.entries(blocked)) state.classBlocked[t] = { since: (state.classBlocked[t] || {}).since || Date.now(), value: v };
        }
        async function planSchools(data) {
            const out = [];
            for (const [t, b] of Object.entries(state.classBlocked || {})) {
                const type = Number(t);
                const hours = (Date.now() - b.since) / 3600000;
                if (hours < 2) continue;
                const need = `Klaslokalen ${SCHOOL_NAME[type] || type}`;
                if ((state.cool[need] || 0) > Date.now()) continue;
                // Classrooms are used again and again: value the blocked trainings three times.
                const value = b.value * 3;
                const why = `opleidingen wachten al ${Math.floor(hours)} u op een klaslokaal`;
                const schools = data.buildings.filter((x) => x.building_type === type);
                if (schools.some((x) => (x.extensions || []).some((e) => /klaslokaal/i.test(e.caption || '') && e.available === false))) continue; // one is coming
                let plan = null;
                for (const sb of schools) {
                    const info = await buildingInfo(sb.id);
                    const ext = info.exts.find((e) => /klaslokaal/i.test(e.text) && e.cost);
                    if (ext && ctx.cfg.doExtensions) {
                        plan = { label: `extra klaslokaal in ${sb.caption} (${why})`, cost: ext.cost,
                            run: () => hit(ext.href, true), check: async () => !(await buildingInfo(sb.id)).exts.some((e) => e.id === ext.id) };
                        break;
                    }
                }
                if (!plan && ctx.cfg.doBuild) {
                    const p = await planBuilding({ name: need, at: data.home }, [type], why, data, 60, { cat: SCHOOL_CAT[type], prefix: SCHOOL_NAME[type] });
                    if (!p.skip) plan = p;
                    else skipped.push(p.skip);
                }
                if (plan) out.push({ ...plan, need, value, ratio: value / Math.max(plan.cost, 2000) });
            }
            return out;
        }

        /* Growth: more buildings, more missions. Per kind (fire, police, ambulance) the
         * free real post nearest to any own building (3 km at least from the own ones
         * of that kind, no limit from the dispatch centre), valued at the average weekly
         * income per building. After building it, a project buys its first vehicle. */
        // The small kinds (Brandweerkazerne (klein), Politieopkomstbureau (klein)) are
        // cheaper: fewer parking spots, but more new areas for the money. Both go into the
        // ranking; the better return wins. No wait between builds: a spot just built on is
        // skipped for 30 minutes instead (recentSpots), as the API can lag behind.
        const GROW = [
            { types: [0, 17], same: [0, 17], vt: 1, name: 'brandweerkazerne' },
            { types: [5, 18], same: [5, 11, 18], vt: 22, name: 'politiebureau' },
            { types: [3, 13], same: [3, 13], vt: 16, name: 'ambulancepost' }, // 13 = Ambulance, VWS-post (100k vs 200k)
        ];
        // Build mode: per kind the levels its first staff can man and its first vehicle
        // (fire: TST 4/5, ambulance post: ambulance, police: DA Noodhulp). The rest of
        // the spots: the most valuable shortage that fits and needs no training.
        const GROW_FILL = {
            brandweerkazerne: { levels: 2, first: 8 },
            ambulancepost: { levels: 1, first: 16 },
            politiebureau: { levels: 0, first: 22 },
        };
        // Spots built on in the last 30 minutes: the API can take a while to list the new
        // building, and without this the next round could build on the same post again.
        function recentSpots() {
            state.recentSpots = (state.recentSpots || []).filter((x) => Date.now() - x[2] < 30 * 60000);
            return state.recentSpots.map((x) => [x[0], x[1]]);
        }
        // A city name -> its centre and outline box (OpenStreetMap Nominatim), kept for a week.
        async function cityArea(name) {
            const key = name.toLowerCase();
            state.cities = state.cities || {};
            let c = state.cities[key];
            if (!c || Date.now() - c.at > 7 * 86400000) {
                try {
                    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de&q=${encodeURIComponent(name)}`;
                    const r = (await (await fetch(url)).json())[0];
                    c = r ? { at: Date.now(), center: [Number(r.lat), Number(r.lon)], box: r.boundingbox.map(Number), name: r.display_name.split(',')[0] } : null;
                } catch (e) { c = null; }
                if (!c) { skipped.push(`Bouwmodus: stad "${name}" niet gevonden`); return null; }
                state.cities[key] = c;
            }
            // boundingbox = [south, north, west, east]; a little margin for posts on the edge.
            const [s, n, w, e] = c.box;
            const m = 0.005;
            return { name: c.name, center: c.center, inside: (p) => p[0] >= s - m && p[0] <= n + m && p[1] >= w - m && p[1] <= e + m };
        }
        async function planGrow(data) {
            const out = [];
            if (!ctx.cfg.buildMode && !ctx.cfg.doGrow) return out;
            if (!ctx.cfg.buildMode && !ctx.cfg.doBuild) { skipped.push('Groei: "Nieuwe gebouwen" staat uit'); return out; }
            const rate = incomeRate();
            if (!rate || !rate.perHour) return out;
            const withVehicles = data.buildings.filter((b) => !NO_VEHICLES.has(b.building_type)).length || 1;
            const value = (rate.perHour * 168) / withVehicles;
            // Real posts around every own building (1x1 degree tiles, each fetched once).
            const seen = new Set();
            const posts = [];
            for (const b of data.buildings) {
                const key = `${Math.floor(Number(b.latitude))}_${Math.floor(Number(b.longitude))}`;
                if (seen.has(key)) continue;
                seen.add(key);
                for (const p of await postsNear(posOf(b))) posts.push(p);
            }
            // Build mode with a city: its free real posts first, nearest to its centre.
            const city = ctx.cfg.buildMode && String(ctx.cfg.buildCity || '').trim() ? await cityArea(String(ctx.cfg.buildCity).trim()) : null;
            if (city) for (const p of await postsNear(city.center)) posts.push(p);
            const uniq = [...new Set(posts)]; // neighbouring tiles overlap
            const owned = [...data.buildings.map(posOf), ...recentSpots()];
            for (const g of GROW) {
                const need = `Groei: ${g.name}`;
                if ((state.cool[need] || 0) > Date.now()) continue;
                // Plus ones of this kind built in the last 30 minutes that the API may not list yet.
                const mine = [...data.buildings.filter((b) => g.same.includes(b.building_type)).map(posOf),
                    ...(state.recentSpots || []).filter((x) => x[3] === CAT_OF[g.types[0]]).map((x) => [x[0], x[1]])];
                let best = null;
                if (city) {
                    for (const p of uniq) {
                        if (p[2] !== CAT_OF[g.types[0]] || !city.inside(p)) continue;
                        const at = [p[0], p[1]];
                        if (owned.some((o) => km(o, at) < 0.3)) continue;
                        const mid = km(city.center, at);
                        if (!best || mid < best.mid) best = { at, mid, why: `${city.name}: ${mid.toFixed(1)} km van het centrum` };
                    }
                    if (!best) skipped.push(`Groei: ${g.name}: geen vrije echte post meer in ${city.name}, verder rond je gebouwen`);
                }
                if (!best) for (const p of uniq) {
                    if (p[2] !== CAT_OF[g.types[0]]) continue;
                    const at = [p[0], p[1]];
                    if (owned.some((o) => km(o, at) < 0.3)) continue;
                    // Not on top of one of this kind (3 km at least, so it covers new ground),
                    // and of those the one nearest to anything you have: the network grows
                    // outward step by step instead of jumping to far gaps (long drives).
                    const gap = mine.length ? Math.min(...mine.map((o) => km(o, at))) : 99;
                    if (gap < 3) continue;
                    const near = Math.min(...owned.map((o) => km(o, at)));
                    if (!best || near < best.near) best = { at, gap, near, why: `groei: ${near.toFixed(1)} km van je dichtstbijzijnde gebouw, ${gap.toFixed(1)} km van je dichtstbijzijnde ${g.name}` };
                }
                if (!best) continue;
                // Full-size and small for the same spot: only the better return goes on the list.
                let pick = null;
                for (const type of g.types) {
                    const plan = await planBuilding({ name: need, at: best.at }, [type], best.why, data, 0.5);
                    if (plan.skip) { skipped.push(plan.skip); continue; }
                    if (pick && plan.cost >= pick.cost) continue;
                    const run = plan.run;
                    // Build mode: new posts win outright, taking turns between fire, police and
                    // ambulance (else the 100k VWS-post would always be cheapest).
                    const boost = !ctx.cfg.buildMode ? 1 : g.name === state.growLast ? 100 : 1000;
                    pick = { ...plan, need, value, ratio: (boost * value) / Math.max(plan.cost, 2000),
                        run: async () => {
                            const before = new Set(data.buildings.map((b) => b.id));
                            await run();
                            state.growLast = g.name;
                            await sleep(1500);
                            // Its first vehicle as a project: bought as soon as the game sells it.
                            // The API lists small ones as the normal kind with small_building set.
                            const kind = { 17: 0, 18: 5, 13: 3 }[type] ?? type;
                            let nb = null;
                            for (let i = 0; i < 10 && !nb; i++) {
                                nb = (await api('/api/buildings')).find((b) => !before.has(b.id) && (b.building_type === type || b.building_type === kind));
                                if (!nb) await sleep(2000);
                            }
                            if (nb && ctx.cfg.buildMode) projects().push({ building: nb.id, caption: nb.caption, vt: g.vt, need, stage: 'grow', kind: g.name, levels: 0, people: [], started: Date.now() });
                            else if (nb) projects().push({ building: nb.id, caption: nb.caption, vt: g.vt, need, stage: 'buy', people: [], started: Date.now() });
                        } };
                }
                if (pick) out.push(pick);
            }
            return out;
        }

        // A new building of one of these types on the nearest free real post.
        const NO_NEW_BUILDING = new Set([6, 9, 21, 23, 24]); // trauma, police and SAR helicopters, military hangar, tow trucks
        async function planBuilding(c, buildTypes, why, data, maxKm = ctx.cfg.nearKm * 2, opts = {}) {
            const type = buildTypes.find((t) => CAT_OF[t] && ![17, 18].includes(t)) ?? buildTypes[0];
            // Helicopter bases and tow-truck posts: the OSM data does not place these well
            // enough yet. Never built new; existing ones still get levels and vehicles.
            if (NO_NEW_BUILDING.has(type)) return { skip: `${c.name}: geen nieuw gebouw voor dit type (helikopter/berger), alleen bestaande uitbreiden` };
            const cat = opts.cat || CAT_OF[type];
            if (!cat) return { skip: `${c.name}: geen echte post voor gebouwtype ${type}` };
            const owned = [...data.buildings.map(posOf), ...recentSpots()];
            const posts = (await postsNear(c.at)).filter((p) => p[2] === cat)
                .map((p) => ({ p, d: km([p[0], p[1]], c.at) }))
                .filter((x) => x.d <= maxKm && !owned.some((o) => km(o, [x.p[0], x.p[1]]) < 0.3))
                .sort((a, b) => a.d - b.d);
            if (!posts.length) return { skip: `${c.name}: geen vrije echte post binnen ${maxKm} km` };
            const post = posts[0].p;
            const bname = opts.prefix ? `${opts.prefix[0].toUpperCase()}${opts.prefix.slice(1)} ${post[3]}` : post[3];
            const doc = await getDoc('/buildings/new');
            const form = [...doc.forms].find((f) => /\/buildings$/.test(f.getAttribute('action') || ''));
            const btn = form && form.querySelector(`#build_credits_${type}`);
            if (!btn) return { skip: `${c.name}: gebouwtype ${type} niet te bouwen` };
            const cost = num(btn.value);
            return {
                label: `nieuw gebouw "${bname}" (${posts[0].d.toFixed(1)} km, ${why})`, cost, newBuilding: true,
                run: () => {
                    const fd = new FormData(form);
                    fd.set('building[building_type]', String(type));
                    fd.set('building[name]', bname);
                    fd.set('building[latitude]', String(post[0]));
                    fd.set('building[longitude]', String(post[1]));
                    fd.set('build_with_coins', '');
                    const ls = [...form.querySelectorAll('select[name="building[leitstelle_building_id]"] option')].find((o) => o.value);
                    if (ls) fd.set('building[leitstelle_building_id]', ls.value);
                    fd.set('commit', btn.value);
                    state.recentSpots = [...(state.recentSpots || []), [post[0], post[1], Date.now(), post[2]]];
                    save(); // a reload during the purchase must not lose it
                    return hit('/buildings', new URLSearchParams(fd));
                },
                // One building more than before (the price check failed for the VWS-post,
                // which always costs 100,000). The API can lag, so look a few times.
                check: async () => {
                    // One building more, or the credits went down by about its price: the API
                    // can take well over 10 seconds to list a new building.
                    for (let i = 0; i < 8; i++) {
                        if ((await api('/api/buildings')).length > data.buildings.length) return true;
                        const c = await api('/api/credits');
                        if (Number(c.credits_user_current) <= data.credits - cost * 0.9) return true;
                        await sleep(3000);
                    }
                    return false;
                },
            };
        }

        /* ========================================================================
         * HIRING — free, so done for every building that needs it, each round:
         * "Personeel (Doel)" to the target and the hiring phase on "Automatisch".
         * ==================================================================== */
        const NO_STAFF = new Set([1, 2, 4, 7, 8, 10, 20, 26]);
        async function fixHiring(data) {
            let n = 0;
            for (const b of data.buildings) {
                if (n >= 10 || stopped) break;
                if (NO_STAFF.has(b.building_type) || !('personal_count_target' in b)) continue;
                const target = ctx.cfg.hireTarget;
                if (b.personal_count_target === target && b.hiring_automatic) continue;
                try {
                    if (b.personal_count_target !== target) {
                        const doc = await getDoc(`/buildings/${b.id}/personalCountTarget`);
                        const form = doc.forms[0];
                        const fd = new FormData(form);
                        fd.set('building[personal_count_target]', String(target));
                        await hit(form.getAttribute('action'), new URLSearchParams(fd));
                    }
                    if (!b.hiring_automatic) await hit(`/buildings/${b.id}/hire_do/automatic`);
                    addLog(`werving: ${b.caption} op automatisch, doel ${target}`, 'idle');
                } catch (e) {
                    addLog(`werving mislukt: ${b.caption} (${e.message})`, 'warn');
                }
                n++;
                await sleep(800);
            }
        }

        /* ========================================================================
         * ROUND — hiring, then one purchase if the credits allow it.
         * ==================================================================== */
        /* Income per hour, for when a saved-for step can be paid: the samples of the
         * Inkomsten module ([seconds, balance, total earned], shared GM storage) over
         * the last 7 days per wall-clock hour, so offline hours count too. Without
         * them, its own samples of the total earned (one per round). */
        function incomeRate() {
            const from = Date.now() / 1000 - 7 * 86400;
            let samples = [];
            try { samples = (JSON.parse(GM_getValue('incomeTracker.samples.v1', '[]')) || []).filter((x) => x[0] >= from); } catch (e) { /* none */ }
            let src = 'Inkomsten';
            if (samples.length < 2) { samples = (state.earn || []).filter((x) => x[0] >= from).map((x) => [x[0], 0, x[1]]); src = 'eigen metingen'; }
            if (samples.length < 2) return null;
            const a = samples[0];
            const b = samples[samples.length - 1];
            const hours = (b[0] - a[0]) / 3600;
            if (hours < 1) return null;
            return { perHour: Math.max(0, (b[2] - a[2]) / hours), hours, src };
        }
        function recordEarn(total) {
            if (!Number.isFinite(Number(total))) return;
            state.earn = state.earn || [];
            const now = Math.floor(Date.now() / 1000);
            const last = state.earn[state.earn.length - 1];
            if (last && now - last[0] < 600) return;
            state.earn.push([now, Number(total)]);
            if (state.earn.length > 1100) state.earn.splice(0, state.earn.length - 1100);
        }
        // How long until "cost" can be paid with the buffer kept: null = now.
        function etaFor(cost, credits) {
            const missing = ctx.cfg.buffer + cost - credits;
            if (missing <= 0) return { now: true };
            const rate = incomeRate();
            if (!rate || !rate.perHour) return { unknown: true, missing };
            const ms = (missing / rate.perHour) * 3600000;
            return { ms, at: Date.now() + ms, missing };
        }
        function etaText(e) {
            if (!e || e.now) return 'nu';
            if (e.unknown) return 'onbekend';
            const m = Math.round(e.ms / 60000);
            const span = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${Math.round(m / 1440)} dagen`;
            const at = new Date(e.at).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            return `~${span} (${at})`;
        }

        async function loadData() {
            const [buildings, vehicles, credits] = await Promise.all([api('/api/buildings'), api('/api/vehicles'), api('/api/credits')]);
            const byId = Object.fromEntries(buildings.map((b) => [b.id, b]));
            const ls = buildings.find((b) => b.building_type === 1) || buildings[0];
            return { buildings, vehicles, byId, credits: credits.credits_user_current, total: credits.credits_user_total, home: ls ? posOf(ls) : [52.1, 5.3] };
        }

        async function round() {
            if (busy || stopped) return;
            const other = lockHolder();
            if (other) {
                const ago = (t) => `${Math.round((Date.now() - t) / 1000)} s`;
                const who = other.since ? ` (pagina ${other.url}, versie ${other.version}, gestart ${ago(other.since)} geleden)` : ' (oude versie, of de vorige pagina is net herladen)';
                ctx.status(`Draait al in een ander tabblad${who}. Nieuwe poging over 40 seconden.`, { tone: 'warn' });
                addLog(`wacht op ander tabblad${who}`, 'warn');
                setTimeout(() => { if (!stopped) round(); }, 40000);
                return;
            }
            busy = true;
            takeLock();
            try {
                const data = await loadData();
                if (ctx.cfg.doHire) await fixHiring(data);
                const spendable = data.credits - ctx.cfg.buffer;
                recordEarn(data.total);
                skipped = [];
                blocked = {};
                eduCache = null;
                prepSweep(data);
                emptySweep(data);
                // Running projects first: their free steps now, their paid step before new needs.
                next = await advanceProjects(data);
                if (!next) {
                    if (Date.now() - unlocksAt > 3600000) { await computeUnlocks(data); unlocksAt = Date.now(); }
                    // Plan the most valuable needs, then take the step with the most blocked
                    // credits per credit spent (a free training step wins outright).
                    ranking = [];
                    const cands = candidates(readNeeds());
                    if (ctx.cfg.doVehicles) {
                        await scanSpots(data);
                        for (const r of await planSpots(cands, data)) ranking.push(r);
                    }
                    for (const c of cands.slice(0, ctx.cfg.planDepth)) {
                        if (stopped) return;
                        const plan = c.kind === 'ext' ? await planExtension(c, data)
                            : c.kind === 'unlock' ? await planUnlock(c, data) : await planVehicle(c, data);
                        if (plan.skip) { skipped.push(plan.skip); continue; }
                        ranking.push({ need: c.name, value: c.value, ...plan, ratio: c.value / Math.max(plan.cost, 2000) });
                    }
                    updateBlocked();
                    for (const r of await planSchools(data)) ranking.push(r);
                    for (const r of await planGrow(data)) ranking.push(r);
                    ranking.sort((a, b) => b.ratio - a.ratio);
                    for (const r of ranking) r.eta = etaFor(r.cost, data.credits);
                    next = ranking[0] || null;
                }
                // Saved, so Log naar GitHub uploads them from any tab.
                state.lastRound = { at: Date.now(), credits: data.credits, spendable, skipped,
                    spots: { scanned: Object.keys(state.spots || {}).length, free: Object.values(state.spots || {}).filter((f) => f.max > f.used).length }, next: next ? { label: next.label, cost: next.cost, need: next.need } : null,
                    ranking: ranking.map(({ need, label, cost, value, ratio, eta }) => ({ need, label, cost, value: Math.round(value || 0), ratio: Math.round((ratio || 0) * 1000) / 1000, eta: etaText(eta) })),
                    income: incomeRate(), classBlocked: state.classBlocked };
                if (!next) {
                    ctx.status(skipped.length ? 'Niets te kopen nu (zie "Overgeslagen").' : 'Geen tekorten om op te lossen.', { tone: 'idle' });
                    return;
                }
                if (next.cost > spendable) {
                    state.lastRound.result = `spaart: ${next.cost} nodig, ${Math.max(0, spendable)} vrij boven de buffer`;
                    const eta = etaText(etaFor(next.cost, data.credits));
                    state.lastRound.eta = eta;
                    ctx.status(`Spaart voor ${next.label}: ${ctx.nl(next.cost)} nodig, ${ctx.nl(Math.max(0, spendable))} vrij boven de buffer. Genoeg over ${eta}.`, { tone: 'idle' });
                    return;
                }
                ctx.status(`Bezig: ${next.label}`, { tone: 'busy', dock: true });
                lastSaid = '';
                await next.run();
                await sleep(1500);
                // Checked on the game's pages: /api/buildings and /api/credits lag behind
                // (tested: a bought level and ambulance only showed there later).
                if (await next.check()) {
                    failStreak = 0;
                    unlocksAt = 0; // what is unlocked may have changed
                    // A new building: plan its vehicle again soon, not after half an hour.
                    // Growth has no wait: the next post may follow at once (recentSpots keeps it off this one).
                    if (!String(next.need).startsWith('Groei:')) state.cool[next.need] = Math.max(state.cool[next.need] || 0, Date.now() + (next.newBuilding ? 5 : 30) * 60000);
                    if (next.cost) {
                        state.bought = state.bought || {};
                        const list = (state.bought[next.need] = (state.bought[next.need] || []).filter((x) => x > Date.now() - 7 * 86400000));
                        list.push(Date.now());
                    }
                    addLog(`${next.cost ? 'gekocht' : 'gestart'}: ${next.label}`, 'ok', next.cost);
                    ctx.status(`Gedaan: ${next.label}`, { tone: 'ok' });
                    state.lastRound.result = 'gedaan';
                    // Training started: a new project. Vehicle bought for trained people
                    // (now, or the buy step of a project): find it and assign them next.
                    if (next.done) next.done();
                    for (const p of next.projects || []) if (!projects().includes(p)) projects().push(p);
                    const people = next.project && next.project.stage === 'buy' ? next.project.people : next.people;
                    if (next.project && next.project.stage === 'buy' && !(people && people.length)) {
                        state.projects = projects().filter((x) => x !== next.project);
                    } else if (people && people.length && next.before) {
                        const fresh = (await buildingInfo(next.building)).vehicleIds.filter((id) => !next.before.includes(id));
                        if (fresh.length) {
                            const p = next.project && next.project.stage === 'buy' ? next.project
                                : { building: next.building, caption: data.byId[next.building]?.caption, vt: next.vt, training: VT[next.vt]?.[4], need: next.need, started: Date.now() };
                            Object.assign(p, { stage: 'assign', vehicle: fresh[fresh.length - 1], people, assignTries: 0 });
                            if (!projects().includes(p)) projects().push(p);
                        }
                    }
                } else {
                    state.cool[next.need] = Date.now() + 60 * 60000;
                    const why = (next.onFail && await next.onFail()) || {};
                    addLog(`niet gelukt: ${next.label}${lastSaid ? ` (spel: "${lastSaid}")` : ''}${why.note ? ` — ${why.note}` : ''}`, why.known ? 'warn' : 'error');
                    if (state.lastRound) state.lastRound.result = 'niet gelukt';
                    // A failure the script understands (an extension a small station cannot
                    // have yet) is handled, not a reason to stop everything.
                    if (!why.known && ++failStreak >= 3) { stopped = true; ctx.status('Gestopt na 3 mislukte aankopen op rij. Zet de module uit en aan om opnieuw te starten.', { tone: 'error' }); }
                }
            } catch (e) {
                ctx.err(e);
                addLog(`fout: ${e.message}`, 'error');
            } finally {
                busy = false;
                save();
                ctx.refresh();
            }
        }

        // One tab at a time (heartbeat in localStorage, like Automatisch alarmeren).
        function lockHolder() {
            try {
                const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                return l && l.inst !== INSTANCE && Date.now() - l.at < 30000 ? l : null;
            } catch (e) { return null; }
        }
        const takeLock = () => { try { localStorage.setItem(LOCK_KEY, JSON.stringify({ inst: INSTANCE, at: Date.now(), since: STARTED, url: location.pathname + location.search, version: '{{VERSION}}' })); } catch (e) { /* ignore */ } };
        const heartbeat = setInterval(() => { if (!lockHolder()) takeLock(); }, 10000);
        // Let go on reload or close, or the reloaded page waits 30 s for its own old lock
        // ("Draait al in een ander tabblad" with only one tab open).
        const releaseLock = () => { try { const l = JSON.parse(localStorage.getItem(LOCK_KEY)); if (l && l.inst === INSTANCE) localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ } };
        window.addEventListener('pagehide', releaseLock);

        ctx.panel((el) => {
            const day = new Date().toISOString().slice(0, 10);
            const tone = { ok: 't-ok', warn: 't-warn', error: 't-error', idle: '' };
            const wishes = Object.entries(state.wishes).sort((a, b) => b[1] - a[1]);
            el.innerHTML = `<div class="mks-tiles">
                    <div class="mks-tile"><div class="v">${ctx.nl(state.spent[day] || 0)}</div><div class="k">uitgegeven vandaag</div></div>
                    <div class="mks-tile"><div class="v">${ctx.nl(ctx.cfg.buffer)}</div><div class="k">buffer</div></div>
                </div>
                ${projects().length ? `<h4 class="mks-h">Projecten (opleiden → kopen → koppelen)</h4>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Voertuig</th><th>Gebouw</th><th>Stap</th><th>Sinds</th></tr></thead><tbody>
                    ${projects().map((p) => `<tr><td>${esc(VT[p.vt]?.[0] || p.vt)}</td><td>${esc(p.caption || '')}</td>
                        <td>${{ train: `opleiding ${esc(p.training || '')} (${p.people.length} pers.)`, buy: 'kopen', assign: 'personeel koppelen' }[p.stage] || p.stage}${p.wait ? ` <span class="mks-dim">— ${esc(p.wait)}</span>` : ''}</td>
                        <td class="mono mks-dim">${new Date(p.started).toLocaleDateString('nl-NL')}</td></tr>`).join('')}</tbody></table></div>` : ''}
                ${ranking.length ? `<h4 class="mks-h">Afweging (beste rendement eerst)</h4>
                    <p class="mks-note">Waarde = credits van inzetten die hierdoor misten in 7 dagen (speciale voertuigen ×${ctx.cfg.specialWeight}),
                    of van nieuwe meldingsoorten. Rendement = waarde per uitgegeven credit.</p>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Stap</th><th>Waarde</th><th>Kosten</th><th>Rendement</th><th>Te betalen</th></tr></thead><tbody>
                    ${ranking.map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${ctx.nl(r.value)}</td><td class="mono">${ctx.nl(r.cost)}</td>
                        <td class="mono">${r.cost ? r.ratio.toFixed(2) : 'gratis'}</td><td class="mono">${r.cost ? esc(etaText(r.eta)) : 'nu'}</td></tr>`).join('')}</tbody></table></div>` : ''}
                <h4 class="mks-h">Volgende stap</h4>
                <p class="mks-note">${next ? `${esc(next.label)} — ${ctx.nl(next.cost)} credits` : 'Nog niets gepland.'}</p>
                ${(() => { const r = incomeRate(); return `<p class="mks-note">Inkomen: ${r ? `${ctx.nl(r.perHour)} credits per uur (gemiddeld over ${Math.round(r.hours)} u, ${esc(r.src)})` : 'nog onbekend (zet Inkomsten aan, of wacht een uur)'}. "Te betalen" = wanneer er genoeg is met de buffer erbij.</p>`; })()}
                ${skipped.length ? `<h4 class="mks-h">Overgeslagen</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${skipped.map((s) => `<tr><td>${esc(s)}</td></tr>`).join('')}</tbody></table></div>` : ''}
                ${wishes.length ? `<h4 class="mks-h">Opleidingen nodig</h4>
                    <p class="mks-note">Voertuigen die het niet kocht omdat opgeleid personeel ontbrak. Start deze opleidingen (nog niet automatisch).</p>
                    <div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${wishes.map(([n, k]) => `<tr><td>${esc(n)}</td><td class="mono">${k}</td></tr>`).join('')}</tbody></table></div>` : ''}
                <h4 class="mks-h">Logboek</h4>
                ${state.log.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                    ${state.log.slice(0, 100).map((l) => `<tr><td class="mono">${new Date(l.at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td><span class="mks-pill ${tone[l.tone] || ''}">${esc(l.text)}</span></td><td class="mono">${l.cost ? ctx.nl(l.cost) : ''}</td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="mks-note">Nog niets gedaan.</p>'}`;
        });
        ctx.actions([
            { label: 'Nu een stap', kind: 'primary', run: () => round() },
            { label: 'Wachttijden wissen', run: () => { state.cool = {}; save(); ctx.refresh(); }, title: 'Tekorten die net zijn aangepakt mogen meteen weer.' },
            { label: 'Opleidingslijst wissen', run: () => { state.wishes = {}; save(); ctx.refresh(); } },
        ]);

        const first = setTimeout(round, 20000);
        let timer = setInterval(round, ctx.cfg.intervalMin * 60000);
        ctx.onSettings((cfg, key) => {
            if (key === 'intervalMin') { clearInterval(timer); timer = setInterval(round, ctx.cfg.intervalMin * 60000); }
            ctx.refresh();
        });
        ctx.status('Start over 20 seconden.', { tone: 'idle' });

        return {
            stop() {
                stopped = true;
                clearTimeout(first);
                clearInterval(timer);
                clearInterval(heartbeat);
                window.removeEventListener('pagehide', releaseLock);
                releaseLock();
            },
        };
    },
});
