import { getConfig } from '../server/config.js';
import { openDatabase } from '../server/database.js';

const config=getConfig();
const db=openDatabase(config.databasePath);
console.log(`Migrações aplicadas em ${config.databasePath}`);
db.close();
