export const INITIAL_TRAVEL_RECORDS = [
  { id: 'r1', name: 'Maya', km: 1240.3 },
  { id: 'r2', name: 'Noah', km: 1118.7 },
  { id: 'r3', name: 'Lina', km: 986.4 },
  { id: 'r4', name: 'Arjun', km: 925.2 },
  { id: 'r5', name: 'Sofia', km: 851.9 },
  { id: 'r6', name: 'Ethan', km: 790.6 },
  { id: 'r7', name: 'Camila', km: 744.8 },
  { id: 'r8', name: 'Mateo', km: 691.1 },
  { id: 'r9', name: 'Ivy', km: 648.5 },
  { id: 'r10', name: 'Lucas', km: 603.2 }
];

export const USER_LEADERBOARD_ID = 'you';

function normalizeKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function buildLeaderboardState(userKm = 0, baseRecords = INITIAL_TRAVEL_RECORDS) {
  const normalizedUserKm = normalizeKm(userKm);
  const records = Array.isArray(baseRecords) ? baseRecords : INITIAL_TRAVEL_RECORDS;

  const ranking = [...records, { id: USER_LEADERBOARD_ID, name: 'You', km: normalizedUserKm, isUser: true }]
    .sort((a, b) => {
      if (b.km !== a.km) return b.km - a.km;
      if (a.isUser) return 1;
      if (b.isUser) return -1;
      return String(a.name).localeCompare(String(b.name));
    })
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  const userEntry = ranking.find(entry => entry.id === USER_LEADERBOARD_ID) || { rank: ranking.length };

  return {
    baseRecords: records.map(item => ({ id: item.id, name: item.name, km: normalizeKm(item.km) })),
    userKm: normalizedUserKm,
    userRank: userEntry.rank,
    ranking
  };
}

export function getInitialLeaderboardState() {
  if (typeof window !== 'undefined' && window.__ecoRuntimeLeaderboard) {
    return window.__ecoRuntimeLeaderboard;
  }
  const runtimeDistance =
    typeof window !== 'undefined'
      ? Number(window.__ecoRuntimeJourneyAchievements?.totals?.totalDistanceKm || 0)
      : 0;
  return buildLeaderboardState(runtimeDistance);
}

export function updateLeaderboardState(previousState, userKm) {
  const baseRecords = previousState?.baseRecords || INITIAL_TRAVEL_RECORDS;
  return buildLeaderboardState(userKm, baseRecords);
}
