import { useEffect, useState } from "react";
import manifest from "./theme/palettes.json";
import { createThemeStore, grouped, type Theme } from "./lib/theme";

const THEMES = manifest as Theme[];
const store = createThemeStore(THEMES, "twilight-comet", "skill-radar:theme");

/**
 * Fifteen palettes, behind a disclosure.
 *
 * Closed by default because this is a preference, not part of the task. What shows until
 * somebody wants it is one line naming the palette they are already in.
 */
export function Palette() {
  const [theme, setTheme] = useState(store.initial);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    store.apply(theme);
  }, [theme]);

  const current = THEMES.find((t) => t.id === theme);

  return (
    <section className="panel palette">
      <button
        className="palette-toggle"
        aria-expanded={open}
        aria-controls="palette-list"
        onClick={() => setOpen((v) => !v)}
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

      <div id="palette-list" hidden={!open} className="palette-list">
        {grouped(THEMES).map((g) => (
          <fieldset key={g.scheme}>
            <legend>{g.label}</legend>
            {g.themes.map((t) => (
              <button key={t.id} aria-pressed={t.id === theme} onClick={() => setTheme(t.id)}>
                {/* data-theme goes on the CHIP, not on the button. On the button it also
                    rescoped --fg and --dim, so each option's LABEL was painted in a palette
                    the page is not showing, and most of them came out under 4.5:1 on the
                    current background. The chip is the only part that should be in another
                    palette, because the colour is the thing it is showing. */}
                <span className="palette-chip" aria-hidden="true" data-theme={t.id} />
                {t.label}
              </button>
            ))}
          </fieldset>
        ))}
      </div>
    </section>
  );
}
