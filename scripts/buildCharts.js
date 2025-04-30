/**
 * buildCharts.js
 * CommonJS style so Node can execute without extra flags.
 */
const fs            = require('fs');
const admin         = require('firebase-admin');
const SpotifyWebApi = require('spotify-web-api-node');

// 1) Init Firebase Admin
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

// 2) Spotify setup
const spotify = new SpotifyWebApi({
  clientId:     process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Helper to fetch Spotify token
async function getSpotifyToken(){
  const data = await spotify.clientCredentialsGrant();
  spotify.setAccessToken(data.body.access_token);
}

// 3) Main
(async ()=>{
  await getSpotifyToken();

  // date range: past week
  const today   = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // 4) Fetch votes from Firestore
  const votesSnap = await db.collection('votes')
    .where('timestamp', '>=', weekAgo)
    .get();
  const votes = votesSnap.docs.map(d=>d.data());

  // 5) Aggregate votes
  function tally(key){
    const m = {};
    votes.forEach(v=>{
      const id = v[key].artist + '|' + v[key].title;
      m[id] = (m[id]||0) + 1;
    });
    return Object.entries(m).map(([kt,c])=>{
      const [artist,title] = kt.split('|');
      return { artist, title, votes: c };
    });
  }
  const songVotes  = tally('song');
  const albumVotes = tally('album');

  // 6) Enrich with Spotify “popularity” as proxy for streams
  async function enrich(item, type){
    if(type==='song'){
      const res = await spotify.searchTracks(\`track:\${item.title} artist:\${item.artist}\`, { limit: 1 });
      const tr  = res.body.tracks.items[0];
      item.streams = tr ? tr.popularity : 0;
    } else {
      const res = await spotify.searchAlbums(\`album:\${item.title} artist:\${item.artist}\`, { limit: 1 });
      const al  = res.body.albums.items[0];
      item.streams = al ? (al.total_tracks||0) : 0;
    }
    return item;
  }

  let mash100 = await Promise.all(songVotes.map(v=>enrich(v,'song')));
  mash100.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams));
  mash100 = mash100.slice(0,100);

  let masha50 = await Promise.all(albumVotes.map(v=>enrich(v,'album')));
  masha50.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams));
  masha50 = masha50.slice(0,50);

  // 7) Write JSON
  if(!fs.existsSync('public')) fs.mkdirSync('public');
  fs.writeFileSync('public/mash100.json', JSON.stringify(mash100,null,2));
  fs.writeFileSync('public/masha50.json', JSON.stringify(masha50,null,2));

  console.log('✅ mash100.json & masha50.json generated.');
  process.exit(0);
})();
