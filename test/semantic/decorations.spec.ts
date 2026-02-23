import { describe, expect, it } from "vitest";

import {
  evaluateSemantic,
  firstElementOfKind,
  elementsOfKind
} from "./helpers.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../../src/semantic/types.js";

describe("semantic evaluator / decorations", () => {
    it("supports decorate option and decoration key without generic unsupported diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=zigzag] (0,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:decoration")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:decorate")).toBe(false);
      expect(result.featureUsage.decorate_option).toBe("used-supported");
    });

    it("treats decorate path operation and decorate option as equivalent for basic paths", () => {
      const operationSource = String.raw`\begin{tikzpicture}
    \draw decorate[decoration=zigzag] {(0,0) -- (2,0)};
  \end{tikzpicture}`;
      const optionSource = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=zigzag] (0,0) -- (2,0);
  \end{tikzpicture}`;
  
      const opResult = evaluateSemantic(operationSource);
      const optionResult = evaluateSemantic(optionSource);
      const opPath = firstElementOfKind(opResult.scene.elements, "Path");
      const optionPath = firstElementOfKind(optionResult.scene.elements, "Path");
  
      expect(opPath?.kind).toBe("Path");
      expect(optionPath?.kind).toBe("Path");
      if (opPath?.kind === "Path" && optionPath?.kind === "Path") {
        expect(opPath.commands.length).toBe(optionPath.commands.length);
      }
      expect(opResult.featureUsage.decorate_operation).toBe("used-supported");
    });

    it("supports core decoration families without unsupported decoration-name diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=snake] (0,0) -- (2,0);
    \draw[decorate,decoration=brace] (0,-0.5) -- (2,-0.5);
    \draw[decorate,decoration={ticks,segment length=8pt}] (0,-1) -- (2,-1);
    \draw[decorate,decoration={crosses,shape size=4pt}] (0,-1.5) -- (2,-1.5);
    \draw[decorate,decoration={Koch snowflake}] (0,-2) -- (2,-2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedDecorationDiagnostics = result.diagnostics.filter((diagnostic) =>
        (diagnostic.code ?? "").startsWith("unsupported-decoration-name:")
      );
      expect(unsupportedDecorationDiagnostics).toHaveLength(0);
      expect(result.featureUsage.decoration_pathmorphing).toBe("used-supported");
      expect(result.featureUsage.decoration_pathreplacing).toBe("used-supported");
      expect(result.featureUsage.decoration_shape_marks).toBe("used-supported");
      expect(result.featureUsage.decoration_fractals).toBe("used-supported");
    });

    it("does not decorate node borders from statement-level decorate", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw decorate [decoration={name=zigzag}]
      { (0,0) -- (2,2) node [left,draw=red] {Hi!} };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBorder = result.scene.elements.find(
        (element) => element.kind === "Path" && element.id.startsWith("scene-node-box:") && element.style.stroke === "#ff0000"
      );
      expect(nodeBorder?.kind).toBe("Path");
      if (nodeBorder?.kind === "Path") {
        expect(nodeBorder.commands.some((command) => command.kind === "Z")).toBe(true);
        expect(nodeBorder.commands.length).toBeLessThanOrEqual(6);
      }
    });

    it("decorates node outlines when decorate is set on the node options", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[fill=red!20,draw,decorate,decoration={bumps,mirror},minimum height=1cm]{Bumpy};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const decoratedNodeOutline = result.scene.elements.find(
        (element) => element.kind === "Path" && element.style.fill === "#ffcccc" && element.id.includes(":decorated:")
      );
      expect(decoratedNodeOutline?.kind).toBe("Path");
      if (decoratedNodeOutline?.kind === "Path") {
        expect(decoratedNodeOutline.commands.length).toBeGreaterThan(20);
      }
      expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("unsupported-decoration-name:"))).toBe(false);
    });

    it("applies transform={shift only} for crosses without tangent rotation", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[red,very thick] decorate [decoration={crosses,transform={shift only},shape size=2mm}] {(0,0) -- (1,1)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const path = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke === "#ff0000");
  
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.length).toBeGreaterThanOrEqual(4);
        const m1 = path.commands[0];
        const l1 = path.commands[1];
        const m2 = path.commands[2];
        const l2 = path.commands[3];
        expect(m1?.kind).toBe("M");
        expect(l1?.kind).toBe("L");
        expect(m2?.kind).toBe("M");
        expect(l2?.kind).toBe("L");
        if (m1?.kind === "M" && l1?.kind === "L" && m2?.kind === "M" && l2?.kind === "L") {
          const slope1 = (l1.to.y - m1.to.y) / (l1.to.x - m1.to.x);
          const slope2 = (l2.to.y - m2.to.y) / (l2.to.x - m2.to.x);
          expect(Math.abs(Math.abs(slope1) - 1)).toBeLessThan(0.2);
          expect(Math.abs(Math.abs(slope2) - 1)).toBeLessThan(0.2);
        }
      }
    });

    it("decorates ellipse node borders when decorate is set on the node", () => {
      const source = String.raw`\begin{tikzpicture}[decoration=zigzag]
    \node at (1.5,2.5) [fill=red!20,decorate,ellipse] {Ellipse};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const decoratedEllipse = result.scene.elements.find(
        (element) => element.kind === "Path" && element.style.fill === "#ffcccc" && element.id.includes(":decorated:")
      );
      expect(decoratedEllipse?.kind).toBe("Path");
      if (decoratedEllipse?.kind === "Path") {
        expect(decoratedEllipse.commands.length).toBeGreaterThan(20);
      }
    });
});
