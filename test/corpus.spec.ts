import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectTikzSnippetsFromDocs } from "../src/corpus/extract.js";
import { parseTikz } from "../src/parser/index.js";

describe("pgf-docs corpus regression", () => {
  const docsRoot = join(process.cwd(), "pgf-docs");

  const testCase = existsSync(docsRoot) ? it : it.skip;

  testCase("extracts snippets and tracks parse quality metrics", () => {
    const snippets = collectTikzSnippetsFromDocs(docsRoot);
    const tikzPictureSnippets = snippets.filter((snippet) => snippet.kind === "tikzpicture");
    const tikzInlineSnippets = snippets.filter((snippet) => snippet.kind === "tikz-inline");

    const diagnosticCounts = new Map<string, number>();
    const recoveryByFile = new Map<string, number>();
    const hardFailures: Array<{ filePath: string; startLine: number; message: string }> = [];

    let parsedClean = 0;
    let parsedWithRecovery = 0;
    let snippetsWithPathStatements = 0;
    let snippetsWithNodeItems = 0;
    let snippetsWithCoordinateItems = 0;
    let snippetsAllUnknownStatements = 0;

    let totalStatements = 0;
    let pathStatements = 0;
    let unknownStatements = 0;
    let totalPathItems = 0;
    let coordinateItems = 0;
    let nodeItems = 0;
    let commentItems = 0;
    let optionItems = 0;
    let keywordItems = 0;
    let toOperationItems = 0;
    let svgOperationItems = 0;
    let letOperationItems = 0;
    let coordinateOperationItems = 0;
    let unknownPathItems = 0;

    for (const snippet of tikzPictureSnippets) {
      try {
        const result = parseTikz(snippet.source, { recover: true });
        const hasParseError = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

        if (hasParseError) {
          parsedWithRecovery += 1;
          increment(recoveryByFile, snippet.filePath);
        } else {
          parsedClean += 1;
        }

        let hasPathStatement = false;
        let hasNodeItem = false;
        let hasCoordinateItem = false;
        let allUnknown = result.figure.body.length > 0;

        totalStatements += result.figure.body.length;

        for (const statement of result.figure.body) {
          if (statement.kind === "Path") {
            hasPathStatement = true;
            allUnknown = false;
            pathStatements += 1;
            totalPathItems += statement.items.length;

            for (const item of statement.items) {
              if (item.kind === "Coordinate") {
                hasCoordinateItem = true;
                coordinateItems += 1;
              } else if (item.kind === "Node") {
                hasNodeItem = true;
                nodeItems += 1;
              } else if (item.kind === "PathComment") {
                commentItems += 1;
              } else if (item.kind === "PathOption") {
                optionItems += 1;
              } else if (item.kind === "PathKeyword") {
                keywordItems += 1;
              } else if (item.kind === "ToOperation") {
                toOperationItems += 1;
              } else if (item.kind === "SvgOperation") {
                svgOperationItems += 1;
              } else if (item.kind === "LetOperation") {
                letOperationItems += 1;
              } else if (item.kind === "CoordinateOperation") {
                coordinateOperationItems += 1;
              } else {
                unknownPathItems += 1;
              }
            }
          } else {
            unknownStatements += 1;
          }
        }

        if (hasPathStatement) {
          snippetsWithPathStatements += 1;
        }
        if (hasNodeItem) {
          snippetsWithNodeItems += 1;
        }
        if (hasCoordinateItem) {
          snippetsWithCoordinateItems += 1;
        }
        if (allUnknown) {
          snippetsAllUnknownStatements += 1;
        }

        for (const diagnostic of result.diagnostics) {
          increment(diagnosticCounts, diagnostic.code ?? diagnostic.message);
        }
      } catch (error) {
        hardFailures.push({
          filePath: snippet.filePath,
          startLine: snippet.startLine,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const topDiagnosticCodes = [...diagnosticCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    const topRecoveryFiles = [...recoveryByFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([filePath, count]) => ({ filePath, count }));

    const snapshot = {
      extraction: {
        filesScanned: new Set(snippets.map((snippet) => snippet.filePath)).size,
        totalSnippets: snippets.length,
        tikzPictureSnippets: tikzPictureSnippets.length,
        tikzInlineSnippets: tikzInlineSnippets.length,
        incompleteSnippets: snippets.filter((snippet) => snippet.incomplete).length
      },
      parse: {
        parsedClean,
        parsedWithRecovery,
        failedHard: hardFailures.length,
        recoverableRate: tikzPictureSnippets.length === 0 ? 0 : Number((parsedWithRecovery / tikzPictureSnippets.length).toFixed(4))
      },
      semanticCoverage: {
        snippetsWithPathStatements,
        snippetsWithNodeItems,
        snippetsWithCoordinateItems,
        snippetsAllUnknownStatements,
        snippetPathCoverageRate:
          tikzPictureSnippets.length === 0 ? 0 : Number((snippetsWithPathStatements / tikzPictureSnippets.length).toFixed(4)),
        snippetNodeCoverageRate:
          tikzPictureSnippets.length === 0 ? 0 : Number((snippetsWithNodeItems / tikzPictureSnippets.length).toFixed(4)),
        snippetCoordinateCoverageRate:
          tikzPictureSnippets.length === 0 ? 0 : Number((snippetsWithCoordinateItems / tikzPictureSnippets.length).toFixed(4)),
        allUnknownSnippetRate:
          tikzPictureSnippets.length === 0 ? 0 : Number((snippetsAllUnknownStatements / tikzPictureSnippets.length).toFixed(4)),
        statementTotals: {
          totalStatements,
          pathStatements,
          unknownStatements,
          pathStatementRate: totalStatements === 0 ? 0 : Number((pathStatements / totalStatements).toFixed(4)),
          unknownStatementRate: totalStatements === 0 ? 0 : Number((unknownStatements / totalStatements).toFixed(4))
        },
        pathItemTotals: {
          totalPathItems,
          coordinateItems,
          nodeItems,
          commentItems,
          optionItems,
          keywordItems,
          toOperationItems,
          svgOperationItems,
          letOperationItems,
          coordinateOperationItems,
          unknownPathItems,
          coordinateItemRate: totalPathItems === 0 ? 0 : Number((coordinateItems / totalPathItems).toFixed(4)),
          nodeItemRate: totalPathItems === 0 ? 0 : Number((nodeItems / totalPathItems).toFixed(4)),
          commentItemRate: totalPathItems === 0 ? 0 : Number((commentItems / totalPathItems).toFixed(4)),
          optionItemRate: totalPathItems === 0 ? 0 : Number((optionItems / totalPathItems).toFixed(4)),
          keywordItemRate: totalPathItems === 0 ? 0 : Number((keywordItems / totalPathItems).toFixed(4)),
          toOperationItemRate: totalPathItems === 0 ? 0 : Number((toOperationItems / totalPathItems).toFixed(4)),
          svgOperationItemRate: totalPathItems === 0 ? 0 : Number((svgOperationItems / totalPathItems).toFixed(4)),
          letOperationItemRate: totalPathItems === 0 ? 0 : Number((letOperationItems / totalPathItems).toFixed(4)),
          coordinateOperationItemRate:
            totalPathItems === 0 ? 0 : Number((coordinateOperationItems / totalPathItems).toFixed(4)),
          unknownPathItemRate: totalPathItems === 0 ? 0 : Number((unknownPathItems / totalPathItems).toFixed(4))
        }
      },
      topDiagnosticCodes,
      topRecoveryFiles,
      sampleHardFailures: hardFailures.slice(0, 5)
    };

    expect(tikzPictureSnippets.length).toBeGreaterThan(50);
    expect(hardFailures).toHaveLength(0);
    expect(snapshot).toMatchSnapshot();
  }, 120000);
});

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
