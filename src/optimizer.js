import { WAREHOUSE } from './data.js';

const GRID = 6;
const EARTH_KM = 6371;

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

function buildRoadGraph(deliveries, climate) {
  const points = [WAREHOUSE, ...deliveries];
  const minLat = Math.min(...points.map((point) => point.lat)) - 0.009;
  const maxLat = Math.max(...points.map((point) => point.lat)) + 0.009;
  const minLng = Math.min(...points.map((point) => point.lng)) - 0.012;
  const maxLng = Math.max(...points.map((point) => point.lng)) + 0.012;
  const nodes = [];
  const gridIds = [];

  for (let row = 0; row <= GRID; row += 1) {
    gridIds[row] = [];
    for (let col = 0; col <= GRID; col += 1) {
      const id = nodes.length;
      gridIds[row][col] = id;
      nodes.push({
        id,
        lat: minLat + ((maxLat - minLat) * row / GRID),
        lng: minLng + ((maxLng - minLng) * col / GRID),
        kind: 'road',
      });
    }
  }

  points.forEach((point) => {
    const nearest = nodes.reduce((best, node) => distanceKm(node, point) < distanceKm(nodes[best], point) ? node.id : best, 0);
    nodes.push({ id: nodes.length, lat: point.lat, lng: point.lng, kind: point.id === WAREHOUSE.id ? 'warehouse' : 'delivery', pointId: point.id, connector: nearest });
  });

  const adjacency = nodes.map(() => []);
  function connect(from, to, connector = false) {
    const a = nodes[from];
    const b = nodes[to];
    const distance = distanceKm(a, b) * (connector ? 1.08 : 1.12);
    const midpoint = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const congestionZone = midpoint.lat > 12.953 && midpoint.lat < 12.982 && midpoint.lng > 77.601 && midpoint.lng < 77.646;
    const eastZone = midpoint.lng > 77.692;
    const traffic = (climate.traffic / 100) * (congestionZone ? 1.25 : 0.62);
    const rain = (climate.rain / 100) * (eastZone ? 0.9 : 0.52);
    const heat = (climate.heat / 100) * 0.12;
    const baseMinutes = distance / 23 * 60;
    const multiplier = 1 + traffic + rain * 0.65 + heat;
    const risk = congestionZone && climate.traffic > 35 ? 0.08 : 0;
    const severeCongestionSegment = midpoint.lat > 12.967 && midpoint.lat < 12.974 && midpoint.lng > 77.61 && midpoint.lng < 77.63;
    const incidentPenalty = climate.traffic >= 65 && severeCongestionSegment ? 12 : 0;
    const stormPenalty = climate.rain >= 70 && eastZone ? 3.5 : 0;
    const cost = distance * (1 + traffic * 0.52 + rain * 0.65 + heat * 0.22 + risk + incidentPenalty + stormPenalty);
    adjacency[from].push({ to, distance, minutes: baseMinutes * multiplier, cost });
    adjacency[to].push({ to: from, distance, minutes: baseMinutes * multiplier, cost });
  }

  for (let row = 0; row <= GRID; row += 1) {
    for (let col = 0; col <= GRID; col += 1) {
      if (row < GRID) connect(gridIds[row][col], gridIds[row + 1][col]);
      if (col < GRID) connect(gridIds[row][col], gridIds[row][col + 1]);
    }
  }
  nodes.filter((node) => node.connector !== undefined).forEach((node) => connect(node.id, node.connector, true));

  return { nodes, adjacency };
}

function shortestPath(graph, fromId, toId, mode) {
  const { nodes, adjacency } = graph;
  const start = nodes.find((node) => node.pointId === fromId);
  const destination = nodes.find((node) => node.pointId === toId);
  if (!start || !destination) return { path: [], distance: 0, minutes: 0, score: 0 };
  const scores = Array(nodes.length).fill(Infinity);
  const previous = Array(nodes.length).fill(-1);
  const travelledKm = Array(nodes.length).fill(0);
  const travelledMinutes = Array(nodes.length).fill(0);
  const pending = new Set(nodes.map((node) => node.id));
  scores[start.id] = 0;

  while (pending.size) {
    let current = -1;
    pending.forEach((id) => {
      if (current === -1 || scores[id] < scores[current]) current = id;
    });
    if (current === -1 || !Number.isFinite(scores[current]) || current === destination.id) break;
    pending.delete(current);
    adjacency[current].forEach((edge) => {
      if (!pending.has(edge.to)) return;
      const edgeScore = mode === 'baseline' ? edge.distance : edge.cost;
      if (scores[current] + edgeScore < scores[edge.to]) {
        scores[edge.to] = scores[current] + edgeScore;
        previous[edge.to] = current;
        travelledKm[edge.to] = travelledKm[current] + edge.distance;
        travelledMinutes[edge.to] = travelledMinutes[current] + edge.minutes;
      }
    });
  }

  const path = [];
  let cursor = destination.id;
  while (cursor !== -1) {
    path.unshift(nodes[cursor]);
    if (cursor === start.id) break;
    cursor = previous[cursor];
  }
  if (path[0]?.id !== start.id) return { path: [start, destination], distance: distanceKm(start, destination), minutes: 0, score: 0 };
  return {
    path,
    distance: travelledKm[destination.id],
    minutes: travelledMinutes[destination.id],
    score: scores[destination.id],
  };
}

function assignDeliveries(deliveries, vehicles) {
  const assignments = vehicles.filter((vehicle) => vehicle.available).map((vehicle) => ({ vehicle, stops: [], remaining: vehicle.capacity }));
  const sorted = [...deliveries].sort((a, b) => (b.priority === 'High' ? 1 : 0) - (a.priority === 'High' ? 1 : 0) || b.weight - a.weight);
  sorted.forEach((delivery) => {
    const eligible = assignments.filter((assignment) => assignment.remaining >= delivery.weight);
    if (!eligible.length) return;
    const best = eligible.reduce((chosen, candidate) => {
      const candidateDistance = Math.min(...candidate.stops.map((stop) => distanceKm(stop, delivery)), distanceKm(WAREHOUSE, delivery));
      const chosenDistance = Math.min(...chosen.stops.map((stop) => distanceKm(stop, delivery)), distanceKm(WAREHOUSE, delivery));
      const candidateUtilization = (candidate.vehicle.capacity - candidate.remaining + delivery.weight) / candidate.vehicle.capacity;
      const chosenUtilization = (chosen.vehicle.capacity - chosen.remaining + delivery.weight) / chosen.vehicle.capacity;
      const candidateEfficiency = candidateDistance + candidateUtilization ** 2 * 8 + candidate.stops.length * 0.35;
      const chosenEfficiency = chosenDistance + chosenUtilization ** 2 * 8 + chosen.stops.length * 0.35;
      return candidateEfficiency < chosenEfficiency ? candidate : chosen;
    });
    best.stops.push(delivery);
    best.remaining -= delivery.weight;
  });
  return assignments;
}

function orderStops(stops, mode, graph) {
  const remaining = [...stops];
  const ordered = [];
  let current = WAREHOUSE;
  let elapsedMinutes = 0;
  while (remaining.length) {
    const scored = remaining.map((stop) => {
      const leg = shortestPath(graph, current.id, stop.id, mode);
      const priorityBonus = stop.priority === 'High' ? (mode === 'eco' ? 2.2 : 0.3) : 0;
      const [hours, minutes] = stop.deadline?.split(':').map(Number) || [];
      const deadlineTime = hours * 60 + minutes;
      const arrivalTime = 9 * 60 + elapsedMinutes + leg.minutes + 4;
      const lateness = Number.isFinite(deadlineTime) && mode === 'eco'
        ? Math.max(0, arrivalTime - deadlineTime)
        : 0;
      const score = mode === 'baseline'
        ? distanceKm(current, stop)
        : leg.minutes * 0.44 + leg.distance * 0.48 + lateness * 1.7 - priorityBonus;
      return { stop, score };
    });
    scored.sort((a, b) => a.score - b.score || a.stop.id.localeCompare(b.stop.id));
    const previousId = current.id;
    current = scored[0].stop;
    elapsedMinutes += shortestPath(graph, previousId, current.id, mode).minutes + 4;
    ordered.push(current);
    remaining.splice(remaining.findIndex((stop) => stop.id === current.id), 1);
  }
  return ordered;
}

function createVehicleRoute(assignment, mode, climate, deliveries) {
  const { vehicle } = assignment;
  const graph = buildRoadGraph(deliveries, climate);
  const stops = orderStops(assignment.stops, mode, graph);
  const legs = [];
  let current = WAREHOUSE;
  stops.forEach((stop) => {
    const leg = shortestPath(graph, current.id, stop.id, mode === 'baseline' ? 'baseline' : 'eco');
    legs.push({ from: current, to: stop, path: leg.path, distance: leg.distance, minutes: leg.minutes });
    current = stop;
  });
  if (stops.length) {
    const leg = shortestPath(graph, current.id, WAREHOUSE.id, mode === 'baseline' ? 'baseline' : 'eco');
    legs.push({ from: current, to: WAREHOUSE, path: leg.path, distance: leg.distance, minutes: leg.minutes });
  }

  const distance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const minutes = legs.reduce((sum, leg) => sum + leg.minutes, 0) + stops.length * 4;
  const loadFactor = Math.min(1, assignment.stops.reduce((sum, stop) => sum + stop.weight, 0) / vehicle.capacity);
  const loadMultiplier = 1 + loadFactor * 0.12;
  const rainMultiplier = 1 + climate.rain / 100 * 0.16;
  const fuel = distance * vehicle.fuelPerKm * loadMultiplier * rainMultiplier;
  const electricEnergy = distance * vehicle.kwhPerKm * loadMultiplier * rainMultiplier;
  const emissions = distance * vehicle.emissionsPerKm * loadMultiplier * rainMultiplier;
  const operatingCost = fuel * 96 + electricEnergy * 9 + distance * (vehicle.electric ? 0.12 : 1.35);
  return { vehicle, stops, legs, distance, minutes, fuel, electricEnergy, emissions, operatingCost };
}

export function optimizeRoutes({ deliveries, vehicles, climate, mode = 'eco' }) {
  const activeDeliveries = deliveries.filter((delivery) => delivery.status !== 'Completed');
  const assignments = assignDeliveries(activeDeliveries, vehicles);
  const routes = assignments.map((assignment) => createVehicleRoute(assignment, mode, climate, activeDeliveries));
  const assignedIds = new Set(routes.flatMap((route) => route.stops.map((stop) => stop.id)));
  const unassigned = activeDeliveries.filter((delivery) => !assignedIds.has(delivery.id));
  const totals = routes.reduce((sum, route) => ({
    distance: sum.distance + route.distance,
    minutes: Math.max(sum.minutes, route.minutes),
    fuel: sum.fuel + route.fuel,
    energy: sum.energy + route.electricEnergy,
    emissions: sum.emissions + route.emissions,
    cost: sum.cost + route.operatingCost,
    stops: sum.stops + route.stops.length,
  }), { distance: 0, minutes: 0, fuel: 0, energy: 0, emissions: 0, cost: 0, stops: 0 });
  return { routes, totals, unassigned, mode };
}

export function routePosition(route, progress) {
  const total = route.distance || 1;
  const targetKm = Math.max(0, Math.min(1, progress)) * total;
  let travelled = 0;
  for (const leg of route.legs) {
    if (targetKm <= travelled + leg.distance) {
      const segmentProgress = leg.distance ? (targetKm - travelled) / leg.distance : 0;
      const path = leg.path;
      const pathLength = path.slice(1).reduce((sum, point, index) => sum + distanceKm(path[index], point), 0) || 1;
      let pathTarget = segmentProgress * pathLength;
      for (let index = 1; index < path.length; index += 1) {
        const segment = distanceKm(path[index - 1], path[index]);
        if (pathTarget <= segment || index === path.length - 1) {
          const fraction = segment ? Math.min(1, pathTarget / segment) : 0;
          return {
            lat: path[index - 1].lat + (path[index].lat - path[index - 1].lat) * fraction,
            lng: path[index - 1].lng + (path[index].lng - path[index - 1].lng) * fraction,
          };
        }
        pathTarget -= segment;
      }
    }
    travelled += leg.distance;
  }
  return route.legs.at(-1)?.to || WAREHOUSE;
}

export function getInsights(plan, baseline, climate, vehicles) {
  const insights = [];
  const reduction = baseline.totals.emissions
    ? Math.round((1 - plan.totals.emissions / baseline.totals.emissions) * 100)
    : 0;
  insights.push({
    icon: 'leaf',
    title: reduction > 0 ? 'Lower-carbon plan selected' : reduction < 0 ? 'Emissions trade-off detected' : 'Similar estimated emissions',
    text: reduction > 0
      ? `The eco plan estimates ${Math.abs(reduction)}% lower CO₂ than the baseline by balancing road distance, congestion exposure, and vehicle efficiency.`
      : reduction < 0
        ? `The eco plan estimates ${Math.abs(reduction)}% higher CO₂ for this fleet and scenario. Compare time and distance before choosing the trade-off.`
        : 'Current vehicle assignments produce similar CO₂ estimates. Compare time, distance, and cost to see the remaining trade-offs.',
  });
  if (climate.rain >= 45 || climate.traffic >= 55) {
    insights.push({
      icon: 'cloud',
      title: 'Weather-aware rerouting',
      text: `${climate.rain >= 45 ? 'Synthetic heavy rain' : 'Synthetic traffic'} adds delay to exposed road segments. Routes avoid the most penalized central links where an alternative is available.`,
    });
  } else {
    insights.push({
      icon: 'route',
      title: 'Stops grouped by proximity',
      text: 'The planner assigns nearby deliveries to the same vehicle while respecting load capacity, then selects each next stop using travel time and emissions-aware road costs.',
    });
  }
  const electric = vehicles.find((vehicle) => vehicle.available && vehicle.electric);
  if (electric) {
    const electricRoute = plan.routes.find((route) => route.vehicle.id === electric.id);
    insights.push({
      icon: 'zap',
      title: electricRoute?.stops.length
        ? `${electric.id} assigned ${electricRoute.stops.length} deliveries`
        : `${electric.id} available for dispatch`,
      text: electricRoute?.stops.length
        ? `Its assigned payload is ${electricRoute.stops.reduce((sum, stop) => sum + stop.weight, 0)} kg. Zero tailpipe CO₂ is counted; electricity use is estimated separately and grid emissions are excluded.`
        : 'The electric van is currently available but has no assigned stops in this plan. Electricity-generation emissions are excluded.',
    });
  }
  return insights;
}
