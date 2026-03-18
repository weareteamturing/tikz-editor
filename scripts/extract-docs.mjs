#!/usr/bin/env node
/**
 * Extract TikZ key documentation from tikz-dev HTML files.
 *
 * Outputs:
 *   - docs/keys/index.json          — maps key names to chunk filenames
 *   - docs/keys/<chunk>.json        — per-source-file documentation entries
 *
 * Each entry: { signature, default, description, type }
 *   type: "key" | "command" | "style"
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const TIKZDEV_DIR = join(import.meta.dirname, "..", "tikz-dev");
const OUT_DIR = join(import.meta.dirname, "..", "docs", "keys");

// ─── HTML helpers ──────────────────────────────────────────────────────────

/** Strip HTML tags, collapse whitespace, decode common entities. */
function stripHtml(html) {
  return html
    .replace(/<span class="angle">&langle;<\/span>/g, "⟨")
    .replace(/<span class="angle">&rangle;<\/span>/g, "⟩")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<img[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&langle;/g, "⟨")
    .replace(/&rangle;/g, "⟩")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2007;/g, " ")
    .replace(/&#x2003;/g, " ")
    .replace(/&#x2026;/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract text content of the first match of a regex in html. */
function extractSpan(html, className) {
  const re = new RegExp(`<span class="${className}">(.*?)</span>`, "s");
  const m = html.match(re);
  return m ? m[1] : null;
}

// ─── Anchor ID → key name mapping ──────────────────────────────────────────

/**
 * Convert an anchor id like "pgf./tikz/line:width" or "pgf.line:width"
 * to the user-facing key name "line width".
 * Returns null for anchors we want to skip.
 */
function anchorIdToKeyName(id) {
  // Skip metavariable template keys
  if (id.includes("meta(")) return null;

  // Remove pgf. prefix
  let key = id.replace(/^pgf\./, "");

  // Handle back/ prefix (commands like \draw, \fill)
  if (key.startsWith("back/")) {
    key = key.slice(5); // e.g. "back/draw" → "draw"
    // Prefix with backslash for commands
    if (!key.startsWith("\\")) key = "\\" + key;
    return key;
  }

  // Remove leading path like /tikz/ or /pgf/ or /pgf/decoration/
  key = key.replace(/^\.\/[^=]*?\//, ""); // e.g. "./tikz/" or "./pgf/decoration/"
  // But the short form won't have that — it's already just "line:width"

  // Colons back to spaces
  key = key.replace(/:/g, " ");

  return key;
}

// ─── Parse a single manualentry div ────────────────────────────────────────

/**
 * Given the innerHTML of a <div class="manualentry">,
 * extract all documented keys/commands from it.
 * Returns an array of { keyNames: string[], signature, default, description, type }.
 */
function parseManualEntry(entryHtml) {
  const results = [];

  // Find all anchor IDs in this entry
  const anchorRe = /<a id="(pgf\.[^"]+)">/g;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(entryHtml)) !== null) {
    anchors.push({ id: m[1], pos: m.index });
  }
  if (anchors.length === 0) return results;

  // Group consecutive anchors (dual anchors for the same key)
  // They appear right next to each other before the hl-def span
  const anchorGroups = [];
  let currentGroup = [anchors[0]];
  for (let i = 1; i < anchors.length; i++) {
    const gap = entryHtml.slice(anchors[i - 1].pos + anchors[i - 1].id.length + 15, anchors[i].pos);
    // If there's only whitespace between them, they're a group
    if (gap.replace(/<\/a>/g, "").trim().length < 5) {
      currentGroup.push(anchors[i]);
    } else {
      anchorGroups.push(currentGroup);
      currentGroup = [anchors[i]];
    }
  }
  anchorGroups.push(currentGroup);

  // For each anchor group, extract the surrounding definition
  for (const group of anchorGroups) {
    const keyNames = [];
    for (const a of group) {
      const name = anchorIdToKeyName(a.id);
      if (name && !keyNames.includes(name)) keyNames.push(name);
    }
    if (keyNames.length === 0) continue;

    // Determine type
    const isCommand = group.some((a) => a.id.includes("back/"));

    // Find hl-def after this anchor group
    const afterAnchors = entryHtml.slice(group[group.length - 1].pos);

    // Extract signature from hl-def
    const hlDefMatch = afterAnchors.match(/<span class="hl-def">([\s\S]*?)<\/span>\s*(?:<\/span>)?\s*(?:<span class="hl-default">|<\/p>)/);
    let signature = "";
    if (hlDefMatch) {
      signature = stripHtml(hlDefMatch[1]);
    } else {
      // Try a simpler match — sometimes hl-def is closed differently
      const simpleMatch = afterAnchors.match(/<span class="hl-def">([\s\S]*?)<\/span>/);
      if (simpleMatch) signature = stripHtml(simpleMatch[1]);
    }

    // Extract default from hl-default
    const hlDefaultMatch = afterAnchors.match(/<span class="hl-default">\(([\s\S]*?)\)<\/span>/);
    const defaultValue = hlDefaultMatch ? stripHtml(hlDefaultMatch[1]) : "";

    // Determine type from default text
    let type = isCommand ? "command" : "key";
    if (defaultValue.includes("style")) type = "style";

    // Extract description: <p> tags after the entryheadline div, before <div class="example">
    // We look for </div> closing entryheadline, then grab <p> tags
    const headlineEnd = afterAnchors.indexOf("</div>");
    if (headlineEnd === -1) continue;

    const afterHeadline = afterAnchors.slice(headlineEnd + 6);
    // Collect <p> content until we hit an example div, another manualentry, or end
    const descParts = [];
    const pRe = /<p>([\s\S]*?)<\/p>/g;
    let pm;
    let searchText = afterHeadline;
    // Cut at first example or nested manualentry
    const cutPoints = [
      searchText.indexOf('<div class="example">'),
      searchText.indexOf('<div class="manualentry">'),
    ].filter((i) => i >= 0);
    if (cutPoints.length > 0) {
      searchText = searchText.slice(0, Math.min(...cutPoints));
    }

    while ((pm = pRe.exec(searchText)) !== null) {
      const text = stripHtml(pm[1]);
      if (text.length > 5 && !text.startsWith("alias ")) {
        descParts.push(text);
        // Only take the first 2 paragraphs for the tooltip
        if (descParts.length >= 2) break;
      }
    }

    const description = descParts.join("\n\n");

    // Deduplicate key names — prefer the short form
    // e.g. if we have both "line width" from pgf./tikz/line:width and pgf.line:width,
    // they'll be the same after anchorIdToKeyName
    const uniqueNames = [...new Set(keyNames)];

    results.push({
      keyNames: uniqueNames,
      signature,
      default: defaultValue,
      description,
      type,
    });
  }

  return results;
}

// ─── Process a single HTML file ────────────────────────────────────────────

function processFile(filePath) {
  const html = readFileSync(filePath, "utf-8");
  const fileName = basename(filePath, ".html");

  // Split by manualentry divs
  const entries = [];
  const entryRe = /<div class="manualentry">([\s\S]*?)(?=<\/div>\s*(?:<div class="manualentry">|<h[1-6]|<p>|$))/g;

  // Split by manualentry openings — take content from one opening to the next
  const tag = '<div class="manualentry">';
  const positions = [];
  let pos = 0;
  while ((pos = html.indexOf(tag, pos)) !== -1) {
    positions.push(pos + tag.length);
    pos += tag.length;
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] - tag.length : html.length;
    entries.push(html.slice(start, end));
  }

  const results = [];
  for (const entry of entries) {
    const parsed = parseManualEntry(entry);
    results.push(...parsed);
  }

  return { fileName, results };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Only include files relevant to daily TikZ use
  const INCLUDE_PREFIXES = ["tikz-"];
  const INCLUDE_FILES = new Set([
    "library-shapes",
    "library-decorations",
    "library-patterns",
    "library-shadows",
    "library-fadings",
    "library-matrix",
    "pgffor",
  ]);

  const htmlFiles = readdirSync(TIKZDEV_DIR)
    .filter((f) => {
      if (!f.endsWith(".html") || f === "pgfmanual_html.html") return false;
      const name = f.replace(".html", "");
      return INCLUDE_PREFIXES.some((p) => name.startsWith(p)) || INCLUDE_FILES.has(name);
    })
    .sort();

  const index = {}; // keyName → chunkFile
  let totalKeys = 0;
  let filesWithKeys = 0;

  for (const file of htmlFiles) {
    const filePath = join(TIKZDEV_DIR, file);
    const { fileName, results } = processFile(filePath);

    if (results.length === 0) continue;
    filesWithKeys++;

    const chunk = {};
    for (const r of results) {
      const entry = {
        signature: r.signature,
        default: r.default,
        description: r.description,
        type: r.type,
      };

      for (const name of r.keyNames) {
        chunk[name] = entry;
        index[name] = fileName;
        totalKeys++;
      }
    }

    writeFileSync(join(OUT_DIR, `${fileName}.json`), JSON.stringify(chunk, null, 2));
  }

  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2));

  console.log(`Extracted ${totalKeys} keys from ${filesWithKeys} files into ${OUT_DIR}`);

  // Print some sample entries for verification
  const sampleKeys = ["line width", "draw", "fill", "thick", "inner sep", "\\draw", "\\fill"];
  console.log("\nSample entries:");
  for (const key of sampleKeys) {
    if (index[key]) {
      const chunkData = JSON.parse(readFileSync(join(OUT_DIR, `${index[key]}.json`), "utf-8"));
      const entry = chunkData[key];
      if (entry) {
        console.log(`\n  ${key} (in ${index[key]}):`);
        console.log(`    signature: ${entry.signature}`);
        console.log(`    default: ${entry.default}`);
        console.log(`    description: ${entry.description.slice(0, 120)}...`);
      }
    }
  }
}

main();
