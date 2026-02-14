import type { PathCommand } from "../../ast/types.js";
import type { ResolvedStyle } from "../types.js";
import {
  COLOR_HEX,
  DEFAULT_AXIS_BOTTOM_COLOR,
  DEFAULT_AXIS_MIDDLE_COLOR,
  DEFAULT_AXIS_TOP_COLOR,
  DEFAULT_BALL_COLOR,
  DEFAULT_DOUBLE_DISTANCE,
  DEFAULT_RADIAL_INNER_COLOR,
  DEFAULT_RADIAL_OUTER_COLOR,
  DEFAULT_TEXT_FONT_SIZE
} from "./constants.js";
import { cloneArrowMarker, makeDefaultArrowMarker } from "./arrows.js";

export function defaultStyle(): ResolvedStyle {
  const defaultTip = makeDefaultArrowMarker("to");
  return {
    stroke: "black",
    fill: null,
    fillRule: "nonzero",
    textColor: null,
    textOpacity: 1,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontStyle: "normal",
    doubleStroke: false,
    doubleDistance: DEFAULT_DOUBLE_DISTANCE,
    textAlign: "center",
    drawExplicit: false,
    radius: null,
    xRadius: null,
    yRadius: null,
    roundedCorners: null,
    lineWidth: 0.4,
    dashArray: null,
    dashOffset: 0,
    lineCap: "butt",
    lineJoin: "miter",
    markerStart: null,
    markerEnd: null,
    arrowShorthandStart: cloneArrowMarker(defaultTip),
    arrowShorthandEnd: cloneArrowMarker(defaultTip),
    tipsMode: "on draw",
    opacity: 1,
    strokeOpacity: 1,
    fillOpacity: 1,
    shadeEnabled: false,
    shading: "axis",
    shadingAngle: 0,
    axisTopColor: DEFAULT_AXIS_TOP_COLOR,
    axisMiddleColor: DEFAULT_AXIS_MIDDLE_COLOR,
    axisBottomColor: DEFAULT_AXIS_BOTTOM_COLOR,
    radialInnerColor: DEFAULT_RADIAL_INNER_COLOR,
    radialOuterColor: DEFAULT_RADIAL_OUTER_COLOR,
    ballColor: DEFAULT_BALL_COLOR,
    bilinearLowerLeft: COLOR_HEX.white,
    bilinearLowerRight: COLOR_HEX.white,
    bilinearUpperLeft: COLOR_HEX.white,
    bilinearUpperRight: COLOR_HEX.white,
    shadowScale: 1,
    shadowXShift: 0,
    shadowYShift: 0,
    shadowFade: "none",
    everyShadowStyles: [],
    shadowLayers: []
  };
}

export function commandDefaultStyle(command: PathCommand, inheritedStyle: ResolvedStyle): Partial<ResolvedStyle> {
  switch (command) {
    case "draw":
      return {
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "path":
      return {
        stroke: null,
        fill: null,
        drawExplicit: false,
        shadeEnabled: false
      };
    case "pattern":
      return {
        fill: inheritedStyle.fill ?? "black",
        shadeEnabled: false
      };
    case "shade":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.drawExplicit ? inheritedStyle.stroke ?? "black" : null,
        shadeEnabled: true
      };
    case "shadedraw":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true,
        shadeEnabled: true
      };
    case "fill":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.drawExplicit ? inheritedStyle.stroke ?? "black" : null
      };
    case "filldraw":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "clip":
    case "useasboundingbox":
      return {
        stroke: null,
        fill: null,
        drawExplicit: false,
        shadeEnabled: false
      };
    case "node":
    case "coordinate":
      return {};
    default:
      return {};
  }
}

export { DEFAULT_TEXT_FONT_SIZE };
