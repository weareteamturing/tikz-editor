import type gsap from "gsap";
import type { CursorStyle } from "./cursor-overlay";

export type CursorFrame = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  cursor: CursorStyle;
};

export type CursorScript = {
  moveTo: (x: number, y: number, duration?: number, position?: string | number, ease?: string) => CursorScript;
  setFrame: (frame: Partial<CursorFrame>, position?: string | number) => CursorScript;
  setStyle: (cursor: CursorStyle, position?: string | number) => CursorScript;
  setPressed: (pressed: boolean, position?: string | number) => CursorScript;
  setVisible: (visible: boolean, position?: string | number) => CursorScript;
};

export function createCursorScript(
  timeline: gsap.core.Timeline,
  state: CursorFrame,
  commit: () => void
): CursorScript {
  const api: CursorScript = {
    moveTo(x, y, duration = 0.3, position, ease = "power1.inOut") {
      timeline.to(state, { x, y, duration, ease, onUpdate: commit }, position);
      return api;
    },
    setFrame(frame, position) {
      timeline.call(() => {
        Object.assign(state, frame);
        commit();
      }, undefined, position);
      return api;
    },
    setStyle(cursor, position) {
      timeline.call(() => {
        state.cursor = cursor;
        commit();
      }, undefined, position);
      return api;
    },
    setPressed(pressed, position) {
      timeline.call(() => {
        state.pressed = pressed;
        commit();
      }, undefined, position);
      return api;
    },
    setVisible(visible, position) {
      timeline.call(() => {
        state.visible = visible;
        commit();
      }, undefined, position);
      return api;
    }
  };
  return api;
}
