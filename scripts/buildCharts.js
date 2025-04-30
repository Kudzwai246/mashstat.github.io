/**
 * buildCharts.js
 * Generates mash100.json & masha50.json by combining Spotify streams + Firestore votes.
 * CommonJS format so Node v18 can run without extra flags.
 */
const fs            = require('fs');
const admin         = require('firebase-admin');
const SpotifyWebApi = require('spotify-web-api-node');

// Initialize Firebase Admin SDK
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

// Setup Spotify client
const spotify = new SpotifyWebApi({
  clientId:     process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

async function getSpotifyToken(){
  const data = await spotify.clientCredentialsGrant();
  spotify.setAccessToken(data.body.access_token);
}

// Main
(async ()=>{
  await getSpotifyToken();

  // Date range: past week
  const today   = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Fetch votes from Firestore
  const snap = await db.collection('votes')
                     .where('timestamp', '>=', weekAgo)
                     .get();
  const votes = snap.docs.map(d=>d.data());

  // Tally votes
  function tally(key){
    const m = {};
    votes.forEach(v => {
      const id = v[key].artist + '|' + v[key].title;
      m[id] = (m[id]||0) + 1;
    });
    return Object.entries(m).map(([kt,count])=>{
      const [artist,title] = kt.split('|');
      return { artist, title, votes: count };
    });
  }
  const songVotes  = tally('song');
  const albumVotes = tally('album');

  // Enrich with Spotify popularity
  async function enrich(item, type){
    if(type==='song'){
      const res = await spotify.searchTracks(`track:${item.title} artist:${item.artist}`, { limit: 1 });
      const tr  = res.body.tracks.items[0];
      item.streams = tr ? tr.popularity : 0;
    } else {
      const res = await spotify.searchAlbums(`album:${item.title} artist:${item.artist}`, { limit: 1 });
      const al  = res.body.albums.items[0];
      item.streams = al ? (al.total_tracks||0) : 0;
    }
    return item;
  }

  // Build mash100
  let mash100 = await Promise.all(songVotes.map(v=>enrich(v,'song')));
  mash100.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams));
  mash100 = mash100.slice(0,100);

  // Build masha50
  let masha50 = await Promise.all(albumVotes.map(v=>enrich(v,'album')));
  masha50.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams));
  masha50 = masha50.slice(0,50);

  // Write JSON
  if(!fs.existsSync('public')) fs.mkdirSync('public');
  fs.writeFileSync('public/mash100.json', JSON.stringify(mash100,null,2));
  fs.writeFileSync('public/masha50.json', JSON.stringify(masha50,null,2));

  console.log('✅ mash100.json & masha50.json generated.');
  process.exit(0);
})();
