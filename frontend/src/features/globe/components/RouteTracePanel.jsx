function RouteTracePanel({ routeState, clearRouteSelection }) {
  return (
    <div className="absolute bottom-5 left-5 w-[min(26rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-amber-100">Route Trace (OSRM)</div>
        <button
          onClick={clearRouteSelection}
          className="rounded-lg border border-amber-200/40 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-800/25"
        >
          Reset
        </button>
      </div>
      <div className="space-y-1 font-mono text-[11px] text-amber-100/90">
        <div>
          from: {routeState.from ? `${routeState.from.lat.toFixed(5)}, ${routeState.from.lng.toFixed(5)}` : '-'}
        </div>
        <div>
          to: {routeState.to ? `${routeState.to.lat.toFixed(5)}, ${routeState.to.lng.toFixed(5)}` : '-'}
        </div>
        <div>status: {routeState.loading ? 'routing...' : `click ${routeState.awaiting}`}</div>
        <div>distance: {Number.isFinite(routeState.distanceKm) ? `${routeState.distanceKm.toFixed(2)} km` : '-'}</div>
        <div>duration: {Number.isFinite(routeState.durationMin) ? `${routeState.durationMin.toFixed(1)} min` : '-'}</div>
        <div className="truncate text-rose-200/90">error: {routeState.error || '-'}</div>
      </div>
    </div>
  );
}

export default RouteTracePanel;
