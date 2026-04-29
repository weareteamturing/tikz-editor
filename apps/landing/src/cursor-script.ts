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
  glideTo: (x: number, y: number, duration?: number, position?: string | number, ease?: string) => CursorScript;
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
      timeline.to(
        state,
        {
          x,
          y,
          duration,
          ease,
          onStart: commitPosition,
          onUpdate: commitPosition,
          onComplete: () => {
            state.x = x;
            state.y = y;
            commitPosition();
          }
        },
        position
      );
      return api;
    },
    glideTo(x, y, duration = 0.42, position, ease = "power2.inOut") {
      return api.moveTo(x, y, duration, position, ease);
    },
    setFrame(frame, position) {
      timeline.call(() => {
        if (!assignCursorPatchIfChanged(state, frame)) {
          return;
        }
        commitFrame();
      }, undefined, position);
      return api;
    },
    setStyle(cursor, position) {
      timeline.call(() => {
        if (state.cursor === cursor) {
          return;
        }
        state.cursor = cursor;
        commitFrame();
      }, undefined, position);
      return api;
    },
    setPressed(pressed, position) {
      timeline.call(() => {
        if (state.pressed === pressed) {
          return;
        }
        state.pressed = pressed;
        commitFrame();
      }, undefined, position);
      return api;
    },
    setVisible(visible, position) {
      timeline.call(() => {
        if (state.visible === visible) {
          return;
        }
        state.visible = visible;
        commitFrame();
      }, undefined, position);
      return api;
    }
  };
  return api;
}

function assignCursorPatchIfChanged(target: CursorFrame, patch: Partial<CursorFrame>): boolean {
  let changed = false;
  if (patch.x !== undefined && target.x !== patch.x) {
    target.x = patch.x;
    changed = true;
  }
  if (patch.y !== undefined && target.y !== patch.y) {
    target.y = patch.y;
    changed = true;
  }
  if (patch.visible !== undefined && target.visible !== patch.visible) {
    target.visible = patch.visible;
    changed = true;
  }
  if (patch.pressed !== undefined && target.pressed !== patch.pressed) {
    target.pressed = patch.pressed;
    changed = true;
  }
  if (patch.cursor !== undefined && target.cursor !== patch.cursor) {
    target.cursor = patch.cursor;
    changed = true;
  }
  return changed;
}
