import { Footprints, Bike, Bus, Car, Leaf, Flame, Clock, ChevronRight } from 'lucide-react';

export default function SidebarWidget({ location }) {
  if (!location) return null;

  const transportOptions = [
    {
      mode: 'Walk',
      icon: <Footprints className="w-5 h-5" />,
      time: '25 min',
      sustainability: 100,
      calories: 120,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10'
    },
    {
      mode: 'Cycle',
      icon: <Bike className="w-5 h-5" />,
      time: '12 min',
      sustainability: 92,
      calories: 185,
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10'
    },
    {
      mode: 'Public Transport',
      icon: <Bus className="w-5 h-5" />,
      time: '18 min',
      sustainability: 75,
      calories: 45,
      color: 'text-orange-400',
      bg: 'bg-orange-400/10'
    },
    {
      mode: 'Car',
      icon: <Car className="w-5 h-5" />,
      time: '10 min',
      sustainability: 15,
      calories: 12,
      color: 'text-rose-400',
      bg: 'bg-rose-400/10'
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Transport Options</h4>
        <span className="text-[10px] text-emerald-400/50">Estimates for {location}</span>
      </div>
      
      <div className="space-y-3">
        {transportOptions.map((option) => (
          <div 
            key={option.mode}
            className="group relative overflow-hidden p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-emerald-500/40 hover:bg-white/[0.06] transition-all cursor-pointer"
          >
            {/* Top Row: Icon, Name, and Time */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${option.bg} ${option.color}`}>
                  {option.icon}
                </div>
                <div>
                  <span className="block font-bold text-emerald-50 tracking-wide">{option.mode}</span>
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400/70">
                    <Clock className="w-3 h-3" />
                    {option.time}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-emerald-800 group-hover:text-emerald-400 transition-colors" />
            </div>

            {/* Bottom Row: Stats Bars */}
            <div className="grid grid-cols-2 gap-6 pt-2 border-t border-white/5">
              {/* Sustainability */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-500/80">
                    <Leaf className="w-2.5 h-2.5" /> Eco
                  </span>
                  <span className="text-[10px] font-mono text-emerald-200">{option.sustainability}%</span>
                </div>
                <div className="w-full bg-emerald-950/50 rounded-full h-1">
                  <div 
                    className="bg-emerald-500 h-1 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)] transition-all duration-1000" 
                    style={{ width: `${option.sustainability}%` }}
                  ></div>
                </div>
              </div>

              {/* Calories */}
              <div className="flex flex-col justify-center">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-orange-500/80 mb-1">
                  <Flame className="w-2.5 h-2.5" /> Burn
                </span>
                <span className="text-sm font-bold text-emerald-50">
                  {option.calories} <span className="text-[10px] font-normal text-emerald-400/50 ml-0.5">kcal</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full mt-4 py-4 rounded-2xl bg-emerald-500 text-emerald-950 font-bold hover:bg-emerald-400 transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/20">
        Confirm Route
      </button>
    </div>
  );
}