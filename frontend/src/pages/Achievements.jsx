import { Trophy, Medal, Star, Leaf, Wind, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const achievements = [
  { id: 1, title: 'Eco-Warrior', desc: 'Used public transport for 10 trips.', icon: <Leaf />, unlocked: true, color: 'text-emerald-400' },
  { id: 2, title: 'Carbon Neutral', desc: 'Offset 100kg of CO2.', icon: <Wind />, unlocked: true, color: 'text-cyan-400' },
  { id: 3, title: 'Calorie Burner', desc: 'Burned 5000 kcal by walking.', icon: <Zap />, unlocked: false, color: 'text-orange-400' },
  { id: 4, title: 'Globe Trotter', desc: 'Explored 5 different countries on the map.', icon: <Star />, unlocked: true, color: 'text-yellow-400' },
];

// src/pages/Achievements.jsx snippet
const stats = JSON.parse(localStorage.getItem('eco_stats') || '{"routesFound":0,"addressesSearched":0,"countriesExplored":[]}');

const achievementList = [
  { 
    title: 'Pathfinder', 
    desc: 'Calculate 5 routes.', 
    unlocked: stats.routesFound >= 5, 
    progress: `${stats.routesFound}/5` 
  },
  { 
    title: 'Explorer', 
    desc: 'Explore 3 different countries.', 
    unlocked: stats.countriesExplored.length >= 3, 
    progress: `${stats.countriesExplored.length}/3` 
  }
];

export default function Achievements() {
  return (
    <div className="min-h-screen bg-emerald-950 text-white p-8 pt-32">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-5xl font-bold text-emerald-50 mb-2">Your Achievements</h1>
            <p className="text-emerald-400">Track your impact on the planet's health.</p>
          </div>
          <Link to="/" className="btn btn-ghost border border-emerald-500/30 text-emerald-400">
            Back to Globe
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {achievements.map((a) => (
            <div 
              key={a.id} 
              className={`p-6 rounded-3xl border transition-all ${
                a.unlocked ? 'bg-white/[0.05] border-emerald-500/30' : 'bg-black/20 border-white/5 opacity-50'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-2xl bg-emerald-900/50 ${a.unlocked ? a.color : 'text-gray-500'}`}>
                  {a.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold">{a.title}</h3>
                  <p className="text-sm text-emerald-400/70">{a.desc}</p>
                </div>
                {a.unlocked && <Trophy className="ml-auto text-yellow-500 w-5 h-5" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}