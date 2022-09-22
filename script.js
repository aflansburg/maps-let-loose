const mll = (function () {
    'use strict';

    const elements = {};
    const controls = {};

    function idx(p, o) {
        return p.reduce((xs, x) => (xs && xs[x]) ? xs[x] : null, o)
    }

    function uuidv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function parseQuery(queryString) {
        const query = {};
        const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
        for (let i = 0; i < pairs.length; i++) {
            let pair = pairs[i].split('=');
            query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
        }
        return query;
    }

    function sanitize(input) {
        return String(input).trim()
            .substring(0, 50)
            .replaceAll(/[^\w+ !@#$&%=,/\-\[\]]/gi, '');
    }

    let lastLoadedMap;
    let roomsMode = false;
    let roomsRole = 'viewer';
    let socket;
    let currentLoadedPoints = '';
    let contextMenuEvent;
    let placed = [];
    let drawings = [];
    let resetSelectedPoints = false;

    function updateZoomScale() {
        const zoom = controls.fabricCanvas.getZoom();
        let scale = (3 / zoom) - 2.5;
        if (scale <= 1) {
            scale = 1;
        } else if (scale >= 2.25) {
            scale = 2.25;
        }

        const doScale = controls.checkZoomScale.is(":checked");
        for (let i = 0; i < placed.length; i++) {
            const object = placed[i];
            const meta = object.type;
            if (meta.type === "custom-radius") {
                const textEl = idx(["type", "text"], object);
                if (!textEl) {
                    console.log("no text");
                } else {
                    // console.log(object);
                    const meters = Math.trunc((10 * object.getScaledWidth()) / 19);
                    textEl.set({
                        text: meters + "m"
                    })
                }
            }
            const typeMeta = placedMeta[meta.type];
            if (!typeMeta) {
                continue;
            }
            if (doScale && (typeMeta.zoomScale || (typeMeta.hasOwnProperty("zoomScaleWhen") && typeMeta.zoomScaleWhen()))) {
                object.set({scaleX: scale, scaleY: scale});
            } else {
                object.set({scaleX: 1, scaleY: 1});
            }
        }

        controls.fabricCanvas.requestRenderAll();
    }

    function getSelectedSp() {
        const selected = [];
        $(".sp-toggle.available.selected").each(function (i, el) {
            const toggle = $(el);
            selected.push('' + toggle.data('x') + toggle.data('y'));
        })
        return selected;
    }

    async function loadFromRoomState(message) {
        if (!message || !message.state) {
            console.warn('message or state was null')
            return;
        }

        console.log("loadFromState()")
        console.log(message);

        const controlState = message.state.controls;
        if (controlState) {
            console.log('updating controls state')
            controls.comboMapSelect.val(controlState.map);
            controls.checkGrid.prop('checked', controlState.grid);
            controls.checkDefaultGarries.prop('checked', controlState.defaultGarries);
            controls.checkPlacedGarries.prop('checked', controlState.placed);
            controls.checkGarryRadius.prop('checked', controlState.spawnRadius);
            controls.checkArty.prop('checked', controlState.arty);
            controls.checkArtyFlip.prop('checked', controlState.flipArty);
            controls.checkStrongpoints.prop('checked', controlState.sp);
            controls.checkSpResource.prop('checked', controlState.spResource);
            controls.checkSectors.prop('checked', controlState.sectors);
            controls.checkSectorSwap.prop('checked', controlState.swapSectors);
            controls.sectorRange.val(controlState.sectorValue);
            controls.checkDrawingsVisible.prop('checked', controlState.drawings);

            internal.roomsLoadMapAndSP(controlState.map, controlState.selectedSp);
        }

        const elementState = message.state.elements;
        if (elementState) {
            console.log('updating element state')

            const updateIds = [];
            for (let i = 0; i < elementState.length; i++) {
                updateIds.push(elementState[i].type.id);
            }

            // remove elements not un update list
            const currentIds = [];
            const newPlaced = [];
            for (let i = 0; i < placed.length; i++) {
                const element = placed[i];
                if (updateIds.indexOf(element.type.id) === -1) {
                    console.log('removing ' + element.type.id)
                    controls.fabricCanvas.remove(element);
                    controls.exportCanvas.remove(element);
                } else {
                    newPlaced.push(element);
                    currentIds.push(element.type.id);
                }
            }
            placed = newPlaced;

            // update element angle and position if changed
            for (let i = 0; i < placed.length; i++) {
                const element = placed[i];
                for (let j = 0; j < elementState.length; j++) {
                    const updated = elementState[j];
                    if (element.type.id === updated.type.id) {
                        element.set({
                            angle: updated.angle,
                            top: updated.top,
                            left: updated.left,
                            scaleX: updated.scaleX,
                            scaleY: updated.scaleY
                        })
                        if (roomsMode && roomsRole === 'viewer') {
                            element.set({
                                selectable: false,
                                evented: false
                            })
                        }
                    }
                }
            }

            // add elements from update not in current list

            console.log(elementState);
            for (let i = 0; i < elementState.length; i++) {
                const meta = elementState[i].type;

                if (currentIds.indexOf(meta.id) === -1) {
                    console.log('adding ' + meta.id)
                    addMapElement(meta.originalEvent, meta.type, meta.modifier, false, meta.id, elementState[i]);
                }
            }
        }

        if (controlState || elementState) {
            internal.updateStatesAndRender();
        }

        const drawingState = message.state.drawings;
        if (drawingState) {
            console.log('updating drawing state')
            while (drawings.length) {
                const element = drawings.pop();
                controls.fabricCanvas.remove(element);
                controls.exportCanvas.remove(element);
            }

            fabric.util.enlivenObjects(drawingState, function (objects) {
                objects.forEach(function (o) {
                    drawings.push(o);

                    o.set({
                        zIndex: zIndex.drawings,
                        evented: false,
                        selectable: false,
                        visible: (idx(["state", "controls", "drawings"], message) || controls.checkDrawingsVisible.is(":checked"))
                    });

                    controls.fabricCanvas.add(o);
                    controls.exportCanvas.add(o);
                });
            });
            controls.fabricCanvas.orderByZindex();
            controls.exportCanvas.orderByZindex();

            internal.render();
        }
    }

    function getFullState() {
        return {
            state: {
                controls: getControlsRoomState(),
                elements: getElementsRoomState(),
                drawings: drawings
            }
        }
    }

    function getControlsRoomState() {
        return {
            map: controls.comboMapSelect.val(),
            grid: controls.checkGrid.is(":checked"),
            defaultGarries: controls.checkDefaultGarries.is(":checked"),
            placed: controls.checkPlacedGarries.is(":checked"),
            spawnRadius: controls.checkGarryRadius.is(":checked"),
            arty: controls.checkArty.is(":checked"),
            flipArty: controls.checkArtyFlip.is(":checked"),
            sp: controls.checkStrongpoints.is(":checked"),
            spResource: controls.checkSpResource.is(":checked"),
            selectedSp: getSelectedSp(),
            sectors: controls.checkSectors.is(":checked"),
            swapSectors: controls.checkSectorSwap.is(":checked"),
            sectorValue: controls.sectorRange.val(),
            drawings: controls.checkDrawingsVisible.is(":checked")
        }
    }

    function roomEditorUpdateControls(control) {
        const controlAbout = control instanceof jQuery ? control.attr("id") + "=" + (control.val() || control.is(":checked")) : control;
        console.log("roomEditorUpdateControls(" + controlAbout + ")")
        if (roomsMode && roomsRole === 'editor') {
            console.log('sending editor-controls event')
            const payload = {
                roomId: controls.inputRoomId.val(),
                editorKey: $("#editorKeyDisplay").val(),
                state: {
                    controls: getControlsRoomState()
                },
                controlsChange: controlAbout
            };
            console.log(payload);
            socket.emit('editor-controls', payload);
        }
    }

    function getElementsRoomState() {
        // images cannot be enlivened as easily as drawings
        // storing only necessary data to recreate in the clients
        const reducedElements = [];
        for (let i = 0; i < placed.length; i++) {
            const element = placed[i];
            reducedElements.push({
                angle: element.angle,
                height: element.height,
                left: element.left,
                top: element.top,
                type: element.type,
                width: element.width,
                scaleX: element.scaleX,
                scaleY: element.scaleY
            })
        }

        return reducedElements;
    }

    function roomEditorUpdateElements() {
        if (roomsMode && roomsRole === 'editor') {
            console.log('sending editor-elements event');

            socket.emit('editor-elements', {
                roomId: controls.inputRoomId.val(),
                editorKey: $("#editorKeyDisplay").val(),
                state: {
                    elements: getElementsRoomState().slice(0, 50)
                }
            });
        }
    }

    function roomEditorUpdateDrawings() {
        if (roomsMode && roomsRole === 'editor') {
            console.log('sending editor-drawings event')
            socket.emit('editor-drawings', {
                roomId: controls.inputRoomId.val(),
                editorKey: $("#editorKeyDisplay").val(),
                state: {
                    drawings: drawings.slice(0, 50)
                }
            });
        }
    }

    const zIndex = {
        map: 0,
        grid: 1,
        points: 2,
        sectors: 3,
        arty_range: 5,
        default_garrisons: 6,
        drawings: 7,
        garry: 8,
        airhead: 9,
        halftrack: 9,
        tank: 9,
        truck: 9,
        'at-gun': 9,
        enemy: 9,
    }
    const placedMeta = {
        garry: {
            wh: 380,
            resolveImg: function (object) {
                const sectorBred = controls.checkSectorSwap.is(":checked");
                const sectorsVisible = controls.checkSectors.is(":checked");
                const radiusHidden = controls.checkGarryRadius.is(":checked");
                const objectX = object.left;
                const objectY = object.top;

                if (radiusHidden) {
                    return './maps/garry-plain.png';
                } else if (sectorsVisible &&
                    (!sectorBred && rectContainsPoint(elements.sectorA, objectX, objectY) ||
                        sectorBred && rectContainsPoint(elements.sectorB, objectX, objectY))) {
                    return './maps/garry-red-zone.png';
                } else if (sectorsVisible &&
                    (sectorBred && rectContainsPoint(elements.sectorA, objectX, objectY) ||
                        !sectorBred && rectContainsPoint(elements.sectorB, objectX, objectY))) {
                    return './maps/garry-blue-zone.png';
                } else if (sectorsVisible) {
                    return './maps/garry-invalid.png';
                }

                return './maps/garry-blue-zone.png';
            },
            zoomScaleWhen: function() {
                return controls.checkGarryRadius.is(":checked")
            }
        },
        airhead: {
            wh: 122,
            resolveImg: function (object) {
                const radiusHidden = controls.checkGarryRadius.is(":checked");
                return './maps/airhead-' + (radiusHidden ? 'plain' : 'radius') + '.png'
            },
            zoomScaleWhen: function() {
                return controls.checkGarryRadius.is(":checked")
            }
        },
        halftrack: {
            wh: 122,
            resolveImg: function (object) {
                const radiusHidden = controls.checkGarryRadius.is(":checked");
                return './maps/halftrack-' + (radiusHidden ? 'plain' : 'radius') + '.png'
            },
            controlsVisibility: {mtr: true},
            zoomScaleWhen: function() {
                return controls.checkGarryRadius.is(":checked")
            }
        },
        outpost: {
            wh: 122,
            resolveImg: function (object) {
                const radiusHidden = controls.checkGarryRadius.is(":checked");
                return './maps/outpost-' + object.type.modifier + "-" + (radiusHidden ? 'plain' : 'radius') + '.png'
            },
            zoomScaleWhen: function() {
                return controls.checkGarryRadius.is(":checked")
            }
        },
        tank: {
            wh: 51,
            resolveImg: function (object) {
                if (object.type.modifier) {
                    return './maps/tank-' + object.type.modifier + ".png";
                }

                return './maps/tank-med.png'
            },
            controlsVisibility: {mtr: true},
            zoomScale: true
        },
        truck: {
            wh: 51,
            resolveImg: function (object) {
                if (object.type.modifier) {
                    return './maps/truck-' + object.type.modifier + ".png";
                }

                return './maps/truck-supply.png'
            },
            controlsVisibility: {mtr: true},
            zoomScale: true
        },
        'at-gun': {
            wh: 51,
            resolveImg: function (object) {
                return './maps/at-gun-plain.png'
            },
            controlsVisibility: {mtr: true},
            zoomScale: true
        },
        enemy: {
            wh: 51,
            resolveImg: function (object) {
                return './maps/enemy-' + object.type.modifier + '.png'
            },
            zoomScale: true
        }
    }

    function fixElementSelectBoxes() {
        const sel = new fabric.ActiveSelection(placed, {canvas: controls.fabricCanvas});
        controls.fabricCanvas.setActiveObject(sel).requestRenderAll();
        controls.fabricCanvas.discardActiveObject(sel).requestRenderAll();
    }

    fabric.Canvas.prototype.orderObjects = function (compare) {
        this._objects.sort(compare);
        this.renderAll();
    }
    fabric.Canvas.prototype.orderByZindex = function () {
        this.orderObjects((a, b) => (a.zIndex > b.zIndex) ? 1 : -1);
    }

    const rotateIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' style='stroke:white;stroke-width:1px;' class='bi bi-arrow-clockwise' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z'/%3E%3Cpath d='M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z'/%3E%3C/svg%3E";
    const rotateImg = document.createElement('img');
    rotateImg.src = rotateIcon;

    fabric.Object.prototype.controls.mtr = new fabric.Control({
        x: 0,
        y: -0.5,
        offsetY: -40,
        cursorStyle: 'crosshair',
        actionHandler: fabric.controlsUtils.rotationWithSnapping,
        actionName: 'rotate',
        render: renderRotateIcon,
        cornerSize: 24,
        withConnection: true
    });

    function renderRotateIcon(ctx, left, top, styleOverride, fabricObject) {
        const size = this.cornerSize;
        ctx.save();
        ctx.translate(left, top);
        ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
        ctx.drawImage(rotateImg, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    // const resizeIcon = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' style=\'stroke:white;stroke-width:1px;\' class=\'bi bi-arrow-down-right-square\' viewBox=\'0 0 16 16\'%3E%3Cpath fill-rule=\'evenodd\' d=\'M15 2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2zM0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm5.854 3.146a.5.5 0 1 0-.708.708L9.243 9.95H6.475a.5.5 0 1 0 0 1h3.975a.5.5 0 0 0 .5-.5V6.475a.5.5 0 1 0-1 0v2.768L5.854 5.146z\'/%3E%3C/svg%3E';
    // const resizeImg = document.createElement("img");
    // resizeImg.src = resizeIcon;
    //
    // fabric.Object.prototype.controls.br = new fabric.Control({
    //     x: 0.5,
    //     y: 0.5,
    //     cursorStyle: 'crosshair',
    //     actionHandler: fabric.controlsUtils.scalingEqually,
    //     actionName: 'scaling',
    //     render: renderResizeIcon,
    //     cornerSize: 24,
    //     centeredScaling: true,
    //     withConnection: true
    // });
    //
    // function renderResizeIcon(ctx, left, top, styleOverride, fabricObject) {
    //     const size = this.cornerSize;
    //     ctx.save();
    //     ctx.translate(left, top);
    //     ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
    //     ctx.drawImage(resizeImg, -size / 2, -size / 2, size, size);
    //     ctx.restore();
    // }

    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.cornerColor = 'blue';
    fabric.Object.prototype.cornerStyle = 'circle';

    // Each point supports multiple coordinates to draw to tempCanvas
    // Each map has 25 sectors but 15 points
    // Sectors without point are represented by null
    // Coordinates are dependent on a 1920x1920 map image
    // [x, y, w, h]
    // How-to: Points were extracted using https://www.textcompare.org/image/
    // comparing the map with a grid and points to the map with a grid and no points.
    // Diff Type = 'Diff only'. Then noise/unnecessary bits removed around remaining points to reduce file size.
    const pointCoords = {
        Carentan: [
            [null, null, null, null, null],
            [[[238, 467, 189, 167]], [[498, 561, 235, 168]], [[909, 467, 219, 170]], [[1227, 516, 255, 170]], [[1482, 593, 252, 170]]],
            [[[206, 889, 185, 171]], [[653, 890, 111, 128]], [[862, 837, 220, 170]], [[1296, 784, 188, 172]], [[1581, 901, 221, 171]]],
            [[[213, 1207, 172, 171]], [[449, 1124, 268, 170]], [[878, 1111, 169, 171]], [[1166, 1349, 251, 152]], [[1511, 1214, 263, 172]]],
            [null, null, null, null, null]
        ],
        Foy: [
            [null, [[347, 123, 260, 136]], [[932, 114, 254, 151]], [[1213, 67, 235, 195]], null],
            [null, [[557, 390, 220, 27], [610, 421, 115, 159]], [[742, 508, 252, 152]], [[1271, 449, 265, 160]], null],
            [null, [[313, 696, 264, 192]], [[838, 857, 236, 156]], [[1264, 789, 270, 161]], null],
            [null, [[474, 1127, 213, 192]], [[938, 1219, 235, 161]], [[1280, 1103, 240, 163]], null],
            [null, [[304, 1446, 279, 168]], [[794, 1485, 218, 177]], [[1278, 1472, 255, 179]], null],
        ],
        Hill400: [
            [null, null, null, null, null],
            [[[230, 514, 190, 118]], [[468, 449, 239, 121]], [[889, 545, 150, 121]], [[1091, 468, 260, 123]], [[1458, 549, 257, 117]]],
            [[[220, 895, 242, 136]], [[524, 949, 271, 125]], [[837, 902, 220, 155]], [[1147, 833, 192, 125]], [[1639, 765, 169, 152]]],
            [[[253, 1285, 185, 116]], [[423, 1164, 275, 31], [526, 1195, 65, 97]], [[854, 1113, 222, 121]], [[1146, 1291, 248, 122]], [[1503, 1247, 263, 121]]],
            [null, null, null, null, null],
        ],
        HurtgenV2: [
            [null, null, null, null, null],
            [[[105, 386, 305, 168]], [[458, 497, 256, 176]], [[903, 369, 233, 157]], [[1282, 510, 222, 160]], [[1539, 469, 249, 156]]],
            [[[86, 859, 248, 162]], [[536, 839, 168, 195]], [[806, 885, 169, 130]], [[1214, 926, 203, 153]], [[1491, 903, 207, 154]]],
            [[[131, 1178, 187, 161]], [[448, 1082, 189, 167]], [[822, 1237, 197, 164]], [[1259, 1325, 172, 134]], [[1498, 1325, 152, 162]]],
            [null, null, null, null, null],
        ],
        Kursk: [
            [null, [[469, 173, 308, 190]], [[949, 192, 145, 167]], [[1317, 198, 174, 169]], null],
            [null, [[534, 523, 177, 190]], [[863, 483, 218, 211]], [[1242, 468, 197, 222]], null],
            [null, [[608, 777, 184, 195]], [[980, 851, 139, 215]], [[1236, 906, 203, 177]], null],
            [null, [[639, 1204, 122, 194]], [[854, 1221, 194, 162]], [[1220, 1238, 248, 175]], null],
            [null, [[562, 1483, 189, 169]], [[865, 1461, 145, 182]], [[1189, 1450, 214, 193]], null],
        ],
        Omaha: [
            [null, null, null, null, null],
            [[[160, 485, 305, 183]], [[432, 362, 253, 25], [510, 393, 105, 150]], [[887, 422, 236, 183]], [[1387, 390, 222, 26], [1444, 422, 105, 150]], [[1549, 512, 149, 203]]],
            [[[202, 866, 264, 154]], [[464, 735, 268, 183]], [[807, 799, 247, 181]], [[1445, 780, 107, 157], [1552, 790, 8, 15], [1552, 781, 5, 9]], [[1560, 765, 194, 158], [1556, 765, 4, 25]]],
            [[[215, 1162, 178, 179]], [[408, 1107, 223, 155]], [[850, 1135, 270, 185]], [[1332, 1128, 172, 187]], [[1560, 1121, 198, 188]]],
            [null, null, null, null, null],
        ],
        PHL: [
            [null, [[345, 211, 181, 110]], [[835, 240, 247, 132]], [[1160, 232, 233, 128]], null],
            [null, [[445, 513, 204, 108]], [[836, 619, 197, 133]], [[1147, 522, 260, 129]], null],
            [null, [[482, 809, 205, 144]], [[823, 893, 270, 124]], [[1301, 837, 191, 126]], null],
            [null, [[522, 1159, 220, 134]], [[855, 1259, 249, 113]], [[1361, 1228, 165, 113]], null],
            [null, [[464, 1508, 254, 136]], [[849, 1486, 254, 119]], [[1302, 1571, 189, 103]], null],
        ],
        Remagen: [
            [null, [[449, 183, 252, 156]], [[818, 184, 254, 157]], [[1245, 186, 234, 163]], null],
            [null, [[477, 454, 219, 157]], [[928, 440, 250, 155]], [[1201, 454, 260, 160]], null],
            [null, [[457, 722, 268, 154]], [[884, 801, 203, 237]], [[1200, 990, 268, 164]], null],
            [null, [[510, 1218, 213, 156]], [[842, 1223, 227, 178]], [[1213, 1208, 237, 161]], null],
            [null, [[429, 1603, 270, 158]], [[881, 1527, 213, 158]], [[1192, 1501, 252, 155]], null],
        ],
        SMDMV2: [
            [null, [[433, 80, 307, 192]], [[815, 109, 256, 166]], [[1313, 119, 149, 196]], null],
            [null, [[469, 453, 234, 191]], [[880, 438, 220, 187]], [[1170, 452, 264, 194]], null],
            [null, [[514, 828, 185, 195]], [[888, 850, 174, 205]], [[1215, 851, 206, 179]], null],
            [null, [[504, 1198, 199, 194]], [[863, 1260, 171, 164]], [[1281, 1317, 251, 194]], null],
            [null, [[538, 1501, 190, 182]], [[888, 1580, 145, 173]], [[1229, 1594, 217, 170]], null],
        ],
        SME: [
            [null, null, null, null, null],
            [[[187, 473, 188, 131]], [[450, 502, 238, 130]], [[876, 423, 147, 129]], [[1211, 535, 256, 132]], [[1507, 590, 257, 130]]],
            [[[259, 836, 187, 120]], [[461, 739, 270, 131]], [[907, 795, 222, 139]], [[1143, 933, 188, 124]], [[1571, 891, 175, 123]]],
            [[[226, 1203, 172, 139]], [[489, 1280, 269, 128]], [[882, 1192, 171, 126]], [[1086, 1159, 250, 141]], [[1527, 1242, 262, 136]]],
            [null, null, null, null, null],
        ],
        Stalingrad: [
            [null, null, null, null, null],
            [[[175, 360, 308, 194]], [[517, 317, 251, 168]], [[822, 433, 244, 173]], [[1110, 415, 305, 171]], [[1507, 498, 219, 174]]],
            [[[182, 919, 263, 215]], [[469, 852, 188, 193]], [[908, 816, 221, 213]], [[1349, 830, 187, 164]], [[1547, 831, 179, 158]]],
            [[[227, 1296, 177, 215]], [[432, 1216, 250, 214]], [[847, 1148, 191, 210]], [[1290, 1258, 165, 161]], [[1522, 1253, 219, 176]]],
            [null, null, null, null, null],
        ],
        Utah: [
            [null, null, null, null, null],
            [[[234, 368, 187, 124]], [[547, 399, 234, 124]], [[934, 446, 150, 148]], [[1179, 433, 258, 152]], [[1517, 425, 127, 117]]],
            [[[221, 833, 188, 128]], [[547, 870, 269, 127]], [[957, 794, 219, 119]], [[1211, 851, 189, 122]], [[1499, 903, 176, 119]]],
            [[[186, 1378, 290, 123]], [[487, 1253, 270, 155]], [[877, 1335, 170, 155]], [[1362, 1295, 140, 120]], [[1512, 1300, 189, 124]]],
            [null, null, null, null, null],
        ],
    }
    const pointCutoutData = {}

    const sectorData = [
        {
            a: {top: 383, left: 0, width: 0, height: 0, visible: false},
            b: {top: 383, left: 0, width: 1920, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 386, height: 1151, visible: true},
            b: {top: 383, left: 1920 - 1536, width: 1538, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 769, height: 1151, visible: true},
            b: {top: 383, left: 1920 - 1151, width: 1151, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 769, height: 1151, visible: true},
            b: {top: 383, left: 1920 - 769, width: 769, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 1151, height: 1151, visible: true},
            b: {top: 383, left: 1920 - 769, width: 769, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 1536, height: 1151, visible: true},
            b: {top: 383, left: 1920 - 386, width: 386, height: 1151, visible: true}
        },
        {
            a: {top: 383, left: 0, width: 1920, height: 1151, visible: true},
            b: {top: 383, left: 0, width: 0, height: 0, visible: false}
        }
    ];

    function rectContainsPoint(rect, x, y) {
        const rx = rect.left;
        const ry = rect.top;
        const rx2 = rect.left + rect.width;
        const ry2 = rect.top + rect.height;

        return rx <= x && rx2 >= x && ry <= y && ry2 >= y;
    }

    function addMapElement(e, type, modifier, roomSendUpdate, uuid, otherObject) {
        console.log('addSpawn(' + type + ', ' + modifier + ')')
        console.log(e);

        if (type === "custom-radius") {
            const text = new fabric.Text("", {
                fontFamily: 'Calibri',
                fontSize: 25,
                stroke: "#00ff00",
                textAlign: 'center',
                originX: 'center',
                originY: 'center',
                top: -170
            })
            const circle = new fabric.Circle({
                zIndex: 7,
                fill: "transparent",
                originX: "center",
                originY: "center",
                centeredScaling: true,
                radius: 190,
                stroke: "#00ff00",
                strokeWidth: 2,
                strokeDashArray: [10, 5]
            });
            const vertLine = new fabric.Line([15, 0, -15, 0], {
                originX: "center",
                originY: "center",
                stroke: 'black',
                strokeWidth: 2,
            });
            const horizLine = new fabric.Line([0, 15, 0, -15], {
                originX: "center",
                originY: "center",
                stroke: 'black',
                strokeWidth: 2,
            });
            const group = new fabric.Group([circle, text, vertLine, horizLine],{
                selectable: true,
                evented: true,
                hasBorders: false,
                lockMovementX: true,
                lockMovementY: true,
                originX: "center",
                originY: "center",
                centeredScaling: true,
                width: 380,
                height: 380,
                zIndex: 7,
                left: e.absolutePointer.x,
                top: e.absolutePointer.y,
                scaleX: 3.5036381745797236, // scale to 700m
                scaleY: 3.5036381745797236,
                type: {
                    id: uuid ? uuid : uuidv4(),
                    type: type,
                    modifier: modifier,
                    originalEvent: {absolutePointer: e.absolutePointer},
                    text: text
                }
            });
            group.setControlsVisibility({
                mt: false, mb: false, ml: false, mr: false, bl: false, br: true, tl: false, tr: false, mtr: true
            });

            if (otherObject) {
                text.set({
                    text: otherObject.type.text.text
                })
                group.set({
                    angle: otherObject.angle,
                    scaleX: otherObject.scaleX,
                    scaleY: otherObject.scaleY,
                    top: otherObject.top,
                    left: otherObject.left
                });

                if (roomsMode && roomsRole === 'viewer') {
                    group.set({
                        selectable: false,
                        evented: false
                    })
                }
            }

            placed.push(group);

            addAndOrder(group);
            if (roomSendUpdate) {
                internal.updateStatesAndRender();
            }
            fixElementSelectBoxes();
            updateZoomScale();

            if (roomSendUpdate) {
                roomEditorUpdateElements()
            }
            return;
        }

        fabric.Image.fromURL('', function (img) {
            console.log(img);

            const wh = placedMeta[type].wh;
            img.set({
                selectable: true,
                evented: true,
                hasBorders: false,
                lockMovementX: true,
                lockMovementY: true,
                zIndex: zIndex[type],
                originX: "center",
                originY: "center",
                centeredScaling: true,
                top: e.absolutePointer.y,
                left: e.absolutePointer.x,
                width: wh,
                height: wh,
            });
            // img.filters.push(new fabric.Image.filters.HueRotation({rotation: 2 * Math.random() - 1}))
            img.type = {
                id: uuid ? uuid : uuidv4(),
                type: type,
                modifier: modifier,
                originalEvent: {absolutePointer: e.absolutePointer}
            };
            if (otherObject) {
                img.set({
                    angle: otherObject.angle,
                    top: otherObject.top,
                    left: otherObject.left,
                })
                if (roomsMode && roomsRole === 'viewer') {
                    img.set({
                        selectable: false,
                        evented: false
                    })
                }
            }
            if (placedMeta[type].set) {
                img.setControlsVisibility(placedMeta[type].set);
            }
            // disable rotation and resizing
            img.setControlsVisibility({
                mt: false, mb: false, ml: false, mr: false, bl: false, br: false, tl: false, tr: false, mtr: false
            })
            if (placedMeta[type].controlsVisibility) {
                img.setControlsVisibility(placedMeta[type].controlsVisibility);
            }

            placed.push(img);

            addAndOrder(img);
            if (roomSendUpdate) {
                internal.updateStatesAndRender();
            }
            fixElementSelectBoxes();
            updateZoomScale();

            if (roomSendUpdate) {
                roomEditorUpdateElements()
            }
        });
    }

    function addAndOrder(object) {
        controls.fabricCanvas.add(object);
        controls.fabricCanvas.orderByZindex();
        controls.exportCanvas.add(object);
        controls.exportCanvas.orderByZindex();
    }

    const internal = {
        init: function () {
            controls.comboMapSelect = $("#map-select");
            controls.checkGrid = $("#grid-visible");
            controls.checkArty = $("#arty-visible");
            controls.checkArtyFlip = $("#flip-arty");
            controls.checkStrongpoints = $("#sp-visible");
            controls.checkSpResource = $("#sp-resource-visible");
            elements.strongpointGrid = $("#sp-grid");
            controls.checkDefaultGarries = $("#dg-visible");
            controls.checkPlacedGarries = $("#garry-visible");
            controls.checkGarryRadius = $("#garry-radius-visible");
            controls.btnRemoveAllElements = $("#remove-all-elements");
            controls.btnUndoLastElement = $("#undo-last-element");
            controls.btnEnableAll = $("#enableAll");
            controls.btnDisableAll = $("#disableAll");
            controls.btnSave = $("#save");
            elements.canvas = $("#canvas");
            elements.canvasParent = $("#canvas-container")[0];
            controls.checkSectors = $("#sector-visible");
            controls.checkSectorSwap = $("#swap-sector-color");
            controls.sectorRange = $("#sector-range");
            elements.contextMenu = $("#menu");
            controls.checkZoomScale = $("#zoom-scale");

            elements.viewerPanel = $("#viewer-panel");
            elements.editorPanel = $("#editor-panel");
            elements.joinPanel = $("#join-panel");
            elements.menuPanel = $("#menu-panel");
            elements.canvasPanel = $("#canvas-panel");
            controls.inputRoomId = $("#roomId");
            controls.inputViewerPassword = $("#viewerPassword");
            controls.inputEditorKey = $("#editorKey");
            elements.joinError = $("#joinError");
            controls.btnCreateJoin = $("#submitJoin");

            controls.btnExport = $("#export");
            controls.btnImport = $("#import");
            controls.importFileChooser = $("#importFileChooser");

            new ClipboardJS('.btn');

            if (elements.joinPanel[0]) {
                roomsMode = true;

                console.log("Rooms Mode");
                //socket = io('localhost:3000');
                socket = io('https://maps-let-loose-websocket.herokuapp.com/');
            } else {
                roomsMode = false;
                console.log("Solo Mode");
            }

            controls.checkZoomScale.click(function () {
                updateZoomScale();
            })

            controls.btnCreateJoin.click(function () {
                if (!roomsMode) {
                    return;
                }

                const payload = {
                    roomId: sanitize(controls.inputRoomId.val()),
                    viewerPassword: sanitize(controls.inputViewerPassword.val()),
                    editorKey: sanitize(controls.inputEditorKey.val())
                }

                if (!payload.roomId || !payload.roomId.length) {
                    console.warn('sanitized roomId was blank')
                    return;
                }

                socket.emit('create-or-join', payload);
            });

            if (roomsMode) {
                elements.menuPanel.hide();
                elements.canvasPanel.hide();

                controls.inputRoomId.val("Map-Session-" + Math.trunc(99999 * Math.random()))

                socket.on('room-status', function (message) {
                    console.log(message);

                    $(".connected").text(message.connected)
                    $(".editors").text(message.editors)
                    $(".viewers").text(message.viewers)
                })

                socket.on('join-error', function (message) {
                    console.warn('Join error')

                    elements.joinError.text(JSON.stringify(message));
                });

                socket.on('connect_error', function (error) {
                    console.warn('connect error')

                    elements.joinError.text(JSON.stringify(error));
                    controls.btnCreateJoin.prop('disabled', true);
                });

                async function checkRestart() {
                    if ($("#viewer-panel").is(":visible") || $("#editor-panel").is(":visible")) {
                        console.warn('server restart, room no longer exists')

                        $("#viewer-panel").hide();
                        $("#editor-panel").hide();
                        $("#menu-panel").hide();
                        $("#canvas-panel").hide();
                        $("#join-panel").show();

                        $("#warning-panel").show();
                        $("#warn-reason").text("Either you lost connection or the rooms server restarted and the room no longer exists. Try joining again or create a new one.");
                    }
                }

                socket.on('connect', function (error) {
                    console.info('connected')

                    elements.joinError.text("");
                    controls.btnCreateJoin.prop('disabled', false);

                    checkRestart();
                });

                socket.on('join-success', function (message) {
                    console.log('join-success')
                    console.log(message)

                    $(".room-id").val(message.roomId);
                    $(".editor-key").val(message.editorKey);
                    $(".viewer-password").val(message.viewerPassword);

                    $("#warning-panel").hide();
                    elements.joinPanel.hide();
                    elements.menuPanel.show();
                    if (message.role === 'editor') {
                        roomsRole = "editor";
                        $(".editor-div").show();
                        elements.editorPanel.show();
                        elements.viewerPanel.hide();

                        $("#shareLinkDisplay").val(
                            window.location.origin + window.location.pathname +
                            "?roomId=" + encodeURI(message.roomId || "") +
                            "&viewerPassword=" + encodeURI(message.viewerPassword || "") +
                            "&join=true");

                        const map = idx(["state", "controls", "map"], message) || "Carentan";
                        controls.comboMapSelect.val(map)
                        const filePrefix = controls.comboMapSelect.val();
                        internal.loadMap(filePrefix);
                    } else {
                        roomsRole = 'viewer'
                        $(".editor-div").hide();
                        elements.editorPanel.hide();
                        elements.viewerPanel.show();
                    }
                    elements.canvasPanel.show();

                    loadFromRoomState(message);
                });

                socket.on('update-controls', function (message) {
                    console.log('update-controls')
                    console.log(message);

                    loadFromRoomState(message);
                });
                socket.on('update-elements', function (message) {
                    console.log('update-elements')
                    console.log(message);

                    loadFromRoomState(message);
                });
                socket.on('update-drawings', function (message) {
                    console.log('update-drawings')
                    console.log(message);

                    loadFromRoomState(message);
                });

                $(document).on('click', '.leave-room', function () {
                    console.log('leave room')

                    socket.emit('leave-room');

                    $("#viewer-panel").hide();
                    $("#editor-panel").hide();
                    $("#menu-panel").hide();
                    $("#canvas-panel").hide();
                    $("#join-panel").show();
                });

                socket.on('room-expired', function () {
                    console.log('current room expired, leaving')

                    $(".leave-room").click();

                    $("#warning-panel").show();
                    $("#warn-reason").text("The room you were in has expired. Create a new room or join another.");
                })

                socket.on('room-pw-change', function (message) {
                    console.log('room password changed');

                    if (roomsRole === 'viewer' && message && !message.blankPw) {
                        $(".leave-room").click();

                        $("#warning-panel").show();
                        $("#warn-reason").text("The password for the room was changed and is not blank. Ask an editor for the new password.");
                    }
                    if (roomsRole === 'editor') {
                        socket.emit('editor-get-pw', {
                            roomId: controls.inputRoomId.val(),
                            editorKey: $("#editorKeyDisplay").val()
                        });
                    }
                });

                socket.on('editor-get-pw', function (message) {
                    console.log('editor retrieve new pw');

                    $("#editor-update-pw").prop('disabled', true);
                    $("#editor-viewer-pw").val(message.viewerPassword);
                    $("#shareLinkDisplay").val(
                        window.location.origin + window.location.pathname +
                        "?roomId=" + encodeURI(message.roomId || "") +
                        "&viewerPassword=" + encodeURI(message.viewerPassword || "") +
                        "&join=true");
                });

                $("#editor-viewer-pw").on('keyup', function () {
                    $("#editor-update-pw").prop('disabled', false);

                    $("#editor-viewer-pw").val(sanitize($("#editor-viewer-pw").val()));
                })

                $("#editor-update-pw").click(function () {
                    if (roomsRole === 'viewer') {
                        return;
                    }
                    socket.emit('update-room-pw', {
                        roomId: sanitize(controls.inputRoomId.val()),
                        editorKey: sanitize($("#editorKeyDisplay").val()),
                        viewerPassword: sanitize($("#editor-viewer-pw").val())
                    });
                });
                $("#editor-update-pw").prop('disabled', true);
            }

            controls.fabricCanvas = new fabric.Canvas(elements.canvas.get(0), {
                selection: false,
                fireRightClick: true,
                stopContextMenu: true,
                preserveObjectStacking: true,
                scale: 1,
                moveCursor: 'default',
                hoverCursor: 'default',
                viewportTransform: [0.40, 0, 0, 0.40, 0, 0]
            });
            controls.fabricCanvas.setHeight(800);
            controls.fabricCanvas.setBackgroundColor({
                source: '',
                repeat: 'repeat'
            }, controls.fabricCanvas.renderAll.bind(controls.fabricCanvas))

            const eCanvas = document.createElement("canvas");
            controls.exportCanvas = new fabric.Canvas(eCanvas, {
                scale: 1,
                width: 1920,
                height: 1920
            });

            elements.sectorA = new fabric.Rect({
                zIndex: zIndex.sectors,
                selectable: false,
                evented: false,
                opacity: 0.20,
                hasBorders: false,
                hasControls: false,
                hasRotatingPoint: false,
                visible: false
            });
            controls.fabricCanvas.add(elements.sectorA);
            controls.exportCanvas.add(elements.sectorA);
            elements.sectorB = new fabric.Rect({
                zIndex: zIndex.sectors,
                selectable: false,
                evented: false,
                opacity: 0.20,
                hasBorders: false,
                hasControls: false,
                hasRotatingPoint: false,
                visible: false
            });
            controls.fabricCanvas.add(elements.sectorB);
            controls.exportCanvas.add(elements.sectorB);

            fabric.Image.fromURL('', function (img) {
                elements.map = img;

                img.set({
                    selectable: false,
                    evented: false,
                    zIndex: zIndex.map
                });

                addAndOrder(img);
            });
            fabric.Image.fromURL('./maps/plain-grid.png', function (img) {
                elements.grid = img;
                img.set({
                    selectable: false,
                    evented: false,
                    visible: false,
                    zIndex: zIndex.grid
                });
                addAndOrder(img);
            });
            fabric.Image.fromURL('', function (img) {
                elements.arty = img;

                img.set({
                    selectable: false,
                    evented: false,
                    visible: false,
                    zIndex: zIndex.arty_range
                });

                addAndOrder(img);
            });
            elements.strongpoints = [[], [], [], [], []]
            for (let x = 0; x < 5; x++) {
                for (let y = 0; y < 5; y++) {
                    fabric.Image.fromURL('', function (img) {
                        img.set({
                            selectable: false,
                            evented: false,
                            zIndex: zIndex.points
                        });

                        addAndOrder(img);

                        elements.strongpoints[x].push(img);
                    });
                }
            }
            fabric.Image.fromURL('', function (img) {
                elements.defaultgarries = img;

                img.set({
                    selectable: false,
                    evented: false,
                    visible: $("#dg-visible").is("checked"),
                    zIndex: zIndex.default_garrisons
                });

                addAndOrder(img);
            });

            const deleteIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='red' class='bi bi-trash3' viewBox='0 0 16 16'%3E%3Cpath d='M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916Zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5Z'/%3E%3C/svg%3E";
            const deleteImg = document.createElement('img');
            deleteImg.src = deleteIcon;
            fabric.Object.prototype.controls.deleteControl = new fabric.Control({
                x: 0.5,
                y: -0.5,
                cursorStyle: 'pointer',
                mouseUpHandler: deleteObject,
                render: renderIcon,
                cornerSize: 24
            });

            const dragSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' style='stroke:white;stroke-width:1px;' class='bi bi-arrows-move' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708l2-2zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10zM.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708l-2-2zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8z'/%3E%3C/svg%3E"
            const dragImg = document.createElement("img");
            dragImg.src = dragSvg;
            fabric.Object.prototype.controls.moveObject = new fabric.Control({
                x: -0.5,
                y: -0.5,
                actionHandler: fabric.controlsUtils.dragHandler, // change to this
                mouseUpHandler: function (e, t, x, y) {
                    t.target.set({
                        lockMovementX: true,
                        lockMovementY: true
                    })
                },
                mouseDownHandler: function (e, t, x, y) {
                    t.target.set({
                        lockMovementX: false,
                        lockMovementY: false
                    })
                },
                actionName: 'drag',
                cursorStyle: 'pointer',
                render: renderIconDrag,
                cornerSize: 24
            });

            function deleteObject(eventData, transform) {
                const target = transform.target;

                for (let i = 0; i < placed.length; i++) {
                    if (placed[i].type.id === target.type.id) {
                        placed.splice(i, 1);
                        break;
                    }
                }

                controls.fabricCanvas.remove(target);
                controls.exportCanvas.remove(target);
                controls.fabricCanvas.requestRenderAll();
                controls.exportCanvas.requestRenderAll();

                roomEditorUpdateElements();
            }

            function renderIcon(ctx, left, top, styleOverride, fabricObject) {
                var size = this.cornerSize;
                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
                ctx.drawImage(deleteImg, -size / 2, -size / 2, size, size);
                ctx.restore();
            }

            function renderIconDrag(ctx, left, top, styleOverride, fabricObject) {
                var size = this.cornerSize;
                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
                ctx.drawImage(dragImg, -size / 2, -size / 2, size, size);
                ctx.restore();
            }

            controls.fabricCanvas.on('object:modified', function (e) {
                console.log(e.target);
                internal.updateStatesAndRender();
                roomEditorUpdateElements();
            });

            controls.fabricCanvas.on('object:scaling', function(e){
                const object = e.target;
                const meta = object.type;
                if (meta.type === "custom-radius") {
                    const textEl = idx(["type", "text"], object);
                    if (!textEl) {
                        console.log("no text");
                    } else {
                        // console.log(object);
                        const meters = Math.trunc((10 * object.getScaledWidth()) / 19);
                        textEl.set({
                            text: meters + "m"
                        })
                    }
                }
            });


            controls.fabricCanvas.on('mouse:dblclick', function (e) {
                if (roomsMode && roomsRole === 'viewer') {
                    return;
                }

                addMapElement(e, 'garry', null, true);
            });

            controls.btnRemoveAllElements.on('click', function () {
                console.log('Remove all element')

                while (placed.length > 0) {
                    const element = placed.pop();

                    controls.fabricCanvas.remove(element);
                    controls.exportCanvas.remove(element);
                }

                roomEditorUpdateElements()
            })

            controls.btnUndoLastElement.on('click', function () {
                console.log('Undo last element')

                const element = placed.pop();
                if (element) {
                    controls.fabricCanvas.remove(element);
                    controls.exportCanvas.remove(element);
                }

                roomEditorUpdateElements()
            });

            const drawingModeEl = $('#drawing-mode'),
                drawingColorEl = $('#drawing-color'),
                drawingLineWidthEl = $('#drawing-line-width'),
                clearEl = $('#clear-paths'),
                undoEl = $("#undo-path");

            controls.checkDrawingsVisible = $("#drawing-visible");

            drawingModeEl.on('click', function () {
                controls.fabricCanvas.isDrawingMode = !controls.fabricCanvas.isDrawingMode;
                if (controls.fabricCanvas.isDrawingMode) {
                    drawingModeEl.text('Stop drawing mode');
                    $("canvas").addClass("draw-mode").removeClass('drag-mode');
                } else {
                    drawingModeEl.text('Start drawing mode');
                    $("canvas").removeClass("draw-mode").addClass('drag-mode');
                }
            });

            controls.fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(controls.fabricCanvas);

            drawingColorEl.on('change', function () {
                const value = drawingColorEl.val();
                const brush = controls.fabricCanvas.freeDrawingBrush;
                brush.color = value;
                if (brush.getPatternSrc) {
                    brush.source = brush.getPatternSrc.call(brush);
                }
            });
            drawingColorEl.trigger('change');
            drawingLineWidthEl.on('input', function () {
                const value = drawingLineWidthEl.val();
                controls.fabricCanvas.freeDrawingBrush.width = parseInt(value, 10) || 1;
                $("#line-width-value").text(value);
            });
            drawingLineWidthEl.trigger('input');

            controls.fabricCanvas.freeDrawingBrush.color = drawingColorEl.val();
            controls.fabricCanvas.freeDrawingBrush.width = parseInt(drawingLineWidthEl.val(), 10) || 1;

            controls.fabricCanvas.on('path:created', function (e) {
                console.log(e);

                e.path.set({
                    zIndex: zIndex.drawings,
                    evented: false,
                    selectable: false
                });

                drawings.push(e.path);

                controls.fabricCanvas.orderByZindex();
                controls.exportCanvas.add(e.path);
                controls.exportCanvas.orderByZindex();

                roomEditorUpdateDrawings();
            });

            undoEl.click(function () {
                console.log("Undo last drawing");

                const path = drawings.pop();
                controls.fabricCanvas.remove(path);
                controls.exportCanvas.remove(path);

                roomEditorUpdateDrawings();
            })

            clearEl.click(function () {
                console.log("Clear all drawings");

                while (drawings.length) {
                    const path = drawings.pop();
                    controls.fabricCanvas.remove(path);
                    controls.exportCanvas.remove(path);
                }

                roomEditorUpdateDrawings();
            });

            $(document).on('keypress', function (e) {
                if (e.shiftKey && String.fromCharCode(e.which).toLowerCase() === 'd') {
                    if (roomsMode && roomsRole === 'viewer') {
                        return;
                    }

                    console.log("Shift+D")
                    drawingModeEl.click();
                }
            })
            $(document).on('keyup', function (e) {
                if ((e.ctrlKey || e.shiftKey) && e.keyCode === 37) {
                    console.log("Ctrl+" + e.keyCode)
                    controls.sectorRange.val(Number(controls.sectorRange.val()) - 1);
                    controls.sectorRange.trigger('input');
                }
                if ((e.ctrlKey || e.shiftKey) && e.keyCode === 39) {
                    console.log("Ctrl+" + e.keyCode)
                    controls.sectorRange.val(Number(controls.sectorRange.val()) + 1);
                    controls.sectorRange.trigger('input');
                }
            })

            internal.setupPage();
        },

        setupPage: function () {
            for (let x = 0; x < 5; x++) {
                for (let y = 0; y < 5; y++) {
                    elements.strongpointGrid.append(`<div class='sp-toggle sp-toggle-${x}${y} unavailable' data-x='${x}' data-y='${y}'></div>`)
                }
            }

            $(document).on('click', '.sp-toggle', function (e) {
                const toggle = $(e.target);
                if (toggle.hasClass("unavailable")) {
                    return;
                }

                if (toggle.hasClass("selected")) {
                    toggle.removeClass("selected");
                } else {
                    toggle.addClass("selected");
                }

                internal.updateStatesAndRender();
                roomEditorUpdateControls("selectedSp=" + getSelectedSp());
            });

            controls.btnEnableAll.click(function () {
                $(".sp-toggle.available").addClass("selected");

                internal.updateStatesAndRender();
                roomEditorUpdateControls("btnEnableAll");
            });

            controls.btnDisableAll.click(function () {
                $(".sp-toggle.available").removeClass("selected");

                internal.updateStatesAndRender();
                roomEditorUpdateControls("btnDisableAll");
            });

            let panning = false;
            controls.fabricCanvas.on('mouse:up', function (e) {
                panning = false;
            });
            controls.fabricCanvas.on('mouse:down', function (e) {
                console.log(e);
                elements.contextMenu.css("visibility", "hidden");
                if (e.button === 3) {
                    if (roomsMode && roomsRole === 'viewer') {
                        return;
                    }

                    const offset = controls.fabricCanvas._offset;
                    // Right click context menu
                    elements.contextMenu.css("visibility", "visible")
                        .css("left", offset.left + e.pointer.x + 'px')
                        .css("top", offset.top + e.pointer.y + "px")
                        .css("z-index", 100);
                    contextMenuEvent = e;
                } else if (e.target && e.target.selectable === true && e.target.lockMovementX === false ||
                    e.transform && (e.transform.action === 'rotate' || e.transform.action === 'scale') ||
                    controls.fabricCanvas.isDrawingMode === true) {
                    // Dragging element
                    panning = false;
                } else {
                    panning = true;
                }
            });
            controls.fabricCanvas.on('mouse:move', function (e) {
                if (panning && e && e.e) {
                    console.log(panning);
                    var delta = new fabric.Point(e.e.movementX, e.e.movementY);
                    controls.fabricCanvas.relativePan(delta);
                }
            });
            // Look into https://stackoverflow.com/a/45131912/2650847

            controls.fabricCanvas.on('mouse:wheel', function (opt) {
                elements.contextMenu.css("visibility", "hidden")

                var delta = opt.e.deltaY;
                var zoom = controls.fabricCanvas.getZoom();
                zoom *= 0.999 ** delta;
                if (zoom > 10) zoom = 10;
                if (zoom < 0.01) zoom = 0.01;
                controls.fabricCanvas.zoomToPoint({x: opt.e.offsetX, y: opt.e.offsetY}, zoom);
                opt.e.preventDefault();
                opt.e.stopPropagation();

                fixElementSelectBoxes();
                updateZoomScale();
            });

            elements.spImage = new Image();
            elements.spImage.onload = loadStrongpoints;
            elements.spImage.onerror = function () {
                for (let i = 0; i < elements.strongpoints.length; i++) {
                    for (let j = 0; j < elements.strongpoints[i].length; j++) {
                        elements.strongpoints[i][j].setSrc('')
                    }
                }
            }

            function loadStrongpoints() {
                console.log("loadStrongpoints(" + elements.spImage.src + ")")
                const filePrefix = controls.comboMapSelect.val();

                initStrongpointData(filePrefix);

                for (let x = 0; x < 5; x++) {
                    for (let y = 0; y < 5; y++) {
                        const toggle = $(".sp-toggle-" + x + y);
                        if (pointCoords[filePrefix][x][y] == null) {
                            toggle.removeClass("selected").removeClass('available').addClass('unavailable');
                            continue;
                        }

                        toggle.addClass('available').removeClass('unavailable')

                        if (resetSelectedPoints) {
                            toggle.addClass('selected');
                        }
                    }
                }

                let wasRoomEvent = false;
                if (elements.spImage.roomsSelectedSp) {
                    $(".sp-toggle.available").removeClass('selected');
                    for (let i = 0; i < elements.spImage.roomsSelectedSp.length; i++) {
                        $(".sp-toggle-" + elements.spImage.roomsSelectedSp[i]).addClass('selected');
                    }
                    delete elements.spImage.roomsSelectedSp;
                    wasRoomEvent = true;
                }

                if (!wasRoomEvent && roomsMode && roomsRole === "editor") {
                    roomEditorUpdateControls("loadStrongpoints editor");
                }

                resetSelectedPoints = false;

                internal.updateStatesAndRender();
            }

            function initStrongpointData(filePrefix) {
                const resourceChecked = controls.checkSpResource.is(":checked");
                const strongpointKey = filePrefix + resourceChecked;
                if (pointCutoutData.hasOwnProperty(strongpointKey)) {
                    return;
                }

                console.log("initStrongpoints('" + strongpointKey + "')")

                const data = {}
                for (let x = 0; x < 5; x++) {
                    for (let y = 0; y < 5; y++) {
                        const pointData = {};

                        const tempCanvas = document.createElement('canvas');
                        const context = tempCanvas.getContext('2d');
                        const point = pointCoords[filePrefix][x][y];
                        if (point == null) {
                            pointData["dataUrl"] = "";
                            pointData["position"] = {top: 0, left: 0, width: 0, height: 0}
                            pointData["visible"] = false;
                        } else {
                            let top = 1920;
                            let left = 1920;
                            let width = 0;
                            let height = 0;
                            for (let i = 0; i < point.length; i++) {
                                const rect = point[i];
                                if (top > rect[1]) {
                                    top = rect[1];
                                }
                                if (left > rect[0]) {
                                    left = rect[0];
                                }
                                if (width < (rect[0] + rect[2])) {
                                    width = (rect[0] + rect[2]);
                                }
                                if (height < (rect[1] + rect[3])) {
                                    height = (rect[1] + rect[3]);
                                }
                            }
                            tempCanvas.width = width;
                            tempCanvas.height = height;

                            for (let i = 0; i < point.length; i++) {
                                const rect = point[i];

                                const dx = rect[0] - left;
                                const dy = rect[1] - top;
                                const dw = rect[2];
                                const dh = rect[3];

                                context.drawImage(elements.spImage, rect[0], rect[1], rect[2], rect[3], dx, dy, dw, dh);
                            }

                            pointData["dataUrl"] = tempCanvas.toDataURL();
                            pointData["position"] = {top: top, left: left, width: width, height: height}
                            pointData["visible"] = true;
                        }

                        data['' + x + y] = pointData;
                    }
                }

                console.log(data);

                pointCutoutData[strongpointKey] = data;
            }

            internal.loadMap = function (filePrefix) {
                if (lastLoadedMap === filePrefix) {
                    return;
                }
                lastLoadedMap = filePrefix;
                resetSelectedPoints = true;

                console.log("Loading " + filePrefix)

                elements.map.setSrc('./maps/no-grid/' + filePrefix + '_NoGrid.png', internal.render);
                elements.defaultgarries.setSrc('./maps/defaultgarries/' + filePrefix + '_defaultgarries.png', internal.render)
                let artySuffix = controls.checkArtyFlip.is(":checked") ? 2 : 1;
                elements.arty.setSrc('./maps/arty/' + filePrefix + '_Arty' + artySuffix + '.png', internal.render)
                elements.spImage.src = './maps/points/' + filePrefix + '_SP_NoMap' + (controls.checkSpResource.is(":checked") ? 3 : 2) + '.png';
            }

            internal.roomsLoadMapAndSP = function (filePrefix, selectedSp) {
                resetSelectedPoints = true;

                console.log("Rooms loading " + filePrefix);

                const promises = [
                    new Promise(function (resolve) {
                        const imgSrc = './maps/no-grid/' + filePrefix + '_NoGrid.png';
                        if (elements.map.src !== imgSrc) {
                            elements.map.setSrc(imgSrc, resolve);
                        } else {
                            resolve();
                        }
                    }),
                    new Promise(function (resolve) {
                        const imgSrc = './maps/defaultgarries/' + filePrefix + '_defaultgarries.png';
                        if (elements.defaultgarries.src !== imgSrc) {
                            elements.defaultgarries.setSrc(imgSrc, resolve);
                        } else {
                            resolve();
                        }
                    }),
                    new Promise(function (resolve) {
                        const artySuffix = controls.checkArtyFlip.is(":checked") ? 2 : 1;
                        const imgSrc = './maps/arty/' + filePrefix + '_Arty' + artySuffix + '.png';
                        if (elements.arty.src !== imgSrc) {
                            elements.arty.setSrc(imgSrc, resolve);
                        } else {
                            resolve();
                        }
                    })
                ];
                Promise.all(promises).then(internal.render);

                elements.spImage.roomsSelectedSp = selectedSp;
                elements.spImage.src = './maps/points/' + filePrefix + '_SP_NoMap' + (controls.checkSpResource.is(":checked") ? 3 : 2) + '.png';
            }

            controls.comboMapSelect.change(function () {
                if (roomsMode && roomsMode === "viewer") {
                    return;
                }

                const filePrefix = controls.comboMapSelect.val();
                internal.loadMap(filePrefix);

                roomEditorUpdateControls(controls.comboMapSelect);
            });
            controls.checkSpResource.change(function () {
                if (roomsMode && roomsMode === "viewer") {
                    return;
                }
                const filePrefix = controls.comboMapSelect.val();
                elements.spImage.src = './maps/points/' + filePrefix + '_SP_NoMap' + (controls.checkSpResource.is(":checked") ? 3 : 2) + '.png';
            })
            if (!roomsMode) {
                controls.comboMapSelect.trigger('change');
            }

            [controls.checkGrid, controls.checkArty, controls.checkStrongpoints, controls.checkDefaultGarries,
                controls.checkSectors, controls.checkSectorSwap, controls.checkPlacedGarries, controls.checkGarryRadius,
                controls.checkArtyFlip, controls.checkSpResource, controls.checkDrawingsVisible
            ].forEach(function (control) {
                control.change(function () {
                    internal.updateStatesAndRender();

                    roomEditorUpdateControls(control);
                });
            });

            controls.btnSave.click(function () {
                for (let i = 0; i < placed.length; i++) {
                    if (placed[i].type.type === "custom-radius") {
                        continue;
                    }
                    placed[i].set({scaleX: 1, scaleY: 1});
                }

                controls.exportCanvas.renderAll();

                $('<a>').attr({
                    href: controls.exportCanvas.toDataURL(),
                    download: controls.comboMapSelect.val() + "_Custom_MLL.png"
                })[0].click();

                updateZoomScale();
            });

            let lastRangeVal = controls.sectorRange.val();
            controls.sectorRange.on('input', function () {
                if (controls.sectorRange.val() !== lastRangeVal) {
                    lastRangeVal = controls.sectorRange.val();

                    roomEditorUpdateControls(controls.sectorRange);
                    internal.updateStatesAndRender();
                }
            })

            new ResizeObserver(() => {
                controls.fabricCanvas.setWidth(elements.canvasParent.clientWidth)
                controls.fabricCanvas.setHeight(elements.canvasParent.clientHeight)
            }).observe(document.getElementById("canvas-container"));

            controls.btnExport.on('click', async function () {
                controls.btnExport.addClass("loading").addClass("disabled");

                const zip = new JSZip();
                console.log("Creating about.txt...")
                zip.file("about.txt",
                    "Downloaded by Maps Let Loose " + new Date().toLocaleString() + "\n\n" +
                    "URL: " + window.location
                );

                console.log("Creating mll_config.json...");
                zip.file("mll_config.json", JSON.stringify(getFullState(), null, 4));

                const fileName = "mll_" + controls.comboMapSelect.val().toLowerCase() + "_" + moment().format("YYYYMMDD-HHmmss");
                console.log("Saving as " + fileName);
                zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: {
                        level: 9
                    }
                }).then(function (content) {
                    saveAs(content, fileName);

                    controls.btnExport.removeClass("loading").removeClass("disabled");
                });
            });

            // Drag & Drop listener
            document.addEventListener("dragover", function (event) {
                event.preventDefault();
            });
            document.documentElement.addEventListener('drop', async function (e) {
                e.stopPropagation();
                e.preventDefault();

                let file = e.dataTransfer.files[0];
                console.log("Loading file");
                console.log(file);

                importFile(file);
            });

            controls.importFileChooser.on('change', function (event) {
                console.log(event);

                let file = event.target.files[0];

                if (file) {
                    controls.inputValue.val(file.name);
                } else {
                    return;
                }

                importFile(file);
            });

            function importFile(file) {
                console.log("Importing from file " + file.name);

                if (roomsMode && roomsRole === "viewer") {
                    console.log("Viewer cannot import, ignoring")
                    return;
                }

                controls.btnImport.addClass("loading").addClass("disabled");

                JSZip.loadAsync(file).then(function (content) {
                    const file = content.file("mll_config.json");
                    return file ? file.async("string") : null;
                }).then(function (text) {
                    if (!text) {
                        console.log("file was empty?")
                        return;
                    }
                    const content = JSON.parse(text);
                    loadFromRoomState(content);

                    roomEditorUpdateControls("importFile")
                    roomEditorUpdateElements();
                    roomEditorUpdateDrawings();

                    controls.btnImport.removeClass("loading").removeClass("disabled");
                });
            }

            internal.pageReady();
        },

        pageReady: function () {
            const query = parseQuery(window.location.search);
            console.log(query);

            if (query.roomId) {
                controls.inputRoomId.val(sanitize(query.roomId));
            }
            if (query.viewerPassword) {
                controls.inputViewerPassword.val(sanitize(query.viewerPassword))
            }
            if (query.editorKey) {
                controls.inputEditorKey.val(sanitize(query.editorKey))
            }
            if (query["join"] && query["join"] === "true") {
                controls.btnCreateJoin.click();
            }
        },

        // Update fabricjs element states and re-render
        updateStatesAndRender: function () {
            console.log("updateStatesAndRender()");
            const filePrefix = controls.comboMapSelect.val();
            const strongpointKey = filePrefix + controls.checkSpResource.is(":checked");
            const promises = [];

            if (elements.grid) {
                elements.grid.visible = controls.checkGrid.is(":checked");
            }
            if (elements.defaultgarries) {
                elements.defaultgarries.visible = controls.checkDefaultGarries.is(":checked");
            }
            if (elements.arty) {
                elements.arty.visible = controls.checkArty.is(":checked");
            }
            for (let i = 0; i < placed.length; i++) {
                placed[i].visible = controls.checkPlacedGarries.is(":checked");
            }

            let artySuffix = controls.checkArtyFlip.is(":checked") ? 2 : 1;
            elements.arty.setSrc('./maps/arty/' + filePrefix + '_Arty' + artySuffix + '.png', internal.render);

            for (let i = 0; i < drawings.length; i++) {
                const path = drawings[i];
                path.visible = controls.checkDrawingsVisible.is(":checked");
            }

            const mapVertical = pointCoords[filePrefix][0][1] != null;
            const range = sectorData[controls.sectorRange.val()];
            elements.sectorA.set(mapVertical ?
                {
                    top: range.a.left,
                    left: range.a.top,
                    width: range.a.height,
                    height: range.a.width,
                    visible: range.a.visible
                } : range.a);
            elements.sectorB.set(mapVertical ?
                {
                    top: range.b.left,
                    left: range.b.top,
                    width: range.b.height,
                    height: range.b.width,
                    visible: range.b.visible
                } : range.b);

            if (!controls.checkSectors.is(":checked")) {
                elements.sectorA.visible = false;
                elements.sectorB.visible = false;
            }

            const sectorRed = '#FF6B43';
            const sectorBlue = '#08FFFF';

            const sectorBred = controls.checkSectorSwap.is(":checked");
            if (sectorBred) {
                elements.sectorA.set({fill: sectorBlue});
                elements.sectorB.set({fill: sectorRed});
            } else {
                elements.sectorA.set({fill: sectorRed});
                elements.sectorB.set({fill: sectorBlue});
            }

            // Update placed element images
            for (let i = 0; i < placed.length; i++) {
                const object = placed[i];
                promises.push(new Promise(function (resolve) {
                    const meta = placedMeta[object.type.type];
                    if (!meta) {
                        resolve();
                    }
                    object.setSrc(meta.resolveImg(object), resolve);
                }));
            }

            let wasLoaded = false;
            for (let x = 0; x < 5; x++) {
                for (let y = 0; y < 5; y++) {
                    const spObject = elements.strongpoints[x][y];

                    spObject.visible = controls.checkStrongpoints.is(":checked") && $(".sp-toggle-" + x + y).hasClass("selected");

                    if (!pointCutoutData.hasOwnProperty(strongpointKey)) {
                        continue;
                    }

                    wasLoaded = true;

                    if (currentLoadedPoints !== strongpointKey) {
                        const pointData = pointCutoutData[strongpointKey]['' + x + y];
                        if (pointData.visible) {
                            promises.push(new Promise(function (resolve) {
                                spObject.setSrc(pointData.dataUrl, resolve);
                            }))
                            spObject.set(pointData.position);
                        } else {
                            elements.strongpoints[x][y].visible = false;
                        }
                    }
                }
            }

            if (wasLoaded && currentLoadedPoints !== strongpointKey) {
                currentLoadedPoints = strongpointKey;
            }

            if (promises.length) {
                Promise.all(promises).then(internal.render);
            } else {
                updateZoomScale()
                controls.fabricCanvas.renderAll();
                controls.exportCanvas.renderAll();
            }
        },

        render: function () {
            console.log("render()");

            updateZoomScale();
            controls.fabricCanvas.renderAll();
            controls.exportCanvas.renderAll();
        }
    }

    $(document).ready(internal.init);

    return {
        menuAdd: function (type, modifier) {
            elements.contextMenu.css("visibility", "hidden");
            console.log('menuAdd(' + type + ')')

            if (!type) {
                return;
            }

            addMapElement(contextMenuEvent, type, modifier, true);
        }
    }
}());


