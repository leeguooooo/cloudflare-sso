/** Runs a schema step once per database binding (per isolate); a failure is retried next time. */
export const oncePerDb = (step: (db: D1Database) => Promise<void>) => {
  const done = new WeakMap<D1Database, Promise<void>>()
  return (db: D1Database) => {
    let pending = done.get(db)
    if (!pending) {
      pending = step(db).catch((error) => {
        done.delete(db)
        throw error
      })
      done.set(db, pending)
    }
    return pending
  }
}
