import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { rgbToXcolorExpressionFast, type RgbColor, type RgbToXcolorMode } from "tikz-editor/edit/rgb-to-xcolor";
import { normalizeColor } from "tikz-editor/semantic/style/colors";
import { BASIC_PICKER_COLORS, BASIC_PICKER_COLOR_SET } from "../color-palette";
import type { NamedColorSwatch } from "../project-named-colors";
import { useSettingsStore } from "../settings/useSettingsStore";
import type { ColorPickerAccuracy } from "../settings/types";
import { expandGrayAliasToBlackMix, serializeBlackMixToGrayAlias } from "./color-picker-grayscale";
import { parseCustomColorInput } from "./custom-color-input";
import css from "./ColorPicker.module.css";

type ColorPickerTabId = "standard" | "custom";
type ToneState = { baseColor: string; position: number };
type PopoverPlacement = "down" | "up";
type ToneHitBucket = { value: number; start: number; end: number; center: number };

const BUILTIN_COLOR_SET = BASIC_PICKER_COLOR_SET;
const NO_TONE_COLORS = new Set(["none", "black", "white"]);
const PREFERRED_BASE_COLORS = ["green", "red", "blue", "magenta", "cyan", "yellow"];
const COLOR_TOKEN_PATTERN = "([a-z][a-z0-9._:@-]*)";
const DARK_MIX_RE = new RegExp(`^${COLOR_TOKEN_PATTERN}\\s*!\\s*([0-9]+(?:\\.[0-9]+)?)\\s*!\\s*black\\s*$`, "u");
const LIGHT_MIX_RE = new RegExp(`^${COLOR_TOKEN_PATTERN}\\s*!\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$`, "u");
const BLACK_LIGHT_RE = /^black\s*!\s*([0-9]+(?:\.[0-9]+)?)\s*$/u;
const TONE_MIN = 0;
const TONE_MID = 100;
const TONE_MAX = 200;
const TONE_MULTIPLE_OF_TEN_WEIGHT = 2.2;
const POPOVER_GAP_PX = 2;
const POPOVER_VIEWPORT_PADDING_PX = 8;
const POPOVER_MIN_HEIGHT_PX = 120;
const POPOVER_MAX_HEIGHT_PX = 360;
const DEFAULT_CUSTOM_RGB: RgbColor = { r: 0, g: 255, b: 0 };
const CUSTOM_PARSE_ERROR_MESSAGE = "Unrecognized color format.";
const TONE_HIT_BUCKETS = buildToneHitBuckets();

export type ColorPickerProps = {
  ariaLabel: string;
  options: readonly string[];
  namedColorSwatches?: readonly NamedColorSwatch[];
  value: string | null;
  syntaxValue?: string | null;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function ColorPickerField({
  ariaLabel,
  options,
  namedColorSwatches = [],
  value,
  syntaxValue = null,
  mixed = false,
  disabled = false,
  onChange
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverPlacement, setPopoverPlacement] = useState<PopoverPlacement>("down");
  const [popoverMaxHeight, setPopoverMaxHeight] = useState<number>(POPOVER_MAX_HEIGHT_PX);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const normalizedNamedColorSwatches = useMemo(
    () => normalizeNamedColorSwatches(namedColorSwatches),
    [namedColorSwatches]
  );
  const namedColorLookup = useMemo(
    () => buildNamedColorLookup(normalizedNamedColorSwatches),
    [normalizedNamedColorSwatches]
  );
  const normalizedValue = normalizeColorToken(value);
  const normalizedSyntaxValue = normalizeColorToken(syntaxValue);
  const displayLabel = mixed ? "mixed" : (normalizedSyntaxValue ?? normalizedValue ?? "none");
  const displaySwatchToken = mixed ? null : (normalizedSyntaxValue ?? normalizedValue ?? "none");
  const displaySwatchColor = displaySwatchToken
    ? cssColorForToken(displaySwatchToken, namedColorLookup)
    : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updatePopoverPlacement(): void {
      const root = rootRef.current;
      const popover = popoverRef.current;
      if (!root || !popover) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rootRect.bottom - POPOVER_VIEWPORT_PADDING_PX - POPOVER_GAP_PX;
      const spaceAbove = rootRect.top - POPOVER_VIEWPORT_PADDING_PX - POPOVER_GAP_PX;
      const naturalHeight = popover.scrollHeight;
      const shouldOpenUpward = naturalHeight > spaceBelow && spaceAbove > 0;
      const nextPlacement: PopoverPlacement = shouldOpenUpward ? "up" : "down";
      const availableSpace = nextPlacement === "up" ? spaceAbove : spaceBelow;
      const boundedMaxHeight = Math.min(
        POPOVER_MAX_HEIGHT_PX,
        Math.max(POPOVER_MIN_HEIGHT_PX, Math.floor(availableSpace))
      );

      setPopoverPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      setPopoverMaxHeight((current) => (current === boundedMaxHeight ? current : boundedMaxHeight));
    }

    updatePopoverPlacement();
    window.addEventListener("resize", updatePopoverPlacement);
    window.addEventListener("scroll", updatePopoverPlacement, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPlacement);
      window.removeEventListener("scroll", updatePopoverPlacement, true);
    };
  }, [open]);

  return (
    <div className={css.fieldRoot} ref={rootRef}>
      <button
        type="button"
        className={[css.triggerButton, open ? css.triggerButtonOpen : ""].filter(Boolean).join(" ")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <span className={css.triggerValue}>
          <span
            className={[
              css.triggerSwatch,
              displayLabel === "none" || mixed ? css.triggerSwatchNone : ""
            ]
              .filter(Boolean)
              .join(" ")}
            style={displaySwatchColor != null ? { background: displaySwatchColor } : undefined}
            aria-hidden="true"
          />
          <span className={css.triggerLabel}>{displayLabel}</span>
        </span>
        <span className={css.triggerCaret} aria-hidden="true">
          <svg className={css.triggerCaretIcon} viewBox="0 0 12 8" focusable="false">
            <path d="M1.5 1.5L6 6.5L10.5 1.5" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          className={[css.popover, popoverPlacement === "up" ? css.popoverUp : ""].filter(Boolean).join(" ")}
          ref={popoverRef}
          style={{ maxHeight: `${popoverMaxHeight}px` }}
        >
          <ColorPicker
            ariaLabel={ariaLabel}
            value={value}
            syntaxValue={syntaxValue}
            options={options}
            namedColorSwatches={normalizedNamedColorSwatches}
            mixed={mixed}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ColorPicker({
  ariaLabel,
  options,
  namedColorSwatches = [],
  value,
  syntaxValue = null,
  mixed = false,
  disabled = false,
  onChange
}: ColorPickerProps) {
  const colorPickerAccuracy = useSettingsStore((s) => s.settings.colorPicker.accuracy);
  const normalizedSyntaxValue = normalizeColorToken(syntaxValue);
  const normalizedValue = normalizeColorToken(value);
  const driverValue = normalizedSyntaxValue ?? normalizedValue;
  const grayscaleDriverValue = expandGrayAliasToBlackMix(driverValue);
  const builtInColors = useMemo(() => buildBuiltInColorList(options), [options]);
  const normalizedNamedColorSwatches = useMemo(
    () => normalizeNamedColorSwatches(namedColorSwatches),
    [namedColorSwatches]
  );
  const namedColorLookup = useMemo(
    () => buildNamedColorLookup(normalizedNamedColorSwatches),
    [normalizedNamedColorSwatches]
  );
  const namedColorTokenSet = useMemo(
    () => new Set(normalizedNamedColorSwatches.map((swatch) => swatch.token)),
    [normalizedNamedColorSwatches]
  );
  const toneSelectableTokens = useMemo(() => {
    const tokens = new Set<string>();
    for (const color of builtInColors) {
      if (!NO_TONE_COLORS.has(color)) {
        tokens.add(color);
      }
    }
    for (const token of namedColorTokenSet) {
      if (!NO_TONE_COLORS.has(token)) {
        tokens.add(token);
      }
    }
    return tokens;
  }, [builtInColors, namedColorTokenSet]);
  const initialTab = useMemo<ColorPickerTabId>(
    () =>
      isStandardTabColorSupported(grayscaleDriverValue, namedColorTokenSet, toneSelectableTokens, mixed)
        ? "standard"
        : "custom",
    [grayscaleDriverValue, mixed, namedColorTokenSet, toneSelectableTokens]
  );
  const [tab, setTab] = useState<ColorPickerTabId>(() => initialTab);
  const previousTabRef = useRef<ColorPickerTabId>(initialTab);
  const [activeBaseColor, setActiveBaseColor] = useState<string>(() =>
    pickInitialBaseColor(grayscaleDriverValue, builtInColors, toneSelectableTokens)
  );
  const brightnessTrackRef = useRef<HTMLDivElement | null>(null);
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);
  const [customRgb, setCustomRgb] = useState<RgbColor>(() => resolveCustomRgbFromDriver(driverValue, namedColorLookup));
  const [customInputValue, setCustomInputValue] = useState<string>(() => rgbToHex(resolveCustomRgbFromDriver(driverValue, namedColorLookup)));
  const [customExpression, setCustomExpression] = useState<string>(() =>
    rgbToXcolorExpressionFast(
      resolveCustomRgbFromDriver(driverValue, namedColorLookup),
      resolveRgbToXcolorOptions("drag", colorPickerAccuracy)
    ).expression
  );
  const [customInputError, setCustomInputError] = useState<string | null>(null);
  const [customInputWarning, setCustomInputWarning] = useState<string | null>(null);

  const toneState = useMemo(
    () => deriveToneState(grayscaleDriverValue, activeBaseColor, toneSelectableTokens),
    [grayscaleDriverValue, activeBaseColor, toneSelectableTokens]
  );

  useEffect(() => {
    if (!isToneBaseColor(toneState.baseColor) || toneState.baseColor === activeBaseColor) {
      return;
    }
    setActiveBaseColor(toneState.baseColor);
  }, [toneState.baseColor, activeBaseColor]);

  useEffect(() => {
    if (isToneBaseColor(activeBaseColor) && toneSelectableTokens.has(activeBaseColor)) {
      return;
    }
    setActiveBaseColor(pickInitialBaseColor(grayscaleDriverValue, builtInColors, toneSelectableTokens));
  }, [activeBaseColor, builtInColors, grayscaleDriverValue, toneSelectableTokens]);

  useEffect(() => {
    if (!disabled) {
      return;
    }
    setDragPointerId(null);
  }, [disabled]);

  useEffect(() => {
    const previousTab = previousTabRef.current;
    const enteredCustom = previousTab !== "custom" && tab === "custom";
    previousTabRef.current = tab;
    if (tab !== "custom" || enteredCustom) {
      syncCustomStateFromDriver();
    }
  }, [tab, driverValue, namedColorLookup]);

  useEffect(() => {
    setCustomExpression(
      rgbToXcolorExpressionFast(customRgb, resolveRgbToXcolorOptions("drag", colorPickerAccuracy)).expression
    );
  }, [customRgb, colorPickerAccuracy]);

  const selectedSwatchColor = useMemo(
    () => resolveSelectedSwatchColor(driverValue, namedColorTokenSet, toneSelectableTokens),
    [driverValue, namedColorTokenSet, toneSelectableTokens]
  );
  const grayscaleMode = isGrayscaleMode(grayscaleDriverValue);
  const gradientBaseCssColor = grayscaleMode
    ? "#808080"
    : (cssColorForToken(activeBaseColor, namedColorLookup) ?? "#00ff00");
  const currentToneColor = grayscaleMode
    ? composeGrayscaleToneColor(toneState.position)
    : composeToneColor(activeBaseColor, toneState.position);
  const showBrightnessScrubber = mixed || (driverValue != null && driverValue !== "none");
  const showCenterLabel = !grayscaleMode;
  const customIdPrefix = useMemo(
    () => ariaLabel.trim().toLowerCase().replace(/[^a-z0-9_-]+/giu, "-"),
    [ariaLabel]
  );

  function applyColor(nextColor: string): void {
    if (disabled) {
      return;
    }
    if (!mixed && normalizeColorToken(nextColor) === driverValue) {
      return;
    }
    onChange(nextColor);
  }

  function applyTone(nextTonePosition: number): void {
    const nextColor = grayscaleMode
      ? composeGrayscaleToneColor(nextTonePosition)
      : composeToneColor(activeBaseColor, nextTonePosition);
    applyColor(nextColor);
  }

  function toneFromClientX(clientX: number): number {
    const track = brightnessTrackRef.current;
    if (!track) {
      return toneState.position;
    }
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return toneState.position;
    }
    const ratioFromLeft = clamp01((clientX - rect.left) / rect.width);
    return tonePositionFromHitRatio(ratioFromLeft);
  }

  function handleSwatchClick(colorName: string): void {
    if (disabled) {
      return;
    }
    if (colorName === "none" || colorName === "black" || colorName === "white") {
      applyColor(colorName);
      return;
    }
    if (!toneSelectableTokens.has(colorName)) {
      applyColor(colorName);
      return;
    }

    setActiveBaseColor(colorName);
    const preserveTone = driverValue != null && driverValue !== "none" && driverValue !== "black" && driverValue !== "white";
    const nextTone = preserveTone ? toneState.position : TONE_MID;
    const nextColor = composeToneColor(colorName, nextTone);
    applyColor(nextColor);
  }

  function handleBrightnessPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    setDragPointerId(event.pointerId);
    event.currentTarget.setPointerCapture(event.pointerId);
    applyTone(toneFromClientX(event.clientX));
  }

  function handleBrightnessPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (disabled || dragPointerId == null || event.pointerId !== dragPointerId) {
      return;
    }
    applyTone(toneFromClientX(event.clientX));
  }

  function handleBrightnessPointerEnd(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragPointerId == null || event.pointerId !== dragPointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragPointerId(null);
  }

  function handleBrightnessKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }

    let nextPosition: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextPosition = toneState.position + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextPosition = toneState.position - 1;
    } else if (event.key === "PageUp") {
      nextPosition = toneState.position + 10;
    } else if (event.key === "PageDown") {
      nextPosition = toneState.position - 10;
    } else if (event.key === "Home") {
      nextPosition = TONE_MIN;
    } else if (event.key === "End") {
      nextPosition = TONE_MAX;
    }

    if (nextPosition == null) {
      return;
    }
    event.preventDefault();
    applyTone(clampTonePosition(nextPosition));
  }

  function syncCustomStateFromDriver(): void {
    const resolved = resolveCustomRgbFromDriver(driverValue, namedColorLookup);
    setCustomRgb(resolved);
    setCustomInputValue(rgbToHex(resolved));
    setCustomExpression(
      rgbToXcolorExpressionFast(resolved, resolveRgbToXcolorOptions("drag", colorPickerAccuracy)).expression
    );
    setCustomInputError(null);
    setCustomInputWarning(null);
  }

  function applyCustomRgb(nextRgb: RgbColor, mode: RgbToXcolorMode, warning: string | null = null): void {
    const normalizedRgb = clampRgbColor(nextRgb);
    const result = rgbToXcolorExpressionFast(normalizedRgb, resolveRgbToXcolorOptions(mode, colorPickerAccuracy));
    setCustomRgb(normalizedRgb);
    setCustomExpression(result.expression);
    setCustomInputError(null);
    setCustomInputWarning(warning);
    applyColor(result.expression);
  }

  function handleCustomColorWell(rawHex: string, mode: RgbToXcolorMode): void {
    const parsed = parseCustomColorInput(rawHex);
    if (!parsed) {
      return;
    }
    setCustomInputValue(parsed.hex);
    applyCustomRgb(parsed.rgb, mode, parsed.warning ?? null);
  }

  function handleCustomChannelChange(channel: keyof RgbColor, rawValue: string, mode: RgbToXcolorMode): void {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const clamped = clampRgbByte(parsed);
    const nextRgb: RgbColor =
      channel === "r"
        ? { ...customRgb, r: clamped }
        : channel === "g"
          ? { ...customRgb, g: clamped }
          : { ...customRgb, b: clamped };
    setCustomInputValue(rgbToHex(nextRgb));
    applyCustomRgb(nextRgb, mode, null);
  }

  function handleCustomTextInputChange(rawValue: string): void {
    setCustomInputValue(rawValue);
    const parsed = parseCustomColorInput(rawValue);
    if (!parsed) {
      setCustomInputError(CUSTOM_PARSE_ERROR_MESSAGE);
      setCustomInputWarning(null);
      return;
    }
    applyCustomRgb(parsed.rgb, "drag", parsed.warning ?? null);
  }

  function commitCustomTextInput(): void {
    const parsed = parseCustomColorInput(customInputValue);
    if (!parsed) {
      setCustomInputError(CUSTOM_PARSE_ERROR_MESSAGE);
      setCustomInputWarning(null);
      return;
    }
    setCustomInputValue(parsed.hex);
    applyCustomRgb(parsed.rgb, "release", parsed.warning ?? null);
  }

  return (
    <div className={[css.root, disabled ? css.rootDisabled : ""].filter(Boolean).join(" ")}>
      <div className={css.tabRow} role="tablist" aria-label={`${ariaLabel} picker tabs`}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "standard"}
          className={[css.tabButton, tab === "standard" ? css.tabButtonActive : ""].filter(Boolean).join(" ")}
          onClick={() => setTab("standard")}
          disabled={disabled}
        >
          Standard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "custom"}
          className={[css.tabButton, tab === "custom" ? css.tabButtonActive : ""].filter(Boolean).join(" ")}
          onClick={() => setTab("custom")}
          disabled={disabled}
        >
          Custom
        </button>
      </div>

      {tab === "standard" ? (
        <div className={css.standardTabPanel} role="tabpanel">
          <div className={css.swatchStack}>
            {normalizedNamedColorSwatches.length > 0 ? (
              <>
                <div className={css.colorGrid}>
                  {normalizedNamedColorSwatches.map((swatch) => {
                    const selected = selectedSwatchColor === swatch.token;
                    return (
                      <button
                        key={swatch.token}
                        type="button"
                        className={[css.swatchButton, selected ? css.swatchButtonSelected : ""].filter(Boolean).join(" ")}
                        title={swatch.token}
                        aria-label={`${ariaLabel} ${swatch.token}`}
                        onClick={() => handleSwatchClick(swatch.token)}
                        disabled={disabled}
                      >
                        <span className={css.swatchDot} style={{ background: swatch.cssColor }} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
                <div className={css.colorGridDivider} aria-hidden="true" />
              </>
            ) : null}

            <div className={css.colorGrid}>
              {builtInColors.map((colorName) => {
                const selected = selectedSwatchColor === colorName;
                return (
                  <button
                    key={colorName}
                    type="button"
                    className={[css.swatchButton, selected ? css.swatchButtonSelected : ""].filter(Boolean).join(" ")}
                    title={colorName}
                    aria-label={`${ariaLabel} ${colorName}`}
                    onClick={() => handleSwatchClick(colorName)}
                    disabled={disabled}
                  >
                    <span
                      className={[css.swatchDot, colorName === "none" ? css.swatchDotNone : ""].filter(Boolean).join(" ")}
                      style={
                        colorName !== "none"
                          ? { background: cssColorForToken(colorName, namedColorLookup) ?? "transparent" }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {showBrightnessScrubber ? (
            <div className={css.brightnessSection}>
              <div
                ref={brightnessTrackRef}
                className={[css.brightnessTrack, disabled ? css.brightnessTrackDisabled : ""].filter(Boolean).join(" ")}
                role="slider"
                aria-label={`${ariaLabel} brightness`}
                aria-orientation="horizontal"
                aria-valuemin={TONE_MIN}
                aria-valuemax={TONE_MAX}
                aria-valuenow={toneState.position}
                aria-valuetext={currentToneColor}
                tabIndex={disabled ? -1 : 0}
                style={{
                  background: `linear-gradient(to right, #000000 0%, ${gradientBaseCssColor} 50%, #ffffff 100%)`
                }}
                onPointerDown={handleBrightnessPointerDown}
                onPointerMove={handleBrightnessPointerMove}
                onPointerUp={handleBrightnessPointerEnd}
                onPointerCancel={handleBrightnessPointerEnd}
                onKeyDown={handleBrightnessKeyDown}
              >
                <span
                  className={css.brightnessThumb}
                  style={{ left: `${tonePositionToThumbPercent(toneState.position)}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className={css.brightnessLabels} aria-hidden="true">
                <span className={[css.brightnessBaseLabel, css.brightnessEdgeLabel].join(" ")}>black</span>
                <span className={[css.brightnessBaseLabel, css.brightnessCenterLabel].join(" ")}>
                  {showCenterLabel ? activeBaseColor : ""}
                </span>
                <span className={[css.brightnessBaseLabel, css.brightnessEdgeLabel, css.brightnessEdgeLabelRight].join(" ")}>
                  white
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={css.customTabPanel} role="tabpanel">
          <div className={css.customColorWellRow}>
            <label className={css.customLabel} htmlFor={`${customIdPrefix}-custom-well`}>
              Color
            </label>
            <input
              id={`${customIdPrefix}-custom-well`}
              className={css.customColorWell}
              type="color"
              value={rgbToHex(customRgb)}
              disabled={disabled}
              onInput={(event) => handleCustomColorWell(event.currentTarget.value, "drag")}
              onChange={(event) => handleCustomColorWell(event.currentTarget.value, "release")}
            />
          </div>

          <div className={css.customChannelStack}>
            {(["r", "g", "b"] as const).map((channel) => {
              const channelLabel = channel.toUpperCase();
              const channelValue = customRgb[channel];
              return (
                <div key={channel} className={css.customChannelRow}>
                  <label className={css.customChannelLabel} htmlFor={`${customIdPrefix}-custom-${channel}-range`}>
                    {channelLabel}
                  </label>
                  <input
                    id={`${customIdPrefix}-custom-${channel}-range`}
                    className={css.customChannelRange}
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={channelValue}
                    disabled={disabled}
                    onChange={(event) => handleCustomChannelChange(channel, event.currentTarget.value, "drag")}
                    onPointerUp={(event) => handleCustomChannelChange(channel, event.currentTarget.value, "release")}
                    onBlur={(event) => handleCustomChannelChange(channel, event.currentTarget.value, "release")}
                  />
                  <input
                    className={css.customChannelNumber}
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    value={channelValue}
                    disabled={disabled}
                    onChange={(event) => handleCustomChannelChange(channel, event.currentTarget.value, "drag")}
                    onBlur={(event) => handleCustomChannelChange(channel, event.currentTarget.value, "release")}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }
                      event.preventDefault();
                      handleCustomChannelChange(channel, event.currentTarget.value, "release");
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className={css.customField}>
            <label className={css.customLabel} htmlFor={`${customIdPrefix}-custom-text`}>
              Color Input
            </label>
            <div className={css.customTextInputWrap}>
              <input
                id={`${customIdPrefix}-custom-text`}
                className={[css.customTextInput, customInputError ? css.customTextInputError : ""].filter(Boolean).join(" ")}
                type="text"
                value={customInputValue}
                placeholder="#00ff00, rgb(...), hsl(...), hsb(...)"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={disabled}
                aria-invalid={customInputError ? "true" : "false"}
                title={customInputError ?? undefined}
                onChange={(event) => handleCustomTextInputChange(event.currentTarget.value)}
                onBlur={() => commitCustomTextInput()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  commitCustomTextInput();
                }}
              />
              {customInputError ? (
                <span className={css.customTextInputStatus} aria-hidden="true">
                  !
                </span>
              ) : null}
            </div>
          </div>

          <div className={css.customField}>
            <label className={css.customLabel} htmlFor={`${customIdPrefix}-custom-expression`}>
              xcolor
            </label>
            <input
              id={`${customIdPrefix}-custom-expression`}
              className={css.customResultInput}
              type="text"
              value={customExpression}
              readOnly
              aria-readonly="true"
              disabled={disabled}
            />
          </div>

          {customInputWarning ? (
            <div className={css.customMessageWarning} role="status">
              {customInputWarning}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function resolveRgbToXcolorOptions(
  mode: RgbToXcolorMode,
  accuracy: ColorPickerAccuracy
): { mode: RgbToXcolorMode; maxMixes: 2 | 3; exact?: true; threeMixWhiteTail?: true } {
  if (accuracy === "exact") {
    return {
      mode,
      maxMixes: 3,
      exact: true,
      threeMixWhiteTail: true
    };
  }
  return {
    mode,
    maxMixes: 2
  };
}

function isStandardTabColorSupported(
  driverValue: string | null,
  namedColorTokens: ReadonlySet<string>,
  toneSelectableTokens: ReadonlySet<string>,
  mixed: boolean
): boolean {
  if (mixed || driverValue == null) {
    return true;
  }
  if (namedColorTokens.has(driverValue) || BUILTIN_COLOR_SET.has(driverValue)) {
    return true;
  }
  if (BLACK_LIGHT_RE.test(driverValue)) {
    return true;
  }

  const darkMatch = driverValue.match(DARK_MIX_RE);
  if (darkMatch && toneSelectableTokens.has(darkMatch[1]!)) {
    return true;
  }

  const lightMatch = driverValue.match(LIGHT_MIX_RE);
  if (lightMatch && toneSelectableTokens.has(lightMatch[1]!)) {
    return true;
  }

  return false;
}

function resolveCustomRgbFromDriver(
  driverValue: string | null,
  namedColorLookup: ReadonlyMap<string, string>
): RgbColor {
  if (driverValue) {
    const resolved = resolveColorTokenToRgbForPicker(driverValue, namedColorLookup, "black");
    if (resolved) {
      return clampRgbColor(resolved);
    }
  }
  return { ...DEFAULT_CUSTOM_RGB };
}

function clampRgbColor(rgb: RgbColor): RgbColor {
  return {
    r: clampRgbByte(rgb.r),
    g: clampRgbByte(rgb.g),
    b: clampRgbByte(rgb.b)
  };
}

function clampRgbByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function normalizeColorToken(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function buildBuiltInColorList(options: readonly string[]): string[] {
  const seen = new Set<string>();
  const builtIns: string[] = [];
  for (const option of options) {
    const normalized = option.trim().toLowerCase();
    if (normalized.length === 0 || !BUILTIN_COLOR_SET.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    builtIns.push(normalized);
  }
  return builtIns.length > 0 ? builtIns : [...BASIC_PICKER_COLORS];
}

function normalizeNamedColorSwatches(swatches: readonly NamedColorSwatch[]): NamedColorSwatch[] {
  const normalized: NamedColorSwatch[] = [];
  const seen = new Set<string>();

  for (const swatch of swatches) {
    const token = normalizeColorToken(swatch.token);
    const cssColor = swatch.cssColor.trim();
    if (!token || cssColor.length === 0 || BUILTIN_COLOR_SET.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    normalized.push({
      token,
      cssColor
    });
  }

  return normalized;
}

function buildNamedColorLookup(swatches: readonly NamedColorSwatch[]): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const swatch of swatches) {
    lookup.set(swatch.token, swatch.cssColor);
  }
  return lookup;
}

function pickInitialBaseColor(
  driverValue: string | null,
  builtInColors: readonly string[],
  toneSelectableTokens: ReadonlySet<string>
): string {
  const fromValue = baseColorFromValue(driverValue, toneSelectableTokens);
  if (fromValue && isToneBaseColor(fromValue)) {
    return fromValue;
  }
  for (const preferred of PREFERRED_BASE_COLORS) {
    if (builtInColors.includes(preferred)) {
      return preferred;
    }
  }
  for (const color of builtInColors) {
    if (isToneBaseColor(color)) {
      return color;
    }
  }
  return "green";
}

function baseColorFromValue(driverValue: string | null, toneSelectableTokens: ReadonlySet<string>): string | null {
  if (!driverValue) {
    return null;
  }
  if (toneSelectableTokens.has(driverValue)) {
    return driverValue;
  }

  const darkMatch = driverValue.match(DARK_MIX_RE);
  if (darkMatch && toneSelectableTokens.has(darkMatch[1]!)) {
    return darkMatch[1]!;
  }
  const lightMatch = driverValue.match(LIGHT_MIX_RE);
  if (lightMatch && toneSelectableTokens.has(lightMatch[1]!)) {
    return lightMatch[1]!;
  }
  return null;
}

function deriveToneState(
  driverValue: string | null,
  fallbackBaseColor: string,
  toneSelectableTokens: ReadonlySet<string>
): ToneState {
  if (!driverValue || driverValue === "none") {
    return { baseColor: fallbackBaseColor, position: TONE_MID };
  }
  if (driverValue === "black") {
    return { baseColor: fallbackBaseColor, position: TONE_MIN };
  }
  if (driverValue === "white") {
    return { baseColor: fallbackBaseColor, position: TONE_MAX };
  }
  const blackLightMatch = driverValue.match(BLACK_LIGHT_RE);
  if (blackLightMatch) {
    const blackPercent = clampPercent(Number(blackLightMatch[1]!));
    return { baseColor: fallbackBaseColor, position: clampTonePosition((100 - blackPercent) * 2) };
  }

  const darkMatch = driverValue.match(DARK_MIX_RE);
  if (darkMatch && toneSelectableTokens.has(darkMatch[1]!)) {
    const baseColor = isToneBaseColor(darkMatch[1]!) ? darkMatch[1]! : fallbackBaseColor;
    const percent = clampPercent(Number(darkMatch[2]!));
    return { baseColor, position: percent };
  }

  const lightMatch = driverValue.match(LIGHT_MIX_RE);
  if (lightMatch && toneSelectableTokens.has(lightMatch[1]!)) {
    const baseColor = isToneBaseColor(lightMatch[1]!) ? lightMatch[1]! : fallbackBaseColor;
    const percent = clampPercent(Number(lightMatch[2]!));
    return { baseColor, position: TONE_MAX - percent };
  }

  if (toneSelectableTokens.has(driverValue) && isToneBaseColor(driverValue)) {
    return { baseColor: driverValue, position: TONE_MID };
  }
  return { baseColor: fallbackBaseColor, position: TONE_MID };
}

function resolveSelectedSwatchColor(
  driverValue: string | null,
  namedColorTokens: ReadonlySet<string>,
  toneSelectableTokens: ReadonlySet<string>
): string | null {
  if (!driverValue) {
    return null;
  }
  if (namedColorTokens.has(driverValue)) {
    return driverValue;
  }
  if (BUILTIN_COLOR_SET.has(driverValue)) {
    return driverValue;
  }
  const darkMatch = driverValue.match(DARK_MIX_RE);
  if (darkMatch && toneSelectableTokens.has(darkMatch[1]!)) {
    return darkMatch[1]!;
  }
  const lightMatch = driverValue.match(LIGHT_MIX_RE);
  if (lightMatch && toneSelectableTokens.has(lightMatch[1]!)) {
    return lightMatch[1]!;
  }
  return null;
}

function composeToneColor(baseColor: string, tonePosition: number): string {
  const clampedTone = clampTonePosition(tonePosition);
  if (clampedTone <= TONE_MIN) {
    return "black";
  }
  if (clampedTone >= TONE_MAX) {
    return "white";
  }
  if (clampedTone === TONE_MID) {
    return baseColor;
  }
  if (clampedTone < TONE_MID) {
    return `${baseColor}!${clampedTone}!black`;
  }
  const lightMixPercent = TONE_MAX - clampedTone;
  return `${baseColor}!${lightMixPercent}`;
}

function composeGrayscaleToneColor(tonePosition: number): string {
  const clampedTone = clampTonePosition(tonePosition);
  if (clampedTone <= TONE_MIN) {
    return "black";
  }
  if (clampedTone >= TONE_MAX) {
    return "white";
  }
  const blackPercent = clampPercent(100 - clampedTone / 2);
  if (blackPercent <= 0) {
    return "white";
  }
  if (blackPercent >= 100) {
    return "black";
  }
  return serializeBlackMixToGrayAlias(blackPercent);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return TONE_MID;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

function clampTonePosition(value: number): number {
  if (value <= TONE_MIN) {
    return TONE_MIN;
  }
  if (value >= TONE_MAX) {
    return TONE_MAX;
  }
  return Math.round(value);
}

function tonePositionToThumbPercent(position: number): number {
  const clamped = clampTonePosition(position);
  if (clamped <= TONE_MIN) {
    return 0;
  }
  if (clamped >= TONE_MAX) {
    return 100;
  }
  const bucket = TONE_HIT_BUCKETS[clamped - TONE_MIN];
  if (!bucket) {
    return (clamped / TONE_MAX) * 100;
  }
  return bucket.center * 100;
}

function isToneBaseColor(color: string): boolean {
  return !NO_TONE_COLORS.has(color);
}

function cssColorForToken(token: string, namedColorLookup: ReadonlyMap<string, string> | null = null): string | null {
  const normalizedToken = normalizeColorToken(token);
  if (!normalizedToken || normalizedToken === "none") {
    return null;
  }

  const namedColor = namedColorLookup?.get(normalizedToken);
  if (namedColor) {
    return namedColor;
  }

  const mixedColor = resolveMixedColorForPicker(normalizedToken, namedColorLookup);
  if (mixedColor) {
    return mixedColor;
  }

  const normalized = normalizeColor(normalizedToken);
  if (normalized.length === 0 || normalized === "none") {
    return null;
  }
  return normalized;
}

function resolveMixedColorForPicker(
  raw: string,
  namedColorLookup: ReadonlyMap<string, string> | null
): string | null {
  const parts = raw.split("!").map((part) => part.trim());
  if (parts.length <= 1 || !parts[0]) {
    return null;
  }

  let current = resolveColorTokenToRgbForPicker(parts[0], namedColorLookup, "black");
  if (!current) {
    return null;
  }

  let cursor = 1;
  while (cursor < parts.length) {
    const percentageRaw = parts[cursor];
    const percentage = Number(percentageRaw);
    if (!percentageRaw || !Number.isFinite(percentage)) {
      return null;
    }
    cursor += 1;

    const mixToken = parts[cursor] && parts[cursor]!.length > 0 ? parts[cursor]! : "white";
    if (parts[cursor] && parts[cursor]!.length > 0) {
      cursor += 1;
    }

    const mixColor = resolveColorTokenToRgbForPicker(mixToken, namedColorLookup, "white");
    if (!mixColor) {
      return null;
    }

    const t = clamp01(percentage / 100);
    current = {
      r: current.r * t + mixColor.r * (1 - t),
      g: current.g * t + mixColor.g * (1 - t),
      b: current.b * t + mixColor.b * (1 - t)
    };
  }

  return rgbToHex(current);
}

function resolveColorTokenToRgbForPicker(
  tokenRaw: string,
  namedColorLookup: ReadonlyMap<string, string> | null,
  relativeFallback: string
): { r: number; g: number; b: number } | null {
  const token = tokenRaw.trim().toLowerCase();
  if (token.length === 0) {
    return null;
  }
  const resolvedToken = token === "." ? relativeFallback : token;

  const namedColor = namedColorLookup?.get(resolvedToken);
  if (namedColor) {
    return hexToRgb(namedColor);
  }

  const normalized = normalizeColor(resolvedToken);
  if (!isHexColor(normalized)) {
    return null;
  }
  return hexToRgb(normalized);
}

function isHexColor(input: string): boolean {
  return /^#[0-9a-f]{3}$/iu.test(input) || /^#[0-9a-f]{6}$/iu.test(input);
}

function normalizeHex(input: string): string {
  const raw = input.trim().toLowerCase().replace(/^#/, "");
  if (raw.length === 3) {
    return `#${raw
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  return `#${raw}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex).replace(/^#/, "");
  const parsed = Number.parseInt(normalized, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((component) => Math.round(Math.max(0, Math.min(255, component))))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}

function isGrayscaleMode(driverValue: string | null): boolean {
  if (!driverValue) {
    return false;
  }
  if (driverValue === "black" || driverValue === "white") {
    return true;
  }
  return BLACK_LIGHT_RE.test(driverValue);
}

function buildToneHitBuckets(): ToneHitBucket[] {
  const weights: number[] = [];
  let totalWeight = 0;
  for (let value = TONE_MIN; value <= TONE_MAX; value += 1) {
    const weight = toneHitWeight(value);
    weights.push(weight);
    totalWeight += weight;
  }

  const buckets: ToneHitBucket[] = [];
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index]!;
    const start = cursor / totalWeight;
    cursor += weight;
    const end = cursor / totalWeight;
    buckets.push({
      value: TONE_MIN + index,
      start,
      end,
      center: (start + end) / 2
    });
  }
  return buckets;
}

function toneHitWeight(value: number): number {
  if (value % 10 === 0) {
    return TONE_MULTIPLE_OF_TEN_WEIGHT;
  }
  return 1;
}

function tonePositionFromHitRatio(ratio: number): number {
  for (const bucket of TONE_HIT_BUCKETS) {
    if (ratio <= bucket.end) {
      return bucket.value;
    }
  }
  return TONE_MAX;
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
