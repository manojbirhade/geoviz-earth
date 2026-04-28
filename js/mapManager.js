class MapManager {
  constructor(dataManager) {
    this.dm = dataManager;
    this.map = null;
    this.particleSystem = null;

    // Leaflet layer groups
    this._layers = {
      earthquakes: null,
      volcanoes: null,
      tectonic: null,
      tsunami: null,
    };

    this.layerVisibility = {
      earthquakes: true,
      volcanoes: true,
      currents: true,
      tectonic: true,
      tsunami: true,
    };

    // Track circles for hover state
    this._earthquakeCircles = [];
    this._volcanoMarkers = [];

    // Tsunami pulse animation
    this._tsunamiLayers = [];
    this._tsunamiAnim = 0;
    this._tsunamiRafId = null;

    // New-quake ring animation
    this._newRingLayers = [];
    this._ringAnim = 0;
    this._ringRafId = null;

    this._listeners = {};
  }

  initMap() {
    this.map = L.map('map', {
      center: [20, 0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
    });

    // CartoDB Voyager — light tile layer with clear labels, no token required
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    ).addTo(this.map);

    // Custom zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(this.map);

    // Initialize layer groups
    this._layers.earthquakes = L.layerGroup().addTo(this.map);
    this._layers.volcanoes = L.layerGroup().addTo(this.map);
    this._layers.tectonic = L.layerGroup().addTo(this.map);
    this._layers.tsunami = L.layerGroup().addTo(this.map);

    // Cosmetic dark vignette overlay on the map pane
    this._addAtmosphereEffect();

    // Ready — fire synchronously since Leaflet is ready immediately
    setTimeout(() => this.dispatchEvent('mapReady'), 0);

    return this.map;
  }

  // Subtle light vignette around map edges
  _addAtmosphereEffect() {
    const pane = this.map.getPane('mapPane');
    if (!pane) return;
    const vignette = document.createElement('div');
    vignette.style.cssText = `
      position:absolute;inset:0;pointer-events:none;z-index:9999;
      background:radial-gradient(ellipse at center,
        transparent 60%,
        rgba(230,236,242,0.25) 82%,
        rgba(210,220,230,0.45) 100%);
    `;
    pane.appendChild(vignette);
  }

  // ── EARTHQUAKE LAYER ────────────────────────────────────────────────────
  updateEarthquakeData(features) {
    const group = this._layers.earthquakes;
    if (!group) return;

    // Clear previous circles
    group.clearLayers();
    this._earthquakeCircles = [];
    this._newRingLayers = [];

    const now = Date.now();
    const oneHour = 36e5;

    features.forEach(e => {
      const color = DataManager.getMagColorLight(e.magnitude);
      const radius = this._magToRadius(e.magnitude);
      const depthOpacity = this._depthToOpacity(e.depth);
      const isNew = (now - e.time) < oneHour;

      // Glow halo
      const halo = L.circleMarker([e.lat, e.lng], {
        radius: radius * 2.2,
        color: 'transparent',
        fillColor: color,
        fillOpacity: 0.06,
        interactive: false,
        pane: 'overlayPane',
      }).addTo(group);

      // Main circle — white stroke makes it pop on light basemap
      const circle = L.circleMarker([e.lat, e.lng], {
        radius,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: depthOpacity * 0.88,
        pane: 'overlayPane',
      }).addTo(group);

      // Animated ring for recent quakes
      if (isNew) {
        const ring = L.circleMarker([e.lat, e.lng], {
          radius: radius * 1.8,
          color: color,
          weight: 1.5,
          opacity: 0.7,
          fillColor: 'transparent',
          fillOpacity: 0,
          interactive: false,
          pane: 'overlayPane',
        }).addTo(group);
        this._newRingLayers.push({ ring, baseRadius: radius * 1.8, color, mag: e.magnitude });
      }

      // Hover interaction
      circle.on('mouseover', (ev) => {
        circle.setStyle({ weight: 2.5, color: '#ffffff', opacity: 1 });
        this.dispatchEvent('earthquakeHover', {
          ...e,
          x: ev.originalEvent.clientX,
          y: ev.originalEvent.clientY,
        });
      });
      circle.on('mousemove', (ev) => {
        this.dispatchEvent('earthquakeHover', {
          ...e,
          x: ev.originalEvent.clientX,
          y: ev.originalEvent.clientY,
        });
      });
      circle.on('mouseout', () => {
        circle.setStyle({ weight: 1.5, color: '#ffffff', opacity: 0.9 });
        this.dispatchEvent('tooltipHide');
      });
      circle.on('click', () => {
        this.flyToEvent([e.lng, e.lat]);
        this.dispatchEvent('earthquakeClick', e);
      });

      this._earthquakeCircles.push({ circle, halo, e });
    });

    // Start ring animation if there are new quakes
    this._startRingAnimation();
  }

  _magToRadius(mag) {
    // Pixel radius — smooth interpolation
    if (mag < 2) return 4;
    if (mag < 4) return 4 + (mag - 2) * 3;
    if (mag < 6) return 10 + (mag - 4) * 5;
    if (mag < 8) return 20 + (mag - 6) * 10;
    return 40;
  }

  _depthToOpacity(depth) {
    if (depth <= 0) return 1.0;
    if (depth <= 70) return 1.0;
    if (depth <= 200) return 0.75;
    if (depth <= 400) return 0.55;
    return 0.4;
  }

  _startRingAnimation() {
    if (this._ringRafId) cancelAnimationFrame(this._ringRafId);
    if (!this._newRingLayers.length) return;

    const anim = () => {
      this._ringAnim = (this._ringAnim + 0.04) % (Math.PI * 2);
      const t = (Math.sin(this._ringAnim) * 0.5 + 0.5); // 0→1
      const opacity = 0.2 + t * 0.65;
      const scale = 1 + t * 0.6;

      this._newRingLayers.forEach(({ ring, baseRadius }) => {
        if (ring._map) {
          ring.setStyle({ opacity });
          ring.setRadius(baseRadius * scale);
        }
      });
      this._ringRafId = requestAnimationFrame(anim);
    };
    anim();
  }

  // ── TECTONIC LAYER ──────────────────────────────────────────────────────
  updateTectonicPlates(geojson) {
    const group = this._layers.tectonic;
    if (!group) return;
    group.clearLayers();

    L.geoJSON(geojson, {
      style: {
        color: '#EF9F27',
        weight: 1.5,
        opacity: 0.4,
        dashArray: '6 4',
        fillColor: 'transparent',
        fillOpacity: 0,
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.Name || feature.properties?.PlateName || 'Tectonic Boundary';
        layer.on('mouseover', (ev) => {
          layer.setStyle({ opacity: 0.8, weight: 2 });
          this.dispatchEvent('tectonicHover', {
            name,
            x: ev.originalEvent.clientX,
            y: ev.originalEvent.clientY,
          });
        });
        layer.on('mouseout', () => {
          layer.setStyle({ opacity: 0.4, weight: 1.5 });
          this.dispatchEvent('tooltipHide');
        });
      },
    }).addTo(group);
  }

  // ── TSUNAMI LAYER ───────────────────────────────────────────────────────
  updateTsunamiZones(geojson) {
    const group = this._layers.tsunami;
    if (!group) return;
    group.clearLayers();
    this._tsunamiLayers = [];

    L.geoJSON(geojson, {
      style: {
        color: '#E24B4A',
        weight: 0.8,
        opacity: 0.4,
        fillColor: '#E24B4A',
        fillOpacity: 0.06,
      },
      onEachFeature: (feature, layer) => {
        this._tsunamiLayers.push(layer);
      },
    }).addTo(group);

    this._startTsunamiPulse();
  }

  _startTsunamiPulse() {
    if (this._tsunamiRafId) cancelAnimationFrame(this._tsunamiRafId);
    const anim = () => {
      this._tsunamiAnim = (this._tsunamiAnim + 0.015) % (Math.PI * 2);
      const opacity = 0.3 + Math.sin(this._tsunamiAnim) * 0.18;
      this._tsunamiLayers.forEach(layer => {
        if (layer.setStyle) layer.setStyle({ opacity });
      });
      this._tsunamiRafId = requestAnimationFrame(anim);
    };
    anim();
  }

  // ── VOLCANO MARKERS ─────────────────────────────────────────────────────
  addVolcanoLayer(volcanoes) {
    const group = this._layers.volcanoes;
    if (!group) return;
    group.clearLayers();
    this._volcanoMarkers = [];

    volcanoes.forEach(v => {
      const alertClass = (v.alert_level || 'Normal').toLowerCase();
      const markerClass = (alertClass === 'warning' || alertClass === 'watch') ? 'active'
        : alertClass === 'advisory' ? 'watch' : 'dormant';

      const el = document.createElement('div');
      el.className = `volcano-marker ${markerClass}`;
      el.setAttribute('aria-label', `Volcano: ${v.name}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.innerHTML = `<div class="triangle"></div>`;

      const icon = L.divIcon({
        html: el.outerHTML,
        className: '',
        iconSize: [14, 12],
        iconAnchor: [7, 12],
      });

      const marker = L.marker([v.lat, v.lng], { icon }).addTo(group);

      marker.on('click', () => this.dispatchEvent('volcanoClick', v));
      marker.on('mouseover', (ev) => {
        this.dispatchEvent('volcanoHover', {
          volcano: v,
          x: ev.originalEvent.clientX,
          y: ev.originalEvent.clientY,
        });
      });
      marker.on('mouseout', () => this.dispatchEvent('tooltipHide'));

      this._volcanoMarkers.push(marker);
    });
  }

  // ── LAYER VISIBILITY ─────────────────────────────────────────────────────
  setLayerVisibility(layer, visible) {
    this.layerVisibility[layer] = visible;

    if (layer === 'currents') {
      if (visible && this.particleSystem) this.particleSystem.start();
      else if (!visible && this.particleSystem) this.particleSystem.stop();
      return;
    }

    const group = this._layers[layer];
    if (!group) return;

    if (visible) {
      if (!this.map.hasLayer(group)) this.map.addLayer(group);
    } else {
      if (this.map.hasLayer(group)) this.map.removeLayer(group);
    }
  }

  // ── CAMERA ──────────────────────────────────────────────────────────────
  flyToEvent(coords, zoom = 7) {
    // coords is [lng, lat] to match Mapbox convention used throughout
    this.map.flyTo([coords[1], coords[0]], zoom, {
      duration: 1.5,
      easeLinearity: 0.3,
    });
  }

  // ── SIMPLE EVENTEMITTER ──────────────────────────────────────────────────
  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    this._listeners[event] = (this._listeners[event] || []).filter(f => f !== cb);
  }

  dispatchEvent(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }
}

window.MapManager = MapManager;
