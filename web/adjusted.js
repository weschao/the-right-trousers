import {pointsOf} from './core.js';

// Gaussian-prior logistic adjusted plus-minus. See the adjusted-ratings section in README.md.
export const ADJUSTED_PRIORS=Object.freeze([.15,.35,.7]);
const DEFAULT_PRIOR=.35,INTERCEPT_SD=2.5,OPPONENT_SD=.75,GAME_SD=1,OPPONENT_PLAYER_SD=.35;
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const fullLine=(line,roster)=>Array.isArray(line)&&line.length===7&&new Set(line).size===7&&line.every(id=>id&&roster.has(id));

export function adjustedDataset(games,team){
 const roster=new Set(team.players.map(p=>p.id)),rows=[],coverage={O:{completed:0,incompleteLine:0,substitution:0},D:{completed:0,incompleteLine:0,substitution:0}},seen=new Set();
 for(const game of games){
  if(game.teamId!==team.id||seen.has(game))continue;seen.add(game);
  // The position, not a potentially duplicated game ID, is the analysis unit.
  const gameIndex=seen.size-1,opponent=game.opponentTeamId?`team:${game.opponentTeamId}`:game.opponent?.trim()?`name:${game.opponent.trim().toLowerCase()}`:`game:${gameIndex}`,opponentRoster=new Set((game.opponents||[]).map(p=>p.id));
  for(const point of pointsOf(game)){
   if(!['us','them'].includes(point.winner)||!['O','D'].includes(point.starting))continue;
   const count=coverage[point.starting];count.completed++;
   if(point.events.some(e=>e.type==='substitution'&&e.side==='us')){count.substitution++;continue;}
   if(!fullLine(point.line,roster)){count.incompleteLine++;continue;}
   const opponentKnown=fullLine(point.opponentLine,opponentRoster)&&!point.events.some(e=>e.type==='substitution'&&e.side==='them');
   rows.push({game:gameIndex,opponent,starting:point.starting,y:Number(point.winner===(point.starting==='O'?'us':'them')),line:[...point.line].sort(),opponentLine:opponentKnown?point.opponentLine.map(id=>JSON.stringify([opponent,id])).sort():null});
  }
 }
 return {rows,coverage};
}

// Cholesky solves retain joint covariance; marginal standard errors alone would
// understate uncertainty for correlated teammates and replacement contrasts.
function cholesky(matrix,n){
 const l=new Float64Array(matrix.length);
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
  let sum=matrix[i*n+j];for(let k=0;k<j;k++)sum-=l[i*n+k]*l[j*n+k];
  if(i===j){if(!(sum>0))throw new Error('Adjusted-rating covariance is not positive definite');l[i*n+j]=Math.sqrt(sum);}else l[i*n+j]=sum/l[j*n+j];
 }
 return l;
}
function solve(l,b){
 const n=b.length,x=Float64Array.from(b);
 for(let i=0;i<n;i++){for(let j=0;j<i;j++)x[i]-=l[i*n+j]*x[j];x[i]/=l[i*n+i];}
 return solveUpper(l,x);
}
function solveUpper(l,b){const n=b.length,x=Float64Array.from(b);for(let i=n-1;i>=0;i--){for(let j=i+1;j<n;j++)x[i]-=l[j*n+i]*x[j];x[i]/=l[i*n+i];}return x;}
function grouped(rows){const groups=new Map();for(const row of rows){if(!groups.has(row.game))groups.set(row.game,[]);groups.get(row.game).push(row);}return [...groups.values()];}
function fractions(rows,key){const counts=new Map();for(const row of rows)for(const id of row[key]||[])counts.set(id,(counts.get(id)||0)+1/rows.length);return counts;}

function design(rows,tau,players=true){
 const keys=['intercept'],precision=[1/INTERCEPT_SD**2],index=new Map([['intercept',0]]),add=(key,sd)=>{if(!index.has(key)){index.set(key,keys.length);keys.push(key);precision.push(1/sd**2);}return index.get(key);};
 const groups=grouped(rows),ownIds=players?[...new Set(rows.flatMap(r=>r.line))].sort():[];
 for(const id of ownIds)add(`player:${id}`,tau);
 const observations=[],contexts=[];
 for(const group of groups){
  const {game,opponent}=group[0],oppIndex=add(`opponent:${opponent}`,OPPONENT_SD),gameIndex=add(`game:${game}`,GAME_SD),means=fractions(group,'line'),opponentKnown=group.every(r=>r.opponentLine),oppMeans=opponentKnown?fractions(group,'opponentLine'):new Map();
  for(const id of [...oppMeans.keys()].sort())add(`opponent-player:${id}`,OPPONENT_PLAYER_SD);
  contexts.push({game,opponent,count:group.length,indices:[0,oppIndex,gameIndex],opponentKnown});
  for(const row of group){
   const x=[[0,1],[oppIndex,1],[gameIndex,1]],line=new Set(row.line),oppLine=new Set(row.opponentLine);
   if(players)for(const [id,mean] of means){const value=Number(line.has(id))-mean;if(Math.abs(value)>1e-12)x.push([index.get(`player:${id}`),value]);}
   for(const [id,mean] of oppMeans){const value=Number(oppLine.has(id))-mean;if(Math.abs(value)>1e-12)x.push([index.get(`opponent-player:${id}`),value]);}
   observations.push({x,y:row.y});
  }
 }
 return {keys,index,precision,observations,contexts,ownIds};
}
function fit(rows,tau,players=true){
 const d=design(rows,tau,players),n=d.keys.length;
 let beta=new Float64Array(n),l,converged=false;
 const objective=b=>{let value=0;for(let i=0;i<n;i++)value+=.5*d.precision[i]*b[i]**2;for(const {x,y} of d.observations){const eta=x.reduce((s,[i,v])=>s+b[i]*v,0);value+=Math.max(eta,0)+Math.log1p(Math.exp(-Math.abs(eta)))-y*eta;}return value;};
 const derivatives=b=>{const h=new Float64Array(n*n),g=new Float64Array(n);for(let i=0;i<n;i++){h[i*n+i]=d.precision[i];g[i]=d.precision[i]*b[i];}for(const {x,y} of d.observations){const p=sigmoid(x.reduce((s,[i,v])=>s+b[i]*v,0)),w=p*(1-p);for(const [i,v] of x){g[i]+=(p-y)*v;for(const [j,u] of x)h[i*n+j]+=w*v*u;}}return {h,g};};
 for(let iteration=0;iteration<40;iteration++){
  const {h,g}=derivatives(beta);l=cholesky(h,n);const step=solve(l,g);
  if(Math.max(...step.map(Math.abs))<1e-7){converged=true;break;}
  const old=objective(beta);let scale=1,next;
  while(scale>1e-8){next=beta.map((value,i)=>value-scale*step[i]);if(objective(next)<=old+1e-10)break;scale/=2;}
  if(scale<=1e-8)break;beta=next;
 }
 if(!converged)throw new Error('Adjusted-rating model did not converge');
 return {...d,beta,l,tau,players};
}

// Gaussian quadrature for the unseen game's random intercept. No held-out
// outcome enters centering, fitting, prior selection, or prediction.
const NORMAL_NODES=[-2.8569700138728056,-1.355626179974266,0,1.355626179974266,2.8569700138728056],NORMAL_WEIGHTS=[.01125741132772069,.2220759220056126,.5333333333333333,.2220759220056126,.01125741132772069];
function predict(model,rows){
 const predictions=[];
 for(const group of grouped(rows)){
  const means=fractions(group,'line'),oppKnown=group.every(r=>r.opponentLine),oppMeans=oppKnown?fractions(group,'opponentLine'):new Map();
  for(const row of group){
   let eta=model.beta[0],variance=GAME_SD**2;
   const opp=model.index.get(`opponent:${row.opponent}`);if(opp===undefined)variance+=OPPONENT_SD**2;else eta+=model.beta[opp];
   const line=new Set(row.line),opps=new Set(row.opponentLine);
   for(const [id,mean] of means){const i=model.index.get(`player:${id}`);const value=Number(line.has(id))-mean;if(i!==undefined)eta+=value*model.beta[i];else if(model.players)variance+=value*value*model.tau**2;}
   for(const [id,mean] of oppMeans){const value=Number(opps.has(id))-mean,i=model.index.get(`opponent-player:${id}`);if(i===undefined)variance+=value*value*OPPONENT_PLAYER_SD**2;else eta+=value*model.beta[i];}
   predictions.push({game:row.game,y:row.y,p:NORMAL_NODES.reduce((s,z,i)=>s+NORMAL_WEIGHTS[i]*sigmoid(eta+z*Math.sqrt(variance)),0)});
  }
 }
 return predictions;
}
const logLoss=predictions=>predictions.reduce((s,{p,y})=>s-y*Math.log(Math.max(1e-12,p))-(1-y)*Math.log(Math.max(1e-12,1-p)),0)/predictions.length;
function folds(rows,max=5){const ids=[...new Set(rows.map(r=>r.game))];return Array.from({length:Math.min(max,ids.length)},(_,i)=>new Set(ids.filter((_,j)=>j%Math.min(max,ids.length)===i)));}
function selectPrior(rows){
 if(new Set(rows.map(r=>r.game)).size<2)return {tau:DEFAULT_PRIOR,scores:[]};
 const splits=folds(rows,4),scores=ADJUSTED_PRIORS.map(tau=>{const heldOut=[];for(const test of splits)heldOut.push(...predict(fit(rows.filter(r=>!test.has(r.game)),tau),rows.filter(r=>test.has(r.game))));return {tau,loss:logLoss(heldOut)};});
 // On ties choose stronger shrinkage; no zero-variance prior masquerading as certainty.
 return {tau:[...scores].sort((a,b)=>a.loss-b.loss||a.tau-b.tau)[0].tau,scores};
}
function validate(rows){
 const splits=folds(rows);if(splits.length<3)return {status:'unavailable',games:splits.length,reason:'At least three games are needed for nested whole-game validation.'};
 const full=[],baseline=[],foldResults=[];
 for(const test of splits){
  const train=rows.filter(r=>!test.has(r.game)),held=rows.filter(r=>test.has(r.game)),{tau}=selectPrior(train),a=predict(fit(train,tau),held),b=predict(fit(train,tau,false),held);
  full.push(...a);baseline.push(...b);foldResults.push({trainingGames:[...new Set(train.map(r=>r.game))],heldOutGames:[...test],tau,points:held.length,adjustedLoss:logLoss(a),baselineLoss:logLoss(b)});
 }
 const adjustedLoss=logLoss(full),baselineLoss=logLoss(baseline),brier=items=>items.reduce((s,{p,y})=>s+(p-y)**2,0)/items.length;
 return {status:'available',games:new Set(rows.map(r=>r.game)).size,points:rows.length,adjustedLoss,baselineLoss,improvement:baselineLoss-adjustedLoss,adjustedBrier:brier(full),baselineBrier:brier(baseline),folds:foldResults};
}

function contrast(model,id,pool){const c=new Float64Array(model.keys.length);for(const candidate of pool)c[model.index.get(`player:${candidate}`)]=candidate===id?1:-1/(pool.length-1);return c;}
function rowBasis(model){
 const basis=[],n=model.keys.length;
 for(const {x} of model.observations){const v=new Float64Array(n);for(const [i,value] of x)if(model.keys[i].startsWith('player:')||model.keys[i].startsWith('opponent-player:'))v[i]=value;
  // Reorthogonalization makes the null-space diagnostic stable for near aliases.
  for(let pass=0;pass<2;pass++)for(const q of basis){const a=dot(v,q);for(let i=0;i<n;i++)v[i]-=a*q[i];}
  const norm=Math.sqrt(dot(v,v));if(norm>1e-8)basis.push(v.map(value=>value/norm));
 }
 return basis;
}
function standardized(model,beta,pool){
 if(pool.length<2)return [];
 const center=pool.reduce((s,id)=>s+beta[model.index.get(`player:${id}`)],0)/pool.length,total=model.contexts.reduce((s,g)=>s+g.count,0),rates=pool.map(id=>model.contexts.reduce((s,g)=>s+g.count/total*sigmoid(g.indices.reduce((a,i)=>a+beta[i],0)+beta[model.index.get(`player:${id}`)]-center),0)),mean=rates.reduce((s,r)=>s+r,0)/rates.length;
 return rates.map(rate=>100*(rate-mean)*pool.length/(pool.length-1));
}
function normalGenerator(){let state=71823;const uniform=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return (state+.5)/4294967296;};return ()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());}
const quantile=(sorted,q)=>{const x=(sorted.length-1)*q,i=Math.floor(x);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(x-i);};

function analyze(rows,coverage){
 const groups=grouped(rows),participants=[...new Set(rows.flatMap(r=>r.line))].sort(),pool=participants.filter(id=>groups.some(group=>group.some(r=>r.line.includes(id))&&group.some(r=>!r.line.includes(id)))),prior=selectPrior(rows),model=fit(rows,prior.tau),basis=rowBasis(model),estimates=standardized(model,model.beta,pool),samples=pool.map(()=>[]),random=normalGenerator();
 for(let draw=0;draw<1024&&pool.length>1;draw++){const perturb=solveUpper(model.l,Float64Array.from(model.beta,()=>random())),values=standardized(model,model.beta.map((b,i)=>b+perturb[i]),pool);values.forEach((value,i)=>samples[i].push(value));}
 const sensitivity=ADJUSTED_PRIORS.map(tau=>({tau,values:tau===prior.tau?estimates:standardized(model,fit(rows,tau).beta,pool)})),ratings={};
 for(const id of participants){
  const points=rows.filter(r=>r.line.includes(id)).length,games=new Set(rows.filter(r=>r.line.includes(id)).map(r=>r.game)).size,i=pool.indexOf(id);
  if(i<0||pool.length<2){ratings[id]={value:null,interval:null,points,games,status:'no-within-game-variation',confoundedWith:[]};continue;}
  const c=contrast(model,id,pool),variance=dot(c,solve(model.l,c)),priorVariance=prior.tau**2*dot(c,c),unidentified=Math.max(0,1-basis.reduce((s,q)=>s+dot(c,q)**2,0)/dot(c,c)),confoundedWith=pool.filter(other=>other!==id&&rows.every(row=>row.line.includes(id)===row.line.includes(other))),values=sensitivity.map(s=>s.values[i]);samples[i].sort((a,b)=>a-b);
  ratings[id]={value:estimates[i],interval:[quantile(samples[i],.025),quantile(samples[i],.975)],points,games,status:unidentified>1e-6?'partly-confounded':'estimated',confoundedWith,unidentifiedFraction:unidentified,uncertaintyReduction:Math.max(0,Math.min(1,1-variance/priorVariance)),sensitivity:[Math.min(...values),Math.max(...values)]};
 }
 return {ratings,coverage:{...coverage,used:rows.length,opponentAdjusted:groups.filter(group=>group.every(r=>r.opponentLine)).reduce((s,g)=>s+g.length,0)},games:groups.length,comparisonPlayers:pool,priorSD:prior.tau,priorScores:prior.scores,validation:validate(rows)};
}

export function adjustedRatings(dataset){
 const result={method:'Gaussian-prior logistic regression; Laplace intervals',priorCandidates:[...ADJUSTED_PRIORS]};
 for(const [key,starting] of [['hold','O'],['opponentHold','D']]){
  const rows=dataset.rows.filter(row=>row.starting===starting);
  result[key]=rows.length?analyze(rows,dataset.coverage[starting]):{ratings:{},coverage:{...dataset.coverage[starting],used:0,opponentAdjusted:0},games:0,comparisonPlayers:[],priorSD:DEFAULT_PRIOR,priorScores:[],validation:{status:'unavailable',games:0,reason:'No eligible completed points.'}};
 }
 return result;
}
