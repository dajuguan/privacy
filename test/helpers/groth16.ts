import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeSignals } from "./fixtures";
import {
  PROOFS_DIR,
  createProofRunDir,
  ensureAllCircuitSetups,
  ensureCircuitSetup,
  ensureRapidSnark,
  getRapidSnarkBin,
  runBinary,
  runSnarkjs
} from "../../scripts/groth16";
import type { CircuitName, CircuitSetupArtifacts } from "../../scripts/groth16";
import type { NormalizedSignal, SignalInput } from "./types";

export interface ProofBundle {
  circuit: CircuitSetupArtifacts;
  runDir: string;
  inputPath: string;
  witnessPath: string;
  proofPath: string;
  publicPath: string;
  proof: NormalizedSignal;
  publicSignals: NormalizedSignal;
}

function writeJson(filePath: string, value: SignalInput | NormalizedSignal): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createVerifyRunDir(): string {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(PROOFS_DIR, "verify-"));
}

export async function createProof(circuitName: CircuitName, input: SignalInput): Promise<ProofBundle> {
  ensureRapidSnark();
  const circuit = ensureCircuitSetup(circuitName, { quiet: true });
  const runDir = createProofRunDir(circuitName);
  const inputPath = path.join(runDir, "input.json");
  const witnessPath = path.join(runDir, "witness.wtns");
  const proofPath = path.join(runDir, "proof.json");
  const publicPath = path.join(runDir, "public.json");

  writeJson(inputPath, normalizeSignals(input));

  runSnarkjs(["wtns", "calculate", circuit.wasmPath, inputPath, witnessPath], { quiet: true });
  runBinary(getRapidSnarkBin(), [circuit.finalZkeyPath, witnessPath, proofPath, publicPath], { quiet: true });

  return {
    circuit,
    runDir,
    inputPath,
    witnessPath,
    proofPath,
    publicPath,
    proof: JSON.parse(fs.readFileSync(proofPath, "utf8")) as NormalizedSignal,
    publicSignals: JSON.parse(fs.readFileSync(publicPath, "utf8")) as NormalizedSignal
  };
}

export async function verifyProof(
  verificationKeyPath: string,
  publicSignals: SignalInput | NormalizedSignal,
  proof: SignalInput | NormalizedSignal
): Promise<boolean> {
  const runDir = createVerifyRunDir();
  const publicPath = path.join(runDir, "public.json");
  const proofPath = path.join(runDir, "proof.json");

  writeJson(publicPath, normalizeSignals(publicSignals as SignalInput));
  writeJson(proofPath, normalizeSignals(proof as SignalInput));

  try {
    runSnarkjs(["groth16", "verify", verificationKeyPath, publicPath, proofPath], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export async function proveAndVerify(circuitName: CircuitName, input: SignalInput): Promise<ProofBundle & { verified: boolean }> {
  const proofBundle = await createProof(circuitName, input);
  const verified = await verifyProof(proofBundle.circuit.verificationKeyPath, proofBundle.publicSignals, proofBundle.proof);
  return { ...proofBundle, verified };
}

export async function ensureProofSetups(): Promise<void> {
  ensureRapidSnark();
  ensureAllCircuitSetups({ quiet: true });
}
