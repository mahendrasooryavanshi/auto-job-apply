// Appearance preferences (per browser): mode = system | light | dark, accent = palette name.
export const ACCENTS = {
  lavender: { label: "Lavender", colors: ["#8b7cf6", "#c4b5fd"] },
  sky: { label: "Sky", colors: ["#4f9fe0", "#93c5fd"] },
  mint: { label: "Mint", colors: ["#3aa58a", "#86d9bf"] },
  peach: { label: "Peach", colors: ["#e8875c", "#f8bf9d"] },
  blush: { label: "Blush", colors: ["#d9789c", "#f3b4ca"] },
  sand: { label: "Sand", colors: ["#b08d57", "#dcc59b"] },
};
const KEY = "jobAgent.theme.v2";   // v2: soft light palettes
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY)) || {};
    return { mode: t.mode || "light", accent: ACCENTS[t.accent] ? t.accent : "lavender" };
  } catch {
    return { mode: "light", accent: "lavender" };
  }
}

export function applyTheme(theme) {
  const dark = theme.mode === "dark" || (theme.mode === "system" && media.matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  document.documentElement.dataset.accent = theme.accent;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function saveTheme(theme) {
  try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch { /* not saved */ }
  applyTheme(theme);
}

// Follow the system setting live while mode is "system"
media.addEventListener("change", () => applyTheme(loadTheme()));
