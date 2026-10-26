# EcoRoute AI — climate-aware logistics

A Vite/React logistics dashboard and a small FastAPI service for locally hosted Ollama inference. The frontend can run without a backend or model: route planning and rule-based insights work in local demo mode, and **Export scenario** downloads a JSON snapshot to your device.

## Project layout

```text
.
├── backend/
│   ├── main.py              # Render FastAPI app and secured Ollama client
│   ├── requirements.txt
│   ├── .python-version
│   └── test_main.py
├── render.yaml              # Render Blueprint for the API service
├── vercel.json              # Vite build settings and SPA fallback
├── src/
│   ├── App.jsx               # Interactive dashboard, map and simulation
│   ├── data.js               # Reproducible Bengaluru demo dataset
│   ├── main.jsx              # React entry point
│   ├── ollama.js             # Local Vite-proxy / deployed API client
│   ├── ollama.test.js        # Ollama client tests
│   ├── optimizer.js          # Synthetic road graph and route optimizer
│   ├── optimizer.test.js
│   └── styles.css
└── vite.config.js            # Local development proxy to Ollama
```

**No Supabase is required.** The Render API provides Ollama connectivity only; this project does not store scenarios in a cloud database.

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL, usually <http://localhost:5173>. Without `VITE_API_URL`, the dev server proxies `/ollama` to Ollama at `http://127.0.0.1:11434`. Start Ollama and pull a model, for example:

```bash
ollama pull qwen3:8b
```

You can optionally copy `.env.example` to `.env` and set `VITE_OLLAMA_MODEL=qwen3:8b`. When unset, the app selects an installed local model. Restart Vite after editing `.env`.

```bash
npm test
npm run build
```

## Deploy the frontend to Vercel and API to Render

Push the project, including `backend/`, `render.yaml`, `vercel.json`, `package-lock.json`, and `package.json`, to a GitHub repository. Do not commit `.env` or API tokens.

### 1. Deploy the FastAPI service to Render

1. Sign in to [Render](https://render.com/) and select **New → Blueprint**.
2. Connect the GitHub repository containing this project and select it.
3. Render reads the root `render.yaml` and creates the **ecoroute-api** web service with `backend/` as its root directory. The health check endpoint is `/health`.
4. In the new service, open **Environment** and configure:
   - `OLLAMA_BASE_URL`: **optional**, and only if you have an Ollama service reachable from Render. See [How to get an Ollama server URL](#how-to-get-an-ollama-server-url) below.
   - `OLLAMA_MODEL`: the exact model name installed on that Ollama service, such as `qwen3:8b`. Leave unset to select the first installed model.
   - `OLLAMA_API_KEY`: optional bearer token if your secured Ollama gateway expects `Authorization: Bearer <token>`. Never add this to Vercel or a `VITE_*` variable.
5. Deploy. Confirm that `https://YOUR-RENDER-SERVICE.onrender.com/health` returns JSON with `"status":"ok"`.

If you create the service manually instead of using the Blueprint, set:

| Render setting | Value |
|---|---|
| Root directory | `backend` |
| Runtime | Python |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` |

The API health endpoint can pass even when Ollama is not configured. The dashboard then uses its built-in rule-based recommendations; check `https://YOUR-RENDER-SERVICE.onrender.com/api/ollama/status` to see whether a model is available.

### 2. Deploy the Vite frontend to Vercel

1. Sign in to [Vercel](https://vercel.com/), choose **Add New → Project**, and import the same GitHub repository.
2. Keep the project **Root Directory** set to the repository root (`.`). Do not set it to `backend`.
3. Use the Vite settings below (also provided by `vercel.json`):

   | Vercel setting | Value |
   |---|---|
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Output directory | `dist` |
   | Install command | `npm install` |

4. In **Project → Settings → Environment Variables**, add:

   ```text
   VITE_API_URL = https://YOUR-RENDER-SERVICE.onrender.com
   ```

   Use the Render service's origin only: no trailing slash and no `/api` suffix.
5. Deploy the frontend. Check that the dashboard loads and the Ollama status appears in the insights panel.
6. Copy the exact Vercel origin (for example, `https://ecoroute-ai-yourname.vercel.app`) into Render's `FRONTEND_ORIGINS`. If you need Vercel preview deployments, add their exact origins as comma-separated values too. Save the variable and redeploy/restart the Render service.
7. In the dashboard, refresh the Ollama connection. When a model is configured and reachable, select **Ask Ollama**. If not, the planner still works with rule-based recommendations.

When updating environment variables, trigger a new Vercel deployment so the `VITE_API_URL` value is included in its build. The Vite configuration for local development does not run as a Vercel backend.

## How to get an Ollama server URL

Render cannot reach `localhost` on your computer. A URL such as `http://127.0.0.1:11434` works only on the same machine running Ollama; entering your computer's home IP is not a reliable or secure substitute. Render cannot automatically install or access your local `qwen3:8b`.

You have three choices:

1. **Deploy the frontend/API without live Ollama (simplest and free):** leave `OLLAMA_BASE_URL` and `OLLAMA_MODEL` unset on Render. Route planning, simulation, export, and rule-based insights work; the Ollama insight button is disabled until a model server is configured.
2. **Use a hosted Ollama-compatible service:** create an account with a provider that supports the Ollama `/api/tags` and `/api/chat` API, create or select a model, and copy its private HTTPS **base URL**. Put that URL in Render's `OLLAMA_BASE_URL`, its exact model tag in `OLLAMA_MODEL`, and its token in `OLLAMA_API_KEY` if required. The base URL should be the API origin—not an `/api/chat` URL. Confirm the provider supports Ollama's JSON-format chat requests before subscribing.
3. **Run Ollama on an always-on server you control:** provision a GPU machine or VM with enough RAM/VRAM for the chosen model, install Ollama, pull the model, and put a TLS-enabled reverse proxy with bearer-token authentication in front of it. Allow only the routes the app uses (`/api/tags` and `/api/chat`). Set the reverse proxy's HTTPS origin and token as Render's `OLLAMA_BASE_URL` and `OLLAMA_API_KEY`.

Do **not** expose Ollama's default port `11434` directly to the public internet, disable authentication, put a secret token in Vercel, or add it to a `VITE_*` variable. The Render API supports an optional bearer token, not Cloudflare Access service-token headers. If using a tunnel or gateway, configure it to accept bearer authentication or add a secure server-side adapter.

Render's free web services can sleep when idle; the first API request may be delayed. A hosted Ollama server may also have model cold-start delays. Larger models need substantial memory and CPU/GPU; a basic free Render web service is not a practical Ollama model host.

## What the planner does and assumptions

- Builds a deterministic illustrative road grid around Bengaluru and runs Dijkstra's shortest-path search on its synthetic road links. It is not turn-by-turn road data.
- Compares a distance-first baseline with a climate-aware plan whose edge costs include synthetic traffic, rain, and heat. Severe simulated rain/congestion penalizes selected links so route geometry can visibly change.
- Assigns deliveries to available vehicles using a greedy proximity/capacity heuristic and considers delivery priority and lateness in the stop order. It is not a global vehicle-routing solver; capacity overflow is reported.
- Estimates travel time at a nominal 23 km/h plus simulated congestion/weather effects and four service minutes per stop.
- Estimates fuel, electricity, tailpipe CO₂, and cost using the documented per-vehicle rates and illustrative ₹96/litre, ₹9/kWh, and per-kilometre cost assumptions. Electric grid emissions are excluded. These are not live telemetry or current quotes.
- AI-generated text comes from the configured Ollama model; it does not modify route calculations. The planner's deterministic rules remain available as fallback. Model output can be mistaken, so compare it with the calculated metrics.

## Limitations and future improvements

- Replace the synthetic graph with a supported road routing provider before operational use.
- Add a real vehicle-routing solver with hard delivery windows, load dimensions, charging/fuelling, and shift constraints.
- Add authenticated user accounts and a proper database only if persistent, multi-user scenarios are needed.
- Calibrate vehicle emissions, electricity-grid factors, fuel use, weather, traffic, and operating prices with locally validated data.
- The deployed Ollama API must be private/authenticated and reachable over HTTPS; serverless frontend code cannot access the user's local Ollama instance.

## Problem statement, impact, and demo

EcoRoute makes route trade-offs visible: dispatchers can compare distance, time, energy, cost, and tailpipe emissions while watching simulated vehicles respond to changed road conditions. It aims to demonstrate fewer avoidable kilometres and more efficient vehicle use without promising that a lower-emission route is always faster or cheaper.

**Two-minute demo:** (1) Show the three vehicles and eight stops. (2) Run the baseline and watch the map. (3) Switch to the eco plan and compare estimates. (4) Trigger the heavy-rain/traffic event and point out the recalculated paths and metrics. (5) Click **Ask Ollama** if the remote model is configured; otherwise show the labelled rule-based fallback. (6) Optionally add a stop on the map and export the scenario JSON.
