pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

// Small reusable gates used across the protocol-specific gadgets.

template AssertBit() {
    // Value that must be constrained to {0, 1}.
    signal input in;

    in * (in - 1) === 0;
}

template RangeCheck(n) {
    // Field element that must fit into n bits.
    signal input in;

    component n2b = Num2Bits(n);
    n2b.in <== in;
}

template EnforceZeroIfDisabled() {
    // Boolean gate that decides whether the value must be zero.
    signal input enabled;
    // Value that is forced to zero when enabled = 0.
    signal input value;

    // enabled = 0 forces value = 0.
    (1 - enabled) * value === 0;
}

template EnforceEqualIfEnabled() {
    // Boolean gate that decides whether equality must hold.
    signal input enabled;
    // Left-hand side of the gated equality.
    signal input left;
    // Right-hand side of the gated equality.
    signal input right;

    // enabled = 1 forces left = right.
    enabled * (left - right) === 0;
}

template AssertNonZero() {
    // Value that must be proven non-zero.
    signal input in;

    component isZero = IsZero();
    isZero.in <== in;
    isZero.out === 0;
}
