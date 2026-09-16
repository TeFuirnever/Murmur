// [20260815_Refactor_LoadingDotsCss] Merged with the deleted LoadingIndicator:
// both rendered the same three-dot wave. Pure CSS via the `loading-dots`
// keyframes in src/index.css (staggered delays) — no setInterval re-render.
// Default dot color works on light card backgrounds and dark surfaces; sites
// rendering on the solid blue primary button pass dotClassName="bg-white"
// (gray-500 on --primary is ~1:1 contrast in light mode — reviewer finding).
// [20260815_Refactor_LoadingDotsCss] END
const DOTS_ANIMATION = "loading-dots 1.05s ease-in-out infinite";
const DOTS_STAGGER_STEP_SECONDS = 0.15;

export const LoadingDots = ({
  dotClassName = "bg-gray-500 dark:bg-white",
}: {
  dotClassName?: string;
}) => (
  <div className="flex items-end h-3 gap-1">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className={`w-1 h-3 rounded-full ${dotClassName}`}
        style={{
          animation: DOTS_ANIMATION,
          animationDelay: `${i * DOTS_STAGGER_STEP_SECONDS}s`,
        }}
      />
    ))}
  </div>
);
