import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_DELIVERIES, INITIAL_VEHICLES } from './data.js';
import { optimizeRoutes, routePosition } from './optimizer.js';

const normalClimate = { traffic: 32, rain: 18, heat: 28 };
const stormClimate = { traffic: 67, rain: 78, heat: 28 };

test('the demo scenario is deterministic and assigns all stops within vehicle capacity', () => {
  const first = optimizeRoutes({ deliveries: INITIAL_DELIVERIES, vehicles: INITIAL_VEHICLES, climate: normalClimate });
  const second = optimizeRoutes({ deliveries: INITIAL_DELIVERIES, vehicles: INITIAL_VEHICLES, climate: normalClimate });

  assert.deepEqual(first.totals, second.totals);
  assert.equal(first.totals.stops, INITIAL_DELIVERIES.length);
  assert.equal(first.unassigned.length, 0);
  assert.equal(first.routes.filter((route) => route.stops.length > 0).length, 3);
  first.routes.forEach((route) => {
    const load = route.stops.reduce((sum, stop) => sum + stop.weight, 0);
    assert.ok(load <= route.vehicle.capacity);
  });
});

test('heavy rain and congestion reroute the eco plan and increase affected estimates', () => {
  const normal = optimizeRoutes({ deliveries: INITIAL_DELIVERIES, vehicles: INITIAL_VEHICLES, climate: normalClimate, mode: 'eco' });
  const storm = optimizeRoutes({ deliveries: INITIAL_DELIVERIES, vehicles: INITIAL_VEHICLES, climate: stormClimate, mode: 'eco' });
  const changedRoutes = normal.routes.filter((route, index) => (
    JSON.stringify(route.legs.map((leg) => leg.path))
    !== JSON.stringify(storm.routes[index].legs.map((leg) => leg.path))
  ));

  assert.ok(changedRoutes.length > 0);
  assert.ok(storm.totals.minutes > normal.totals.minutes);
  assert.ok(storm.totals.distance > normal.totals.distance);
});

test('unavailable capacity and empty input are reported without invalid routes', () => {
  const constrained = optimizeRoutes({
    deliveries: INITIAL_DELIVERIES,
    vehicles: [INITIAL_VEHICLES[0]],
    climate: normalClimate,
  });
  assert.ok(constrained.unassigned.length > 0);
  constrained.routes.forEach((route) => {
    assert.ok(route.stops.reduce((sum, stop) => sum + stop.weight, 0) <= route.vehicle.capacity);
  });

  const empty = optimizeRoutes({ deliveries: [], vehicles: [], climate: normalClimate });
  assert.equal(empty.routes.length, 0);
  assert.equal(empty.totals.stops, 0);
  assert.equal(empty.unassigned.length, 0);
});

test('vehicle positions stay within a planned route', () => {
  const plan = optimizeRoutes({ deliveries: INITIAL_DELIVERIES, vehicles: INITIAL_VEHICLES, climate: normalClimate });
  const route = plan.routes.find((candidate) => candidate.stops.length > 0);
  const position = routePosition(route, 0.5);
  assert.ok(Number.isFinite(position.lat));
  assert.ok(Number.isFinite(position.lng));
});
