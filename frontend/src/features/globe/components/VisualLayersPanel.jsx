function VisualLayersPanel({
  showCountryFill,
  showCarbonOverlay,
  onToggleCountryFill,
  onToggleCarbonOverlay
}) {
  return (
    <div className="absolute right-5 top-5 z-50 w-64 rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-xs text-slate-100 backdrop-blur-xl">
      <div className="mb-2 text-sm font-semibold text-emerald-200">Visual Layers</div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onToggleCarbonOverlay}
          className={`rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
            showCarbonOverlay
              ? 'border-cyan-300/60 bg-cyan-700/50 text-cyan-50 hover:bg-cyan-600/60'
              : 'border-slate-500/60 bg-slate-700/50 text-slate-200 hover:bg-slate-600/60'
          }`}
        >
          Carbon: {showCarbonOverlay ? 'On' : 'Off'}
        </button>
        <button
          onClick={onToggleCountryFill}
          className={`rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
            showCountryFill
              ? 'border-emerald-300/60 bg-emerald-700/50 text-emerald-50 hover:bg-emerald-600/60'
              : 'border-slate-500/60 bg-slate-700/50 text-slate-200 hover:bg-slate-600/60'
          }`}
        >
          Country Fill: {showCountryFill ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}

export default VisualLayersPanel;
