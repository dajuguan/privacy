import {
  DEFAULT_DEPTH,
  K,
  MAX_INPUTS,
  MAX_OUTPUTS,
  T_WINDOW,
  buildBinaryProof,
  buildBlacklistWitness,
  buildDeposit,
  buildFixedDepthProof,
  buildNote,
  buildSlotsRoot,
  disabledBlacklistWitness,
  emptyBlacklistTensor,
  hash1,
  hash3,
  hash4,
  makeSlots,
  normalizeSignals,
  zeroArray
} from "./fixtures";
import type { BigNumberish, NormalizedRecord, NoteData, Slots, TransferOutputNote } from "./types";

export interface ShieldAspCase {
  input: NormalizedRecord;
  noteCommit: bigint;
}

export async function buildShieldAspCase({
  depositIndex = 9n,
  amount = 30n,
  ask = 7n,
  depositSecret = 12n,
  blacklistKeys = []
}: {
  depositIndex?: BigNumberish;
  amount?: BigNumberish;
  ask?: BigNumberish;
  depositSecret?: BigNumberish;
  blacklistKeys?: BigNumberish[];
} = {}): Promise<ShieldAspCase> {
  const deposit = await buildDeposit({ depositIndex, amount, ask, depositSecret });
  const depProof = await buildFixedDepthProof(deposit.depLeaf, Number(deposit.depositIndex - 1n), DEFAULT_DEPTH, 0n);
  const blacklistWitness = await buildBlacklistWitness(blacklistKeys, depositIndex, DEFAULT_DEPTH);
  const slots = makeSlots([[depositIndex, 5n]]);
  const sourcesRoot = await buildSlotsRoot(slots.srcIds, slots.enterEpochs);
  const noteCommit = await hash4(amount, await hash1(ask), depositSecret, sourcesRoot);

  return {
    input: normalizeSignals({
      root_dep: depProof.root,
      root_blk: blacklistWitness.root!,
      e_shield: 5n,
      noteCommit,
      depositIndex,
      amount,
      depositSecret,
      ask,
      path_dep_siblings: depProof.siblings,
      path_dep_indices: depProof.pathIndices,
      blk_low_leaf_key: blacklistWitness.lowLeafKey,
      blk_low_leaf_next_key: blacklistWitness.lowLeafNextKey,
      blk_path_siblings: blacklistWitness.siblings,
      blk_path_indices: blacklistWitness.pathIndices
    }) as NormalizedRecord,
    noteCommit
  };
}

export async function buildNoteWithSlots({
  amount,
  ask,
  rho,
  slots
}: {
  amount: BigNumberish;
  ask: BigNumberish;
  rho: BigNumberish;
  slots: Slots;
}): Promise<NoteData> {
  return buildNote({ amount, ask, rho, srcIds: slots.srcIds, enterEpochs: slots.enterEpochs });
}

export async function buildShieldTransferCase({
  inputNotes,
  outputNotes,
  outSlots,
  eTx = 5n,
  blacklistKeys = [],
  selectors
}: {
  inputNotes: NoteData[];
  outputNotes: TransferOutputNote[];
  outSlots: Slots;
  eTx?: BigNumberish;
  blacklistKeys?: BigNumberish[];
  selectors: bigint[][][];
}): Promise<NormalizedRecord> {
  const noteLeaves = zeroArray(1 << DEFAULT_DEPTH, 0n);
  const proofs = [];

  for (let index = 0; index < inputNotes.length; index += 1) {
    noteLeaves[index] = inputNotes[index].noteCommit;
  }

  for (let index = 0; index < inputNotes.length; index += 1) {
    proofs.push(await buildBinaryProof(noteLeaves, index));
  }

  const rootNote = proofs[0].root;
  const blacklistRoot = (await buildBlacklistWitness(blacklistKeys, 1n, DEFAULT_DEPTH)).root!;
  const outputSourcesRoot = await buildSlotsRoot(outSlots.srcIds, outSlots.enterEpochs);
  const nmTensor = emptyBlacklistTensor();

  for (let inputIndex = 0; inputIndex < MAX_INPUTS; inputIndex += 1) {
    for (let slotIndex = 0; slotIndex < K; slotIndex += 1) {
      if (inputIndex < inputNotes.length && inputNotes[inputIndex].srcIds[slotIndex] !== 0n) {
        nmTensor[inputIndex][slotIndex] = await buildBlacklistWitness(
          blacklistKeys,
          inputNotes[inputIndex].srcIds[slotIndex],
          DEFAULT_DEPTH
        );
      }
    }
  }

  const amountIn = zeroArray(MAX_INPUTS);
  const rhoIn = zeroArray(MAX_INPUTS);
  const askIn = zeroArray(MAX_INPUTS);
  const inSrcIds = Array.from({ length: MAX_INPUTS }, () => zeroArray(K));
  const inEnterEpochs = Array.from({ length: MAX_INPUTS }, () => zeroArray(K));
  const notePathSiblings = Array.from({ length: MAX_INPUTS }, () => zeroArray(DEFAULT_DEPTH));
  const notePathIndices = Array.from({ length: MAX_INPUTS }, () => zeroArray(DEFAULT_DEPTH));
  const inUsed = zeroArray(MAX_INPUTS);
  const nf = zeroArray(MAX_INPUTS);

  for (let inputIndex = 0; inputIndex < inputNotes.length; inputIndex += 1) {
    inUsed[inputIndex] = 1n;
    amountIn[inputIndex] = inputNotes[inputIndex].amount;
    rhoIn[inputIndex] = inputNotes[inputIndex].rho;
    askIn[inputIndex] = inputNotes[inputIndex].ask;
    inSrcIds[inputIndex] = [...inputNotes[inputIndex].srcIds];
    inEnterEpochs[inputIndex] = [...inputNotes[inputIndex].enterEpochs];
    notePathSiblings[inputIndex] = [...proofs[inputIndex].siblings];
    notePathIndices[inputIndex] = [...proofs[inputIndex].pathIndices];
    nf[inputIndex] = inputNotes[inputIndex].nf;
  }

  const amountOut = zeroArray(MAX_OUTPUTS);
  const ownerCommitOut = zeroArray(MAX_OUTPUTS);
  const rhoOut = zeroArray(MAX_OUTPUTS);
  const outUsed = zeroArray(MAX_OUTPUTS);
  const noteCommitOut = zeroArray(MAX_OUTPUTS);

  for (let outputIndex = 0; outputIndex < outputNotes.length; outputIndex += 1) {
    outUsed[outputIndex] = 1n;
    amountOut[outputIndex] = BigInt(outputNotes[outputIndex].amount);
    ownerCommitOut[outputIndex] = BigInt(outputNotes[outputIndex].ownerCommit);
    rhoOut[outputIndex] = BigInt(outputNotes[outputIndex].rho);
    noteCommitOut[outputIndex] = await hash4(
      outputNotes[outputIndex].amount,
      outputNotes[outputIndex].ownerCommit,
      outputNotes[outputIndex].rho,
      outputSourcesRoot
    );
  }

  return normalizeSignals({
    root_note: rootNote,
    root_blk: blacklistRoot,
    e_tx: eTx,
    inUsed,
    outUsed,
    nf,
    noteCommitOut,
    amountIn,
    rhoIn,
    askIn,
    inSrcIds,
    inEnterEpochs,
    notePathSiblings,
    notePathIndices,
    amountOut,
    ownerCommitOut,
    rhoOut,
    outSrcIds: outSlots.srcIds,
    outEnterEpochs: outSlots.enterEpochs,
    sel: selectors,
    nmLowLeafKey: nmTensor.map((row) => row.map((entry) => entry.lowLeafKey)),
    nmLowLeafNextKey: nmTensor.map((row) => row.map((entry) => entry.lowLeafNextKey)),
    nmPathSiblings: nmTensor.map((row) => row.map((entry) => entry.siblings)),
    nmPathIndices: nmTensor.map((row) => row.map((entry) => entry.pathIndices))
  }) as NormalizedRecord;
}

export async function buildUnshieldCase({
  amount = 30n,
  ask = 7n,
  rho = 50n,
  recipient = 901n,
  slots = makeSlots([[21n, 0n]]),
  blacklistKeys = [],
  eNow = 10n
}: {
  amount?: BigNumberish;
  ask?: BigNumberish;
  rho?: BigNumberish;
  recipient?: BigNumberish;
  slots?: Slots;
  blacklistKeys?: BigNumberish[];
  eNow?: BigNumberish;
} = {}): Promise<NormalizedRecord> {
  const note = await buildNote({ amount, ask, rho, srcIds: slots.srcIds, enterEpochs: slots.enterEpochs });
  const noteProof = await buildFixedDepthProof(note.noteCommit, 0, DEFAULT_DEPTH, 0n);
  const withdrawCommit = await hash3(amount, recipient, note.nf);

  const witnesses = Array.from({ length: K }, () => disabledBlacklistWitness());
  for (let index = 0; index < K; index += 1) {
    if (slots.srcIds[index] !== 0n) {
      witnesses[index] = await buildBlacklistWitness(blacklistKeys, slots.srcIds[index], DEFAULT_DEPTH);
    }
  }

  return normalizeSignals({
    root_note: noteProof.root,
    root_blk: (await buildBlacklistWitness(blacklistKeys, 1n, DEFAULT_DEPTH)).root!,
    e_now: eNow,
    nf: note.nf,
    withdrawCommit,
    amount,
    rho,
    ask,
    recipient,
    srcIds: slots.srcIds,
    enterEpochs: slots.enterEpochs,
    notePathSiblings: noteProof.siblings,
    notePathIndices: noteProof.pathIndices,
    nmLowLeafKey: witnesses.map((entry) => entry.lowLeafKey),
    nmLowLeafNextKey: witnesses.map((entry) => entry.lowLeafNextKey),
    nmPathSiblings: witnesses.map((entry) => entry.siblings),
    nmPathIndices: witnesses.map((entry) => entry.pathIndices)
  }) as NormalizedRecord;
}

export { T_WINDOW };
