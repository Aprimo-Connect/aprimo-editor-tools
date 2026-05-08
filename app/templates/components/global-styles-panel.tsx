"use client"

import { useTemplateBuilder } from "../stores/use-template-builder"
import {
  FONT_LIST,
  hasWeight,
  loadFont,
  nearestWeight,
} from "../lib/google-fonts"
import type { Styles } from "../types"
import "./global-styles-panel.css"

type FontKey = "headlineFont" | "textFont" | "ctaFont"
type WeightKey = "headlineFontWeight" | "textFontWeight" | "ctaFontWeight"
type BgMode = Styles["bgMode"]

interface WeightOption {
  value: string
  label: string
}

const WEIGHT_OPTIONS: WeightOption[] = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "600", label: "Semi" },
  { value: "700", label: "Bold" },
  { value: "900", label: "Black" },
]

const BG_MODES: Array<{ mode: BgMode; label: string }> = [
  { mode: "none", label: "None" },
  { mode: "color", label: "Solid" },
  { mode: "linear", label: "Linear" },
  { mode: "radial", label: "Radial" },
]

function setStyle<K extends keyof Styles>(key: K, value: Styles[K]) {
  useTemplateBuilder.getState().updateStyle(key, value)
}

async function setFont(key: FontKey, family: string) {
  await loadFont(family)
  setStyle(key, family)
  const weightKey = key.replace("Font", "FontWeight") as WeightKey
  const currentWeight = useTemplateBuilder.getState().styles[weightKey] || "400"
  const best = nearestWeight(family, currentWeight)
  if (best !== currentWeight) setStyle(weightKey, best)
}

function intInput(value: string, fallback: number): number {
  const n = parseInt(value)
  return isNaN(n) ? fallback : n
}

export function GlobalStylesPanel() {
  const styles = useTemplateBuilder((s) => s.styles)

  function isWeightDisabled(fontKey: FontKey, weight: string): boolean {
    return !hasWeight(styles[fontKey], weight)
  }

  const pillStyle: React.CSSProperties = {
    padding: `${styles.ctaPadV}px ${styles.ctaPadH}px`,
    background: styles.accentColor,
    color: styles.ctaTextColor,
    borderRadius: 2 + (styles.ctaRadius / 100) * 18 + "px",
    fontSize: (styles.ctaFontSize || 11) + "px",
    fontWeight: styles.ctaFontWeight || "600",
    fontFamily: `"${styles.ctaFont || "Inter"}", sans-serif`,
  }

  return (
    <div className="gsp">
      {/* Headline */}
      <FontSection
        badgeClass="hl"
        badgeLabel="H"
        title="Headline"
        fontKey="headlineFont"
        sizeKey="headlineFontSize"
        weightKey="headlineFontWeight"
        colorKey="headlineColor"
        fontValue={styles.headlineFont}
        sizeValue={styles.headlineFontSize}
        weightValue={styles.headlineFontWeight}
        colorValue={styles.headlineColor}
        sizeMin={8}
        sizeMax={120}
        sizeFallback={24}
        isWeightDisabled={isWeightDisabled}
      />

      {/* Body Text */}
      <FontSection
        badgeClass="txt"
        badgeLabel="T"
        title="Body Text"
        fontKey="textFont"
        sizeKey="textFontSize"
        weightKey="textFontWeight"
        colorKey="textColor"
        fontValue={styles.textFont}
        sizeValue={styles.textFontSize}
        weightValue={styles.textFontWeight}
        colorValue={styles.textColor}
        sizeMin={8}
        sizeMax={80}
        sizeFallback={14}
        isWeightDisabled={isWeightDisabled}
      />

      {/* CTA */}
      <section className="gsp-section">
        <div className="gsp-card">
          <div className="gsp-card-head">
            <span className="gsp-badge cta">C</span>
            <span className="gsp-card-title">CTA Button</span>
          </div>
          <div className="gsp-card-body">
            <div className="gsp-row gsp-row-tight">
              <select
                className="gsp-select gsp-font-select"
                style={{ flex: 1, minWidth: 0 }}
                value={styles.ctaFont}
                onChange={(e) => setFont("ctaFont", e.target.value)}
              >
                {FONT_LIST.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <div className="gsp-field-num">
                <input
                  type="number"
                  min={6}
                  max={60}
                  value={styles.ctaFontSize}
                  onChange={(e) => setStyle("ctaFontSize", intInput(e.target.value, 11))}
                />
                <span className="gsp-unit">px</span>
              </div>
            </div>
            <div className="gsp-row gsp-color-pair">
              <div className="gsp-color-pick" title="Text colour">
                <input
                  type="color"
                  value={styles.ctaTextColor}
                  onChange={(e) => setStyle("ctaTextColor", e.target.value)}
                />
                <span className="gsp-hex">{styles.ctaTextColor}</span>
                <span className="gsp-color-label">Text</span>
              </div>
              <div className="gsp-color-pick" title="Fill colour">
                <input
                  type="color"
                  value={styles.accentColor}
                  onChange={(e) => setStyle("accentColor", e.target.value)}
                />
                <span className="gsp-hex">{styles.accentColor}</span>
                <span className="gsp-color-label">Fill</span>
              </div>
            </div>
            <div className="gsp-row">
              <div className="gsp-weight-seg">
                {WEIGHT_OPTIONS.map((w) => (
                  <button
                    key={w.value}
                    className={`gsp-wt${styles.ctaFontWeight === w.value ? " active" : ""}`}
                    disabled={isWeightDisabled("ctaFont", w.value)}
                    onClick={() => setStyle("ctaFontWeight", w.value)}
                    title={w.label}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="gsp-divider" />

            {/* Padding widget with live preview pill */}
            <div className="gsp-row">
              <div className="gsp-cta-pad-widget">
                <div className="gsp-cta-pad-row" style={{ justifyContent: "center" }}>
                  <div className="gsp-cta-pad-field">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={styles.ctaPadV}
                      onChange={(e) => setStyle("ctaPadV", intInput(e.target.value, 0))}
                    />
                  </div>
                </div>
                <div className="gsp-cta-pad-row" style={{ gap: 6, alignItems: "center" }}>
                  <div className="gsp-cta-pad-field">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={styles.ctaPadH}
                      onChange={(e) => setStyle("ctaPadH", intInput(e.target.value, 0))}
                    />
                  </div>
                  <div className="gsp-cta-pad-preview">
                    <div className="gsp-cta-pill" style={pillStyle}>
                      Label
                    </div>
                  </div>
                  <div className="gsp-cta-pad-field">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={styles.ctaPadH}
                      onChange={(e) => setStyle("ctaPadH", intInput(e.target.value, 0))}
                    />
                  </div>
                </div>
                <div className="gsp-cta-pad-row" style={{ justifyContent: "center" }}>
                  <div className="gsp-cta-pad-field">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={styles.ctaPadV}
                      onChange={(e) => setStyle("ctaPadV", intInput(e.target.value, 0))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Corner radius */}
            <div className="gsp-row gsp-row-tight">
              <span className="gsp-inline-label">Radius</span>
              <input
                type="range"
                className="gsp-mini-range"
                min={0}
                max={100}
                value={styles.ctaRadius}
                onChange={(e) => setStyle("ctaRadius", intInput(e.target.value, 0))}
              />
              <span className="gsp-range-val">{styles.ctaRadius}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Background */}
      <section className="gsp-section">
        <div className="gsp-section-head">
          <span className="gsp-section-title">Background</span>
        </div>
        <div className="gsp-row">
          <div className="gsp-seg-row">
            {BG_MODES.map((m) => (
              <button
                key={m.mode}
                className={`gsp-seg${styles.bgMode === m.mode ? " active" : ""}`}
                onClick={() => setStyle("bgMode", m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {styles.bgMode !== "none" && (
          <div className="gsp-row gsp-row-tight">
            <div className="gsp-color-field">
              <input
                type="color"
                value={styles.bgColor1}
                onChange={(e) => setStyle("bgColor1", e.target.value)}
              />
              <span className="gsp-color-label">
                {styles.bgMode === "color" ? "Fill" : "Start"}
              </span>
            </div>
            {styles.bgMode !== "color" && (
              <div className="gsp-color-field">
                <input
                  type="color"
                  value={styles.bgColor2}
                  onChange={(e) => setStyle("bgColor2", e.target.value)}
                />
                <span className="gsp-color-label">End</span>
              </div>
            )}
            {styles.bgMode === "linear" && (
              <div className="gsp-field-num" title="Angle">
                <svg
                  className="gsp-field-icon"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 8L8 2" />
                  <path d="M5 2h3v3" />
                </svg>
                <input
                  type="number"
                  min={0}
                  max={360}
                  value={styles.bgAngle}
                  onChange={(e) => setStyle("bgAngle", intInput(e.target.value, 180))}
                />
                <span className="gsp-unit">°</span>
              </div>
            )}
            {styles.bgMode !== "color" && (
              <div className="gsp-field-num" title="Distance">
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={styles.bgDistance}
                  onChange={(e) => setStyle("bgDistance", intInput(e.target.value, 100))}
                />
                <span className="gsp-unit">%</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Overlay */}
      <section className="gsp-section">
        <div className="gsp-section-head">
          <span className="gsp-section-title">Overlay</span>
        </div>
        <div className="gsp-row gsp-row-tight">
          <div className="gsp-color-field">
            <input
              type="color"
              value={styles.overlayColor}
              onChange={(e) => setStyle("overlayColor", e.target.value)}
            />
            <span className="gsp-color-label">Colour</span>
          </div>
          <div className="gsp-field-num" style={{ flex: 1 }}>
            <input
              type="range"
              className="gsp-mini-range"
              min={0}
              max={100}
              value={Math.round(styles.overlayOpacity * 100)}
              onChange={(e) => setStyle("overlayOpacity", intInput(e.target.value, 65) / 100)}
            />
            <span className="gsp-range-val">
              {Math.round(styles.overlayOpacity * 100)}%
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Reusable font section (Headline + Body Text share this layout) ──

interface FontSectionProps {
  badgeClass: string
  badgeLabel: string
  title: string
  fontKey: FontKey
  sizeKey: keyof Styles
  weightKey: WeightKey
  colorKey: keyof Styles
  fontValue: string
  sizeValue: number
  weightValue: string
  colorValue: string
  sizeMin: number
  sizeMax: number
  sizeFallback: number
  isWeightDisabled: (fontKey: FontKey, weight: string) => boolean
}

function FontSection({
  badgeClass,
  badgeLabel,
  title,
  fontKey,
  sizeKey,
  weightKey,
  colorKey,
  fontValue,
  sizeValue,
  weightValue,
  colorValue,
  sizeMin,
  sizeMax,
  sizeFallback,
  isWeightDisabled,
}: FontSectionProps) {
  return (
    <section className="gsp-section">
      <div className="gsp-card">
        <div className="gsp-card-head">
          <span className={`gsp-badge ${badgeClass}`}>{badgeLabel}</span>
          <span className="gsp-card-title">{title}</span>
        </div>
        <div className="gsp-card-body">
          <div className="gsp-row">
            <select
              className="gsp-select gsp-font-select"
              value={fontValue}
              onChange={(e) => setFont(fontKey, e.target.value)}
            >
              {FONT_LIST.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="gsp-row gsp-row-tight">
            <div className="gsp-field-num">
              <input
                type="number"
                min={sizeMin}
                max={sizeMax}
                value={sizeValue}
                onChange={(e) =>
                  setStyle(sizeKey, intInput(e.target.value, sizeFallback) as never)
                }
              />
              <span className="gsp-unit">px</span>
            </div>
            <div className="gsp-color-pick">
              <input
                type="color"
                value={colorValue}
                onChange={(e) => setStyle(colorKey, e.target.value as never)}
              />
              <span className="gsp-hex">{colorValue}</span>
            </div>
          </div>
          <div className="gsp-row">
            <div className="gsp-weight-seg">
              {WEIGHT_OPTIONS.map((w) => (
                <button
                  key={w.value}
                  className={`gsp-wt${weightValue === w.value ? " active" : ""}`}
                  disabled={isWeightDisabled(fontKey, w.value)}
                  onClick={() => setStyle(weightKey, w.value)}
                  title={w.label}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
