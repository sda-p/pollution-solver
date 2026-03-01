function OsmDebugPanel({ osmDebug }) {
  return (
    <div className="absolute top-28 right-5 w-80 rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-xs text-slate-100 backdrop-blur-xl">
      <div className="mb-2 text-sm font-semibold text-cyan-200">OSM LoD Debug</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed text-cyan-100/90">
        <div>pov lat/lng</div>
        <div>{osmDebug.lat.toFixed(2)}, {osmDebug.lng.toFixed(2)}</div>
        <div>altitude</div>
        <div>{osmDebug.altitude.toFixed(3)}</div>
        <div>overlay active</div>
        <div>{osmDebug.active ? 'yes' : 'no'}</div>
        <div>requested</div>
        <div>{osmDebug.requested}</div>
        <div>visible</div>
        <div>{osmDebug.visible}</div>
        <div>lod c/m/f</div>
        <div>{osmDebug.coarse}/{osmDebug.medium}/{osmDebug.fine}</div>
        <div>cache ready</div>
        <div>{osmDebug.cacheReady ? 'yes' : 'no'}</div>
        <div>cache size</div>
        <div>{osmDebug.cacheSize}</div>
        <div>last fetch</div>
        <div>{osmDebug.fetchMs} ms</div>
        <div>failed</div>
        <div>{osmDebug.failed}</div>
        <div>status</div>
        <div>{osmDebug.loading ? 'loading' : 'idle'}</div>
      </div>
      <div className="mt-2 truncate font-mono text-[11px] text-rose-200/90">error: {osmDebug.error || '-'}</div>
    </div>
  );
}

export default OsmDebugPanel;
