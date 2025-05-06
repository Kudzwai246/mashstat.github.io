#!/usr/bin/env node
/**
 * scripts/buildCity.js
 * Generates public/cityPopularity.json from Firestore votes.
 */

const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

// Load your service account
const svc = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

(async () => {
  // 1) Fetch all votes
  const snap = await db.collection('votes').get();

  // 2) Count per city
  const counts = {};
  snap.docs.forEach(doc => {
    const v = doc.data();
    if (v.city) counts[v.city] = (counts[v.city] || 0) + 1;
  });

  // 3) Convert to sorted array
  const cityPopularity = Object
    .entries(counts)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);

  // 4) Write JSON into public/
  const outPath = path.join(__dirname, '../public/cityPopularity.json');
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(cityPopularity, null, 2));

  console.log('✅ cityPopularity.json generated at', outPath);
  process.exit(0);
})();
