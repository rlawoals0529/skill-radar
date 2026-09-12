// Vendored from yozora/js/contrast-probe.ts. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
import type { Page } from "@playwright/test";
import themes from "../src/theme/palettes.json" with { type: "json" };

/**
 * Measure every piece of visible text on the page, in every palette, against the surface it
 * is actually painted on.
 *
 * A palette check that reads the token files can only say the tokens are fine. What fails is
 * never the token on its own: it is a --dim that clears --bg sitting on a chip painted
 * --raised, or an option in a picker whose label was scoped to the palette it offers rather
 * than the one on screen. Only a browser knows where a colour landed.
 *
 * Call it once per distinct STATE of the page, not once per page. A state with a table, a
 * chart or a result in it has surfaces the empty state does not, and neither is a subset of
 * the other.
 *
 *   const probe = await probeContrast(page);
 *   expect(probe.styles).toBeGreaterThan(9);          // it measured something
 *   expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
 */

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

/** Colours settle over 140ms. Sampling sooner reads a value mid-transition, and every such
 *  reading is a false failure - which is how this first "found" thirteen of them. */
const SETTLE = 450;

export interface Reading {
  theme: string;
  cls: string;
  text: string;
  ratio: number;
  need: number;
  size: number;
}

export interface Probe {
  failures: Reading[];
  measured: number;
  /** Deduplicated text styles seen in the first palette, so a caller can refuse an empty run. */
  styles: number;
  samples: string[];
  /** `TAG.class` of each of those, so a caller can name an element that must have been seen. */
  classes: string[];
}

export async function probeContrast(page: Page): Promise<Probe> {
  const failures: Reading[] = [];
  let measured = 0;
  let styles = 0;
  let samples: string[] = [];
  let classes: string[] = [];

  for (const theme of themes as { id: string }[]) {
    await page.evaluate((id) => document.documentElement.setAttribute("data-theme", id), theme.id);
    await page.waitForTimeout(SETTLE);

    const rows = await page.evaluate(() => {
      const seen = new Set<string>();
      const out: { cls: string; text: string; color: string; bg: string; opacity: number; size: number; weight: string }[] = [];
      // Chromium serialises a color-mix() to `color(srgb r g b)`, not to rgb(). Matching only
      // rgb() here treated a mixed background as transparent and walked past it to the wrong
      // ground - and matching only rgb() on the FOREGROUND made the whole check pass on text
      // deliberately dimmed to 2:1, which is how the hole was found.
      const alphaOf = (c: string): number | null => {
        const rgb = c.match(/rgba?\(([^)]+)\)/);
        if (rgb) return rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number)[3] ?? 1;
        const srgb = c.match(/color\(\s*srgb\s+([^)]+)\)/);
        if (srgb) return srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number)[3] ?? 1;
        return null;
      };
      /** Every opacity between the element and the ground it is read against, multiplied. */
      const fadeOf = (el: Element): number => {
        let n: Element | null = el;
        let fade = 1;
        while (n) {
          fade *= Number(getComputedStyle(n).opacity || 1);
          const c = getComputedStyle(n).backgroundColor;
          const a = alphaOf(c);
          if (n !== el && a !== null && a > 0.99) break;
          n = n.parentElement;
        }
        return fade;
      };
      // The nearest ancestor that actually paints something. A transparent background means
      // the text is sitting on whatever is behind it, not on nothing.
      const bgOf = (el: Element): string => {
        let n: Element | null = el;
        while (n) {
          const c = getComputedStyle(n).backgroundColor;
          const a = alphaOf(c);
          if (a !== null && a > 0.99) return c;
          n = n.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      for (const el of document.querySelectorAll("body *")) {
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent!.trim())
          .join(" ")
          .trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        /*
         * checkVisibility(), not a display/visibility pair.
         *
         * A closed <details> hides its contents with content-visibility rather than with
         * display, and the pair above says nothing about that - so a button inside one was
         * measured as if it were on the page. Worse, Chromium does not run style updates in
         * a content-visibility-hidden subtree, so its computed colour is whatever it was
         * when the subtree was last rendered: switching palette left the element reporting
         * the PREVIOUS palette's colour against the current background, and the mismatch
         * read as a contrast failure that nobody could see or fix.
         */
        if (!el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        /*
         * WCAG 1.4.3 exempts text that is part of an inactive control, and it has to be
         * exempted here too: a disabled button is dimmed on purpose, so holding it to 4.5
         * would mean either failing every page that has one or never dimming one again.
         */
        if (el.closest(":disabled, [aria-disabled='true']")) continue;
        // SVG text is painted by `fill`, and reading `color` there measures a colour the
        // glyphs were never drawn in.
        const inSvg = (el as SVGElement).ownerSVGElement != null;
        const color = inSvg && cs.fill !== "none" ? cs.fill : cs.color;
        const key = `${el.tagName}.${el.getAttribute("class")}|${color}|${cs.fontSize}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          cls: `${el.tagName}.${el.getAttribute("class") ?? ""}`,
          text: text.slice(0, 30),
          color,
          bg: bgOf(el),
          // Opacity on an ancestor fades the text as surely as an alpha in its own colour,
          // and a computed `color` does not carry it. Without this, a block set to 0.6 is
          // measured at the contrast it would have had if somebody had not faded it.
          opacity: fadeOf(el),
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
        });
      }
      return out;
    });

    if (!styles) {
      styles = rows.length;
      samples = rows.map((r) => r.text);
      classes = rows.map((r) => r.cls);
    }

    for (const row of rows) {
      const fg = parse(row.color);
      const bg = parse(row.bg);
      // A colour this cannot read is a hole in the measurement, not a row to skip quietly.
      // Skipping is what let a 2:1 caption through: the browser had serialised its colour in
      // a notation the parser did not know, and an unreadable colour counted as no finding.
      if (!fg || !bg) throw new Error(`unreadable colour "${row.color}" on "${row.bg}" at ${row.cls}`);
      measured++;
      const alpha = fg[3] * row.opacity;
      const flat = alpha < 1 ? blend([fg[0], fg[1], fg[2], alpha], bg) : [fg[0], fg[1], fg[2]];
      const ratio = contrast(flat, [bg[0], bg[1], bg[2]]);
      const large = row.size >= 24 || (row.size >= 18.66 && Number(row.weight) >= 700);
      const need = large ? AA_LARGE : AA_TEXT;
      if (ratio + 1e-9 < need) {
        failures.push({ theme: theme.id, cls: row.cls, text: row.text, ratio, need, size: row.size });
      }
    }
  }

  return { failures, measured, styles, samples, classes };
}

export const describeFailures = (f: Reading[]): string =>
  f.map((r) => `${r.theme} ${r.cls} ${r.size}px "${r.text}" ${r.ratio.toFixed(2)}:1 needs ${r.need}`).join("\n");

/** Both notations Chromium serialises a computed colour in: rgb() and color(srgb …). */
function parse(value: string): [number, number, number, number] | null {
  const rgb = value.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const p = rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
  }
  // color-mix() and any colour written in a wide-gamut space come back like this, with the
  // channels in 0..1 rather than 0..255.
  const srgb = value.match(/color\(\s*srgb\s+([^)]+)\)/);
  if (srgb) {
    const p = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number);
    return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p.length > 3 ? p[3]! : 1];
  }
  return null;
}

const channel = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = ([r, g, b]: number[]) =>
  0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** A translucent foreground is really the colour you get after it is composited. */
const blend = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!));
