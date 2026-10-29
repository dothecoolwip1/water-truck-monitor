// Vercel Function: all /api requests go to the Fastify app (see vercel.json).
import { handler } from '../server/dist/src/serverless.js';

export default handler;
