'use strict';
// scripts/fix_requester_fk.js
// Drops broken FOREIGN KEY constraints from every active unit DB:
//   1. visit_requests(requester_user_id)  → requester may be from another unit DB
//   2. approval_history(acted_by_user_id) → actor may be from another unit DB

const { centralPool, getPool } = require('../services/dbManager');

async function dropFkIfExists(db, dbName, tableName, columnName) {
  const [colFks] = await db.query(
    `SELECT kcu.CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON  tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
       AND tc.TABLE_NAME      = kcu.TABLE_NAME
     WHERE kcu.TABLE_SCHEMA    = ?
       AND kcu.TABLE_NAME      = ?
       AND kcu.COLUMN_NAME     = ?
       AND tc.CONSTRAINT_TYPE  = 'FOREIGN KEY'`,
    [dbName, tableName, columnName]
  );

  if (colFks.length > 0) {
    const fkName = colFks[0].CONSTRAINT_NAME;
    await db.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fkName}\``);
    console.log(`  [${dbName}] Dropped FK "${fkName}" on ${tableName}(${columnName}) — OK`);
  } else {
    console.log(`  [${dbName}] No FK on ${tableName}(${columnName}) found (already clean)`);
  }
}

(async () => {
  try {
    const [units] = await centralPool.query(
      "SELECT db_name FROM units WHERE db_status = 'ACTIVE' AND is_active = 1"
    );
    console.log('Found', units.length, 'active unit DB(s):', units.map(u => u.db_name).join(', '));

    for (const unit of units) {
      const db = getPool(unit.db_name);
      try {
        await dropFkIfExists(db, unit.db_name, 'visit_requests',   'requester_user_id');
        await dropFkIfExists(db, unit.db_name, 'approval_history', 'acted_by_user_id');
      } catch (e) {
        console.error(`  [${unit.db_name}] ERROR:`, e.message);
      }
    }

    console.log('\nAll done. Restart the backend server to apply controller fixes.');
  } catch (e) {
    console.error('Fatal error:', e.message);
  } finally {
    process.exit(0);
  }
})();
