import http from 'node:http';
import { createApplication } from './app.js';

const app=createApplication();
const server=http.createServer(app.handler);
server.listen(app.config.port,app.config.host,()=>console.log(`BETO disponível em http://${app.config.host}:${app.config.port}`));

function shutdown(){ server.close(()=>{app.close();process.exit(0);}); }
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
