import { useEffect, useRef, useState, type ComponentType } from "react";
import appScreenshotUrl from "../../../background-materials/app-screenshot.png";

type DeferredSectionsComponent = ComponentType;

export function App() {
  const [DeferredSections, setDeferredSections] = useState<DeferredSectionsComponent | null>(null);
  const loadTriggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trigger = loadTriggerRef.current;
    if (!trigger || DeferredSections) {
      return;
    }

    let cancelled = false;
    const loadSections = (): void => {
      void import("./DeferredSections").then((module) => {
        if (!cancelled) {
          setDeferredSections(() => module.DeferredSections);
        }
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      loadSections();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }
        observer.disconnect();
        loadSections();
      },
      {
        rootMargin: "640px 0px"
      }
    );

    observer.observe(trigger);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [DeferredSections]);

  return (
    <div className="tikzDevPage">
      <header className="tikzDevHeader">
        <div className="tikzDevHamburger" aria-hidden="true">☰</div>
        <strong>
          <a href="https://tikz.dev" className="tikzDevParentLink">tikz.dev / </a>
          <a href="/editor">TikZ Editor</a>
        </strong>
      </header>
      <main className="landingPage">
        <Hero />
        <div ref={loadTriggerRef} className="deferredSectionsTrigger" aria-hidden="true" />
        {DeferredSections ? <DeferredSections /> : null}
      </main>
    </div>
  );
}

function Hero() {
  return (
    <section className="heroSection">
      <div className="heroCopy">
        <p className="eyebrow">TikZ Editor</p>
        <h1>TikZ Editor</h1>
        <p className="heroLead">A visual editor for TikZ diagrams.</p>
        <p className="heroText">
          Move nodes, draw paths, adjust styles, and edit the TikZ source in the same workspace.
        </p>
        <div className="heroActions" aria-label="Landing page links">
          <a href="/" className="textLink">Open app</a>
          <a href="https://github.com/DominikPeters/tikz-editor" className="textLink">GitHub</a>
          <a href="#capabilities" className="textLink">Download</a>
        </div>
      </div>
      <figure className="heroScreenshotFrame">
        <img src={appScreenshotUrl} alt="TikZ Editor interface with source, canvas, and inspector" />
      </figure>
    </section>
  );
}
