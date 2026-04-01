# privacy

Retained-slot strict POI circuits implemented with Circom and `circomlib`.

## Prerequisites

- `circom` 2.2.3
- Node.js and npm

### rapidsnark
```sh
VER=v0.0.8

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) PKG="rapidsnark-linux-x86_64-$VER.zip" ;;
  Linux/aarch64|Linux/arm64) PKG="rapidsnark-linux-arm64-$VER.zip" ;;
  Darwin/arm64) PKG="rapidsnark-macOS-arm64-$VER.zip" ;;
  Darwin/x86_64) PKG="rapidsnark-macOS-x86_64-$VER.zip" ;;
  *) echo "unsupported platform"; exit 1 ;;
esac

curl -LO "https://github.com/iden3/rapidsnark/releases/download/$VER/$PKG"
unzip "$PKG"

DIR="${PKG%.zip}"
sudo install -m 755 "$DIR/bin/prover" /usr/local/bin/rapidsnark
```

## Install

```bash
npm install
```

## Compile

```bash
npm run compile:shield
npm run compile:transfer
npm run compile:unshield
npm run compile:all
```

The current PoC mains use fixed parameters:

- `D_DEP = 4`: binary deposit-tree depth
- `D_NOTE = 4`: binary note-tree depth
- `D_BLK = 4`: indexed blacklist-tree depth
- `K = 16`, `MAX_INPUTS = 2`, `MAX_OUTPUTS = 2`

For the binary trees, depth `4` means each fixed tree shape has `2^4 = 16`
leaf positions.

## Witness Tests

```bash
npm test
```

## Groth16 Setup

The Groth16 setup cache lives under `setup/` and is generated lazily when missing.

```bash
npm run setup:ptau
npm run setup:zkeys
```

Artifacts are cached at:

- `setup/powersOfTau/pot18_final.ptau`
- `setup/groth16/shield_asp/`
- `setup/groth16/shield_transfer/`
- `setup/groth16/unshield_poi/`

### Circuits info

```
snarkjs r1cs info build/shield_asp/shield_asp.r1cs
snarkjs r1cs info build/shield_transfer/shield_transfer.r1cs
snarkjs r1cs info build/unshield_poi/unshield_poi.r1cs
```

## Proof Tests

Proof generation uses `rapidsnark`, while setup and verification use `snarkjs`.

```bash
npm run test:proof
npm run test:all
```

Transient witness and proof outputs are written under `build/proofs/`.
