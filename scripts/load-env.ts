// Side-effect import: loads `.env` into process.env for the tooling configs and
// scripts that run outside Next (which loads its own). Import it first, before
// anything that reads the environment.
//
// A variable already set in the shell wins over the file. DOTENV_CONFIG_PATH
// points elsewhere — a worktree has no .env of its own, so it borrows the main
// checkout's. A missing file is a no-op: CI and worktrees simply have none.
try {
  process.loadEnvFile(process.env.DOTENV_CONFIG_PATH ?? '.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
