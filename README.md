# Battery Builder

A browser tool for designing 3D printable cell holders and laser or plasma cut busbars for custom battery packs. Everything runs client side in the browser, no server, no install.

## What you get

- A parametric cell holder generated as a STEP solid, ready for CAD or 3D printing.
- One STEP or DXF file per busbar, with mirrored duplicates deduplicated automatically.
- Live 2D preview with pan, zoom and click to assign cells to busbars.

## Features

### Pack configuration
- **Series and Parallel** inputs or a direct **Size in mm** mode. S and P feed a hidden pack footprint so the existing layout generators stay unchanged.
- **Cell diameter, spacing, layout type** (grid, horizontal honeycomb, vertical honeycomb).
- **Housing options**: ledge thickness and width, optional rounded corners.
- **BMS access**: full circles, half circles, edge tabs, or none. Hole diameter and tab dimensions are configurable.

### Busbars
- Click on a cell in the preview to add it to the active busbar.
- Per busbar color, name, and thickness.
- Automatic routing with bend waypoints when a straight capsule would collide with a neighbour cell (keepout uses the 4 mm terminal radius).
- Live 2D preview of each busbar with pad circles and capsule bodies.

### Export
- **Cellholder**: STEP solid (`cellholder_<layout>.step`).
- **Busbars**: choose STEP (3D stencil for CAD or 3D printing) or DXF (flat outline for laser or plasma cutters). The DXF contains only the union outline, pads emitted as `ARC` plus `CIRCLE` and capsule sides as clipped `LINE` entities with interior lines removed.
- **Mirrored dedup**: a signature based on sorted pairwise cell distances is invariant under rotation and reflection, so two mirrored or rotated busbars produce one file. Flip the printed or cut piece at install time.
- Files download sequentially with a short delay so browsers don't block them.

## Running it

Any static file server will work. The project ships an OpenCascade WASM build under `vendor/`.

```bash
python -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Project layout

```
index.html              sidebar tabs + canvas
styles/main.css         dark theme, tab strip, segmented toggle, custom selects
src/
  main.js               input wiring, tab switching, S/P sync, canvas interaction
  app.js                updatePreview, generateLayout, export orchestration
  state.js              canvasState + positionCache
  layouts.js            grid and honeycomb cell layout generators
  model.js              3D cellholder builder (OpenCascade)
  step-export.js        STEP writer
  dxf-export.js         DXF writer with union-outline clipping
  busbars.js            busbar store (list, active id, subscribe)
  busbar-geometry.js    adjacency graph, capsule routing, bend waypoints
  busbar-preview.js     2D canvas overlay for busbars
  busbar-model.js       3D busbar builder (OpenCascade)
  busbar-ui.js          busbar list sidebar
  ui.js                 custom select, loading overlay, status toast
  preview.js            2D canvas cell holder renderer
  oc.js                 OpenCascade WASM bootstrap
vendor/
  opencascade.wasm.js   OpenCascade JS binding
```

## Tech

- Vanilla ES modules, no build step.
- OpenCascade WASM for CAD operations and STEP export.
- HTML5 Canvas 2D for the preview with DPR scaling and pan or pinch zoom.
- DXF is hand rolled AutoCAD R12 so it opens cleanly in LightBurn, Fusion, and the usual suspects.
