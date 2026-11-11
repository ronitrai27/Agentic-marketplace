/** Redis key of the cached public agent page; shared by the page loader and the invalidation action. */
export const agentPageKey = (slug: string) => `agent-page:v1:${slug}`;
