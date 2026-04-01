import * as path from "node:path";

import circomTester = require("circom_tester");
import * as circomlibjs from "circomlibjs";

import type {
  BigNumberish,
  BinaryProof,
  BlacklistState,
  BlacklistWitness,
  DepositData,
  NormalizedRecord,
  NormalizedSignal,
  NoteData,
  SignalInput,
  Slots
} from "./types";

export const DEFAULT_DEPTH = 4;
export const K = 16;
export const MAX_INPUTS = 2;
export const MAX_OUTPUTS = 2;
export const T_WINDOW = 4n;
const MAX_U64 = (1n << 64n) - 1n;

let poseidonInstance: circomlibjs.PoseidonInstance | undefined;

async function getPoseidon(): Promise<circomlibjs.PoseidonInstance> {
  if (!poseidonInstance) {
    poseidonInstance = await circomlibjs.buildPoseidon();
  }
  return poseidonInstance;
}

async function poseidonHash(inputs: BigNumberish[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  return poseidon.F.toObject(poseidon(inputs.map((value) => BigInt(value))));
}

export async function hash1(a: BigNumberish): Promise<bigint> {
  return poseidonHash([a]);
}

export async function hash2(a: BigNumberish, b: BigNumberish): Promise<bigint> {
  return poseidonHash([a, b]);
}

export async function hash3(a: BigNumberish, b: BigNumberish, c: BigNumberish): Promise<bigint> {
  return poseidonHash([a, b, c]);
}

export async function hash4(a: BigNumberish, b: BigNumberish, c: BigNumberish, d: BigNumberish): Promise<bigint> {
  return poseidonHash([a, b, c, d]);
}

export function zeroArray(length: number, value: BigNumberish = 0n): bigint[] {
  return Array.from({ length }, () => BigInt(value));
}

export function makeSlots(entries: Array<[BigNumberish, BigNumberish]>, size = K): Slots {
  const srcIds = zeroArray(size);
  const enterEpochs = zeroArray(size);

  entries.forEach(([srcId, enterEpoch], index) => {
    srcIds[index] = BigInt(srcId);
    enterEpochs[index] = BigInt(enterEpoch);
  });

  return { srcIds, enterEpochs };
}

async function buildBinaryLevels(leaves: BigNumberish[]): Promise<bigint[][]> {
  const levels: bigint[][] = [leaves.map((leaf) => BigInt(leaf))];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: bigint[] = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(await hash2(current[index], current[index + 1]));
    }
    levels.push(next);
  }
  return levels;
}

export async function buildBinaryProof(leaves: BigNumberish[], index: number): Promise<BinaryProof> {
  const levels = await buildBinaryLevels(leaves);
  const siblings: bigint[] = [];
  const pathIndices: bigint[] = [];
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

export async function buildFixedDepthProof(
  leaf: BigNumberish,
  index: number,
  depth: number,
  emptyLeaf: BigNumberish = 0n
): Promise<BinaryProof> {
  const leaves = zeroArray(1 << depth, emptyLeaf);
  leaves[index] = BigInt(leaf);
  return buildBinaryProof(leaves, index);
}

export async function buildSlotsRoot(srcIds: BigNumberish[], enterEpochs: BigNumberish[]): Promise<bigint> {
  const leaves: bigint[] = [];
  for (let index = 0; index < srcIds.length; index += 1) {
    leaves.push(await hash2(srcIds[index], enterEpochs[index]));
  }
  const proof = await buildBinaryProof(leaves, 0);
  return proof.root;
}

export async function buildNote({
  amount,
  ask,
  rho,
  srcIds,
  enterEpochs
}: {
  amount: BigNumberish;
  ask: BigNumberish;
  rho: BigNumberish;
  srcIds: BigNumberish[];
  enterEpochs: BigNumberish[];
}): Promise<NoteData> {
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

export async function buildDeposit({
  depositIndex,
  amount,
  ask,
  depositSecret
}: {
  depositIndex: BigNumberish;
  amount: BigNumberish;
  ask: BigNumberish;
  depositSecret: BigNumberish;
}): Promise<DepositData> {
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

export async function buildBlacklistState(keys: BigNumberish[], depth: number): Promise<BlacklistState> {
  const sortedKeys = [...new Set(keys.map((key) => BigInt(key)))].sort((a, b) => (a < b ? -1 : 1));
  const pairs: Array<[bigint, bigint]> = [];

  if (sortedKeys.length === 0) {
    pairs.push([0n, MAX_U64]);
  } else {
    pairs.push([0n, sortedKeys[0]]);
    for (let index = 0; index < sortedKeys.length; index += 1) {
      pairs.push([sortedKeys[index], index + 1 < sortedKeys.length ? sortedKeys[index + 1] : MAX_U64]);
    }
  }

  const emptyLeaf = await hash2(0n, 0n);
  const leaves = zeroArray(1 << depth, emptyLeaf);

  for (let index = 0; index < pairs.length; index += 1) {
    leaves[index] = await hash2(pairs[index][0], pairs[index][1]);
  }

  const root = (await buildBinaryProof(leaves, 0)).root;
  return { root, pairs, leaves };
}

export async function buildBlacklistWitness(
  keys: BigNumberish[],
  srcId: BigNumberish,
  depth = DEFAULT_DEPTH
): Promise<BlacklistWitness> {
  const state = await buildBlacklistState(keys, depth);
  let pairIndex = 0;

  for (let index = 0; index < state.pairs.length; index += 1) {
    if (state.pairs[index][0] < BigInt(srcId)) {
      pairIndex = index;
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

export function disabledBlacklistWitness(depth = DEFAULT_DEPTH): BlacklistWitness {
  return {
    lowLeafKey: 0n,
    lowLeafNextKey: 0n,
    siblings: zeroArray(depth),
    pathIndices: zeroArray(depth)
  };
}

export function normalizeSignals(value: SignalInput): NormalizedSignal {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSignals);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeSignals(entry as SignalInput)])
    ) as NormalizedRecord;
  }
  return value;
}

export async function loadCircuit(fileName: string): Promise<circomTester.CircomWasmTester> {
  return circomTester.wasm(path.join(__dirname, "..", "..", "circuits", fileName), {
    include: [path.join(__dirname, "..", "..", "node_modules")]
  });
}

export function emptyTransferSelectors(): bigint[][][] {
  return Array.from({ length: MAX_INPUTS }, () =>
    Array.from({ length: K }, () => Array.from({ length: K }, () => 0n))
  );
}

export function emptyBlacklistTensor(): BlacklistWitness[][] {
  return Array.from({ length: MAX_INPUTS }, () =>
    Array.from({ length: K }, () => disabledBlacklistWitness())
  );
}
