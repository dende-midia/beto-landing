import { getConfig } from '../server/config.js';
import { openDatabase } from '../server/database.js';
import { seedDevelopment } from '../server/seed.js';

const config=getConfig();
const db=openDatabase(config.databasePath);
seedDevelopment(db,{rootDir:config.rootDir});
console.log('Seed local criado. Credenciais salvas em data/dev-credentials.txt.');
db.close();
