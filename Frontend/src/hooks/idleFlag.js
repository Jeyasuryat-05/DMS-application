// Shared module-level flag to signal that idle timeout fired the re-login modal.
// Used by axios interceptor and useAuth to skip window.location redirects.
export let idleTimedOut = false
export function setIdleTimedOut(val) { idleTimedOut = val }
