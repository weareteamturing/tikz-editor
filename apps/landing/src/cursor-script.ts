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

export type CursorCommitters = {
  onPositionChange?: () => void;
  onFrameChange?: () => void;
};

export function createCursorScript(
  timeline: gsap.core.Timeline,
  state: CursorFrame,
  committers: CursorCommitters
): CursorScript {
  const commitPosition = (): void => {
    committers.onPositionChange?.();
  };
  const commitFrame = (): void => {
    committers.onFrameChange?.();
  };

  const api: CursorScript = {
    moveTo(x, y, duration = 0.3, position, ease = "power1.inOut") {
      timeline.to(state, { x, y, duration, ease, onUpdate: commitPosition }, position);
      return api;
    },
    setFrame(frame, position) {
      timeline.call(() => {
        Object.assign(state, frame);
        commitFrame();
      }, undefined, position);
      return api;
    },
    setStyle(cursor, position) {
      timeline.call(() => {
        state.cursor = cursor;
        commitFrame();
      }, undefined, position);
      return api;
    },
    setPressed(pressed, position) {
      timeline.call(() => {
        state.pressed = pressed;
        commitFrame();
      }, undefined, position);
      return api;
    },
    setVisible(visible, position) {
      timeline.call(() => {
        state.visible = visible;
        commitFrame();
      }, undefined, position);
      return api;
    }
  };
  return api;
}
