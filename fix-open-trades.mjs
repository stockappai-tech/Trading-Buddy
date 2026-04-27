import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await mysql.createConnection(url);

// Fix trades that have exitPrice set but status still 'open'
const [result] = await conn.execute(
  `UPDATE trades SET status='closed', closedAt=COALESCE(closedAt, NOW()) WHERE status='open' AND exitPrice IS NOT NULL AND TRIM(exitPrice) != ''`
);
console.log('Rows fixed:', result.affectedRows);

// Verify no bad rows remain
const [rows] = await conn.execute(
  `SELECT COUNT(*) AS bad FROM trades WHERE status='open' AND exitPrice IS NOT NULL AND TRIM(exitPrice) != ''`
);
console.log('Remaining bad rows:', rows[0].bad);

await conn.end();
