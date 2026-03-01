import { Activity, BarChart3, Gauge, Leaf } from 'lucide-react';

export default function SidebarWidget({ location, countryMetrics }) {
  if (!location) return null;
  const energyUse = countryMetrics?.energyUsePerCapitaKgOe;
  const energyUseYear = countryMetrics?.energyUseYear;
  const energyUseName =
    countryMetrics?.energyUseIndicatorName || 'Energy use (kg of oil equivalent per capita)';
  const primaryEnergy = countryMetrics?.primaryEnergyPerPppKd;
  const primaryEnergyYear = countryMetrics?.primaryEnergyYear;
  const primaryEnergyName =
    countryMetrics?.primaryEnergyIndicatorName ||
    'Primary energy indicator (PPP-adjusted constant dollars)';
  const carbIntensityScore = countryMetrics?.carbIntensityScore;
  const normalizedEnergyUse = countryMetrics?.normalizedEnergyUse;

  const gaugeWidth = Number.isFinite(normalizedEnergyUse)
    ? `${Math.max(2, Math.min(100, Math.round(normalizedEnergyUse * 100)))}%`
    : '2%';
  const pressureLabel = Number.isFinite(carbIntensityScore)
    ? carbIntensityScore >= 66
      ? 'High'
      : carbIntensityScore >= 33
        ? 'Medium'
        : 'Low'
    : 'Unknown';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Country Energy Metrics</h4>
        <span className="text-[10px] text-emerald-400/50">{location}</span>
      </div>

      <div className="space-y-3">
        <div className="relative overflow-hidden p-4 rounded-2xl bg-white/[0.03] border border-white/5">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-300">
              <Activity className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-200/80">
                {countryMetrics?.energyUseIndicatorCode || 'EG.USE.PCAP.KG.OE'}
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-50">{energyUseName}</div>
              <div className="mt-2 text-2xl font-bold text-red-300">
                {Number.isFinite(energyUse) ? energyUse.toFixed(2) : '-'}
              </div>
              <div className="text-[11px] text-emerald-300/70">Year: {energyUseYear || '-'} • kg oil eq./capita</div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden p-4 rounded-2xl bg-white/[0.03] border border-white/5">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-300">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-200/80">
                {countryMetrics?.primaryEnergyIndicatorCode || 'EG.EGY.PRIM.PP.KD'}
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-50">{primaryEnergyName}</div>
              <div className="mt-2 text-2xl font-bold text-cyan-300">
                {Number.isFinite(primaryEnergy) ? primaryEnergy.toFixed(3) : '-'}
              </div>
              <div className="text-[11px] text-emerald-300/70">Year: {primaryEnergyYear || '-'} • PPP metric</div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden p-4 rounded-2xl bg-white/[0.03] border border-white/5">
          <div className="mb-3 flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-300">
              <Gauge className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-200/80">Carbonization Pressure</div>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-amber-200">{Number.isFinite(carbIntensityScore) ? `${carbIntensityScore}` : '-'}</div>
            <div className="text-xs font-semibold text-amber-100/80">{pressureLabel}</div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-emerald-950/70">
            <div
              className="h-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
              style={{ width: Number.isFinite(carbIntensityScore) ? `${Math.max(2, carbIntensityScore)}%` : '2%' }}
            />
          </div>
          <div className="mt-2 text-[11px] text-emerald-300/70">
            Derived from normalized per-capita use and primary-energy productivity.
          </div>
        </div>

        <div className="relative overflow-hidden p-4 rounded-2xl bg-white/[0.03] border border-white/5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300/85">
            <Leaf className="w-3 h-3" />
            Relative Energy Use
          </div>
          <div className="h-1.5 rounded-full bg-emerald-950/70">
            <div
              className="h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
              style={{ width: gaugeWidth }}
            />
          </div>
          <div className="mt-2 text-[11px] text-emerald-300/70">
            {Number.isFinite(normalizedEnergyUse)
              ? `${Math.round(normalizedEnergyUse * 100)}th percentile of countries in current dataset slice`
              : 'No normalized value available'}
          </div>
        </div>
      </div>

      {!countryMetrics && (
        <div className="p-4 rounded-2xl bg-emerald-900/20 border border-emerald-800/30 text-emerald-300/70 text-xs">
          This country has no matching values in the ingested World Bank indicator rows.
        </div>
      )}

      <div className="w-full mt-4 py-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 text-xs">
        Source indicators: EG.USE.PCAP.KG.OE and EG.EGY.PRIM.PP.KD
      </div>
    </div>
  );
}
