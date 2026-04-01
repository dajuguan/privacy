import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface CircuitArtifacts {
  name: string;
  compileScript: string;
  circuitFile: string;
  buildDir: string;
  r1csPath: string;
  wasmPath: string;
}

export interface CircuitSetupArtifacts extends CircuitArtifacts {
  ptauPath: string;
  dirPath: string;
  initialZkeyPath: string;
  finalZkeyPath: string;
  verificationKeyPath: string;
}

interface RunBinaryOptions {
  quiet?: boolean;
}

const ROOT = path.resolve(__dirname, "..");
const SNARKJS_CLI = path.join(path.dirname(require.resolve("snarkjs")), "cli.cjs");

export const PTAU_POWER = 18;
export const BEACON_ITERATIONS_EXP = "10";
const PTAU_BEACON_HASH = "1111111111111111111111111111111111111111111111111111111111111111";

const SETUP_DIR = path.join(ROOT, "setup");
const GROTH16_DIR = path.join(SETUP_DIR, "groth16");
const POWERS_OF_TAU_DIR = path.join(SETUP_DIR, "powersOfTau");
export const PTAU_FINAL = path.join(POWERS_OF_TAU_DIR, `pot${PTAU_POWER}_final.ptau`);
const CIRCUITS_DIR = path.join(ROOT, "circuits");
export const PROOFS_DIR = path.join(ROOT, "build", "proofs");

export const CIRCUITS = {
  shield_asp: {
    name: "shield_asp",
    compileScript: "compile:shield",
    circuitFile: path.join(CIRCUITS_DIR, "shield_asp.circom"),
    buildDir: path.join(ROOT, "build", "shield_asp"),
    r1csPath: path.join(ROOT, "build", "shield_asp", "shield_asp.r1cs"),
    wasmPath: path.join(ROOT, "build", "shield_asp", "shield_asp_js", "shield_asp.wasm")
  },
  shield_transfer: {
    name: "shield_transfer",
    compileScript: "compile:transfer",
    circuitFile: path.join(CIRCUITS_DIR, "shield_transfer.circom"),
    buildDir: path.join(ROOT, "build", "shield_transfer"),
    r1csPath: path.join(ROOT, "build", "shield_transfer", "shield_transfer.r1cs"),
    wasmPath: path.join(ROOT, "build", "shield_transfer", "shield_transfer_js", "shield_transfer.wasm")
  },
  unshield_poi: {
    name: "unshield_poi",
    compileScript: "compile:unshield",
    circuitFile: path.join(CIRCUITS_DIR, "unshield_poi.circom"),
    buildDir: path.join(ROOT, "build", "unshield_poi"),
    r1csPath: path.join(ROOT, "build", "unshield_poi", "unshield_poi.r1cs"),
    wasmPath: path.join(ROOT, "build", "unshield_poi", "unshield_poi_js", "unshield_poi.wasm")
  }
} as const satisfies Record<string, CircuitArtifacts>;

export type CircuitName = keyof typeof CIRCUITS;

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function getRapidSnarkBin(): string {
  return process.env.RAPIDSNARK_BIN || "rapidsnark";
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listCircomFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCircomFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".circom")) {
      files.push(entryPath);
    }
  }

  return files;
}

function latestSourceMtimeMs(): number {
  return listCircomFiles(CIRCUITS_DIR).reduce((latest, filePath) => {
    return Math.max(latest, fs.statSync(filePath).mtimeMs);
  }, 0);
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function mtimeMs(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}

function isStale(outputPath: string, inputPaths: string[]): boolean {
  if (!fileExists(outputPath)) {
    return true;
  }

  const outputMtime = mtimeMs(outputPath);
  return inputPaths.some((inputPath) => fileExists(inputPath) && mtimeMs(inputPath) > outputMtime);
}

export function runBinary(command: string, args: string[], { quiet = false }: RunBinaryOptions = {}): Buffer {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: quiet ? "pipe" : "inherit"
  });
}

export function runSnarkjs(args: string[], options?: RunBinaryOptions): Buffer {
  return runBinary(process.execPath, [SNARKJS_CLI, ...args], options);
}

function safeUnlink(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function copyFile(sourcePath: string, destinationPath: string): void {
  fs.copyFileSync(sourcePath, destinationPath);
}

function isFinalZkeyUsable(initialZkeyPath: string, finalZkeyPath: string): boolean {
  if (!fileExists(finalZkeyPath)) {
    return false;
  }

  if (!fileExists(initialZkeyPath)) {
    return true;
  }

  return fs.statSync(finalZkeyPath).size >= fs.statSync(initialZkeyPath).size;
}

export function ensureCompiled(circuitName: CircuitName, { quiet = false }: RunBinaryOptions = {}): CircuitArtifacts {
  const circuit = CIRCUITS[circuitName];

  const needsCompile =
    !fileExists(circuit.r1csPath) ||
    !fileExists(circuit.wasmPath) ||
    mtimeMs(circuit.circuitFile) > mtimeMs(circuit.r1csPath) ||
    latestSourceMtimeMs() > mtimeMs(circuit.r1csPath);

  if (needsCompile) {
    runBinary(npmBin(), ["run", circuit.compileScript], { quiet });
  }

  return circuit;
}

export function ensurePtau({ quiet = false }: RunBinaryOptions = {}): string {
  if (fileExists(PTAU_FINAL)) {
    return PTAU_FINAL;
  }

  ensureDir(POWERS_OF_TAU_DIR);

  const ptauInitial = path.join(POWERS_OF_TAU_DIR, `pot${PTAU_POWER}_0000.ptau`);
  const ptauBeacon = path.join(POWERS_OF_TAU_DIR, `pot${PTAU_POWER}_beacon.ptau`);

  safeUnlink(ptauInitial);
  safeUnlink(ptauBeacon);
  safeUnlink(PTAU_FINAL);

  runSnarkjs(["powersoftau", "new", "bn128", String(PTAU_POWER), ptauInitial], { quiet });
  runSnarkjs(["powersoftau", "beacon", ptauInitial, ptauBeacon, PTAU_BEACON_HASH, BEACON_ITERATIONS_EXP], { quiet });
  runSnarkjs(["powersoftau", "prepare", "phase2", ptauBeacon, PTAU_FINAL], { quiet });

  safeUnlink(ptauInitial);
  safeUnlink(ptauBeacon);

  return PTAU_FINAL;
}

function circuitSetupDir(circuitName: CircuitName): string {
  return path.join(GROTH16_DIR, circuitName);
}

export function circuitZkeyPaths(circuitName: CircuitName): {
  dirPath: string;
  initialZkeyPath: string;
  finalZkeyPath: string;
  verificationKeyPath: string;
} {
  const dirPath = circuitSetupDir(circuitName);
  return {
    dirPath,
    initialZkeyPath: path.join(dirPath, `${circuitName}_0000.zkey`),
    finalZkeyPath: path.join(dirPath, `${circuitName}_final.zkey`),
    verificationKeyPath: path.join(dirPath, "verification_key.json")
  };
}

export function ensureCircuitSetup(
  circuitName: CircuitName,
  { quiet = false }: RunBinaryOptions = {}
): CircuitSetupArtifacts {
  const circuit = ensureCompiled(circuitName, { quiet });
  const ptauPath = ensurePtau({ quiet });
  const { dirPath, initialZkeyPath, finalZkeyPath, verificationKeyPath } = circuitZkeyPaths(circuitName);

  ensureDir(dirPath);

  if (isStale(initialZkeyPath, [circuit.r1csPath, ptauPath])) {
    safeUnlink(initialZkeyPath);
    safeUnlink(finalZkeyPath);
    safeUnlink(verificationKeyPath);
    runSnarkjs(["groth16", "setup", circuit.r1csPath, ptauPath, initialZkeyPath], { quiet });
  }

  if (isStale(finalZkeyPath, [initialZkeyPath]) || !isFinalZkeyUsable(initialZkeyPath, finalZkeyPath)) {
    safeUnlink(finalZkeyPath);
    safeUnlink(verificationKeyPath);
    copyFile(initialZkeyPath, finalZkeyPath);
  }

  if (isStale(verificationKeyPath, [finalZkeyPath])) {
    safeUnlink(verificationKeyPath);
    runSnarkjs(["zkey", "export", "verificationkey", finalZkeyPath, verificationKeyPath], { quiet });
  }

  return {
    ...circuit,
    ptauPath,
    dirPath,
    initialZkeyPath,
    finalZkeyPath,
    verificationKeyPath
  };
}

export function ensureAllCircuitSetups({ quiet = false }: RunBinaryOptions = {}): CircuitSetupArtifacts[] {
  return (Object.keys(CIRCUITS) as CircuitName[]).map((circuitName) => ensureCircuitSetup(circuitName, { quiet }));
}

export function ensureRapidSnark(): void {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    runBinary(locator, [getRapidSnarkBin()], { quiet: true });
  } catch {
    throw new Error("rapidsnark was not found in PATH. Set RAPIDSNARK_BIN if it is installed elsewhere.");
  }
}

export function createProofRunDir(circuitName: CircuitName): string {
  ensureDir(PROOFS_DIR);
  return fs.mkdtempSync(path.join(PROOFS_DIR, `${circuitName}-`));
}

export { ROOT };
