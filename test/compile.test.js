const { execSync } = require("node:child_process");

describe("Compile Scripts", function () {
  this.timeout(300000);

  it("compiles all top-level circuits", function () {
    execSync("npm run compile:all", {
      cwd: process.cwd(),
      stdio: "pipe"
    });
  });
});
