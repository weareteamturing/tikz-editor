import { useEffect } from "react";
import type { TikzOpenExample } from "./examples/open-example-catalog";
import { GENERATED_OPEN_EXAMPLE_PREVIEWS } from "./examples/generated-open-example-previews";
import css from "./OpenExampleModal.module.css";

type OpenExampleModalProps = {
  examples: readonly TikzOpenExample[];
  onClose: () => void;
  onSelectExample: (example: TikzOpenExample) => void;
};

export function OpenExampleModal({ examples, onClose, onSelectExample }: OpenExampleModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={css.backdrop} onMouseDown={onClose}>
      <div
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-example-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={css.header}>
          <div>
            <h2 id="open-example-title" className={css.title}>Open Example</h2>
            <p className={css.subtitle}>Pick a TikZ snippet to load into the editor.</p>
          </div>
          <button type="button" className={css.closeBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <div className={css.grid}>
          {examples.map((example) => {
            const preview = GENERATED_OPEN_EXAMPLE_PREVIEWS[example.id] ?? null;
            const hasPreview = Boolean(preview?.svg);
            return (
              <button
                key={example.id}
                type="button"
                className={css.card}
                onClick={() => onSelectExample(example)}
              >
                <div className={css.previewFrame}>
                  {hasPreview ? (
                    <div
                      className={css.previewSvg}
                      dangerouslySetInnerHTML={{ __html: preview?.svg ?? "" }}
                    />
                  ) : (
                    <div className={css.previewFallback}>
                      <span>Preview unavailable</span>
                    </div>
                  )}
                </div>

                <div className={css.content}>
                  <h3 className={css.cardTitle}>{example.title}</h3>
                  <p className={css.cardDescription}>{example.description}</p>
                  <div className={css.tags}>
                    {example.featureLabels.map((label) => (
                      <span key={`${example.id}:${label}`} className={css.tag}>{label}</span>
                    ))}
                  </div>
                  {preview && (preview.errorCount > 0 || preview.warningCount > 0) ? (
                    <p className={css.diagnostics}>
                      {preview.errorCount} error{preview.errorCount === 1 ? "" : "s"}
                      {" · "}
                      {preview.warningCount} warning{preview.warningCount === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
