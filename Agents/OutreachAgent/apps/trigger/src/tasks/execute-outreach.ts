import { task } from '@trigger.dev/sdk/v3';
import { executeOutreach, type OutreachTaskPayload } from '../client.js';

export const executeOutreachTask = task({
  id: 'outreach.execute',
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: OutreachTaskPayload) => executeOutreach(payload),
});
