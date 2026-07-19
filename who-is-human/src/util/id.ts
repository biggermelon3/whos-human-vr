let counter = 0;

/** Monotonic, collision-free id for decision requests (no Date.now needed). */
export function nextRequestId(prefix = "req"): string {
  counter += 1;
  return `${prefix}_${counter.toString(36).padStart(4, "0")}`;
}
