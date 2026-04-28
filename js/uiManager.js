class UIManager {
  constructor(dataManager, mapManager) {
    this.dm = dataManager;
    this.mm = mapManager;
    this.sparklineChart = null;
    this.activeTab = 'seismic';
    this.sidebarCollapsed = false;
    this.detailPanelOpen = false;
    this.tooltip = null;
    this.toastCount = 0;
    this.MAX_TOASTS = 3;
    this._timelineAnim = null;
    this._timelinePlaying = false;
    this._timelineScrub = 1;
    this._filters = {};
  }

  init() {
    this._createTooltip();
    this._bindNavTabs();
    this._bindSidebarCollapse();
    this._bindLayerToggles();
    this._bindFilters();
    this._bindDetailPanelClose();
    this._bindSettingsPanel();
    this._bindTimeline();
    this._bindSidebarToggle();
    this._updateLastUpdated();
    setInterval(() => this._updateLastUpdated(), 30000);
    this._initSparkline();
  }

  // ── TABS ────────────────────────────────────────────────────────────────
  _bindNavTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this._onTabChange(this.activeTab);
      });
    });
  }

  _onTabChange(tab) {
    const filterSection = document.getElementById('filter-section');
    if (filterSection) {
      filterSection.style.display = tab === 'seismic' ? '' : 'none';
    }
    // Fly to relevant region — Leaflet flyTo([lat, lng], zoom)
    const focusMap = {
      seismic:  { latlng: [20, 0],   zoom: 3 },
      volcanic: { latlng: [0,  160], zoom: 3 },
      ocean:    { latlng: [0,  0],   zoom: 2 },
    };
    const focus = focusMap[tab];
    if (focus && this.mm?.map) {
      this.mm.map.flyTo(focus.latlng, focus.zoom, { duration: 1.5 });
    }
    // Ocean tab: always restart the particle system if the currents layer is on.
    // We force-stop first so start() doesn't hit the early-return guard.
    if (tab === 'ocean') {
      if (this.mm.layerVisibility.currents && this.mm.particleSystem) {
        this.mm.particleSystem.stop();
        this.mm.particleSystem.start();
      }
    } else {
      // Leaving Ocean tab — stop particles to save CPU (layer toggle still controls them)
      if (this.mm.particleSystem?.active) {
        this.mm.particleSystem.stop();
      }
    }
  }

  // ── SIDEBAR ──────────────────────────────────────────────────────────────
  _bindSidebarCollapse() {
    const btn = document.getElementById('sidebar-collapse-btn');
    const tab = document.getElementById('sidebar-tab');
    if (btn) btn.addEventListener('click', () => this._toggleSidebar());
    if (tab) tab.addEventListener('click', () => this._toggleSidebar());
  }

  _bindSidebarToggle() {
    const btn = document.getElementById('sidebar-mobile-btn');
    if (btn) btn.addEventListener('click', () => this._toggleSidebar());
  }

  _toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    this.sidebarCollapsed = !this.sidebarCollapsed;
    sidebar.classList.toggle('collapsed', this.sidebarCollapsed);

    const icon = document.querySelector('#sidebar-collapse-btn i[data-lucide]');
    const tabIcon = document.querySelector('#sidebar-tab i[data-lucide]');
    const iconName = this.sidebarCollapsed ? 'chevron-right' : 'chevron-left';

    [icon, tabIcon].forEach(el => {
      if (el) {
        el.setAttribute('data-lucide', iconName);
        lucide.createIcons({ nodes: [el] });
      }
    });
  }

  // ── LAYER TOGGLES ────────────────────────────────────────────────────────
  _bindLayerToggles() {
    document.querySelectorAll('.layer-toggle').forEach(toggle => {
      toggle.classList.add('on');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = toggle.dataset.layer;
        const isOn = toggle.classList.toggle('on');
        this.mm.setLayerVisibility(layer, isOn);

        if (layer === 'currents' && isOn) {
          this.showToast({
            title: 'Ocean Currents Active',
            body: '4,000 particles — GPU intensive. Use Low Power mode if needed.',
            color: 'var(--accent-cyan)',
            icon: 'waves',
            duration: 5000,
          });
        }
      });

      const row = toggle.closest('.layer-row');
      if (row) {
        row.addEventListener('click', () => toggle.click());
      }
    });
  }

  // ── FILTERS ──────────────────────────────────────────────────────────────
  _bindFilters() {
    // Magnitude slider
    const magSlider = document.getElementById('mag-slider');
    const magVal = document.getElementById('mag-value');
    if (magSlider) {
      magSlider.addEventListener('input', () => {
        const v = parseFloat(magSlider.value);
        if (magVal) magVal.textContent = `M${v.toFixed(1)}+`;
        this._applyFilter({ minMag: v });
        this._updateSliderTrack(magSlider);
      });
      this._updateSliderTrack(magSlider);
    }

    // Time range pills
    document.querySelectorAll('[data-time-range]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('[data-time-range]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this._applyFilter({ timeRange: pill.dataset.timeRange });
      });
    });

    // Depth pills
    document.querySelectorAll('[data-depth]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('[data-depth]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this._applyFilter({ depth: pill.dataset.depth });
      });
    });

    // Region select
    const regionSelect = document.getElementById('region-select');
    if (regionSelect) {
      regionSelect.addEventListener('change', () => {
        this._applyFilter({ region: regionSelect.value });
      });
    }
  }

  _updateSliderTrack(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(90deg, var(--accent-cyan) ${pct}%, rgba(0,0,0,0.1) ${pct}%)`;
  }

  _applyFilter(update) {
    Object.assign(this._filters, update);
    this.dm.applyFilters(this._filters);
  }

  // ── STATS UPDATE ─────────────────────────────────────────────────────────
  updateStats(earthquakes, volcanoes) {
    const now = Date.now();
    const todayCutoff = now - 864e5;
    const todayQuakes = earthquakes.filter(e => e.time > todayCutoff);
    const maxMag = earthquakes.length ? Math.max(...earthquakes.map(e => e.magnitude)) : 0;
    const activeVolc = volcanoes.filter(v => v.status === 'Active').length;
    const warnings = volcanoes.filter(v => (v.alert_level || '').toLowerCase() === 'warning').length;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set('stat-events', todayQuakes.length.toLocaleString());
    set('stat-maxmag', maxMag > 0 ? `M${maxMag.toFixed(1)}` : '—');
    set('stat-volcanoes', activeVolc);
    set('stat-alerts', warnings || '—');

    this._updateSparkline();
    this._updateEarthquakeCount(earthquakes.length);
    this._updateVolcanoCount(volcanoes.length);
  }

  _updateEarthquakeCount(count) {
    const el = document.getElementById('count-earthquakes');
    if (el) el.textContent = count;
  }

  _updateVolcanoCount(count) {
    const el = document.getElementById('count-volcanoes');
    if (el) el.textContent = count;
  }

  // ── RECENT EVENTS ────────────────────────────────────────────────────────
  renderRecentEvents(earthquakes) {
    const list = document.getElementById('recent-events-list');
    if (!list) return;

    const sorted = [...earthquakes]
      .sort((a, b) => b.time - a.time)
      .slice(0, 8);

    list.innerHTML = sorted.map(e => {
      const cls = DataManager.getMagClass(e.magnitude);
      const color = DataManager.getMagColor(e.magnitude);
      const mag = e.magnitude.toFixed(1);
      const place = e.place.length > 30 ? e.place.slice(0, 28) + '…' : e.place;
      const time = DataManager.timeAgo(e.time);
      const depth = `${Math.round(e.depth)}km`;
      return `
        <div class="event-item" data-lat="${e.lat}" data-lng="${e.lng}" data-id="${e.id}" role="button" tabindex="0">
          <div class="mag-badge mag-${cls}" style="border-color:${color}33;color:${color};background:${color}22">${mag}</div>
          <div class="event-info">
            <div class="event-place">${place}</div>
            <div class="event-meta">${time}</div>
          </div>
          <div class="event-depth">${depth}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.event-item').forEach(item => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        this.mm.flyToEvent([lng, lat]);
        const eq = earthquakes.find(e => e.id === item.dataset.id);
        if (eq) this.renderDetailPanelEarthquake(eq);
      });
      item.addEventListener('keypress', e => {
        if (e.key === 'Enter' || e.key === ' ') item.click();
      });
    });
  }

  // ── SPARKLINE ────────────────────────────────────────────────────────────
  _initSparkline() {
    const ctx = document.getElementById('sparkline-chart');
    if (!ctx) return;

    this.sparklineChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => i === 23 ? 'now' : `${23 - i}h`),
        datasets: [{
          data: new Array(24).fill(0),
          backgroundColor: (ctx) => {
            const val = ctx.raw || 0;
            if (val === 0) return 'rgba(0,0,0,0.07)';
            if (val < 5) return 'rgba(37,99,235,0.5)';
            if (val < 15) return 'rgba(217,119,6,0.6)';
            return 'rgba(220,38,38,0.65)';
          },
          borderRadius: 2,
          borderSkipped: false,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)',
          titleColor: '#111827',
          bodyColor: '#4b5e72',
          borderColor: 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => `${item.raw} events`,
          },
        }},
        scales: {
          x: { display: false },
          y: {
            display: true,
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
            ticks: { color: '#8a9ab0', font: { size: 10 }, maxTicksLimit: 4 },
            border: { display: false },
          },
        },
        animation: { duration: 400 },
      },
    });
  }

  _updateSparkline() {
    if (!this.sparklineChart) return;
    const counts = this.dm.getHourlyStats();
    this.sparklineChart.data.datasets[0].data = counts;
    this.sparklineChart.update('none');
  }

  // ── TOOLTIP ──────────────────────────────────────────────────────────────
  _createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'map-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  showTooltip({ title, rows, x, y }) {
    const tt = this.tooltip;
    tt.innerHTML = `
      <div class="tt-title">${title}</div>
      ${rows.map(([l, v]) => `<div class="tt-row"><span>${l}</span><span>${v}</span></div>`).join('')}
    `;
    tt.style.display = 'block';
    this._positionTooltip(x, y);
  }

  _positionTooltip(x, y) {
    const tt = this.tooltip;
    tt.style.left = `${x + 12}px`;
    tt.style.top = `${y - 12}px`;
    const rect = tt.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      tt.style.left = `${x - rect.width - 12}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      tt.style.top = `${y - rect.height + 12}px`;
    }
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  // ── DETAIL PANEL ─────────────────────────────────────────────────────────
  _bindDetailPanelClose() {
    const closeBtn = document.getElementById('panel-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeDetailPanel());
  }

  closeDetailPanel() {
    const panel = document.getElementById('detail-panel');
    if (panel) panel.classList.remove('open');
    this.detailPanelOpen = false;
  }

  openDetailPanel() {
    const panel = document.getElementById('detail-panel');
    if (panel) panel.classList.add('open');
    this.detailPanelOpen = true;
  }

  renderDetailPanelEarthquake(eq) {
    const body = document.getElementById('panel-body');
    if (!body) return;

    const cls = DataManager.getMagClass(eq.magnitude);
    const color = DataManager.getMagColor(eq.magnitude);
    const mag = (typeof eq.magnitude === 'string' ? parseFloat(eq.magnitude) : eq.magnitude) || 0;
    const depth = typeof eq.depth === 'number' ? eq.depth : parseFloat(eq.depth) || 0;
    const place = eq.place || 'Unknown';
    const time = eq.time ? new Date(parseInt(eq.time)).toLocaleString() : '—';
    const felt = eq.felt || 0;
    const lat = typeof eq.lat === 'number' ? eq.lat : parseFloat(eq.lat) || 0;
    const lng = typeof eq.lng === 'number' ? eq.lng : parseFloat(eq.lng) || 0;
    const usgsUrl = eq.usgsUrl || '#';

    const categories = ['Minor','Light','Moderate','Strong','Major','Great'];
    const catIndex = Math.min(5, Math.max(0, Math.floor(mag / 1.5)));
    const catName = categories[catIndex] || 'Unknown';

    const circumference = 2 * Math.PI * 46;
    const dash = (mag / 10) * circumference;

    const nearby = this.dm.getEarthquakesInRadius(lat, lng, 200)
      .filter(e => e.id !== eq.id)
      .slice(0, 5);

    body.innerHTML = `
      <div class="detail-mag-ring">
        <div class="mag-ring-svg">
          <svg width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg)">
            <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="8"/>
            <circle cx="60" cy="60" r="46" fill="none" stroke="${color}" stroke-width="8"
              stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
              stroke-linecap="round" opacity="0.85"/>
          </svg>
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
            <div class="mag-number-large" style="color:${color}">${mag.toFixed(1)}</div>
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px">MAG</div>
          </div>
        </div>
        <div class="mag-category" style="color:${color}">${catName} Earthquake</div>
      </div>

      <div class="location-display">
        <div class="location-name">${place}</div>
        <div class="location-coords">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
      </div>

      <div class="info-grid">
        <div class="info-cell">
          <div class="info-cell-label">Depth</div>
          <div class="info-cell-value">${depth.toFixed(1)} km</div>
        </div>
        <div class="info-cell">
          <div class="info-cell-label">Felt Reports</div>
          <div class="info-cell-value">${felt.toLocaleString()}</div>
        </div>
        <div class="info-cell" style="grid-column:1/-1">
          <div class="info-cell-label">Time (Local)</div>
          <div class="info-cell-value" style="font-size:12px">${time}</div>
        </div>
      </div>

      <div class="shakemap-thumb" aria-label="ShakeMap visualization">
        <div style="text-align:center;color:var(--text-tertiary)">
          <i data-lucide="map" style="width:20px;height:20px;margin-bottom:4px;display:block;margin:auto"></i>
          <div style="margin-top:8px;font-size:11px">ShakeMap available for M4.0+</div>
          ${mag >= 4 ? `<a href="${usgsUrl}" target="_blank" rel="noopener" style="color:var(--accent-cyan);font-size:11px;margin-top:4px;display:block">View on USGS →</a>` : ''}
        </div>
      </div>

      ${nearby.length ? `
      <div>
        <div class="panel-section-title">Nearby Events (200km, 7d)</div>
        <div class="nearby-list">
          ${nearby.map(n => {
            const nc = DataManager.getMagColor(n.magnitude);
            const dist = Math.round(DataManager.haversine(lat, lng, n.lat, n.lng));
            return `<div class="nearby-item" role="button" tabindex="0" data-lat="${n.lat}" data-lng="${n.lng}" data-id="${n.id}">
              <div class="nearby-mag" style="color:${nc}">M${n.magnitude.toFixed(1)}</div>
              <div class="nearby-place">${n.place.slice(0, 32)}</div>
              <div class="nearby-dist">${dist}km</div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="panel-actions">
        <a href="${usgsUrl}" target="_blank" rel="noopener" class="btn btn-outline" style="text-decoration:none">
          <i data-lucide="external-link" style="width:14px;height:14px"></i> USGS
        </a>
        <button class="btn btn-primary" onclick="UIManager._copyShare('${lat}','${lng}','${mag}')">
          <i data-lucide="share-2" style="width:14px;height:14px"></i> Share
        </button>
      </div>
    `;

    body.querySelectorAll('.nearby-item').forEach(item => {
      item.addEventListener('click', () => {
        const nlat = parseFloat(item.dataset.lat);
        const nlng = parseFloat(item.dataset.lng);
        this.mm.flyToEvent([nlng, nlat]);
        const eq2 = this.dm.earthquakes.find(e => e.id === item.dataset.id);
        if (eq2) this.renderDetailPanelEarthquake(eq2);
      });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: body.querySelectorAll('[data-lucide]') });

    document.getElementById('panel-title').textContent = 'Earthquake Details';
    this.openDetailPanel();
  }

  static _copyShare(lat, lng, mag) {
    const url = `${location.href}#${lat},${lng},${mag}`;
    navigator.clipboard?.writeText(url).then(() => {
      // show feedback
    });
  }

  renderDetailPanelVolcano(v) {
    const body = document.getElementById('panel-body');
    if (!body) return;

    const alertCls = (v.alert_level || 'Normal').toLowerCase();
    const alertColors = { normal: 'var(--text-tertiary)', advisory: 'var(--mag-minor)', watch: 'var(--accent-amber)', warning: 'var(--danger)' };
    const color = alertColors[alertCls] || alertColors.normal;

    // Simulated eruption history
    const years = [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024];
    const eruptionYears = new Set(v.last_eruption ? [parseInt(v.last_eruption)] : []);
    const lastEruption = v.last_eruption || 'Unknown';

    const gvpName = encodeURIComponent(v.name || '');
    const gvpUrl = `https://volcano.si.edu/search_volcano.cfm#tabs-search`;

    body.innerHTML = `
      <div class="detail-mag-ring">
        <div style="width:80px;height:80px;background:${color}22;border:2px solid ${color}44;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
          <i data-lucide="mountain" style="width:36px;height:36px;color:${color}"></i>
        </div>
        <div style="font-size:20px;font-weight:600;color:var(--text-primary)">${v.name}</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${v.country}</div>
        <div class="alert-badge alert-${alertCls}" style="margin-top:8px">${v.alert_level || 'Normal'}</div>
      </div>

      <div class="info-grid">
        <div class="info-cell">
          <div class="info-cell-label">Type</div>
          <div class="info-cell-value" style="font-size:13px">${v.type || '—'}</div>
        </div>
        <div class="info-cell">
          <div class="info-cell-label">Elevation</div>
          <div class="info-cell-value">${v.elevation ? v.elevation.toLocaleString() + 'm' : '—'}</div>
        </div>
        <div class="info-cell">
          <div class="info-cell-label">Status</div>
          <div class="info-cell-value" style="color:${v.status==='Active'?'var(--danger)':'var(--text-secondary)'}">${v.status || '—'}</div>
        </div>
        <div class="info-cell">
          <div class="info-cell-label">Last Eruption</div>
          <div class="info-cell-value" style="font-size:12px">${lastEruption}</div>
        </div>
        <div class="info-cell" style="grid-column:1/-1">
          <div class="info-cell-label">Coordinates</div>
          <div class="info-cell-value" style="font-size:12px">${v.lat.toFixed(4)}°, ${v.lng.toFixed(4)}°</div>
        </div>
      </div>

      <div>
        <div class="panel-section-title">Eruption History (last decade)</div>
        <div class="eruption-timeline">
          ${years.map(y => {
            const active = eruptionYears.has(y);
            const h = active ? '100%' : (10 + Math.random() * 30) + '%';
            const bg = active ? 'rgba(226,75,74,0.7)' : 'rgba(239,159,39,0.2)';
            return `<div class="eruption-bar" style="height:${h};background:${bg};border-color:${active?'var(--danger)':'var(--accent-amber)'}" title="${y}${active?' - Eruption recorded':''}"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:10px;color:var(--text-tertiary)">2015</span>
          <span style="font-size:10px;color:var(--text-tertiary)">2024</span>
        </div>
      </div>

      <div class="panel-actions">
        <a href="${gvpUrl}" target="_blank" rel="noopener" class="btn btn-outline" style="text-decoration:none">
          <i data-lucide="external-link" style="width:14px;height:14px"></i> GVP
        </a>
        <button class="btn btn-primary" onclick="navigator.clipboard?.writeText(window.location.href)">
          <i data-lucide="share-2" style="width:14px;height:14px"></i> Share
        </button>
      </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: body.querySelectorAll('[data-lucide]') });

    document.getElementById('panel-title').textContent = 'Volcano Details';
    this.openDetailPanel();
  }

  // ── TOAST ────────────────────────────────────────────────────────────────
  showToast({ title, body, color = 'var(--danger)', icon = 'alert-triangle', duration = 8000 }) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toasts = container.querySelectorAll('.toast');
    if (toasts.length >= this.MAX_TOASTS) {
      toasts[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderLeftColor = color;
    toast.innerHTML = `
      <div class="toast-icon" style="color:${color}">
        <i data-lucide="${icon}" style="width:18px;height:18px"></i>
      </div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-body">${body}</div>
        <div class="toast-time">Just now</div>
      </div>
      <button class="toast-dismiss" aria-label="Dismiss">
        <i data-lucide="x" style="width:14px;height:14px"></i>
      </button>
    `;

    const dismiss = () => {
      toast.classList.add('dismiss');
      toast.addEventListener('animationend', () => toast.remove());
    };

    toast.querySelector('.toast-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    toast.addEventListener('click', dismiss);
    container.appendChild(toast);

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: toast.querySelectorAll('[data-lucide]') });

    if (duration > 0) setTimeout(dismiss, duration);
  }

  showQuakeAlert(eq) {
    this.showToast({
      title: `M${eq.magnitude.toFixed(1)} Earthquake`,
      body: eq.place,
      color: DataManager.getMagColor(eq.magnitude),
      icon: eq.magnitude >= 7 ? 'alert-octagon' : 'alert-triangle',
    });
  }

  // ── TIMESTAMP ─────────────────────────────────────────────────────────────
  _updateLastUpdated() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Updated ${DataManager.timeAgo(Date.now() - 1000)}`;
  }

  updateLastFetched() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Updated just now`;
    setTimeout(() => this._updateLastUpdated(), 5000);
  }

  // ── SETTINGS PANEL ────────────────────────────────────────────────────────
  _bindSettingsPanel() {
    const btn = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', () => panel.classList.remove('open'));
    panel.addEventListener('click', e => e.stopPropagation());

    // Low power toggle
    const lpToggle = document.getElementById('low-power-toggle');
    if (lpToggle) {
      lpToggle.addEventListener('click', () => {
        lpToggle.classList.toggle('on');
        const isLow = lpToggle.classList.contains('on');
        this.mm.particleSystem?.setLowPower(isLow);
      });
    }

    // Globe spin toggle
    const spinToggle = document.getElementById('globe-spin-toggle');
    if (spinToggle) {
      let spinning = false;
      let spinInterval = null;
      spinToggle.addEventListener('click', () => {
        spinToggle.classList.toggle('on');
        spinning = !spinning;
        if (spinning) {
          spinInterval = setInterval(() => {
            const center = this.mm.map.getCenter();
            // Leaflet: panTo([lat, lng]) — shift lng eastward each tick
            this.mm.map.panTo([center.lat, center.lng + 0.05], { animate: false });
          }, 16);
        } else {
          clearInterval(spinInterval);
        }
      });
    }
  }

  // ── TIMELINE ─────────────────────────────────────────────────────────────
  _bindTimeline() {
    const playBtn = document.getElementById('timeline-play-btn');
    const scrubber = document.getElementById('timeline-range-input');

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        this._timelinePlaying = !this._timelinePlaying;
        const icon = playBtn.querySelector('[data-lucide]');
        if (icon) {
          icon.setAttribute('data-lucide', this._timelinePlaying ? 'pause' : 'play');
          lucide.createIcons({ nodes: [icon] });
        }
        if (this._timelinePlaying) this._playTimeline();
        else clearInterval(this._timelineAnim);
      });
    }

    if (scrubber) {
      scrubber.addEventListener('input', () => {
        this._timelineScrub = parseFloat(scrubber.value);
        this._updateTimelineDisplay(this._timelineScrub);
        this._filterByTimeline(this._timelineScrub);
      });
    }
  }

  _playTimeline() {
    this._timelineAnim = setInterval(() => {
      this._timelineScrub = Math.min(1, this._timelineScrub + 0.002);
      const scrubber = document.getElementById('timeline-range-input');
      if (scrubber) scrubber.value = this._timelineScrub;
      this._updateTimelineDisplay(this._timelineScrub);
      if (this._timelineScrub >= 1) {
        this._timelineScrub = 0;
      }
    }, 50);
  }

  _updateTimelineDisplay(t) {
    const fill = document.getElementById('timeline-fill');
    const scrubDot = document.getElementById('timeline-scrubber-dot');
    const label = document.getElementById('timeline-current-time');

    if (fill) fill.style.width = `${t * 100}%`;
    if (scrubDot) scrubDot.style.left = `${t * 100}%`;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 864e5;
    const ts = sevenDaysAgo + t * (now - sevenDaysAgo);
    if (label) label.textContent = new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  _filterByTimeline(t) {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 864e5;
    const windowEnd = sevenDaysAgo + t * (now - sevenDaysAgo);
    const windowStart = windowEnd - 6 * 3600 * 1000; // 6-hour window

    const filtered = this.dm.earthquakes.filter(e => e.time >= windowStart && e.time <= windowEnd);
    this.mm.updateEarthquakeData(filtered);
  }

  renderTimelineEvents(earthquakes) {
    const layer = document.getElementById('timeline-events-layer');
    if (!layer) return;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 864e5;
    const range = now - sevenDaysAgo;

    const recent = earthquakes
      .filter(e => e.time >= sevenDaysAgo)
      .slice(0, 200);

    layer.innerHTML = recent.map(e => {
      const t = (e.time - sevenDaysAgo) / range;
      const color = DataManager.getMagColor(e.magnitude);
      const size = Math.max(3, Math.min(8, e.magnitude * 1.2));
      return `<div class="timeline-event-dot" style="left:${(t*100).toFixed(2)}%;width:${size}px;height:${size}px;background:${color};transform:translate(-50%,-50%);top:50%;margin-top:0" title="M${e.magnitude.toFixed(1)} - ${e.place}"></div>`;
    }).join('');
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  setLoadingProgress(pct, status = '') {
    const fill = document.getElementById('loading-bar-fill');
    const stat = document.getElementById('loading-status');
    if (fill) fill.style.width = `${pct}%`;
    if (stat) stat.textContent = status;
  }

  hideLoadingScreen() {
    const screen = document.getElementById('loading-screen');
    if (screen) screen.classList.add('hidden');
  }
}

window.UIManager = UIManager;
