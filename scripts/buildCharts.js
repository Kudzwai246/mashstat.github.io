/**
 * buildCharts.js
 * Generates mash100.json & masha50.json by combining Spotify streams + Firestore votes,
 * now including artworkUrl for each track/album.
 */

const fs            = require('fs');
const admin         = require('firebase-admin');
const SpotifyWebApi = require('spotify-web-api-node');

// Firebase Admin init
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(svc)
});
const db = admin.firestore();

// Spotify client init
const spotify = new SpotifyWebApi({
  clientId:     process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

async function getSpotifyToken() {
  const data = await spotify.clientCredentialsGrant();
  spotify.setAccessToken(data.body.access_token);
}

(async () => {
  await getSpotifyToken();

  // last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // fetch votes
  const snap = await db.collection('votes')
                     .where('timestamp', '>=', weekAgo)
                     .get();
  const votes = snap.docs.map(d => d.data());

  // tally votes by song / album
  function tally(key) {
    const m = {};
    votes.forEach(v => {
      const id = v[key].artist + '|' + v[key].title;
      m[id] = (m[id] || 0) + 1;
    });
    return Object.entries(m).map(([kt, count]) => {
      const [artist, title] = kt.split('|');
      return { artist, title, votes: count };
    });
  }

  const songVotes  = tally('song');
  const albumVotes = tally('album');

  // enrich via Spotify API, now grabbing artwork URL too
  async function enrich(item, type) {
    if (type === 'song') {
      const res = await spotify.searchTracks(
        `track:${item.title} artist:${item.artist}`,
        { limit: 1 }
      );
      const tr = res.body.tracks.items[0];
      if (tr) {
        item.streams     = tr.popularity || 0;
        // Spotify track object has album.images array
        item.artworkUrl  = tr.album.images[0]?.url || '';
      } else {
        item.streams    = 0;
        item.artworkUrl = '';
      }
    } else {
      const res = await spotify.searchAlbums(
        `album:${item.title} artist:${item.artist}`,
        { limit: 1 }
      );
      const al = res.body.albums.items[0];
      if (al) {
        item.streams     = al.total_tracks || 0;
        item.artworkUrl  = al.images[0]?.url || '';
      } else {
        item.streams    = 0;
        item.artworkUrl = '';
      }
    }
    return item;
  }

  // build & sort mash100
  let mash100 = await Promise.all(songVotes.map(v => enrich(v, 'song')));
  mash100.sort((a, b) => (b.votes + b.streams) - (a.votes + a.streams));
  mash100 = mash100.slice(0, 100);

  // build & sort masha50
  let masha50 = await Promise.all(albumVotes.map(v => enrich(v, 'album')));
  masha50.sort((a, b) => (b.votes + b.streams) - (a.votes + a.streams));
  masha50 = masha50.slice(0, 50);

  // write JSON
  if (!fs.existsSync('public')) fs.mkdirSync('public');
  fs.writeFileSync('public/mash100.json', JSON.stringify(mash100, null, 2));
  fs.writeFileSync('public/masha50.json', JSON.stringify(masha50, null, 2));

  console.log('✅ mash100.json & masha50.json generated.');
  process.exit(0);
})();
