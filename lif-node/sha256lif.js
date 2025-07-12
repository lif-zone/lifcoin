// suggested by GROK
/*
  To create a slightly modified version of SHA-256 that incorporates
  conditional branching, Math.imul (32-bit signed integer multiplication),
  and Math.clz32 (count leading zeros in a 32-bit integer), I'll provide an implementation in JavaScript, as the query references JavaScript-specific functions like Math.imul and Math.clz32. This keeps the core structure of SHA-256 intact (message padding, block processing, word extension, and 64 compression rounds) but tweaks the round function to introduce
  these elements.

  Key Modifications
  - Conditional Branching: Added an if-else statement in each compression
    round, where the branch decision depends on the parity (even/odd) of
    Math.clz32(e). This creates data-dependent control flow, which reduces
    efficiency on GPUs (due to branch divergence) and complicates ASIC
    designs (as hardware must handle variable paths).
  - Math.imul: Integrated into both branches as an additional mixing
    operation: Math.imul(f, g) or Math.imul(b, c), added to temp1. This
    introduces multiplication, which is not present in standard SHA-256 and
    is harder to optimize in parallel hardware without increasing
    complexity/cost.
  - Math.clz32: Used to compute the branch condition
    (Math.clz32(e) % 2 === 0). This adds a dynamic, input-dependent
    computation that favors CPUs over specialized hardware.
  - These changes are "slight" in that they only alter the computation of
    temp1 in the round loop, preserving the overall algorithm flow,
    constants, and output size (256 bits). However, note that this breaks
    the cryptographic security of SHA-256—do not use for secure hashing.
    It's suitable for proof-of-work or similar applications where hardware
    resistance is the goal.
*/
function branchySHA256(message) {
  // Helper functions (unchanged from standard SHA-256)
  function rotr(x, y) {
    return (x >>> y) | (x << (32 - y));
  }

  function ch(x, y, z) {
    return (x & y) ^ (~x & z);
  }

  function maj(x, y, z) {
    return (x & y) ^ (x & z) ^ (y & z);
  }

  function sigma0(x) {
    return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
  }

  function sigma1(x) {
    return rotr(x, 6) ^ rotr(x, 17) ^ rotr(x, 25);
  }

  function gamma0(x) {
    return rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
  }

  function gamma1(x) {
    return rotr(x, 10) ^ rotr(x, 19) ^ (x >>> 17);
  }

  // SHA-256 constants
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  // Initial hash values
  let H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  // Pre-processing: padding the message
  const bitLen = message.length * 8;
  message += String.fromCharCode(0x80);
  while ((message.length % 64) !== 56) {
    message += String.fromCharCode(0x00);
  }
  for (let i = 7; i >= 0; i--) {
    message += String.fromCharCode((bitLen / (2 ** (i * 8))) & 0xff);
  }

  // Process the message in 512-bit blocks
  for (let offset = 0; offset < message.length; offset += 64) {
    const block = message.substring(offset, offset + 64);
    const W = new Array(64);

    // Break block into 16 words
    for (let i = 0; i < 16; i++) {
      W[i] = (block.charCodeAt(i * 4) << 24) |
             (block.charCodeAt(i * 4 + 1) << 16) |
             (block.charCodeAt(i * 4 + 2) << 8) |
             block.charCodeAt(i * 4 + 3);
    }

    // Extend to 64 words
    for (let i = 16; i < 64; i++) {
      W[i] = (gamma1(W[i - 2]) + W[i - 7] + gamma0(W[i - 15]) + W[i - 16]) >>> 0;
    }

    // Initialize working variables
    let [a, b, c, d, e, f, g, h] = H;

    // Compression loop with modifications
    for (let i = 0; i < 64; i++) {
      const clz = Math.clz32(e);  // Use Math.clz32
      let temp1 = (h + sigma1(e) + ch(e, f, g) + K[i] + W[i]) >>> 0;

      // Conditional branching based on clz parity, adding Math.imul in each branch
      if (clz % 2 === 0) {
        temp1 = (temp1 + Math.imul(f, g)) >>> 0;  // Branch 1: imul(f, g)
      } else {
        temp1 = (temp1 + Math.imul(b, c)) >>> 0;  // Branch 2: imul(b, c)
      }

      const temp2 = (sigma0(a) + maj(a, b, c)) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    // Add to hash values
    H = H.map((val, idx) => (val + [a, b, c, d, e, f, g, h][idx]) >>> 0);
  }

  // Produce the final hash as a hex string
  return H.map(val => val.toString(16).padStart(8, '0')).join('');
}

// Example usage
console.log(branchySHA256('hello world'));  // Outputs a 64-char hex string (modified hash)
