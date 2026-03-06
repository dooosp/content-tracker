import { startContentTrackerServer } from './app.js';
import { toErrorMessage } from './lib/utils.js';

startContentTrackerServer().catch((error) => {
  console.error('[content-tracker] failed to start', toErrorMessage(error));
  process.exit(1);
});

