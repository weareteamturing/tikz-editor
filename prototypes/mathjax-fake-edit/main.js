import {
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  readPrefixUnitsFromTable,
  seedPrefixWidthTable,
  stabilizePrefixForMeasurement
} from "./prefix-logic.js";

const STARTUP_COMPONENT_URL = "https://cdn.jsdelivr.net/npm/mathjax@4/startup.js";
const STARTUP_COMPONENT_ID = "prototype-mathjax-startup";
const DEFAULT_SOURCE = "Hello TikZ node text!";
const SOURCE_RENDER_DEBOUNCE_MS = 50;
const PREFIX_WIDTH_CACHE_LIMIT = 16;
const FLOW_BOX_FALLBACK_WIDTH_PX = 360;
const FLOW_WIDTH_FALLBACK_UNITS = 1800;

const sourceInput = getRequiredElement("source-input");
const wrappedTexLabel = getRequiredElement("wrapped-tex");
const status = getRequiredElement("status");
const renderStage = getRequiredElement("render-stage");
const flowBox = getRequiredElement("flow-box");
const svgHost = getRequiredElement("svg-host");
const caretOverlay = getRequiredElement("caret-overlay");
const selectionLayer = getRequiredElement("selection-layer");

const state = {
  runtime: null,
  renderToken: 0,
  source: DEFAULT_SOURCE,
  selectionStart: DEFAULT_SOURCE.length,
  selectionEnd: DEFAULT_SOURCE.length,
  renderedSource: "",
  renderedWrapKey: "",
  renderedViewBox: null,
  renderedFlowLayout: null,
  sourceTotalWidthUnits: 0,
  sourceUnitsPerPx: 0,
  prefixWidthTable: null,
  prefixWidthTableSource: "",
  prefixWidthTableComplete: false,
  prefixWidthTablesBySource: new Map(),
  prefixWidthBuildId: 0
};

let queuedFrameId = null;
let sourceRenderTimerId = null;
let sourceRenderPending = false;
let renderDragSelection = null;

setupInput();
void bootstrap();

function setupInput() {
  sourceInput.value = state.source;
  sourceInput.setSelectionRange(state.selectionStart, state.selectionEnd);

  sourceInput.addEventListener("input", () => {
    syncStateFromTextarea();
    queueRender(true);
  });

  for (const eventName of ["select", "keyup", "mouseup", "click", "focus"]) {
    sourceInput.addEventListener(eventName, () => {
      syncStateFromTextarea();
      queueRender(false);
    });
  }

  sourceInput.addEventListener("blur", () => {
    queueRender(false);
  });

  window.addEventListener("resize", () => {
    queueRender(false);
  });

  renderStage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (!beginRenderDragSelection(event)) {
      return;
    }
    event.preventDefault();
  });

  renderStage.addEventListener("pointermove", (event) => {
    if (!renderDragSelection || event.pointerId !== renderDragSelection.pointerId) {
      return;
    }
    if (!updateRenderDragSelection(event.clientX, event.clientY)) {
      return;
    }
    event.preventDefault();
  });

  renderStage.addEventListener("pointerup", (event) => {
    if (!renderDragSelection || event.pointerId !== renderDragSelection.pointerId) {
      return;
    }
    endRenderDragSelection(event.pointerId);
    event.preventDefault();
  });

  renderStage.addEventListener("pointercancel", (event) => {
    if (!renderDragSelection || event.pointerId !== renderDragSelection.pointerId) {
      return;
    }
    endRenderDragSelection(event.pointerId);
    event.preventDefault();
  });

  renderStage.addEventListener("lostpointercapture", (event) => {
    if (!renderDragSelection || event.pointerId !== renderDragSelection.pointerId) {
      return;
    }
    endRenderDragSelection(event.pointerId, { releaseCapture: false });
  });

  renderStage.addEventListener("dblclick", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (!selectWordFromRenderDoubleClick(event.clientX, event.clientY)) {
      return;
    }
    event.preventDefault();
  });
}

async function bootstrap() {
  setStatus("Loading MathJax runtime...", "warning");
  try {
    state.runtime = await ensureMathJaxRuntime();
    setStatus("MathJax ready.", "ok");
    queueRender(true);
  } catch (error) {
    hideOverlays();
    const message = sanitizeErrorMessage(error);
    setStatus(`MathJax failed to load: ${message}`, "error");
  }
}

function syncStateFromTextarea() {
  state.source = sourceInput.value;
  state.selectionStart = normalizeIndex(sourceInput.selectionStart, state.source.length);
  state.selectionEnd = normalizeIndex(sourceInput.selectionEnd, state.source.length);
}

function queueRender(sourceMayHaveChanged) {
  if (sourceMayHaveChanged) {
    sourceRenderPending = true;
    if (sourceRenderTimerId !== null) {
      clearTimeout(sourceRenderTimerId);
    }
    sourceRenderTimerId = setTimeout(() => {
      sourceRenderTimerId = null;
      sourceRenderPending = false;
      scheduleRenderFrame();
    }, SOURCE_RENDER_DEBOUNCE_MS);
    return;
  }
  scheduleRenderFrame();
}

function scheduleRenderFrame() {
  if (queuedFrameId !== null) {
    return;
  }
  queuedFrameId = requestAnimationFrame(() => {
    queuedFrameId = null;
    void renderCurrentState();
  });
}

async function renderCurrentState() {
  if (!state.runtime) {
    return;
  }

  const sourceChangedSinceRender = state.source !== state.renderedSource;
  if (sourceChangedSinceRender && sourceRenderPending) {
    return;
  }

  const flowWidthPx = getFlowBoxWidthPx();
  const wrapKey = buildWrapKey(flowWidthPx);
  const requiresRebuild =
    sourceChangedSinceRender || state.renderedViewBox == null || state.renderedFlowLayout == null || wrapKey !== state.renderedWrapKey;

  const token = ++state.renderToken;
  if (requiresRebuild) {
    let measuredSingleLine = null;
    try {
      if (sourceChangedSinceRender || state.sourceTotalWidthUnits <= 0 || state.sourceUnitsPerPx <= 0) {
        measuredSingleLine = await renderTeX(state.runtime, buildSingleLineWrappedTeX(state.source));
        if (token !== state.renderToken) {
          return;
        }
        state.sourceTotalWidthUnits = measuredSingleLine.viewBox.width;
        state.sourceUnitsPerPx = measureViewBoxUnitsPerPixel(measuredSingleLine.svg, measuredSingleLine.viewBox);
        startPrefixWidthBuild(state.runtime, state.source, measuredSingleLine.viewBox.width);
      }

      const flowWidthUnits = computeFlowWidthUnits(flowWidthPx, state.sourceUnitsPerPx, state.sourceTotalWidthUnits);
      const flowLayout = computeFlowLayout({
        source: state.source,
        totalWidthUnits: state.sourceTotalWidthUnits,
        flowWidthUnits
      });
      const wrappedTex = buildFlowWrappedTeX(flowLayout.lines, state.source);
      wrappedTexLabel.textContent = wrappedTex;

      const isSingleFullLine =
        flowLayout.lines.length === 1 && flowLayout.lines[0].start === 0 && flowLayout.lines[0].end === state.source.length;
      const renderedOutput =
        measuredSingleLine && isSingleFullLine ? measuredSingleLine : await renderTeX(state.runtime, wrappedTex);

      if (token !== state.renderToken) {
        return;
      }

      svgHost.replaceChildren(renderedOutput.svg);
      setStatus("MathJax ready.", "ok");
      state.renderedSource = state.source;
      state.renderedWrapKey = buildWrapKey(flowWidthPx);
      state.renderedViewBox = renderedOutput.viewBox;
      state.renderedFlowLayout = flowLayout;
    } catch (error) {
      if (token !== state.renderToken) {
        return;
      }
      hideOverlays();
      svgHost.replaceChildren();
      wrappedTexLabel.textContent = "";
      state.renderedSource = "";
      state.renderedWrapKey = "";
      state.renderedViewBox = null;
      state.renderedFlowLayout = null;
      setStatus(`MathJax render error: ${sanitizeErrorMessage(error)}`, "error");
      return;
    }
  } else {
    wrappedTexLabel.textContent = buildFlowWrappedTeX(state.renderedFlowLayout.lines, state.source);
  }

  if (!state.renderedViewBox || !state.renderedFlowLayout) {
    hideOverlays();
    return;
  }

  requestAnimationFrame(() => {
    if (token !== state.renderToken) {
      return;
    }
    positionFakeSelection({
      fullViewBox: state.renderedViewBox,
      flowLayout: state.renderedFlowLayout,
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd
    });
  });
}

function beginRenderDragSelection(event) {
  const clickIndex = indexFromRenderClientPoint(event.clientX, event.clientY);
  if (clickIndex == null) {
    return false;
  }

  sourceInput.focus();
  const anchorIndex = event.shiftKey ? getTextareaSelectionAnchor() : clickIndex;
  applyTextareaSelection(anchorIndex, clickIndex);

  renderDragSelection = {
    pointerId: event.pointerId,
    anchorIndex
  };
  renderStage.classList.add("is-dragging");

  if (typeof renderStage.setPointerCapture === "function") {
    try {
      renderStage.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in some browser states; drag still works while pointer remains over the stage.
    }
  }

  return true;
}

function updateRenderDragSelection(clientX, clientY) {
  if (!renderDragSelection) {
    return false;
  }
  const headIndex = indexFromRenderClientPoint(clientX, clientY);
  if (headIndex == null) {
    return false;
  }
  applyTextareaSelection(renderDragSelection.anchorIndex, headIndex);
  return true;
}

function endRenderDragSelection(pointerId, options = { releaseCapture: true }) {
  if (!renderDragSelection || renderDragSelection.pointerId !== pointerId) {
    return;
  }

  renderDragSelection = null;
  renderStage.classList.remove("is-dragging");

  if (options.releaseCapture && typeof renderStage.releasePointerCapture === "function") {
    try {
      renderStage.releasePointerCapture(pointerId);
    } catch {
      // Ignore if capture has already been released.
    }
  }
}

function selectWordFromRenderDoubleClick(clientX, clientY) {
  const clickIndex = indexFromRenderClientPoint(clientX, clientY);
  if (clickIndex == null) {
    return false;
  }

  const wordRange = findWordRangeAtIndex(state.source, clickIndex);
  sourceInput.focus();
  if (!wordRange) {
    applyTextareaSelection(clickIndex, clickIndex);
    return true;
  }

  applyTextareaSelection(wordRange.start, wordRange.end);
  return true;
}

function positionFakeSelection({ fullViewBox, flowLayout, selectionStart, selectionEnd }) {
  const svg = svgHost.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    hideOverlays();
    return;
  }

  const svgRect = svg.getBoundingClientRect();
  const flowBoxRect = flowBox.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0 || fullViewBox.width <= 0) {
    hideOverlays();
    return;
  }

  const lines = Array.isArray(flowLayout?.lines) ? flowLayout.lines : [];
  if (lines.length === 0) {
    hideOverlays();
    return;
  }

  const lineHeightUnits = fullViewBox.height / lines.length;
  if (!Number.isFinite(lineHeightUnits) || lineHeightUnits <= 0) {
    hideOverlays();
    return;
  }

  const scaleX = svgRect.width / fullViewBox.width;
  const scaleY = svgRect.height / fullViewBox.height;
  const leftEdge = svgRect.left - flowBoxRect.left;
  const rightEdge = leftEdge + svgRect.width;
  const top = svgRect.top - flowBoxRect.top;
  const startIndex = normalizeIndex(selectionStart, state.source.length);
  const endIndex = normalizeIndex(selectionEnd, state.source.length);
  const collapsed = startIndex === endIndex;

  if (!collapsed) {
    const selectionRects = buildSelectionRectangles(startIndex, endIndex, flowLayout, lineHeightUnits);
    renderSelectionRectangles(selectionRects, {
      leftEdge,
      rightEdge,
      top,
      scaleX,
      scaleY
    });
    caretOverlay.classList.add("hidden");
    return;
  }

  clearSelectionRectangles();
  if (document.activeElement !== sourceInput) {
    caretOverlay.classList.add("hidden");
    return;
  }

  const caretPoint = resolveCursorPointForIndex(startIndex, flowLayout);
  if (!caretPoint) {
    caretOverlay.classList.add("hidden");
    return;
  }

  const mappedLeft = clamp(leftEdge + caretPoint.xUnits * scaleX, leftEdge, rightEdge);
  caretOverlay.style.left = `${mappedLeft}px`;
  caretOverlay.style.top = `${top + caretPoint.lineIndex * lineHeightUnits * scaleY}px`;
  caretOverlay.style.height = `${Math.max(1, lineHeightUnits * scaleY)}px`;
  caretOverlay.classList.remove("hidden");
}

function hideOverlays() {
  caretOverlay.classList.add("hidden");
  clearSelectionRectangles();
}

function buildSelectionRectangles(startIndex, endIndex, flowLayout, lineHeightUnits) {
  const startPoint = resolveCursorPointForIndex(startIndex, flowLayout);
  const endPoint = resolveCursorPointForIndex(endIndex, flowLayout);
  if (!startPoint || !endPoint) {
    return [];
  }

  let anchor = startPoint;
  let head = endPoint;
  if (head.lineIndex < anchor.lineIndex || (head.lineIndex === anchor.lineIndex && head.xUnits < anchor.xUnits)) {
    anchor = endPoint;
    head = startPoint;
  }

  if (anchor.lineIndex === head.lineIndex) {
    return [
      {
        lineIndex: anchor.lineIndex,
        leftUnits: Math.min(anchor.xUnits, head.xUnits),
        widthUnits: Math.max(1, Math.abs(head.xUnits - anchor.xUnits)),
        lineHeightUnits
      }
    ];
  }

  const lines = flowLayout.lines;
  const rectangles = [];
  const firstLineWidth = lines[anchor.lineIndex].widthUnits - anchor.xUnits;
  if (firstLineWidth > 0) {
    rectangles.push({
      lineIndex: anchor.lineIndex,
      leftUnits: anchor.xUnits,
      widthUnits: firstLineWidth,
      lineHeightUnits
    });
  }

  for (let lineIndex = anchor.lineIndex + 1; lineIndex < head.lineIndex; lineIndex += 1) {
    const widthUnits = lines[lineIndex].widthUnits;
    if (widthUnits > 0) {
      rectangles.push({
        lineIndex,
        leftUnits: 0,
        widthUnits,
        lineHeightUnits
      });
    }
  }

  if (head.xUnits > 0) {
    rectangles.push({
      lineIndex: head.lineIndex,
      leftUnits: 0,
      widthUnits: head.xUnits,
      lineHeightUnits
    });
  }

  return rectangles;
}

function resolveCursorPointForIndex(index, flowLayout) {
  const lines = flowLayout.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  const normalizedIndex = normalizeIndex(index, state.source.length);
  const lineIndex = findLineIndexForCursor(normalizedIndex, lines);
  const line = lines[lineIndex];
  const clampedIndex = clamp(normalizedIndex, line.start, line.end);
  const prefixUnits = readPrefixUnits(clampedIndex, state.source, state.sourceTotalWidthUnits);
  const xUnits = clamp(prefixUnits - line.prefixStartUnits, 0, line.widthUnits);
  return { lineIndex, xUnits };
}

function findLineIndexForCursor(index, lines) {
  if (lines.length === 0) {
    return 0;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (index === line.start && line.start === line.end) {
      return lineIndex;
    }
    const isLastLine = lineIndex === lines.length - 1;
    if (index < line.end || (index === line.end && isLastLine)) {
      return lineIndex;
    }
  }
  return lines.length - 1;
}

function renderSelectionRectangles(rectangles, geometry) {
  if (!Array.isArray(rectangles) || rectangles.length === 0) {
    clearSelectionRectangles();
    return;
  }

  const nodes = rectangles.map((rect) => {
    const node = document.createElement("div");
    node.className = "selection-overlay";
    const left = clamp(geometry.leftEdge + rect.leftUnits * geometry.scaleX, geometry.leftEdge, geometry.rightEdge);
    const top = geometry.top + rect.lineIndex * rect.lineHeightUnits * geometry.scaleY;
    const width = Math.max(1, rect.widthUnits * geometry.scaleX);
    const height = Math.max(1, rect.lineHeightUnits * geometry.scaleY);

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    return node;
  });

  selectionLayer.replaceChildren(...nodes);
  selectionLayer.classList.remove("hidden");
}

function clearSelectionRectangles() {
  selectionLayer.replaceChildren();
  selectionLayer.classList.add("hidden");
}

async function ensureMathJaxRuntime() {
  const preloadedRuntime = await readBrowserRuntime(150);
  if (preloadedRuntime) {
    return preloadedRuntime;
  }

  configureMathJaxGlobal();
  await ensureStartupComponentLoaded();

  const runtime = await readBrowserRuntime(5000);
  if (!runtime) {
    throw new Error(`MathJax runtime not available on window.MathJax. ${describeMathJaxShape(window.MathJax)}`);
  }
  return runtime;
}

function configureMathJaxGlobal() {
  const existing = window.MathJax && typeof window.MathJax === "object" ? window.MathJax : {};
  const existingLoader = recordOrEmpty(existing.loader);
  const existingTex = recordOrEmpty(existing.tex);
  const existingSvg = recordOrEmpty(existing.svg);
  const existingStartup = recordOrEmpty(existing.startup);

  window.MathJax = {
    ...existing,
    loader: {
      ...existingLoader,
      load: uniqueStrings([...toStringArray(existingLoader.load), "input/tex", "output/svg"])
    },
    tex: {
      ...existingTex,
      formatError: (_jax, err) => {
        throw err;
      }
    },
    svg: {
      ...existingSvg,
      fontCache: "none"
    },
    startup: {
      ...existingStartup,
      typeset: false
    }
  };
}

async function ensureStartupComponentLoaded() {
  const existingScript = document.getElementById(STARTUP_COMPONENT_ID);
  if (existingScript) {
    await waitForScriptLoad(existingScript);
    return;
  }

  const script = document.createElement("script");
  script.id = STARTUP_COMPONENT_ID;
  script.src = STARTUP_COMPONENT_URL;
  script.async = true;
  script.defer = true;
  script.setAttribute("data-prototype", "mathjax-startup");

  const loadPromise = waitForScriptLoad(script);
  document.head.appendChild(script);
  await loadPromise;
}

function waitForScriptLoad(script) {
  return new Promise((resolve, reject) => {
    const loadedMarker = "__prototypeMathJaxLoaded";
    const errorMarker = "__prototypeMathJaxLoadError";

    if (script[loadedMarker] === true) {
      resolve();
      return;
    }

    if (script[errorMarker] instanceof Error) {
      reject(script[errorMarker]);
      return;
    }

    if (typeof script.readyState === "string") {
      const readyState = script.readyState;
      if (readyState === "loaded" || readyState === "complete") {
        script[loadedMarker] = true;
        resolve();
        return;
      }
    }

    const onLoad = () => {
      script[loadedMarker] = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      const error = new Error(`Unable to load MathJax startup component from ${STARTUP_COMPONENT_URL}.`);
      script[errorMarker] = error;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
  });
}

function hasRuntimeShape(value) {
  return Boolean(value && typeof value.tex2svg === "function");
}

async function readBrowserRuntime(timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const runtime = await coerceBrowserRuntime(window.MathJax);
    if (runtime) {
      return runtime;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await waitForNextTurn();
  } while (true);
}

async function coerceBrowserRuntime(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const startup = candidate.startup && typeof candidate.startup === "object" ? candidate.startup : null;
  if (startup && startup.promise && typeof startup.promise.then === "function") {
    await startup.promise;
  }

  if (typeof candidate.tex2svg !== "function") {
    return null;
  }

  return candidate;
}

function buildSingleLineWrappedTeX(source) {
  return `\\mbox{${source}}`;
}

function buildFlowWrappedTeX(lines, source) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "\\begin{array}[t]{@{}l@{}}\\mbox{}\\end{array}";
  }

  if (
    lines.length === 1 &&
    lines[0].start === 0 &&
    lines[0].end === source.length &&
    !source.includes("\n")
  ) {
    return buildSingleLineWrappedTeX(source);
  }

  const rows = lines.map((line) => `\\mbox{${source.slice(line.start, line.end)}}`);
  return `\\begin{array}[t]{@{}l@{}}${rows.join("\\\\")}\\end{array}`;
}

function getFlowBoxWidthPx() {
  const width = flowBox.getBoundingClientRect().width;
  return width > 0 ? width : FLOW_BOX_FALLBACK_WIDTH_PX;
}

function buildWrapKey(flowWidthPx) {
  const hasMeasuredPrefixTable = state.prefixWidthTableSource === state.source && state.prefixWidthTableComplete;
  return `${Math.round(flowWidthPx)}:${hasMeasuredPrefixTable ? "measured" : "provisional"}`;
}

function computeFlowWidthUnits(flowWidthPx, unitsPerPx, totalWidthUnits) {
  if (Number.isFinite(flowWidthPx) && flowWidthPx > 0 && Number.isFinite(unitsPerPx) && unitsPerPx > 0) {
    return Math.max(1, flowWidthPx * unitsPerPx);
  }
  if (Number.isFinite(totalWidthUnits) && totalWidthUnits > 0) {
    return Math.max(1, Math.min(totalWidthUnits, FLOW_WIDTH_FALLBACK_UNITS));
  }
  return FLOW_WIDTH_FALLBACK_UNITS;
}

function measureViewBoxUnitsPerPixel(svg, viewBox) {
  const probe = svg.cloneNode(true);
  if (!(probe instanceof SVGSVGElement)) {
    return viewBox.width > 0 ? viewBox.width / FLOW_BOX_FALLBACK_WIDTH_PX : 0;
  }

  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.left = "-100000px";
  probe.style.top = "-100000px";

  document.body.appendChild(probe);
  const widthPx = probe.getBoundingClientRect().width;
  probe.remove();

  if (widthPx > 0 && viewBox.width > 0) {
    return viewBox.width / widthPx;
  }
  return viewBox.width > 0 ? viewBox.width / FLOW_BOX_FALLBACK_WIDTH_PX : 0;
}

function computeFlowLayout({ source, totalWidthUnits, flowWidthUnits }) {
  const sourceLength = source.length;
  const safeTotalWidth = Number.isFinite(totalWidthUnits) && totalWidthUnits > 0 ? totalWidthUnits : 0;
  const safeFlowWidth = Math.max(1, Number.isFinite(flowWidthUnits) ? flowWidthUnits : FLOW_WIDTH_FALLBACK_UNITS);
  const table =
    state.prefixWidthTableSource === source && Array.isArray(state.prefixWidthTable) ? state.prefixWidthTable : null;

  const prefixUnits = new Array(sourceLength + 1);
  for (let index = 0; index <= sourceLength; index += 1) {
    prefixUnits[index] = readPrefixUnitsFromTable(index, sourceLength, safeTotalWidth, table);
  }

  const lines = [];
  let segmentStart = 0;
  for (let index = 0; index <= sourceLength; index += 1) {
    const hitSegmentEnd = index === sourceLength || source.charAt(index) === "\n";
    if (!hitSegmentEnd) {
      continue;
    }
    appendWrappedSegment(lines, source, prefixUnits, safeFlowWidth, segmentStart, index);
    segmentStart = index + 1;
  }

  if (lines.length === 0) {
    lines.push(createFlowLine(0, 0, prefixUnits));
  }

  return {
    lines,
    prefixUnits,
    totalWidthUnits: safeTotalWidth,
    flowWidthUnits: safeFlowWidth
  };
}

function appendWrappedSegment(lines, source, prefixUnits, flowWidthUnits, segmentStart, segmentEnd) {
  if (segmentStart >= segmentEnd) {
    lines.push(createFlowLine(segmentStart, segmentEnd, prefixUnits));
    return;
  }

  let lineStart = segmentStart;
  while (lineStart < segmentEnd) {
    const lineEnd = findGreedyLineEnd(source, prefixUnits, flowWidthUnits, lineStart, segmentEnd);
    lines.push(createFlowLine(lineStart, lineEnd, prefixUnits));
    lineStart = lineEnd;
  }
}

function createFlowLine(start, end, prefixUnits) {
  const prefixStartUnits = Number(prefixUnits[start]) || 0;
  const prefixEndUnits = Number(prefixUnits[end]) || prefixStartUnits;
  return {
    start,
    end,
    prefixStartUnits,
    prefixEndUnits,
    widthUnits: Math.max(0, prefixEndUnits - prefixStartUnits)
  };
}

function findGreedyLineEnd(source, prefixUnits, flowWidthUnits, start, hardEnd) {
  if (start >= hardEnd) {
    return start;
  }

  const availableWidth = Number(prefixUnits[hardEnd]) - Number(prefixUnits[start]);
  if (availableWidth <= flowWidthUnits) {
    return hardEnd;
  }

  let low = start + 1;
  let high = hardEnd;
  let best = start + 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const width = Number(prefixUnits[mid]) - Number(prefixUnits[start]);
    if (width <= flowWidthUnits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const wrapOpportunity = findLastWrapOpportunity(source, start, best);
  if (wrapOpportunity != null) {
    return wrapOpportunity;
  }
  return best;
}

function findLastWrapOpportunity(source, start, endExclusive) {
  for (let index = endExclusive; index > start + 1; index -= 1) {
    const previous = source.charAt(index - 1);
    if (/\s/.test(previous) || previous === "-" || previous === "/" || previous === ",") {
      return index;
    }
  }
  return null;
}

async function renderTeX(runtime, tex) {
  try {
    const node = runtime.tex2svg(tex, { display: false });
    return extractSvgResult(node);
  } catch (error) {
    if (!isRetryError(error) || typeof runtime.tex2svgPromise !== "function") {
      throw error;
    }
    const node = await runtime.tex2svgPromise(tex, { display: false });
    return extractSvgResult(node);
  }
}

function extractSvgResult(containerNode) {
  if (!(containerNode instanceof Element)) {
    throw new Error("MathJax did not return a DOM element.");
  }

  const svg = containerNode.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("MathJax output is missing an <svg> element.");
  }

  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) {
    throw new Error("MathJax SVG output is missing a valid viewBox.");
  }

  const cloned = svg.cloneNode(true);
  if (!(cloned instanceof SVGSVGElement)) {
    throw new Error("Unable to clone MathJax SVG output.");
  }

  return {
    svg: cloned,
    viewBox
  };
}

function startPrefixWidthBuild(runtime, source, totalWidthUnits) {
  const sourceLength = source.length;
  const cached = state.prefixWidthTablesBySource.get(source);
  state.prefixWidthTableSource = source;

  if (Array.isArray(cached) && cached.length === sourceLength + 1) {
    const hydrated = cached.slice();
    hydrated[0] = 0;
    hydrated[sourceLength] = totalWidthUnits;
    state.prefixWidthTable = finalizePrefixWidthTable(hydrated, totalWidthUnits);
    state.prefixWidthTableComplete = true;
    cachePrefixWidthTable(source, state.prefixWidthTable);
    return;
  }

  state.prefixWidthBuildId += 1;
  const buildId = state.prefixWidthBuildId;
  state.prefixWidthTable = seedPrefixWidthTable(sourceLength, totalWidthUnits);
  state.prefixWidthTableComplete = sourceLength <= 1;

  if (sourceLength <= 1) {
    cachePrefixWidthTable(source, state.prefixWidthTable);
    return;
  }

  void buildPrefixWidthTable(runtime, source, totalWidthUnits, buildId)
    .then((table) => {
      if (!table) {
        return;
      }
      if (buildId !== state.prefixWidthBuildId || state.source !== source) {
        return;
      }
      state.prefixWidthTable = table;
      state.prefixWidthTableComplete = true;
      cachePrefixWidthTable(source, table);
      scheduleRenderFrame();
    })
    .catch(() => {
      // Keep provisional proportional fallback if background width build fails.
    });
}

async function buildPrefixWidthTable(runtime, source, totalWidthUnits, buildId) {
  const sourceLength = source.length;
  const table = seedPrefixWidthTable(sourceLength, totalWidthUnits);

  for (let index = 1; index < sourceLength; index += 1) {
    if (buildId !== state.prefixWidthBuildId || state.source !== source) {
      return null;
    }

    const prefix = source.slice(0, index);
    try {
      const repairedPrefix = stabilizePrefixForMeasurement(prefix);
      const result = await renderTeX(runtime, buildSingleLineWrappedTeX(repairedPrefix));
      table[index] = result.viewBox.width;
    } catch {
      table[index] = Number.NaN;
    }

    if (index % 4 === 0) {
      await waitForNextTurn();
    }
  }

  return finalizePrefixWidthTable(table, totalWidthUnits);
}

function cachePrefixWidthTable(source, table) {
  state.prefixWidthTablesBySource.delete(source);
  state.prefixWidthTablesBySource.set(source, table.slice());
  while (state.prefixWidthTablesBySource.size > PREFIX_WIDTH_CACHE_LIMIT) {
    const oldestSource = state.prefixWidthTablesBySource.keys().next().value;
    if (typeof oldestSource !== "string") {
      break;
    }
    state.prefixWidthTablesBySource.delete(oldestSource);
  }
}

function readPrefixUnits(index, source, totalWidthUnits) {
  const normalizedIndex = normalizeIndex(index, source.length);
  const table =
    state.prefixWidthTableSource === source && state.prefixWidthTableComplete && Array.isArray(state.prefixWidthTable)
      ? state.prefixWidthTable
      : null;
  return readPrefixUnitsFromTable(normalizedIndex, source.length, totalWidthUnits, table);
}

function findNearestPrefixIndex(targetUnits, source, totalWidthUnits) {
  const table = state.prefixWidthTableSource === source && state.prefixWidthTableComplete ? state.prefixWidthTable : null;
  return findNearestPrefixIndexFromTable(targetUnits, source.length, totalWidthUnits, table);
}

function indexFromRenderClientPoint(clientX, clientY) {
  const svg = svgHost.querySelector("svg");
  if (!(svg instanceof SVGSVGElement) || !state.renderedViewBox || !state.renderedFlowLayout) {
    return null;
  }

  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0 || state.renderedViewBox.width <= 0 || state.renderedViewBox.height <= 0) {
    return null;
  }

  const lines = state.renderedFlowLayout.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  const lineHeightUnits = state.renderedViewBox.height / lines.length;
  if (!Number.isFinite(lineHeightUnits) || lineHeightUnits <= 0) {
    return null;
  }

  const ratioX = clamp((clientX - svgRect.left) / svgRect.width, 0, 1);
  const ratioY = clamp((clientY - svgRect.top) / svgRect.height, 0, 1);
  const xUnits = ratioX * state.renderedViewBox.width;
  const yUnits = ratioY * state.renderedViewBox.height;
  const lineIndex = clamp(Math.floor(yUnits / lineHeightUnits), 0, lines.length - 1);
  const line = lines[lineIndex];
  const targetUnits = line.prefixStartUnits + xUnits;
  const nearest = findNearestPrefixIndex(targetUnits, state.source, state.sourceTotalWidthUnits);
  return clamp(normalizeIndex(nearest, state.source.length), line.start, line.end);
}

function applyTextareaSelection(anchorIndex, headIndex) {
  const normalizedAnchor = normalizeIndex(anchorIndex, state.source.length);
  const normalizedHead = normalizeIndex(headIndex, state.source.length);
  if (normalizedAnchor === normalizedHead) {
    sourceInput.setSelectionRange(normalizedAnchor, normalizedHead, "none");
  } else if (normalizedHead > normalizedAnchor) {
    sourceInput.setSelectionRange(normalizedAnchor, normalizedHead, "forward");
  } else {
    sourceInput.setSelectionRange(normalizedHead, normalizedAnchor, "backward");
  }
  syncStateFromTextarea();
  queueRender(false);
}

function getTextareaSelectionAnchor() {
  const start = normalizeIndex(sourceInput.selectionStart, state.source.length);
  const end = normalizeIndex(sourceInput.selectionEnd, state.source.length);
  if (start === end) {
    return start;
  }
  return sourceInput.selectionDirection === "backward" ? end : start;
}

function findWordRangeAtIndex(text, index) {
  if (text.length === 0) {
    return null;
  }

  let probe = normalizeIndex(index, text.length);
  if (probe === text.length) {
    probe = text.length - 1;
  }
  if (probe < 0) {
    return null;
  }

  if (!isWordChar(text.charAt(probe))) {
    if (probe > 0 && isWordChar(text.charAt(probe - 1))) {
      probe -= 1;
    } else {
      return null;
    }
  }

  let start = probe;
  let end = probe + 1;

  while (start > 0 && isWordChar(text.charAt(start - 1))) {
    start -= 1;
  }

  while (end < text.length && isWordChar(text.charAt(end))) {
    end += 1;
  }

  return { start, end };
}

function isWordChar(character) {
  return /^[A-Za-z0-9_]$/.test(character);
}

function parseViewBox(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

function normalizeIndex(value, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, max);
}

function setStatus(message, tone) {
  status.textContent = message;
  status.className = `status status-${tone}`;
}

function sanitizeErrorMessage(error) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const fallback = String(error).trim();
  return fallback || "Unknown error";
}

function isRetryError(error) {
  const message = sanitizeErrorMessage(error).toLowerCase();
  return (
    message.includes("mathjax retry") ||
    (message.includes("asynchronous action is required") && message.includes("promise-based"))
  );
}

function recordOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function describeMathJaxShape(value) {
  if (!value || typeof value !== "object") {
    return "window.MathJax is missing.";
  }

  const rootKeys = summarizeKeys(value);
  const startup = value.startup && typeof value.startup === "object" ? value.startup : null;
  const startupKeys = startup ? summarizeKeys(startup) : "(missing)";
  const hasTex2svg = typeof value.tex2svg === "function";

  return `MathJax keys: ${rootKeys}; startup keys: ${startupKeys}; tex2svg: ${hasTex2svg}.`;
}

function summarizeKeys(record) {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return "(none)";
  }
  return `[${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", ..." : ""}]`;
}

function waitForNextTurn() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} is missing.`);
  }
  return element;
}
