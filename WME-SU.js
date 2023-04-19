// ==UserScript==
// @name        WME Straighten Up! (beta)
// @namespace   https://greasyfork.org/users/166843
// @version     2023.04.19.01
// @description Straighten selected WME segment(s) by aligning along straight line between two end points and removing geometry nodes.
// @author      dBsooner
// @match       http*://*.waze.com/*editor*
// @exclude     http*://*.waze.com/user/editor*
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @grant       GM_xmlhttpRequest
// @connect     greasyfork.org
// @license     GPLv3
// ==/UserScript==

// Original credit to jonny3D and impulse200

/* global $, I18n, GM_info, GM_xmlhttpRequest, W, WazeWrap */

(function () {
    'use strict';

    // eslint-disable-next-line no-nested-ternary
    const _SCRIPT_SHORT_NAME = `WME SU!${(/beta/.test(GM_info.script.name) ? ' β' : /\(DEV\)/i.test(GM_info.script.name) ? ' Ω' : '')}`,
        _SCRIPT_LONG_NAME = GM_info.script.name,
        _IS_ALPHA_VERSION = /[Ω]/.test(_SCRIPT_SHORT_NAME),
        _IS_BETA_VERSION = /[β]/.test(_SCRIPT_SHORT_NAME),
        // SCRIPT_AUTHOR = GM_info.script.author,
        _PROD_URL = 'https://greasyfork.org/scripts/388349-wme-straighten-up/code/WME%20Straighten%20Up!.user.js',
        _PROD_META_URL = 'https://greasyfork.org/scripts/388349-wme-straighten-up/code/WME%20Straighten%20Up!.meta.js',
        _FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=289116',
        _SETTINGS_STORE_NAME = 'WMESU',
        _BETA_URL = 'YUhSMGNITTZMeTluY21WaGMzbG1iM0pyTG05eVp5OXpZM0pwY0hSekx6TTRPRE0xTUMxM2JXVXRjM1J5WVdsbmFIUmxiaTExY0MxaVpYUmhMMk52WkdVdlYwMUZKVEl3VTNSeVlXbG5hSFJsYmlVeU1GVndJU1V5TUNoaVpYUmhLUzUxYzJWeUxtcHo=',
        _BETA_META_URL = 'YUhSMGNITTZMeTluY21WaGMzbG1iM0pyTG05eVp5OXpZM0pwY0hSekx6TTRPRE0xTUMxM2JXVXRjM1J5WVdsbmFIUmxiaTExY0MxaVpYUmhMMk52WkdVdlYwMUZKVEl3VTNSeVlXbG5hSFJsYmlVeU1GVndJU1V5TUNoaVpYUmhLUzV0WlhSaExtcHo=',
        _ALERT_UPDATE = true,
        _SCRIPT_VERSION = GM_info.script.version.toString(),
        _SCRIPT_VERSION_CHANGES = ['<b>CHANGE:</b> WME production now includes function from WME beta.'],
        _DEBUG = /[βΩ]/.test(_SCRIPT_SHORT_NAME),
        _LOAD_BEGIN_TIME = performance.now(),
        _timeouts = { onWmeReady: undefined, saveSettingsToStorage: undefined },
        _editPanelObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const addedNode = mutation.addedNodes[i];
                    if (addedNode.nodeType === Node.ELEMENT_NODE) {
                        if (addedNode.querySelector('#segment-edit-general .form-group.more-actions'))
                            insertSimplifyStreetGeometryButtons();
                    }
                }
            });
        });
    let _lastVersionChecked = '0',
        _settings = {};

    async function loadSettingsFromStorage() {
        const defaultSettings = {
                conflictingNames: 'warning',
                longJnMove: 'warning',
                microDogLegs: 'warning',
                nonContinuousSelection: 'warning',
                sanityCheck: 'warning',
                runStraightenUpShortcut: '',
                lastSaved: 0,
                lastVersion: undefined
            },
            loadedSettings = $.parseJSON(localStorage.getItem(_SETTINGS_STORE_NAME));
        _settings = $.extend({}, defaultSettings, loadedSettings);
        const serverSettings = await WazeWrap.Remote.RetrieveSettings(_SETTINGS_STORE_NAME);
        if (serverSettings?.lastSaved > _settings.lastSaved)
            $.extend(_settings, serverSettings);
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);
        return Promise.resolve();
    }

    function saveSettingsToStorage() {
        checkTimeout({ timeout: 'saveSettingsToStorage' });
        if (localStorage) {
            _settings.lastVersion = _SCRIPT_VERSION;
            _settings.lastSaved = Date.now();
            localStorage.setItem(_SETTINGS_STORE_NAME, JSON.stringify(_settings));
            WazeWrap.Remote.SaveSettings(_SETTINGS_STORE_NAME, _settings);
            logDebug('Settings saved.');
        }
    }

    function checkShortcutChanged() {
        let keys = '';
        const { shortcut } = W.accelerators.Actions.runStraightenUpShortcut;
        if (shortcut) {
            if (shortcut.altKey)
                keys += 'A';
            if (shortcut.shiftKey)
                keys += 'S';
            if (shortcut.ctrlKey)
                keys += 'C';
            if (keys !== '')
                keys += '+';
            if (shortcut.keyCode)
                keys += shortcut.keyCode;
        }
        else {
            keys = '';
        }
        if (_settings.runStraightenUpShortcut !== keys) {
            _settings.runStraightenUpShortcut = keys;
            saveSettingsToStorage();
        }
    }

    function showScriptInfoAlert() {
        if (_ALERT_UPDATE && (_SCRIPT_VERSION !== _settings.lastVersion)) {
            let releaseNotes = '';
            releaseNotes += `<p>${I18n.t('wmesu.common.WhatsNew')}:</p>`;
            if (_SCRIPT_VERSION_CHANGES.length > 0) {
                releaseNotes += '<ul>';
                for (let idx = 0; idx < _SCRIPT_VERSION_CHANGES.length; idx++)
                    releaseNotes += `<li>${_SCRIPT_VERSION_CHANGES[idx]}`;
                releaseNotes += '</ul>';
            }
            else {
                releaseNotes += `<ul><li>${I18n.t('wmesu.common.NothingMajor')}</ul>`;
            }
            WazeWrap.Interface.ShowScriptUpdate(_SCRIPT_SHORT_NAME, _SCRIPT_VERSION, releaseNotes, (_IS_BETA_VERSION ? dec(_BETA_URL) : _PROD_URL).replace(/code\/.*\.js/, ''), _FORUM_URL);
        }
    }

    function checkTimeout(obj) {
        if (obj.toIndex) {
            if (_timeouts[obj.timeout]?.[obj.toIndex]) {
                window.clearTimeout(_timeouts[obj.timeout][obj.toIndex]);
                delete (_timeouts[obj.timeout][obj.toIndex]);
            }
        }
        else {
            if (_timeouts[obj.timeout])
                window.clearTimeout(_timeouts[obj.timeout]);
            _timeouts[obj.timeout] = undefined;
        }
    }

    function log(message, data = '') { console.log(`${_SCRIPT_SHORT_NAME}:`, message, data); }
    function logError(message, data = '') { console.error(`${_SCRIPT_SHORT_NAME}:`, new Error(message), data); }
    function logWarning(message, data = '') { console.warn(`${_SCRIPT_SHORT_NAME}:`, message, data); }
    function logDebug(message, data = '') {
        if (_DEBUG)
            log(message, data);
    }

    function dec(s = '') {
        return atob(atob(s));
    }

    // рассчитаем пересчечение перпендикуляра точки с наклонной прямой
    // Calculate the intersection of the perpendicular point with an inclined line
    function getIntersectCoord(a, b, c, d) {
    // второй вариант по-проще: http://rsdn.ru/forum/alg/2589531.hot
        const r = [2];
        // eslint-disable-next-line no-mixed-operators
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

    function checkNameContinuity(segmentSelectionArr = []) {
        const streetIds = [];
        for (let idx = 0; idx < segmentSelectionArr.length; idx++) {
            if (idx > 0) {
                if ((segmentSelectionArr[idx].attributes.primaryStreetID > 0) && (streetIds.indexOf(segmentSelectionArr[idx].attributes.primaryStreetID) > -1))
                // eslint-disable-next-line no-continue
                    continue;
                if (segmentSelectionArr[idx].attributes.streetIDs.length > 0) {
                    let included = false;
                    for (let idx2 = 0; idx2 < segmentSelectionArr[idx].attributes.streetIDs.length; idx2++) {
                        if (streetIds.indexOf(segmentSelectionArr[idx].attributes.streetIDs[idx2]) > -1) {
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
                if (segmentSelectionArr[idx].attributes.primaryStreetID > 0)
                    streetIds.push(segmentSelectionArr[idx].attributes.primaryStreetID);
                if (segmentSelectionArr[idx].attributes.streetIDs.length > 0)
                    segmentSelectionArr[idx].attributes.streetIDs.forEach((streetId) => { streetIds.push(streetId); });
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
                        if (!segObj.geometry.components.every((geoComp) => checkGeoComp(geoComp, node4326)))
                            return true;
                    }
                }
            }
        }
        return false;
    }

    function doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, longJnMoveContinue, passedObj) {
        const segmentSelection = W.selectionManager.getSegmentSelection();
        if (longJnMoveContinue && passedObj) {
            const { segmentsToRemoveGeometryArr } = passedObj,
                { nodesToMoveArr } = passedObj,
                { distinctNodes } = passedObj,
                { endPointNodeIds } = passedObj;
            logDebug(`${I18n.t('wmesu.log.StraighteningSegments')}: ${distinctNodes.join(', ')} (${distinctNodes.length})`);
            logDebug(`${I18n.t('wmesu.log.EndPoints')}: ${endPointNodeIds.join(' & ')}`);
            if (segmentsToRemoveGeometryArr?.length > 0) {
                const UpdateSegmentGeometry = require('Waze/Action/UpdateSegmentGeometry');
                segmentsToRemoveGeometryArr.forEach((obj) => {
                    W.model.actionManager.add(new UpdateSegmentGeometry(obj.segment, obj.geometry, obj.newGeo));
                    logDebug(`${I18n.t('wmesu.log.RemovedGeometryNodes')} # ${obj.segment.attributes.id}`);
                });
            }
            if (nodesToMoveArr?.length > 0) {
                const MoveNode = require('Waze/Action/MoveNode');
                let straightened = false;
                nodesToMoveArr.forEach((node) => {
                    if ((Math.abs(node.geometry.x - node.nodeGeo.x) > 0.00000001) || (Math.abs(node.geometry.y - node.nodeGeo.y) > 0.00000001)) {
                        logDebug(`${I18n.t('wmesu.log.MovingJunctionNode')} # ${node.node.attributes.id} `
                        + `- ${I18n.t('wmesu.common.From')}: ${node.geometry.x},${node.geometry.y} - `
                        + `${I18n.t('wmesu.common.To')}: ${node.nodeGeo.x},${node.nodeGeo.y}`);
                        W.model.actionManager.add(new MoveNode(node.node, node.geometry, node.nodeGeo, node.connectedSegObjs, {}));
                        straightened = true;
                    }
                });
                if (!straightened) {
                    logDebug(I18n.t('wmesu.log.AllNodesStraight'));
                    WazeWrap.Alerts.info(_SCRIPT_SHORT_NAME, I18n.t('wmesu.log.AllNodesStraight'));
                    return;
                }
            }
        }
        else if (segmentSelection.segments.length > 1) {
            const segmentsToRemoveGeometryArr = [],
                nodesToMoveArr = [];
            if ((segmentSelection.segments.length > 10) && !sanityContinue) {
                if (_settings.sanityCheck === 'error') {
                    WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.TooManySegments'));
                    insertSimplifyStreetGeometryButtons(true);
                    return;
                }
                if (_settings.sanityCheck === 'warning') {
                    WazeWrap.Alerts.confirm(
                        _SCRIPT_SHORT_NAME,
                        I18n.t('wmesu.prompts.SanityCheckConfirm'),
                        () => { doStraightenSegments(true, false, false, false, false, undefined); },
                        () => { insertSimplifyStreetGeometryButtons(true); },
                        I18n.t('wmesu.common.Yes'),
                        I18n.t('wmesu.common.No')
                    );
                    return;
                }
            }
            sanityContinue = true;
            if ((segmentSelection.multipleConnectedComponents === true) && !nonContinuousContinue) {
                if (_settings.nonContinuousSelection === 'error') {
                    WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.NonContinuous'));
                    insertSimplifyStreetGeometryButtons(true);
                    return;
                }
                if (_settings.nonContinuousSelection === 'warning') {
                    WazeWrap.Alerts.confirm(
                        _SCRIPT_SHORT_NAME,
                        I18n.t('wmesu.prompts.NonContinuousConfirm'),
                        () => { doStraightenSegments(sanityContinue, true, false, false, false, undefined); },
                        () => { insertSimplifyStreetGeometryButtons(true); },
                        I18n.t('wmesu.common.Yes'),
                        I18n.t('wmesu.common.No')
                    );
                    return;
                }
            }
            nonContinuousContinue = true;
            if (_settings.conflictingNames !== 'nowarning') {
                const continuousNames = checkNameContinuity(segmentSelection.segments);
                if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'error')) {
                    WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.ConflictingNames'));
                    insertSimplifyStreetGeometryButtons(true);
                    return;
                }
                if (!continuousNames && !conflictingNamesContinue && (_settings.conflictingNames === 'warning')) {
                    WazeWrap.Alerts.confirm(
                        _SCRIPT_SHORT_NAME,
                        I18n.t('wmesu.prompts.ConflictingNamesConfirm'),
                        () => { doStraightenSegments(sanityContinue, nonContinuousContinue, true, false, false, undefined); },
                        () => { insertSimplifyStreetGeometryButtons(true); },
                        I18n.t('wmesu.common.Yes'),
                        I18n.t('wmesu.common.No')
                    );
                    return;
                }
            }
            conflictingNamesContinue = true;
            const allNodeIds = [],
                dupNodeIds = [];
            let endPointNodeIds,
                longMove = false;
            for (let idx = 0; idx < segmentSelection.segments.length; idx++) {
                allNodeIds.push(segmentSelection.segments[idx].attributes.fromNodeID);
                allNodeIds.push(segmentSelection.segments[idx].attributes.toNodeID);
                if (segmentSelection.segments[idx].type === 'segment') {
                    const newGeo = segmentSelection.segments[idx].geometry.clone();
                    // Remove the geometry nodes
                    if (newGeo.components.length > 2) {
                        newGeo.components.splice(1, newGeo.components.length - 2);
                        newGeo.components[0].calculateBounds();
                        newGeo.components[1].calculateBounds();
                        segmentsToRemoveGeometryArr.push({ segment: segmentSelection.segments[idx], geometry: segmentSelection.segments[idx].geometry, newGeo });
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
                if (_settings.microDogLegs === 'error') {
                    WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.MicroDogLegs'));
                    insertSimplifyStreetGeometryButtons(true);
                    return;
                }
                if (_settings.microDogLegs === 'warning') {
                    WazeWrap.Alerts.confirm(
                        _SCRIPT_SHORT_NAME,
                        I18n.t('wmesu.prompts.MicroDogLegsConfirm'),
                        () => { doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, true, false, undefined); },
                        () => { insertSimplifyStreetGeometryButtons(true); },
                        I18n.t('wmesu.common.Yes'),
                        I18n.t('wmesu.common.No')
                    );
                    return;
                }
            }
            microDogLegsContinue = true;
            if (segmentSelection.multipleConnectedComponents === false)
                endPointNodeIds = distinctNodes.filter((nodeId) => !dupNodeIds.includes(nodeId));
            else
                endPointNodeIds = [segmentSelection.segments[0].attributes.fromNodeID, segmentSelection.segments[(segmentSelection.segments.length - 1)].attributes.toNodeID];
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
            distinctNodes.forEach((nodeId) => {
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
            if (longMove && (_settings.longJnMove === 'error')) {
                WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.LongJnMove'));
                insertSimplifyStreetGeometryButtons(true);
                return;
            }
            if (longMove && (_settings.longJnMove === 'warning')) {
                WazeWrap.Alerts.confirm(
                    _SCRIPT_SHORT_NAME,
                    I18n.t('wmesu.prompts.LongJnMoveConfirm'),
                    () => {
                        doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, true, {
                            segmentsToRemoveGeometryArr, nodesToMoveArr, distinctNodes, endPointNodeIds
                        });
                    },
                    () => { insertSimplifyStreetGeometryButtons(true); },
                    I18n.t('wmesu.common.Yes'),
                    I18n.t('wmesu.common.No')
                );
                return;
            }
            doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, microDogLegsContinue, true, {
                segmentsToRemoveGeometryArr, nodesToMoveArr, distinctNodes, endPointNodeIds
            });
        }
        else if (segmentSelection.segments.length === 1) {
            const seg = segmentSelection.segments[0];
            if (seg.type === 'segment') {
                if (!microDogLegsContinue && (checkForMicroDogLegs([seg.attributes.fromNodeID, seg.attributes.toNodeID], seg.attributes.id) === true)) {
                    if (_settings.microDogLegs === 'error') {
                        WazeWrap.Alerts.error(_SCRIPT_SHORT_NAME, I18n.t('wmesu.error.MicroDogLegs'));
                        insertSimplifyStreetGeometryButtons(true);
                        return;
                    }
                    if (_settings.microDogLegs === 'warning') {
                        WazeWrap.Alerts.confirm(
                            _SCRIPT_SHORT_NAME,
                            I18n.t('wmesu.prompts.MicroDogLegsConfirm'),
                            () => { doStraightenSegments(sanityContinue, nonContinuousContinue, conflictingNamesContinue, true, false, undefined); },
                            () => { insertSimplifyStreetGeometryButtons(true); },
                            I18n.t('wmesu.common.Yes'),
                            I18n.t('wmesu.common.No')
                        );
                        return;
                    }
                }
                microDogLegsContinue = true;
                const newGeo = seg.geometry.clone();
                // Remove the geometry nodes
                if (newGeo.components.length > 2) {
                    const UpdateSegmentGeometry = require('Waze/Action/UpdateSegmentGeometry');
                    newGeo.components.splice(1, newGeo.components.length - 2);
                    newGeo.components[0].calculateBounds();
                    newGeo.components[1].calculateBounds();
                    W.model.actionManager.add(new UpdateSegmentGeometry(seg, seg.geometry, newGeo));
                    logDebug(`${I18n.t('wmesu.log.RemovedGeometryNodes')} # ${seg.attributes.id}`);
                }
            }
        }
        else {
            logWarning(I18n.t('wmesu.log.NoSegmentsSelected'));
        }
        insertSimplifyStreetGeometryButtons(true);
    }

    function insertSimplifyStreetGeometryButtons(recreate = false) {
        const $elem = $('#segment-edit-general .form-group.more-actions');
        if (($('#WME-SU').length > 0) && recreate)
            $('#WME-SU').remove();
        if ($('#WME-SU').length === 0) {
            if ($elem.length === 0)
                return;
            if ($elem.find('wz-button').length > 0) {
                $elem.append($(
                    '<wz-button>',
                    { id: 'WME-SU', color: 'secondary', size: 'sm' }
                ).text(I18n.t('wmesu.StraightenUp')).attr('title', I18n.t('wmesu.StraightenUpTitle')).click(doStraightenSegments));
            }
            else {
                $elem.append($(
                    '<button>',
                    { id: 'WME-SU', class: 'waze-btn waze-btn-small waze-btn-white' }
                ).text(I18n.t('wmesu.StraightenUp')).attr('title', I18n.t('wmesu.StraightenUpTitle')).click(doStraightenSegments));
            }
        }
    }

    function loadTranslations() {
        return new Promise((resolve) => {
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
                            AllNodesStraight: 'All junction nodes that would be moved are already considered \'straight\'. No junction nodes were moved.',
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
                        StraightenUp: 'Выпрямить сегменты!',
                        StraightenUpTitle: 'Нажмите, чтобы выпрямить выбранные сегменты, удалив лишние геометрические точки и переместив узлы перекрёстков в ровную линию.',
                        common: {
                            From: 'с',
                            Help: 'Помощь',
                            No: 'Нет',
                            Note: 'Примечание',
                            NothingMajor: 'Не критично.',
                            To: 'до',
                            Warning: 'Предупреждение',
                            WhatsNew: 'Что нового',
                            Yes: 'Да'
                        },
                        error: {
                            ConflictingNames: 'Вы выбрали сегменты, которые не имеют хотя бы одного общего названия улицы среди выделенных.'
                            + 'Сегменты не были выпрямлены.',
                            LongJnMove: 'Для выпрямления сегментов, их узлы должны быть перемещены более чем на 10 м, но в настройках у вас установлено ограничение перемещения на такое большое '
                            + 'расстояние. Сегменты не были выпрямлены.',
                            MicroDogLegs: 'Один или несколько узлов выбранных сегментов имеют точку в пределах 2 метров. Обычно это признак “<a href=”https://wazeopedia.waze.com/wiki/Benelux/Junction_Arrows” target=”blank”>микроискривления</a>”.<br><br>'
                            + 'В настройках для возможных микроискривлений у вас выставлено ограничение, чтобы выдать ошибку. Сегменты не были выпрямлены.',
                            NonContinuous: 'Вы выбрали сегменты, которые не соединены между собой, но в настройках у вас установлено ограничение для работы с такими сегментами. Сегменты не были '
                            + 'выпрямлены.',
                            TooManySegments: 'Вы выбрали слишком много сегментов, но в настройках у вас включено ограничение на количество одновременно обрабатываемых сегментов. Сегменты не были '
                            + 'выпрямлены.'
                        },
                        help: {
                            Note01: 'Этот скрипт использует историю действий, поэтому перед их сохранением изменения можно отменить.',
                            Warning01: 'Настройка любого из этих параметров в положение (Выдать предупреждение, Не предупреждать) может привести к неожиданным результатам. Используйте с осторожностью!',
                            Step01: 'Выделите начальный сегмент.',
                            Step02: 'При помощи Alt-кнопки, выделите конечный сегмент.',
                            Step02note: 'Если выделены не все нужные вам сегменты, при помощи Ctrl-кнопки можно дополнительно выделить или снять выделения сегментов.',
                            Step03: 'Нажмите ‘Выпрямить сегменты!’ на левой панели.'
                        },
                        log: {
                            AllNodesStraight: 'Все узлы, которые нужно было выпрямить, уже выровнены в линию. Сегменты оставлены без изменений.',
                            EndPoints: 'конечные точки',
                            MovingJunctionNode: 'Перемещение узла',
                            NoSegmentsSelected: 'Сегменты не выделены.',
                            RemovedGeometryNodes: 'Удалены лишние точки сегмента',
                            Segment: I18n.t('objects.segment.name'),
                            StraighteningSegments: 'Выпрямление сегментов'
                        },
                        prompts: {
                            ConflictingNamesConfirm: 'Вы выбрали сегменты, которые не имеют хотя бы одного общего названия среди всех сегментов. Вы уверены, что хотите продолжить выпрямление?',
                            LongJnMoveConfirm: 'Один или несколько узлов будут перемещены более, чем на 10 метров. Вы уверены, что хотите продолжить выпрямление?',
                            MicroDogLegsConfirm: 'Один или несколько узлов выбранных сегментов имеют точки в пределах 2 метров. Обычно это признак “<a href=”https://wazeopedia.waze.com/wiki/Benelux/Junction_Arrows” target=”blank”>микроискривления</a>”.<br>'
                        + 'Такая точка может находиться в любом сегменте, соединенном с выбранными вами сегментами и узлами, а не только на них самих.<br><br>'
                        + '<b>Вы не должны продолжать до тех пор, пока не убедитесь, что у вас нет “микроискривлений”.<b><br><br>'
                        + 'Вы уверены,что готовы продолжать выпрямление?',
                            NonContinuousConfirm: 'Вы выбрали сегменты, которые не соединяются друг с другом. Вы уверены, что хотите продолжить выпрямление?',
                            SanityCheckConfirm: 'Вы выбрали слишком много сегментов. Вы уверены, что хотите продолжить выпрямление?'
                        },
                        settings: {
                            GiveError: 'Выдать ошибку',
                            GiveWarning: 'Выдать предупреждение',
                            NoWarning: 'Не предупреждать',
                            ConflictingNames: 'Сегменты с разными названиями',
                            ConflictingNamesTitle: 'Выберите, что делать, если выбранные сегменты не содержат хотя бы одно название среди своих основных и альтернативных названий (на основе улицы, '
                            + 'города и района).',
                            LongJnMove: 'Перемещение узлов на большие расстояния',
                            LongJnMoveTitle: 'Выберите, что делать, если один или несколько узлов будут перемещаться дальше, чем на 10 метров.',
                            MicroDogLegs: 'Допускать “<a href=”https://wazeopedia.waze.com/wiki/Benelux/Junction_Arrows” target=”blank”>микроискривления</a>”',
                            MicroDogLegsTitle: 'Выберите, что делать, если один или несколько узлов соединения в выделении имеют точку в пределах 2 м от себя, что является возможным “микроискривлением”.',
                            NonContinuous: 'Не соединённые сегменты',
                            NonContinuousTitle: 'Выберите, что делать, если выбранные сегменты не соединены друг с другом.',
                            SanityCheck: 'Ограничение нагрузки',
                            SanityCheckTitle: 'Выберите, что делать, если вы выбрали слишком много сегментов.'
                        }
                    }
                },
                locale = I18n.currentLocale();
            I18n.translations[locale].wmesu = translations.en;
            translations['en-US'] = { ...translations.en };
            I18n.translations[locale].wmesu = $.extend({}, translations.en, translations[locale]);
            resolve();
        });
    }

    function buildSelections(selected) {
        const rVal = `<option value="nowarning"${(selected === 'nowarning' ? ' selected' : '')}>${I18n.t('wmesu.settings.NoWarning')}</option>`
            + `<option value="warning"${(selected === 'warning' ? ' selected' : '')}>${I18n.t('wmesu.settings.GiveWarning')}</option>`
            + `<option value="error"${(selected === 'error' ? ' selected' : '')}>${I18n.t('wmesu.settings.GiveError')}</option>`;
        return rVal;
    }

    function onWazeTabReady() {
        $('span:contains("SU")').filter(function () { return $(this).parent('a').length > 0; }).parents('li').attr('title', 'Straighten Up!');
        $('select[id^="WMESU-"]').off().on('change', function () {
            const setting = this.id.substr(6);
            if (this.value.toLowerCase() !== _settings[setting]) {
                _settings[setting] = this.value.toLowerCase();
                saveSettingsToStorage();
            }
        });
    }

    function checkSuVersion() {
        if (_IS_ALPHA_VERSION)
            return;
        try {
            const metaUrl = _IS_BETA_VERSION ? dec(_BETA_META_URL) : _PROD_META_URL;
            GM_xmlhttpRequest({
                url: metaUrl,
                onload(res) {
                    const latestVersion = res.responseText.match(/@version\s+(.*)/)[1];
                    if ((latestVersion > _SCRIPT_VERSION) && (latestVersion > (_lastVersionChecked || '0'))) {
                        _lastVersionChecked = latestVersion;
                        WazeWrap.Alerts.info(
                            _SCRIPT_LONG_NAME,
                            `<a href="${(_IS_BETA_VERSION ? dec(_BETA_URL) : _PROD_URL)}" target = "_blank">Version ${latestVersion}</a> is available.<br>Update now to get the latest features and fixes.`,
                            true,
                            false
                        );
                    }
                },
                onerror(res) {
                    // Silently fail with an error message in the console.
                    logError('Upgrade version check:', res);
                }
            });
        }
        catch (err) {
            // Silently fail with an error message in the console.
            logError('Upgrade version check:', err);
        }
    }

    async function onWazeWrapReady() {
        log('Initializing.');
        checkSuVersion();
        setInterval(checkSuVersion, 60 * 60 * 1000);
        if (W.loginManager.getUserRank() < 2)
            return;
        await loadSettingsFromStorage();
        await loadTranslations();
        const $suTab = $('<div>', { style: 'padding:8px 16px', id: 'WMESUSettings' });
        $suTab.html([
            `<div style="margin-bottom:0px;font-size:13px;font-weight:600;">${_SCRIPT_SHORT_NAME}</div>`,
            `<div style="margin-top:0px;font-size:11px;font-weight:600;color:#aaa">${_SCRIPT_VERSION}</div>`,
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
        WazeWrap.Interface.Tab('SU!', $suTab.html(), onWazeTabReady, 'SU!');
        logDebug('Enabling MOs.');
        _editPanelObserver.observe(document.querySelector('#edit-panel'), {
            childList: true, attributes: false, attributeOldValue: false, characterData: false, characterDataOldValue: false, subtree: true
        });
        W.selectionManager.events.register('selectionchanged', null, insertSimplifyStreetGeometryButtons);
        if (W.selectionManager.getSegmentSelection().segments.length > 0)
            insertSimplifyStreetGeometryButtons();
        window.addEventListener('beforeunload', () => { checkShortcutChanged(); }, false);
        new WazeWrap.Interface.Shortcut(
            'runStraightenUpShortcut',
            'Run straighten up',
            'editing',
            'Straighten Up',
            _settings.runStraightenUpShortcut,
            () => {
                if ($('#WME-SU').length > 0)
                    $('#WME-SU').click();
            },
            null
        ).add();
        showScriptInfoAlert();
        log(`Fully initialized in ${Math.round(performance.now() - _LOAD_BEGIN_TIME)} ms.`);
        setTimeout(checkShortcutChanged, 10000);
    }

    function onWmeReady(tries = 1) {
        if (typeof tries === 'object')
            tries = 1;
        checkTimeout({ timeout: 'onWmeReady' });
        if (WazeWrap?.Ready) {
            logDebug('WazeWrap is ready. Proceeding with initialization.');
            onWazeWrapReady();
        }
        else if (tries < 1000) {
            logDebug(`WazeWrap is not in Ready state. Retrying ${tries} of 1000.`);
            _timeouts.onWmeReady = window.setTimeout(onWmeReady, 200, ++tries);
        }
        else {
            logError('onWmeReady timed out waiting for WazeWrap Ready state.');
        }
    }

    function onWmeInitialized() {
        if (W.userscripts?.state?.isReady) {
            logDebug('W is ready and already in "wme-ready" state. Proceeding with initialization.');
            onWmeReady();
        }
        else {
            logDebug('W is ready, but state is not "wme-ready". Adding event listener.');
            document.addEventListener('wme-ready', onWmeReady, { once: true });
        }
    }

    function bootstrap() {
        if (!W) {
            logDebug('W is not available. Adding event listener.');
            document.addEventListener('wme-initialized', onWmeInitialized, { once: true });
        }
        else {
            onWmeInitialized();
        }
    }

    bootstrap();
}
)();
