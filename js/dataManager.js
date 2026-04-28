class DataManager extends EventTarget {
  constructor() {
    super();
    this.earthquakes = [];
    this.volcanoes = [];
    this.tsunamiZones = null;
    this.tectonicPlates = null;
    this.lastEarthquakeIds = new Set();
    this.filters = {
      minMag: 0,
      timeRange: '24h',
      depth: 'all',
      region: 'global',
    };
    this._intervals = [];
  }

  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _startLoading(feed) { this.emit('loading:start', { feed }); }
  _stopLoading(feed) { this.emit('loading:end', { feed }); }

  // ── EARTHQUAKES ──────────────────────────────────────────────────────────
  async fetchEarthquakes() {
    this._startLoading('earthquakes');
    try {
      const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
      const geojson = await res.json();

      const features = (geojson.features || []).map(f => ({
        id: f.id,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        magnitude: f.properties.mag,
        depth: f.geometry.coordinates[2],
        place: f.properties.place || 'Unknown location',
        time: f.properties.time,
        felt: f.properties.felt || 0,
        type: f.properties.type,
        status: f.properties.status,
        coordinates: f.geometry.coordinates,
        usgsUrl: f.properties.url,
      })).filter(e => e.magnitude !== null);

      // detect new major quakes
      const newMajor = features.filter(
        e => e.magnitude >= 5.0 && !this.lastEarthquakeIds.has(e.id)
      );
      newMajor.forEach(e => this.emit('newMajorQuake', e));

      this.lastEarthquakeIds = new Set(features.map(e => e.id));
      this.earthquakes = features;
      this.emit('earthquakesUpdated', { features: this._filterEarthquakes(features) });
    } catch (err) {
      console.warn('[DataManager] Earthquake fetch failed:', err.message);
      this.emit('earthquakesUpdated', { features: this._filterEarthquakes(this.earthquakes), error: true });
    } finally {
      this._stopLoading('earthquakes');
    }
  }

  _filterEarthquakes(features) {
    const now = Date.now();
    const timeMs = { '1h': 36e5, '6h': 216e5, '24h': 864e5, '7d': 6048e5 };
    const cutoff = now - (timeMs[this.filters.timeRange] || timeMs['24h']);

    return features.filter(e => {
      if (e.magnitude < this.filters.minMag) return false;
      if (e.time < cutoff) return false;
      if (this.filters.depth !== 'all') {
        if (this.filters.depth === 'shallow' && e.depth > 70) return false;
        if (this.filters.depth === 'intermediate' && (e.depth <= 70 || e.depth > 300)) return false;
        if (this.filters.depth === 'deep' && e.depth <= 300) return false;
      }
      if (this.filters.region !== 'global') {
        const bounds = DataManager.REGIONS[this.filters.region];
        if (bounds) {
          const [w, s, e2, n] = bounds;
          if (e.lng < w || e.lng > e2 || e.lat < s || e.lat > n) return false;
        }
      }
      return true;
    });
  }

  applyFilters(filters) {
    Object.assign(this.filters, filters);
    const filtered = this._filterEarthquakes(this.earthquakes);
    this.emit('earthquakesUpdated', { features: filtered });
    return filtered;
  }

  // ── VOLCANOES ────────────────────────────────────────────────────────────
  async fetchVolcanoes() {
    this._startLoading('volcanoes');
    const CACHE_KEY = 'geoviz_volcanoes';
    const CACHE_TTL = 86400000; // 24h

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          this.volcanoes = data;
          this.emit('volcanoesUpdated', { features: data });
          this._stopLoading('volcanoes');
          return;
        }
      }
    } catch {}

    try {
      const url = 'https://raw.githubusercontent.com/volcano-data/volcanoes/main/volcanoes.geojson';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Remote volcano data unavailable');
      const geojson = await res.json();
      const features = geojson.features.map(f => ({
        ...f.properties,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      }));
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: features }));
      this.volcanoes = features;
      this.emit('volcanoesUpdated', { features });
    } catch {
      // fall through to local fallback
      await this._loadLocalVolcanoes();
    } finally {
      this._stopLoading('volcanoes');
    }
  }

  async _loadLocalVolcanoes() {
    try {
      const res = await fetch('./data/volcanoes.geojson');
      const geojson = await res.json();
      const features = geojson.features.map(f => ({
        ...f.properties,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      }));
      this.volcanoes = features;
      this.emit('volcanoesUpdated', { features });
    } catch (err) {
      console.warn('[DataManager] Volcano fallback failed:', err.message);
    }
  }

  // ── STATIC LAYERS ────────────────────────────────────────────────────────
  async fetchTectonicPlates() {
    try {
      const url = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Tectonic plates fetch failed');
      this.tectonicPlates = await res.json();
      this.emit('tectonicPlatesLoaded', { geojson: this.tectonicPlates });
    } catch (err) {
      console.warn('[DataManager] Tectonic plates fetch failed:', err.message);
    }
  }

  async fetchTsunamiZones() {
    try {
      const res = await fetch('./data/tsunami_zones.geojson');
      this.tsunamiZones = await res.json();
      this.emit('tsunamiZonesLoaded', { geojson: this.tsunamiZones });
    } catch (err) {
      console.warn('[DataManager] Tsunami zones failed:', err.message);
    }
  }

  // ── OCEAN / PARTICLE DATA ────────────────────────────────────────────────
  async fetchOceanData() {
    this._startLoading('ocean');
    try {
      // Synthetic ocean current vectors derived from geographic patterns
      const vectors = this._generateOceanVectors();
      this.emit('oceanDataUpdated', { vectors });
    } catch (err) {
      console.warn('[DataManager] Ocean data failed:', err.message);
    } finally {
      this._stopLoading('ocean');
    }
  }

  _generateOceanVectors() {
    // Approximate major ocean currents as vector field on a 72×36 grid
    const cols = 72, rows = 36;
    const u = new Float32Array(cols * rows);
    const v = new Float32Array(cols * rows);

    for (let j = 0; j < rows; j++) {
      const lat = (j / (rows - 1)) * 180 - 90;
      for (let i = 0; i < cols; i++) {
        const lng = (i / (cols - 1)) * 360 - 180;
        const idx = j * cols + i;
        const { uu, vv } = this._currentVector(lat, lng);
        u[idx] = uu;
        v[idx] = vv;
      }
    }
    return { u, v, cols, rows, width: 360, height: 180 };
  }

  _currentVector(lat, lng) {
    let uu = 0, vv = 0;
    const latR = lat * Math.PI / 180;
    const lngR = lng * Math.PI / 180;

    // Thermohaline base: eastward in tropics, westward in mid-lat
    const base = Math.cos(latR * 2) * 0.8;
    uu += base;
    vv += Math.sin(latR) * 0.3;

    // North Atlantic Gyre
    if (lat > 10 && lat < 60 && lng > -80 && lng < 0) {
      const cx = (lng + 40) / 40, cy = (lat - 35) / 25;
      uu += Math.sin(cy * Math.PI) * 1.2;
      vv += -Math.cos(cx * Math.PI) * 0.8;
    }
    // Gulf Stream
    if (lat > 25 && lat < 45 && lng > -82 && lng < -30) {
      const t = (lng + 82) / 52;
      uu += Math.cos(t * Math.PI) * 1.8;
      vv += Math.sin(t * Math.PI * 0.5) * 0.6;
    }
    // South Atlantic Gyre
    if (lat < -10 && lat > -55 && lng > -60 && lng < 20) {
      const cx = (lng - (-20)) / 40, cy = (lat + 30) / 25;
      uu += -Math.sin(cy * Math.PI) * 1.0;
      vv += Math.cos(cx * Math.PI) * 0.7;
    }
    // North Pacific Gyre / Kuroshio
    if (lat > 10 && lat < 55 && lng > 120 && lng < -120 + 360) {
      uu += Math.cos(latR * 3) * 1.5;
      vv += Math.sin((lng - 150) * Math.PI / 180) * 0.5;
    }
    // Antarctic Circumpolar
    if (lat < -45 && lat > -70) {
      uu += 2.0;
      vv += Math.sin(lngR * 4) * 0.4;
    }
    // Equatorial currents
    if (Math.abs(lat) < 8) {
      uu += -1.2;
      vv += Math.cos(lngR * 2) * 0.3;
    }
    // Indian Ocean
    if (lat > -40 && lat < 25 && lng > 40 && lng < 110) {
      const season = Math.sin(Date.now() / 1e10) * 0.3; // slow variation
      uu += Math.cos(latR * 2) * (1.0 + season);
      vv += -Math.sin(lngR - 1.2) * 0.5;
    }

    // Clamp
    const spd = Math.sqrt(uu * uu + vv * vv);
    if (spd > 3) { uu *= 3 / spd; vv *= 3 / spd; }

    return { uu, vv };
  }

  // ── POLLING ──────────────────────────────────────────────────────────────
  startPolling() {
    const eq = setInterval(() => this.fetchEarthquakes(), 60000);
    const oc = setInterval(() => this.fetchOceanData(), 600000);
    this._intervals.push(eq, oc);
  }

  stopPolling() {
    this._intervals.forEach(clearInterval);
    this._intervals = [];
  }

  // ── UTILITIES ────────────────────────────────────────────────────────────
  getEarthquakesInRadius(lat, lng, radiusKm, days = 7) {
    const cutoff = Date.now() - days * 864e5;
    return this.earthquakes.filter(e => {
      if (e.time < cutoff) return false;
      return DataManager.haversine(lat, lng, e.lat, e.lng) <= radiusKm;
    }).sort((a, b) => b.magnitude - a.magnitude).slice(0, 8);
  }

  getHourlyStats() {
    const now = Date.now();
    const hours = 24;
    const counts = new Array(hours).fill(0);
    this.earthquakes.forEach(e => {
      const hoursAgo = (now - e.time) / 36e5;
      if (hoursAgo < hours) {
        const bucket = Math.floor(hoursAgo);
        if (bucket < hours) counts[hours - 1 - bucket]++;
      }
    });
    return counts;
  }

  static haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, d2r = Math.PI / 180;
    const dLat = (lat2 - lat1) * d2r, dLng = (lng2 - lng1) * d2r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  static getMagClass(mag) {
    if (mag < 3) return 'minor';
    if (mag < 5) return 'light';
    if (mag < 6) return 'moderate';
    if (mag < 7) return 'strong';
    return 'major';
  }

  static getMagColor(mag) {
    if (mag < 3) return '#378ADD';
    if (mag < 5) return '#1D9E75';
    if (mag < 6) return '#EF9F27';
    if (mag < 7) return '#E24B4A';
    return '#ffffff';
  }

  // Higher-contrast colours for use on a light basemap
  static getMagColorLight(mag) {
    if (mag < 3) return '#2563eb';  // blue
    if (mag < 5) return '#059669';  // green
    if (mag < 6) return '#d97706';  // amber
    if (mag < 7) return '#dc2626';  // red
    return '#7c3aed';               // purple (major)
  }

  static timeAgo(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

}

DataManager.REGIONS = {
  'pacific-ring': [-180, -60, 180, 65],
  'mediterranean': [-10, 28, 45, 48],
  'north-america': [-170, 15, -50, 75],
  'south-america': [-85, -60, -30, 15],
  'europe': [-30, 35, 45, 72],
  'asia': [40, 0, 150, 75],
  'southeast-asia': [90, -15, 160, 25],
  'middle-east': [30, 10, 75, 45],
  'africa': [-20, -40, 55, 38],
  'oceania': [100, -55, 180, 0],
};

window.DataManager = DataManager;
