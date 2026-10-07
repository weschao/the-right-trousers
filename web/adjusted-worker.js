import {adjustedRatings} from './adjusted.js';
self.onmessage=({data:{id,dataset}})=>{
 try{self.postMessage({id,result:adjustedRatings(dataset)});}
 catch(error){self.postMessage({id,error:error.message||'Unable to fit adjusted ratings.'});}
};
