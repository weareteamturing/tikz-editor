#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareTikzRenderers, RendererComparisonError } from "./compare-tikz-renderers.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultInputDir = join(repoRoot, "docs", "comparison-inputs");
const defaultOutDir = join(repoRoot, "artifacts", "renderer-compare");
const validReferenceModes = new Set(["pdf-png", "dvisvgm-svg", "dvisvgm-svg-png"]);

if (isMain(import.meta.url)) {
  await runCli();
}

async function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      process.exit(0);
    }

    const inputDir = resolve(args.inputDir ?? defaultInputDir);
    const outDir = resolve(args.outDir ?? defaultOutDir);
    const files = collectTexFiles(inputDir);
    if (files.length === 0) {
      throw new Error(`No .tex files found in input directory: ${inputDir}`);
    }

    mkdirSync(outDir, { recursive: true });
    const entries = [];
    let okCount = 0;
    let failCount = 0;

    for (let index = 0; index < files.length; index += 1) {
      const filePath = files[index];
      const runName = basename(filePath, extname(filePath));
      process.stdout.write(`[${index + 1}/${files.length}] ${runName}\n`);

      try {
        const result = await compareTikzRenderers({
          inputPath: filePath,
          outDir,
          name: runName,
          includeTimestamp: args.includeTimestamp,
          referenceMode: args.referenceMode
        });

        okCount += 1;
        entries.push({
          name: runName,
          filePath,
          status: "ok",
          runDir: result.runDir,
          reportPath: result.reportPath
        });
      } catch (error) {
        failCount += 1;

        if (!(error instanceof RendererComparisonError)) {
          throw error;
        }

        entries.push({
          name: runName,
          filePath,
          status: "error",
          runDir: error.runDir ?? null,
          reportPath: error.reportPath ?? null,
          error: error.message
        });

        if (!args.continueOnError) {
          throw error;
        }
      }
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      inputDir,
      outDir,
      referenceMode: args.referenceMode,
      includeTimestamp: args.includeTimestamp,
      totals: {
        fixtures: files.length,
        succeeded: okCount,
        failed: failCount
      },
      entries
    };

    const manifestName = args.includeTimestamp
      ? `arrow-comparison-manifest-${timestampSlug()}.json`
      : "arrow-comparison-manifest.json";
    const manifestPath = join(outDir, manifestName);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    console.log(
      JSON.stringify(
        {
          inputDir,
          outDir,
          manifestPath,
          totals: manifest.totals
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {
    inputDir: null,
    outDir: null,
    includeTimestamp: false,
    continueOnError: false,
    referenceMode: "pdf-png",
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--input-dir") {
      parsed.inputDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      parsed.outDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--with-timestamp") {
      parsed.includeTimestamp = true;
      continue;
    }
    if (arg === "--continue-on-error") {
      parsed.continueOnError = true;
      continue;
    }
    if (arg === "--reference-mode") {
      const mode = argv[i + 1] ?? "";
      if (!validReferenceModes.has(mode)) {
        throw new Error(`--reference-mode must be one of: ${[...validReferenceModes].join(", ")}.`);
      }
      parsed.referenceMode = mode;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function collectTexFiles(inputDir) {
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const entries = readdirSync(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tex"))
    .map((entry) => join(inputDir, entry.name));
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function printUsage() {
  console.log(`Usage:
  node scripts/compare-arrow-fixtures.mjs
  node scripts/compare-arrow-fixtures.mjs --reference-mode dvisvgm-svg
  node scripts/compare-arrow-fixtures.mjs --with-timestamp
  node scripts/compare-arrow-fixtures.mjs --continue-on-error

Defaults:
  --input-dir ${defaultInputDir}
  --out-dir ${defaultOutDir}
  --reference-mode pdf-png
  writes deterministic run directories (no timestamp)
`);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isMain(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(metaUrl) === resolve(process.argv[1]);
}
