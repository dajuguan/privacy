declare module "circom_tester" {
  export interface CircomWasmTester {
    calculateWitness(input: unknown, sanityCheck?: boolean): Promise<unknown>;
  }

  const circomTester: {
    wasm(
      circuitPath: string,
      options?: {
        include?: string[];
      }
    ): Promise<CircomWasmTester>;
  };

  export = circomTester;
}

declare module "circomlibjs" {
  export interface PoseidonField {
    toObject(value: unknown): bigint;
  }

  export interface PoseidonInstance {
    (inputs: bigint[]): unknown;
    F: PoseidonField;
  }

  export function buildPoseidon(): Promise<PoseidonInstance>;
}
