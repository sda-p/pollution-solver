function GlobeInfoPanel() {
  return (
    <div className="pointer-events-none absolute top-5 left-5 rounded-2xl border border-emerald-400/30 bg-emerald-950/70 p-4 backdrop-blur-xl">
      <h2 className="text-lg font-semibold text-emerald-50">Global Emissions Globe</h2>
      <p className="text-xs text-emerald-300/80">Carbon bitmap + OSM LoD overlays enabled</p>
    </div>
  );
}

export default GlobeInfoPanel;
