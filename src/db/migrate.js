const fs = require("fs");
const path = require("path");
const pool = require("./pool");
const logger = require("../utils/logger");

async function migrate() {
  const client = await pool.connect();
  try {
    const migrationsDir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      logger.info("Running migration", { file });
      await client.query(sql);
    }
    logger.info("Migrations complete");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  logger.error("Migration failed", { error: error.message });
  process.exit(1);
});
