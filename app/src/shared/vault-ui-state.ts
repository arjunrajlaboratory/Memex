interface ResettableVaultUiState {
  tab: string;
  activeAssistant: unknown;
  toolCards: { clear(): void };
  busy: boolean;
  hasArtifact: boolean;
  history: unknown[];
  histPos: number;
  customTabs: unknown[];
  configuredTabs: unknown[];
  customChips: unknown[];
  hiddenTabs: string[];
  selectedFolders: string[];
  availableFolders: string[];
}

interface VaultOpenEpochState {
  request: number;
  epoch: number;
}

interface VisibleTabCandidate {
  tab: string;
  visible: boolean;
  artifact: boolean;
}

/** Pick the first user-configured visible tab, never the transient artifact tab. */
function selectFirstVisibleTab(candidates: readonly VisibleTabCandidate[]): string | null {
  return candidates.find((candidate) => candidate.visible && !candidate.artifact)?.tab || null;
}

/** Start an open attempt without invalidating work belonging to the committed vault. */
function beginVaultOpen(state: VaultOpenEpochState): number {
  state.request += 1;
  return state.request;
}

/** Advance the vault generation only when the current open attempt succeeds. */
function commitVaultOpen(state: VaultOpenEpochState, request: number): number | null {
  if (request !== state.request) return null;
  state.epoch += 1;
  return state.epoch;
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
  state.configuredTabs = [];
  state.customChips = [];
  state.hiddenTabs = [];
  state.selectedFolders = [];
  state.availableFolders = [];
}
