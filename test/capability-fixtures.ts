export const capabilityFixtures: Record<string, string> = {
  basic_draw: String.raw`\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (1,1) -| (2,0) |- (3,1);
\end{tikzpicture}`,
  scope_transform: String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm,yshift=2cm,rotate=10]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`,
  foreach_basic: String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw (\x,0) -- ++(1,0);
\end{tikzpicture}`,
  unknown_statement: String.raw`\begin{tikzpicture}
  \foo bar;
\end{tikzpicture}`,
  option_styles: String.raw`\begin{tikzpicture}
  \draw[red,fill=blue,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`,
  curve_operator: String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\end{tikzpicture}`,
  cycle_polygon: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`,
  rectangle_shape: String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`,
  circle_shape: String.raw`\begin{tikzpicture}
  \draw (0,0) circle [radius=1cm];
\end{tikzpicture}`,
  coordinate_operation: String.raw`\begin{tikzpicture}
  \path coordinate (p1) at (1,0);
  \draw (0,0) -- (p1);
\end{tikzpicture}`,
  to_operation: String.raw`\begin{tikzpicture}
  \draw (0,0) to (1,1);
\end{tikzpicture}`,
  svg_operation: String.raw`\begin{tikzpicture}
  \draw (0,0) svg {h 10 v 10 h -10};
\end{tikzpicture}`,
  let_operation: String.raw`\begin{tikzpicture}
  \path let \p1 = (1,1) in (0,0) -- (\p1);
\end{tikzpicture}`,
  ellipse_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm,y radius=0.5cm];
\end{tikzpicture}`,
  arc_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) arc [start angle=0,end angle=90,radius=1cm];
\end{tikzpicture}`,
  grid_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`,
  node_text: String.raw`\begin{tikzpicture}
  \node at (1,1) {Hello};
\end{tikzpicture}`
};

