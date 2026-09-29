// ==UserScript==
// @name         Wheeliecat's Meldkamerspel Scripts
// @namespace    https://meldkamerspel.com/suite
// @version      1.1.0
// @description  Wheeliecat's Meldkamerspel scripts, all in one. Open "Wheeliecat's scripts" in the navbar to turn each one on or off and change its settings. Work in progress.
// @author       Wheeliecat-dev
// @match        https://meldkamerspel.com/*
// @match        https://www.meldkamerspel.com/*
// @icon         https://meldkamerspel.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/meldkamerspel-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/meldkamerspel-suite.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      nominatim.openstreetmap.org
// @connect      overpass-api.de
// @connect      overpass.kumi.systems
// @connect      overpass.openstreetmap.ru
// @connect      overpass.private.coffee
// @require      https://raw.githubusercontent.com/Wheeliecat-dev/meldkamerspel-suite/main/dist/lib/suite-1.1.0.js#sha256=77435a9e1d22510852db825cca1a64eece2286bf175a9ba5de74a92ff3e40e35
// @run-at       document-start
// ==/UserScript==

// All code lives in @require above (github.com/Wheeliecat-dev/meldkamerspel-suite).
