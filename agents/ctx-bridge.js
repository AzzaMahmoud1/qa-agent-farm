/** Mutable runtime context — set once via createAgentFarm(ctx). */
export let farmCtx = null;

export function setFarmCtx(ctx) {
  farmCtx = ctx;
}
