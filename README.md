# TikZ Editor

A visual, WYSIWYG editor for TikZ. Edit diagrams with a graphical interface while keeping full control of the source code.

**Try it:** [tikz.dev/editor](https://tikz.dev/editor)

## Features

- **Visual canvas** with drawing tools: shapes, paths, curves, freehand, Bézier, rectangles, circles, and more
- **Live source editor** with TikZ syntax highlighting, autocompletion, and number scrubbing
- **Two-way sync**: edit visually or in code — changes reflect instantly in both views
- **Export** to SVG, PDF, or PNG
- **Import SVG** and convert to editable TikZ
- **Multi-figure support** for documents with multiple TikZ pictures

## Desktop App

Available for macOS, Windows, and Linux with additional features:

- Native file dialogs and system clipboard integration
- AI assistant for help with TikZ
- Automatic updates

Download from [tikz.dev/editor](https://tikz.dev/editor).

## Supported TikZ Features

The editor supports a wide range of TikZ constructs:

- **Shapes**: 25+ built-in shapes including rectangle, circle, ellipse, diamond, polygon, star, arrows, callouts, and more
- **Paths**: lines, curves, rectangles, circles, arcs, grids
- **Curves**: Bézier curves with control points
- **Trees**: child operations, tree layout, level/sibling styling
- **Matrices**: matrix nodes with cell alignment
- **Loops**: `\foreach` in all forms (statement, path, node)
- **Styling**: colors, line styles, fill patterns, shading, transforms

Some features have partial support (decorations, graphs, plots). Advanced constructs like `let` operations are not yet implemented.

## Getting Started

1. Open the editor at [tikz.dev/editor](https://tikz.dev/editor)
2. Start with the example or write your own TikZ code
3. Use the drawing tools in the toolbar to add and edit elements
4. Export your diagram when ready

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, architecture overview, and contribution guidelines.

## License

MIT
