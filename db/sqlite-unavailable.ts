/**
 * MySQL production deployments never initialize SQLite.  This lightweight
 * module lets constrained build images omit the native SQLite driver while
 * preserving the normal local-development dependency.
 */
export default class SQLiteUnavailable {
  constructor() {
    throw new Error("SQLite is unavailable in this MySQL deployment.");
  }
}
