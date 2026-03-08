# MathJax Fake Edit Prototype

Small standalone experiment for faking an editable experience over MathJax SVG output.

## What it does

- Uses a `textarea` for source input.
- Flows source into a fixed-width box, wrapping into multiple rendered SVG lines.
- Renders with `MathJax.tex2svg(..., { display: false })`.
- Draws a fake caret (collapsed selection) or per-line selection rectangles on top of the SVG output.
- Supports clicking inside rendered SVG to place the caret in the textarea (approximate hit mapping).
- Supports drag-to-select directly in rendered SVG.
- Supports double-click word selection in rendered SVG.
- Builds/stores prefix-width tables per source text so caret/selection updates do not remeasure on every cursor move.
- Prefix measurement uses a TeX-stabilization pass (discharging trailing `\`, balancing `{}`, closing `\left` with `\right.`, patching dangling `^/_` with `{}`, and closing open `$` or `\(` math) to keep more partial prefixes renderable.
- Prefix logic is extracted to `/Users/dominik/GitHub/tikz-editor/prototypes/mathjax-fake-edit/prefix-logic.js` so it can be reused from browser code and tested in Node.

## Run

Serve this folder with any static server, then open `index.html`.

Example:

```sh
cd /Users/dominik/GitHub/tikz-editor/prototypes/mathjax-fake-edit
python3 -m http.server 4173
```

Then visit [http://localhost:4173](http://localhost:4173).

## Node tests

```sh
cd /Users/dominik/GitHub/tikz-editor
node --test /Users/dominik/GitHub/tikz-editor/prototypes/mathjax-fake-edit/prefix-logic.node.test.mjs
```

## Notes

- Caret/selection positioning is approximate and intentionally prototype-level.
- Prefix measurement can fail for syntactically incomplete TeX fragments; this falls back to proportional placement.
