import { Leaf, MapPinned, Route, Search, Sparkles, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInitialLeaderboardState } from '../features/achievements/leaderboardRuntime';

const journeyAchievementDefs = [
  { id: 'journey_starter', title: 'Journey Starter', desc: 'Start 1 planned journey', icon: '🚀', target: 1, metricKey: 'started' },
  { id: 'distance_tracker', title: 'Distance Tracker', desc: 'Accumulate 100 km planned', icon: '🧭', target: 100, metricKey: 'totalDistanceKm' },
  { id: 'calorie_builder', title: 'Calorie Builder', desc: 'Accumulate 3000 active kcal', icon: '🔥', target: 3000, metricKey: 'totalCalories' },
  { id: 'carbon_cutter', title: 'Carbon Cutter', desc: 'Save 10 kg CO2 vs driving', icon: '🌿', target: 10, metricKey: 'totalCo2SavedKg' }
];

function getRuntimeState() {
  const stats = (typeof window !== 'undefined' && window.__ecoRuntimeStats) || {
    routesFound: 0,
    addressesSearched: 0,
    countriesExplored: []
  };
  const journey = (typeof window !== 'undefined' && window.__ecoRuntimeJourneyAchievements) || {
    totals: {
      started: 0,
      completed: 0,
      totalDistanceKm: 0,
      totalCalories: 0,
      totalCo2SavedKg: 0
    },
    unlocked: {}
  };
  const leaderboard =
    (typeof window !== 'undefined' && window.__ecoRuntimeLeaderboard) || getInitialLeaderboardState();
  return { stats, journey, leaderboard };
}

export default function Achievements() {
  const [runtimeState, setRuntimeState] = useState(() => getRuntimeState());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onRuntimeUpdated = event => {
      const nextStats = event?.detail?.stats || window.__ecoRuntimeStats;
      const nextJourney = event?.detail?.journeyAchievementState || window.__ecoRuntimeJourneyAchievements;
      const nextLeaderboard = event?.detail?.leaderboardState || window.__ecoRuntimeLeaderboard || getInitialLeaderboardState();
      setRuntimeState({
        stats: nextStats || getRuntimeState().stats,
        journey: nextJourney || getRuntimeState().journey,
        leaderboard: nextLeaderboard
      });
    };
    window.addEventListener('eco-runtime-updated', onRuntimeUpdated);
    onRuntimeUpdated({});
    return () => {
      window.removeEventListener('eco-runtime-updated', onRuntimeUpdated);
    };
  }, []);

  const { stats, journey, leaderboard } = runtimeState;

  const coreAchievements = [
    {
      id: 'pathfinder',
      title: 'Pathfinder',
      desc: 'Calculate 5 routes',
      icon: <Route className="h-5 w-5" />,
      unlocked: Number(stats.routesFound || 0) >= 5,
      progress: `${Number(stats.routesFound || 0)}/5`
    },
    {
      id: 'explorer',
      title: 'Explorer',
      desc: 'Explore 3 countries',
      icon: <MapPinned className="h-5 w-5" />,
      unlocked: (stats.countriesExplored || []).length >= 3,
      progress: `${(stats.countriesExplored || []).length}/3`
    },
    {
      id: 'search_scout',
      title: 'Search Scout',
      desc: 'Search 5 addresses',
      icon: <Search className="h-5 w-5" />,
      unlocked: Number(stats.addressesSearched || 0) >= 5,
      progress: `${Number(stats.addressesSearched || 0)}/5`
    }
  ];

  const journeyAchievements = journeyAchievementDefs.map(def => {
    const value = Number(journey?.totals?.[def.metricKey] || 0);
    const unlocked = Boolean(journey?.unlocked?.[def.id]);
    const progress =
      def.metricKey === 'totalDistanceKm' || def.metricKey === 'totalCo2SavedKg'
        ? `${value.toFixed(1)}/${def.target}`
        : `${Math.round(value)}/${def.target}`;
    return { ...def, value, unlocked, progress };
  });

  const allUnlocked = [...coreAchievements, ...journeyAchievements].filter(a => a.unlocked).length;
  const allCount = coreAchievements.length + journeyAchievements.length;

  return (
    <div className="min-h-screen bg-emerald-950 p-8 pt-32 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="mb-2 text-5xl font-bold text-emerald-50">Your Achievements</h1>
            <p className="text-emerald-400">Track progress from exploration and journey planning.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-100">
              {allUnlocked}/{allCount} unlocked
            </div>
            <Link to="/" className="btn btn-ghost border border-emerald-500/30 text-emerald-400">
              Back to Globe
            </Link>
            <Link to="/leaderboard" className="btn border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25">
              Leaderboard #{leaderboard?.userRank || '-'}
            </Link>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 text-emerald-200">
          <Leaf className="h-4 w-4" />
          <span className="text-sm font-semibold uppercase tracking-wider">Core Achievements</span>
        </div>
        <div className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {coreAchievements.map(a => (
            <div
              key={a.id}
              className={`rounded-3xl border p-5 transition-all ${
                a.unlocked ? 'border-emerald-400/40 bg-emerald-400/15' : 'border-white/10 bg-black/20 opacity-80'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-2xl p-3 ${a.unlocked ? 'bg-emerald-200/20 text-emerald-100' : 'bg-emerald-950/50 text-emerald-500'}`}>
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold">{a.title}</h3>
                  <p className="text-xs text-emerald-300/80">{a.desc}</p>
                </div>
                {a.unlocked ? <Trophy className="h-5 w-5 text-yellow-400" /> : null}
              </div>
              <div className="mt-3 text-right font-mono text-xs text-emerald-200/90">{a.progress}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex items-center gap-2 text-emerald-200">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-semibold uppercase tracking-wider">Journey Achievements</span>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {journeyAchievements.map(a => (
            <div
              key={a.id}
              className={`rounded-3xl border p-5 transition-all ${
                a.unlocked ? 'border-emerald-400/40 bg-emerald-400/15' : 'border-white/10 bg-black/20 opacity-80'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl text-2xl ${
                  a.unlocked ? 'bg-emerald-200/20' : 'bg-emerald-950/50'
                }`}>
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold">{a.title}</h3>
                  <p className="text-xs text-emerald-300/80">{a.desc}</p>
                </div>
                {a.unlocked ? <Trophy className="h-5 w-5 text-yellow-400" /> : null}
              </div>
              <div className="mt-3 text-right font-mono text-xs text-emerald-200/90">{a.progress}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
