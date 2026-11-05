// Explicit development-only reset. Back up first; never called by server startup.
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
require('../lib/env')();
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo reset is disabled in production');
  const file = process.env.SMARTKOZ_DB || path.join(__dirname,'..','data','smartkoz.db');
  const db = new Database(file);
  const backupDir=path.join(path.dirname(file),'backups'); fs.mkdirSync(backupDir,{recursive:true});
  const backup=path.join(backupDir,`before-reset-${Date.now()}.db`);
  await db.backup(backup);
  db.pragma('foreign_keys=OFF');
  const keep=new Set(['factory_maps','factory_zones','cameras']);
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.transaction(()=>{for(const {name} of tables)if(!keep.has(name))db.exec(`DROP TABLE "${name.replaceAll('"','""')}"`);})();
  db.close();
  const server=require('../server'); server.platform.close();server.db.exec('VACUUM');server.db.pragma('wal_checkpoint(TRUNCATE)');server.db.close();
  console.log(`Reset complete. Backup: ${backup}. Only the administrator account was created; maps and camera configuration retained.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
