#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage: node scripts/analyze-cpuprofile.mjs <profile.cpuprofile> [limit]");
  process.exit(1);
}

const profilePath = process.argv[2];
const limit = Number(process.argv[3] ?? 25);
if (!profilePath) {
  usage();
}

const raw = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const nodes = raw.nodes ?? [];
const samples = raw.samples ?? [];
const timeDeltas = raw.timeDeltas ?? [];
if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas)) {
  throw new Error("Unsupported cpuprofile format");
}

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const childrenById = new Map();
for (const node of nodes) {
  childrenById.set(node.id, node.children ?? []);
}

const selfTimeById = new Map();
for (let i = 0; i < samples.length; i += 1) {
  const id = samples[i];
  const delta = timeDeltas[i] ?? 0;
  selfTimeById.set(id, (selfTimeById.get(id) ?? 0) + delta);
}

const totalTimeById = new Map();
function computeTotalTime(id) {
  if (totalTimeById.has(id)) {
    return totalTimeById.get(id);
  }
  let total = selfTimeById.get(id) ?? 0;
  for (const childId of childrenById.get(id) ?? []) {
    total += computeTotalTime(childId);
  }
  totalTimeById.set(id, total);
  return total;
}
for (const node of nodes) {
  computeTotalTime(node.id);
}

function frameLabel(node) {
  const frame = node.callFrame ?? {};
  const fn = frame.functionName || "(anonymous)";
  const url = frame.url ? path.relative(process.cwd(), frame.url) || frame.url : "(native)";
  const line = frame.lineNumber != null ? frame.lineNumber + 1 : 0;
  return `${fn}  ${url}:${line}`;
}

function summarize(kind, times) {
  const entries = nodes
    .map((node) => ({
      id: node.id,
      label: frameLabel(node),
      timeMs: (times.get(node.id) ?? 0) / 1000
    }))
    .filter((entry) => entry.timeMs > 0.05)
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, limit);

  console.log(`\nTop ${entries.length} by ${kind}:`);
  for (const entry of entries) {
    console.log(`${entry.timeMs.toFixed(1).padStart(8)} ms  ${entry.label}`);
  }
}

const totalProfileMs = timeDeltas.reduce((sum, delta) => sum + delta, 0) / 1000;
console.log(`Profile: ${profilePath}`);
console.log(`Total sampled time: ${totalProfileMs.toFixed(1)} ms`);

summarize("self time", selfTimeById);
summarize("total time", totalTimeById);
