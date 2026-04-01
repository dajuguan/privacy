export type BigNumberish = bigint | number | string;

export type SignalInput =
  | bigint
  | number
  | string
  | boolean
  | null
  | SignalInput[]
  | { [key: string]: SignalInput };

export type NormalizedSignal =
  | string
  | number
  | boolean
  | null
  | NormalizedSignal[]
  | { [key: string]: NormalizedSignal };

export type NormalizedRecord = Record<string, NormalizedSignal>;

export interface Slots {
  srcIds: bigint[];
  enterEpochs: bigint[];
}

export interface BinaryProof {
  root: bigint;
  siblings: bigint[];
  pathIndices: bigint[];
}

export interface NoteData {
  amount: bigint;
  ask: bigint;
  rho: bigint;
  ownerCommit: bigint;
  sourcesRoot: bigint;
  noteCommit: bigint;
  nf: bigint;
  srcIds: bigint[];
  enterEpochs: bigint[];
}

export interface DepositData {
  depositIndex: bigint;
  amount: bigint;
  ask: bigint;
  ownerCommit: bigint;
  depositSecret: bigint;
  depLeaf: bigint;
}

export interface BlacklistState {
  root: bigint;
  pairs: Array<[bigint, bigint]>;
  leaves: bigint[];
}

export interface BlacklistWitness {
  root?: bigint;
  lowLeafKey: bigint;
  lowLeafNextKey: bigint;
  siblings: bigint[];
  pathIndices: bigint[];
}

export interface TransferOutputNote {
  amount: BigNumberish;
  ownerCommit: BigNumberish;
  rho: BigNumberish;
}
