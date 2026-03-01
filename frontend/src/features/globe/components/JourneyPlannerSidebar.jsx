import { useEffect, useRef, useState } from 'react';
import { searchOsmAddress } from '../../../services/mobilityApi';

function JourneyPlannerSidebar({
  isOpen,
  setIsOpen,
  routeState,
  journeyModeStats,
  journeyLookup,
  setRouteState,
  setRouteEndpoint,
  clearRouteSelection
}) {
  const hasJourney = Boolean(routeState.from && routeState.to);
  const formatPoint = point =>
    point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : '';

  const modeCards = [
    { id: 'walking', title: 'Walking', color: 'text-emerald-300' },
    { id: 'cycling', title: 'Cycling', color: 'text-cyan-300' },
    { id: 'driving', title: 'Driving', color: 'text-amber-300' }
  ];

  const fromLookup = journeyLookup?.from || {};
  const toLookup = journeyLookup?.to || {};
  const startValue = fromLookup.addressLine || formatPoint(routeState.from);
  const destinationValue = toLookup.addressLine || formatPoint(routeState.to);
  const selectedDistanceKm = Number(routeState.distanceKm);

  const [startInput, setStartInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [startOptions, setStartOptions] = useState([]);
  const [destinationOptions, setDestinationOptions] = useState([]);
  const [startLoading, setStartLoading] = useState(false);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [journeySimulationStep, setJourneySimulationStep] = useState('start');
  const [journeyButtonFx, setJourneyButtonFx] = useState('idle');
  const startTokenRef = useRef(0);
  const destinationTokenRef = useRef(0);

  useEffect(() => {
    if (!hasJourney) {
      setJourneySimulationStep('start');
    }
  }, [hasJourney]);

  useEffect(() => {
    const q = startInput.trim();
    if (q.length < 3) {
      setStartOptions([]);
      setStartLoading(false);
      return;
    }

    const token = startTokenRef.current + 1;
    startTokenRef.current = token;
    const timer = setTimeout(async () => {
      try {
        setStartLoading(true);
        const payload = await searchOsmAddress({
          q,
          limit: 6,
          aroundLat: routeState.from?.lat,
          aroundLng: routeState.from?.lng
        });
        if (token !== startTokenRef.current) return;
        setStartOptions(Array.isArray(payload?.results) ? payload.results : []);
      } catch (error) {
        if (token !== startTokenRef.current) return;
        setStartOptions([]);
      } finally {
        if (token === startTokenRef.current) setStartLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [startInput, routeState.from?.lat, routeState.from?.lng]);

  useEffect(() => {
    const q = destinationInput.trim();
    if (q.length < 3) {
      setDestinationOptions([]);
      setDestinationLoading(false);
      return;
    }

    const token = destinationTokenRef.current + 1;
    destinationTokenRef.current = token;
    const timer = setTimeout(async () => {
      try {
        setDestinationLoading(true);
        const payload = await searchOsmAddress({
          q,
          limit: 6,
          aroundLat: routeState.to?.lat,
          aroundLng: routeState.to?.lng
        });
        if (token !== destinationTokenRef.current) return;
        setDestinationOptions(Array.isArray(payload?.results) ? payload.results : []);
      } catch (error) {
        if (token !== destinationTokenRef.current) return;
        setDestinationOptions([]);
      } finally {
        if (token === destinationTokenRef.current) setDestinationLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [destinationInput, routeState.to?.lat, routeState.to?.lng]);

  const applyStartSelection = option => {
    const lat = Number(option?.lat);
    const lng = Number(option?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setStartInput(option?.displayName || '');
    setStartOpen(false);
    void setRouteEndpoint('from', { lat, lng });
  };

  const applyDestinationSelection = option => {
    const lat = Number(option?.lat);
    const lng = Number(option?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDestinationInput(option?.displayName || '');
    setDestinationOpen(false);
    void setRouteEndpoint('to', { lat, lng });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={isOpen ? 'Collapse journey planner' : 'Expand journey planner'}
        title={isOpen ? 'Collapse journey planner' : 'Expand journey planner'}
        className={`fixed top-1/2 z-50 h-14 w-10 -translate-y-1/2 rounded-l-xl border border-emerald-400/40 bg-emerald-950/92 text-2xl font-semibold text-emerald-100 backdrop-blur-xl transition-all duration-500 hover:bg-emerald-900/95 ${
          isOpen ? 'right-[400px]' : 'right-0'
        }`}
      >
        {isOpen ? '-' : '+'}
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
              Set start and destination by typing or clicking on the globe.
            </p>

            <div className="mb-6 space-y-4">
              <div className="rounded-2xl border border-emerald-800/50 bg-emerald-900/30 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-tighter text-emerald-300">
                  Start
                </div>
                <input
                  type="text"
                  value={startInput}
                  onChange={event => {
                    setStartInput(event.target.value);
                    setStartOpen(true);
                  }}
                  onFocus={() => setStartOpen(true)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyStartSelection(startOptions[0]);
                    }
                  }}
                  placeholder={startValue || 'Type start location'}
                  className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-3 py-2 text-sm text-emerald-50 outline-none placeholder:text-emerald-300/60"
                />
                {startOpen && (startOptions.length > 0 || startLoading) ? (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-emerald-700/50 bg-emerald-950/85">
                    {startLoading ? (
                      <div className="px-3 py-2 text-xs text-emerald-200/80">Searching...</div>
                    ) : (
                      startOptions.map((item, idx) => (
                        <button
                          key={`${item.osmType || 'osm'}:${item.osmId || idx}:from:${idx}`}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => applyStartSelection(item)}
                          className="block w-full border-b border-emerald-800/40 px-3 py-2 text-left text-xs text-emerald-100 hover:bg-emerald-900/50 last:border-b-0"
                        >
                          <div className="truncate">{item.displayName}</div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
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
                  value={destinationInput}
                  onChange={event => {
                    setDestinationInput(event.target.value);
                    setDestinationOpen(true);
                  }}
                  onFocus={() => setDestinationOpen(true)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyDestinationSelection(destinationOptions[0]);
                    }
                  }}
                  placeholder={destinationValue || 'Type destination location'}
                  className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-3 py-2 text-sm text-emerald-50 outline-none placeholder:text-emerald-300/60"
                />
                {destinationOpen && (destinationOptions.length > 0 || destinationLoading) ? (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-emerald-700/50 bg-emerald-950/85">
                    {destinationLoading ? (
                      <div className="px-3 py-2 text-xs text-emerald-200/80">Searching...</div>
                    ) : (
                      destinationOptions.map((item, idx) => (
                        <button
                          key={`${item.osmType || 'osm'}:${item.osmId || idx}:to:${idx}`}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => applyDestinationSelection(item)}
                          className="block w-full border-b border-emerald-800/40 px-3 py-2 text-left text-xs text-emerald-100 hover:bg-emerald-900/50 last:border-b-0"
                        >
                          <div className="truncate">{item.displayName}</div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
                <div className="mt-2 truncate text-[11px] text-emerald-200/80">
                  {toLookup.loading
                    ? 'Resolving nearest address...'
                    : toLookup.displayName || toLookup.error || (routeState.to ? 'Coordinates selected' : '-')}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (!hasJourney || journeyButtonFx !== 'idle') return;
                    setJourneyButtonFx('out');
                    setTimeout(() => {
                      setJourneySimulationStep(prev => (prev === 'start' ? 'complete' : 'start'));
                      setJourneyButtonFx('in');
                      setTimeout(() => {
                        setJourneyButtonFx('idle');
                      }, 260);
                    }, 320);
                  }}
                  disabled={!hasJourney || journeyButtonFx !== 'idle'}
                  style={{
                    animation:
                      journeyButtonFx === 'out'
                        ? 'journeyShake 320ms ease-in-out, journeyFadeOut 320ms ease forwards'
                        : journeyButtonFx === 'in'
                          ? 'journeyFadeIn 260ms ease forwards'
                          : undefined
                  }}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default disabled:border-slate-500/40 disabled:bg-slate-700/40 disabled:text-slate-300 ${
                    journeySimulationStep === 'start'
                      ? 'border-lime-300/70 bg-lime-500 text-emerald-950 hover:bg-lime-400'
                      : 'border-teal-200/70 bg-teal-300 text-teal-950 hover:bg-teal-200'
                  }`}
                >
                  {journeySimulationStep === 'start' ? 'Start Planned Journey' : 'Complete Journey'}
                </button>
                <button
                  onClick={() => {
                    setStartInput('');
                    setDestinationInput('');
                    clearRouteSelection();
                  }}
                  title="Reset Journey"
                  aria-label="Reset Journey"
                  className="w-9 rounded-lg border border-amber-200/40 px-0 py-1.5 text-center text-sm font-semibold text-amber-100 hover:bg-amber-800/25"
                >
                  ⟳
                </button>
              </div>
            </div>

            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-300/80">
              Mode Comparison
            </div>
            <div className="mb-2 rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-100/90">
              Selected journey distance:{' '}
              <span className="font-mono text-amber-200">
                {Number.isFinite(selectedDistanceKm) ? `${selectedDistanceKm.toFixed(2)} km` : '-'}
              </span>
            </div>
            <div className="grid gap-3">
              {modeCards.map(mode => (
                <div
                  key={mode.id}
                  className="rounded-2xl border border-emerald-800/50 bg-emerald-900/30 p-4"
                >
                  <div className={`text-sm font-semibold ${mode.color}`}>{mode.title}</div>
                  {!hasJourney ? (
                    <div className="mt-2 text-xs text-emerald-200/60">
                      Add start and destination to view stats.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1 text-xs text-emerald-100/90">
                      <div>
                        distance:{' '}
                        <span className="font-mono text-amber-200">
                          {Number.isFinite(journeyModeStats?.modes?.[mode.id]?.distanceKm)
                            ? `${journeyModeStats.modes[mode.id].distanceKm.toFixed(2)} km`
                            : '-'}
                        </span>
                      </div>
                      <div>
                        duration:{' '}
                        <span className="font-mono text-amber-200">
                          {Number.isFinite(journeyModeStats?.modes?.[mode.id]?.durationMin)
                            ? `${journeyModeStats.modes[mode.id].durationMin.toFixed(1)} min`
                            : '-'}
                        </span>
                      </div>
                      <div>
                        {mode.id === 'driving' ? 'fuel' : 'calories'}:{' '}
                        <span className="font-mono text-amber-200">
                          {mode.id === 'driving'
                            ? (Number.isFinite(journeyModeStats?.modes?.[mode.id]?.fuelLiters)
                                ? `${journeyModeStats.modes[mode.id].fuelLiters.toFixed(2)} L`
                                : '-')
                            : (Number.isFinite(journeyModeStats?.modes?.[mode.id]?.calories)
                                ? `${journeyModeStats.modes[mode.id].calories} kcal`
                                : '-')}
                        </span>
                      </div>
                      <div>
                        CO2 emissions:{' '}
                        <span className="font-mono text-amber-200">
                          {Number.isFinite(journeyModeStats?.modes?.[mode.id]?.co2Kg)
                            ? `${journeyModeStats.modes[mode.id].co2Kg.toFixed(2)} kg`
                            : '-'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 text-xs font-mono text-emerald-200/80">
              status: {routeState.loading || journeyModeStats?.loading ? 'routing...' : `click ${routeState.awaiting}`}
            </div>
            <div className="mt-1 text-xs font-mono text-rose-200/90">
              error: {routeState.error || journeyModeStats?.error || '-'}
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes journeyShake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          60% { transform: translateX(-2px); }
          80% { transform: translateX(2px); }
          100% { transform: translateX(0); }
        }
        @keyframes journeyFadeOut {
          from { opacity: 1; }
          to { opacity: 0.25; }
        }
        @keyframes journeyFadeIn {
          from { opacity: 0.25; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  );
}

export default JourneyPlannerSidebar;
