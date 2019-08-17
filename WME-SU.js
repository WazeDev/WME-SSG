// ==UserScript==
// @name         WME Straighten Up!
// @namespace   https://greasyfork.org/users/166843
// @version      2019.08.16.01
// @description  Straighten selected WME segment(s) by aligning along straight line between two end points and removing geometry nodes.
// @author       dBsooner
// @include     /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @grant        none
// @license      GPLv3
// ==/UserScript==

// Original credit to jonny3D and impulse200

/* global localStorage, window, $, performance, I18n, GM_info, W, WazeWrap */

const ALERT_UPDATE = true,
    DEBUG = false,
    LOAD_BEGIN_TIME = performance.now(),
    // SCRIPT_AUTHOR = GM_info.script.author,
    SCRIPT_FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=289116',
    SCRIPT_GF_URL = 'https://greasyfork.org/en/scripts/388349-wme-straighten-up',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = ['<b>CHANGE:</b> Enhance check for micro doglegs (mDL).'],
    SETTINGS_STORE_NAME = 'WMESU',
    _timeouts = { bootstrap: undefined, saveSettingsToStorage: undefined };
let _settings = {};

function loadSettingsFromStorage() {
    return new Promise(async resolve => {
        const defaultSettings = {
                conflictingNames: 'warning',
                longJnMove: 'warning',
                microDogLegs: 'warning',
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
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);
        resolve();
    });
}

function saveSettingsToStorage() {
    checkTimeout({ timeout: 'saveSettingsToStorage' });
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
        releaseNotes += `<p>${I18n.t('wmesu.common.WhatsNew')}:</p>`;
        if (SCRIPT_VERSION_CHANGES.length > 0) {
            releaseNotes += '<ul>';
            for (let idx = 0; idx < SCRIPT_VERSION_CHANGES.length; idx++)
                releaseNotes += `<li>${SCRIPT_VERSION_CHANGES[idx]}`;
            releaseNotes += '</ul>';
        }
        else {
            releaseNotes += `<ul><li>${I18n.t('wmesu.common.NothingMajor')}</ul>`;
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

function log(message) { console.log('WME-SU:', message); }
function logError(message) { console.error('WME-SU:', message); }
function logWarning(message) { console.warn('WME-SU:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('WME-SU:', message);
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

function distanceBetweenPoints(lon1, lat1, lon2, lat2, measurement) {
    // eslint-disable-next-line no-nested-ternary
    const multiplier = measurement === 'meters' ? 1000 : measurement === 'miles' ? 0.621371192237334 : measurement === 'feet' ? 3280.8398950131 : 1;
    lon1 *= 0.017453292519943295; // 0.017453292519943295 = Math.PI / 180
    lat1 *= 0.017453292519943295;
    lon2 *= 0.017453292519943295;
    lat2 *= 0.017453292519943295;
    // 12742 = Diam of earth in km (2 * 6371)
    return 12742 * Math.asin(Math.sqrt(((1 - Math.cos(lat2 - lat1)) + (1 - Math.cos(lon2 - lon1)) * Math.cos(lat1) * Math.cos(lat2)) / 2)) * multiplier;
}

function checkForMicroDogLegs(distinctNodes, singleSegmentId) {
    if (!distinctNodes || (distinctNodes.length < 1))
        return false;
    const nodesChecked = [],
        nodesObjArr = W.model.nodes.getByIds(distinctNodes);
    if (!nodesObjArr || (nodesObjArr.length < 1))
        return false;
    const checkGeoComp = (geoComp, node4326) => {
        const testNode4326 = WazeWrap.Geometry.ConvertTo4326(geoComp.x, geoComp.y);
        if ((node4326.lon !== testNode4326.lon) || (node4326.lat !== testNode4326.lat)) {
            if (distanceBetweenPoints(node4326.lon, node4326.lat, testNode4326.lon, testNode4326.lat, 'meters') < 2)
                return false;
        }
        return true;
    };
    for (let idx = 0; idx < nodesObjArr.length; idx++) {
        if (nodesChecked.indexOf(nodesObjArr[idx]) === -1) {
            nodesChecked.push(nodesObjArr[idx]);
            const segmentsObjArr = W.model.segments.getByIds(nodesObjArr[idx].getSegmentIds()) || [],
                node4326 = WazeWrap.Geometry.ConvertTo4326(nodesObjArr[idx].geometry.x, nodesObjArr[idx].geometry.y);
            for (let idx2 = 0; idx2 < segmentsObjArr.length; idx2++) {
                const segObj = segmentsObjArr[idx2];
                if (!singleSegmentId
                    || (singleSegmentId && (segObj.attributes.id === singleSegmentId))) {
                    if (!segObj.geometry.components.every(geoComp => checkGeoComp(geoComp, node4326)))
                        return true;
                }
            }
        }
    }
    return false;
}

function doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, longJnMoveContinue, passedObj) {
    const selectedFeatures = W.selectionManager.getSelectedFeatures(),
        segmentSelection = W.selectionManager.getSegmentSelection();
    if (longJnMoveContinue && (passedObj !== undefined)) {
        const { segmentsToRemoveGeometryArr } = passedObj,
            { nodesToMoveArr } = passedObj,
            { distinctNodes } = passedObj,
            { endPointNodeIds } = passedObj;
        logDebug(`${I18n.t('wmesu.log.StraighteningSegments')}: ${distinctNodes.join(', ')} (${distinctNodes.length})`);
        logDebug(`${I18n.t('wmesu.log.EndPoints')}: ${endPointNodeIds.join(' & ')}`);
        if (segmentsToRemoveGeometryArr && (segmentsToRemoveGeometryArr.length > 0)) {
            const UpdateSegmentGeometry = require('Waze/Action/UpdateSegmentGeometry');
            segmentsToRemoveGeometryArr.forEach(segment => {
                W.model.actionManager.add(new UpdateSegmentGeometry(segment.model, segment.model.geometry, segment.newGeo));
                logDebug(`${I18n.t('wmesu.log.RemovedGeometryNodes')} # ${segment.model.attributes.id}`);
            });
        }
        if (nodesToMoveArr && (nodesToMoveArr.length > 0)) {
            const MoveNode = require('Waze/Action/MoveNode');
            nodesToMoveArr.forEach(node => {
                logDebug(`${I18n.t('wmesu.log.MovingJunctionNode')} # ${node.node.attributes.id} `
                    + `- ${I18n.t('wmesu.common.From')}: ${node.geometry.x},${node.geometry.y} - `
                    + `${I18n.t('wmesu.common.To')}: ${node.nodeGeo.x},${node.nodeGeo.y}`);
                W.model.actionManager.add(new MoveNode(node.node, node.geometry, node.nodeGeo, node.connectedSegObjs, {}));
            });
        }
    }
    else if (selectedFeatures.length > 1) {
        const segmentsToRemoveGeometryArr = [],
            nodesToMoveArr = [];
        if ((selectedFeatures.length > 10) && !sanityContinue) {
            if (_settings.sanityCheck === 'error')
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.TooManySegments'));
            if (_settings.sanityCheck === 'warning') {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmesu.prompts.SanityCheckConfirm'),
                    () => { doStraightenSegments(true, false, false, false, false, undefined); },
                    () => { },
                    I18n.t('wmesu.common.Yes'),
                    I18n.t('wmesu.common.No')
                );
            }
        }
        sanityContinue = true;
        if ((segmentSelection.multipleConnectedComponents === true) && !nonContinuousContinue) {
            if (_settings.nonContinuousSelection === 'error')
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.NonContinuous'));
            if (_settings.nonContinuousSelection === 'warning') {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmesu.prompts.NonContinuousConfirm'),
                    () => { doStraightenSegments(sanityContinue, true, false, false, false, undefined); },
                    () => { },
                    I18n.t('wmesu.common.Yes'),
                    I18n.t('wmesu.common.No')
                );
            }
        }
        nonContinuousContinue = true;
        if (_settings.conflictingNames !== 'nowarning') {
            const continuousNames = checkNameContinuity(selectedFeatures);
            if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'error'))
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.ConflictingNames'));
            if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'warning')) {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmesu.prompts.ConflictingNamesConfirm'),
                    () => { doStraightenSegments(sanityContinue, nonContinuousContinue, true, false, false, undefined); },
                    () => { },
                    I18n.t('wmesu.common.Yes'),
                    I18n.t('wmesu.common.No')
                );
            }
        }
        conflictingNamesContinue = true;
        const allNodeIds = [],
            dupNodeIds = [];
        let endPointNodeIds,
            longMove = false;
        for (let idx = 0; idx < selectedFeatures.length; idx++) {
            allNodeIds.push(selectedFeatures[idx].model.attributes.fromNodeID);
            allNodeIds.push(selectedFeatures[idx].model.attributes.toNodeID);
            if (selectedFeatures[idx].model.type === 'segment') {
                const newGeo = selectedFeatures[idx].model.geometry.clone();
                // Remove the geometry nodes
                if (newGeo.components.length > 2) {
                    newGeo.components.splice(1, newGeo.components.length - 2);
                    newGeo.components[0].calculateBounds();
                    newGeo.components[1].calculateBounds();
                    segmentsToRemoveGeometryArr.push({ model: selectedFeatures[idx].model, geometry: selectedFeatures[idx].model.geometry, newGeo });
                }
            }
        }
        allNodeIds.forEach((nodeId, idx) => {
            if (allNodeIds.indexOf(nodeId, idx + 1) > -1) {
                if (dupNodeIds.indexOf(nodeId) === -1)
                    dupNodeIds.push(nodeId);
            }
        });
        const distinctNodes = [...new Set(allNodeIds)];
        if (!microDogLegsContinue && (checkForMicroDogLegs(distinctNodes, undefined) === true)) {
            if (_settings.microDogLegs === 'error')
                return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.MicroDogLegs'));
            if (_settings.microDogLegs === 'warning') {
                return WazeWrap.Alerts.confirm(
                    SCRIPT_NAME,
                    I18n.t('wmesu.prompts.MicroDogLegsConfirm'),
                    () => { doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, true, false, undefined); },
                    () => { },
                    I18n.t('wmesu.common.Yes'),
                    I18n.t('wmesu.common.No')
                );
            }
        }
        microDogLegsContinue = true;
        if (segmentSelection.multipleConnectedComponents === false)
            endPointNodeIds = distinctNodes.filter(nodeId => !dupNodeIds.includes(nodeId));
        else
            endPointNodeIds = [selectedFeatures[0].model.attributes.fromNodeID, selectedFeatures[(selectedFeatures.length - 1)].model.attributes.toNodeID];
        const endPointNodeObjs = W.model.nodes.getByIds(endPointNodeIds),
            endPointNode1Geo = endPointNodeObjs[0].geometry.clone(),
            endPointNode2Geo = endPointNodeObjs[1].geometry.clone();
        if (getDeltaDirect(endPointNode1Geo.x, endPointNode2Geo.x) < 0) {
            let t = endPointNode1Geo.x;
            endPointNode1Geo.x = endPointNode2Geo.x;
            endPointNode2Geo.x = t;
            t = endPointNode1Geo.y;
            endPointNode1Geo.y = endPointNode2Geo.y;
            endPointNode2Geo.y = t;
            endPointNodeIds.push(endPointNodeIds[0]);
            endPointNodeIds.splice(0, 1);
            endPointNodeObjs.push(endPointNodeObjs[0]);
            endPointNodeObjs.splice(0, 1);
        }
        const a = endPointNode2Geo.y - endPointNode1Geo.y,
            b = endPointNode1Geo.x - endPointNode2Geo.x,
            c = endPointNode2Geo.x * endPointNode1Geo.y - endPointNode1Geo.x * endPointNode2Geo.y;
        distinctNodes.forEach(nodeId => {
            if (endPointNodeIds.indexOf(nodeId) === -1) {
                const node = W.model.nodes.getObjectById(nodeId),
                    nodeGeo = node.geometry.clone();
                const d = nodeGeo.y * a - nodeGeo.x * b,
                    r1 = getIntersectCoord(a, b, c, d);
                nodeGeo.x = r1.x;
                nodeGeo.y = r1.y;
                nodeGeo.calculateBounds();
                const connectedSegObjs = {};
                for (let idx = 0; idx < node.attributes.segIDs.length; idx++) {
                    const segId = node.attributes.segIDs[idx];
                    connectedSegObjs[segId] = W.model.segments.getObjectById(segId).geometry.clone();
                }
                const fromNodeLonLat = WazeWrap.Geometry.ConvertTo4326(node.geometry.x, node.geometry.y),
                    toNodeLonLat = WazeWrap.Geometry.ConvertTo4326(r1.x, r1.y);
                if (distanceBetweenPoints(fromNodeLonLat.lon, fromNodeLonLat.lat, toNodeLonLat.lon, toNodeLonLat.lat, 'meters') > 10)
                    longMove = true;
                nodesToMoveArr.push({
                    node, geometry: node.geometry, nodeGeo, connectedSegObjs
                });
            }
        });
        if (longMove && (_settings.longJnMove === 'error'))
            return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.LongJnMove'));
        if (longMove && (_settings.longJnMove === 'warning')) {
            return WazeWrap.Alerts.confirm(
                SCRIPT_NAME,
                I18n.t('wmesu.prompts.LongJnMoveConfirm'),
                () => {
                    doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, true, {
                        segmentsToRemoveGeometryArr, nodesToMoveArr, distinctNodes, endPointNodeIds
                    });
                },
                () => { },
                I18n.t('wmesu.common.Yes'),
                I18n.t('wmesu.common.No')
            );
        }
        doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, true, {
            segmentsToRemoveGeometryArr, nodesToMoveArr, distinctNodes, endPointNodeIds
        });
    } // W.selectionManager.selectedItems.length > 0
    else if (selectedFeatures.length === 1) {
        const seg = selectedFeatures[0],
            { model } = seg;
        if (model.type === 'segment') {
            if (!microDogLegsContinue && (checkForMicroDogLegs([model.attributes.fromNodeID, model.attributes.toNodeID], model.attributes.id) === true)) {
                if (_settings.microDogLegs === 'error')
                    return WazeWrap.Alerts.error(SCRIPT_NAME, I18n.t('wmesu.error.MicroDogLegs'));
                if (_settings.microDogLegs === 'warning') {
                    return WazeWrap.Alerts.confirm(
                        SCRIPT_NAME,
                        I18n.t('wmesu.prompts.MicroDogLegsConfirm'),
                        () => { doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, true, false, undefined); },
                        () => { },
                        I18n.t('wmesu.common.Yes'),
                        I18n.t('wmesu.common.No')
                    );
                }
            }
            microDogLegsContinue = true;
            const newGeo = model.geometry.clone();
            // Remove the geometry nodes
            if (newGeo.components.length > 2) {
                const UpdateSegmentGeometry = require('Waze/Action/UpdateSegmentGeometry');
                newGeo.components.splice(1, newGeo.components.length - 2);
                newGeo.components[0].calculateBounds();
                newGeo.components[1].calculateBounds();
                W.model.actionManager.add(new UpdateSegmentGeometry(model, model.geometry, newGeo));
                logDebug(`${I18n.t('wmesu.log.RemovedGeometryNodes')} # ${model.attributes.id}`);
            }
        }
    }
    else {
        logWarning(I18n.t('wmesu.log.NoSegmentsSelected'));
    }
    return true;
}

function insertSimplifyStreetGeometryButtons() {
    $('.edit-restrictions').after(`<button id="WME-SU" class="waze-btn waze-btn-small waze-btn-white" title="${I18n.t('wmesu.StraightenUpTitle')}">${I18n.t('wmesu.StraightenUp')}</button>`);
}

function loadTranslations() {
    return new Promise(resolve => {
        const translations = {
                en: {
                    StraightenUp: 'Straighten up!',
                    StraightenUpTitle: 'Click here to straighten the selected segment(s) by removing geometry nodes and moving junction nodes as needed.',
                    common: {
                        From: 'from',
                        Help: 'Help',
                        No: 'No',
                        Note: 'Note',
                        NothingMajor: 'Nothing major.',
                        To: 'to',
                        Warning: 'Warning',
                        WhatsNew: 'What\'s new',
                        Yes: 'Yes'
                    },
                    error: {
                        ConflictingNames: 'You selected segments that do not share at least one name in common amongst all the segments and have the conflicting names setting set to error. '
                            + 'Segments not straightened.',
                        LongJnMove: 'One or more of the junction nodes that were to be moved would have been moved further than 10m and you have the long junction node move setting set to '
                            + 'give error. Segments not straightened.',
                        MicroDogLegs: 'One or more of the junctions nodes in the selection have a geonode within 2 meters. This is usually the sign of a micro dog leg (mDL).<br><br>'
                            + 'You have the setting for possibe micro doglegs set to give error. Segments not straightened.',
                        NonContinuous: 'You selected segments that are not all connected and have the non-continuous selected segments setting set to give error. Segments not straightened.',
                        TooManySegments: 'You selected too many segments and have the sanity check setting set to give error. Segments not straightened.'
                    },
                    help: {
                        Note01: 'This script uses the action manager, so changes can be undone before saving.',
                        Warning01: 'Enabling (Give warning, No warning) any of these settings can cause unexpected results. Use with caution!',
                        Step01: 'Select the starting segment.',
                        Step02: 'ALT+click the ending segment.',
                        Step02note: 'If the segments you wanted to straighten are not all selected, unselect them and start over using CTRL+click to select each segment instead.',
                        Step03: 'Click "Straighten up!" button in the sidebar.'
                    },
                    log: {
                        EndPoints: 'End points',
                        MovingJunctionNode: 'Moving junction node',
                        NoSegmentsSelected: 'No segments selected.',
                        RemovedGeometryNodes: 'Removed geometry nodes for segment',
                        Segment: I18n.t('objects.segment.name'),
                        StraighteningSegments: 'Straightening segments'
                    },
                    prompts: {
                        ConflictingNamesConfirm: 'You selected segments that do not share at least one name in common amongst all the segments. Are you sure you wish to continue straightening?',
                        LongJnMoveConfirm: 'One or more of the junction nodes that are to be moved would be moved further than 10m. Are you sure you wish to continue straightening?',
                        MicroDogLegsConfirm: 'One or more of the junction nodes in the selection have a geonode within 2 meters. This is usually the sign of a micro dog leg (mDL).<br>'
                        + 'This geonode could exist on any segment connected to the junction nodes, not just the segments you selected.<br><br>'
                        + '<b>You should not continue until you are certain there are no micro dog legs.<b><br><br>'
                        + 'Are you sure you wish to continue straightening?',
                        NonContinuousConfirm: 'You selected segments that do not all connect. Are you sure you wish to continue straightening?',
                        SanityCheckConfirm: 'You selected many segments. Are you sure you wish to continue straightening?'
                    },
                    settings: {
                        GiveError: 'Give error',
                        GiveWarning: 'Give warning',
                        NoWarning: 'No warning',
                        ConflictingNames: 'Segments with conflicting names',
                        ConflictingNamesTitle: 'Select what to do if the selected segments do not share at least one name among their primary and alternate names (based on name, city and state).',
                        LongJnMove: 'Long junction node moves',
                        LongJnMoveTitle: 'Select what to do if one or more of the junction nodes would move further than 10m.',
                        MicroDogLegs: 'Possible micro doglegs (mDL)',
                        MicroDogLegsTitle: 'Select what to do if one or more of the junction nodes in the selection have a geometry node within 2m of itself, which is a possible micro dogleg (mDL).',
                        NonContinuous: 'Non-continuous selected segments',
                        NonContinuousTitle: 'Select what to do if the selected segments are not continuous.',
                        SanityCheck: 'Sanity check',
                        SanityCheckTitle: 'Select what to do if you selected a many segments.'
                    }
                },
                ru: {
                    SimplifyGeometry: 'Выровнять улицу',
                    log: {
                        EndPoints: 'конечные точки',
                        Segment: I18n.t('objects.segment.name')
                    }
                }
            },
            locale = I18n.currentLocale(),
            availTranslations = Object.keys(translations);
        I18n.translations[locale].wmesu = translations.en;
        if (availTranslations.indexOf(I18n.currentLocale()) > 0) {
            Object.keys(translations[locale]).forEach(prop => {
                if (typeof translations[locale][prop] === 'object') {
                    Object.keys(translations[locale][prop]).forEach(subProp => {
                        if (translations[locale][prop][subProp] !== '')
                            I18n.translations[locale].wmesu[prop][subProp] = translations[locale][prop][subProp];
                    });
                }
                else if (translations[locale][prop] !== '') {
                    I18n.translations[locale].wmesu[prop] = translations[locale][prop];
                }
            });
        }
        resolve();
    });
}

function registerEvents() {
    $('select[id^="WMESU-"]').off().on('change', function () {
        const setting = this.id.substr(6);
        if (this.value.toLowerCase() !== _settings[setting]) {
            _settings[setting] = this.value.toLowerCase();
            saveSettingsToStorage();
        }
    });
}

function buildSelections(selected) {
    const rVal = `<option value="nowarning"${(selected === 'nowarning' ? ' selected' : '')}>${I18n.t('wmesu.settings.NoWarning')}</option>`
    + `<option value="warning"${(selected === 'warning' ? ' selected' : '')}>${I18n.t('wmesu.settings.GiveWarning')}</option>`
    + `<option value="error"${(selected === 'error' ? ' selected' : '')}>${I18n.t('wmesu.settings.GiveError')}</option>`;
    return rVal;
}

async function init() {
    log('Initializing.');
    if (W.loginManager.getUserRank() < 2)
        return;
    await loadSettingsFromStorage();
    await loadTranslations();
    const $suTab = $('<div>', { style: 'padding:8px 16px', id: 'WMESUSettings' });
    $suTab.html([
        `<div style="margin-bottom:0px;font-size:13px;font-weight:600;">${SCRIPT_NAME}</div>`,
        `<div style="margin-top:0px;font-size:11px;font-weight:600;color:#aaa">${SCRIPT_VERSION}</div>`,
        `<div id="WMESU-div-conflictingNames" class="controls-container"><select id="WMESU-conflictingNames" style="font-size:11px;height:22px;" title="${I18n.t('wmesu.settings.ConflictingNamesTitle')}">`,
        buildSelections(_settings.conflictingNames),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmesu.settings.ConflictingNames')}</div>`,
        '</div><br/>',
        `<div id="WMESU-div-longJnMove" class="controls-container"><select id="WMESU-longJnMove" style="font-size:11px;height:22px;" title="${I18n.t('wmesu.settings.LongJnMoveTitle')}">`,
        buildSelections(_settings.longJnMove),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmesu.settings.LongJnMove')}</div>`,
        '</div><br/>',
        `<div id="WMESU-div-microDogLegs" class="controls-container"><select id="WMESU-microDogLegs" style="font-size:11px;height:22px;" title="${I18n.t('wmesu.settings.MicroDogLegsTitle')}">`,
        buildSelections(_settings.microDogLegs),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmesu.settings.MicroDogLegs')}</div>`,
        '</div><br/>',
        `<div id="WMESU-div-nonContinuousSelection" class="controls-container"><select id="WMESU-nonContinuousSelection" style="font-size:11px;height:22px;" title="${I18n.t('wmesu.settings.NonContinuousTitle')}">`,
        buildSelections(_settings.nonContinuousSelection),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmesu.settings.NonContinuous')}</div>`,
        '</div><br/>',
        `<div id="WMESU-div-sanityCheck" class="controls-container"><select id="WMESU-sanityCheck" style="font-size:11px;height:22px;" title="${I18n.t('wmesu.settings.SanityCheckTitle')}">`,
        buildSelections(_settings.sanityCheck),
        `</select><div style="display:inline-block;font-size:11px;">${I18n.t('wmesu.settings.SanityCheck')}</div>`,
        `<div style="margin-top:20px;"><div style="font-size:14px;font-weight:600;">${I18n.t('wmesu.common.Help')}:</div><div><ol style="font-weight:600;">`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmesu.help.Step01')}</p></li>`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmesu.help.Step02')}<br><b>${I18n.t('wmesu.common.Note')}:</b> ${I18n.t('wmesu.help.Step02note')}</p></li>`,
        `<li><p style="font-weight:100;margin-bottom:0px;">${I18n.t('wmesu.help.Step03')}</p></li></ol></div>`,
        `<b>${I18n.t('wmesu.common.Warning')}:</b> ${I18n.t('wmesu.help.Warning01')}<br><br><b>${I18n.t('wmesu.common.Note')}:</b> ${I18n.t('wmesu.help.Note01')}</div></div>`
    ].join(' '));
    new WazeWrap.Interface.Tab('SU!', $suTab.html(), registerEvents);
    W.selectionManager.events.register('selectionchanged', null, insertSimplifyStreetGeometryButtons);
    $('#sidebar').on('click', '#WME-SU', e => {
        e.preventDefault();
        doStraightenSegments();
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
