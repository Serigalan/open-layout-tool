/** A refusal with an `error` code the browser translates. */
export class ApiError extends Error {
  constructor(status, error, extra = {}) {
    super(error)
    this.status = status
    this.error = error
    this.extra = extra
  }
}
