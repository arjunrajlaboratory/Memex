export interface ModelPreferenceState {
  modelByVault?: Record<string, string>;
}

function modelsByVault(state: ModelPreferenceState): Record<string, string> {
  return state.modelByVault && typeof state.modelByVault === 'object' && !Array.isArray(state.modelByVault)
    ? state.modelByVault
    : {};
}

/** The model chosen for one vault, or null to inherit the SDK's own default. */
export function vaultModel(state: ModelPreferenceState, vault: string): string | null {
  const model = modelsByVault(state)[vault];
  // Return the trimmed form: a hand-edited padded value must not reach the SDK.
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return trimmed || null;
}

/** Return a new config with the vault's model set, or cleared with model=null. */
export function setVaultModel<T extends ModelPreferenceState>(state: T, vault: string, model: string | null): T {
  const current = modelsByVault(state);
  if (model === null) {
    if (!(vault in current)) return state;
    const modelByVault = { ...current };
    delete modelByVault[vault];
    return { ...state, modelByVault } as T;
  }
  if (current[vault] === model) return state;
  return { ...state, modelByVault: { ...current, [vault]: model } } as T;
}
