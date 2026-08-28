import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const folders=['server','scripts','public/product','test'];
const files=[];
for(const folder of folders) walk(path.join(root,folder));
for(const file of files) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log(`Verificação concluída: ${files.length} arquivos JavaScript válidos.`);

function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    if(entry.isDirectory())walk(target);
    else if(entry.name.endsWith('.js'))files.push(target);
  }
}
