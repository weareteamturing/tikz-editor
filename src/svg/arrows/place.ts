import type { Point, ScenePathCommand } from "../../semantic/types.js";
import { addPoint, scaleVector } from "./path-sampler.js";
import type { Frame } from "./types.js";

export function placeLocalPathsRigid(localPaths: ScenePathCommand[][], frame: Frame, offset: number): ScenePathCommand[][] {
  return localPaths.map((path) =>
    transformLocalPath(path, (point) => {
      const x = offset + point.x;
      return addPoint(frame.point, addPoint(scaleVector(frame.tangent, x), scaleVector(frame.normal, point.y)));
    })
  );
}

export function placeLocalPathsBent(localPaths: ScenePathCommand[][], offset: number, frameAtOffset: (x: number) => Frame): ScenePathCommand[][] {
  return localPaths.map((path) =>
    transformLocalPath(path, (point) => {
      const x = offset + point.x;
      const frame = frameAtOffset(x);
      return addPoint(frame.point, scaleVector(frame.normal, point.y));
    })
  );
}

function transformLocalPath(path: ScenePathCommand[], mapPoint: (point: Point) => Point): ScenePathCommand[] {
  return path.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      return { kind: command.kind, to: mapPoint(command.to) };
    }
    if (command.kind === "C") {
      return {
        kind: "C",
        c1: mapPoint(command.c1),
        c2: mapPoint(command.c2),
        to: mapPoint(command.to)
      };
    }
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: mapPoint(command.to)
    };
  });
}
