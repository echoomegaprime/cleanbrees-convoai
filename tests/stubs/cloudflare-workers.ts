// Minimal stand-in for the Workers runtime module `cloudflare:workers`, so the
// unit tests can import src/index.ts under Node. Only WorkerEntrypoint is used.
export class WorkerEntrypoint<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
