const fs = require('node:fs');
const path = require('node:path');
function readValues() {
  const file = path.join(__dirname,'..','.env');
  if (!fs.existsSync(file)) return {};
  const values={};
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const clean=line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const index=clean.indexOf('=');
    if(index<1)continue;
    const key=clean.slice(0,index).trim(),value=clean.slice(index+1).trim().replace(/^["']|["']$/g,'');
    values[key]=value;
  }
  return values;
}
function loadEnvFile(){for(const [key,value] of Object.entries(readValues()))if(process.env[key]===undefined)process.env[key]=value;}
// A replacement AI credential takes effect on the next request.
loadEnvFile.get=function(key){const values=readValues();return Object.hasOwn(values,key)?values[key]:process.env[key];};
module.exports=loadEnvFile;
