import { spawn } from "node:child_process";
if (process.env.DATABASE_URL) throw new Error("Quite DATABASE_URL para iniciar desarrollo local.");
const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: "inherit", env: { ...process.env, ROOTMINT_LOCAL: "1", PORT: "4310", HOST: "127.0.0.1" },
});
child.on("exit", code => process.exit(code ?? 1));
