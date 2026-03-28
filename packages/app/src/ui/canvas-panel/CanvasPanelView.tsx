import { CanvasSVGLayer } from "./CanvasSVGLayer";
import {
  CurveControlOverlay,
  HandleOverlay,
  HitRegionLayer,
  NodeAnchorOverlay,
  SelectionDragLayer,
  SelectionOverlay,
  SnapOverlay,
  ToolPreviewOverlay
} from "./overlays";
import { fmt, worldToSvgY } from "./geometry";
import { CanvasContextMenu } from "../CanvasContextMenu";
import { RenderedTooltip } from "../RenderedTooltip";
import css from "../CanvasPanel.module.css";

const MAGNIFIER_DIAMETER_PX = 300;
const MAGNIFIER_SCALE = 2.25;

type CanvasPanelViewProps = {
  [key: string]: any;
};

export function CanvasPanelView(props: CanvasPanelViewProps) {
  const {
    showRulers,
    viewportSize,
    topRulerRef,
    leftRulerRef,
    onTopRulerPointerDown,
    onLeftRulerPointerDown,
    onCanvasContextMenu,
    rulers,
    LEFT_RULER_DRAG_SOURCE_WIDTH_PX,
    toolMode,
    viewportRef,
    onViewportKeyDown,
    onViewportCopy,
    onViewportCut,
    onViewportPaste,
    onViewportDragOver,
    onViewportDrop,
    onBackgroundClick,
    onViewportPointerDown,
    onViewportPointerUp,
    svgResult,
    noActiveFigure,
    assistantLockReason,
    snapshot,
    svgModel,
    canvasTransform,
    showTransparencyGrid,
    showDocumentBounds,
    svgDiffHints,
    forceSvgReplaceAll,
    onSvgPatchFallback,
    repeatPreviewModel,
    interactionSvgRef,
    onInteractionPointerDown,
    onInteractionPointerUp,
    onInteractionLostPointerCapture,
    onInteractionPointerMove,
    onInteractionPointerEnter,
    onInteractionPointerLeave,
    gridLines,
    gridMinorStrokeWidth,
    gridMajorStrokeWidth,
    visibleRanges,
    showGuides,
    renderedGuides,
    guideStrokeWidth,
    guideHitStrokeWidth,
    onGuidePointerDown,
    snapLines,
    snapStrokeWidth,
    snapCrossSize,
    toolPreview,
    handleStrokeWidth,
    previewArrowPoints,
    hitRegions,
    hoveredElementId,
    editableTextRegionKeys,
    draggableSourceIds,
    onElementPointerDown,
    onElementContextMenu,
    onElementDoubleClick,
    onHoverChange,
    marqueeBounds,
    selectionBoxes,
    adornmentHighlightBoxes,
    selectedAdornmentConnectors,
    selectionStrokeWidth,
    textSelectionVisual,
    selectionDragStrokeWidth,
    matrixSelectionSourceIds,
    curveControlLines,
    curveControlStrokeWidth,
    nodeAnchorOverlay,
    handleHalfSize,
    handleDisplays,
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    platform,
    contextMenuState,
    commandRuntimeBindings,
    contextMenuDefinition,
    onContextMenuClose,
    onContextMenuCommandRun,
    dragTooltip,
    dragTooltipBoundary,
    warning,
    copyWarningToClipboard,
    onWarningBarKeyDown,
    selectionHint,
    showDevPanel,
    snapDebugRect,
    onSnapDebugMovePointerDown,
    snapDebug,
    onSnapDebugResizePointerDown,
    RULER_SIZE,
    magnifierState
  } = props;

  const viewportCursorClass = toolMode === "magnify" ? css.viewportMagnify : toolMode === "select" ? "" : css.viewportTool;
  const interactionCursorClass = toolMode === "magnify" ? css.interactionLayerMagnify : toolMode === "select" ? "" : css.interactionLayerTool;
  const magnifierRadius = MAGNIFIER_DIAMETER_PX / 2;
  const magnifierVisible = toolMode === "magnify" && magnifierState != null && svgResult != null && viewportSize.width > 0 && viewportSize.height > 0;
  const magnifierLeft = magnifierVisible
    ? Math.max(0, Math.min(viewportSize.width - MAGNIFIER_DIAMETER_PX, magnifierState.x - magnifierRadius))
    : 0;
  const magnifierTop = magnifierVisible
    ? Math.max(0, Math.min(viewportSize.height - MAGNIFIER_DIAMETER_PX, magnifierState.y - magnifierRadius))
    : 0;

  return (
    <div className={css.panel}>
      <div className={[css.canvasGrid, showRulers ? "" : css.canvasGridNoRulers].filter(Boolean).join(" ")}>
        {showRulers ? <div className={css.rulerCorner}>cm</div> : null}

        {showRulers ? (
          <div className={css.topRulerSlot}>
            <svg
              ref={topRulerRef}
              className={css.topRuler}
              viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${RULER_SIZE}`}
              preserveAspectRatio="none"
              onPointerDown={onTopRulerPointerDown}
              onContextMenu={onCanvasContextMenu}
            >
              <line x1={0} y1={RULER_SIZE - 0.5} x2={viewportSize.width} y2={RULER_SIZE - 0.5} className={css.rulerAxis} />
              {rulers.topTicks.map((tick: any, index: number) => (
                <g key={`top-${index}`} transform={`translate(${tick.viewportPos},0)`}>
                  <line
                    x1={0}
                    y1={RULER_SIZE}
                    x2={0}
                    y2={tick.major ? 5 : 11}
                    className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                  />
                  {tick.label && (
                    <text className={css.rulerLabel} x={2} y={10}>
                      {tick.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        ) : null}

        {showRulers ? (
          <div className={css.leftRulerSlot}>
            <svg
              ref={leftRulerRef}
              className={css.leftRuler}
              viewBox={`0 0 ${RULER_SIZE} ${Math.max(1, viewportSize.height)}`}
              preserveAspectRatio="none"
              onPointerDown={onLeftRulerPointerDown}
              onContextMenu={onCanvasContextMenu}
            >
              <line x1={RULER_SIZE - 0.5} y1={0} x2={RULER_SIZE - 0.5} y2={viewportSize.height} className={css.rulerAxis} />
              {rulers.leftTicks.map((tick: any, index: number) => (
                <g key={`left-${index}`} transform={`translate(0,${tick.viewportPos})`}>
                  <line
                    x1={RULER_SIZE}
                    y1={0}
                    x2={tick.major ? 5 : 11}
                    y2={0}
                    className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                  />
                  {tick.label && (
                    <text className={css.rulerLabel} x={1} y={-2}>
                      {tick.label}
                    </text>
                  )}
                </g>
              ))}
              <rect
                x={RULER_SIZE - LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
                y={0}
                width={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
                height={Math.max(1, viewportSize.height)}
                className={css.leftRulerGuideStrip}
                fill="transparent"
              />
            </svg>
          </div>
        ) : null}

        <div
          className={[css.viewport, viewportCursorClass].filter(Boolean).join(" ")}
          ref={viewportRef}
          data-canvas-viewport="true"
          data-testid="canvas-viewport"
          tabIndex={0}
          onKeyDown={onViewportKeyDown}
          onCopy={onViewportCopy}
          onCut={onViewportCut}
          onPaste={onViewportPaste}
          onDragOver={onViewportDragOver}
          onDrop={onViewportDrop}
          onClick={onBackgroundClick}
          onPointerDown={onViewportPointerDown}
          onPointerUp={onViewportPointerUp}
          onContextMenu={(event) => {
            if (event.defaultPrevented) {
              return;
            }
            if (svgResult && event.target !== event.currentTarget) {
              return;
            }
            onCanvasContextMenu(event);
          }}
        >
          {assistantLockReason ? <div className={css.lockOverlay} data-testid="canvas-lock-overlay">{assistantLockReason}</div> : null}
          {!svgResult ? (
            <div className={css.noSvg} data-testid="canvas-no-svg">
              {noActiveFigure ? "Select a figure to edit." : (snapshot.source ? "Computing…" : "No source")}
            </div>
          ) : (
            <div
              className={css.worldStage}
              data-testid="canvas-world-stage"
              style={{
                width: svgResult.viewBox.width * canvasTransform.scale,
                height: svgResult.viewBox.height * canvasTransform.scale,
                transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px)`
              }}
            >
              <CanvasSVGLayer
                model={svgModel}
                diffHints={svgDiffHints}
                forceReplaceAll={forceSvgReplaceAll}
                showTransparencyGrid={showTransparencyGrid}
                showDocumentBounds={showDocumentBounds}
                onFallback={onSvgPatchFallback}
              />

              {repeatPreviewModel ? (
                <svg
                  className={css.repeatPreviewLayer}
                  data-testid="canvas-repeat-preview-layer"
                  viewBox={`${repeatPreviewModel.viewBox.x} ${repeatPreviewModel.viewBox.y} ${repeatPreviewModel.viewBox.width} ${repeatPreviewModel.viewBox.height}`}
                  aria-hidden="true"
                >
                  <defs dangerouslySetInnerHTML={{ __html: repeatPreviewModel.defs.join("") }} />
                  <g
                    className={css.repeatPreviewContent}
                    dangerouslySetInnerHTML={{ __html: repeatPreviewModel.parts.map((part: any) => part.markup).join("") }}
                  />
                </svg>
              ) : null}

              <svg
                ref={interactionSvgRef}
                className={[css.interactionLayer, interactionCursorClass].filter(Boolean).join(" ")}
                data-testid="canvas-interaction-layer"
                viewBox={`${svgResult.viewBox.x} ${svgResult.viewBox.y} ${svgResult.viewBox.width} ${svgResult.viewBox.height}`}
                onClick={onBackgroundClick}
                onPointerDown={onInteractionPointerDown}
                onPointerUp={onInteractionPointerUp}
                onPointerCancel={onInteractionPointerUp}
                onLostPointerCapture={onInteractionLostPointerCapture}
                onPointerMove={onInteractionPointerMove}
                onPointerEnter={onInteractionPointerEnter}
                onPointerLeave={onInteractionPointerLeave}
                onContextMenu={onCanvasContextMenu}
              >
                {gridLines && (
                  <g className={css.gridOverlay}>
                    {gridLines.verticalMinor.map((x: number) => (
                      <line
                        key={`v-min-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.verticalMajor.map((x: number) => (
                      <line
                        key={`v-maj-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMinor.map((y: number) => (
                      <line
                        key={`h-min-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMajor.map((y: number) => (
                      <line
                        key={`h-maj-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                  </g>
                )}

                {showGuides && (renderedGuides.vertical.length > 0 || renderedGuides.horizontal.length > 0) && (
                  <g className={css.guideOverlay}>
                    {renderedGuides.vertical.map((x: number) => (
                      <g key={`guide-v-${fmt(x)}`}>
                        <line
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={css.guideLine}
                          strokeWidth={guideStrokeWidth}
                        />
                        <line
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={`${css.guideHitLine} ${css.guideLineVertical}`}
                          strokeWidth={guideHitStrokeWidth}
                          onPointerDown={(event) => onGuidePointerDown(event, "vertical", x)}
                        />
                      </g>
                    ))}
                    {renderedGuides.horizontal.map((worldY: number) => {
                      const y = worldToSvgY(worldY, svgResult.viewBox);
                      return (
                        <g key={`guide-h-${fmt(worldY)}`}>
                          <line
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={css.guideLine}
                            strokeWidth={guideStrokeWidth}
                          />
                          <line
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={`${css.guideHitLine} ${css.guideLineHorizontal}`}
                            strokeWidth={guideHitStrokeWidth}
                            onPointerDown={(event) => onGuidePointerDown(event, "horizontal", worldY)}
                          />
                        </g>
                      );
                    })}
                  </g>
                )}

                <SnapOverlay
                  snapLines={snapLines}
                  viewBox={svgResult.viewBox}
                  snapStrokeWidth={snapStrokeWidth}
                  snapCrossSize={snapCrossSize}
                />

                <ToolPreviewOverlay
                  toolPreview={toolPreview}
                  scale={canvasTransform.scale}
                  handleStrokeWidth={handleStrokeWidth}
                  previewArrowPoints={previewArrowPoints}
                />

                <HitRegionLayer
                  hitRegions={hitRegions}
                  hoveredElementId={hoveredElementId}
                  toolMode={toolMode}
                  editableTextRegionKeys={editableTextRegionKeys}
                  draggableSourceIds={draggableSourceIds}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                  onElementDoubleClick={onElementDoubleClick}
                  onHoverChange={onHoverChange}
                />

                <SelectionOverlay
                  marqueeBounds={marqueeBounds}
                  selectionBoxes={selectionBoxes}
                  adornmentHighlightBoxes={adornmentHighlightBoxes}
                  adornmentConnectors={selectedAdornmentConnectors}
                  selectionStrokeWidth={selectionStrokeWidth}
                  textSelectionVisual={textSelectionVisual}
                />

                <SelectionDragLayer
                  toolMode={toolMode}
                  selectionBoxes={selectionBoxes}
                  dragStrokeWidth={selectionDragStrokeWidth}
                  draggableSourceIds={matrixSelectionSourceIds}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                  onElementDoubleClick={onElementDoubleClick}
                />

                <CurveControlOverlay
                  lines={curveControlLines}
                  viewBox={svgResult.viewBox}
                  strokeWidth={curveControlStrokeWidth}
                />

                <NodeAnchorOverlay
                  anchorOverlay={nodeAnchorOverlay}
                  viewBox={svgResult.viewBox}
                  strokeWidth={handleStrokeWidth}
                  radius={handleHalfSize}
                />

                {toolMode === "select" && (
                  <HandleOverlay
                    handleDisplays={handleDisplays}
                    handleHalfSize={handleHalfSize}
                    handleStrokeWidth={handleStrokeWidth}
                    onHandlePointerDown={onHandlePointerDown}
                    onElementPointerDown={onElementPointerDown}
                    onElementContextMenu={onElementContextMenu}
                    onResizeHandlePointerDown={onResizeHandlePointerDown}
                    onRotateHandlePointerDown={onRotateHandlePointerDown}
                  />
                )}
              </svg>
            </div>
          )}

          {magnifierVisible ? (
            <div
              className={css.magnifierOverlay}
              data-testid="canvas-magnifier-shell"
              style={{
                left: magnifierLeft,
                top: magnifierTop,
                width: MAGNIFIER_DIAMETER_PX,
                height: MAGNIFIER_DIAMETER_PX
              }}
            >
              <div
                className={css.magnifierContent}
                style={{
                  width: viewportSize.width,
                  height: viewportSize.height,
                  transform: `translate(${magnifierRadius - magnifierState.x * MAGNIFIER_SCALE}px, ${magnifierRadius - magnifierState.y * MAGNIFIER_SCALE}px) scale(${MAGNIFIER_SCALE})`
                }}
              >
                <div
                  className={css.worldStage}
                  style={{
                    width: svgResult!.viewBox.width * canvasTransform.scale,
                    height: svgResult!.viewBox.height * canvasTransform.scale,
                    transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px)`
                  }}
                >
                  <CanvasSVGLayer
                    model={svgModel}
                    diffHints={svgDiffHints}
                    forceReplaceAll={forceSvgReplaceAll}
                    showTransparencyGrid={showTransparencyGrid}
                    showDocumentBounds={showDocumentBounds}
                    onFallback={onSvgPatchFallback}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {platform.menu?.usesNativeContextMenus ? null : (
            <CanvasContextMenu
              open={contextMenuState != null}
              anchor={{
                x: contextMenuState?.anchorX ?? 0,
                y: contextMenuState?.anchorY ?? 0
              }}
              target={contextMenuState?.target ?? "canvas-empty"}
              bindings={commandRuntimeBindings}
              definition={contextMenuDefinition}
              containerRef={viewportRef}
              onClose={onContextMenuClose}
              onCommandRun={onContextMenuCommandRun}
            />
          )}

          {dragTooltip ? (
            <RenderedTooltip
              open
              anchor={dragTooltip.anchor}
              boundary={dragTooltipBoundary}
              content={
                <div
                  className={css.dragTooltipContent}
                  data-testid="canvas-drag-tooltip"
                  data-drag-tooltip-kind={dragTooltip.kind}
                >
                  {dragTooltip.rows.map((row: any) => (
                    <div
                      key={`${row.label}:${row.value}`}
                      className={css.dragTooltipRow}
                      data-testid="canvas-drag-tooltip-row"
                    >
                      <span className={css.dragTooltipLabel}>{row.label}:</span>
                      <span className={css.dragTooltipValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              }
              className={css.dragTooltip}
              data-testid="canvas-drag-tooltip-shell"
            />
          ) : null}

          {warning && (
            <RenderedTooltip content="Click to copy message" block>
              <div
                className={css.warningBar}
                onClick={copyWarningToClipboard}
                onKeyDown={onWarningBarKeyDown}
                role="button"
                tabIndex={0}
                aria-label="Warning message. Click to copy."
                data-testid="canvas-warning-message"
              >
                {warning}
              </div>
            </RenderedTooltip>
          )}
          {selectionHint ? (
            <div className={css.selectionHint} data-testid="canvas-selection-hint">
              {selectionHint}
            </div>
          ) : null}
          {showDevPanel && (
            <div
              className={css.snapDebugOverlay}
              data-testid="snap-debug-overlay"
              style={{
                left: snapDebugRect.left,
                top: snapDebugRect.top,
                width: snapDebugRect.width,
                height: snapDebugRect.height
              }}
            >
              <div className={css.snapDebugTitle} onPointerDown={onSnapDebugMovePointerDown}>
                Snap Debug (drag to move)
              </div>
              <pre className={css.snapDebugBody}>
                {snapDebug
                  ? JSON.stringify(snapDebug, null, 2)
                  : "Trigger a snap interaction to populate diagnostics."}
              </pre>
              <RenderedTooltip content="Drag to resize">
                <div
                  className={css.snapDebugResizeHandle}
                  onPointerDown={onSnapDebugResizePointerDown}
                />
              </RenderedTooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
