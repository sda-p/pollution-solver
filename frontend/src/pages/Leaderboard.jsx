import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Flag, Trophy } from 'lucide-react';
import { getInitialLeaderboardState } from '../features/achievements/leaderboardRuntime';

function confettiPieces(count = 56) {
  return Array.from({ length: count }, (_, idx) => {
    const left = (idx / count) * 100;
    const hue = (idx * 37) % 360;
    const delay = (idx % 12) * 35;
    const drift = (idx % 2 === 0 ? 1 : -1) * (8 + (idx % 5) * 3);
    return {
      id: `c-${idx}`,
      left,
      hue,
      delay,
      drift
    };
  });
}

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState(() => getInitialLeaderboardState());
  const [burstNonce, setBurstNonce] = useState(0);
  const pieces = useMemo(() => confettiPieces(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onRuntimeUpdated = event => {
      const next = event?.detail?.leaderboardState || window.__ecoRuntimeLeaderboard || getInitialLeaderboardState();
      setLeaderboard(next);
    };
    window.addEventListener('eco-runtime-updated', onRuntimeUpdated);
    onRuntimeUpdated({});
    return () => window.removeEventListener('eco-runtime-updated', onRuntimeUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.__ecoLeaderboardConfettiPending) {
      setBurstNonce(n => n + 1);
      window.__ecoLeaderboardConfettiPending = false;
    }
  }, [leaderboard?.userRank]);

  return (
    <div className="min-h-screen bg-emerald-950 p-8 pt-32 text-white">
      <style>{`
        @keyframes eco-confetti-fall {
          0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate3d(var(--drift), 82vh, 0) rotate(760deg); opacity: 0; }
        }
      `}</style>
      {burstNonce > 0 ? (
        <div key={burstNonce} className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
          {pieces.map(piece => (
            <span
              key={`${burstNonce}-${piece.id}`}
              className="absolute top-0 h-3 w-2 rounded-sm"
              style={{
                left: `${piece.left}%`,
                background: `hsl(${piece.hue} 95% 60%)`,
                animation: `eco-confetti-fall 1800ms cubic-bezier(0.12, 0.8, 0.18, 1) ${piece.delay}ms forwards`,
                '--drift': `${piece.drift}vw`
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-end justify-between gap-4">
          <div>
            <h1 className="mb-2 text-5xl font-bold text-emerald-50">Distance Leaderboard</h1>
            <p className="text-emerald-400">Total km traveled this session.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/achievements" className="btn btn-ghost border border-emerald-500/30 text-emerald-400">
              Achievements
            </Link>
            <Link to="/" className="btn btn-ghost border border-emerald-500/30 text-emerald-400">
              Back to Globe
            </Link>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-emerald-400/30 bg-emerald-900/20 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-emerald-100">
            <span className="inline-flex items-center gap-2"><Flag className="h-4 w-4" />Your rank</span>
            <span className="font-semibold">#{leaderboard?.userRank || '-'}</span>
          </div>
          <div className="mt-2 text-emerald-300">
            {Number(leaderboard?.userKm || 0).toFixed(1)} km
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-400/30 bg-black/25 p-4">
          <div className="grid grid-cols-[72px_1fr_120px] gap-3 px-3 pb-2 text-xs uppercase tracking-wide text-emerald-300/80">
            <span>Rank</span>
            <span>Traveler</span>
            <span className="text-right">Distance</span>
          </div>
          <div className="space-y-2">
            {(leaderboard?.ranking || []).map(entry => {
              const isTop = entry.rank === 1;
              return (
                <div
                  key={entry.id}
                  className={`grid grid-cols-[72px_1fr_120px] items-center gap-3 rounded-2xl border px-3 py-3 ${
                    entry.isUser
                      ? 'border-emerald-300/50 bg-emerald-400/20'
                      : 'border-white/10 bg-emerald-950/40'
                  }`}
                >
                  <div className="inline-flex items-center gap-2 font-semibold text-emerald-100">
                    {isTop ? <Crown className="h-4 w-4 text-yellow-300" /> : null}
                    #{entry.rank}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{entry.name}</span>
                    {entry.isUser ? <Trophy className="h-4 w-4 text-emerald-200" /> : null}
                  </div>
                  <div className="text-right font-mono text-sm text-emerald-100">{Number(entry.km || 0).toFixed(1)} km</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
