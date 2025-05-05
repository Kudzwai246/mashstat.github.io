// ───────────────────────────────────────────────────────────────────────────────
// scripts/buildCharts.js — Weekly MashStat build with correct Apple JSON feeds
// ───────────────────────────────────────────────────────────────────────────────

const fs            = require('fs');
const admin         = require('firebase-admin');
const SpotifyWebApi = require('spotify-web-api-node');

// Firebase Admin init
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

// Spotify init
const spotify = new SpotifyWebApi({
  clientId:     process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});
async function getSpotifyToken() {
  const data = await spotify.clientCredentialsGrant();
  spotify.setAccessToken(data.body.access_token);
}

;(async () => {
  await getSpotifyToken();

  // 1) Seed Songs from Apple Top 100 (ZW) JSON
  let songMap = new Map();
  try {
    const res  = await fetch('https://rss.applemarketingtools.com/api/v2/zw/music/most-played/100/songs.json');
    const json = await res.json();
    json.feed.results.forEach(r => {
      const key = r.artistName + '|' + r.name;
      songMap.set(key, {
        artist:     r.artistName,
        title:      r.name,
        votes:      0,
        streams:    0,
        artworkUrl: r.artworkUrl100.replace(/100x100/, '300x300')
      });
    });
  } catch (e) {
    console.warn('⚠️  Apple Songs seed failed:', e.message);
  }

  // 2) Seed Albums from Apple Top 200 (ZW) JSON
  let albumMap = new Map();
  try {
    const res  = await fetch('https://rss.applemarketingtools.com/api/v2/zw/music/most-played/100/albums.json');
    const json = await res.json();
    json.feed.results.forEach(r => {
      const key = r.artistName + '|' + r.name;
      albumMap.set(key, {
        artist:     r.artistName,
        title:      r.name,
        votes:      0,
        streams:    0,
        artworkUrl: r.artworkUrl100.replace(/100x100/, '300x300')
      });
    });
  } catch (e) {
    console.warn('⚠️  Apple Albums seed failed:', e.message);
  }

  // 3) Tally votes (last 7 days)
  const weekAgo  = new Date(Date.now() - 7 * 24 * 3600000);
  const voteSnap = await db.collection('votes')
                           .where('timestamp','>=', weekAgo)
                           .get();
  voteSnap.docs.forEach(doc => {
    const v = doc.data();
    if (v.song) {
      const key = v.song.artist + '|' + v.song.title;
      if (songMap.has(key)) songMap.get(key).votes++;
    }
    if (v.album) {
      const key = v.album.artist + '|' + v.album.title;
      if (albumMap.has(key)) albumMap.get(key).votes++;
    }
  });

  // 4) Enrich Songs via Spotify
  for (let entry of songMap.values()) {
    try {
      const q   = 'track:' + entry.title + ' artist:' + entry.artist;
      const res = await spotify.searchTracks(q, { limit: 1 });
      const tr  = res.body.tracks.items[0];
      if (tr) {
        entry.streams    = tr.popularity * 1000;
        entry.artworkUrl = tr.album.images[0]?.url || entry.artworkUrl;
      }
    } catch {}
  }

  // 5) Load last week’s mash100
  let prev100 = [];
  try { prev100 = JSON.parse(fs.readFileSync('public/mash100.json')); } catch {}
  const prev100Map = new Map(prev100.map(i => [i.artist + '|' + i.title, i]));

  // 6) Score & sort Songs
  const songArr = Array.from(songMap.values()).map(i => {
    const key  = i.artist + '|' + i.title;
    const prev = prev100Map.get(key);
    const carry = prev ? (101 - prev.rank) * 0.05 : 0;
    return {
      ...i,
      score:     i.votes + i.streams/500000 + carry,
      prevRank:  prev?.rank || null,
      prevWeeks: prev?.weeks || 0,
      prevPeak:  prev?.peak || 0
    };
  });
  songArr.sort((a,b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.prevWeeks + 1) - (a.prevWeeks + 1);
  });

  const mash100 = songArr.slice(0,100).map((i, idx) => {
    const key  = i.artist + '|' + i.title;
    const prev = prev100Map.get(key);
    const weeks= (prev?.weeks || 0) + 1;
    const peak = prev ? Math.min(prev.peak, idx+1) : idx+1;
    const trend= prev
      ? (prev.rank > idx+1 ? 'up' : prev.rank < idx+1 ? 'down' : '—')
      : 'new';
    return { artist:i.artist, title:i.title, votes:i.votes, streams:i.streams,
             artworkUrl:i.artworkUrl, rank:idx+1, prevRank:i.prevRank,
             weeks, peak, trend };
  });

  // 7) Load last week’s masha50
  let prev50 = [];
  try { prev50 = JSON.parse(fs.readFileSync('public/masha50.json')); } catch {}
  const prev50Map = new Map(prev50.map(i=>[i.artist + '|' + i.title, i]));

  // 8) Score & sort Albums (no Spotify enrich)
  const albumArr = Array.from(albumMap.values()).map(i => {
    const key  = i.artist + '|' + i.title;
    const prev = prev50Map.get(key);
    const carry = prev ? (51 - prev.rank) * 0.05 : 0;
    return { ...i, score:i.votes + carry, prevRank:prev?.rank||null, prevWeeks:prev?.weeks||0 };
  });
  albumArr.sort((a,b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.prevWeeks+1) - (a.prevWeeks+1);
  });

  const masha50 = albumArr.slice(0,50).map((i, idx) => {
    const key  = i.artist + '|' + i.title;
    const prev = prev50Map.get(key);
    const weeks= (prev?.weeks || 0) + 1;
    const peak = prev ? Math.min(prev.peak, idx+1) : idx+1;
    const trend= prev
      ? (prev.rank > idx+1 ? 'up' : prev.rank < idx+1 ? 'down' : '—')
      : 'new';
    return { artist:i.artist, title:i.title, votes:i.votes, streams:i.streams,
             artworkUrl:i.artworkUrl, rank:idx+1, prevRank:i.prevRank,
             weeks, peak, trend };
  });

  // 9) Write JSON
  if (!fs.existsSync('public')) fs.mkdirSync('public');
  fs.writeFileSync('public/mash100.json', JSON.stringify(mash100, null, 2));
  fs.writeFileSync('public/masha50.json', JSON.stringify(masha50, null, 2));

  console.log('✅ mash100.json & masha50.json generated');
})();
