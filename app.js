// Vercel's entry point. Vercel runs this Express app as a single serverless
// function and serves public/ from its CDN. See docs/cloud.md.
// (Everywhere else, start Hearth with `npm start`, which runs server/index.js.)
import express from 'express';
import { buildHearth } from './server/hearth.js';

const app = express();
buildHearth(app, { env: process.env, platform: 'vercel' });

export default app;
