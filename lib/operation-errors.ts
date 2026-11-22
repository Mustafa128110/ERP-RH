// Explicit, user-correctable business refusals. Unexpected errors stay private.
export class OperationError extends Error {
  constructor(message: string) { super(message); this.name = "OperationError"; }
}
