// Serves the repo for the web build: npm run web  →  http://127.0.0.1:5173/web/
import { start } from '../test/web/server.js';
const { url } = await start(Number(process.env.PORT) || 5173);
console.log(`PromptDock web: ${url}/web/`);
