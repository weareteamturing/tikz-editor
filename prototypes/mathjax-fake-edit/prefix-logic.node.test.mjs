import assert from "node:assert/strict";
import test from "node:test";
import mathjax from "mathjax";
import {
  finalizePrefixWidthTable,
  scanTeXPrefixState,
  stabilizePrefixForMeasurement
} from "./prefix-logic.js";

const MATHJAX_CONFIG = {
  loader: {
    load: ["input/tex", "output/svg", "[tex]/color"]
  },
  tex: {
    packages: {
      "[+]": ["color"],
      "[-]": ["noundefined"]
    },
    formatError: (_jax, err) => {
      throw err;
    }
  },
  svg: {
    fontCache: "none",
    linebreaks: {
      inline: false
    }
  },
  startup: {
    typeset: false
  }
};

function buildWrappedTeX(source) {
  return `\\mbox{${source}}`;
}

async function createRuntime() {
  return mathjax.init(MATHJAX_CONFIG);
}

test("stabilizer keeps escaped-brace math prefixes renderable", async () => {
  const runtime = await createRuntime();
  const source = "Hello $x^2 = y\\{z\\}$!";

  for (let index = 1; index < source.length; index += 1) {
    const prefix = source.slice(0, index);
    const stabilized = stabilizePrefixForMeasurement(prefix);
    assert.doesNotThrow(
      () => {
        runtime.tex2svg(buildWrappedTeX(stabilized), { display: false });
      },
      `failed at prefix index ${index}: ${JSON.stringify(prefix)} => ${JSON.stringify(stabilized)}`
    );
  }
});

test("stabilizer discharges trailing backslash without undefined control sequence", async () => {
  const runtime = await createRuntime();
  const rawPrefix = "Hello $x^2 = y\\";
  const stabilized = stabilizePrefixForMeasurement(rawPrefix);

  assert.match(stabilized, /\\phantom\{\}\$/);
  assert.doesNotThrow(() => {
    runtime.tex2svg(buildWrappedTeX(stabilized), { display: false });
  });
});

test("stabilizer supports open \\( ... \\) math delimiters for prefixes", async () => {
  const runtime = await createRuntime();
  const source = "Hello \\(x^2 = y\\{z\\}\\)!";

  for (let index = 1; index < source.length; index += 1) {
    const prefix = source.slice(0, index);
    const stabilized = stabilizePrefixForMeasurement(prefix);
    assert.doesNotThrow(
      () => {
        runtime.tex2svg(buildWrappedTeX(stabilized), { display: false });
      },
      `failed at prefix index ${index}: ${JSON.stringify(prefix)} => ${JSON.stringify(stabilized)}`
    );
  }
});

test("scan state tracks \\( ... \\) as math mode and closes with \\)", () => {
  const open = scanTeXPrefixState("Cost: \\(x+1");
  assert.equal(open.inMath, true);
  assert.equal(open.mathMode, "paren");

  const stabilized = stabilizePrefixForMeasurement("Cost: \\(x+1");
  assert.ok(stabilized.endsWith("\\)"));

  const closed = scanTeXPrefixState("Cost: \\(x+1\\)");
  assert.equal(closed.inMath, false);
  assert.equal(closed.mathMode, "none");
});

test("finalizePrefixWidthTable interpolates unknown gaps and preserves monotonic order", () => {
  const table = [0, 90, Number.NaN, Number.NaN, 210, Number.NaN, 320];
  const finalized = finalizePrefixWidthTable(table, 320);

  assert.equal(finalized[2], 130);
  assert.equal(finalized[3], 170);
  assert.equal(finalized[5], 265);

  for (let index = 1; index < finalized.length; index += 1) {
    assert.ok(finalized[index] >= finalized[index - 1]);
  }
});
