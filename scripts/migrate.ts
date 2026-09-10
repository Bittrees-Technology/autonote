import { pool, schema } from "../lib/db";
await pool().query(schema);
await pool().end();
console.log("AutoNote database ready.");
