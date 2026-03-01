function AddressSearchPanel({
  addressSearch,
  setAddressSearch,
  goToSearchSelection
}) {
  return (
    <div className="absolute top-36 left-5 w-[min(30rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
      <div className="mb-2 text-sm font-semibold text-emerald-200">Address Search</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={addressSearch.q}
          onChange={event => {
            const next = event.target.value;
            setAddressSearch(prev => ({ ...prev, q: next }));
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setAddressSearch(prev => ({
                ...prev,
                selectedIdx:
                  prev.options.length === 0
                    ? -1
                    : Math.min(prev.selectedIdx + 1, prev.options.length - 1)
              }));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setAddressSearch(prev => ({
                ...prev,
                selectedIdx: prev.options.length === 0 ? -1 : Math.max(prev.selectedIdx - 1, 0)
              }));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              goToSearchSelection();
            }
          }}
          placeholder="Type an address..."
          className="flex-1 rounded-xl border border-cyan-300/40 bg-slate-900/95 px-3 py-2 text-cyan-50 outline-none transition-colors focus:border-cyan-200"
        />
        <button
          onClick={goToSearchSelection}
          disabled={addressSearch.options.length === 0}
          className="rounded-xl border border-cyan-200/60 px-4 py-2 font-semibold text-cyan-50 transition-colors disabled:cursor-default disabled:border-slate-500/40 disabled:bg-slate-700/40 disabled:text-slate-300 enabled:bg-cyan-700/70 enabled:hover:bg-cyan-600/80"
        >
          Go
        </button>
      </div>
      <div className="mt-2 font-mono text-[11px] text-cyan-100/90">status: {addressSearch.loading ? 'searching...' : 'idle'}</div>
      <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-cyan-300/20 bg-slate-900/80">
        {addressSearch.options.length === 0 ? (
          <div className="px-3 py-2 text-cyan-100/70">
            {addressSearch.q.trim().length < 3 ? 'Type at least 3 characters' : 'No matches'}
          </div>
        ) : (
          addressSearch.options.map((item, idx) => (
            <button
              key={`${item.osmType || 'osm'}-${item.osmId || idx}-${idx}`}
              onClick={() => setAddressSearch(prev => ({ ...prev, selectedIdx: idx }))}
              className={`w-full border-b border-cyan-300/15 px-3 py-2 text-left font-mono text-[11px] text-cyan-50 last:border-b-0 ${
                idx === addressSearch.selectedIdx ? 'bg-cyan-700/45' : 'bg-transparent hover:bg-cyan-900/35'
              }`}
            >
              <div className="truncate">{item.displayName}</div>
            </button>
          ))
        )}
      </div>
      <div className="mt-2 truncate font-mono text-[11px] text-rose-200/90">error: {addressSearch.error || '-'}</div>
    </div>
  );
}

export default AddressSearchPanel;
