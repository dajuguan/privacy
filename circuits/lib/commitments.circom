pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/poseidon.circom";

// Commitment helpers used by the v1 POI circuits.
// The field ordering matches the formulas in spec_poi.md.

template OwnerCommit() {
    // Account secret used to derive the note owner commitment.
    signal input ask;
    signal output out;

    component hash = Poseidon(1);
    hash.inputs[0] <== ask;
    out <== hash.out;
}

template DepositLeaf() {
    // Public deposit identifier that serves as the initial source id.
    signal input depositIndex;
    // Deposited amount carried into the private note.
    signal input amount;
    // Commitment to the private owner secret.
    signal input ownerCommit;
    // Deposit randomness; in v1 it is also reused as rho after shielding.
    signal input depositSecret;
    signal output out;

    component hash = Poseidon(4);
    hash.inputs[0] <== depositIndex;
    hash.inputs[1] <== amount;
    hash.inputs[2] <== ownerCommit;
    hash.inputs[3] <== depositSecret;
    out <== hash.out;
}

template SourceLeaf() {
    // Protocol-entry source identifier stored in one retained slot.
    signal input srcId;
    // Epoch when srcId entered the protocol.
    signal input enterEpoch;
    signal output out;

    // Each retained source slot is committed as H(srcId, enterEpoch).
    component hash = Poseidon(2);
    hash.inputs[0] <== srcId;
    hash.inputs[1] <== enterEpoch;
    out <== hash.out;
}

template NoteCommit() {
    // Note value.
    signal input amount;
    // Commitment to the recipient/owner secret.
    signal input ownerCommit;
    // Note randomness used by nullifier derivation.
    signal input rho;
    // Merkle root of the K retained source slots.
    signal input sourcesRoot;
    signal output out;

    // A note binds amount, owner, rho, and the full retained source state.
    component hash = Poseidon(4);
    hash.inputs[0] <== amount;
    hash.inputs[1] <== ownerCommit;
    hash.inputs[2] <== rho;
    hash.inputs[3] <== sourcesRoot;
    out <== hash.out;
}

template Nullifier() {
    // Account secret authorizing the spend.
    signal input ask;
    // Note randomness being nullified.
    signal input rho;
    signal output out;

    component hash = Poseidon(2);
    hash.inputs[0] <== ask;
    hash.inputs[1] <== rho;
    out <== hash.out;
}

template WithdrawCommit() {
    // Withdrawn amount.
    signal input amount;
    // Public withdrawal recipient encoded as a field element.
    signal input recipient;
    // Nullifier of the withdrawn note.
    signal input nf;
    signal output out;

    component hash = Poseidon(3);
    hash.inputs[0] <== amount;
    hash.inputs[1] <== recipient;
    hash.inputs[2] <== nf;
    out <== hash.out;
}

template BlacklistLeaf() {
    // Predecessor key in the indexed blacklist leaf.
    signal input lowLeafKey;
    // Successor key in the indexed blacklist leaf.
    signal input lowLeafNextKey;
    signal output out;

    // Indexed blacklist leaves store predecessor intervals.
    component hash = Poseidon(2);
    hash.inputs[0] <== lowLeafKey;
    hash.inputs[1] <== lowLeafNextKey;
    out <== hash.out;
}
