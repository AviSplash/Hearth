// Cloudflare Workers entry point (see wrangler.jsonc and docs/cloud.md).
// Workers Static Assets serves public/; requests under /api run Hearth's
// Express app through Cloudflare's Node.js HTTP server support. Household
// data lives in the D1 database bound as DB.
import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import { buildHearth } from './hearth.js';

const app = express();
buildHearth(app, { env, platform: 'cloudflare', d1: env.DB });
app.listen(3000);

export default httpServerHandler({ port: 3000 });
