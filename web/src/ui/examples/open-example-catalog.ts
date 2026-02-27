export type TikzOpenExample = {
  id: string;
  title: string;
  description: string;
  source: string;
  featureLabels: string[];
};

export const OPEN_EXAMPLE_CATALOG: readonly TikzOpenExample[] = [
  {
    id: "basic-paths-grid",
    title: "Basic Paths and Grid",
    description: "Mixed path operators with a visible construction grid.",
    featureLabels: ["grid", "paths", "arrows"],
    source: String.raw`\begin{tikzpicture}
  \draw[help lines, step=1cm, gray!45] (-0.5,-0.5) grid (4.5,2.5);
  \draw[thick, ->] (0,0) -- (1.5,1.5) -| (3,0.5) |- (4,2);
  \draw[blue, line width=0.8pt] (0,2) -- (2,1) -- (4,2);
\end{tikzpicture}`
  },
  {
    id: "styled-nodes-flow",
    title: "Styled Node Flow",
    description: "Named nodes, shared styles, and directional edges.",
    featureLabels: ["nodes", "styles", "edges"],
    source: String.raw`\begin{tikzpicture}[
  task/.style={draw,rounded corners=2pt,fill=blue!12,minimum width=2.2cm,minimum height=8mm,align=center},
  >=Stealth
]
  \node[task] (start) at (0,0) {Start};
  \node[task] (parse) at (3,0) {Parse};
  \node[task] (render) at (6,0) {Render};
  \node[task,fill=green!15] (done) at (3,-1.8) {Done};
  \draw[->,thick] (start) -- (parse);
  \draw[->,thick] (parse) -- (render);
  \draw[->,thick] (parse) -- (done);
\end{tikzpicture}`
  },
  {
    id: "scope-transform",
    title: "Scope Transform",
    description: "A transformed scope with translation and rotation.",
    featureLabels: ["scope", "transform", "rotation"],
    source: String.raw`\begin{tikzpicture}
  \draw[gray!60] (-2,-1.5) rectangle (2,1.5);
  \begin{scope}[xshift=0.9cm,yshift=0.4cm,rotate=18]
    \draw[thick,red] (-1.2,-0.8) rectangle (1.2,0.8);
    \draw[thick,blue] (-1.2,-0.8) -- (1.2,0.8);
    \draw[thick,blue] (-1.2,0.8) -- (1.2,-0.8);
  \end{scope}
\end{tikzpicture}`
  },
  {
    id: "foreach-radial",
    title: "Foreach Radial Pattern",
    description: "Loop-generated radial spokes with concentric circles.",
    featureLabels: ["foreach", "polar", "circles"],
    source: String.raw`\begin{tikzpicture}
  \foreach \angle in {0,30,60,90,120,150,180,210,240,270,300,330} {
    \draw[blue!45] (0,0) -- (\angle:2.1cm);
  }
  \foreach \r in {0.7,1.4,2.1} {
    \draw[gray!65] (0,0) circle [radius=\r cm];
  }
  \fill[red!70] (0,0) circle [radius=1.6pt];
\end{tikzpicture}`
  },
  {
    id: "matrix-of-nodes",
    title: "Matrix of Nodes",
    description: "A small matrix with connections across cells.",
    featureLabels: ["matrix", "nodes", "arrows"],
    source: String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
    nodes={draw,minimum width=12mm,minimum height=8mm,fill=orange!12},
    row sep=4mm,
    column sep=6mm
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
  \draw[->,thick] (m-1-1) -- (m-2-2);
  \draw[->,thick] (m-1-3) -- (m-2-2);
\end{tikzpicture}`
  },
  {
    id: "tree-layout",
    title: "Tree Layout",
    description: "Child-based tree with layout keys and styled nodes.",
    featureLabels: ["trees", "child", "layout"],
    source: String.raw`\begin{tikzpicture}[grow=right,level distance=15mm,sibling distance=10mm]
  \path
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`
  },
  {
    id: "shape-sampler",
    title: "Shape Sampler",
    description: "Stable built-in node shapes in one compact preview.",
    featureLabels: ["shapes", "nodes", "styles"],
    source: String.raw`\begin{tikzpicture}[every node/.style={draw,minimum width=14mm,minimum height=8mm,align=center,fill=teal!8}]
  \node[diamond] at (0,0) {Diamond};
  \node[trapezium,trapezium left angle=70,trapezium right angle=110] at (3,0) {Trap};
  \node[star,star points=6,star point ratio=1.7] at (0,-2.1) {Star};
  \node[cloud,cloud puffs=10] at (3,-2.1) {Cloud};
\end{tikzpicture}`
  },
  {
    id: "arc-and-cycle",
    title: "Arc and Cycle",
    description: "Arc segments combined with a cycle-filled sector.",
    featureLabels: ["arc", "cycle", "fill"],
    source: String.raw`\begin{tikzpicture}
  \draw[fill=cyan!18,draw=cyan!60!black,thick]
    (0,0) -- (2,0) arc[start angle=0,end angle=70,radius=2cm] -- cycle;
  \draw[thick,->] (2.5,0) arc[start angle=0,end angle=220,radius=1.1cm];
  \draw[gray!70] (-0.2,-0.2) rectangle (3.8,2.4);
\end{tikzpicture}`
  }
];
