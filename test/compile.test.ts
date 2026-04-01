import { execSync } from "node:child_process";

describe("Compile Scripts", function (this: Mocha.Suite) {
  this.timeout(300000);

  it("compiles all top-level circuits", function (): void {
    execSync("npm run compile:all", {
      cwd: process.cwd(),
      stdio: "pipe"
    });
  });
});
