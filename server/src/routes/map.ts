import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { anyUser, badRequest, parse } from '../http.js';
import { buildingsIn, ensureBuildings, type Bbox } from '../lib/osm.js';

// Requests snap outward to this grid so nearby views share one cached download.
const GRID = 0.02;
const snap = (v: number, up: boolean) => (up ? Math.ceil(v / GRID) : Math.floor(v / GRID)) * GRID;

const routes: FastifyPluginAsync = async (app) => {
  // Building outlines in a box, as GeoJSON, for drawing real houses on maps.
  app.get('/map/buildings', { preHandler: anyUser }, async (req) => {
    const q = parse(z.object({ bbox: z.string() }), req.query);
    const [south, west, north, east] = q.bbox.split(',').map(Number);
    if ([south, west, north, east].some((v) => !Number.isFinite(v)) || south >= north || west >= east) throw badRequest('bbox must be south,west,north,east');
    if (north - south > 0.15 || east - west > 0.3) throw badRequest('Zoom in to see buildings');
    const box: Bbox = { south: snap(south, false), west: snap(west, false), north: snap(north, true), east: snap(east, true) };
    await ensureBuildings(app.pool, { south, west, north, east }, box, (m) => req.log.warn(m));
    const list = await buildingsIn(app.pool, { south, west, north, east });
    return {
      type: 'FeatureCollection',
      features: list.map((b) => ({
        type: 'Feature',
        id: b.osm_id,
        geometry: { type: 'Polygon', coordinates: [b.outline] },
        properties: { id: b.osm_id, lat: b.lat, lng: b.lng, kind: b.kind, name: b.name, address: b.address },
      })),
    };
  });
};

export default routes;
