import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { collectDetectedColors, resolveDeclaredColors, type DetectedColorOccurrence } from "./source-color-detection";

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

      constructor(private readonly view: EditorView) {
        this.decorations = this.buildDecorations();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations();
        }
      }

      private buildDecorations(): DecorationSet {
        const source = this.view.state.doc.toString();
        const tree = syntaxTree(this.view.state);
        const declaredColors = resolveDeclaredColors(source, tree);
        const occurrences = collectDetectedColors(
          source,
          tree,
          this.view.visibleRanges,
          declaredColors
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
