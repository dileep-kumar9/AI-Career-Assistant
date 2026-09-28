// Vercel function: every /api/* request is rewritten here (see vercel.json).
// The server is compiled by `npm run build` into build/ first.
export { default } from '../build/server/src/vercel.js';
