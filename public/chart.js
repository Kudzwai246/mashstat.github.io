(async()=>{
  const chart   = document.getElementById('chart');
  const loadDiv = document.getElementById('loading');
  const file    = location.pathname.includes('mash100') ? 'mash100.json' : 'masha50.json';
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    loadDiv.remove();
    data.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="rank">${item.rank}</div>
        <div class="artwork" style="background-image:url('${item.artworkUrl||'asserts/news-placeholder.png'}')"></div>
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="artist">${item.artist}</div>
          <div class="meta">
            <div>${item.weeks || 1}w</div>
            <div>Peak ${item.peak}</div>
            <div>Last ${item.prevRank || '—'}</div>
          </div>
        </div>`;
      chart.append(card);
    });
  } catch(e) {
    console.error('Chart load error:', e);
    loadDiv.textContent = 'Failed to load chart.';
  }
})();
