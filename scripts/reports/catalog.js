// scripts/reports/catalog.js
// Single source of truth for which series/classes the pipeline aggregates.
// `match` holds groups of lowercased substrings; a group is satisfied when every
// token appears in the iRacing series_name (tokens prefixed with '!' must be ABSENT).
// matchSeriesName returns the first catalog entry with any satisfied group.
// Ordered most-specific first to avoid collisions (e.g. "fixed" before the open variant).
export const CATALOG = [
  { key:'imsa-fixed', displayName:'IMSA — Fixed', category:'IMSA',
    classes:['GTP','LMP2','GT3'], match:[['imsa','fixed']] },
  { key:'imsa-open',  displayName:'IMSA — Open',  category:'IMSA',
    classes:['GTP','LMP2','GT3'], match:[['imsa','!fixed']] },

  { key:'gt3-regional-americas', displayName:'GT3 Regional Tour — Americas', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','americas']] },
  { key:'gt3-regional-europe', displayName:'GT3 Regional Tour — Europe', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','europe']] },
  { key:'gt3-regional-asia', displayName:'GT3 Regional Tour — Asia Pacific', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','asia']] },
  { key:'gt3-challenge-fixed', displayName:'GT3 Challenge — Fixed', category:'GT3',
    classes:['GT3'], match:[['gt3','challenge','fixed']] },
  { key:'gt-sprint', displayName:'GT Sprint Series', category:'GT3',
    classes:['GT3'], match:[['gt','sprint']] },

  { key:'porsche-cup-fixed', displayName:'Porsche Cup — Fixed', category:'Porsche Cup',
    classes:['Cup'], match:[['porsche','cup','fixed']] },
  { key:'porsche-cup', displayName:'Porsche Cup', category:'Porsche Cup',
    classes:['Cup'], match:[['porsche','cup','!fixed']] },

  { key:'gt4-challenge', displayName:'GT4 Challenge', category:'GT4',
    classes:['GT4'], match:[['gt4','challenge']] },
  { key:'sports-car-challenge', displayName:'Sports Car Challenge', category:'GT4/LMP3',
    classes:['GT4','LMP3'], match:[['sports','car','challenge']] },

  { key:'lmp3-trophy', displayName:'LMP3 Trophy', category:'LMP3',
    classes:['LMP3'], match:[['lmp3','trophy']] },
];

export function matchSeriesName(seriesName) {
  const n = (seriesName || '').toLowerCase();
  for (const entry of CATALOG) {
    for (const group of entry.match) {
      const ok = group.every(tok =>
        tok.startsWith('!') ? !n.includes(tok.slice(1)) : n.includes(tok));
      if (ok) return entry;
    }
  }
  return null;
}
