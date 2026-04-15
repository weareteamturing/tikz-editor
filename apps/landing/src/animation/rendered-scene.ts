export function mountRenderedScene(group: SVGGElement, innerSvg: string): void {
  group.innerHTML = innerSvg;
}

export function queryRenderedElement<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector(selector) as T | null;
}

export function wrapRenderedElements(elements: Element[], className?: string): SVGGElement | null {
  const [first] = elements;
  if (!first?.parentNode) {
    return null;
  }

  const namespace = first.namespaceURI ?? "http://www.w3.org/2000/svg";
  const wrapper = document.createElementNS(namespace, "g") as SVGGElement;
  if (className) {
    wrapper.setAttribute("class", className);
  }

  first.parentNode.insertBefore(wrapper, first);
  elements.forEach((element) => {
    wrapper.appendChild(element);
  });
  return wrapper;
}
