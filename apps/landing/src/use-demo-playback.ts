import { RefObject, useEffect, useState } from "react";

export function useDemoPlayback(targetRef: RefObject<Element | null>): boolean {
  const [playbackEnabled, setPlaybackEnabled] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updatePlayback = (inView: boolean): void => {
      setPlaybackEnabled(inView && !mediaQuery.matches);
    };

    let isInView = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isInView = entry?.isIntersecting ?? false;
        updatePlayback(isInView);
      },
      {
        rootMargin: "120px 0px"
      }
    );

    const handleMotionChange = (): void => {
      updatePlayback(isInView);
    };

    observer.observe(target);
    mediaQuery.addEventListener("change", handleMotionChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleMotionChange);
    };
  }, [targetRef]);

  return playbackEnabled;
}
