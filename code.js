figma.showUI(__html__, { height: 112 });
// Global state variables
let tempo = 512;
let playingFrame = null;
let isPaused = false;
let generation = 0;
let oldTimeOrigin = null;
let timeOrigin = Date.now();
// Global state used to stop playback
let fillMap = {};
let pendingTimers = [];
// Constants
const gridSize = 16;
const layoutGridColor = { r: 0.09375, g: 0.625, b: 0.98046875, a: 0.1 };
const layoutColumnColor = { r: 0.09375, g: 0.625, b: 0.98046875, a: 0.05 };
const selectedFills = [{
        type: 'SOLID',
        color: { r: 0.09375, g: 0.625, b: 0.98046875 },
        opacity: 1,
    }];
const timeBarFills = [{
        type: 'SOLID',
        color: { r: 0.918, g: 0.886, b: 0.137 },
        opacity: 0.3,
    }];
const pianoKeyFills = [{
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
    }];
const middleCFills = [{
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
    }];
const layoutGrids = [{
        color: layoutGridColor,
        pattern: "GRID",
        sectionSize: gridSize,
    }, {
        color: layoutColumnColor,
        pattern: "COLUMNS",
        alignment: "MIN",
        gutterSize: gridSize,
        count: Infinity,
        sectionSize: gridSize * 7,
        offset: 0,
    }];
// Functions
function stopPlayback(pause) {
    if (!pause) {
        generation += 1;
        playingFrame = null;
    }
    isPaused = pause;
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    for (const id in fillMap) {
        const node = figma.getNodeById(id);
        if (node && !node.removed)
            node.fills = fillMap[id];
    }
    pendingTimers = [];
    fillMap = {};
}
function createSheet() {
    const frame = figma.createFrame();
    const width = 128 * gridSize;
    frame.resize(width, 49 * gridSize);
    frame.layoutGrids = layoutGrids;
    const nodes = [];
    for (let i = 0; i < 100; i++) {
        const stripe = i % 12;
        if (stripe === 1 || stripe === 4 || stripe === 6 || stripe === 9 || stripe === 11 || i === 31) {
            const rect = figma.createRectangle();
            frame.appendChild(rect);
            rect.x = 0;
            rect.y = i * gridSize;
            rect.name = 'Guide Key';
            rect.resize(width, gridSize);
            rect.fills = i === 31 ? middleCFills : pianoKeyFills;
            rect.constraints = { horizontal: "STRETCH", vertical: "MIN" };
            nodes.push(rect);
        }
    }
    const group = figma.group(nodes, frame);
    group.locked = true;
    group.name = 'Guide';
    group.opacity = 0.05;
}
function renderBar(frame) {
    let timeBar = null;
    const frameTempo = tempo;
    const myTimeOrigin = oldTimeOrigin;
    const myGeneration = generation;
    let xOffset = Math.floor(frameTempo * (Date.now() - myTimeOrigin) / (1000 * 16)) * 16;
    function renderBarInner() {
        if (timeBar === null || timeBar.removed) {
            const rect = figma.createRectangle();
            rect.resize(gridSize, frame.height);
            rect.x = 0;
            rect.y = 0;
            rect.name = 'Time Bar';
            rect.fills = timeBarFills;
            frame.appendChild(rect);
            timeBar = rect;
        }
        else {
            timeBar.x = (xOffset += gridSize);
        }
        if (timeBar.x < frame.width && generation === myGeneration && !isPaused) {
            setTimeout(renderBarInner, myTimeOrigin + (1000 * (xOffset + gridSize) / frameTempo) - Date.now());
        }
        else if (timeBar.x >= frame.width || generation !== myGeneration) {
            timeBar.remove();
            timeBar = null;
        }
    }
    setTimeout(renderBarInner, myTimeOrigin - Date.now());
}
function calcBounds(node, xOffset, yOffset) {
    let x = node.x;
    let y = node.y;
    const rotation = Math.PI * node.rotation / 180.0;
    const xAxisRot = rotation - Math.PI / 2;
    let dx = node.width * Math.cos(rotation);
    let dy = node.width * Math.sin(rotation);
    y -= node.height * Math.sin(xAxisRot) / 2;
    x += node.height * Math.cos(xAxisRot) / 2;
    if (dx < 0) {
        x = x + dx;
        y = y - dy;
        dx = -dx;
        dy = -dy;
    }
    const props = { x: x + xOffset, y: y + yOffset, dx, dy: -dy,
        opacity: node.opacity,
        fills: node.fills,
    };
    return props;
}
function playFrame(frame, xOffset, yOffset) {
    const timeOffset = oldTimeOrigin - Date.now();
    frame.children.forEach((child) => {
        if (child.name === 'Time Bar') {
            child.remove();
            return;
        }
        if (!child.visible || child.locked)
            return;
        if (child.type === 'INSTANCE' || child.type === 'COMPONENT' || child.type === 'FRAME') {
            if (child.opacity !== 0)
                playFrame(child, xOffset + child.x, yOffset + child.y);
            return;
        }
        if (child.type === 'GROUP') {
            playFrame(child, xOffset, yOffset);
            return;
        }
        if (child.type !== 'RECTANGLE' && child.type !== 'TEXT')
            return;
        const node = calcBounds(child, xOffset, yOffset);
        const fills = node.fills;
        fillMap[child.id] = fills;
        const endOffset = timeOffset + (node.x + node.dx) * 1000 / tempo;
        if (endOffset > 0) {
            pendingTimers.push(setTimeout(() => child.fills = selectedFills, timeOffset + (node.x) * 1000 / tempo));
            pendingTimers.push(setTimeout(() => child.fills = fills, endOffset));
            if (child.type === 'RECTANGLE')
                figma.ui.postMessage(node);
        }
    });
}
function playNextFrame() {
    const nodes = [];
    for (const node of figma.currentPage.children) {
        if (node.type === "FRAME" && node.opacity === 1 && node.visible) {
            nodes.push(node);
            if (!isPaused || playingFrame)
                continue;
            for (const child of node.children) {
                if (child.name === 'Time Bar') {
                    playingFrame = node;
                    timeOrigin -= child.x * 1000 / tempo;
                    break;
                }
            }
        }
    }
    if (nodes.length === 0)
        return;
    nodes.sort((a, b) => {
        if (a.y != b.y)
            return a.y - b.y;
        return a.x - b.x;
    });
    if (playingFrame && isPaused) {
        // playingFrame is already set correctly
    }
    else if (playingFrame) {
        let idx = 0;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === playingFrame.id) {
                idx = i + 1;
                break;
            }
        }
        if (idx === nodes.length)
            return;
        playingFrame = idx >= 0 ? nodes[idx] : nodes[0];
    }
    else {
        playingFrame = nodes[0];
    }
    fillMap = {};
    oldTimeOrigin = timeOrigin;
    timeOrigin += playingFrame.width * 1000 / tempo;
    pendingTimers = [setTimeout(playNextFrame, timeOrigin - Date.now() - 200)]; // start next frame 200ms in advance to allow time for processing
    figma.ui.postMessage({ frameStart: playingFrame, frameWidth: playingFrame.width, tempo, timeOrigin: oldTimeOrigin });
    playFrame(playingFrame, 0, 0);
    isPaused = false;
    renderBar(playingFrame);
}
figma.ui.onmessage = (message) => {
    if (message.tempo) {
        tempo = message.tempo;
    }
    if (message.stop) {
        if (isPaused)
            return;
        stopPlayback(false);
    }
    if (message.play) {
        oldTimeOrigin = null;
        timeOrigin = Date.now() + 100; // give 100ms leeway to process
        playingFrame = null;
        playNextFrame();
    }
    if (message.pause) {
        stopPlayback(true);
    }
    if (message.createSheet) {
        createSheet();
    }
};
