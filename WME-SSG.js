// ==UserScript==
// @name         WME Simplify Street Geometry (beta)
// @namespace   https://greasyfork.org/users/166843
// @version      2019.08.09.02
// @description  Flatten selected segments into a perfectly straight line.
// @author       dBsooner
// @include     /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @grant        none
// @license      GPLv3
// ==/UserScript==

// Original credit to jonny3D and impulse200

/* global localStorage, window, $, performance, I18n, GM_info, W, WazeWrap */

const ALERT_UPDATE = true,
    DEBUG = true,
    LOAD_BEGIN_TIME = performance.now(),
    // SCRIPT_AUTHOR = GM_info.script.author,
    SCRIPT_FORUM_URL = '',
    SCRIPT_GF_URL = 'https://greasyfork.org/en/scripts/388349-wme-simplify-street-geometry',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = ['<b>NEW:</b> Initial release.',
        '<b>NEW:</b> Check for micro dog legs.',
        '<b>NEW:</b> Restrict to rank 3+.'],
    SETTINGS_STORE_NAME = 'WMESSG',
    _timeouts = { bootstrap: undefined };
let _moveNode,
    _settings = {},
    _updateSegmentGeometry;

function loadSettingsFromStorage() {
    return new Promise(async resolve => {
        const defaultSettings = {
                conflictingNames: 'warning',
                nonContinuousSelection: 'warning',
                sanityCheck: 'warning',
                lastSaved: 0,
                lastVersion: undefined
            },
            loadedSettings = $.parseJSON(localStorage.getItem(SETTINGS_STORE_NAME));
        _settings = $.extend({}, defaultSettings, loadedSettings);
        const serverSettings = await WazeWrap.Remote.RetrieveSettings(SETTINGS_STORE_NAME);
        if (serverSettings && (serverSettings.lastSaved > _settings.lastSaved))
            $.extend(_settings, serverSettings);
        resolve();
    });
}

function saveSettingsToStorage() {
    if (localStorage) {
        _settings.lastVersion = SCRIPT_VERSION;
        _settings.lastSaved = Date.now();
        localStorage.setItem(SETTINGS_STORE_NAME, JSON.stringify(_settings));
        WazeWrap.Remote.SaveSettings(SETTINGS_STORE_NAME, _settings);
        logDebug('Settings saved.');
    }
}

function showScriptInfoAlert() {
    if (ALERT_UPDATE && SCRIPT_VERSION !== _settings.lastVersion) {
        let releaseNotes = '';
        releaseNotes += `<p>${I18n.t('wmessg.common.WhatsNew')}:</p>`;
        if (SCRIPT_VERSION_CHANGES.length > 0) {
            releaseNotes += '<ul>';
            for (let idx = 0; idx < SCRIPT_VERSION_CHANGES.length; idx++)
                releaseNotes += `<li>${SCRIPT_VERSION_CHANGES[idx]}`;
            releaseNotes += '</ul>';
        }
        else {
            releaseNotes += `<ul><li>${I18n.t('wmessg.common.NothingMajor')}</ul>`;
        }
        WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, SCRIPT_VERSION, releaseNotes, SCRIPT_GF_URL, SCRIPT_FORUM_URL);
    }
}

function checkTimeout(obj) {
    if (obj.toIndex) {
        if (_timeouts[obj.timeout] && (_timeouts[obj.timeout][obj.toIndex] !== undefined)) {
            window.clearTimeout(_timeouts[obj.timeout][obj.toIndex]);
            _timeouts[obj.timeout][obj.toIndex] = undefined;
        }
    }
    else {
        if (_timeouts[obj.timeout] !== undefined)
            window.clearTimeout(_timeouts[obj.timeout]);
        _timeouts[obj.timeout] = undefined;
    }
}

function log(message) { console.log('SSG:', message); }
function logError(message) { console.error('SSG:', message); }
function logWarning(message) { console.warn('SSG:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('SSG:', message);
}

// рассчитаем пересчечение перпендикуляра точки с наклонной прямой
// Calculate the intersection of the perpendicular point with an inclined line
function getIntersectCoord(a, b, c, d) {
    // второй вариант по-проще: http://rsdn.ru/forum/alg/2589531.hot
    const r = [2];
    r[1] = -1.0 * (c * b - a * d) / (a * a + b * b);
    r[0] = (-r[1] * (b + a) - c + d) / (a - b);
    return { x: r[0], y: r[1] };
}

// определим направляющие
// Define guides
function getDeltaDirect(a, b) {
    let d = 0.0;
    if (a < b)
        d = 1.0;
    else if (a > b)
        d = -1.0;
    return d;
}

function checkNameContinuity(selectedFeatures) {
    const streetIds = [];
    for (let idx = 0; idx < selectedFeatures.length; idx++) {
        if (idx > 0) {
            if ((selectedFeatures[idx].model.attributes.primaryStreetID > 0) && (streetIds.indexOf(selectedFeatures[idx].model.attributes.primaryStreetID) > -1))
                // eslint-disable-next-line no-continue
                continue;
            if (selectedFeatures[idx].model.attributes.streetIDs.length > 0) {
                let included = false;
                for (let idx2 = 0; idx2 < selectedFeatures[idx].model.attributes.streetIDs.length; idx2++) {
                    if (streetIds.indexOf(selectedFeatures[idx].model.attributes.streetIDs[idx2]) > -1) {
                        included = true;
                        break;
                    }
                }
                if (included === true)
                    // eslint-disable-next-line no-continue
                    continue;
                else
                    return false;
            }
            return false;
        }
        if (idx === 0) {
            if (selectedFeatures[idx].model.attributes.primaryStreetID > 0)
                streetIds.push(selectedFeatures[idx].model.attributes.primaryStreetID);
            if (selectedFeatures[idx].model.attributes.streetIDs.length > 0)
                selectedFeatures[idx].model.attributes.streetIDs.forEach(streetId => { streetIds.push(streetId); });
        }
    }
    return true;
}

function distanceBetweenPointsInKM(lon1, lat1, lon2, lat2) {
    lon1 *= 0.017453292519943295; // 0.017453292519943295 = Math.PI / 180
    lat1 *= 0.017453292519943295;
    lon2 *= 0.017453292519943295;
    lat2 *= 0.017453292519943295;
    // 12742 = Diam of earth in km (2 * 6371)
    return 12742 * Math.asin(Math.sqrt(((1 - Math.cos(lat2 - lat1)) + (1 - Math.cos(lon2 - lon1)) * Math.cos(lat1) * Math.cos(lat2)) / 2));
}

function checkForMicroDogLegs(selectedFeatures) {
    for (let idx = 0; idx < selectedFeatures.length; idx++) {
        if (selectedFeatures[idx].geometry.components.length > 2) {
            const fromNode = W.model.nodes.getObjectById(selectedFeatures[idx].model.attributes.fromNodeID),
                toNode = W.model.nodes.getObjectById(selectedFeatures[idx].model.attributes.toNodeID);
            for (let idx2 = 0; idx2 < selectedFeatures[idx].geometry.components.length; idx2++) {
                const fromNode4326 = WazeWrap.Geometry.ConvertTo4326(fromNode.geometry.x, fromNode.geometry.y),
                    toNode4326 = WazeWrap.Geometry.ConvertTo4326(toNode.geometry.x, toNode.geometry.y),
                    testNode4326 = WazeWrap.Geometry.ConvertTo4326(selectedFeatures[idx].geometry.components[idx2].x, selectedFeatures[idx].geometry.components[idx2].y);
                if (((testNode4326.lon === fromNode4326.lon) && (testNode4326.lat === fromNode4326.lat)) || ((testNode4326.lon === toNode4326.lon) && (testNode4326.lat === toNode4326.lat)))
                    // eslint-disable-next-line no-continue
                    continue;
                if ((distanceBetweenPointsInKM(fromNode4326.lon, fromNode4326.lat, testNode4326.lon, testNode4326.lat) * 1000) < 2)
                    return true;
                if ((distanceBetweenPointsInKM(toNode4326.lon, toNode4326.lat, testNode4326.lon, testNode4326.lat) * 1000) < 2)
                    return true;
            }
        }
    }
    return false;
}

function doSimplifyStreetGeometry(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue) {
    const numSelectedFeatures = W.selectionManager.getSelectedFeatures().length;
    if (numSelectedFeatures > 1) {
        const selectedFeatures = W.selectionManager.getSelectedFeatures();
        if ((numSelectedFeatures > 10) && !sanityContinue) {
            if (_settings.sanityCheck === 'error')
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmessg.error.TooManySegments'));
            if (_settings.sanityCheck === 'warning') {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmessg.prompts.SanityCheckConfirm'),
                    () => { doSimplifyStreetGeometry(true); },
                    () => { },
                    I18n.t('wmessg.common.Yes'),
                    I18n.t('wmessg.common.No')
                );
            }
            sanityContinue = true;
        }
        if ((W.selectionManager.getSegmentSelection().multipleConnectedComponents === true) && !nonContinuousContinue) {
            if (_settings.nonContinuousSelection === 'error')
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmessg.error.NonContinuous'));
            if (_settings.nonContinuousSelection === 'warning') {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmessg.prompts.NonContinuousConfirm'),
                    () => { doSimplifyStreetGeometry(sanityContinue, true); },
                    () => { },
                    I18n.t('wmessg.common.Yes'),
                    I18n.t('wmessg.common.No')
                );
            }
            nonContinuousContinue = true;
        }
        if (_settings.conflictingNames !== 'nowarning') {
            const continuousNames = checkNameContinuity(selectedFeatures);
            if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'error'))
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmessg.error.ConflictingNames'));
            if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'warning')) {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmessg.prompts.ConflictingNamesConfirm'),
                    () => { doSimplifyStreetGeometry(sanityContinue, nonContinuousContinue, true); },
                    () => { },
                    I18n.t('wmessg.common.Yes'),
                    I18n.t('wmessg.common.No')
                );
            }
            conflictingNamesContinue = true;
        }
        if (!microDogLegsContinue && (checkForMicroDogLegs(selectedFeatures) === true)) {
            return WazeWrap.Alerts.confirm(
                SCRIPT_NAME,
                I18n.t('wmessg.prompts.MicroDogLegsConfirm'),
                () => { doSimplifyStreetGeometry(sanityContinue, nonContinuousContinue, conflictingNamesContinue, true); },
                () => { },
                I18n.t('wmessg.common.Yes'),
                I18n.t('wmessg.common.No')
            );
        }
        let t1,
            t2,
            t,
            a = 0.0,
            b = 0.0,
            c = 0.0;
        // определим линию выравнивания
        // Define an alignment line
        logDebug(I18n.t('wmessg.log.CalculationOfInclinedLine'));
        for (let idx = 0; idx < numSelectedFeatures; idx++) {
            const seg = selectedFeatures[idx];
            if (seg.model.type === 'segment') {
                const geo = seg.model.geometry;
                // определяем формулу наклонной прямой
                // Determine the formula of the inclined line
                if (geo.components.length > 1) {
                    const a1 = geo.components[0].clone(),
                        a2 = geo.components[geo.components.length - 1].clone();
                    let dX = getDeltaDirect(a1.x, a2.x),
                        dY = getDeltaDirect(a1.y, a2.y);
                    const tX = idx > 0 ? getDeltaDirect(t1.x, t2.x) : 0,
                        tY = idx > 0 ? getDeltaDirect(t1.y, t2.y) : 0;
                    logDebug(`${I18n.t('wmessg.log.CalculatedLineVector')}: tX=${tX}, tY=${tY}`);
                    logDebug(`${I18n.t('wmessg.log.Segment')} #${(idx + 1)} (${a1.x}; ${a1.y}) - (${a2.x}; ${a2.y}), dX=${dX}, dY=${dY}`);
                    if (dX < 0) {
                        t = a1.x;
                        a1.x = a2.x;
                        a2.x = t;
                        t = a1.y;
                        a1.y = a2.y;
                        a2.y = t;
                        dX = getDeltaDirect(a1.x, a2.x);
                        dY = getDeltaDirect(a1.y, a2.y);
                        logDebug(`${I18n.t('wmessg.log.ExpandTheSegment')} #${(idx + 1)} (${a1.x}; ${a1.y}) - (${a2.x}; ${a2.y}), dX=${dX}, dY=${dY}`);
                    }
                    if (idx === 0) {
                        t1 = a1.clone();
                        t2 = a2.clone();
                    }
                    else {
                        if (a1.x < t1.x) {
                            t1.x = a1.x;
                            t1.y = a1.y;
                        }
                        if (a2.x > t2.x) {
                            t2.x = a2.x;
                            t2.y = a2.y;
                        }
                    }
                    logDebug(`${I18n.t('wmessg.log.SettlementDirectBy')} (${t1.x}; ${t1.y}) - (${t2.x}; ${t2.y})`);
                }
            }
            else {
                logWarning(I18n.t('wmessg.log.NonSegmentFound'));
            }
        }
        a = t2.y - t1.y;
        b = t1.x - t2.x;
        c = t2.x * t1.y - t1.x * t2.y;
        logDebug(I18n.t('wmessg.log.DirectAlignmentCalculated'));
        logDebug(`${I18n.t('wmessg.log.EndPoints')}: (${t1.x}; ${t1.y}) - (${t2.x}; ${t2.y})`);
        logDebug(`${I18n.t('wmessg.log.DirectFormula')}: ${a}x + ${b}y + ${c}`);
        logDebug(`${I18n.t('wmessg.log.AlignSegments')}... ${numSelectedFeatures}`);
        for (let idx = 0; idx < numSelectedFeatures; idx++) {
            const seg = selectedFeatures[idx],
                { model } = seg;
            if (model.type === 'segment') {
                const newGeo = model.geometry.clone();
                let flagSimpled = false;
                // удаляем лишние узлы
                // Remove the extra nodes
                if (newGeo.components.length > 2) {
                    newGeo.components.splice(1, newGeo.components.length - 2);
                    flagSimpled = true;
                }
                // упрощаем сегмент, если нужно
                // Simplify the segment, if necessary
                if (flagSimpled)
                    W.model.actionManager.add(new _updateSegmentGeometry(model, model.geometry, newGeo));
                    // работа с узлом
                    // Work with a node
                const node = W.model.nodes.getObjectById(model.attributes.fromNodeID),
                    nodeGeo = node.geometry.clone(),
                    d = nodeGeo.y * a - nodeGeo.x * b,
                    r1 = getIntersectCoord(a, b, c, d);
                nodeGeo.x = r1.x;
                nodeGeo.y = r1.y;
                nodeGeo.calculateBounds();
                const connectedSegObjs = {},
                    emptyObj = {};
                for (let idx2 = 0; idx2 < node.attributes.segIDs.length; idx2++) {
                    const segId = node.attributes.segIDs[idx2];
                    connectedSegObjs[segId] = W.model.segments.getObjectById(segId).geometry.clone();
                }
                W.model.actionManager.add(new _moveNode(node, node.geometry, nodeGeo, connectedSegObjs, emptyObj));
                const node2 = W.model.nodes.getObjectById(model.attributes.toNodeID),
                    nodeGeo2 = node2.geometry.clone(),
                    d2 = nodeGeo2.y * a - nodeGeo2.x * b,
                    r2 = getIntersectCoord(a, b, c, d2);
                nodeGeo2.x = r2.x;
                nodeGeo2.y = r2.y;
                nodeGeo2.calculateBounds();
                for (let idx2 = 0; idx2 < node2.attributes.segIDs.length; idx2++) {
                    const segId = node2.attributes.segIDs[idx2];
                    connectedSegObjs[segId] = W.model.segments.getObjectById(segId).geometry.clone();
                }
                W.model.actionManager.add(new _moveNode(node2, node2.geometry, nodeGeo2, connectedSegObjs, emptyObj));
                logDebug(`${I18n.t('wmessg.log.Segment')} #${(idx + 1)} (${r1.x}; ${r1.y}) - (${r2.x}; ${r2.y})`);
            }
            else {
                logWarning(I18n.t('wmessg.log.NonSegmentFound'));
            }
        }
    } // W.selectionManager.selectedItems.length > 0
    else if (numSelectedFeatures === 1) {
        return WazeWrap.Alerts.info(SCRIPT_NAME, I18n.t('wmessg.error.OnlyOneSegment'));
    }
    else {
        logWarning(I18n.t('wmessg.log.NoSegmentsSelected'));
    }
    return true;
}

function insertSimplifyStreetGeometryButtons() {
    $('.edit-restrictions').after(`<button id="WME-SSG" class="waze-btn waze-btn-small waze-btn-white" title="${I18n.t('wmessg.SimplifyGeometryTitle')}">${I18n.t('wmessg.SimplifyGeometry')}</button>`);
}

function loadTranslations() {
    return new Promise(resolve => {
        const translations = {
                en: {
                    SimplifyGeometry: 'Simplify geometry',
                    SimplifyGeometryTitle: 'Click here to flatten the selected segments into a straight line.',
                    common: {
                        Help: 'Help',
                        No: 'No',
                        Note: 'Note',
                        NothingMajor: 'Nothing major.',
                        WhatsNew: 'What\'s new',
                        Yes: 'Yes'
                    },
                    error: {
                        ConflictingNames: 'You selected segments that do not share at least one name in common amongst all the segments and have the conflicting names setting set to error. '
                            + 'Segments not simplified.',
                        NonContinuousSelection: 'You selected segments that are not all connected and have the non-continuous selected segments setting set to give error. Segments not simplified.',
                        OnlyOneSegment: 'You only selected one segment. This script is designed to work with more than one segment selected. Segments not simplified.',
                        TooManySegments: 'You selected too many segments and have the sanity check setting set to give error. Segments not simplified.'
                    },
                    help: {
                        Note01: 'This script uses the action manager, so changes can be undone before saving.',
                        Step01: 'Select the starting segment.',
                        Step02: 'ALT+click the ending segment.',
                        Step02note: 'If the segments you wanted to straighten are not all selected, unselect them and start over using CTRL+click each segment instead.',
                        Step03: 'Click "Simplify geometry" button in the sidebar.'
                    },
                    log: {
                        AlignSegments: 'Align segments',
                        CalculatedLineVector: 'Calculated line vector',
                        CalculationOfInclinedLine: 'Calculation of the inclined line formula...',
                        DirectAlignmentCalculated: 'Direct alignment calculated.',
                        DirectFormula: 'Direct formula',
                        EndPoints: 'End points',
                        ExpandTheSegment: 'Expand the segment',
                        NonSegmentFound: 'Non segment found in selection.',
                        NoSegmentsSelected: 'No segments selected.',
                        Segment: I18n.t('objects.segment.name'),
                        SettlementDirectBy: 'Settlement direct by'
                    },
                    prompts: {
                        ConflictingNamesConfirm: 'You selected segments that do not share at least one name in common amongst all the segments. Are you sure you wish to continue simplifaction?',
                        MicroDogLegsConfirm: 'One or more of the segments you selected have a geonode within 2 meters of the junction node. This is usually the sign of a micro dog leg (mDL).<br><br>'
                        + '<b>You should not continue until you are certain there are no micro dog legs.<b><br><br>'
                        + 'Are you sure you wish to continue with simplification?',
                        NonContinuousConfirm: 'You selected segments that do not all connect. Are you sure you wish to continue with simplification?',
                        SanityCheckConfirm: 'You selected many segments. Are you sure you wish to continue with simplification?'
                    },
                    settings: {
                        GiveError: 'Give error',
                        GiveWarning: 'Give warning',
                        NoWarning: 'No warning',
                        ConflictingNames: 'Segments with conflicting names',
                        ConflictingNamesTitle: 'Select what to do if the selected segments do not share at least one name among their primary and alternate names (based on name, city and state).',
                        NonContinuous: 'Non-continuous selected segments',
                        NonContinuousTitle: 'Select what to do if the selected segments are not continuous.',
                        SanityCheck: 'Sanity check',
                        SanityCheckTitle: 'Select what to do if you selected a many segments.'
                    }
                },
                ru: {
                    SimplifyGeometry: 'Выровнять улицу',
                    log: {
                        AlignSegments: 'выравниваем сегменты',
                        CalculatedLineVector: 'расчётный вектор линии',
                        CalculationOfInclinedLine: 'расчёт формулы наклонной прямой...',
                        DirectAlignmentCalculated: 'прямая выравнивания рассчитана.',
                        DirectFormula: 'формула прямой',
                        EndPoints: 'конечные точки',
                        ExpandTheSegment: 'разворачиваем сегмент',
                        Segment: I18n.t('objects.segment.name'),
                        SettlementDirectBy: 'расчётная прямая по'
                    }
                }
            },
            locale = I18n.currentLocale(),
            availTranslations = Object.keys(translations);
        I18n.translations[locale].wmessg = translations.en;
        if (availTranslations.indexOf(I18n.currentLocale()) > 0) {
            Object.keys(translations[locale]).forEach(prop => {
                if (typeof translations[locale][prop] === 'object') {
                    Object.keys(translations[locale][prop]).forEach(subProp => {
                        if (translations[locale][prop][subProp] !== '')
                            I18n.translations[locale].wmessg[prop][subProp] = translations[locale][prop][subProp];
                    });
                }
                else if (translations[locale][prop] !== '') {
                    I18n.translations[locale].wmessg[prop] = translations[locale][prop];
                }
            });
        }
        resolve();
    });
}

function registerEvents() {
    $('#WMESSG-conflictingNames').off().on('change', function () {
        const setting = this.id.substr(7);
        if (this.value.toLowerCase() !== _settings[setting]) {
            _settings[setting] = this.value.toLowerCase();
            saveSettingsToStorage();
        }
    });
}

function buildSelections(selected) {
    const rVal = `<option value="nowarning"${(selected === 'nowarning' ? ' selected' : '')}>${I18n.t('wmessg.settings.NoWarning')}</option>`
    + `<option value="warning"${(selected === 'warning' ? ' selected' : '')}>${I18n.t('wmessg.settings.GiveWarning')}</option>`
    + `<option value="error"${(selected === 'error' ? ' selected' : '')}>${I18n.t('wmessg.settings.GiveError')}</option>`;
    return rVal;
}

async function init() {
    log('Initializing.');
    if (W.loginManager.getUserRank() < 2)
        return;
    await loadSettingsFromStorage();
    await loadTranslations();
    const $ssgTab = $('<div>', { style: 'padding:8px 16px', id: 'WMESSGSettings' });
    $ssgTab.html([
        `<div style="margin-bottom:0px;font-size:13px;font-weight:600;">${SCRIPT_NAME}</div>`,
        `<div style="margin-top:0px;font-size:11px;font-weight:600;color:#aaa">${SCRIPT_VERSION}</div>`,
        `<div id="WMESSG-div-conflictingNames" class="controls-container"><select id="WMESSG-conflictingNames" style="font-size:11px;height:22px;" title="${I18n.t('wmessg.settings.ConflictingNamesTitle')}">`,
        buildSelections(_settings.conflictingNames),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmessg.settings.ConflictingNames')}</div>`,
        '</div><br/>',
        `<div id="WMESSG-div-nonContinuousSelection" class="controls-container"><select id="WMESSG-nonContinuousSelection" style="font-size:11px;height:22px;" title="${I18n.t('wmessg.settings.NonContinuousTitle')}">`,
        buildSelections(_settings.nonContinuousSelection),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmessg.settings.NonContinuous')}</div>`,
        '</div><br/>',
        `<div id="WMESSG-div-sanityCheck" class="controls-container"><select id="WMESSG-sanityCheck" style="font-size:11px;height:22px;" title="${I18n.t('wmessg.settings.SanityCheckTitle')}">`,
        buildSelections(_settings.sanityCheck),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmessg.settings.SanityCheck')}</div>`,
        `<div style="margin-top:20px;"><div style="font-size:14px;font-weight:600;">${I18n.t('wmessg.common.Help')}:</div><div><ol style="font-weight:600;">`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmessg.help.Step01')}</p></li>`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmessg.help.Step02')}<br><b>${I18n.t('wmessg.common.Note')}:</b> ${I18n.t('wmessg.help.Step02note')}</p></li>`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmessg.help.Step03')}</p></li></ol></div>`,
        `<b>${I18n.t('wmessg.common.Note')}:</b> ${I18n.t('wmessg.help.Note01')}</div></div>`
    ].join(' '));
    new WazeWrap.Interface.Tab('SSG', $ssgTab.html(), registerEvents);
    _updateSegmentGeometry = require('Waze/Action/UpdateSegmentGeometry');
    _moveNode = require('Waze/Action/MoveNode');
    W.selectionManager.events.register('selectionchanged', null, insertSimplifyStreetGeometryButtons);
    $('#sidebar').on('click', '#WME-SSG', e => {
        e.preventDefault();
        doSimplifyStreetGeometry();
    });
    showScriptInfoAlert();
    log(`Fully initialized in ${Math.round(performance.now() - LOAD_BEGIN_TIME)} ms.`);
}

function bootstrap(tries) {
    if (W && W.map && W.model && $ && WazeWrap.Ready) {
        checkTimeout({ timeout: 'bootstrap' });
        log('Bootstrapping.');
        init();
    }
    else if (tries < 1000) {
        logDebug(`Bootstrap failed. Retrying ${tries} of 1000`);
        _timeouts.bootstrap = window.setTimeout(bootstrap, 200, ++tries);
    }
    else {
        logError('Bootstrap timed out waiting for WME to become ready.');
    }
}

bootstrap(1);
