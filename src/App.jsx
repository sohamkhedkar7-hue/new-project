import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BadgeIndianRupee, BatteryCharging,
  Check, ChevronDown, Clock3, CloudRain, Gauge, Leaf, MapPin, Navigation, Pause,
  Play, Plus, RotateCcw, Save, Settings2, Truck, Zap,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import { INITIAL_DELIVERIES, INITIAL_VEHICLES, WAREHOUSE } from './data';
import { getInsights, optimizeRoutes, routePosition } from './optimizer';
import { saveScenario, supabase } from './supabase';

const INITIAL_CLIMATE = { traffic: 32, rain: 18, heat: 28 };
const ROUTE_COLORS = ['#57dda2', '#80aaff', '#d5a2ff'];
const PLAN_COLORS = { baseline: '#efaa64', eco: '#57dda2' };
const EVENT_NAMES = ['Heavy rain advisory', 'Peak-hour traffic surge', 'Heatwave warning'];
const format = (value, digits = 1) => Number(value || 0).toFixed(digits);

function createMapIcon(kind, color, active = false) {
  const className = kind === 'hub' ? 'hub-marker' : 'vehicle-marker';
  const content = kind === 'hub' ? '⌂' : '➤';
  const size = kind === 'hub' ? 34 : 30;
  return L.divIcon({
    className: '',
    html: `<span class="${className}${active ? ' active' : ''}" style="--marker-color:${color}">${content}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapClickHandler({ onAdd }) {
  useMapEvents({
    click(event) {
      if (event.originalEvent.target.closest('.leaflet-interactive')) return;
      onAdd(event.latlng);
    },
  });
  return null;
}

function MetricCard({ label, value, unit, icon: Icon, tint, footnote }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tint}`}><Icon size={16} /></span></div>
      <div className="metric-value">{value}<small>{unit}</small></div>
      {footnote && <div className="metric-footnote">{footnote}</div>}
    </article>
  );
}

function SliderControl({ label, value, min, max, suffix = '%', onChange, icon: Icon }) {
  return (
    <label className="slider-control">
      <span className="control-label"><span><Icon size={14} />{label}</span><b>{value}{suffix}</b></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function App() {
  const [deliveries, setDeliveries] = useState(INITIAL_DELIVERIES);
  const [vehicles, setVehicles] = useState(INITIAL_VEHICLES);
  const [climate, setClimate] = useState(INITIAL_CLIMATE);
  const [demand, setDemand] = useState(8);
  const [climateEventCount, setClimateEventCount] = useState(0);
  const [mode, setMode] = useState('eco');
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [events, setEvents] = useState([
    { id: 1, time: '09:00', text: 'Morning dispatch window opened', type: 'success' },
    { id: 2, time: '09:01', text: '8 deliveries assigned across 3 vehicles', type: 'neutral' },
  ]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const activeDeliveries = useMemo(
    () => deliveries.slice(0, demand).filter((delivery) => delivery.status !== 'Completed'),
    [deliveries, demand],
  );
  const baseline = useMemo(
    () => optimizeRoutes({ deliveries: activeDeliveries, vehicles, climate, mode: 'baseline' }),
    [activeDeliveries, vehicles, climate],
  );
  const eco = useMemo(
    () => optimizeRoutes({ deliveries: activeDeliveries, vehicles, climate, mode: 'eco' }),
    [activeDeliveries, vehicles, climate],
  );
  const plan = mode === 'eco' ? eco : baseline;
  const progress = Math.min(1, elapsed / 90);
  const completedIds = useMemo(() => {
    if (!elapsed) return new Set(deliveries.filter((delivery) => delivery.status === 'Completed').map((delivery) => delivery.id));
    const done = new Set(deliveries.filter((delivery) => delivery.status === 'Completed').map((delivery) => delivery.id));
    plan.routes.forEach((route) => {
      let travelled = 0;
      route.legs.forEach((leg) => {
        const stopProgress = route.distance ? (travelled + leg.distance) / route.distance : 0;
        if (leg.to.id !== WAREHOUSE.id && progress >= stopProgress) done.add(leg.to.id);
        travelled += leg.distance;
      });
    });
    return done;
  }, [deliveries, elapsed, plan, progress]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setElapsed((current) => Math.min(90, current + speed * 0.45));
    }, 250);
    return () => window.clearInterval(timer);
  }, [running, speed]);

  useEffect(() => {
    if (elapsed >= 90 && running) {
      setRunning(false);
      addEvent('All assigned deliveries completed; vehicles returned to hub', 'success');
    }
  }, [elapsed, running]);

  function addEvent(text, type = 'neutral') {
    setEvents((current) => [
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text, type },
      ...current,
    ].slice(0, 8));
  }

  function resetSimulation() {
    setRunning(false);
    setElapsed(0);
    setSpeed(1);
    setMode('eco');
    setClimate(INITIAL_CLIMATE);
    setClimateEventCount(0);
    setDemand(8);
    setSelectedDelivery(null);
    setDeliveries(INITIAL_DELIVERIES);
    setVehicles(INITIAL_VEHICLES);
    setEvents([{ id: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: 'Demo scenario reset to the 8-stop morning dispatch', type: 'success' }]);
    setNotice('');
  }

  function startSimulation() {
    if (!activeDeliveries.length) {
      setNotice('Add at least one pending delivery before starting the simulation.');
      return;
    }
    if (!vehicles.some((vehicle) => vehicle.available)) {
      setNotice('Enable at least one vehicle before starting the simulation.');
      return;
    }
    if (elapsed >= 90) setElapsed(0);
    setRunning(true);
    setNotice('');
    addEvent(`${mode === 'eco' ? 'Eco-optimized' : 'Baseline'} simulation started`, 'success');
  }

  function simulateClimateEvent() {
    const randomIndex = climateEventCount % EVENT_NAMES.length;
    const name = EVENT_NAMES[randomIndex];
    const nextClimate = randomIndex === 0
      ? { ...climate, rain: Math.max(78, climate.rain), traffic: Math.max(67, climate.traffic) }
      : randomIndex === 1
        ? { ...climate, traffic: Math.max(82, climate.traffic) }
        : { ...climate, heat: Math.max(84, climate.heat) };
    setClimate(nextClimate);
    setClimateEventCount((current) => current + 1);
    addEvent(`${name} — road conditions updated; ${mode === 'eco' ? 'eco' : 'baseline'} routes recalculated`, 'warning');
  }

  function addDelivery(latlng) {
    const nextId = `D-${101 + Math.max(0, ...deliveries.map((delivery) => Number(delivery.id.slice(2)) - 100))}`;
    const newDelivery = {
      id: nextId,
      name: `Custom stop ${deliveries.length + 1}`,
      lat: latlng.lat,
      lng: latlng.lng,
      weight: 20,
      priority: 'Standard',
      deadline: '14:00',
      status: 'Pending',
    };
    setDeliveries((current) => [...current, newDelivery]);
    setDemand((current) => Math.min(deliveries.length + 1, Math.max(current, current + 1)));
    setSelectedDelivery(nextId);
    addEvent(`${nextId} added to the map (20 kg, standard priority)`, 'success');
  }

  function removeDelivery(id) {
    setDeliveries((current) => current.filter((delivery) => delivery.id !== id));
    setDemand((current) => Math.max(1, Math.min(current, deliveries.length - 1)));
    if (selectedDelivery === id) setSelectedDelivery(null);
    addEvent(`${id} removed from the dispatch`, 'neutral');
  }

  function updateClimate(key, value) {
    setClimate((current) => ({ ...current, [key]: value }));
  }

  function toggleVehicle(id, key) {
    setVehicles((current) => current.map((vehicle) => vehicle.id === id ? { ...vehicle, [key]: !vehicle[key] } : vehicle));
  }

  async function saveToSupabase() {
    if (!supabase) {
      setNotice('Demo mode: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env to enable cloud saves.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      await saveScenario({ savedAt: new Date().toISOString(), mode, climate, deliveries, vehicles, baseline, eco, elapsed });
      setNotice('Scenario saved to Supabase.');
      addEvent('Scenario snapshot saved to Supabase', 'success');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  const chartData = [
    { metric: 'Distance', baseline: 100, eco: baseline.totals.distance ? eco.totals.distance / baseline.totals.distance * 100 : 100 },
    { metric: 'CO₂', baseline: 100, eco: baseline.totals.emissions ? eco.totals.emissions / baseline.totals.emissions * 100 : 100 },
    { metric: 'Cost', baseline: 100, eco: baseline.totals.cost ? eco.totals.cost / baseline.totals.cost * 100 : 100 },
    { metric: 'Time', baseline: 100, eco: baseline.totals.minutes ? eco.totals.minutes / baseline.totals.minutes * 100 : 100 },
  ];
  const changeLabel = (baselineValue, optimizedValue) => {
    if (!baselineValue) return '—';
    const change = Math.round((baselineValue - optimizedValue) / baselineValue * 100);
    if (change > 0) return `${change}% lower`;
    if (change < 0) return `${Math.abs(change)}% higher`;
    return 'No change';
  };
  const insights = getInsights(eco, baseline, climate, vehicles);
  const drivenMultiplier = progress;
  const currentMetrics = {
    distance: plan.totals.distance * drivenMultiplier,
    emissions: plan.totals.emissions * drivenMultiplier,
    fuel: plan.totals.fuel * drivenMultiplier,
    cost: plan.totals.cost * drivenMultiplier,
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="EcoRoute AI home">
          <span className="brand-mark"><Leaf size={20} /></span>
          <span><strong>EcoRoute</strong><small>CLIMATE LOGISTICS</small></span>
          <span className="ai-tag">AI</span>
        </a>
        <div className="topbar-center">
          <span className={`status-dot ${running ? 'live' : ''}`} />
          <span>{running ? 'SIMULATION LIVE' : elapsed >= 90 ? 'SIMULATION COMPLETE' : 'DEMO SCENARIO READY'}</span>
          <i />
          <span className="topbar-muted">Indiranagar, Bengaluru</span>
        </div>
        <div className="topbar-actions">
          <span className={`supabase-status ${supabase ? 'connected' : ''}`} title={supabase ? 'Supabase configured' : 'Local demo mode'}>
            <span />{supabase ? 'SUPABASE CONNECTED' : 'LOCAL DEMO'}
          </span>
          <button className="icon-button reset-button" onClick={resetSimulation} title="Reset simulation"><RotateCcw size={15} /><span>Reset</span></button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="sidebar">
          <section className="panel-section fleet-section">
            <div className="section-heading">
              <div><span className="eyebrow">DISPATCH</span><h2>Fleet & stops <span>{deliveries.length}</span></h2></div>
              <button className="small-icon-button" title="Fleet and delivery controls"><Settings2 size={15} /></button>
            </div>
            <div className="fleet-list">
              {vehicles.map((vehicle) => {
                const vehicleRoute = plan.routes.find((route) => route.vehicle.id === vehicle.id);
                const currentLoad = vehicleRoute?.stops.reduce((sum, stop) => (
                  sum + (completedIds.has(stop.id) ? 0 : stop.weight)
                ), 0) || 0;
                const consumptionRate = vehicle.electric
                  ? `${format(vehicle.kwhPerKm * 100, 0)} kWh/100km`
                  : vehicle.kwhPerKm
                    ? `${format(vehicle.fuelPerKm * 100, 1)} L + ${format(vehicle.kwhPerKm * 100, 0)} kWh/100km`
                    : `${format(vehicle.fuelPerKm * 100, 1)} L/100km`;
                return (
                <article className={`fleet-item ${!vehicle.available ? 'disabled' : ''}`} key={vehicle.id}>
                  <span className="fleet-vehicle-icon" style={{ color: vehicle.color, backgroundColor: `${vehicle.color}15` }}>
                    {vehicle.electric ? <Zap size={15} /> : <Truck size={15} />}
                  </span>
                  <div className="fleet-copy"><strong>{vehicle.id}<span>{vehicle.type}</span></strong><small>{currentLoad} / {vehicle.capacity} kg · {consumptionRate}</small><small>{format(vehicle.emissionsPerKm * 10, 2)} kg CO₂ / 10 km tailpipe</small></div>
                  <button className={`toggle ${vehicle.available ? 'on' : ''}`} onClick={() => toggleVehicle(vehicle.id, 'available')} aria-label={`Toggle ${vehicle.id}`} />
                </article>
                );
              })}
            </div>
            <div className="electric-toggle">
              <span><BatteryCharging size={14} /> Electric vehicle available</span>
              <button className={`toggle ${vehicles.find((vehicle) => vehicle.electric)?.available ? 'on' : ''}`} onClick={() => toggleVehicle('EV-01', 'available')} aria-label="Toggle electric vehicle" />
            </div>
          </section>

          <section className="panel-section stops-section">
            <div className="section-heading"><div><span className="eyebrow">DELIVERY MANIFEST</span><h2>Today's stops <span>{activeDeliveries.length}/{deliveries.length}</span></h2></div><span className="hint-icon" title="Click the map to add a stop"><Plus size={15} /></span></div>
            <div className="stop-list">
              {deliveries.map((delivery, index) => (
                <button className={`stop-row ${selectedDelivery === delivery.id ? 'selected' : ''} ${completedIds.has(delivery.id) ? 'completed' : ''}`} key={delivery.id} onClick={() => setSelectedDelivery(delivery.id)}>
                  <span className="stop-number">{completedIds.has(delivery.id) ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>
                  <span className="stop-copy"><strong>{delivery.name}</strong><small>{delivery.id} · {delivery.weight} kg · {delivery.deadline}</small></span>
                  <span className={`priority ${delivery.priority.toLowerCase()}`}>{delivery.priority === 'High' ? 'Priority' : 'Standard'}</span>
                  <span className="remove-stop" onClick={(event) => { event.stopPropagation(); removeDelivery(delivery.id); }} title="Remove stop">×</span>
                </button>
              ))}
              {!deliveries.length && <div className="empty-state">No stops in the manifest. Click the map to add one.</div>}
            </div>
            {baseline.unassigned.length > 0 && <div className="capacity-warning"><AlertTriangle size={13} /> {baseline.unassigned.length} stop(s) exceed available vehicle capacity.</div>}
          </section>

          <section className="panel-section climate-section">
            <div className="section-heading"><div><span className="eyebrow">LIVE CONDITIONS <i className="synthetic-tag">SYNTHETIC</i></span><h2>Climate controls</h2></div><CloudRain size={16} className="subtle-icon" /></div>
            <SliderControl label="Traffic intensity" icon={Activity} value={climate.traffic} min={0} max={100} onChange={(value) => updateClimate('traffic', value)} />
            <SliderControl label="Rain severity" icon={CloudRain} value={climate.rain} min={0} max={100} onChange={(value) => updateClimate('rain', value)} />
            <SliderControl label="Heat index" icon={Gauge} value={climate.heat} min={0} max={100} onChange={(value) => updateClimate('heat', value)} />
            <SliderControl label="Delivery demand" icon={MapPin} value={demand} min={1} max={Math.max(1, deliveries.length)} suffix=" stops" onChange={setDemand} />
            <button className="climate-event-button" onClick={simulateClimateEvent}><CloudRain size={15} /> Simulate climate event <ArrowRight size={14} /></button>
          </section>
        </aside>

        <section className="map-panel">
          <div className="map-heading">
            <div><span className="eyebrow">ROUTE VISUALIZATION <i className="synthetic-tag">OSM · SIMULATED CONDITIONS</i></span><h1>Greater Bengaluru <span>Dispatch map</span></h1></div>
            <div className="map-heading-actions"><span className="map-area"><MapPin size={13} /> 12.97° N, 77.64° E</span><button className="save-button" onClick={saveToSupabase} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save scenario'}</button></div>
          </div>
          <div className="map-canvas">
            <MapContainer center={[12.965, 77.657]} zoom={12} scrollWheelZoom className="leaflet-map">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{ tileerror: () => setNotice('OpenStreetMap tiles are unavailable; route data is still active.') }}
              />
              <MapClickHandler onAdd={addDelivery} />
              {plan.routes.map((route) => {
                if (!route.legs.length) return null;
                const color = route.vehicle.color;
                const points = route.legs.flatMap((leg, legIndex) => leg.path.filter((point, pointIndex) => legIndex === 0 || pointIndex > 0).map((point) => [point.lat, point.lng]));
                return (
                  <Polyline key={`${mode}-${route.vehicle.id}`} positions={points} pathOptions={{ color, weight: 4, opacity: 0.84, dashArray: mode === 'baseline' ? '8 8' : undefined }}>
                    <Popup><strong>{route.vehicle.id}</strong><br />{route.stops.length} stops · {format(route.distance)} km<br />{mode === 'eco' ? 'Eco-optimized route' : 'Baseline route'}</Popup>
                  </Polyline>
                );
              })}
              <Circle center={[12.967, 77.624]} radius={1050} pathOptions={{ color: climate.traffic > 60 ? '#ff806f' : '#f3b454', fillColor: '#f3b454', fillOpacity: climate.traffic / 800, weight: 1, dashArray: '5 6' }} />
              <Circle center={[12.973, 77.704]} radius={1150} pathOptions={{ color: '#75b9ff', fillColor: '#75b9ff', fillOpacity: climate.rain / 900, weight: 1, dashArray: '4 7' }} />
              <Marker position={[WAREHOUSE.lat, WAREHOUSE.lng]} icon={createMapIcon('hub', '#57dda2')}>
                <Popup><strong>Indiranagar Hub</strong><br />Dispatch warehouse</Popup>
              </Marker>
              {deliveries.map((delivery, index) => (
                <Circle key={delivery.id} center={[delivery.lat, delivery.lng]} radius={completedIds.has(delivery.id) ? 68 : 92} pathOptions={{ color: completedIds.has(delivery.id) ? '#6ed7a2' : selectedDelivery === delivery.id ? '#fff0a8' : ROUTE_COLORS[index % ROUTE_COLORS.length], fillColor: completedIds.has(delivery.id) ? '#6ed7a2' : ROUTE_COLORS[index % ROUTE_COLORS.length], fillOpacity: 0.94, weight: selectedDelivery === delivery.id ? 4 : 2 }} eventHandlers={{ click: () => setSelectedDelivery(delivery.id) }}>
                  <Popup><strong>{delivery.id} · {delivery.name}</strong><br />{delivery.weight} kg · {delivery.priority} priority<br />Deadline {delivery.deadline} · {completedIds.has(delivery.id) ? 'Delivered' : 'Pending'}</Popup>
                </Circle>
              ))}
              {plan.routes.map((route, index) => {
                const position = elapsed > 0 ? routePosition(route, progress) : WAREHOUSE;
                return (
                  <Marker key={`vehicle-${route.vehicle.id}`} position={[position.lat, position.lng]} icon={createMapIcon('vehicle', route.vehicle.color, running)}>
                    <Popup><strong>{route.vehicle.id}</strong><br />{route.vehicle.type}<br />{route.stops.length} assigned deliveries · {format(route.distance)} km</Popup>
                  </Marker>
                );
              })}
            </MapContainer>
            <div className="map-legend">
              <span><i className="legend-dot warehouse" /> Warehouse</span><span><i className="legend-dot delivery" /> Delivery</span>
              <span><i className="legend-dot vehicle-ev" /> EV-01</span><span><i className="legend-dot vehicle-diesel" /> VAN-02</span><span><i className="legend-dot vehicle-hybrid" /> VAN-03</span>
              <span><i className="legend-line base" /> Baseline · dashed</span><span><i className="legend-line eco" /> Eco · solid</span>
            </div>
            <div className="map-click-hint"><Plus size={13} /> Click map to add delivery</div>
            <div className="weather-chip"><CloudRain size={14} /><span>{climate.rain >= 60 ? 'Heavy rain' : climate.rain >= 35 ? 'Light rain' : 'Partly cloudy'}</span><i />Traffic {climate.traffic}%</div>
          </div>
          <div className="map-footer"><span><Navigation size={13} /> Routes are calculated over an illustrative local road grid; not turn-by-turn navigation.</span><span>{activeDeliveries.length} active stops <i /> {vehicles.filter((vehicle) => vehicle.available).length} vehicles available</span></div>

          <div className="simulation-bar">
            <div className="simulation-title"><span className="eyebrow">LIVE SIMULATION</span><strong>{running ? 'Vehicles en route' : elapsed >= 90 ? 'Run complete' : 'Ready to dispatch'}</strong></div>
            <div className="simulation-actions">
              {!running ? <button className="primary-button" onClick={startSimulation}><Play size={15} fill="currentColor" /> {elapsed > 0 && elapsed < 90 ? 'Resume' : 'Start simulation'}</button> : <button className="pause-button" onClick={() => setRunning(false)}><Pause size={15} fill="currentColor" /> Pause</button>}
              <button className="icon-button" onClick={resetSimulation} title="Reset"><RotateCcw size={15} /></button>
              <label className="speed-select"><Gauge size={14} /><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1× speed</option><option value={2}>2× speed</option><option value={4}>4× speed</option></select><ChevronDown size={12} /></label>
            </div>
            <div className="simulation-progress"><span style={{ width: `${progress * 100}%` }} /></div>
            <div className="simulation-stats">
              <span><Navigation size={13} /> <b>{format(currentMetrics.distance)} km</b><small>distance</small></span>
              <span><Check size={13} /> <b>{completedIds.size} / {deliveries.length}</b><small>delivered</small></span>
              <span><Activity size={13} /> <b>{format(currentMetrics.fuel)} L</b><small>fuel estimate</small></span>
              <span><Leaf size={13} /> <b>{format(currentMetrics.emissions)} kg</b><small>CO₂ estimate</small></span>
            </div>
          </div>
          <div className="timeline">
            <div className="timeline-head"><span className="eyebrow">EVENT TIMELINE</span><span className="synthetic-tag">SIMULATED</span></div>
            <div className="timeline-items">{events.slice(0, 4).map((event) => <div className="timeline-event" key={event.id}><i className={event.type} /><time>{event.time}</time><span>{event.text}</span></div>)}</div>
          </div>
        </section>

        <aside className="insights-panel">
          <section className="panel-section comparison-section">
            <div className="section-heading"><div><span className="eyebrow">PLAN COMPARISON</span><h2>Choose a strategy</h2></div><span className="synthetic-tag">ESTIMATES</span></div>
            <div className="plan-switch">
              <button className={mode === 'baseline' ? 'selected baseline' : ''} onClick={() => setMode('baseline')}><span className="plan-color baseline" /><span><b>Baseline</b><small>Shortest distance first</small></span></button>
              <button className={mode === 'eco' ? 'selected eco' : ''} onClick={() => setMode('eco')}><span className="plan-color eco" /><span><b>Eco-optimized</b><small>Climate + time + emissions</small></span><span className="recommended">AI</span></button>
            </div>
            <div className="comparison-table">
              <div className="table-head"><span>PERFORMANCE</span><span>BASELINE</span><span>ECO</span></div>
              {[
                ['Distance', `${format(baseline.totals.distance)} km`, `${format(eco.totals.distance)} km`],
                ['Delivery time', `${format(baseline.totals.minutes, 0)} min`, `${format(eco.totals.minutes, 0)} min`],
                ['Fuel', `${format(baseline.totals.fuel)} L`, `${format(eco.totals.fuel)} L`],
                ['CO₂ emissions', `${format(baseline.totals.emissions)} kg`, `${format(eco.totals.emissions)} kg`],
                ['CO₂ vs baseline', '—', changeLabel(baseline.totals.emissions, eco.totals.emissions)],
                ['Operating cost', `₹${format(baseline.totals.cost, 0)}`, `₹${format(eco.totals.cost, 0)}`],
                ['Cost vs baseline', '—', changeLabel(baseline.totals.cost, eco.totals.cost)],
                ['Deliveries', `${baseline.totals.stops}/${deliveries.length}`, `${eco.totals.stops}/${deliveries.length}`],
              ].map(([label, base, optimized]) => <div className="table-row" key={label}><span>{label}</span><b>{base}</b><b className="eco-value">{optimized}</b></div>)}
            </div>
            <div className="tradeoff-note"><AlertTriangle size={14} /><span>Eco plans can trade distance or time for lower emissions. Results depend on the chosen vehicles and simulated conditions.</span></div>
          </section>

          <section className="panel-section insight-section">
            <div className="section-heading"><div><span className="eyebrow">ROUTE INTELLIGENCE</span><h2>Why this plan?</h2></div><span className="rule-based-label">RULE-BASED</span></div>
            <div className="insight-list">{insights.map((insight) => (
              <article className="insight-card" key={insight.title}>
                <span className="insight-icon">{insight.icon === 'leaf' ? <Leaf size={15} /> : insight.icon === 'cloud' ? <CloudRain size={15} /> : insight.icon === 'zap' ? <Zap size={15} /> : <Navigation size={15} />}</span>
                <div><strong>{insight.title}</strong><p>{insight.text}</p></div>
              </article>
            ))}</div>
          </section>
          {notice && <div className={`notice ${notice.startsWith('Supabase') ? 'success' : ''}`} role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
        </aside>
      </div>

      <section className="analytics-section">
        <div className="analytics-header"><div><span className="eyebrow">OPERATIONS OVERVIEW</span><h2>Impact at a glance</h2></div><span className="analytics-note"><Activity size={13} /> Illustrative estimates · synthetic conditions</span></div>
        <div className="metric-grid">
          <MetricCard label="Route distance" value={format(plan.totals.distance)} unit="km" icon={Navigation} tint="mint" footnote={`${mode === 'eco' ? 'Eco' : 'Baseline'} plan`} />
          <MetricCard label="Estimated delivery time" value={format(plan.totals.minutes, 0)} unit="min" icon={Clock3} tint="blue" footnote="Includes 4 min per stop" />
          <MetricCard label="Fuel consumed" value={format(plan.totals.fuel)} unit="L" icon={Truck} tint="amber" footnote={`${format(plan.totals.energy)} kWh electric`} />
          <MetricCard label="CO₂ emissions" value={format(plan.totals.emissions)} unit="kg" icon={Leaf} tint="mint" footnote="Tailpipe emissions estimate" />
          <MetricCard label="Operating cost" value={`₹${format(plan.totals.cost, 0)}`} unit="" icon={BadgeIndianRupee} tint="purple" footnote="Fuel / energy + distance" />
          <MetricCard label="Completed deliveries" value={`${completedIds.size}`} unit={`/${deliveries.length}`} icon={Check} tint="blue" footnote={running ? 'Live simulation progress' : 'Start simulation to track'} />
        </div>
        <div className="chart-card">
          <div className="chart-heading"><div><span className="eyebrow">COMPARATIVE ANALYSIS</span><h3>Baseline vs. climate-aware plan</h3></div><div className="chart-legend"><span><i className="legend-swatch baseline" />Baseline</span><span><i className="legend-swatch eco" />Eco-optimized</span></div></div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 14, left: 2, bottom: 0 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#20312d" />
                <XAxis dataKey="metric" tick={{ fill: '#8b9b94', fontSize: 11 }} axisLine={{ stroke: '#293934' }} tickLine={false} />
                <YAxis tick={{ fill: '#72837c', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#111f1a', border: '1px solid #2b3e36', borderRadius: 8, color: '#e7f1ec', fontSize: 12 }} formatter={(value, name) => [`${format(value, 0)} index`, name === 'baseline' ? 'Baseline' : 'Eco-optimized']} />
                <Legend formatter={(value) => value === 'baseline' ? 'Baseline' : 'Eco-optimized'} wrapperStyle={{ display: 'none' }} />
                <Bar dataKey="baseline" fill={PLAN_COLORS.baseline} radius={[4, 4, 0, 0]} maxBarSize={27} />
                <Bar dataKey="eco" fill={PLAN_COLORS.eco} radius={[4, 4, 0, 0]} maxBarSize={27} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-disclaimer">Each metric is indexed against its baseline (100 = baseline); use the comparison table for actual units. Fuel and emissions use declared per-km estimates, not live telemetry.</p>
        </div>
      </section>
      <footer className="footer"><span><Leaf size={13} /> EcoRoute AI <i /> A hackathon demo for lower-carbon urban logistics</span><span>Not turn-by-turn navigation · Synthetic traffic and weather · {supabase ? 'Supabase persistence enabled' : 'Local-only demo data'}</span></footer>
    </main>
  );
}
