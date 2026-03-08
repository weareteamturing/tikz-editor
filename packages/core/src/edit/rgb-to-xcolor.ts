export type RgbColor = { r: number; g: number; b: number };
export type RgbToXcolorMode = "drag" | "release";

export type RgbToXcolorResult = {
  targetRgb: RgbColor;
  expression: string;
  renderedRgb: RgbColor;
  exact: boolean;
  error2: number;
  error: number;
  mixes: 0 | 1 | 2 | 3;
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
  exact: boolean;
  threeMixWhiteTail: boolean;
  depth1Radius: number;
  depth2P2Radius: number;
  depth2P1Radius: number;
};

type FastOptions = {
  mode?: RgbToXcolorMode;
  maxMixes?: 0 | 1 | 2 | 3;
  exact?: boolean;
  threeMixWhiteTail?: boolean;
  depth1Radius?: number;
  depth2P2Radius?: number;
  depth2P1Radius?: number;
};

type SearchBest = {
  baseIndex: number;
  p1: number;
  c1: number;
  p2: number;
  c2: number;
  p3: number;
  c3: number;
  renderedR: number;
  renderedG: number;
  renderedB: number;
  error2: number;
  mixes: 0 | 1 | 2 | 3;
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

const FAST_MODE_DEFAULTS: Record<
  RgbToXcolorMode,
  Omit<FastConfig, "mode" | "exact" | "threeMixWhiteTail">
> = {
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

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const clamped = Math.max(0, Math.min(100, value));
  if (Math.abs(clamped - Math.round(clamped)) < 1e-9) {
    return String(Math.round(clamped));
  }

  return clamped.toFixed(6).replace(/\.?0+$/, "");
}

function roundPercentage(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 100) {
    return 100;
  }
  return rounded;
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

function normalizeFastConfig(options: FastOptions): FastConfig {
  const mode: RgbToXcolorMode = options.mode === "release" ? "release" : "drag";
  const defaults = FAST_MODE_DEFAULTS[mode];
  const threeMixWhiteTail = options.threeMixWhiteTail === true;
  return {
    mode,
    threeMixWhiteTail,
    exact: options.exact === true || threeMixWhiteTail,
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
  bestC2: number,
  p3 = -1,
  c3 = -1,
  bestP3 = -1,
  bestC3 = -1
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
  if (c2 !== bestC2) {
    return c2 < bestC2;
  }
  if (p3 !== bestP3) {
    return p3 < bestP3;
  }
  return c3 < bestC3;
}

function expressionLength(baseIndex: number, p1: number, c1: number, p2: number, c2: number, p3 = -1, c3 = -1): number {
  let length = NAME_LENGTHS[baseIndex]!;

  if (p1 >= 0) {
    length += 1 + formatPercentage(p1).length;
    const omitFirstMixColor = c1 === WHITE_INDEX && p2 < 0;
    if (!omitFirstMixColor) {
      length += 1 + NAME_LENGTHS[c1]!;
    }
  }

  if (p2 >= 0) {
    length += 1 + formatPercentage(p2).length;
    const omitSecondMixColor = c2 === WHITE_INDEX && p3 < 0;
    if (!omitSecondMixColor) {
      length += 1 + NAME_LENGTHS[c2]!;
    }
  }

  if (p3 >= 0) {
    length += 1 + formatPercentage(p3).length;
    if (c3 !== WHITE_INDEX) {
      length += 1 + NAME_LENGTHS[c3]!;
    }
  }

  return length;
}

function renderExpression(baseIndex: number, p1: number, c1: number, p2: number, c2: number, p3 = -1, c3 = -1): string {
  let expression = XCOLOR_BASE_COLORS[baseIndex]!.name;

  if (p1 >= 0 && c1 >= 0) {
    expression += `!${formatPercentage(p1)}`;
    const omitFirstMixColor = c1 === WHITE_INDEX && p2 < 0;
    if (!omitFirstMixColor) {
      expression += `!${XCOLOR_BASE_COLORS[c1]!.name}`;
    }
  }

  if (p2 >= 0 && c2 >= 0) {
    expression += `!${formatPercentage(p2)}`;
    const omitSecondMixColor = c2 === WHITE_INDEX && p3 < 0;
    if (!omitSecondMixColor) {
      expression += `!${XCOLOR_BASE_COLORS[c2]!.name}`;
    }
  }

  if (p3 >= 0 && c3 >= 0) {
    expression += `!${formatPercentage(p3)}`;
    if (c3 !== WHITE_INDEX) {
      expression += `!${XCOLOR_BASE_COLORS[c3]!.name}`;
    }
  }

  return expression;
}

function renderCandidateRgb(baseIndex: number, p1: number, c1: number, p2: number, c2: number, p3 = -1, c3 = -1): [number, number, number] {
  if (p1 < 0 || c1 < 0) {
    return [COLOR_R[baseIndex]!, COLOR_G[baseIndex]!, COLOR_B[baseIndex]!];
  }

  const t1 = p1 / 100;
  const u1 = 1 - t1;
  const mix1R = COLOR_R[baseIndex]! * t1 + COLOR_R[c1]! * u1;
  const mix1G = COLOR_G[baseIndex]! * t1 + COLOR_G[c1]! * u1;
  const mix1B = COLOR_B[baseIndex]! * t1 + COLOR_B[c1]! * u1;

  if (p2 < 0 || c2 < 0) {
    return [clampByte(mix1R), clampByte(mix1G), clampByte(mix1B)];
  }

  const t2 = p2 / 100;
  const u2 = 1 - t2;
  const mix2R = mix1R * t2 + COLOR_R[c2]! * u2;
  const mix2G = mix1G * t2 + COLOR_G[c2]! * u2;
  const mix2B = mix1B * t2 + COLOR_B[c2]! * u2;

  if (p3 < 0 || c3 < 0) {
    return [clampByte(mix2R), clampByte(mix2G), clampByte(mix2B)];
  }

  const t3 = p3 / 100;
  const u3 = 1 - t3;
  return [
    clampByte(mix2R * t3 + COLOR_R[c3]! * u3),
    clampByte(mix2G * t3 + COLOR_G[c3]! * u3),
    clampByte(mix2B * t3 + COLOR_B[c3]! * u3)
  ];
}

function pickDisplayPercentages(best: SearchBest): { p1: number; p2: number; p3: number } {
  if (best.p1 < 0 || best.c1 < 0) {
    return { p1: -1, p2: -1, p3: -1 };
  }

  const percentages = [best.p1, best.p2, best.p3].filter((value) => value >= 0);
  const mixCount = percentages.length;
  if (mixCount === 0) {
    return { p1: -1, p2: -1, p3: -1 };
  }

  const targetR = best.renderedR;
  const targetG = best.renderedG;
  const targetB = best.renderedB;

  type DisplayCandidate = {
    p1: number;
    p2: number;
    p3: number;
    score: number;
    decimalsSum: number;
    tieKey: string;
  };

  const rounded = new Array<number>(mixCount).fill(0);
  const decimals = new Array<number>(mixCount).fill(0);
  let bestCandidate: DisplayCandidate | null = null;

  const recurse = (index: number): void => {
    if (index >= mixCount) {
      const p1 = rounded[0]!;
      const p2 = mixCount >= 2 ? rounded[1]! : -1;
      const p3 = mixCount >= 3 ? rounded[2]! : -1;

      const [r, g, b] = renderCandidateRgb(best.baseIndex, p1, best.c1, p2, best.c2, p3, best.c3);
      if (r !== targetR || g !== targetG || b !== targetB) {
        return;
      }

      const texts = [formatPercentage(p1)];
      if (mixCount >= 2) {
        texts.push(formatPercentage(p2));
      }
      if (mixCount >= 3) {
        texts.push(formatPercentage(p3));
      }

      const score = texts.reduce((sum, text) => sum + text.length, 0);
      const decimalsSum = decimals.reduce((sum, value) => sum + value, 0);
      const tieKey = texts.join("|");

      if (
        bestCandidate == null ||
        score < bestCandidate.score ||
        (score === bestCandidate.score &&
          (decimalsSum < bestCandidate.decimalsSum ||
            (decimalsSum === bestCandidate.decimalsSum && tieKey < bestCandidate.tieKey)))
      ) {
        bestCandidate = { p1, p2, p3, score, decimalsSum, tieKey };
      }
      return;
    }

    const raw = percentages[index]!;
    for (let places = 0; places <= 6; places += 1) {
      decimals[index] = places;
      rounded[index] = roundPercentage(raw, places);
      recurse(index + 1);
    }
  };

  recurse(0);

  const candidate = bestCandidate as DisplayCandidate | null;
  if (candidate) {
    return { p1: candidate.p1, p2: candidate.p2, p3: candidate.p3 };
  }

  return { p1: best.p1, p2: best.p2, p3: best.p3 };
}

function solveLinear3x3(matrix: readonly number[], vector: readonly number[]): [number, number, number] | null {
  const a = matrix[0]!;
  const b = matrix[1]!;
  const c = matrix[2]!;
  const d = matrix[3]!;
  const e = matrix[4]!;
  const f = matrix[5]!;
  const g = matrix[6]!;
  const h = matrix[7]!;
  const i = matrix[8]!;

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < ZERO_DETERMINANT_EPSILON) {
    return null;
  }

  const invDet = 1 / det;
  const v0 = vector[0]!;
  const v1 = vector[1]!;
  const v2 = vector[2]!;

  return [
    (v0 * (e * i - f * h) - b * (v1 * i - f * v2) + c * (v1 * h - e * v2)) * invDet,
    (a * (v1 * i - f * v2) - v0 * (d * i - f * g) + c * (d * v2 - v1 * g)) * invDet,
    (a * (e * v2 - v1 * h) - b * (d * v2 - v1 * g) + v0 * (d * h - e * g)) * invDet
  ];
}

function projectToSimplex(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => right - left);
  let cumulative = 0;
  let rho = -1;

  for (let index = 0; index < sorted.length; index += 1) {
    cumulative += sorted[index]!;
    const threshold = (cumulative - 1) / (index + 1);
    if (sorted[index]! > threshold) {
      rho = index;
    }
  }

  if (rho < 0) {
    return new Array(values.length).fill(1 / values.length);
  }

  const theta = (sorted.slice(0, rho + 1).reduce((sum, value) => sum + value, 0) - 1) / (rho + 1);
  return values.map((value) => Math.max(0, value - theta));
}

function fastAnalyticSearch(targetRgb: [number, number, number], maxMixes: 0 | 1 | 2 | 3, config: FastConfig): SearchBest {
  const [targetR, targetG, targetB] = targetRgb;

  let checked = 0;
  let bestError2 = Number.POSITIVE_INFINITY;
  let bestObjective = Number.NEGATIVE_INFINITY;
  let bestMixes: 0 | 1 | 2 | 3 = 3;
  let bestBaseIndex = -1;
  let bestP1 = -1;
  let bestC1 = -1;
  let bestP2 = -1;
  let bestC2 = -1;
  let bestP3 = -1;
  let bestC3 = -1;
  let bestR = 0;
  let bestG = 0;
  let bestB = 0;

  const maybeUpdate = (
    baseIndex: number,
    p1: number,
    c1: number,
    p2: number,
    c2: number,
    p3: number,
    c3: number,
    renderedR: number,
    renderedG: number,
    renderedB: number
  ): void => {
    checked += 1;

    const dr = renderedR - targetR;
    const dg = renderedG - targetG;
    const db = renderedB - targetB;
    const error2 = dr * dr + dg * dg + db * db;
    const length = expressionLength(baseIndex, p1, c1, p2, c2, p3, c3);
    const mixes: 0 | 1 | 2 | 3 = p3 >= 0 ? 3 : p2 >= 0 ? 2 : p1 >= 0 ? 1 : 0;
    const firstPercentage = p1 >= 0 ? p1 : 0;
    const objective = firstPercentage - 0.5 * length;

    if (error2 < bestError2) {
      bestError2 = error2;
      bestObjective = objective;
      bestMixes = mixes;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestP3 = p3;
      bestC3 = c3;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (error2 > bestError2) {
      return;
    }

    if (mixes < bestMixes) {
      bestObjective = objective;
      bestMixes = mixes;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestP3 = p3;
      bestC3 = c3;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (mixes > bestMixes) {
      return;
    }

    if (objective > bestObjective) {
      bestObjective = objective;
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestP3 = p3;
      bestC3 = c3;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
      return;
    }

    if (objective < bestObjective) {
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
        bestC2,
        p3,
        c3,
        bestP3,
        bestC3
      )
    ) {
      bestBaseIndex = baseIndex;
      bestP1 = p1;
      bestC1 = c1;
      bestP2 = p2;
      bestC2 = c2;
      bestP3 = p3;
      bestC3 = c3;
      bestR = renderedR;
      bestG = renderedG;
      bestB = renderedB;
    }
  };

  for (let baseIndex = 0; baseIndex < COLOR_COUNT; baseIndex += 1) {
    maybeUpdate(baseIndex, -1, -1, -1, -1, -1, -1, COLOR_R[baseIndex]!, COLOR_G[baseIndex]!, COLOR_B[baseIndex]!);
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
          projectedT = (tx * PAIR_DX[pairIndex]! + ty * PAIR_DY[pairIndex]! + tz * PAIR_DZ[pairIndex]!) * invDen;
          projectedT = clamp01(projectedT);
        }

        if (config.exact) {
          const t1 = projectedT;
          const u1 = 1 - t1;
          const renderedR = clampByte(COLOR_R[baseIndex]! * t1 + COLOR_R[mixIndex]! * u1);
          const renderedG = clampByte(COLOR_G[baseIndex]! * t1 + COLOR_G[mixIndex]! * u1);
          const renderedB = clampByte(COLOR_B[baseIndex]! * t1 + COLOR_B[mixIndex]! * u1);
          maybeUpdate(baseIndex, t1 * 100, mixIndex, -1, -1, -1, -1, renderedR, renderedG, renderedB);
          continue;
        }

        projectedT = clampInteger(roundToPercent(projectedT), 1, 99) / 100;
        const center = roundToPercent(projectedT);
        const start = Math.max(1, center - config.depth1Radius);
        const end = Math.min(99, center + config.depth1Radius);

        for (let p1 = start; p1 <= end; p1 += 1) {
          const t1 = p1 / 100;
          const u1 = 1 - t1;
          const renderedR = clampByte(COLOR_R[baseIndex]! * t1 + COLOR_R[mixIndex]! * u1);
          const renderedG = clampByte(COLOR_G[baseIndex]! * t1 + COLOR_G[mixIndex]! * u1);
          const renderedB = clampByte(COLOR_B[baseIndex]! * t1 + COLOR_B[mixIndex]! * u1);
          maybeUpdate(baseIndex, p1, mixIndex, -1, -1, -1, -1, renderedR, renderedG, renderedB);
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
      y = Math.max(TWO_MIX_MIN_Y, Math.min(y, x));

      if (config.exact) {
        const t2 = x;
        const t1 = t2 > 0 ? clamp01(y / t2) : 0;
        const alpha = t1 * t2;
        const beta = (1 - t1) * t2;
        const gamma = 1 - t2;

        const renderedR = clampByte(COLOR_R[a]! * alpha + COLOR_R[b]! * beta + COLOR_R[c]! * gamma);
        const renderedG = clampByte(COLOR_G[a]! * alpha + COLOR_G[b]! * beta + COLOR_G[c]! * gamma);
        const renderedB = clampByte(COLOR_B[a]! * alpha + COLOR_B[b]! * beta + COLOR_B[c]! * gamma);
        maybeUpdate(a, t1 * 100, b, t2 * 100, c, -1, -1, renderedR, renderedG, renderedB);
        continue;
      }

      x = clampInteger(roundToPercent(x), 1, 99) / 100;
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
          maybeUpdate(a, p1, b, p2, c, -1, -1, renderedR, renderedG, renderedB);
        }
      }
    }
  }

  if (maxMixes >= 3 && config.threeMixWhiteTail) {
    const targetFromWhite: [number, number, number] = [targetR - 255, targetG - 255, targetB - 255];

    for (let a = 0; a < COLOR_COUNT; a += 1) {
      const ar = COLOR_R[a]! - 255;
      const ag = COLOR_G[a]! - 255;
      const ab = COLOR_B[a]! - 255;

      for (let b = 0; b < COLOR_COUNT; b += 1) {
        const br = COLOR_R[b]! - 255;
        const bg = COLOR_G[b]! - 255;
        const bb = COLOR_B[b]! - 255;

        for (let c = 0; c < COLOR_COUNT; c += 1) {
          const cr = COLOR_R[c]! - 255;
          const cg = COLOR_G[c]! - 255;
          const cb = COLOR_B[c]! - 255;

          const matrix = [ar, br, cr, ag, bg, cg, ab, bb, cb] as const;
          const rawWeights = solveLinear3x3(matrix, targetFromWhite);
          if (!rawWeights) {
            continue;
          }

          const rawW0 = rawWeights[0];
          const rawW1 = rawWeights[1];
          const rawW2 = rawWeights[2];
          const projected = projectToSimplex([rawW0, rawW1, rawW2, 1 - rawW0 - rawW1 - rawW2]);

          const w0 = projected[0]!;
          const w1 = projected[1]!;
          const w2 = projected[2]!;
          const sum = w0 + w1 + w2;
          if (sum <= ZERO_DETERMINANT_EPSILON) {
            continue;
          }

          const q = w0 + w1;
          const t3 = sum;
          const t2 = q > ZERO_DETERMINANT_EPSILON ? q / t3 : 0;
          const t1 = q > ZERO_DETERMINANT_EPSILON ? w0 / q : 0;
          const p1 = t1 * 100;
          const p2 = t2 * 100;
          const p3 = t3 * 100;

          const renderedR = clampByte(COLOR_R[a]! * w0 + COLOR_R[b]! * w1 + COLOR_R[c]! * w2 + 255 * projected[3]!);
          const renderedG = clampByte(COLOR_G[a]! * w0 + COLOR_G[b]! * w1 + COLOR_G[c]! * w2 + 255 * projected[3]!);
          const renderedB = clampByte(COLOR_B[a]! * w0 + COLOR_B[b]! * w1 + COLOR_B[c]! * w2 + 255 * projected[3]!);
          maybeUpdate(a, p1, b, p2, c, p3, WHITE_INDEX, renderedR, renderedG, renderedB);
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
    p3: bestP3,
    c3: bestC3,
    renderedR: bestR,
    renderedG: bestG,
    renderedB: bestB,
    error2: bestError2,
    mixes: bestMixes,
    checked
  };
}

export function rgbToXcolorExpressionFast(target: RgbColor, options: FastOptions = {}): RgbToXcolorResult {
  const targetRgb = normalizeTargetRgb(target);
  const maxMixes = (options.threeMixWhiteTail === true
    ? 3
    : clampInteger(Math.floor(options.maxMixes ?? 2), 0, 3)) as 0 | 1 | 2 | 3;
  const config = normalizeFastConfig(options);
  const best = fastAnalyticSearch(targetRgb, maxMixes, config);
  const display = pickDisplayPercentages(best);
  const expression = renderExpression(best.baseIndex, display.p1, best.c1, display.p2, best.c2, display.p3, best.c3);

  return {
    targetRgb: {
      r: targetRgb[0],
      g: targetRgb[1],
      b: targetRgb[2]
    },
    expression,
    renderedRgb: {
      r: best.renderedR,
      g: best.renderedG,
      b: best.renderedB
    },
    exact: best.error2 === 0,
    error2: best.error2,
    error: Math.sqrt(best.error2),
    mixes: best.mixes,
    length: expression.length,
    checked: best.checked,
    mode: config.mode
  };
}
