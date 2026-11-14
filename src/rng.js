// Deterministic seeded PRNG: Mulberry32
// Pure function returning a generator () => number in [0, 1)

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x1337beef;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed = 1) {
  const raw = mulberry32(seed);
  return {
    seed,
    next: raw,
    chance(probability) {
      return raw() < probability;
    },
    int(min, maxInclusive) {
      return Math.floor(raw() * (maxInclusive - min + 1)) + min;
    },
    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[Math.floor(raw() * array.length)];
    }
  };
}
