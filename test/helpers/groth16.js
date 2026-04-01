const fs = require("node:fs");
const path = require("node:path");

const { normalizeSignals } = require("./fixtures");
const {
  PROOFS_DIR,
  createProofRunDir,
  ensureAllCircuitSetups,
  ensureCircuitSetup,
  ensureRapidSnark,
  getRapidSnarkBin,
  runBinary,
  runSnarkjs
} = require("../../scripts/groth16");

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createVerifyRunDir() {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(PROOFS_DIR, "verify-"));
}

async function createProof(circuitName, input) {
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
    proof: JSON.parse(fs.readFileSync(proofPath, "utf8")),
    publicSignals: JSON.parse(fs.readFileSync(publicPath, "utf8"))
  };
}

async function verifyProof(verificationKeyPath, publicSignals, proof) {
  const runDir = createVerifyRunDir();
  const publicPath = path.join(runDir, "public.json");
  const proofPath = path.join(runDir, "proof.json");

  writeJson(publicPath, normalizeSignals(publicSignals));
  writeJson(proofPath, normalizeSignals(proof));

  try {
    runSnarkjs(["groth16", "verify", verificationKeyPath, publicPath, proofPath], { quiet: true });
    return true;
  } catch (error) {
    return false;
  }
}

async function proveAndVerify(circuitName, input) {
  const proofBundle = await createProof(circuitName, input);
  const verified = await verifyProof(proofBundle.circuit.verificationKeyPath, proofBundle.publicSignals, proofBundle.proof);
  return { ...proofBundle, verified };
}

async function ensureProofSetups() {
  ensureRapidSnark();
  ensureAllCircuitSetups({ quiet: true });
}

module.exports = {
  createProof,
  ensureProofSetups,
  proveAndVerify,
  verifyProof
};
