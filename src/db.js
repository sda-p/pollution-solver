import { Pool } from "pg";

function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || "5432"),
    database: process.env.PGDATABASE || "pollution_solver",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
  };
}

export const pool = new Pool(buildConnectionConfig());
