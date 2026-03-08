import type { Tree } from "@lezer/common";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { parser } from "tikz-editor/syntax/grammar/tikz-parser";
import { collectDeclaredColors, collectDetectedColors, type DetectedColorOccurrence } from "./source-color-detection";

export type ColorSwatchPickRequest = {
  occurrence: DetectedColorOccurrence;
  anchorRect: DOMRectReadOnly;
};

export type ColorSwatchesOptions = {
  onPickRequest?: (request: ColorSwatchPickRequest) => void;
};

class ColorSwatchWidget extends WidgetType {
  constructor(
    private readonly occurrence: DetectedColorOccurrence,
    private readonly onPickRequest: ColorSwatchesOptions["onPickRequest"]
  ) {
    super();
  }

  eq(other: ColorSwatchWidget): boolean {
    return (
      this.occurrence.from === other.occurrence.from &&
      this.occurrence.to === other.occurrence.to &&
      this.occurrence.token === other.occurrence.token &&
      this.occurrence.cssColor === other.occurrence.cssColor &&
      this.occurrence.editable === other.occurrence.editable &&
      this.occurrence.source === other.occurrence.source
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "cm-inline-color-swatch";
    if (this.occurrence.cssColor == null) {
      dom.classList.add("cm-inline-color-swatch-none");
    } else {
      dom.style.backgroundColor = this.occurrence.cssColor;
    }

    if (!this.occurrence.editable) {
      dom.classList.add("cm-inline-color-swatch-readonly");
      dom.title = this.occurrence.readOnlyReason ?? "Color preview";
    } else {
      dom.title = `Edit color: ${this.occurrence.token}`;
    }

    dom.setAttribute("aria-hidden", "true");
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    dom.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.occurrence.editable || !this.onPickRequest) {
        return;
      }
      this.onPickRequest({
        occurrence: this.occurrence,
        anchorRect: dom.getBoundingClientRect()
      });
    });

    return dom;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function colorSwatches(options: ColorSwatchesOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private source: string;
      private tree: Tree;
      private declaredColors: ReadonlyMap<string, string>;

      constructor(private readonly view: EditorView) {
        this.source = this.view.state.doc.toString();
        this.tree = parser.parse(this.source);
        this.declaredColors = collectDeclaredColors(this.source, this.tree);
        this.decorations = this.buildDecorations();
      }

      update(update: ViewUpdate): void {
        let shouldRebuildDecorations = false;

        if (update.docChanged) {
          this.source = update.state.doc.toString();
          this.tree = parser.parse(this.source);
          this.declaredColors = collectDeclaredColors(this.source, this.tree);
          shouldRebuildDecorations = true;
        }

        if (update.viewportChanged) {
          shouldRebuildDecorations = true;
        }

        if (shouldRebuildDecorations) {
          this.decorations = this.buildDecorations();
        }
      }

      private buildDecorations(): DecorationSet {
        const occurrences = collectDetectedColors(
          this.source,
          this.tree,
          this.view.visibleRanges,
          this.declaredColors
        );
        if (occurrences.length === 0) {
          return Decoration.none;
        }

        return Decoration.set(
          occurrences.map((occurrence) =>
            Decoration.widget({
              widget: new ColorSwatchWidget(occurrence, options.onPickRequest),
              side: -1
            }).range(occurrence.from)
          ),
          true
        );
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
