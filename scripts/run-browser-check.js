const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','tests/workspace-changes.test.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,SMARTKOZ_BROWSER_CHECK:'1'},stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status||0;
