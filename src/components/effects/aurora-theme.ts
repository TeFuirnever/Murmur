// [20260729_Fix_AuroraThemeExtract] Extracted from EffectsLayer.tsx to satisfy
// react-refresh/only-export-components (a component file must only export
// components; exporting a constant alongside triggers the lint rule under
// --max-warnings 0). This module is the single source for the Aurora brand
// palette, imported by both EffectsLayer (runtime) and effects-layer.test.ts.
//
// 4 stops with the first repeated at the end so the gradient loops seamlessly
// (Aurora's shader interpolates linearly between stops; a missing wrap-around
// creates a visible seam at the loop boundary).

export const AURORA_COLOR_STOPS: string[] = [
  "#0071e3",
  "#5856d6",
  "#af52de",
  "#0071e3",
];
