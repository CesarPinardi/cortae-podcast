import handler from 'vinext/server/fetch-handler';
import { publishDueEpisodes } from '@/lib/server/podcast-db';

const worker = {
  fetch: handler.fetch,
  async scheduled(
    _controller: ScheduledController,
    bindings: Env,
    _ctx: ExecutionContext,
  ) {
    await publishDueEpisodes(bindings);
  },
};

export default worker;
