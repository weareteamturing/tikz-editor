import type gsap from "gsap";

export type SvgAttrs = Record<string, string | number>;

export function setSvgAttrs(target: Element, attrs: SvgAttrs): void {
  Object.entries(attrs).forEach(([name, value]) => {
    target.setAttribute(name, String(value));
  });
}

export function toSvgAttrs(
  timeline: gsap.core.Timeline,
  target: Element,
  attrs: SvgAttrs,
  duration: number,
  position?: gsap.Position,
  ease = "power1.inOut"
): void {
  timeline.to(target, { attr: attrs, duration, ease }, position);
}

export function toTranslate(
  timeline: gsap.core.Timeline,
  target: Element,
  x: number,
  y: number,
  duration: number,
  position?: gsap.Position,
  ease = "power1.inOut"
): void {
  timeline.to(target, { x, y, duration, ease }, position);
}

export function toSvgRotation(
  timeline: gsap.core.Timeline,
  target: Element,
  rotation: number,
  svgOrigin: string,
  duration: number,
  position?: gsap.Position,
  ease = "power1.inOut"
): void {
  timeline.to(target, { rotation, svgOrigin, duration, ease }, position);
}
