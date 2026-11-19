// team logos are stored on the team as a small PNG data URL, so they sync and export with the library
export const LOGO_MAX_SIZE=256;
export function logoSize(width,height,max=LOGO_MAX_SIZE){const scale=Math.min(1,max/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
export async function readLogo(file){
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  const {width,height}=logoSize(image.naturalWidth||LOGO_MAX_SIZE,image.naturalHeight||LOGO_MAX_SIZE),canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0,width,height);
  return canvas.toDataURL('image/png');
 }finally{URL.revokeObjectURL(url);}
}
export function setTeamLogo(team,logo,now=new Date().toISOString()){team.logo=logo;team.updatedAt=now;}
export const teamMark=(team,esc,initials)=>team.logo?`<img class="monogram team-logo-image" src="${esc(team.logo)}" alt="">`:`<span class="monogram">${esc(initials(team.name))}</span>`;
export const teamLogoButton=(team,esc)=>`<button type="button" class="team-logo-button${team.logo?'':' empty'}" data-action="team-logo" title="${team.logo?'Change logo':'Add logo'}">${team.logo?`<img src="${esc(team.logo)}" alt="${esc(team.name)} logo">`:'<span>Add logo</span>'}</button>`;
