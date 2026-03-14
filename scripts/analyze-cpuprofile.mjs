#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

function usage() {
  console.error("Usage: node scripts/analyze-cpuprofile.mjs <profile.cpuprofile> [limit] [--dist <dist-dir>]");
  process.exit(1);
}

// Parse args: positional args + --dist <path>
const positional = [];
let distDir = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--dist") {
    distDir = process.argv[++i];
  } else {
    positional.push(process.argv[i]);
  }
}

const profilePath = positional[0];
const limit = Number(positional[1] ?? 25);
if (!profilePath) usage();

const raw = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const nodes = raw.nodes ?? [];
const samples = raw.samples ?? [];
const timeDeltas = raw.timeDeltas ?? [];
if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas)) {
  throw new Error("Unsupported cpuprofile format");
}

// Source map resolution
const sourceMaps = new Map(); // basename -> TraceMap | null

function loadSourceMap(url) {
  if (!distDir || !url) return null;
  const basename = url.split("/").pop();
  if (!basename || !basename.endsWith(".js")) return null;
  if (sourceMaps.has(basename)) return sourceMaps.get(basename);
  const mapPath = path.join(distDir, "assets", basename + ".map");
  try {
    const mapRaw = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const tracer = new TraceMap(mapRaw);
    sourceMaps.set(basename, { tracer, mapPath });
    return sourceMaps.get(basename);
  } catch {
    sourceMaps.set(basename, null);
    return null;
  }
}

function resolveFrame(frame) {
  if (!frame.url || frame.lineNumber == null) return null;
  const entry = loadSourceMap(frame.url);
  if (!entry) return null;
  const pos = originalPositionFor(entry.tracer, {
    line: frame.lineNumber + 1, // cpuprofile is 0-based, trace-mapping expects 1-based
    column: frame.columnNumber ?? 0
  });
  if (!pos.source) return null;
  // Resolve the source path relative to the map file, then make it relative to cwd
  const absSource = path.resolve(path.dirname(entry.mapPath), pos.source);
  return {
    fn: pos.name || frame.functionName || "(anonymous)",
    source: path.relative(process.cwd(), absSource),
    line: pos.line
  };
}

// Build node maps
const nodeById = new Map(nodes.map((node) => [node.id, node]));
const childrenById = new Map(nodes.map((node) => [node.id, node.children ?? []]));

const selfTimeById = new Map();
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  selfTimeById.set(id, (selfTimeById.get(id) ?? 0) + (timeDeltas[i] ?? 0));
}

const totalTimeById = new Map();
function computeTotalTime(id) {
  if (totalTimeById.has(id)) return totalTimeById.get(id);
  let total = selfTimeById.get(id) ?? 0;
  for (const childId of childrenById.get(id) ?? []) total += computeTotalTime(childId);
  totalTimeById.set(id, total);
  return total;
}
for (const node of nodes) computeTotalTime(node.id);

function frameLabel(node) {
  const frame = node.callFrame ?? {};
  const resolved = resolveFrame(frame);
  if (resolved) {
    return `${resolved.fn}  ${resolved.source}:${resolved.line}`;
  }
  const fn = frame.functionName || "(anonymous)";
  const url = frame.url ? (path.relative(process.cwd(), frame.url) || frame.url) : "(native)";
  const line = frame.lineNumber != null ? frame.lineNumber + 1 : 0;
  return `${fn}  ${url}:${line}`;
}

function summarize(kind, times) {
  const entries = nodes
    .map((node) => ({ label: frameLabel(node), timeMs: (times.get(node.id) ?? 0) / 1000 }))
    .filter((e) => e.timeMs > 0.05)
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, limit);

  console.log(`\nTop ${entries.length} by ${kind}:`);
  for (const entry of entries) {
    console.log(`${entry.timeMs.toFixed(1).padStart(8)} ms  ${entry.label}`);
  }
}

const totalProfileMs = timeDeltas.reduce((sum, d) => sum + d, 0) / 1000;
console.log(`Profile: ${profilePath}`);
console.log(`Total sampled time: ${totalProfileMs.toFixed(1)} ms`);
if (distDir) {
  console.log(`Source maps: ${distDir}`);
}

summarize("self time", selfTimeById);
summarize("total time", totalTimeById);
