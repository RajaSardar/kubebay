/**
 * Every Restart in the app asks once more before it reaches the API: the
 * button first turns into this, and only a second click restarts. Anything
 * that calls the restart API (or sends a Rollout's restart patch) must import
 * this, which the restartGuard test enforces.
 */
export const RESTART_CONFIRM_LABEL = "Confirm restart?";
