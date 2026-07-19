export interface ToolGrantState {
  toolGrants?: Record<string, string[]>;
}

function grantsByVault(state: ToolGrantState): Record<string, string[]> {
  return state.toolGrants && typeof state.toolGrants === 'object' && !Array.isArray(state.toolGrants)
    ? state.toolGrants
    : {};
}

/** Tool grants are exact-name matches and are isolated by vault path. */
export function hasToolGrant(state: ToolGrantState, vault: string, tool: string): boolean {
  const grants = grantsByVault(state)[vault];
  return Array.isArray(grants) && grants.includes(tool);
}

/** Return a new config with an idempotent persistent grant for one vault. */
export function grantTool<T extends ToolGrantState>(state: T, vault: string, tool: string): T {
  const toolGrants = grantsByVault(state);
  const existing = toolGrants[vault];
  const grants = Array.isArray(existing) ? existing : [];
  if (grants.includes(tool)) return state;
  return {
    ...state,
    toolGrants: {
      ...toolGrants,
      [vault]: [...grants, tool],
    },
  } as T;
}

/** Return a new config with only the selected vault's grants removed. */
export function clearVaultToolGrants<T extends ToolGrantState>(state: T, vault: string): T {
  const grants = grantsByVault(state);
  if (!(vault in grants)) return state;
  const toolGrants = { ...grants };
  delete toolGrants[vault];
  return { ...state, toolGrants } as T;
}
