# GeoViz Earth — Real-Time Planetary Hazard Monitor

A cinematic, production-quality web app visualising live earthquakes, volcanic activity, and ocean currents on an interactive world map.

**No API key required.** Uses Leaflet + CartoDB Dark Matter tiles (completely free, no registration).

## Setup

```bash
npx serve .
```

Then open `http://localhost:3000`.

That's it. Works as a plain `file://` URL too — just open `index.html` directly in a browser.

## Data Sources

| Layer | Source | Refresh |
|-------|--------|---------|
| Earthquakes | USGS Earthquake Hazards | Every 60s |
| Volcanoes | Smithsonian GVP / local fallback | Daily (cached) |
| Tectonic Plates | fraxen/tectonicplates (GitHub) | On load |
| Tsunami Zones | NOAA DART / embedded GeoJSON | On load |
| Ocean Currents | Synthetic vector field (NOAA-derived) | Every 10min |

All data sources are free with no API key required (except Mapbox for the map tiles).

## Features

- **3D Globe** with atmosphere glow, fog, stars, and terrain exaggeration
- **Live earthquakes** — magnitude-scaled colored circles with depth opacity, pulsing rings for recent events
- **Volcanoes** — custom triangle markers with alert-level coloring and animation
- **Ocean currents** — 4,000-particle canvas animation synced to the map camera
- **Tectonic plates** — dashed amber boundary lines
- **Tsunami risk zones** — pulsing red fill polygons
- **Sidebar** with layer toggles, magnitude/depth/time/region filters, stats, and recent events list
- **Detail panels** for earthquakes (mag ring, nearby events, USGS link) and volcanoes (alert level, eruption timeline)
- **Timeline scrubber** — scrub through 7 days of seismic history
- **Alert toasts** — auto-dismiss notifications for M5.0+ earthquakes
- **Low Power mode** — reduces particles to 500 for slower hardware
- **Mobile responsive** — sidebar and panel collapse to bottom sheets on narrow screens

## Performance

The particle system targets 60fps on modern hardware. Use the **Low Power** toggle in Settings to reduce particle count to 500 if needed.
