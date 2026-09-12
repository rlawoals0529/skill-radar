// Vendored from yozora/js/palette.tsx. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
/**
 * The palette picker.
 *
 * Design read: each option is a SPECIMEN of the palette it offers, not a label with a dot
 * beside it. You choose a theme by looking at it, so an option shows the four things that
 * actually differ between two palettes - the page ground, the panel on it, the ink, and both
 * accents - arranged the way they sit on a real page. Fifteen names beside fifteen identical
 * chips is a list you have to try one at a time.
 *
 * So trying one costs nothing: arrowing through the list applies each palette to the page as
 * you pass it, and Escape puts back the one you arrived with. That is the whole reason the
 * control exists and it is the part a disclosure full of buttons could not do.
 *
 * Closed by default, because a preference is not part of the task.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createThemeStore, grouped, type Theme } from "./theme.js";

/** The manifest's own shape, before `scheme` is narrowed. Imported JSON widens it to string. */
export interface ManifestEntry {
  id: string;
  label: string;
  accent: string;
  scheme: string;
}

export interface PaletteProps {
  /** Every palette, straight from the generated manifest. */
  themes: readonly ManifestEntry[];
  /** Where the choice is remembered. One key per app, or two apps share a preference. */
  storageKey: string;
  /** The palette a first visit gets. */
  initial?: string;
  /**
   * Show the options without a disclosure around them.
   *
   * For a page that already has somewhere for a preference to live - a settings tab, a
   * sidebar - where a toggle would be a second door in front of a door somebody has already
   * opened. The toggle is the default because on most of these pages the picker sits at the
   * bottom of the work, and a preference is not part of the task.
   */
  inline?: boolean;
}

export function Palette({ themes: manifest, storageKey, initial = "twilight-comet", inline = false }: PaletteProps) {
  // Narrowed here rather than cast at every call site: a JSON import types `scheme` as string,
  // and an unknown value is dark, which is the same rule the manifest was written with.
  const themes = useMemo<Theme[]>(
    () => manifest.map((t) => ({ ...t, scheme: t.scheme === "light" ? "light" : "dark" })),
    [manifest],
  );
  const [store] = useState(() => createThemeStore(themes, initial, storageKey));
  const [theme, setTheme] = useState(store.initial);
  const [open, setOpen] = useState(inline);
  /** What to put back if this is abandoned rather than decided. */
  const committed = useRef(theme);
  const group = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    store.apply(theme);
  }, [store, theme]);

  const current = themes.find((t) => t.id === theme);
  const order = grouped(themes).flatMap((g) => g.themes.map((t) => t.id));

  /**
   * Selection follows focus, which is what makes arrowing a preview rather than a survey.
   *
   * It is also the standard behaviour for a radio group, so nothing has to be explained: the
   * arrow keys move through the options and the page is already wearing the one you are on.
   */
  const focusAt = useCallback(
    (index: number) => {
      const id = order[(index + order.length) % order.length]!;
      setTheme(id);
      group.current?.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)?.focus();
    },
    [order],
  );

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1, ArrowDown: index + 1,
      ArrowLeft: index - 1, ArrowUp: index - 1,
      Home: 0, End: order.length - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      focusAt(keys[e.key]!);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Back to what was on the page when this was reached. Without it, sweeping through
      // fifteen palettes to look at them leaves you on whichever one you stopped at.
      setTheme(committed.current);
      if (inline) return;
      setOpen(false);
      group.current?.closest(".palette")?.querySelector<HTMLButtonElement>(".palette-toggle")?.focus();
    }
  };

  const toggle = () => {
    setOpen((was) => {
      if (!was) committed.current = theme;
      return !was;
    });
  };

  return (
    <section className={inline ? "palette palette-inline" : "palette"}>
      {!inline && (
        <button
          className="palette-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={toggle}
        >
          <span className="palette-chip" aria-hidden="true" data-theme={theme} />
          {/*
            The toggle says what it DOES, not only which palette is on. Without the word the
            button and the option for the same palette share an accessible name, so a screen
            reader announces "Sakura Lake button" twice for two different controls.
          */}
          <span className="sr-only">Palette: </span>
          {current?.label ?? "Palette"}
        </button>
      )}

      <div id={listId} hidden={!open} className="palette-list">
        <div
          className="palette-grid"
          role="radiogroup"
          aria-label="Palette"
          ref={group}
          /* What Escape puts back is whatever was on the page when this group was reached,
             which is not always when a disclosure was opened: inline there is no disclosure,
             and with a mouse the list can be opened long before anything is tried. */
          onFocusCapture={(e) => {
            if (!group.current?.contains(e.relatedTarget as Node | null)) committed.current = theme;
          }}
        >
          {grouped(themes).map((g) => (
            <div className="palette-group" key={g.scheme}>
              <p className="palette-group-name" aria-hidden="true">{g.label}</p>
              <div className="palette-row">
                {g.themes.map((t) => {
                  const at = order.indexOf(t.id);
                  const chosen = t.id === theme;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      // One tab stop for the whole group, then arrows. Fifteen tab stops to
                      // get past a preference is fifteen too many.
                      tabIndex={chosen ? 0 : -1}
                      data-id={t.id}
                      /* The option paints itself in the palette it offers. That is the whole
                         design: the swatch IS the page it is proposing. */
                      data-theme={t.id}
                      className="swatch"
                      onClick={() => setTheme(t.id)}
                      onKeyDown={(e) => onKeyDown(e, at)}
                    >
                      <span className="swatch-page" aria-hidden="true">
                        <span className="swatch-ink">Aa</span>
                        <span className="swatch-dot accent" />
                        <span className="swatch-dot second" />
                      </span>
                      <span className="swatch-name">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="palette-hint">
          Arrow keys try each one on the page. Escape puts back {themes.find((t) => t.id === committed.current)?.label ?? "the last"}.
        </p>
      </div>
    </section>
  );
}
