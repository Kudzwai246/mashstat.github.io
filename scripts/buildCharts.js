// scripts/buildCharts.js
import fs from 'fs';
import admin from 'firebase-admin';
import SpotifyWebApi from 'spotify-web-api-node';
import {google} from 'googleapis';

async function main(){
  // 1) Init Firebase Admin
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  const db = admin.firestore();

  // 2) Compute date range (last Wed→today)
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // 3) Fetch votes in past week
  const votesSnap = await db.collection('votes')
    .where('timestamp','>=', weekAgo)
    .get();
  const votes = votesSnap.docs.map(d=>d.data());

  // 4) Aggregate vote counts for songs & albums
  const countVotes = (key) => {
    const m = {};
    votes.forEach(v=>{
      const k = v[key].artist+'|'+v[key].title;
      m[k] = (m[k]||0) + 1;
    });
    return Object.entries(m).map(([kt,c])=>{
      const [artist,title] = kt.split('|');
      return { artist, title, votes: c };
    });
  };
  const songVotes = countVotes('song');
  const albumVotes = countVotes('album');

  // 5) Fetch streaming counts from Spotify
  const spotify = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET
  });
  const token = await spotify.clientCredentialsGrant();
  spotify.setAccessToken(token.body.access_token);

  async function fetchStreams(item){
    // Search track/album, get play count from popularity metric
    if(item.type==='song'){
      const res = await spotify.searchTracks(`track:${item.title} artist:${item.artist}`, { limit:1 });
      const tr = res.body.tracks.items[0];
      item.streams = tr ? tr.popularity : 0;
    } else {
      const res = await spotify.searchAlbums(`album:${item.title} artist:${item.artist}`, { limit:1 });
      const al = res.body.albums.items[0];
      item.streams = al ? al.total_tracks /* fallback */ : 0;
    }
    return item;
  }

  // 6) Merge votes+streams and sort
  let mash100 = await Promise.all(
    songVotes.map(v=>fetchStreams({ ...v, type:'song' }))
  );
  mash100.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams) );
  mash100 = mash100.slice(0,100);

  let masha50 = await Promise.all(
    albumVotes.map(v=>fetchStreams({ ...v, type:'album' }))
  );
  masha50.sort((a,b)=> (b.votes + b.streams) - (a.votes + a.streams) );
  masha50 = masha50.slice(0,50);

  // 7) Write JSON files
  fs.writeFileSync('public/mash100.json', JSON.stringify(mash100, null, 2));
  fs.writeFileSync('public/masha50.json', JSON.stringify(masha50, null, 2));
}
main().catch(e=>{ console.error(e); process.exit(1); });
