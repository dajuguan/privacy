const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SNARKJS_CLI = path.join(path.dirname(require.resolve("snarkjs")), "cli.cjs");

const PTAU_POWER = 18;
const PTAU_BEACON_HASH = "1111111111111111111111111111111111111111111111111111111111111111";
const BEACON_ITERATIONS_EXP = "10";

const SETUP_DIR = path.join(ROOT, "setup");
const GROTH16_DIR = path.join(SETUP_DIR, "groth16");
const POWERS_OF_TAU_DIR = path.join(SETUP_DIR, "powersOfTau");
const PTAU_FINAL = path.join(POWERS_OF_TAU_DIR, `pot${PTAU_POWER}_final.ptau`);
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const PROOFS_DIR = path.join(ROOT, "build", "proofs");

const CIRCUITS = {
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
};

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getRapidSnarkBin() {
  return process.env.RAPIDSNARK_BIN || "rapidsnark";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listCircomFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

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

function latestSourceMtimeMs() {
  return listCircomFiles(CIRCUITS_DIR).reduce((latest, filePath) => {
    return Math.max(latest, fs.statSync(filePath).mtimeMs);
  }, 0);
}

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function mtimeMs(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

function isStale(outputPath, inputPaths) {
  if (!fileExists(outputPath)) {
    return true;
  }

  const outputMtime = mtimeMs(outputPath);
  return inputPaths.some((inputPath) => fileExists(inputPath) && mtimeMs(inputPath) > outputMtime);
}

function runBinary(command, args, { quiet = false } = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: quiet ? "pipe" : "inherit"
  });
}

function runSnarkjs(args, options) {
  return runBinary(process.execPath, [SNARKJS_CLI, ...args], options);
}

function safeUnlink(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function copyFile(sourcePath, destinationPath) {
  fs.copyFileSync(sourcePath, destinationPath);
}

function isFinalZkeyUsable(initialZkeyPath, finalZkeyPath) {
  if (!fileExists(finalZkeyPath)) {
    return false;
  }

  if (!fileExists(initialZkeyPath)) {
    return true;
  }

  return fs.statSync(finalZkeyPath).size >= fs.statSync(initialZkeyPath).size;
}

function ensureCompiled(circuitName, { quiet = false } = {}) {
  const circuit = CIRCUITS[circuitName];
  if (!circuit) {
    throw new Error(`Unknown circuit: ${circuitName}`);
  }

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

function ensurePtau({ quiet = false } = {}) {
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

function circuitSetupDir(circuitName) {
  return path.join(GROTH16_DIR, circuitName);
}

function circuitZkeyPaths(circuitName) {
  const dirPath = circuitSetupDir(circuitName);
  return {
    dirPath,
    initialZkeyPath: path.join(dirPath, `${circuitName}_0000.zkey`),
    finalZkeyPath: path.join(dirPath, `${circuitName}_final.zkey`),
    verificationKeyPath: path.join(dirPath, "verification_key.json")
  };
}

function ensureCircuitSetup(circuitName, { quiet = false } = {}) {
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

function ensureAllCircuitSetups({ quiet = false } = {}) {
  return Object.keys(CIRCUITS).map((circuitName) => ensureCircuitSetup(circuitName, { quiet }));
}

function ensureRapidSnark() {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    runBinary(locator, [getRapidSnarkBin()], { quiet: true });
  } catch (error) {
    throw new Error("rapidsnark was not found in PATH. Set RAPIDSNARK_BIN if it is installed elsewhere.");
  }
}

function createProofRunDir(circuitName) {
  ensureDir(PROOFS_DIR);
  return fs.mkdtempSync(path.join(PROOFS_DIR, `${circuitName}-`));
}

module.exports = {
  BEACON_ITERATIONS_EXP,
  CIRCUITS,
  PROOFS_DIR,
  PTAU_FINAL,
  PTAU_POWER,
  ROOT,
  circuitZkeyPaths,
  createProofRunDir,
  ensureAllCircuitSetups,
  ensureCircuitSetup,
  ensureCompiled,
  ensurePtau,
  ensureRapidSnark,
  getRapidSnarkBin,
  runBinary,
  runSnarkjs
};
