const instance = require('../server');
const server = instance.app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',message=>{if(message==='stop'){instance.platform.close();server.closeAllConnections();server.close(()=>{instance.db.close();process.exit(0);});}});
