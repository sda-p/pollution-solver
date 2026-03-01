import SidebarWidget from '../../../layout/SidebarWidget.jsx';

function CountrySidebar({
  selectedCountry,
  setSelectedCountry,
  countryData
}) {
  return (
    <div
      className={`fixed top-24 left-0 h-[calc(100vh-6rem)] w-[400px] bg-emerald-950/95 backdrop-blur-md border-r border-emerald-500/30 shadow-2xl z-50 overflow-y-auto transition-transform duration-500 ease-in-out ${
        selectedCountry ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="p-8">
        <button
          onClick={() => setSelectedCountry(null)}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-emerald-800/50 transition-colors text-emerald-400"
        >
          ✕
        </button>

        {selectedCountry && (
          <div className="animate-in fade-in slide-in-from-left-4 duration-500">
            <h2 className="text-4xl font-bold text-emerald-50 mb-1">{selectedCountry}</h2>
            <p className="text-emerald-400/80 mb-6 text-sm font-medium">Regional Mobility Analysis</p>

            {countryData[selectedCountry] ? (
              <div className="space-y-6 mb-8">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-900/30 rounded-2xl border border-emerald-800/50">
                    <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">Energy Use / Capita</div>
                    <div className="text-2xl font-bold text-red-400 mt-1">
                      {Number.isFinite(countryData[selectedCountry].energyUsePerCapitaKgOe)
                        ? countryData[selectedCountry].energyUsePerCapitaKgOe.toFixed(2)
                        : '-'}
                    </div>
                    <div className="mt-1 text-[10px] text-emerald-300/80">
                      {countryData[selectedCountry].energyUseYear || '-'} • kg oil eq.
                    </div>
                  </div>
                  <div className="p-4 bg-emerald-900/30 rounded-2xl border border-emerald-800/50">
                    <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">Primary Energy PPP</div>
                    <div className="text-2xl font-bold text-orange-400 mt-1">
                      {Number.isFinite(countryData[selectedCountry].primaryEnergyPerPppKd)
                        ? countryData[selectedCountry].primaryEnergyPerPppKd.toFixed(3)
                        : '-'}
                    </div>
                    <div className="mt-1 text-[10px] text-emerald-300/80">
                      {countryData[selectedCountry].primaryEnergyYear || '-'} • indicator scale
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-emerald-900/20 rounded-xl mb-8 border border-emerald-800/30 text-emerald-400/60 italic text-sm">
                Basic data loaded. Select a major hub for detailed transport metrics.
              </div>
            )}

            <SidebarWidget location={selectedCountry} countryMetrics={countryData[selectedCountry]} />
          </div>
        )}
      </div>
    </div>
  );
}

export default CountrySidebar;
