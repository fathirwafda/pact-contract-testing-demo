import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { seedSampleProducts, Store } from './store.js';

const config = loadConfig();
const store = new Store();
seedSampleProducts(store);

const app = createApp({
  store,
  apiTokens: config.apiTokens,
  breakingChange: config.breakingChange,
});

app.listen(config.port, () => {
  console.log(`order-service listening on http://localhost:${config.port}`);
});
