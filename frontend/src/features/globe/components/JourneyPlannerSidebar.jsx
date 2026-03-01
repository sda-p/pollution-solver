function JourneyPlannerSidebar({
  isOpen,
  setIsOpen,
  routeState,
  journeyLookup,
  setRouteState,
  clearRouteSelection
}) {
  const hasJourney = Boolean(routeState.from && routeState.to);
  const formatPoint = point =>
    point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : '';

  const modeCards = [
    {
      id: 'walking',
      title: 'Walking',
      color: 'text-emerald-300'
    },
    {
      id: 'cycling',
      title: 'Cycling',
      color: 'text-cyan-300'
    },
    {
      id: 'driving',
      title: 'Driving',
      color: 'text-amber-300'
    }
  ];

  const fromLookup = journeyLookup?.from || {};
  const toLookup = journeyLookup?.to || {};
  const startValue = fromLookup.addressLine || formatPoint(routeState.from);
  const destinationValue = toLookup.addressLine || formatPoint(routeState.to);

  return (
    <>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="fixed right-5 top-28 z-50 rounded-xl border border-cyan-300/40 bg-slate-950/85 px-3 py-2 text-xs font-semibold text-cyan-100 backdrop-blur-xl hover:bg-slate-900/90"
      >
        {isOpen ? 'Hide Journey Planner' : 'Show Journey Planner'}
      </button>
      <div
        className={`fixed right-0 top-24 h-[calc(100vh-6rem)] w-[400px] bg-emerald-950/95 backdrop-blur-md border-l border-emerald-500/30 shadow-2xl z-40 overflow-y-auto transition-transform duration-500 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-8">
          <button
            onClick={() => setIsOpen(false)}
            className="absolute right-6 top-6 rounded-full p-2 text-emerald-400 transition-colors hover:bg-emerald-800/50"
          >
            ✕
          </button>

          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h2 className="mb-1 text-4xl font-bold text-emerald-50">Journey Planner</h2>
            <p className="mb-6 text-sm font-medium text-emerald-400/80">
              Set start and destination by clicking on the globe.
            </p>

            <div className="mb-6 space-y-4">
              <div className="rounded-2xl border border-emerald-800/50 bg-emerald-900/30 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-tighter text-emerald-300">
                  Start
                </div>
                <input
                  type="text"
                  value={startValue}
                  readOnly
                  placeholder="Click map to set start"
                  className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-3 py-2 text-sm text-emerald-50 outline-none placeholder:text-emerald-300/60"
                />
                <div className="mt-2 truncate text-[11px] text-emerald-200/80">
                  {fromLookup.loading
                    ? 'Resolving nearest address...'
                    : fromLookup.displayName || fromLookup.error || (routeState.from ? 'Coordinates selected' : '-')}
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-800/50 bg-emerald-900/30 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-tighter text-emerald-300">
                  Destination
                </div>
                <input
                  type="text"
                  value={destinationValue}
                  readOnly
                  placeholder="Click map to set destination"
                  className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-3 py-2 text-sm text-emerald-50 outline-none placeholder:text-emerald-300/60"
                />
                <div className="mt-2 truncate text-[11px] text-emerald-200/80">
                  {toLookup.loading
                    ? 'Resolving nearest address...'
                    : toLookup.displayName || toLookup.error || (routeState.to ? 'Coordinates selected' : '-')}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={clearRouteSelection}
                  className="rounded-lg border border-amber-200/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-800/25"
                >
                  Reset Journey
                </button>
                <button
                  onClick={() =>
                    setRouteState(prev => ({
                      ...prev,
                      from: null,
                      to: null,
                      awaiting: 'from',
                      error: ''
                    }))
                  }
                  className="rounded-lg border border-cyan-200/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-800/25"
                >
                  Set New Start
                </button>
              </div>
            </div>

            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-300/80">
              Mode Comparison
            </div>
            <div className="grid gap-3">
              {modeCards.map(mode => (
                <div
                  key={mode.id}
                  className="rounded-2xl border border-emerald-800/50 bg-emerald-900/30 p-4"
                >
                  <div className={`text-sm font-semibold ${mode.color}`}>{mode.title}</div>
                  {hasJourney ? (
                    <div className="mt-2 text-xs text-emerald-100/90">
                      Metrics coming soon.
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-emerald-200/60">
                      Add start and destination to view stats.
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 text-xs font-mono text-emerald-200/80">
              status: {routeState.loading ? 'routing...' : `click ${routeState.awaiting}`}
            </div>
            <div className="mt-1 text-xs font-mono text-rose-200/90">
              error: {routeState.error || '-'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default JourneyPlannerSidebar;
