var Promise = require('../src/core');
 

new Promise((resolve)=>{
  // resolve();
  setTimeout(()=>{
    resolve(new Promise((resolve2)=>{
      setTimeout(()=>{
        console.log('2222');
        resolve2();
      },222);
    }));
  })
}).then(()=>{
  console.log('then excute')
  return new Promise((resolve)=>{

  })
}).then(()=>{
  console.log('then excute2')
});