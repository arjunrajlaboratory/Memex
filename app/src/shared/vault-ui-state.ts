interface ResettableVaultUiState {
  tab: string;
  activeAssistant: unknown;
  toolCards: { clear(): void };
  busy: boolean;
  hasArtifact: boolean;
  history: unknown[];
  histPos: number;
  customTabs: unknown[];
  customChips: unknown[];
}

/** Reset every renderer model field whose contents belong to one vault/session. */
function resetVaultUiModel(state: ResettableVaultUiState): void {
  state.tab = 'dashboard';
  state.activeAssistant = null;
  state.toolCards.clear();
  state.busy = false;
  state.hasArtifact = false;
  state.history = [];
  state.histPos = -1;
  state.customTabs = [];
  state.customChips = [];
}
