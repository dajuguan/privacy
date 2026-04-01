const path = require("path");

const circomTester = require("circom_tester");
const circomlibjs = require("circomlibjs");

const DEFAULT_DEPTH = 4;
const K = 16;
const MAX_INPUTS = 2;
const MAX_OUTPUTS = 2;
const T_WINDOW = 4n;
const MAX_U64 = (1n << 64n) - 1n;

let poseidonInstance;

async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await circomlibjs.buildPoseidon();
  }
  return poseidonInstance;
}

async function poseidonHash(inputs) {
  const poseidon = await getPoseidon();
  return poseidon.F.toObject(poseidon(inputs.map((value) => BigInt(value))));
}

async function hash1(a) {
  return poseidonHash([a]);
}

async function hash2(a, b) {
  return poseidonHash([a, b]);
}

async function hash3(a, b, c) {
  return poseidonHash([a, b, c]);
}

async function hash4(a, b, c, d) {
  return poseidonHash([a, b, c, d]);
}

function zeroArray(length, value = 0n) {
  return Array.from({ length }, () => BigInt(value));
}

function makeSlots(entries, size = K) {
  const srcIds = zeroArray(size);
  const enterEpochs = zeroArray(size);

  entries.forEach(([srcId, enterEpoch], index) => {
    srcIds[index] = BigInt(srcId);
    enterEpochs[index] = BigInt(enterEpoch);
  });

  return { srcIds, enterEpochs };
}

async function buildBinaryLevels(leaves) {
  const levels = [leaves.map((leaf) => BigInt(leaf))];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(await hash2(current[i], current[i + 1]));
    }
    levels.push(next);
  }
  return levels;
}

async function buildBinaryProof(leaves, index) {
  const levels = await buildBinaryLevels(leaves);
  const siblings = [];
  const pathIndices = [];
  let currentIndex = index;

  for (let level = 0; level < levels.length - 1; level += 1) {
    const isRight = currentIndex % 2;
    pathIndices.push(BigInt(isRight));
    siblings.push(levels[level][isRight ? currentIndex - 1 : currentIndex + 1]);
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    root: levels[levels.length - 1][0],
    siblings,
    pathIndices
  };
}

async function buildFixedDepthProof(leaf, index, depth, emptyLeaf = 0n) {
  const leaves = zeroArray(1 << depth, emptyLeaf);
  leaves[index] = BigInt(leaf);
  return buildBinaryProof(leaves, index);
}

async function buildSlotsRoot(srcIds, enterEpochs) {
  const leaves = [];
  for (let i = 0; i < srcIds.length; i += 1) {
    leaves.push(await hash2(srcIds[i], enterEpochs[i]));
  }
  const proof = await buildBinaryProof(leaves, 0);
  return proof.root;
}

async function buildNote({ amount, ask, rho, srcIds, enterEpochs }) {
  const ownerCommit = await hash1(ask);
  const sourcesRoot = await buildSlotsRoot(srcIds, enterEpochs);
  const noteCommit = await hash4(amount, ownerCommit, rho, sourcesRoot);
  const nf = await hash2(ask, rho);

  return {
    amount: BigInt(amount),
    ask: BigInt(ask),
    rho: BigInt(rho),
    ownerCommit,
    sourcesRoot,
    noteCommit,
    nf,
    srcIds: srcIds.map((value) => BigInt(value)),
    enterEpochs: enterEpochs.map((value) => BigInt(value))
  };
}

async function buildDeposit({ depositIndex, amount, ask, depositSecret }) {
  const ownerCommit = await hash1(ask);
  const depLeaf = await hash4(depositIndex, amount, ownerCommit, depositSecret);
  return {
    depositIndex: BigInt(depositIndex),
    amount: BigInt(amount),
    ask: BigInt(ask),
    ownerCommit,
    depositSecret: BigInt(depositSecret),
    depLeaf
  };
}

async function buildBlacklistState(keys, depth) {
  const sortedKeys = [...new Set(keys.map((key) => BigInt(key)))].sort((a, b) => (a < b ? -1 : 1));
  const pairs = [];

  if (sortedKeys.length === 0) {
    pairs.push([0n, MAX_U64]);
  } else {
    pairs.push([0n, sortedKeys[0]]);
    for (let i = 0; i < sortedKeys.length; i += 1) {
      pairs.push([sortedKeys[i], i + 1 < sortedKeys.length ? sortedKeys[i + 1] : MAX_U64]);
    }
  }

  const emptyLeaf = await hash2(0n, 0n);
  const leaves = zeroArray(1 << depth, emptyLeaf);

  for (let i = 0; i < pairs.length; i += 1) {
    leaves[i] = await hash2(pairs[i][0], pairs[i][1]);
  }

  const root = (await buildBinaryProof(leaves, 0)).root;
  return { root, pairs, leaves };
}

async function buildBlacklistWitness(keys, srcId, depth = DEFAULT_DEPTH) {
  const state = await buildBlacklistState(keys, depth);
  let pairIndex = 0;

  for (let i = 0; i < state.pairs.length; i += 1) {
    if (state.pairs[i][0] < BigInt(srcId)) {
      pairIndex = i;
    } else {
      break;
    }
  }

  const proof = await buildBinaryProof(state.leaves, pairIndex);
  return {
    root: state.root,
    lowLeafKey: state.pairs[pairIndex][0],
    lowLeafNextKey: state.pairs[pairIndex][1],
    siblings: proof.siblings,
    pathIndices: proof.pathIndices
  };
}

function disabledBlacklistWitness(depth = DEFAULT_DEPTH) {
  return {
    lowLeafKey: 0n,
    lowLeafNextKey: 0n,
    siblings: zeroArray(depth),
    pathIndices: zeroArray(depth)
  };
}

function normalizeSignals(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSignals);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeSignals(entry)]));
  }
  return value;
}

async function loadCircuit(fileName) {
  return circomTester.wasm(path.join(__dirname, "..", "..", "circuits", fileName), {
    include: [path.join(__dirname, "..", "..", "node_modules")]
  });
}

function emptyTransferSelectors() {
  return Array.from({ length: MAX_INPUTS }, () =>
    Array.from({ length: K }, () => Array.from({ length: K }, () => 0n))
  );
}

function emptyBlacklistTensor() {
  return Array.from({ length: MAX_INPUTS }, () =>
    Array.from({ length: K }, () => disabledBlacklistWitness())
  );
}

module.exports = {
  DEFAULT_DEPTH,
  K,
  MAX_INPUTS,
  MAX_OUTPUTS,
  T_WINDOW,
  buildBinaryProof,
  buildDeposit,
  buildFixedDepthProof,
  buildBlacklistState,
  buildBlacklistWitness,
  buildNote,
  buildSlotsRoot,
  disabledBlacklistWitness,
  emptyBlacklistTensor,
  emptyTransferSelectors,
  hash1,
  hash2,
  hash3,
  hash4,
  loadCircuit,
  makeSlots,
  normalizeSignals,
  zeroArray
};
