import type { EditHandle, Point, SceneElement, ScenePath } from "tikz-editor/semantic/types";

export type CurveControlLine = {
  key: string;
  sourceId: string;
  from: Point;
  to: Point;
};

export function deriveCurveControlLines(
  elements: readonly SceneElement[],
  selectedSourceIds: ReadonlySet<string>,
  editHandles: readonly EditHandle[]
): CurveControlLine[] {
  const selectedSourcesWithControlHandles = new Set<string>();
  for (const handle of editHandles) {
    if (handle.kind !== "path-control" || !selectedSourceIds.has(handle.sourceId)) {
      continue;
    }
    selectedSourcesWithControlHandles.add(handle.sourceId);
  }
  if (selectedSourcesWithControlHandles.size === 0) {
    return [];
  }

  const lines: CurveControlLine[] = [];
  for (const element of elements) {
    if (element.kind !== "Path" || !selectedSourcesWithControlHandles.has(element.sourceId)) {
      continue;
    }
    lines.push(...collectControlLinesFromPath(element));
  }
  return lines;
}

function collectControlLinesFromPath(path: ScenePath): CurveControlLine[] {
  const lines: CurveControlLine[] = [];
  let current: Point | null = null;
  let subpathStart: Point | null = null;

  path.commands.forEach((command, commandIndex) => {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      return;
    }

    if (command.kind === "Z") {
      if (subpathStart) {
        current = subpathStart;
      }
      return;
    }

    if (!current) {
      current = command.to;
      return;
    }

    if (command.kind === "C") {
      lines.push(
        {
          key: `curve-control:${path.id}:${commandIndex}:start`,
          sourceId: path.sourceId,
          from: current,
          to: command.c1
        },
        {
          key: `curve-control:${path.id}:${commandIndex}:end`,
          sourceId: path.sourceId,
          from: command.to,
          to: command.c2
        }
      );
    }

    current = command.to;
  });

  return lines;
}
