# EcoRoute AI — Climate-aware logistics simulation

A runnable React/Vite hackathon demo for comparing conventional dispatch with a climate-aware delivery plan. It includes an interactive OpenStreetMap map, moving vehicle markers, a deterministic synthetic road network, delivery/vehicle controls, route metrics, rule-based explanations, and optional Supabase snapshot storage.

## Project structure

```text
.
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── src/
│   ├── App.jsx          # Dashboard, map, controls and simulation state
│   ├── data.js          # Reproducible Bengaluru demo scenario
│   ├── main.jsx         # React entry point and global styles
│   ├── optimizer.js     # Road graph, Dijkstra, fleet assignment and estimates
│   ├── styles.css       # Responsive climate-tech dashboard styles
│   └── supabase.js      # Optional scenario persistence
└── supabase/
    └── schema.sql       # Snapshot table and demo insert policy
```

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually <http://localhost:5173>). No API key is needed for the demo. OpenStreetMap tiles need an internet connection; the route planner and controls continue to work if the map tile service is unavailable.

Build and preview the production bundle:

```bash
npm test
npm run build
npm run preview
```

## Supabase connection

The app uses Supabase only for explicit scenario snapshot saves. Without configuration it stays in local demo mode; no data is sent to a backend.

1. Create a Supabase project.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy `.env.example` to `.env` in the project root and set the browser-safe project URL and anon key:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

4. Restart `npm run dev`. The header should say **SUPABASE CONNECTED**. Use **Save scenario** to store the current plan, climate controls, vehicles, and deliveries in `simulation_snapshots`.

Only use the public anon key in a browser app—never put a service-role key in `VITE_*` variables. The included insert-only RLS policy is intentionally permissive for a throwaway hackathon demo and does not authenticate or isolate users. Replace it with authenticated-user policies before production use; configure retention and access controls for real delivery data.

## What the planner does

- Creates a reproducible local road graph from a 7×7 grid across the Bengaluru demo area, with warehouse and delivery nodes connected to nearby road nodes. Grid links approximate road segments; they are not downloaded road geometry.
- Uses Dijkstra's shortest path for each leg. The baseline minimizes synthetic road distance. The eco plan uses a generalized edge cost combining distance with traffic, rain, and heat penalties. The heavy-rain event also raises penalties on the synthetic east-side corridor, and severe congestion heavily penalizes a central road segment to make the reroute visible.
- Uses a greedy next-stop heuristic for estimated travel time, distance, high-priority preference, and deadline lateness (assuming dispatch at 09:00). Fleet assignments balance proximity and vehicle utilization while respecting rated payload capacity; stops that cannot fit are explicitly flagged as unassigned.
- Estimates travel time from route length at a 23 km/h nominal speed, adjusted per road segment by synthetic weather and traffic. Four service minutes are added per stop.
- Estimates diesel/hybrid fuel from the vehicle's declared litres/km rate with simple load and rain multipliers. Estimated CO₂ uses declared per-km rates and the same multipliers. Electric vehicles use zero **tailpipe** emissions, while their electricity use and operating cost are shown separately; grid-generation emissions are excluded.
- Estimates cost using ₹96/litre fuel, ₹9/kWh electricity, and a per-kilometre operating allowance. These are illustrative assumptions, not live prices.
- Animates markers along the calculated path. The climate-event button changes the road-edge penalties and recomputes routes and estimates. The selected plan's line and live progress update together.
- The insight panel is deterministic, explainable, rule-based text—not an AI model response. No AI API is configured or claimed.

### Limitations and next steps

- The local grid is a stand-in for a road network. Use a routing provider such as OSRM/GraphHopper and road/turn restrictions for real navigation.
- The route sequence is a greedy heuristic, not a globally optimal vehicle-routing-with-time-windows solver. Deadlines influence preference but are not enforced as hard feasibility constraints.
- Weather and traffic are synthetic sliders/zones; no live forecast, congestion, elevation, charging availability, or grid carbon intensity is fetched.
- Fuel/emissions/cost factors are transparent demo assumptions and should be calibrated and validated for the fleet and region.
- OpenStreetMap tile availability depends on the network and tile service usage policy. Use an appropriate hosted tile provider for production traffic.
- Supabase storage is optional, snapshots are write-only in this demo, and the included anonymous insert policy is not production access control.
- Production extensions: authenticated tenant-scoped persistence, provider-backed road graph, demand import, charge/fuel constraints, time-window feasibility, modelled grid emissions, and audited real-world fleet factors.

## Problem statement and impact

Urban delivery dispatchers often plan around distance or delivery time alone, even when traffic and weather change the real cost and emissions of a route. EcoRoute AI makes the trade-offs visible: planners can compare a distance-first baseline with a climate-aware plan, see why a path changes, and observe estimated distance, time, energy, cost, and tailpipe emissions together. The demo's intended real-world impact is fewer avoidable vehicle kilometres and better use of efficient vehicles, without promising that every greener choice is faster or cheaper.

## Two-minute demo script

1. **0:00–0:20 — Set the scene.** Open the dashboard and point out the Indiranagar hub, eight stops, and three vehicles (electric, diesel, hybrid). Explain that traffic/weather and all cost/emissions figures are synthetic estimates.
2. **0:20–0:40 — Show the baseline.** Select **Baseline** and click **Start simulation**. Show the dashed conventional route, moving vehicles, progress, and the baseline comparison values.
3. **0:40–1:00 — Compare the eco plan.** Pause or reset, select **Eco-optimized**, then start. Explain that Dijkstra picks road-grid paths while a greedy stop order balances distance, time, and priority.
4. **1:00–1:25 — Trigger a cause-and-effect event.** Click **Simulate climate event**. The first click introduces heavy rain plus traffic congestion; explain that new edge penalties trigger recalculation and change route geometry and estimates.
5. **1:25–1:45 — Inspect the trade-off.** Compare time, kilometres, fuel, emissions, and rupee cost in the table/chart. Point out that the eco plan may not win every metric and that electricity grid emissions are excluded.
6. **1:45–2:00 — Show extensibility.** Click the map to add a stop, adjust a climate slider or vehicle toggle, and show the plan update. If configured, use **Save scenario** to demonstrate Supabase; otherwise explain that local demo mode sends no data.
