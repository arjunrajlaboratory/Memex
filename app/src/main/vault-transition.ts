/** Serializes vault opens and closes access to the mutable active-vault pointer while it changes. */
export class VaultTransitionGate {
  private transitioning = false;

  begin(): boolean {
    if (this.transitioning) return false;
    this.transitioning = true;
    return true;
  }

  finish(): void { this.transitioning = false; }

  canAccess(vault: string | null): boolean { return !!vault && !this.transitioning; }

  get active(): boolean { return this.transitioning; }
}
