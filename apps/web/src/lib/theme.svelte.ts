// Three-way theme: OLED (default), Dark, Light.
//
// @immich/ui's own themeManager only knows light/dark, so OLED is layered on
// top rather than fought with: OLED *is* dark as far as every component is
// concerned, plus an `.oled` class that swaps the dark surfaces for true
// black. That way every @immich/ui component keeps working untouched and the
// override is pure CSS.
//
// The class is applied to <html>, and app.html applies it inline before first
// paint — see THEME_BOOTSTRAP. Without that a dark-by-default app flashes
// white on every cold load.
import { browser } from '$app/environment';

export type ThemeName = 'oled' | 'dark' | 'light';

export const THEME_STORAGE_KEY = 'eventlens-theme';
export const DEFAULT_THEME: ThemeName = 'oled';

export const THEMES: { value: ThemeName; label: string; description: string }[] = [
  { value: 'oled', label: 'OLED dark', description: 'True black — saves power on OLED screens' },
  { value: 'dark', label: 'Dark', description: 'Dark grey surfaces' },
  { value: 'light', label: 'Light', description: 'Light surfaces' },
];

const isTheme = (value: unknown): value is ThemeName =>
  value === 'oled' || value === 'dark' || value === 'light';

export const applyTheme = (theme: ThemeName, root: HTMLElement) => {
  // OLED counts as dark for every `dark:` variant in the app and in
  // @immich/ui; `.oled` only redefines which colours "dark" resolves to.
  root.classList.toggle('dark', theme !== 'light');
  root.classList.toggle('oled', theme === 'oled');
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
};

class ThemeStore {
  #current = $state<ThemeName>(DEFAULT_THEME);

  constructor() {
    if (!browser) {
      return;
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    this.#current = isTheme(stored) ? stored : DEFAULT_THEME;
    // The bootstrap script already painted this, so re-applying is a no-op on
    // load; it matters when storage held something the script rejected.
    applyTheme(this.#current, document.documentElement);
  }

  get value(): ThemeName {
    return this.#current;
  }

  set(theme: ThemeName) {
    this.#current = theme;
    if (browser) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme, document.documentElement);
    }
  }
}

export const themeStore = new ThemeStore();

// Injected verbatim into app.html and run before the body renders. Kept as a
// string here so the storage key and the default can never drift apart from
// the store above. Deliberately dependency-free and failure-tolerant: a
// browser with storage blocked must still get the default theme, not a crash
// that leaves the page unstyled.
export const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (t !== 'oled' && t !== 'dark' && t !== 'light') { t = '${DEFAULT_THEME}'; }
    var r = document.documentElement;
    if (t !== 'light') { r.classList.add('dark'); }
    if (t === 'oled') { r.classList.add('oled'); }
    r.style.colorScheme = t === 'light' ? 'light' : 'dark';
  } catch (e) {
    document.documentElement.classList.add('dark', 'oled');
  }
})();
`;
