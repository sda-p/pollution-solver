function NearestRoadPanel({ osmLookup }) {
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 w-[min(27rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
      <div className="mb-2 text-sm font-semibold text-cyan-100">Nearest OSM Road</div>
      <div className="space-y-1 font-mono text-[11px] text-cyan-100/90">
        <div>coords: {Number.isFinite(osmLookup.lat) ? osmLookup.lat.toFixed(5) : '-'}, {Number.isFinite(osmLookup.lng) ? osmLookup.lng.toFixed(5) : '-'}</div>
        <div>status: {osmLookup.loading ? 'resolving...' : 'idle'}</div>
        <div className="truncate">road: {osmLookup.addressLine || '-'}</div>
        <div className="truncate">locality: {[osmLookup.locality, osmLookup.country].filter(Boolean).join(', ') || '-'}</div>
        <div className="truncate">label: {osmLookup.displayName || '-'}</div>
        <div className="truncate text-rose-200/90">error: {osmLookup.error || '-'}</div>
      </div>
    </div>
  );
}

export default NearestRoadPanel;
