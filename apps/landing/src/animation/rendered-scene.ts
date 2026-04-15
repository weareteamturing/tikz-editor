export function mountRenderedScene(group: SVGGElement, innerSvg: string): void {
  group.innerHTML = innerSvg;
}

export function queryRenderedElement<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector(selector) as T | null;
}
