const fs            = require('fs'); const { parse }     = require('csv-parse/sync'); const admin         = require('firebase-admin'); const SpotifyWebApi = require('spotify-web-api-node');

// Initialize Firebase Admin const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); admin.initializeApp({ credential: admin.credential.cert(svc) }); const db = admin.firestore();

// Initialize Spotify API const spotify = new SpotifyWebApi({ clientId:     process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET }); async function getSpotifyToken() { const data = await spotify.clientCredentialsGrant(); spotify.setAccessToken(data.body.access_token); }

(async () => { await getSpotifyToken();

// 1) (Optional) Apple Music Top100 ZW let appleList = []; try { const appleResp = await fetch('https://rss.applemarketingtools.com/api/v2/zw/music/most-played/100/songs.json'); const appleJson = await appleResp.json(); if (Array.isArray(appleJson.feed?.results)) { appleList = appleJson.feed.results.map(r => ({ title:      r.name, artist:     r.artistName, streams:    0, artworkUrl: r.artworkUrl100.replace(/100x100/, '300x300') })); } } catch { console.warn('Skipping Apple Music seed'); }

// 2) Spotify weekly top200 CSV const csvText = await (await fetch('https://spotifycharts.com/regional/zw/weekly/latest/downloads')).text(); const records = parse(csvText, { columns: ['pos','track','artist','streams'], from_line: 2 }); const spotifyList = records.map(r => ({ title:      r.track, artist:     r.artist, streams:    parseInt(r.streams.replace(/,/g,''), 10), artworkUrl: '' }));

// 3) Votes in last 7 days const weekAgo = new Date(Date.now() - 7243600000); const snap    = await db.collection('votes').where('timestamp','>=', weekAgo).get(); const votes   = snap.docs.map(d => d.data());

// 4) Build candidate map const map = new Map(); function add(item) { const key = item.artist + '|' + item.title; if (!map.has(key)) { map.set(key, { artist:     item.artist, title:      item.title, votes:      0, streams:    item.streams || 0, artworkUrl: item.artworkUrl || '', weeks:      0, prevRank:   null, peak:       0 }); } return map.get(key); } appleList.forEach(add); spotifyList.forEach(add); votes.forEach(v => { const e = add(v.song); e.votes++; });

// 5) Enrich streams & artwork via Spotify Search for (const entry of map.values()) { try { const query = 'track:' + entry.title + ' artist:' + entry.artist; const res   = await spotify.searchTracks(query, { limit: 1 }); const tr    = res.body.tracks.items[0]; if (tr) { entry.streams    = tr.popularity * 1000; entry.artworkUrl = tr.album.images[0]?.url || entry.artworkUrl; } } catch {} }

// 6) Score & sort const arr = Array.from(map.values()); arr.forEach(i => i.score = i.votes + i.streams/500000); arr.sort((a,b) => b.score - a.score);

// 7) Top 100 songs const mash100 = arr.slice(0,100).map((i, idx) => ({ ...i, rank:     idx + 1, prevRank: i.prevRank, weeks:    (i.weeks||0) + 1, peak:     Math.min(i.prevRank||idx+1, idx+1), trend:    i.prevRank===null ? 'new' : (i.prevRank > idx+1 ? 'up' : (i.prevRank < idx+1 ? 'down' : '—')) }));

// 8) Top 50 albums: reuse first 50 const masha50 = mash100.slice(0,50);

// 9) Write JSON files if (!fs.existsSync('public')) fs.mkdirSync('public'); fs.writeFileSync('public/mash100.json', JSON.stringify(mash100, null, 2)); fs.writeFileSync('public/masha50.json', JSON.stringify(masha50, null, 2));

console.log('✅ mash100.json & masha50.json generated'); })(); EOF

