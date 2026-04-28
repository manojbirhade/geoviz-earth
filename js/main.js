// ── BOOTSTRAP ───────────────────────────────────────────────────────────────
(async function main() {
  const ui = new UIManager(null, null);
  ui.setLoadingProgress(5, 'Initializing…');

  const dm = new DataManager();
  const mm = new MapManager(dm);

  ui.dm = dm;
  ui.mm = mm;
  ui.init();

  // ── MAP READY ──────────────────────────────────────────────────────────
  mm.on('mapReady', async () => {
    ui.setLoadingProgress(20, 'Map ready…');

    // Particle canvas — Leaflet map object passed for coordinate conversion
    const canvas = document.getElementById('particle-canvas');
    const particles = new ParticleSystem(canvas, mm.map);
    mm.particleSystem = particles;

    // ── LOAD DATA ────────────────────────────────────────────────────────
    ui.setLoadingProgress(35, 'Fetching earthquake data…');
    await dm.fetchEarthquakes();

    ui.setLoadingProgress(55, 'Loading volcanic data…');
    await dm.fetchVolcanoes();

    ui.setLoadingProgress(70, 'Fetching tectonic plates…');
    await dm.fetchTectonicPlates();

    ui.setLoadingProgress(82, 'Loading ocean & tsunami data…');
    await dm.fetchTsunamiZones();
    await dm.fetchOceanData();

    ui.setLoadingProgress(95, 'Rendering layers…');

    // ── BIND DATA EVENTS ─────────────────────────────────────────────────
    dm.addEventListener('earthquakesUpdated', (e) => {
      mm.updateEarthquakeData(e.detail.features);
      ui.updateStats(e.detail.features, dm.volcanoes);
      ui.renderRecentEvents(e.detail.features);
      ui.renderTimelineEvents(e.detail.features);
      ui.updateLastFetched();
    });

    dm.addEventListener('volcanoesUpdated', (e) => {
      mm.addVolcanoLayer(e.detail.features);
      ui.updateStats(dm.earthquakes, e.detail.features);
    });

    dm.addEventListener('tectonicPlatesLoaded', (e) => {
      mm.updateTectonicPlates(e.detail.geojson);
    });

    dm.addEventListener('tsunamiZonesLoaded', (e) => {
      mm.updateTsunamiZones(e.detail.geojson);
    });

    dm.addEventListener('oceanDataUpdated', (e) => {
      particles.setVectorField(e.detail.vectors);
      if (mm.layerVisibility.currents) particles.start();
    });

    dm.addEventListener('newMajorQuake', (e) => {
      ui.showQuakeAlert(e.detail);
    });

    dm.addEventListener('loading:start', (e) => {
      const indicator = document.getElementById('map-loading-indicator');
      if (indicator) {
        indicator.classList.remove('hidden');
        indicator.querySelector('.loading-label').textContent = `Updating ${e.detail.feed}…`;
      }
    });

    dm.addEventListener('loading:end', () => {
      const indicator = document.getElementById('map-loading-indicator');
      if (indicator) {
        setTimeout(() => indicator.classList.add('hidden'), 800);
      }
    });

    // ── MAP MANAGER EVENTS ───────────────────────────────────────────────
    mm.on('earthquakeClick', (eq) => {
      ui.renderDetailPanelEarthquake(eq);
    });

    mm.on('volcanoClick', (v) => {
      ui.renderDetailPanelVolcano(v);
      mm.flyToEvent([v.lng, v.lat], 8);
    });

    mm.on('earthquakeHover', (props) => {
      ui.showTooltip({
        title: `M${(props.magnitude || 0).toFixed(1)} — ${props.place || 'Unknown'}`,
        rows: [
          ['Depth', `${(props.depth || 0).toFixed(1)} km`],
          ['Time', DataManager.timeAgo(props.time || Date.now())],
          props.felt > 0 ? ['Felt reports', props.felt] : null,
        ].filter(Boolean),
        x: props.x, y: props.y,
      });
    });

    mm.on('volcanoHover', ({ volcano: v, x, y }) => {
      ui.showTooltip({
        title: v.name,
        rows: [
          ['Country', v.country],
          ['Type', v.type || '—'],
          ['Alert', v.alert_level || 'Normal'],
          ['Elevation', v.elevation ? `${v.elevation}m` : '—'],
        ],
        x, y,
      });
    });

    mm.on('tectonicHover', ({ name, x, y }) => {
      ui.showTooltip({
        title: 'Tectonic Boundary',
        rows: [['Plate', name]],
        x, y,
      });
    });

    mm.on('tooltipHide', () => ui.hideTooltip());

    // ── INITIAL RENDER ────────────────────────────────────────────────────
    const filteredEq = dm._filterEarthquakes(dm.earthquakes);
    dm.emit('earthquakesUpdated', { features: filteredEq });
    dm.emit('volcanoesUpdated', { features: dm.volcanoes });
    if (dm.tectonicPlates) dm.emit('tectonicPlatesLoaded', { geojson: dm.tectonicPlates });
    if (dm.tsunamiZones) dm.emit('tsunamiZonesLoaded', { geojson: dm.tsunamiZones });

    dm.startPolling();

    ui.setLoadingProgress(100, 'Ready');
    setTimeout(() => {
      ui.hideLoadingScreen();
      ui.showToast({
        title: 'GeoViz Earth Ready',
        body: `${dm.earthquakes.length} seismic events loaded. Real-time monitoring active.`,
        color: 'var(--accent-cyan)',
        icon: 'globe',
        duration: 5000,
      });
    }, 400);
  });

  ui.setLoadingProgress(15, 'Loading map…');
  mm.initMap();
})();
