import assert from "node:assert/strict";

import { buildNoteWithSlots, buildShieldAspCase, buildShieldTransferCase, buildUnshieldCase } from "../helpers/cases";
import { emptyTransferSelectors, makeSlots } from "../helpers/fixtures";
import { createProof, ensureProofSetups, proveAndVerify, verifyProof } from "../helpers/groth16";

describe("Groth16 Proofs", function (this: Mocha.Suite) {
  this.timeout(1800000);

  before(async function () {
    await ensureProofSetups();
  });

  it("proves and verifies ShieldASP with rapidsnark", async function () {
    const { input } = await buildShieldAspCase();
    const result = await proveAndVerify("shield_asp", input);
    assert.equal(result.verified, true);
  });

  it("proves and verifies ShieldTransfer with rapidsnark", async function () {
    const slots = makeSlots([[11n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 19n, slots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [
        { amount: 10n, ownerCommit: 101n, rho: 31n },
        { amount: 20n, ownerCommit: 202n, rho: 32n }
      ],
      outSlots: slots,
      selectors
    });

    const result = await proveAndVerify("shield_transfer", input);
    assert.equal(result.verified, true);
  });

  it("proves and verifies UnshieldPOI with rapidsnark", async function () {
    const input = await buildUnshieldCase();
    const result = await proveAndVerify("unshield_poi", input);
    assert.equal(result.verified, true);
  });

  it("fails verification after tampering with public signals", async function () {
    const { input } = await buildShieldAspCase();
    const proofBundle = await createProof("shield_asp", input);
    const tamperedPublicSignals = [...(proofBundle.publicSignals as string[])];
    tamperedPublicSignals[0] = (BigInt(tamperedPublicSignals[0]) + 1n).toString();

    const verified = await verifyProof(
      proofBundle.circuit.verificationKeyPath,
      tamperedPublicSignals,
      proofBundle.proof
    );

    assert.equal(verified, false);
  });
});
