export type RgbColor = { r: number; g: number; b: number };
export type RgbToXcolorMode = "drag" | "release";

export type RgbToXcolorResult = {
  targetRgb: RgbColor;
  expression: string;
  renderedRgb: RgbColor;
  exact: boolean;
  error2: number;
  error: number;
  mixes: 0 | 1 | 2;
  length: number;
  checked: number;
  mode: RgbToXcolorMode;
};

type BaseColorEntry = {
  name: string;
  rgb: [number, number, number];
};

type FastConfig = {
  mode: RgbToXcolorMode;
  depth1Radius: number;
  depth2P2Radius: number;
  depth2P1Radius: number;
};

type SearchBest = {
  baseIndex: number;
  p1: number;
  c1: number;
  p2: number;
  c2: number;
  renderedR: number;
  renderedG: number;
  renderedB: number;
  error2: number;
  length: number;
  mixes: 0 | 1 | 2;
  checked: number;
};

const XCOLOR_BASE_COLORS: readonly BaseColorEntry[] = [
  { name: "black", rgb: [0, 0, 0] },
  { name: "darkgray", rgb: [64, 64, 64] },
  { name: "gray", rgb: [128, 128, 128] },
  { name: "lightgray", rgb: [191, 191, 191] },
  { name: "white", rgb: [255, 255, 255] },
  { name: "red", rgb: [255, 0, 0] },
  { name: "green", rgb: [0, 255, 0] },
  { name: "blue", rgb: [0, 0, 255] },
  { name: "cyan", rgb: [0, 255, 255] },
  { name: "magenta", rgb: [255, 0, 255] },
  { name: "yellow", rgb: [255, 255, 0] },
  { name: "lime", rgb: [191, 255, 0] },
  { name: "olive", rgb: [128, 128, 0] },
  { name: "orange", rgb: [255, 128, 0] },
  { name: "pink", rgb: [255, 191, 191] },
  { name: "teal", rgb: [0, 128, 128] },
  { name: "violet", rgb: [128, 0, 128] },
  { name: "purple", rgb: [191, 0, 64] },
  { name: "brown", rgb: [191, 128, 64] }
] as const;

const WHITE_INDEX = XCOLOR_BASE_COLORS.findIndex((entry) => entry.name === "white");
const COLOR_COUNT = XCOLOR_BASE_COLORS.length;
const COLOR_R = XCOLOR_BASE_COLORS.map((entry) => entry.rgb[0]);
const COLOR_G = XCOLOR_BASE_COLORS.map((entry) => entry.rgb[1]);
const COLOR_B = XCOLOR_BASE_COLORS.map((entry) => entry.rgb[2]);
const NAME_LENGTHS = XCOLOR_BASE_COLORS.map((entry) => entry.name.length);
const DIGIT_LENGTHS = Array.from({ length: 101 }, (_, value) => String(value).length);
const TWO_MIX_MIN_Y = 0.0001;
const ZERO_DETERMINANT_EPSILON = 1e-9;

const FAST_MODE_DEFAULTS: Record<RgbToXcolorMode, Omit<FastConfig, "mode">> = {
  drag: {
    depth1Radius: 3,
    depth2P2Radius: 2,
    depth2P1Radius: 2
  },
  release: {
    depth1Radius: 4,
    depth2P2Radius: 3,
    depth2P1Radius: 3
  }
};

const PAIR_COUNT = COLOR_COUNT * COLOR_COUNT;
const PAIR_DX = new Float64Array(PAIR_COUNT);
const PAIR_DY = new Float64Array(PAIR_COUNT);
const PAIR_DZ = new Float64Array(PAIR_COUNT);
const PAIR_INV_DEN = new Float64Array(PAIR_COUNT);

const TRIPLE_COUNT = COLOR_COUNT * COLOR_COUNT * COLOR_COUNT;
const TRIPLE_A = new Uint8Array(TRIPLE_COUNT);
const TRIPLE_B = new Uint8Array(TRIPLE_COUNT);
const TRIPLE_C = new Uint8Array(TRIPLE_COUNT);
const TRIPLE_UX = new Float64Array(TRIPLE_COUNT);
const TRIPLE_UY = new Float64Array(TRIPLE_COUNT);
const TRIPLE_UZ = new Float64Array(TRIPLE_COUNT);
const TRIPLE_VX = new Float64Array(TRIPLE_COUNT);
const TRIPLE_VY = new Float64Array(TRIPLE_COUNT);
const TRIPLE_VZ = new Float64Array(TRIPLE_COUNT);
const TRIPLE_UU = new Float64Array(TRIPLE_COUNT);
const TRIPLE_UV = new Float64Array(TRIPLE_COUNT);
const TRIPLE_VV = new Float64Array(TRIPLE_COUNT);
const TRIPLE_INV_DET = new Float64Array(TRIPLE_COUNT);
const TRIPLE_CAN_SOLVE = new Uint8Array(TRIPLE_COUNT);

initializeProjectionTables();

function initializeProjectionTables(): void {
  for (let baseIndex = 0; baseIndex < COLOR_COUNT; baseIndex += 1) {
    for (let mixIndex = 0; mixIndex < COLOR_COUNT; mixIndex += 1) {
      const pairIndex = baseIndex * COLOR_COUNT + mixIndex;
      const dx = COLOR_R[baseIndex]! - COLOR_R[mixIndex]!;
      const dy = COLOR_G[baseIndex]! - COLOR_G[mixIndex]!;
      const dz = COLOR_B[baseIndex]! - COLOR_B[mixIndex]!;
      const denominator = dx * dx + dy * dy + dz * dz;

      PAIR_DX[pairIndex] = dx;
      PAIR_DY[pairIndex] = dy;
      PAIR_DZ[pairIndex] = dz;
      PAIR_INV_DEN[pairIndex] = denominator > 0 ? 1 / denominator : 0;
    }
  }

  let tripleIndex = 0;
  for (let a = 0; a < COLOR_COUNT; a += 1) {
    for (let b = 0; b < COLOR_COUNT; b += 1) {
      for (let c = 0; c < COLOR_COUNT; c += 1) {
        TRIPLE_A[tripleIndex] = a;
        TRIPLE_B[tripleIndex] = b;
        TRIPLE_C[tripleIndex] = c;

        const ux = COLOR_R[b]! - COLOR_R[c]!;
        const uy = COLOR_G[b]! - COLOR_G[c]!;
        const uz = COLOR_B[b]! - COLOR_B[c]!;
        const vx = COLOR_R[a]! - COLOR_R[b]!;
        const vy = COLOR_G[a]! - COLOR_G[b]!;
        const vz = COLOR_B[a]! - COLOR_B[b]!;

        TRIPLE_UX[tripleIndex] = ux;
        TRIPLE_UY[tripleIndex] = uy;
        TRIPLE_UZ[tripleIndex] = uz;
        TRIPLE_VX[tripleIndex] = vx;
        TRIPLE_VY[tripleIndex] = vy;
        TRIPLE_VZ[tripleIndex] = vz;

        const uu = ux * ux + uy * uy + uz * uz;
        const uv = ux * vx + uy * vy + uz * vz;
        const vv = vx * vx + vy * vy + vz * vz;
        const determinant = uu * vv - uv * uv;

        TRIPLE_UU[tripleIndex] = uu;
        TRIPLE_UV[tripleIndex] = uv;
        TRIPLE_VV[tripleIndex] = vv;

        if (Math.abs(determinant) > ZERO_DETERMINANT_EPSILON) {
          TRIPLE_INV_DET[tripleIndex] = 1 / determinant;
          TRIPLE_CAN_SOLVE[tripleIndex] = 1;
        }

        tripleIndex += 1;
      }
    }
  }
}

function clampByte(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function clampInteger(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function roundToPercent(value01: number): number {
  return clampInteger(Math.round(value01 * 100), 1, 99);
}

function normalizeTargetRgb(input: RgbColor): [number, number, number] {
  return [clampByte(input.r), clampByte(input.g), clampByte(input.b)];
}

function normalizeRadius(raw: number | undefined, fallback: number): number {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return clampInteger(Math.round(raw!), 0, 50);
}

function normalizeFastConfig(options: {
  mode?: RgbToXcolorMode;
  depth1Radius?: number;
  depth2P2Radius?: number;
  depth2P1Radius?: number;
}): FastConfig {
  const mode: RgbToXcolorMode = options.mode === "release" ? "release" : "drag";
  const defaults = FAST_MODE_DEFAULTS[mode];
  return {
    mode,
    depth1Radius: normalizeRadius(options.depth1Radius, defaults.depth1Radius),
    depth2P2Radius: normalizeRadius(options.depth2P2Radius, defaults.depth2P2Radius),
    depth2P1Radius: normalizeRadius(options.depth2P1Radius, defaults.depth2P1Radius)
  };
}

function isLexicographicallyBetter(
  baseIndex: number,
  p1: number,
  c1: number,
  p2: number,
  c2: number,
  bestBaseIndex: number,
  bestP1: number,
  bestC1: number,
  bestP2: number,
  bestC2: number
): boolean {
  if (baseIndex !== bestBaseIndex) {
    return baseIndex < bestBaseIndex;
  }
  if (p1 !== bestP1) {
    return p1 < bestP1;
  }
  if (c1 !== bestC1) {
    return c1 < bestC1;
  }
  if (p2 !== bestP2) {
    return p2 < bestP2;
  }
  return c2 < bestC2;
}

function expressionLength(baseIndex: number, p1: number, c1: number, p2: number, c2: number): number {
  let length = NAME_LENGTHS[baseIndex]!;

  if (p1 >= 0) {
    length += 1 + DIGIT_LENGTHS[p1]!;
    const omitFirstMixColor = c1 === WHITE_INDEX && p2 < 0;
    if (!omitFirstMixColor) {
      length += 1 + NAME_LENGTHS[c1]!;
    }
  }

  if (p2 >= 0) {
    length += 1 + DIGIT_LENGTHS[p2]!;
    if (c2 !== WHITE_INDEX) {
      length += 1 + NAME_LENGTHS[c2]!;
    }
  }

  return length;
}

function renderExpression(baseIndex: number, p1: number, c1: number, p2: number, c2: number): string {
  let expression = XCOLOR_BASE_COLORS[baseIndex]!.name;

  if (p1 >= 0 && c1 >= 0) {
    expression += `!${p1}`;
    const omitFirstMixColor = c1 === WHITE_INDEX && p2 < 0;
    if (!omitFirstMixColor) {
      expression += `!${XCOLOR_BASE_COLORS[c1]!.name}`;
    }
  }

  if (p2 >= 0 && c2 >= 0) {
    expression += `!${p2}`;
    if (c2 !== WHITE_INDEX) {
      expression += `!${XCOLOR_BASE_COLORS[c2]!.name}`;
    }
  }

  return expression;
}

function fastAnalyticSearch(targetRgb: [number, number, number], maxMixes: 0 | 1 | 2, config: FastConfig): SearchBest {
  const [targetR, targetG, targetB] = targetRgb;

  let checked = 0;
  let bestError2 = Number.POSITIVE_INFINITY;
  let bestLength = Number.POSITIVE_INFINITY;
  let bestMixes: 0 | 1 | 2 = 2;
  let bestBaseIndex = -1;
  let bestP1 = -1;
  let bestC1 = -1;
  let bestP2 = -1;
  let bestC2 = -1;
  let bestR = 0;
  let bestG = 0;
  let bestB = 0;

  const maybeUpdate = (
    baseIndex: number,
    p1: number,
    c1: number,
    p2: number,
    c2: number,
    renderedR: number,
    renderedG: number,
    renderedB: number
  ): void => {
    checked += 1;

    const dr = renderedR - targetR;
    const dg = renderedG - targetG;
    const db = renderedB - targetB;
    const error2 = dr * dr + dg * dg + db * db;
    const length = expressionLength(baseIndex, p1, c1, p2, c2);
    const mixes: 0 | 1 | 2 = p2 >= 0 ? 2 : p1 >= 0 ? 1 : 0;

    if (error2 < bestError2) {
      bestError2 = error2;
      bestLength = length;
      bestMixes = mixes;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (error2 > bestError2) {
      return;
    }

    if (length < bestLength) {
      bestLength = length;
      bestMixes = mixes;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (length > bestLength) {
      return;
    }

    if (mixes < bestMixes) {
      bestMixes = mixes;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (mixes > bestMixes) {
      return;
    }

    if (
      isLexicographicallyBetter(
        baseIndex,
        p1,
        c1,
        p2,
        c2,
        bestBaseIndex,
        bestP1,
        bestC1,
        bestP2,
        bestC2
      )
    ) {
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
    }
  };

  for (let baseIndex = 0; baseIndex < COLOR_COUNT; baseIndex += 1) {
    maybeUpdate(baseIndex, -1, -1, -1, -1, COLOR_R[baseIndex]!, COLOR_G[baseIndex]!, COLOR_B[baseIndex]!);
  }

  if (maxMixes >= 1) {
    for (let baseIndex = 0; baseIndex < COLOR_COUNT; baseIndex += 1) {
      for (let mixIndex = 0; mixIndex < COLOR_COUNT; mixIndex += 1) {
        const pairIndex = baseIndex * COLOR_COUNT + mixIndex;
        const invDen = PAIR_INV_DEN[pairIndex]!;

        let projectedT = 0.5;
        if (invDen > 0) {
          const tx = targetR - COLOR_R[mixIndex]!;
          const ty = targetG - COLOR_G[mixIndex]!;
          const tz = targetB - COLOR_B[mixIndex]!;
          projectedT =
            (tx * PAIR_DX[pairIndex]! + ty * PAIR_DY[pairIndex]! + tz * PAIR_DZ[pairIndex]!) * invDen;
          projectedT = clamp01(projectedT);
          projectedT = clampInteger(roundToPercent(projectedT), 1, 99) / 100;
        }

        const center = roundToPercent(projectedT);
        const start = Math.max(1, center - config.depth1Radius);
        const end = Math.min(99, center + config.depth1Radius);

        for (let p1 = start; p1 <= end; p1 += 1) {
          const t1 = p1 / 100;
          const u1 = 1 - t1;
          const renderedR = clampByte(COLOR_R[baseIndex]! * t1 + COLOR_R[mixIndex]! * u1);
          const renderedG = clampByte(COLOR_G[baseIndex]! * t1 + COLOR_G[mixIndex]! * u1);
          const renderedB = clampByte(COLOR_B[baseIndex]! * t1 + COLOR_B[mixIndex]! * u1);
          maybeUpdate(baseIndex, p1, mixIndex, -1, -1, renderedR, renderedG, renderedB);
        }
      }
    }
  }

  if (maxMixes >= 2) {
    for (let tripleIndex = 0; tripleIndex < TRIPLE_COUNT; tripleIndex += 1) {
      const a = TRIPLE_A[tripleIndex]!;
      const b = TRIPLE_B[tripleIndex]!;
      const c = TRIPLE_C[tripleIndex]!;

      const wx = targetR - COLOR_R[c]!;
      const wy = targetG - COLOR_G[c]!;
      const wz = targetB - COLOR_B[c]!;

      const uw = TRIPLE_UX[tripleIndex]! * wx + TRIPLE_UY[tripleIndex]! * wy + TRIPLE_UZ[tripleIndex]! * wz;
      const vw = TRIPLE_VX[tripleIndex]! * wx + TRIPLE_VY[tripleIndex]! * wy + TRIPLE_VZ[tripleIndex]! * wz;

      let x = 0.5;
      let y = 0.25;

      if (TRIPLE_CAN_SOLVE[tripleIndex] === 1) {
        const invDet = TRIPLE_INV_DET[tripleIndex]!;
        x = (uw * TRIPLE_VV[tripleIndex]! - vw * TRIPLE_UV[tripleIndex]!) * invDet;
        y = (vw * TRIPLE_UU[tripleIndex]! - uw * TRIPLE_UV[tripleIndex]!) * invDet;
      } else if (TRIPLE_UU[tripleIndex]! > 0) {
        x = uw / TRIPLE_UU[tripleIndex]!;
        y = x * 0.5;
      }

      x = clamp01(x);
      x = clampInteger(roundToPercent(x), 1, 99) / 100;
      y = Math.max(TWO_MIX_MIN_Y, Math.min(y, x));

      const p2Center = roundToPercent(x);
      const p2Start = Math.max(1, p2Center - config.depth2P2Radius);
      const p2End = Math.min(99, p2Center + config.depth2P2Radius);

      for (let p2 = p2Start; p2 <= p2End; p2 += 1) {
        const t2 = p2 / 100;
        const p1Center = roundToPercent(y / t2);
        const p1Start = Math.max(1, p1Center - config.depth2P1Radius);
        const p1End = Math.min(99, p1Center + config.depth2P1Radius);

        for (let p1 = p1Start; p1 <= p1End; p1 += 1) {
          const t1 = p1 / 100;
          const alpha = t1 * t2;
          const beta = (1 - t1) * t2;
          const gamma = 1 - t2;

          const renderedR = clampByte(COLOR_R[a]! * alpha + COLOR_R[b]! * beta + COLOR_R[c]! * gamma);
          const renderedG = clampByte(COLOR_G[a]! * alpha + COLOR_G[b]! * beta + COLOR_G[c]! * gamma);
          const renderedB = clampByte(COLOR_B[a]! * alpha + COLOR_B[b]! * beta + COLOR_B[c]! * gamma);
          maybeUpdate(a, p1, b, p2, c, renderedR, renderedG, renderedB);
        }
      }
    }
  }

  if (bestBaseIndex < 0) {
    throw new Error("No candidate produced by fast analytic search.");
  }

  return {
    baseIndex: bestBaseIndex,
    p1: bestP1,
    c1: bestC1,
    p2: bestP2,
    c2: bestC2,
    renderedR: bestR,
    renderedG: bestG,
    renderedB: bestB,
    error2: bestError2,
    length: bestLength,
    mixes: bestMixes,
    checked
  };
}

export function rgbToXcolorExpressionFast(
  target: RgbColor,
  options: { mode?: RgbToXcolorMode; maxMixes?: 0 | 1 | 2 } = {}
): RgbToXcolorResult {
  const targetRgb = normalizeTargetRgb(target);
  const maxMixes = clampInteger(Math.floor(options.maxMixes ?? 2), 0, 2) as 0 | 1 | 2;
  const config = normalizeFastConfig(options);
  const best = fastAnalyticSearch(targetRgb, maxMixes, config);

  return {
    targetRgb: {
      r: targetRgb[0],
      g: targetRgb[1],
      b: targetRgb[2]
    },
    expression: renderExpression(best.baseIndex, best.p1, best.c1, best.p2, best.c2),
    renderedRgb: {
      r: best.renderedR,
      g: best.renderedG,
      b: best.renderedB
    },
    exact: best.error2 === 0,
    error2: best.error2,
    error: Math.sqrt(best.error2),
    mixes: best.mixes,
    length: best.length,
    checked: best.checked,
    mode: config.mode
  };
}
